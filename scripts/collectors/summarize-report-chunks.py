#!/usr/bin/env python3
"""Stage 1.4a: select top report_summaries and compact them for research agenda input.

Example:
  .venv/bin/python scripts/collectors/summarize-report-chunks.py --date 2026-04-22
  .venv/bin/python scripts/collectors/summarize-report-chunks.py --date 2026-04-22 --top-n 30

Notes:
  - This stage no longer re-summarizes chunks with another LLM by default.
  - It reuses the Windows local orchestrator output in reports/report_summaries/{date}/.
  - If local report summaries are missing, it writes an empty artifact so Stage 1.4b can
    fall back to stage1 extracts without blocking the pipeline.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from lib.env_loader import load_simple_dotenv


DEFAULT_OUTPUT_NAME = "stage1-chunk-summaries.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage 1.4a top report summary selector")
    parser.add_argument("--date", required=True, help="대상 날짜 (YYYY-MM-DD)")
    parser.add_argument("--run-date", default=None, help="실행일 (YYYY-MM-DD) - 호환용")
    parser.add_argument("--effective-market-date", default=None, help="기준 거래일 (YYYY-MM-DD) - 호환용")
    parser.add_argument("--run-id", default=None, help="run id - 호환용")
    parser.add_argument("--top-n", type=int, default=30, help="우선순위 상위 리포트 개수")
    parser.add_argument("--report-char-limit", type=int, default=400, help="리포트 병합 요약 최대 글자 수")
    parser.add_argument("--output", default=None, help="출력 경로")
    parser.add_argument("--concurrency", type=int, default=0, help="하위 호환용 (사용 안 함)")
    parser.add_argument(
        "--provider",
        default="local",
        help="하위 호환용 (사용 안 함, report_summaries 재사용)",
    )
    parser.add_argument("--model", default=None, help="하위 호환용 (사용 안 함)")
    parser.add_argument("--chunk-char-limit", type=int, default=0, help="하위 호환용 (사용 안 함)")
    parser.add_argument("--max-chunks-per-report", type=int, default=0, help="하위 호환용 (사용 안 함)")
    return parser.parse_args()


def load_json(path: Path, fallback: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\n", " ").split()).strip()


def truncate_text(value: Any, limit: int) -> str:
    text = normalize_text(value)
    if len(text) <= limit:
        return text
    if limit <= 3:
        return text[:limit]
    return f"{text[: max(0, limit - 3)]}..."


def unique_nonempty(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = normalize_text(value)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


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
    scored: list[dict[str, Any]] = []
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

    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in scored:
        report_id = row["report_id"]
        if report_id in seen:
            continue
        seen.add(report_id)
        selected.append(row)
        if len(selected) >= top_n:
            break
    return selected


def build_company_names(report: dict[str, Any], limit: int = 3) -> str:
    names: list[str] = []
    for item in report.get("company_mentions") or []:
        if not isinstance(item, dict):
            continue
        name = normalize_text(item.get("name") or "")
        if name:
            names.append(name)
        if len(names) >= limit:
            break
    names = unique_nonempty(names)
    return ", ".join(names[:limit])


def compact_report_summary(report_payload: dict[str, Any], char_limit: int) -> str:
    report = report_payload.get("report") or {}
    parts: list[str] = []

    core_summary = truncate_text(report.get("core_summary") or "", 190)
    if core_summary:
        parts.append(core_summary)

    macro_view = unique_nonempty([truncate_text(item, 90) for item in (report.get("macro_view") or [])[:2]])
    if macro_view:
        parts.append(f"매크로: {' / '.join(macro_view)}")

    sector_view = unique_nonempty([truncate_text(item, 90) for item in (report.get("sector_view") or [])[:2]])
    if sector_view:
        parts.append(f"섹터: {' / '.join(sector_view)}")

    company_names = build_company_names(report, limit=3)
    if company_names:
        parts.append(f"관련 종목: {company_names}")

    merged = " ".join(unique_nonempty(parts))
    return truncate_text(merged, char_limit)


def empty_payload(date: str, reason: str, selected_reports: int) -> dict[str, Any]:
    return {
        "date": date,
        "model": "",
        "source": reason,
        "summaries": [],
        "stats": {
            "selected_report_count": selected_reports,
            "found_report_summary_count": 0,
            "missing_report_summary_count": selected_reports,
        },
    }


def main() -> None:
    args = parse_args()

    root = Path(os.getenv("ECOREPORT_ROOT") or Path(__file__).resolve().parents[2])
    env_path = root / ".env"
    if env_path.exists():
        load_simple_dotenv(env_path)

    state_dir = root / "data" / "analysis-state" / args.date
    extracts_path = state_dir / "stage1-report-extracts-v2.json"
    report_summaries_dir = root / "reports" / "report_summaries" / args.date
    output_path = Path(args.output) if args.output else state_dir / DEFAULT_OUTPUT_NAME

    if not extracts_path.exists():
        raise RuntimeError(f"Stage 1 추출 파일이 없습니다: {extracts_path}")

    stage1 = load_json(extracts_path, {})
    extracts = stage1.get("extracts") or []
    if not extracts:
        raise RuntimeError(f"extracts가 비어 있습니다: {extracts_path}")

    top_reports = select_top_reports(extracts, max(1, args.top_n))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not report_summaries_dir.exists():
        payload = empty_payload(args.date, "report_summaries_missing", len(top_reports))
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[warn] report_summaries 디렉터리가 없습니다: {report_summaries_dir}", file=sys.stderr)
        print(f"saved: {output_path}")
        print("selected_reports: 0")
        return

    summaries: list[dict[str, Any]] = []
    found_count = 0
    missing_count = 0
    detected_model = ""

    for meta in top_reports:
        report_id = meta["report_id"]
        report_path = report_summaries_dir / f"{report_id}.json"
        payload = load_json(report_path, None)
        if not isinstance(payload, dict):
            missing_count += 1
            continue

        report = payload.get("report") or {}
        file_meta = payload.get("meta") or {}
        compact = compact_report_summary(payload, max(120, args.report_char_limit))
        if not compact:
            missing_count += 1
            continue

        found_count += 1
        if not detected_model:
            detected_model = normalize_text(file_meta.get("model") or "")

        summaries.append(
            {
                "report_id": report_id,
                "title": report.get("report_title") or meta.get("title") or file_meta.get("report_title") or "",
                "broker": report.get("publisher") or meta.get("broker") or "",
                "sector": meta.get("sector") or "",
                "summary": compact,
                "priority_score": int(meta.get("priority_score") or 0),
            }
        )

    summaries.sort(key=lambda row: row.get("priority_score", 0), reverse=True)

    payload = {
        "date": args.date,
        "model": detected_model,
        "source": "report_summaries_local",
        "summaries": summaries,
        "stats": {
            "selected_report_count": len(top_reports),
            "found_report_summary_count": found_count,
            "missing_report_summary_count": missing_count,
        },
    }

    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"saved: {output_path}")
    print(f"selected_reports: {len(top_reports)}")
    print(f"found_report_summaries: {found_count}")
    print(f"missing_report_summaries: {missing_count}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"stage1.4 summarize 실패: {exc}", file=sys.stderr)
        sys.exit(1)
