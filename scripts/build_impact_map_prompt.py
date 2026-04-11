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

ROOT = Path(__file__).resolve().parent.parent


# ── 데이터 로더 ──────────────────────────────────────────────────────────────

def load_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_portfolio() -> dict:
    """data/portfolio/latest.json 로드."""
    return load_json(ROOT / "data" / "portfolio" / "latest.json") or {}


def get_accounts_dict(portfolio: dict) -> dict:
    accounts = portfolio.get("accounts", {})
    if isinstance(accounts, list):
        return {a.get("key", a.get("label", str(i))): a for i, a in enumerate(accounts)}
    return accounts


def get_cash(account: dict) -> int:
    return int(account.get("cashAvailable", account.get("cash", account.get("availableCash", 0))))


def load_quant_scores(date: str) -> "dict | None":
    """stage3-quant-scores.json에서 인사이트 호환 데이터 반환."""
    path = ROOT / "data" / "analysis-state" / date / "stage3-quant-scores.json"
    data = load_json(path)
    if not data:
        return None
    regime_obj  = data.get("regime", {})
    regime_name = regime_obj.get("name", "N/A") if isinstance(regime_obj, dict) else str(regime_obj)
    leading     = data.get("leadingIndicator", {})
    score       = round(float(leading.get("score", data.get("portfolioScore", 50))), 1)

    # signals → recommendations 형식으로 변환
    raw_holdings = data.get("holdings", [])
    if isinstance(raw_holdings, dict):
        holdings_iter = raw_holdings.values()
    elif isinstance(raw_holdings, list):
        holdings_iter = raw_holdings
    else:
        holdings_iter = []

    recs = {}
    for h in holdings_iter:
        if not isinstance(h, dict):
            continue
        code   = h.get("code", "")
        signal = h.get("signal", h.get("action", ""))
        s      = h.get("actionScore", h.get("score", "N/A"))
        if code:
            recs[code] = {"action": signal, "score": s, "name": h.get("name", "")}

    return {
        "overall_score": score,
        "regime": regime_name,
        "recommendations": recs,
    }


def load_marketvoice(date: str) -> "dict | None":
    path = ROOT / "data" / "analysis-state" / date / "marketvoice-linked.json"
    return load_json(path)


def find_manual_summary(date: str) -> "str | None":
    """knowledge/daily/ 에서 브리핑/synthesis md 파일 탐색 (프롬프트 파일 제외)."""
    daily_dir = ROOT / "knowledge" / "daily"
    if not daily_dir.exists():
        return None
    for suffix in ("-synthesis.md", "-briefing.md", "-advisory.md", "-summary.md"):
        p = daily_dir / f"{date}{suffix}"
        if p.exists():
            return p.read_text(encoding="utf-8")
    for c in sorted(daily_dir.glob(f"{date}*.md")):
        if "prompt" not in c.name:
            return c.read_text(encoding="utf-8")
    return None


def format_marketvoice_block(marketvoice: "dict | None") -> str:
    if not marketvoice:
        return "### 머니토링 실시간 시황 없음"

    summary = (marketvoice.get("summary") or {}).get("overview") or "요약 없음"
    lines = [f"### 머니토링 실시간 시황/이벤트 레이어\n- {summary}"]

    for topic in (marketvoice.get("topics") or [])[:5]:
        title = topic.get("title", "제목 없음")
        linkage = topic.get("portfolioLinkage") or topic.get("summary") or "연결 설명 없음"
        score = topic.get("relevanceScore", 0)
        lines.append(f"- [{score}점] {title} / {linkage}")

    candidates = (marketvoice.get("deepResearchCandidates") or [])[:3]
    if candidates:
        lines.append("- 딥리서치 후보")
        for item in candidates:
            lines.append(
                f"  - {item.get('title', '주제 없음')} / 질문: {item.get('question', '추가 확인 필요')}"
            )

    return "\n".join(lines)


# ── 섹션 포매터 ───────────────────────────────────────────────────────────────

def format_holdings_section(portfolio: dict) -> str:
    accounts = get_accounts_dict(portfolio)
    lines = []
    for acct_key, acct in accounts.items():
        label    = acct.get("label", acct_key)
        holdings = acct.get("holdings", [])
        cash     = get_cash(acct)
        lines.append(f"\n### {label} ({acct_key})")
        if holdings:
            for h in holdings:
                code    = h.get("code", "")
                name    = h.get("name", "")
                qty     = h.get("quantity", h.get("qty", ""))
                pnl_pct = h.get("profitRate", h.get("pnl_pct", ""))
                pnl_str = f" ({float(pnl_pct):+.2f}%)" if isinstance(pnl_pct, (int, float)) else ""
                lines.append(f"- {code} {name} (보유 {qty}주{pnl_str})")
        else:
            lines.append(f"- 현금 {cash:,}원 (미투자)")
    return "\n".join(lines)


def build_prompt(date: str, portfolio: dict, insights: "dict | None", summary: "str | None", marketvoice: "dict | None") -> str:
    holdings_section = format_holdings_section(portfolio)

    if insights:
        score   = insights.get("overall_score", "N/A")
        regime  = insights.get("regime", "N/A")
        recs    = insights.get("recommendations", {})
        rec_lines = []
        for code, info in list(recs.items())[:10]:
            name   = info.get("name", code)
            action = info.get("action", "")
            s      = info.get("score", "N/A")
            rec_lines.append(f"  - {code} {name}: {action} (score: {s})")
        recs_str     = "\n".join(rec_lines) if rec_lines else "  (없음)"
        insights_block = f"""### EcoReport Quant 분석 스냅샷 ({date})
- 레짐: {regime}
- 종합 스코어: {score}/100
- 주요 종목 신호:
{recs_str}"""
    else:
        insights_block = f"### Quant 분석 없음 ({date})\n- stage3 미실행 또는 파일 없음"

    if summary:
        trimmed       = summary[:3000] + ("\n...(이하 생략)" if len(summary) > 3000 else "")
        summary_block = f"### 오늘의 종합 브리핑 요약\n\n{trimmed}"
    else:
        summary_block = "### 오늘의 브리핑 없음"

    marketvoice_block = format_marketvoice_block(marketvoice)

    return f"""# EcoReport Impact Mapping 요청

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

{marketvoice_block}

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
        "targetCode": "종목코드 또는 계좌키(ISA/TOSS/PENSION/KIS_MAIN)",
        "accountKey": "ISA|TOSS|PENSION|KIS_MAIN",
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


def main():
    parser = argparse.ArgumentParser(description="Build impact-map prompt for GPT")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    args = parser.parse_args()
    date = args.date

    portfolio = load_portfolio()
    insights  = load_quant_scores(date)
    summary   = find_manual_summary(date)
    marketvoice = load_marketvoice(date)

    if not portfolio:
        print("[warn] data/portfolio/latest.json 없음 — 포트폴리오 섹션 빈칸으로 생성", file=sys.stderr)

    prompt = build_prompt(date, portfolio, insights, summary, marketvoice)

    out_dir  = ROOT / "knowledge" / "daily"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-impact-map-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")
    print(str(out_file))


if __name__ == "__main__":
    main()
