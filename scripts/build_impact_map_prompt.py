#!/usr/bin/env python3
"""
build_impact_map_prompt.py
LLM 인사이트 + 포트폴리오 현황을 읽어서
"각 리포트가 내 보유 종목에 어떤 영향인지 매핑"하는 GPT 프롬프트를 생성한다.

출력: knowledge/daily/YYYY-MM-DD-impact-map-prompt.md

사용법:
  python scripts/build_impact_map_prompt.py --date 2026-04-03
"""

import argparse
import json
import sys
from datetime import date as date_type
from pathlib import Path

PILOT_ROOT = Path(__file__).resolve().parent.parent
IGZUN_ROOT = Path("/Users/seo/igzun-daily-report")


def load_portfolio() -> dict:
    p = IGZUN_ROOT / "data" / "portfolio_state.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def load_llm_insights(date: str) -> dict | None:
    p = IGZUN_ROOT / "data" / "llm_insights" / f"{date}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def load_manual_summary(date: str) -> str | None:
    p = IGZUN_ROOT / "data" / "manual_summary" / f"{date}.md"
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8")


def format_holdings_section(portfolio: dict) -> str:
    accounts = portfolio.get("accounts", {})
    lines = []
    for acct_key, acct in accounts.items():
        label = acct.get("label", acct_key)
        holdings = acct.get("holdings", [])
        cash = acct.get("cash", 0)
        lines.append(f"\n### {label} ({acct_key})")
        if holdings:
            for h in holdings:
                code = h.get("code", "")
                name = h.get("name", "")
                qty = h.get("qty", h.get("quantity", ""))
                chg = h.get("change_pct", h.get("pnl_pct", ""))
                chg_str = f" ({chg:+.2f}%)" if isinstance(chg, (int, float)) else ""
                lines.append(f"- {code} {name} (보유 {qty}주{chg_str})")
        else:
            lines.append(f"- 현금 {cash:,}원 (미투자)")
    return "\n".join(lines)


def build_prompt(date: str, portfolio: dict, insights: dict | None, summary: str | None) -> str:
    holdings_section = format_holdings_section(portfolio)

    # 오늘 리포트 요약 섹션
    if insights:
        score = insights.get("overall_score", insights.get("score", "N/A"))
        regime = insights.get("regime", insights.get("macro_regime", "N/A"))
        recommendations = insights.get("recommendations", insights.get("etf_scores", {}))
        rec_lines = []
        if isinstance(recommendations, dict):
            for ticker, info in list(recommendations.items())[:10]:
                if isinstance(info, dict):
                    rec_lines.append(f"  - {ticker}: {info.get('action', info.get('signal', ''))} "
                                     f"(score: {info.get('score', 'N/A')})")
                else:
                    rec_lines.append(f"  - {ticker}: {info}")
        recs_str = "\n".join(rec_lines) if rec_lines else "  (없음)"
        insights_block = f"""### LLM 분석 스냅샷 ({date})
- 레짐: {regime}
- 종합 스코어: {score}/100
- 주요 ETF 권고:
{recs_str}"""
    else:
        insights_block = f"### LLM 인사이트 없음 ({date})\n- 분석 미실행 또는 파일 없음"

    # manual_summary 요약본 (너무 길면 앞부분만)
    if summary:
        summary_trimmed = summary[:3000] + ("\n...(이하 생략)" if len(summary) > 3000 else "")
        summary_block = f"### 오늘의 종합 브리핑 요약\n\n{summary_trimmed}"
    else:
        summary_block = "### 오늘의 브리핑 없음"

    prompt = f"""# EcoReport Impact Mapping 요청

날짜: {date}

---

## 내 현재 보유 계좌/종목
{holdings_section}

---

## 오늘 분석 요약

{insights_block}

---

{summary_block}

---

## 요청

위 리포트/분석 내용이 내 보유 종목/계좌에 어떤 영향을 주는지
아래 JSON 형식으로만 출력하세요.

보유 종목이 없는 계좌는 현금 배치 관점에서 분석해주세요.
관련 없는 경우 impacts 배열을 비워두세요.

```json
[
  {{
    "reportId": "report_001",
    "title": "리포트 제목 또는 주제",
    "impacts": [
      {{
        "targetType": "holding|cash|account",
        "targetCode": "종목코드 또는 계좌키(ISA/TOSS/PENSION)",
        "accountKey": "ISA|TOSS|PENSION",
        "direction": "positive|negative|neutral",
        "horizon": "1d|1w|1m|3m|6m",
        "strength": 0.0,
        "reason": "영향 이유 (2줄 이내)"
      }}
    ]
  }}
]
```

반드시 유효한 JSON 배열만 출력하세요. 설명 텍스트 없이 JSON만.
"""
    return prompt


def main():
    parser = argparse.ArgumentParser(description="Build impact-map prompt for GPT")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    args = parser.parse_args()
    date = args.date

    portfolio = load_portfolio()
    insights = load_llm_insights(date)
    summary = load_manual_summary(date)

    if not portfolio:
        print(f"[warn] portfolio_state.json not found", file=sys.stderr)

    prompt = build_prompt(date, portfolio, insights, summary)

    out_dir = PILOT_ROOT / "knowledge" / "daily"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-impact-map-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")

    print(str(out_file))


if __name__ == "__main__":
    main()
