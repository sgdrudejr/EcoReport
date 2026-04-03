#!/usr/bin/env python3
"""
build_deep_research_prompt.py
포트폴리오 테마 기반 ChatGPT Deep Research 프롬프트 생성 (주간/월간).

출력: knowledge/weekly/YYYY-MM-DD-deep-research-prompt.md

사용법:
  python scripts/build_deep_research_prompt.py --date 2026-04-03
"""

import argparse
import json
from datetime import date as date_type, datetime, timedelta
from pathlib import Path

PILOT_ROOT = Path(__file__).resolve().parent.parent
IGZUN_ROOT = Path("/Users/seo/igzun-daily-report")


def load_portfolio() -> dict:
    p = IGZUN_ROOT / "data" / "portfolio_state.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def load_recent_insights(date: str, days: int = 7) -> list[dict]:
    """최근 N일 llm_insights 로드."""
    end = datetime.strptime(date, "%Y-%m-%d").date()
    insights = []
    for d in range(days):
        check = (end - timedelta(days=d)).strftime("%Y-%m-%d")
        p = IGZUN_ROOT / "data" / "llm_insights" / f"{check}.json"
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                data["_date"] = check
                insights.append(data)
            except Exception:
                pass
    return insights


def extract_themes(portfolio: dict) -> dict[str, list[str]]:
    """계좌별 보유 종목 테마 추출."""
    themes: dict[str, list[str]] = {}
    for acct_key, acct in portfolio.get("accounts", {}).items():
        holdings = acct.get("holdings", [])
        if holdings:
            themes[acct_key] = [
                h.get("name", h.get("code", "")) for h in holdings
            ]
        else:
            themes[acct_key] = [f"현금 {acct.get('cash', 0):,}원 (미투자)"]
    return themes


def summarize_weekly_regime(insights: list[dict]) -> str:
    if not insights:
        return "주간 데이터 없음"
    lines = []
    for ins in insights[:5]:
        d = ins.get("_date", "")
        score = ins.get("overall_score", ins.get("score", "N/A"))
        regime = ins.get("regime", ins.get("macro_regime", "N/A"))
        lines.append(f"- {d}: {regime} (score {score})")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Build Deep Research prompt (weekly/monthly)")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    parser.add_argument("--mode", choices=["weekly", "monthly"], default="weekly")
    args = parser.parse_args()
    date = args.date

    portfolio = load_portfolio()
    profile = portfolio.get("investment_profile", {})
    themes = extract_themes(portfolio)
    days = 7 if args.mode == "weekly" else 30
    insights = load_recent_insights(date, days)
    regime_summary = summarize_weekly_regime(insights)

    # 테마 섹션
    theme_lines = []
    for acct, names in themes.items():
        theme_lines.append(f"- {acct}: {', '.join(names)}")
    theme_section = "\n".join(theme_lines) if theme_lines else "- 보유 포지션 없음 (전액 현금)"

    # 레짐 트렌드
    latest = insights[0] if insights else {}
    current_score = latest.get("overall_score", latest.get("score", "N/A"))
    current_regime = latest.get("regime", latest.get("macro_regime", "N/A"))

    prompt = f"""# Deep Research 요청 ({args.mode})

날짜: {date}
분석 기간: 최근 {days}일

---

## 내 포트폴리오 핵심 테마
{theme_section}

투자 스타일: {profile.get('style', 'N/A')} | 기간: {profile.get('horizon', 'N/A')} | 리스크: {profile.get('risk_tolerance', 'N/A')}

---

## 최근 {days}일 레짐 트렌드
{regime_summary}

**현재**: {current_regime} (스코어: {current_score}/100)

---

## 연구 요청 항목

### 1. 현재 매크로 레짐 진단
- Risk-On / Risk-Off 상태
- 금리 방향 (단기/장기 스프레드)
- 달러 강도 (DXY 트렌드)
- 인플레이션 압력 수준

### 2. 내 보유 테마별 현재 상태 및 3개월 전망
각 테마/섹터별:
- 현재 상태 (3줄 이내)
- 3개월 전망 (방향 + 이유)
- 내 계좌에 미치는 영향

### 3. 현재 주목해야 할 섹터/테마 (내가 미보유)
- 지금 진입 고려할 만한 섹터/ETF 3개
- 각각 진입 근거와 리스크

### 4. 내 포트폴리오 전반의 주요 리스크 요인
- 단기 (1개월): 가장 큰 위험 요소
- 중기 (3-6개월): 구조적 리스크
- 헷지 방안

### 5. 계좌별 권장 액션
- ISA:
- PENSION:
- TOSS:

---

## 출력 형식

섹터/테마별로 아래 구조로 작성해주세요:
- **현재 상태** (3줄 이내)
- **3개월 전망** (방향 + 이유)
- **내 계좌에 미치는 영향**
- **권장 액션** (보강/보류/분할매수/관망/편출)

마지막에 **이번 주 실행 체크리스트**를 3개 이내로 요약해주세요.
"""

    out_dir = PILOT_ROOT / "knowledge" / "weekly"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-deep-research-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")
    print(str(out_file))


if __name__ == "__main__":
    main()
