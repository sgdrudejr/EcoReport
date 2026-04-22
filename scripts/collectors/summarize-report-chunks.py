#!/usr/bin/env python3
"""Stage 1.4a: summarize selected report chunks with local LM Studio (OpenAI-compatible).

Example:
  .venv/bin/python scripts/collectors/summarize-report-chunks.py --date 2026-04-22
  .venv/bin/python scripts/collectors/summarize-report-chunks.py --date 2026-04-22 --top-n 30 --concurrency 6
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from openai import OpenAI

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from lib.env_loader import load_simple_dotenv


DEFAULT_LOCAL_BASE_URL = "http://localhost:1234/v1"
DEFAULT_OUTPUT_NAME = "stage1-chunk-summaries.json"

_THREAD_LOCAL = threading.local()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage 1.4a local LLM chunk summarizer")
    parser.add_argument("--date", required=True, help="대상 날짜 (YYYY-MM-DD)")
    parser.add_argument("--top-n", type=int, default=30, help="우선순위 상위 리포트 개수")
    parser.add_argument("--concurrency", type=int, default=6, help="청크 요약 동시 실행 수")
    parser.add_argument("--chunk-char-limit", type=int, default=150, help="청크 요약 최대 글자 수")
    parser.add_argument("--report-char-limit", type=int, default=400, help="리포트 병합 요약 최대 글자 수")
    parser.add_argument("--output", default=None, help="출력 경로")
    parser.add_argument(
        "--model",
        default=None,
        help="강제 사용할 로컬 모델명 (기본: LOCAL_LLM_MODEL 또는 /v1/models 첫 번째)",
    )
    return parser.parse_args()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\n", " ").split()).strip()


def truncate_text(value: str, limit: int) -> str:
    text = normalize_text(value)
    if len(text) <= limit:
        return text
    if limit <= 3:
        return text[:limit]
    return f"{text[: max(0, limit - 3)]}..."


def score_extract_priority(extract: dict[str, Any]) -> int:
    priority = extract.get("priority_score")
    if isinstance(priority, (int, float)):
        return int(round(priority))

    score = 0
    score += len(extract.get("related_holdings_in_my_portfolio") or []) * 12
    score += len(extract.get("portfolio_impacts_candidate") or []) * 10
    score += len(extract.get("related_accounts") or []) * 5

    report_type = str(extract.get("report_type") or "").lower()
    if report_type in {"macro", "strategy"}:
        score += 20
    elif report_type == "industry":
        score += 12
    elif report_type == "theme":
        score += 10

    confidence = str(extract.get("confidence") or "").upper()
    if confidence == "HIGH":
        score += 6
    elif confidence == "MEDIUM":
        score += 3

    sentiment = extract.get("sentiment_score")
    if isinstance(sentiment, (int, float)):
        score += int(round(abs(sentiment) * 10))

    score += min(6, len(extract.get("catalysts") or []) * 2)
    score += min(4, len(extract.get("risks") or []))

    return score


def select_top_reports(stage1_extracts: list[dict[str, Any]], top_n: int) -> list[dict[str, Any]]:
    scored = []
    for extract in stage1_extracts:
        report_id = str(extract.get("id") or "").strip()
        if not report_id:
            continue
        scored.append(
            {
                "report_id": report_id,
                "title": extract.get("title") or "",
                "broker": extract.get("broker") or "",
                "sector": extract.get("sector") or "",
                "priority_score": score_extract_priority(extract),
            }
        )

    scored.sort(key=lambda row: row["priority_score"], reverse=True)

    seen: set[str] = set()
    selected: list[dict[str, Any]] = []
    for row in scored:
        if row["report_id"] in seen:
            continue
        seen.add(row["report_id"])
        selected.append(row)
        if len(selected) >= top_n:
            break
    return selected


def get_client(base_url: str) -> OpenAI:
    client = getattr(_THREAD_LOCAL, "client", None)
    if client is None:
        # LM Studio OpenAI-compatible endpoint generally accepts any non-empty api_key.
        client = OpenAI(base_url=base_url, api_key=os.getenv("LOCAL_LLM_API_KEY", "lm-studio"))
        _THREAD_LOCAL.client = client
    return client


def resolve_model(base_url: str, explicit_model: str | None) -> str:
    env_model = (os.getenv("LOCAL_LLM_MODEL") or "").strip()
    model_name = (explicit_model or env_model).strip()
    if model_name:
        return model_name

    try:
        client = OpenAI(base_url=base_url, api_key=os.getenv("LOCAL_LLM_API_KEY", "lm-studio"))
        models = client.models.list().data
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "로컬 LLM 모델 조회에 실패했습니다. "
            f"LOCAL_LLM_BASE_URL={base_url} 연결 상태를 확인하세요. ({exc})"
        ) from exc

    if not models:
        raise RuntimeError(
            "로컬 LLM 모델 목록이 비어 있습니다. LM Studio에서 모델을 로드한 뒤 다시 실행하세요."
        )

    model = models[0].id
    if not model:
        raise RuntimeError("로컬 LLM 모델명을 확인할 수 없습니다 (/v1/models 응답 오류).")
    return model


def summarize_chunk(
    base_url: str,
    model_name: str,
    chunk_text: str,
    title: str,
    broker: str,
    char_limit: int,
) -> str:
    user_content = (
        f"[{title or '제목 없음'} / {broker or '브로커 미상'}]\n"
        f"{chunk_text}\n\n"
        "위 내용을 한국어로 핵심만 요약하세요. "
        f"{char_limit}자 이내, 불필요한 수식어 없이 사실/핵심 논지만 작성하세요."
    )

    response = get_client(base_url).chat.completions.create(
        model=model_name,
        messages=[
            {
                "role": "system",
                "content": "You are a financial research summarizer. Summarize in Korean.",
            },
            {"role": "user", "content": user_content},
        ],
        temperature=0.2,
        max_tokens=220,
    )

    text = normalize_text(response.choices[0].message.content if response.choices else "")
    text = text.lstrip("-•* ")
    if not text:
        raise RuntimeError("요약 응답이 비어 있습니다.")
    return truncate_text(text, char_limit)


def merge_report_summaries(parts: list[str], char_limit: int) -> str:
    merged = ""
    seen: set[str] = set()
    for part in parts:
        clean = normalize_text(part)
        if not clean or clean in seen:
            continue
        seen.add(clean)

        candidate = clean if not merged else f"{merged} {clean}"
        if len(candidate) <= char_limit:
            merged = candidate
            continue

        if not merged:
            merged = truncate_text(clean, char_limit)
        break

    return merged


def main() -> None:
    args = parse_args()

    root = Path(os.getenv("ECOREPORT_ROOT") or Path(__file__).resolve().parents[2])
    env_path = root / ".env"
    if env_path.exists():
        load_simple_dotenv(env_path)

    base_url = (os.getenv("LOCAL_LLM_BASE_URL") or "").strip()
    used_default_base = False
    if not base_url:
        base_url = DEFAULT_LOCAL_BASE_URL
        used_default_base = True

    if not base_url.startswith("http"):
        raise RuntimeError(
            "LOCAL_LLM_BASE_URL 형식이 올바르지 않습니다. 예: http://192.168.0.xxx:1234/v1"
        )

    state_dir = root / "data" / "analysis-state" / args.date
    chunks_path = state_dir / "chunk-index" / "chunks.jsonl"
    extracts_path = state_dir / "stage1-report-extracts-v2.json"
    output_path = Path(args.output) if args.output else state_dir / DEFAULT_OUTPUT_NAME

    if not chunks_path.exists():
        raise RuntimeError(f"청크 인덱스 파일이 없습니다: {chunks_path}")
    if not extracts_path.exists():
        raise RuntimeError(f"Stage 1 추출 파일이 없습니다: {extracts_path}")

    stage1 = load_json(extracts_path)
    extracts = stage1.get("extracts") or []
    if not extracts:
        raise RuntimeError(f"extracts가 비어 있습니다: {extracts_path}")

    top_reports = select_top_reports(extracts, max(1, args.top_n))
    selected_report_ids = {row["report_id"] for row in top_reports}
    report_meta = {row["report_id"]: row for row in top_reports}

    chunks = load_jsonl(chunks_path)
    target_chunks: list[dict[str, Any]] = []
    for chunk in chunks:
        report_id = str(chunk.get("report_id") or "")
        if report_id not in selected_report_ids:
            continue

        text = normalize_text(chunk.get("text") or chunk.get("core_text") or "")
        if not text:
            continue

        target_chunks.append(
            {
                "chunk_id": chunk.get("chunk_id") or "",
                "report_id": report_id,
                "chunk_seq": int(chunk.get("chunk_seq") or 0),
                "text": text,
            }
        )

    if not target_chunks:
        payload = {
            "date": args.date,
            "model": "",
            "source": "local_llm",
            "summaries": [],
            "stats": {
                "selected_report_count": len(top_reports),
                "selected_chunk_count": 0,
                "summarized_chunk_count": 0,
                "failed_chunk_count": 0,
            },
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"saved: {output_path}")
        print("selected_chunks: 0")
        return

    model_name = resolve_model(base_url, args.model)

    # Fast connectivity check before running concurrent jobs.
    try:
        OpenAI(base_url=base_url, api_key=os.getenv("LOCAL_LLM_API_KEY", "lm-studio")).chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "You are a test assistant."},
                {"role": "user", "content": "ping"},
            ],
            temperature=0,
            max_tokens=4,
        )
    except Exception as exc:  # noqa: BLE001
        suffix = (
            " (LOCAL_LLM_BASE_URL 미설정으로 localhost 기본값을 사용 중입니다.)"
            if used_default_base
            else ""
        )
        raise RuntimeError(
            "로컬 LLM 연결 테스트에 실패했습니다. "
            f"LOCAL_LLM_BASE_URL={base_url} 를 확인하세요.{suffix} ({exc})"
        ) from exc

    summarized_by_report: dict[str, list[tuple[int, str]]] = {}
    failed_count = 0

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
        future_map = {
            executor.submit(
                summarize_chunk,
                base_url,
                model_name,
                row["text"],
                report_meta[row["report_id"]]["title"],
                report_meta[row["report_id"]]["broker"],
                max(40, args.chunk_char_limit),
            ): row
            for row in target_chunks
        }

        for future in as_completed(future_map):
            row = future_map[future]
            report_id = row["report_id"]
            try:
                summary = future.result()
                summarized_by_report.setdefault(report_id, []).append((row["chunk_seq"], summary))
            except Exception as exc:  # noqa: BLE001
                failed_count += 1
                print(
                    f"[warn] chunk summarize 실패: report_id={report_id} chunk_id={row['chunk_id']} ({exc})",
                    file=sys.stderr,
                )

    summaries: list[dict[str, Any]] = []
    for report_id, rows in summarized_by_report.items():
        rows.sort(key=lambda item: item[0])
        merged = merge_report_summaries([item[1] for item in rows], max(80, args.report_char_limit))
        if not merged:
            continue

        meta = report_meta[report_id]
        summaries.append(
            {
                "report_id": report_id,
                "title": meta.get("title") or "",
                "broker": meta.get("broker") or "",
                "sector": meta.get("sector") or "",
                "summary": merged,
                "priority_score": int(meta.get("priority_score") or 0),
            }
        )

    summaries.sort(key=lambda row: row.get("priority_score", 0), reverse=True)

    payload = {
        "date": args.date,
        "model": model_name,
        "source": "local_llm",
        "summaries": summaries,
        "stats": {
            "selected_report_count": len(top_reports),
            "selected_chunk_count": len(target_chunks),
            "summarized_chunk_count": sum(len(rows) for rows in summarized_by_report.values()),
            "failed_chunk_count": failed_count,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"saved: {output_path}")
    print(f"model: {model_name}")
    print(f"selected_reports: {len(top_reports)}")
    print(f"selected_chunks: {len(target_chunks)}")
    print(f"summarized_chunks: {payload['stats']['summarized_chunk_count']}")
    print(f"failed_chunks: {failed_count}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"stage1.4 summarize 실패: {exc}", file=sys.stderr)
        sys.exit(1)
