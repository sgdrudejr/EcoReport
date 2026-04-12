#!/usr/bin/env python3
"""
요약/결론 성격의 청크만 추출해 Gemini 1.5 Flash로 최종 통합 브리핑을 생성합니다.

지원 입력 형식:
1. JSONL 각 줄이 {"text": "...", "metadata": {...}} 형태
2. EcoReport chunks.jsonl 같은 평면 구조
   {"text": "...", "section_title": "...", "report_id": "...", ...}

예시:
    python3 scripts/generate_gemini_briefing.py \
      --input data/reports/2026-04-03/rag/chunks.jsonl \
      --output knowledge/daily/2026-04-03-gemini-briefing.md
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from lib.env_loader import load_simple_dotenv


SUMMARY_KEYWORDS = [
    "요약",
    "summary",
    "결론",
    "투자 포인트",
    "투자포인트",
    "핵심 포인트",
    "핵심포인트",
    "투자 의견",
    "investment point",
    "takeaway",
    "highlights",
]

BRIEFING_KEYWORDS = SUMMARY_KEYWORDS + [
    "시사점",
    "전망",
    "전략",
    "투자전략",
    "핵심",
    "핵심 내용",
    "핵심내용",
    "체크포인트",
    "top picks",
    "top pick",
    "morning letter",
    "daily",
    "weekly",
    "comment",
    "market",
    "macro",
    "spot brief",
    "issue",
    "outlook",
    "implication",
    "view",
]


DEFAULT_PROMPT = (
    "다음은 여러 증권사 리포트의 핵심 요약본 모음입니다. "
    "이 내용들을 바탕으로 이번 주 거시경제 흐름과 주요 섹터의 동향을 "
    "하나의 완성된 브리핑 마크다운 문서로 작성해 주세요."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="요약 관련 청크만 추출해 Gemini 1.5 Flash로 통합 브리핑을 생성합니다."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="입력 JSONL 파일 경로 (예: data/reports/2026-04-03/rag/chunks.jsonl)",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Gemini 응답을 저장할 출력 파일 경로 (예: knowledge/daily/2026-04-03-gemini-briefing.md)",
    )
    parser.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="Gemini에 전달할 시스템성 요청 문구",
    )
    parser.add_argument(
        "--head-text-limit",
        type=int,
        default=500,
        help="본문 앞부분에서 키워드를 찾을 최대 글자 수",
    )
    parser.add_argument(
        "--max-chunks",
        type=int,
        default=60,
        help="Gemini로 넘길 최대 청크 수",
    )
    parser.add_argument(
        "--min-chunks",
        type=int,
        default=50,
        help="최소 확보하려는 청크 수. 부족하면 리포트별 대표 analysis 청크를 추가합니다.",
    )
    parser.add_argument(
        "--model",
        default="gemini-2.5-flash",
        help="사용할 Gemini 모델명",
    )
    parser.add_argument("--run-date", default=None, help="실행일 (YYYY-MM-DD)")
    parser.add_argument("--effective-market-date", default=None, help="기준 거래일 (YYYY-MM-DD)")
    return parser.parse_args()


def ensure_env_file(env_path: Path) -> None:
    if env_path.exists():
        return

    env_path.write_text("GEMINI_API_KEY=\n", encoding="utf-8")
    raise RuntimeError(
        f".env 파일이 없어 템플릿을 생성했습니다: {env_path}\n"
        "GEMINI_API_KEY 값을 채운 뒤 다시 실행해 주세요."
    )


def load_api_key(project_root: Path) -> str:
    env_path = project_root / ".env"
    ensure_env_file(env_path)
    load_simple_dotenv(env_path)

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(".env에 GEMINI_API_KEY가 비어 있습니다.")
    return api_key


def create_client(api_key: str):
    try:
        from google import genai
    except ImportError as exc:
        raise RuntimeError("google-genai 패키지가 없어 Gemini 브리핑 생성을 실행할 수 없습니다.") from exc

    return genai.Client(api_key=api_key)


def normalized(text: Any) -> str:
    return str(text or "").strip().lower()


def row_to_metadata(row: Dict[str, Any]) -> Dict[str, Any]:
    metadata = row.get("metadata")
    if isinstance(metadata, dict):
        return metadata

    return {
        "title": row.get("title"),
        "heading": row.get("section_title"),
        "report_id": row.get("report_id") or row.get("id"),
        "broker": row.get("broker"),
        "category": row.get("category"),
        "source": row.get("source"),
        "sequence": row.get("sequence"),
        "page_start": row.get("page_start"),
        "page_end": row.get("page_end"),
    }


def has_keyword(text: str, keywords: List[str]) -> bool:
    compact = normalized(text)
    return any(keyword in compact for keyword in keywords)


def is_summary_chunk(row: Dict[str, Any], head_text_limit: int) -> bool:
    metadata = row_to_metadata(row)
    title_or_heading_candidates = [
        metadata.get("heading"),
        metadata.get("title"),
        metadata.get("section_title"),
    ]
    title_hit = any(has_keyword(candidate, SUMMARY_KEYWORDS) for candidate in title_or_heading_candidates if candidate)
    if title_hit:
        return True

    text = str(row.get("text", "") or "")
    head = text[:head_text_limit]
    return has_keyword(head, SUMMARY_KEYWORDS)


def is_briefing_relevant_chunk(row: Dict[str, Any], head_text_limit: int) -> bool:
    if row.get("chunk_type") == "disclaimer":
        return False

    metadata = row_to_metadata(row)
    title_or_heading_candidates = [
        metadata.get("heading"),
        metadata.get("title"),
        metadata.get("section_title"),
        row.get("section_title"),
    ]
    title_hit = any(has_keyword(candidate, BRIEFING_KEYWORDS) for candidate in title_or_heading_candidates if candidate)
    if title_hit:
        return True

    text = str(row.get("text", "") or "")
    head = text[:head_text_limit]
    return has_keyword(head, BRIEFING_KEYWORDS)


def chunk_score(row: Dict[str, Any], head_text_limit: int) -> int:
    if row.get("chunk_type") == "disclaimer":
        return -999

    score = 0
    text = str(row.get("text", "") or "")
    head = text[:head_text_limit]
    section_title = str(row.get("section_title") or "")
    chunk_type = str(row.get("chunk_type") or "")
    sequence = int(row.get("sequence") or 9999)
    char_length = int(row.get("char_length") or len(text))

    if chunk_type == "analysis":
        score += 5
    elif chunk_type == "table":
        score += 1

    if is_summary_chunk(row, head_text_limit):
        score += 8
    elif is_briefing_relevant_chunk(row, head_text_limit):
        score += 5

    if sequence <= 2:
        score += 2
    elif sequence <= 4:
        score += 1

    if 250 <= char_length <= 2200:
        score += 2
    elif char_length > 2200:
        score += 1

    lower_title = normalized(section_title)
    for keyword in [
        "summary",
        "요약",
        "결론",
        "시사점",
        "전망",
        "전략",
        "morning letter",
        "daily",
        "weekly",
        "comment",
        "spot brief",
        "market",
        "macro",
    ]:
        if keyword in lower_title:
            score += 2

    return score


def select_briefing_rows(rows: List[Dict[str, Any]], head_text_limit: int, min_chunks: int, max_chunks: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    scored_rows = []
    for row in rows:
        score = chunk_score(row, head_text_limit)
        if score <= 0:
            continue
        row_copy = dict(row)
        row_copy["_score"] = score
        scored_rows.append(row_copy)

    if not scored_rows:
        return [], []

    scored_rows.sort(
        key=lambda row: (
            int(row.get("_score", 0)),
            1 if row.get("chunk_type") == "analysis" else 0,
            int(row.get("char_length") or 0),
        ),
        reverse=True,
    )

    selected: List[Dict[str, Any]] = []
    selected_ids = set()

    # 1차: 리포트별 대표 청크 1개씩 확보
    best_by_report: Dict[str, Dict[str, Any]] = {}
    for row in scored_rows:
        report_id = str(row.get("report_id") or row.get("chunk_id"))
        if report_id not in best_by_report:
            best_by_report[report_id] = row

    for row in sorted(best_by_report.values(), key=lambda r: int(r.get("_score", 0)), reverse=True):
        if len(selected) >= max_chunks:
            break
        chunk_id = row.get("chunk_id")
        if chunk_id in selected_ids:
            continue
        selected.append(row)
        selected_ids.add(chunk_id)

    # 2차: 목표 개수까지 점수순으로 채움
    if len(selected) < min_chunks:
        for row in scored_rows:
            if len(selected) >= max_chunks:
                break
            chunk_id = row.get("chunk_id")
            if chunk_id in selected_ids:
                continue
            selected.append(row)
            selected_ids.add(chunk_id)
            if len(selected) >= min_chunks:
                break

    # 3차: min_chunks를 넘겨도 max_chunks 범위 내에서 더 채우고 싶다면 score 높은 순 유지
    if len(selected) < max_chunks:
        for row in scored_rows:
            if len(selected) >= max_chunks:
                break
            chunk_id = row.get("chunk_id")
            if chunk_id in selected_ids:
                continue
            selected.append(row)
            selected_ids.add(chunk_id)

    return selected[:max_chunks], scored_rows


def iter_jsonl(file_path: Path) -> Iterable[Dict[str, Any]]:
    with file_path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"JSONL 파싱 실패: {file_path}:{line_number} - {exc}") from exc
            if not isinstance(obj, dict):
                continue
            yield obj


def build_chunk_separator(index: int, row: Dict[str, Any]) -> str:
    metadata = row_to_metadata(row)
    report_id = metadata.get("report_id") or f"unknown_{index}"
    heading = metadata.get("heading") or metadata.get("title") or "제목 없음"
    broker = metadata.get("broker") or "증권사 미상"
    category = metadata.get("category") or "카테고리 미상"
    page_start = metadata.get("page_start")
    page_end = metadata.get("page_end")

    page_label = ""
    if page_start and page_end:
      page_label = f" / page {page_start}-{page_end}"
    elif page_start:
      page_label = f" / page {page_start}"

    return (
        f"\n\n===== CHUNK {index} | {report_id} | {broker} | {category}{page_label} =====\n"
        f"SECTION: {heading}\n"
    )


def merge_chunks(rows: List[Dict[str, Any]]) -> str:
    merged_parts: List[str] = []
    for index, row in enumerate(rows, start=1):
        separator = build_chunk_separator(index, row)
        text = str(row.get("text", "") or "").strip()
        merged_parts.append(separator + text)
    return "\n".join(merged_parts).strip()


def resolve_model_name(client: genai.Client, requested_model: str) -> str:
    try:
        available = {
            model.name.replace("models/", ""): model.name
            for model in client.models.list()
            if (
                "generateContent" in (getattr(model, "supported_actions", []) or [])
                or "generateContent" in (getattr(model, "supported_generation_methods", []) or [])
            )
        }
    except Exception:
        return requested_model

    if requested_model in available:
        return requested_model

    fallbacks = [
        "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-2.0-flash",
    ]
    for fallback in fallbacks:
        if fallback in available:
            return fallback

    return requested_model


def call_gemini(client: genai.Client, model_name: str, prompt: str, merged_text: str) -> Tuple[str, str]:
    resolved_model = resolve_model_name(client, model_name)
    final_prompt = (
        f"{prompt}\n\n"
        "출력 형식은 마크다운으로 해주세요.\n"
        "가급적 아래 섹션을 포함해 주세요:\n"
        "- 이번 주 핵심 변화\n"
        "- 3-6개월 핵심 시나리오 트리\n"
        "- 6개월 촉매 일정\n"
        "- 거시경제\n"
        "- 주요 섹터 동향\n"
        "- 포트폴리오 관점 시사점\n"
        "- 체크포인트\n\n"
        "특히 아래 두 섹션은 가능한 한 정확히 이 형식을 지켜 주세요.\n"
        "## 3-6개월 핵심 시나리오 트리\n"
        "- Main Scenario (확률 xx%)\n"
        "  - 전개: 향후 3~6개월 기본 경로\n"
        "  - 대응: 포트폴리오 대응\n"
        "  - 체크포인트: 확인할 지표/조건\n"
        "- Risk Scenario (확률 xx%)\n"
        "  - 전개: 예상이 틀릴 때의 리스크 경로\n"
        "  - 대응: Plan B 대응\n"
        "  - 체크포인트: 확인할 지표/조건\n\n"
        "## 6개월 촉매 일정\n"
        "- [섹터/종목] 예상 시기 / 이벤트 / 왜 중요한지\n"
        "- 최대 6개만, 날짜가 모호하면 분기/월/몇 주 내처럼 근사 시기를 적어 주세요.\n\n"
        "시나리오는 반드시 2개만 제시하고, 확률 합은 100이 되게 맞춰 주세요.\n\n"
        "아래는 여러 리포트에서 추출한 핵심 분석/전망/시사점 청크 원문입니다.\n"
        f"{merged_text}"
    )

    response = client.models.generate_content(
        model=resolved_model,
        contents=final_prompt,
    )

    if not getattr(response, "text", None):
        raise RuntimeError("Gemini 응답에 text가 없습니다.")

    return response.text.strip(), resolved_model


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    project_root = Path(__file__).resolve().parent.parent

    if not input_path.exists():
        raise FileNotFoundError(f"입력 파일이 없습니다: {input_path}")

    api_key = load_api_key(project_root)
    client = create_client(api_key)

    rows = list(iter_jsonl(input_path))
    selected_rows, scored_rows = select_briefing_rows(
        rows=rows,
        head_text_limit=args.head_text_limit,
        min_chunks=args.min_chunks,
        max_chunks=args.max_chunks,
    )
    if not selected_rows:
        raise RuntimeError("브리핑에 활용할 만한 청크를 찾지 못했습니다.")

    merged_text = merge_chunks(selected_rows)

    gemini_output, resolved_model = call_gemini(
        client=client,
        model_name=args.model,
        prompt=args.prompt,
        merged_text=merged_text,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(gemini_output + "\n", encoding="utf-8")

    report_coverage = len({str(row.get("report_id") or row.get("chunk_id")) for row in selected_rows})
    meta_path = output_path.with_suffix(output_path.suffix + ".meta.json")
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "run_date": args.run_date,
        "effective_market_date": args.effective_market_date,
        "input_path": str(input_path),
        "output_path": str(output_path),
        "model": resolved_model,
        "requested_model": args.model,
        "prompt": args.prompt,
        "summary_chunk_count": len([row for row in rows if is_summary_chunk(row, args.head_text_limit)]),
        "briefing_candidate_count": len(scored_rows),
        "selected_chunk_count": len(selected_rows),
        "selected_report_count": report_coverage,
        "merged_text_char_length": len(merged_text),
        "summary_keywords": SUMMARY_KEYWORDS,
        "briefing_keywords": BRIEFING_KEYWORDS,
        "selection_strategy": "one-best-per-report-first-then-fill-by-score",
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ Gemini 브리핑 저장 완료: {output_path}")
    print(f"🧾 메타 저장 완료: {meta_path}")
    print(f"📦 요약 청크 수: {meta['summary_chunk_count']}")
    print(f"🧠 브리핑 후보 청크 수: {len(scored_rows)} (사용: {len(selected_rows)} / 리포트 {report_coverage}개)")


if __name__ == "__main__":
    main()
