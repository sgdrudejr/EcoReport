#!/usr/bin/env python3
"""
build_report_triage_prompt.py
포트폴리오 컨텍스트를 포함한 triage GPT 프롬프트 생성.
오늘 수집된 문서 목록을 읽어 "내 보유 종목 기준 우선순위 매겨줘" 프롬프트 생성.

출력: knowledge/daily/YYYY-MM-DD-triage-prompt.md

사용법:
  python scripts/build_report_triage_prompt.py --date 2026-04-03
"""

import argparse
import json
from datetime import date as date_type
from pathlib import Path

PILOT_ROOT = Path(__file__).resolve().parent.parent
IGZUN_ROOT = Path("/Users/seo/igzun-daily-report")


def load_portfolio() -> dict:
    p = IGZUN_ROOT / "data" / "portfolio_state.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def load_documents(date: str) -> list[dict]:
    """normalized/YYYY-MM-DD/documents.jsonl에서 오늘 수집 문서 로드."""
    p = IGZUN_ROOT / "data" / "normalized" / date / "documents.jsonl"
    if not p.exists():
        return []
    docs = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                docs.append(json.loads(line))
            except Exception:
                pass
    return docs


def format_portfolio_context(portfolio: dict) -> str:
    lines = ["## 내 현재 보유 종목 (우선순위 판단 기준)"]
    for acct_key, acct in portfolio.get("accounts", {}).items():
        holdings = acct.get("holdings", [])
        label = acct.get("label", acct_key)
        if holdings:
            names = ", ".join(h.get("name", h.get("code", "")) for h in holdings)
            lines.append(f"{acct_key}: {names}")
        else:
            lines.append(f"{acct_key} ({label}): 현금 보유 (미투자 — 투자 기회 탐색 중)")

    lines.append("")
    lines.append("→ 내 보유 기준으로 관련성 높은 리포트를 우선순위 매겨줘.")
    lines.append("  내 보유와 무관하더라도 오늘 시장 전체에 중요하면 포함.")
    return "\n".join(lines)


def format_documents_section(docs: list[dict], max_docs: int = 50) -> str:
    if not docs:
        return "## 오늘 수집된 문서\n_문서 없음_"

    lines = [f"## 오늘 수집된 문서 ({len(docs)}건, 최대 {max_docs}건 표시)"]
    for i, doc in enumerate(docs[:max_docs], 1):
        title = doc.get("title", doc.get("headline", ""))
        source = doc.get("source", doc.get("publisher", ""))
        url = doc.get("url", "")
        summary = doc.get("summary", doc.get("content", ""))[:200]
        lines.append(f"\n### [{i}] {title}")
        if source:
            lines.append(f"출처: {source}")
        if url:
            lines.append(f"URL: {url}")
        if summary:
            lines.append(f"요약: {summary}...")

    if len(docs) > max_docs:
        lines.append(f"\n...(이하 {len(docs) - max_docs}건 생략)")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Build triage prompt with portfolio context")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    args = parser.parse_args()
    date = args.date

    portfolio = load_portfolio()
    docs = load_documents(date)
    profile = portfolio.get("investment_profile", {})

    portfolio_section = format_portfolio_context(portfolio)
    docs_section = format_documents_section(docs)

    prompt = f"""# EcoReport Triage 요청

날짜: {date}
투자 스타일: {profile.get('style', 'N/A')} | 기간: {profile.get('horizon', 'N/A')}

---

{portfolio_section}

---

{docs_section}

---

## Triage 요청

위 문서들을 아래 기준으로 분류하고 우선순위를 매겨주세요:

### 분류 기준
1. **CRITICAL**: 내 보유 종목/계좌에 직접 영향, 즉시 검토 필요
2. **HIGH**: 시장 전반에 중요, 투자 판단에 영향
3. **MEDIUM**: 배경 정보, 참고용
4. **LOW**: 관련 없음 또는 단순 정보성

### 출력 형식

```
## CRITICAL (즉시 검토)
- [문서번호] 제목 — 이유 (1줄)

## HIGH (중요)
- [문서번호] 제목 — 이유 (1줄)

## MEDIUM (참고)
- [문서번호] 제목

## LOW (스킵 가능)
- [문서번호] 제목
```

마지막에 오늘 시장의 핵심 테마 3가지를 한 줄씩 요약해주세요.
"""

    out_dir = PILOT_ROOT / "knowledge" / "daily"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-triage-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")
    print(str(out_file))
    print(f"[triage] 문서 {len(docs)}건 포함")


if __name__ == "__main__":
    main()
