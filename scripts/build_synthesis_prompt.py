#!/usr/bin/env python3
"""
build_synthesis_prompt.py
coverage-gap + impact-map 컨텍스트를 포함한 synthesis GPT 프롬프트 생성.

출력: knowledge/daily/YYYY-MM-DD-synthesis-prompt.md

사용법:
  python scripts/build_synthesis_prompt.py --date 2026-04-03
"""

import argparse
import json
from datetime import date as date_type
from pathlib import Path

PILOT_ROOT = Path(__file__).resolve().parent.parent
IGZUN_ROOT = Path("/Users/seo/igzun-daily-report")


def load_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_text(path: Path) -> str | None:
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def format_coverage_gap_section(gap: dict) -> str:
    if not gap:
        return ""
    no_reports = gap.get("holdings_with_no_recent_reports", [])
    if not no_reports:
        return "## ✅ 커버리지 갭 없음\n모든 보유 종목에 최근 리포트 있음.\n"

    lines = [f"## ⚠️ 커버리지 갭 (보유 중이지만 최근 {gap.get('scan_days', 30)}일 리포트 없는 종목)"]
    for h in no_reports:
        lines.append(f"- {h['code']} {h['name']} ({h['accountKey']}) — {h['alert']}")
    lines.append("\n위 종목들은 정보 부족 상태입니다. synthesis 시 주의해서 다루세요.")
    return "\n".join(lines)


def format_impact_map_section(impact_map_path: Path) -> str:
    content = load_text(impact_map_path)
    if not content:
        return ""
    # impact-map.json이 있으면 사용, 없으면 prompt.md 참조 안내
    return f"## 리포트-계좌 영향 매핑 (impact-map)\n\n{content[:2000]}"


def main():
    parser = argparse.ArgumentParser(description="Build synthesis prompt")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    args = parser.parse_args()
    date = args.date

    # 데이터 로드
    insights = load_json(IGZUN_ROOT / "data" / "llm_insights" / f"{date}.json")
    manual_summary = load_text(IGZUN_ROOT / "data" / "manual_summary" / f"{date}.md")
    coverage_gap = load_json(PILOT_ROOT / "data" / "technical" / f"{date}-coverage-gap.json")
    impact_map_file = PILOT_ROOT / "data" / "reports" / date / "impact-map.json"
    portfolio = load_json(IGZUN_ROOT / "data" / "portfolio_state.json") or {}

    # 섹션 빌드
    coverage_section = format_coverage_gap_section(coverage_gap) if coverage_gap else (
        "_coverage-gap 미실행. 먼저 build_coverage_gap_report.py를 실행하세요._\n"
    )
    impact_section = format_impact_map_section(impact_map_file)

    # 포트폴리오 컨텍스트
    profile = portfolio.get("investment_profile", {})
    accounts_summary = []
    for k, v in portfolio.get("accounts", {}).items():
        holdings = v.get("holdings", [])
        cash = v.get("cash", 0)
        if holdings:
            names = ", ".join(h.get("name", h.get("code", "")) for h in holdings)
            accounts_summary.append(f"- {k}: {names}")
        else:
            accounts_summary.append(f"- {k}: 현금 {cash:,}원 (미투자)")
    portfolio_section = "\n".join(accounts_summary) if accounts_summary else "- 포트폴리오 정보 없음"

    # 오늘 데이터 섹션
    if insights:
        score = insights.get("overall_score", insights.get("score", "N/A"))
        regime = insights.get("regime", insights.get("macro_regime", "N/A"))
        insights_str = f"레짐: {regime} | 스코어: {score}/100"
    else:
        insights_str = "LLM 인사이트 없음"

    summary_block = (manual_summary[:3000] + "...(생략)") if manual_summary and len(manual_summary) > 3000 else (manual_summary or "_manual summary 없음_")

    prompt = f"""# EcoReport Synthesis 요청

날짜: {date}

---

## 내 포트폴리오 현황
{portfolio_section}

투자 스타일: {profile.get('style', 'N/A')} | 기간: {profile.get('horizon', 'N/A')} | 리스크: {profile.get('risk_tolerance', 'N/A')}

---

{coverage_section}

---

{impact_section if impact_section else "## Impact Map\n_impact-map 미실행 또는 데이터 없음_"}

---

## 오늘의 시장 분석 요약

**{insights_str}**

{summary_block}

---

## Synthesis 요청

위 모든 정보를 종합해서 아래 구조로 synthesis를 작성해주세요:

### 1. 오늘의 시장 핵심 메시지 (3줄 이내)

### 2. 내 포트폴리오별 영향 분석
각 계좌(ISA / PENSION / TOSS)별로:
- 현재 포지션에 미치는 영향
- 권장 액션 (매수/보류/관망/리밸런싱)

### 3. 커버리지 갭 종목 처리 방안
(리포트 없는 종목이 있다면 어떻게 다룰지)

### 4. 내일 주목할 이벤트/지표

### 5. 분할매수 실행 가이드 (있다면)
- 대상 종목/ETF
- 추천 비중
- 진입 조건
"""

    out_dir = PILOT_ROOT / "knowledge" / "daily"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-synthesis-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")
    print(str(out_file))


if __name__ == "__main__":
    main()
