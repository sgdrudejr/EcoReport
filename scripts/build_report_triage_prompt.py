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
    """accounts가 list든 dict든 {key: account_data} dict로 정규화."""
    accounts = portfolio.get("accounts", {})
    if isinstance(accounts, list):
        return {a.get("key", a.get("label", str(i))): a for i, a in enumerate(accounts)}
    return accounts


def get_cash(account: dict) -> int:
    return int(account.get("cashAvailable", account.get("cash", account.get("availableCash", 0))))


def load_documents(date: str) -> list:
    """오늘 수집된 문서 로드 (리서치 PDF index + 뉴스 피드).

    우선순위:
    1. data/reports/{date}/index.json  — PDF 리서치 리포트
    2. data/news/{date}.json           — RSS/뉴스 피드
    """
    docs = []

    # 1) PDF 리서치 리포트
    report_index = ROOT / "data" / "reports" / date / "index.json"
    if report_index.exists():
        try:
            items = json.loads(report_index.read_text(encoding="utf-8"))
            if isinstance(items, list):
                for item in items:
                    docs.append({
                        "title": item.get("title", item.get("name", "")),
                        "source": item.get("publisher", item.get("source", "리서치")),
                        "url": item.get("url", item.get("pdfUrl", "")),
                        "summary": item.get("summary", item.get("abstract", "")),
                        "type": "research",
                    })
        except Exception:
            pass

    # 2) 뉴스 피드
    news_path = ROOT / "data" / "news" / f"{date}.json"
    if news_path.exists():
        try:
            items = json.loads(news_path.read_text(encoding="utf-8"))
            if isinstance(items, list):
                for item in items:
                    docs.append({
                        "title": item.get("title", item.get("headline", "")),
                        "source": item.get("source", item.get("feed", "뉴스")),
                        "url": item.get("url", item.get("link", "")),
                        "summary": item.get("summary", item.get("content", item.get("description", "")))[:200],
                        "type": "news",
                    })
            elif isinstance(items, dict):
                # {articles: [...]} 형식일 수 있음
                for item in items.get("articles", items.get("items", [])):
                    docs.append({
                        "title": item.get("title", ""),
                        "source": item.get("source", "뉴스"),
                        "url": item.get("url", item.get("link", "")),
                        "summary": item.get("summary", item.get("content", ""))[:200],
                        "type": "news",
                    })
        except Exception:
            pass

    return docs


# ── 섹션 포매터 ───────────────────────────────────────────────────────────────

def format_portfolio_context(portfolio: dict) -> str:
    accounts = get_accounts_dict(portfolio)
    lines = ["## 내 현재 보유 종목 (우선순위 판단 기준)"]
    for acct_key, acct in accounts.items():
        holdings = acct.get("holdings", [])
        label = acct.get("label", acct_key)
        cash = get_cash(acct)
        if holdings:
            names = ", ".join(h.get("name", h.get("code", "")) for h in holdings)
            lines.append(f"- {acct_key} ({label}): {names}")
        else:
            lines.append(f"- {acct_key} ({label}): 현금 {cash:,}원 (미투자 — 투자 기회 탐색 중)")
    lines.append("")
    lines.append("→ 내 보유 기준으로 관련성 높은 리포트를 우선순위 매겨줘.")
    lines.append("  내 보유와 무관하더라도 오늘 시장 전체에 중요하면 포함.")
    return "\n".join(lines)


def format_documents_section(docs: list, max_docs: int = 50) -> str:
    if not docs:
        return "## 오늘 수집된 문서\n_문서 없음 — data/reports/{date}/index.json 또는 data/news/{date}.json 확인_"

    lines = [f"## 오늘 수집된 문서 ({len(docs)}건, 최대 {max_docs}건 표시)"]
    for i, doc in enumerate(docs[:max_docs], 1):
        title   = doc.get("title", "")
        source  = doc.get("source", "")
        url     = doc.get("url", "")
        summary = doc.get("summary", "")[:200]
        dtype   = doc.get("type", "")
        tag     = f"[{dtype}] " if dtype else ""
        lines.append(f"\n### [{i}] {tag}{title}")
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
    docs      = load_documents(date)

    portfolio_section = format_portfolio_context(portfolio)
    docs_section      = format_documents_section(docs)

    prompt = f"""# EcoReport Triage 요청

날짜: {date}

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

    out_dir = ROOT / "knowledge" / "daily"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-triage-prompt.md"
    out_file.write_text(prompt, encoding="utf-8")
    print(str(out_file))
    print(f"[triage] 문서 {len(docs)}건 포함 (리서치: {sum(1 for d in docs if d.get('type')=='research')}, 뉴스: {sum(1 for d in docs if d.get('type')=='news')})")


if __name__ == "__main__":
    main()
