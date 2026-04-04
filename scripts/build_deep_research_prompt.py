#!/usr/bin/env python3
"""
build_deep_research_prompt.py
포트폴리오 테마 기반 ChatGPT Deep Research 프롬프트 생성 (주간/월간).

출력: knowledge/weekly/YYYY-MM-DD-deep-research-prompt.md

사용법:
  python scripts/build_deep_research_prompt.py --date 2026-04-03
  python scripts/build_deep_research_prompt.py --date 2026-04-03 --mode monthly
"""

import argparse
import json
from datetime import date as date_type, datetime, timedelta
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


def load_recent_scores(date: str, days: int = 7) -> list:
    """최근 N일 stage3-quant-scores.json 로드."""
    end = datetime.strptime(date, "%Y-%m-%d").date()
    results = []
    for d in range(days):
        check = (end - timedelta(days=d)).strftime("%Y-%m-%d")
        path  = ROOT / "data" / "analysis-state" / check / "stage3-quant-scores.json"
        data  = load_json(path)
        if data:
            regime_obj = data.get("regime", {})
            regime     = regime_obj.get("name", "N/A") if isinstance(regime_obj, dict) else str(regime_obj)
            leading    = data.get("leadingIndicator", {})
            score      = round(float(leading.get("score", data.get("portfolioScore", 50))), 1)
            results.append({"_date": check, "regime": regime, "score": score,
                             "vix": leading.get("vix"), "t10y2y": leading.get("t10y2y")})
    return results


def extract_themes(portfolio: dict) -> dict:
    """계좌별 보유 종목 테마 추출."""
    themes: dict = {}
    for acct_key, acct in get_accounts_dict(portfolio).items():
        holdings = acct.get("holdings", [])
        label    = acct.get("label", acct_key)
        cash     = get_cash(acct)
        if holdings:
            themes[f"{acct_key} ({label})"] = [h.get("name", h.get("code", "")) for h in holdings]
        else:
            themes[f"{acct_key} ({label})"] = [f"현금 {cash:,}원 (미투자)"]
    return themes


def summarize_weekly_regime(scores: list) -> str:
    if not scores:
        return "주간 데이터 없음 (data/analysis-state/ 확인 필요)"
    lines = []
    for s in scores[:7]:
        d      = s.get("_date", "")
        score  = s.get("score", "N/A")
        regime = s.get("regime", "N/A")
        vix    = s.get("vix", "")
        vix_s  = f" | VIX {vix:.1f}" if isinstance(vix, (int, float)) else ""
        lines.append(f"- {d}: {regime} (score {score}{vix_s})")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Build Deep Research prompt (weekly/monthly)")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    parser.add_argument("--mode", choices=["weekly", "monthly"], default="weekly")
    args = parser.parse_args()
    date = args.date

    portfolio = load_portfolio()
    themes    = extract_themes(portfolio)
    days      = 7 if args.mode == "weekly" else 30
    scores    = load_recent_scores(date, days)
    regime_summary = summarize_weekly_regime(scores)

    theme_lines = []
    for acct, names in themes.items():
        theme_lines.append(f"- {acct}: {', '.join(names)}")
    theme_section = "\n".join(theme_lines) if theme_lines else "- 보유 포지션 없음 (전액 현금)"

    latest         = scores[0] if scores else {}
    current_score  = latest.get("score", "N/A")
    current_regime = latest.get("regime", "N/A")
    current_vix    = latest.get("vix", "")
    vix_str        = f" | VIX {current_vix:.1f}" if isinstance(current_vix, (int, float)) else ""

    prompt = f"""# Deep Research 요청 ({args.mode})

날짜: {date}
분석 기간: 최근 {days}일

---

## 내 포트폴리오 핵심 테마
{theme_section}

---

## 최근 {days}일 레짐 트렌드
{regime_summary}

**현재**: {current_regime} (스코어: {current_score}/100{vix_str})

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

    out_dir = ROOT / "knowledge" / "weekly"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-deep-research-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")
    print(str(out_file))


if __name__ == "__main__":
    main()
