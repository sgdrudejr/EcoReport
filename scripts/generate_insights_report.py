#!/usr/bin/env python3
"""
generate_insights_report.py
structured_analysis.json + deep_research_output.md → insights_report.md 생성

사용법:
  python scripts/generate_insights_report.py --date 2026-04-15
  python scripts/generate_insights_report.py  # 오늘 날짜 자동 사용
"""
from __future__ import annotations

import argparse
import json
from datetime import date as date_type
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports" / "merged"


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def render_structured_analysis(analysis: dict) -> str:
    lines = ["## 📊 구조화 분석 요약"]

    consensus = analysis.get("consensus", [])
    if consensus:
        lines.append("\n### 컨센서스")
        for item in consensus[:5]:
            rate = item.get("agreement_rate", 0)
            pct = f"{int(rate * 100)}%" if isinstance(rate, (int, float)) else str(rate)
            lines.append(f"- **{item.get('theme', '')}** ({pct}): {item.get('evidence', '')}")

    minority = analysis.get("minority_views", [])
    if minority:
        lines.append("\n### 소수 의견")
        for item in minority[:4]:
            rate = item.get("agreement_rate", 0)
            pct = f"{int(rate * 100)}%" if isinstance(rate, (int, float)) else str(rate)
            lines.append(
                f"- **{item.get('theme', '')}** ({pct}): {item.get('rationale', '')} "
                f"— {item.get('why_worth_noting', '')}"
            )

    contradictions = analysis.get("contradictions", [])
    if contradictions:
        lines.append("\n### 모순·충돌")
        for item in contradictions[:5]:
            bull = item.get("bullish", {})
            bear = item.get("bearish", {})
            lines.append(
                f"- **{item.get('topic', '')}**: "
                f"{bull.get('publisher', '')}(매수) vs {bear.get('publisher', '')}(주의)"
            )

    cross = analysis.get("cross_category_signals", [])
    if cross:
        lines.append("\n### 크로스카테고리 신호")
        for item in cross[:5]:
            sectors = ", ".join(item.get("sector_beneficiary", []))
            companies = ", ".join(item.get("company_plays", []))
            lines.append(
                f"- **{item.get('signal', '')}** → {item.get('macro_implication', '')} "
                f"| 수혜: {sectors or '-'} / {companies or '-'}"
            )

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate insights_report.md from structured_analysis + deep_research_output")
    parser.add_argument("--date", default=str(date_type.today()))
    parser.add_argument("--output-dir", default=None, help="Output directory (default: reports/merged)")
    args = parser.parse_args()

    out_dir = Path(args.output_dir) if args.output_dir else REPORTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    structured_path = out_dir / "structured_analysis.json"
    deep_research_path = out_dir / "deep_research_output.md"
    out_path = out_dir / "insights_report.md"

    raw = load_json(structured_path)
    analysis = raw.get("analysis", raw)
    meta = raw.get("meta", {})
    deep_research_text = load_text(deep_research_path)

    structured_section = render_structured_analysis(analysis) if analysis else "structured_analysis.json 없음"

    parts = [
        f"# {args.date} 인사이트 리포트",
        f"\n생성 시각: {meta.get('generated_at', '-')} | 모델: {meta.get('model', '-')}",
        "",
        structured_section,
    ]

    if deep_research_text:
        parts += [
            "",
            "---",
            "",
            "## 🔬 Gemini 딥리서치 결과",
            "",
            deep_research_text,
        ]
    else:
        parts += [
            "",
            "---",
            "",
            "> **딥리서치 결과 없음** — `reports/merged/deep_research_output.md`에 Gemini 딥리서치 결과를 붙여넣은 후 다시 실행하세요.",
            "",
            f"딥리서치 프롬프트 위치: `reports/merged/deep_research_prompt.md`",
        ]

    content = "\n".join(parts) + "\n"
    out_path.write_text(content, encoding="utf-8")
    print(f"✅ {out_path}")

    if not deep_research_text:
        print(f"⚠️  딥리서치 결과 없음: {deep_research_path}")
        print("   1. reports/merged/deep_research_prompt.md 내용을 복사")
        print("   2. Gemini 웹(gemini.google.com)에서 딥리서치 실행")
        print(f"   3. 결과를 {deep_research_path} 에 저장")
        print("   4. 이 스크립트를 다시 실행")


if __name__ == "__main__":
    main()
