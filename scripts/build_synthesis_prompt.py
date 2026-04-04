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

ROOT = Path(__file__).resolve().parent.parent


# ── 데이터 로더 ──────────────────────────────────────────────────────────────

def load_json(path: Path) -> "dict | list | None":
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_text(path: Path) -> "str | None":
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def load_portfolio() -> dict:
    """data/portfolio/latest.json 로드."""
    return load_json(ROOT / "data" / "portfolio" / "latest.json") or {}


def get_accounts_dict(portfolio: dict) -> dict:
    """accounts가 list든 dict든 {key: account_data} dict로 정규화."""
    accounts = portfolio.get("accounts", {})
    if isinstance(accounts, list):
        return {a.get("key", a.get("label", str(i))): a for i, a in enumerate(accounts)}
    return accounts


def get_cash(account: dict) -> int:
    return int(account.get("cashAvailable", account.get("cash", account.get("availableCash", 0))))


def load_quant_scores(date: str) -> "dict | None":
    """stage3-quant-scores.json → 인사이트 호환 형식으로 반환."""
    path = ROOT / "data" / "analysis-state" / date / "stage3-quant-scores.json"
    data = load_json(path)
    if not data:
        return None
    regime_obj = data.get("regime", {})
    regime_name = regime_obj.get("name", "N/A") if isinstance(regime_obj, dict) else str(regime_obj)
    leading = data.get("leadingIndicator", {})
    return {
        "overall_score": round(float(leading.get("score", data.get("portfolioScore", 50))), 1),
        "regime": regime_name,
        "vix": leading.get("vix"),
        "t10y2y": leading.get("t10y2y"),
    }


def find_manual_summary(date: str) -> "str | None":
    """knowledge/daily/ 에서 날짜 기반 브리핑/synthesis md 파일 탐색 (프롬프트 파일 제외)."""
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


# ── 섹션 포매터 ───────────────────────────────────────────────────────────────

def format_coverage_gap_section(gap: dict) -> str:
    if not gap:
        return ""
    no_reports = gap.get("holdings_with_no_recent_reports", [])
    if not no_reports:
        return "## ✅ 커버리지 갭 없음\n모든 보유 종목에 최근 리포트 있음.\n"
    lines = [f"## ⚠️ 커버리지 갭 (최근 {gap.get('scan_days', 30)}일 리포트 없는 종목)"]
    for h in no_reports:
        lines.append(f"- {h['code']} {h['name']} ({h['accountKey']}) — {h['alert']}")
    lines.append("\n위 종목들은 정보 부족 상태입니다. synthesis 시 주의해서 다루세요.")
    return "\n".join(lines)


def format_impact_map_section(impact_map_path: Path) -> str:
    content = load_text(impact_map_path)
    if not content:
        return ""
    return f"## 리포트-계좌 영향 매핑 (impact-map)\n\n{content[:2000]}"


def main():
    parser = argparse.ArgumentParser(description="Build synthesis prompt")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    args = parser.parse_args()
    date = args.date

    portfolio       = load_portfolio()
    insights        = load_quant_scores(date)
    manual_summary  = find_manual_summary(date)
    coverage_gap    = load_json(ROOT / "data" / "technical" / f"{date}-coverage-gap.json")
    impact_map_file = ROOT / "data" / "analysis-state" / date / "impact-map.json"

    coverage_section = format_coverage_gap_section(coverage_gap) if coverage_gap else (
        "_coverage-gap 미실행. 먼저 build_coverage_gap_report.py를 실행하세요._\n"
    )
    impact_section = format_impact_map_section(impact_map_file)

    accounts = get_accounts_dict(portfolio)
    accounts_summary = []
    for k, v in accounts.items():
        holdings = v.get("holdings", [])
        cash = get_cash(v)
        label = v.get("label", k)
        if holdings:
            names = ", ".join(h.get("name", h.get("code", "")) for h in holdings)
            pnl = v.get("profitLoss", "")
            pnl_str = f" | 평가손익 {int(pnl):,}원" if isinstance(pnl, (int, float)) and pnl != 0 else ""
            accounts_summary.append(f"- {k} ({label}): {names}{pnl_str}")
        else:
            accounts_summary.append(f"- {k} ({label}): 현금 {cash:,}원 (미투자)")
    portfolio_section = "\n".join(accounts_summary) if accounts_summary else "- 포트폴리오 정보 없음"

    if insights:
        score   = insights.get("overall_score", "N/A")
        regime  = insights.get("regime", "N/A")
        vix     = insights.get("vix", "")
        vix_str = f" | VIX {vix:.1f}" if isinstance(vix, (int, float)) else ""
        insights_str = f"레짐: {regime} | 스코어: {score}/100{vix_str}"
    else:
        insights_str = "quant-scores 없음 (stage3 미실행)"

    summary_block = (
        (manual_summary[:3000] + "\n...(이하 생략)") if manual_summary and len(manual_summary) > 3000
        else (manual_summary or "_manual summary 없음 — knowledge/daily/{date}-*.md 파일을 확인하세요._")
    )

    prompt = f"""# EcoReport Synthesis 요청

날짜: {date}

---

## 내 포트폴리오 현황
{portfolio_section}

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

    out_dir = ROOT / "knowledge" / "daily"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-synthesis-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")
    print(str(out_file))


if __name__ == "__main__":
    main()
