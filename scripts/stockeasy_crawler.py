#!/usr/bin/env python3
"""
StockEasy 크롤러
=================
Chrome에 저장된 쿠키를 추출해 로그인 없이 StockEasy 데이터를 수집합니다.

수집 대상:
  sector    시장분석 > 섹터 (ETF 섹터 신호등, 등락률, 포지션, 이격률)
  briefing  시장분석 > 브리핑 (당일 브리핑 + 탭별 리포트)
  rs        종목분석 > 종합 RS (섹터 필터, 52주 신고가, 자금흐름)
  report    종목분석 > 리포트 (산업 리포트, 요약)
  momentum  전략실 > 1호 모멘텀 Easy
  peak      전략실 > 2호 피크 Easy
  value     전략실 > 3호 밸류 Easy

사용법:
    python3 scripts/stockeasy_crawler.py --date 2026-04-16
    python3 scripts/stockeasy_crawler.py --date 2026-04-16 --targets sector momentum value
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_URL = "https://stockeasy.intellio.kr"

TARGETS = {
    "sector":           f"{BASE_URL}/market-analysis?tab=etfSector",
    "briefing":         f"{BASE_URL}/market-analysis?tab=briefing",
    "rs":               f"{BASE_URL}/stock-analysis",
    "report":           f"{BASE_URL}/stock-analysis?tab=report",
    "industry_report":  f"{BASE_URL}/stock-analysis?tab=report",  # 산업리포트 탭 클릭 필요
    "momentum":         f"{BASE_URL}/strategy-room/momentum",
    "peak":             f"{BASE_URL}/strategy-room/peak",
    "value":            f"{BASE_URL}/strategy-room/value",
}

RENDER_WAIT = 3500  # ms — Next.js SPA 렌더링 대기


# ── 쿠키 추출 ─────────────────────────────────────────────────────────────────

def get_chrome_cookies() -> list[dict]:
    """Chrome 로그인 쿠키를 Playwright 형식으로 반환."""
    try:
        import browser_cookie3
    except ImportError:
        print("❌ browser-cookie3 미설치. pip install browser-cookie3")
        sys.exit(1)

    jar = browser_cookie3.chrome(domain_name=".intellio.kr")
    cookies = []
    for c in jar:
        cookies.append({
            "name": c.name,
            "value": c.value,
            "domain": c.domain or ".intellio.kr",
            "path": c.path or "/",
        })
    return cookies


# ── 공통 헬퍼 ─────────────────────────────────────────────────────────────────

def _tables(page) -> list[dict]:
    """페이지 내 모든 테이블을 구조화해 반환."""
    return page.evaluate("""() => {
        return [...document.querySelectorAll('table')].map(table => ({
            headers: [...table.querySelectorAll('th')].map(th => th.innerText.trim()),
            rows: [...table.querySelectorAll('tbody tr')].map(tr =>
                [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
            )
        }));
    }""")


def _page_text(page, limit: int = 10000) -> str:
    return page.evaluate(f"() => document.body.innerText.slice(0, {limit})")


# ── 섹터 ─────────────────────────────────────────────────────────────────────

def extract_sector(page) -> dict[str, Any]:
    """시장분석 > 섹터 탭."""
    page.wait_for_timeout(RENDER_WAIT)

    tables = _tables(page)
    text = _page_text(page)

    # 섹터 행 파싱 (텍스트 기반 fallback)
    sector_rows = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        # 신호등 이모지나 % 포함 행
        if any(c in line for c in ["🟢", "🟡", "🔴", "%", "이격", "유지", "이탈"]):
            sector_rows.append(line)

    return {
        "tables": tables,
        "sector_lines": sector_rows,
        "raw_text": text,
    }


# ── 브리핑 ────────────────────────────────────────────────────────────────────

def extract_briefing(page) -> dict[str, Any]:
    """시장분석 > 브리핑 탭 — 탭 목록 + 각 탭 내용 수집."""
    page.wait_for_timeout(RENDER_WAIT)

    # 탭 버튼 목록 파악
    tab_info = page.evaluate("""() => {
        const sel = '[role="tab"], [class*="tab"][class*="btn"], [class*="Tab"] button, nav button, ul[role="tablist"] li';
        return [...document.querySelectorAll(sel)]
            .map(el => ({ text: el.innerText.trim(), classes: el.className }))
            .filter(t => t.text.length > 0 && t.text.length < 40);
    }""")

    tab_contents: list[dict] = []

    # 현재(기본) 탭 내용
    main_text = _page_text(page)
    tab_contents.append({"tab": "default", "text": main_text})

    # 탭 버튼 클릭 후 내용 수집 (최대 8개)
    for i, tab in enumerate(tab_info[:8]):
        try:
            btns = page.locator('[role="tab"]')
            if btns.count() > i:
                btns.nth(i).click()
                page.wait_for_timeout(1500)
                content = _page_text(page, 5000)
                tab_contents.append({"tab": tab["text"], "text": content})
        except Exception as e:
            tab_contents.append({"tab": tab.get("text", f"tab_{i}"), "error": str(e)})

    return {
        "tabs_found": tab_info,
        "tab_contents": tab_contents,
        "raw_text": main_text,
    }


# ── 종합 RS ───────────────────────────────────────────────────────────────────

def extract_rs(page) -> dict[str, Any]:
    """종목분석 > 종합 RS."""
    page.wait_for_timeout(RENDER_WAIT)

    tables = _tables(page)
    text = _page_text(page)

    # 섹터 필터 (강도 숫자 포함 행)
    sector_filters = page.evaluate("""() => {
        const items = document.querySelectorAll('[class*="sector"], [class*="filter"], [class*="Filter"]');
        return [...items].map(el => el.innerText.trim()).filter(t => t.length > 0 && t.length < 100);
    }""")

    return {
        "tables": tables,
        "sector_filters": sector_filters,
        "raw_text": text,
    }


# ── 리포트 ────────────────────────────────────────────────────────────────────

def extract_report(page) -> dict[str, Any]:
    """종목분석 > 리포트 탭 — 기업리포트 (첫 페이지만)."""
    page.wait_for_timeout(RENDER_WAIT)
    return {
        "tables": _tables(page),
        "raw_text": _page_text(page),
    }


def extract_industry_report(page) -> dict[str, Any]:
    """종목분석 > 리포트 탭 > 산업리포트 — 당일 전체 페이지 수집."""
    page.wait_for_timeout(RENDER_WAIT)

    # 산업리포트 탭 클릭
    page.get_by_text("산업리포트", exact=True).first.click()
    page.wait_for_timeout(2000)

    all_reports: list[dict] = []
    page_num = 1

    while True:
        tables = _tables(page)
        if not tables or not tables[0].get("rows"):
            break

        t = tables[0]
        headers = t["headers"]
        today_rows = []

        for row in t["rows"]:
            if not any(row):
                continue
            entry: dict = {}
            for j, h in enumerate(headers):
                entry[h or f"col_{j}"] = row[j] if j < len(row) else ""
            # 당일 날짜 행만 (첫 컬럼이 날짜)
            date_val = row[0] if row else ""
            if date_val and not any(c.isdigit() for c in date_val):
                break  # 날짜 없는 행 = 하단 네비게이션
            today_rows.append(entry)

        all_reports.extend(today_rows)
        print(f"      페이지 {page_num}: {len(today_rows)}개 수집 (누계 {len(all_reports)}개)")

        # 다음 페이지 버튼
        try:
            next_btn = page.locator("button:has-text('다음'), [aria-label='next page'], [class*='next']").first
            if next_btn.is_disabled() or next_btn.count() == 0:
                break
            next_btn.click()
            page.wait_for_timeout(1500)
            page_num += 1
            if page_num > 30:  # 안전장치
                break
        except Exception:
            break

    return {
        "total": len(all_reports),
        "reports": all_reports,
    }


# ── 전략실 ────────────────────────────────────────────────────────────────────

def extract_strategy(page, room: str) -> dict[str, Any]:
    """전략실 공통 추출 (모멘텀/피크/밸류) — rowspan 처리 포함."""
    page.wait_for_timeout(RENDER_WAIT)
    text = _page_text(page)

    # rowspan을 올바르게 처리하는 JS 파서
    tables_parsed = page.evaluate("""() => {
        function parseTable(table) {
            const headers = [...table.querySelectorAll('th')].map(th => th.innerText.trim());
            const rows = [];
            // rowspan 처리를 위한 스팬 맵
            const spanMap = {};  // col_idx -> {value, remaining}

            table.querySelectorAll('tbody tr').forEach(tr => {
                const cells = [...tr.querySelectorAll('td')];
                const row = [];
                let cellIdx = 0;

                for (let col = 0; col < Math.max(headers.length, cells.length + Object.keys(spanMap).length); col++) {
                    if (spanMap[col] && spanMap[col].remaining > 0) {
                        row.push(spanMap[col].value);
                        spanMap[col].remaining--;
                        if (spanMap[col].remaining === 0) delete spanMap[col];
                    } else if (cellIdx < cells.length) {
                        const td = cells[cellIdx++];
                        const val = td.innerText.trim();
                        const rs = parseInt(td.getAttribute('rowspan') || '1');
                        if (rs > 1) {
                            spanMap[col] = { value: val, remaining: rs - 1 };
                        }
                        row.push(val);
                    }
                }

                if (row.some(v => v.length > 0)) rows.push(row);
            });

            return { headers, rows };
        }

        const tables = document.querySelectorAll('table');
        return [...tables].map(t => parseTable(t));
    }""")

    def rows_to_dicts(tbl: dict) -> list[dict]:
        headers = tbl.get("headers", [])
        result = []
        for row in tbl.get("rows", []):
            if not any(row):
                continue
            entry: dict[str, str] = {}
            for j, h in enumerate(headers):
                entry[h if h else f"col_{j}"] = row[j] if j < len(row) else ""
            result.append(entry)
        return result

    holdings = rows_to_dicts(tables_parsed[0]) if len(tables_parsed) >= 1 else []
    exits = rows_to_dicts(tables_parsed[1]) if len(tables_parsed) >= 2 else []

    # 신규 인입/이탈 감지 (편입일이 최근 1~3일인 종목)
    new_entries = [h for h in holdings if h.get("보유일", "").replace("일", "").strip() in ("1", "2", "3")]

    return {
        "room": room,
        "holdings": holdings,
        "exits": exits,
        "new_entries": new_entries,
        "tables_raw": tables_parsed,
        "raw_text": text,
    }


# ── 메인 ─────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="StockEasy 크롤러")
    p.add_argument("--date", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    all_targets = list(TARGETS.keys())
    p.add_argument("--targets", nargs="*", default=all_targets,
                   choices=all_targets)
    p.add_argument("--output-dir", default=None)
    p.add_argument("--headless", action="store_true", default=True)
    p.add_argument("--timeout", type=int, default=30)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("❌ playwright 미설치. pip install playwright && playwright install chromium")
        sys.exit(1)

    out_dir = Path(args.output_dir) if args.output_dir \
        else Path(__file__).parent.parent / "data" / "stockeasy" / args.date
    out_dir.mkdir(parents=True, exist_ok=True)

    cookies = get_chrome_cookies()
    print(f"🍪 Chrome 쿠키 {len(cookies)}개 추출 완료")

    print(f"🕷️  StockEasy 크롤러 시작 ({args.date})")
    print(f"   수집 대상: {', '.join(args.targets)}")

    results: dict[str, Any] = {
        "date": args.date,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "targets": {},
    }

    extractors = {
        "sector":          extract_sector,
        "briefing":        extract_briefing,
        "rs":              extract_rs,
        "report":          extract_report,
        "industry_report": extract_industry_report,
        "momentum":        lambda p: extract_strategy(p, "momentum"),
        "peak":            lambda p: extract_strategy(p, "peak"),
        "value":           lambda p: extract_strategy(p, "value"),
    }

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=args.headless)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        ctx.add_cookies(cookies)

        page = ctx.new_page()
        page.set_default_timeout(args.timeout * 1000)

        # 로그인 확인
        page.goto(f"{BASE_URL}/market-analysis?tab=etfSector")
        page.wait_for_timeout(2000)
        if "login" in page.url:
            print("❌ 쿠키 인증 실패. Chrome에서 StockEasy에 로그인되어 있는지 확인하세요.")
            browser.close()
            return
        print(f"   ✅ 인증 확인: {page.title()}")

        for target in args.targets:
            url = TARGETS[target]
            print(f"\n📥 [{target}] {url}")
            try:
                page.goto(url)
                try:
                    page.wait_for_load_state("networkidle", timeout=15_000)
                except Exception:
                    page.wait_for_timeout(RENDER_WAIT)  # networkidle 타임아웃 시 단순 대기

                data = extractors[target](page)
                results["targets"][target] = data

                out_file = out_dir / f"{target}.json"
                out_file.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
                )

                # 결과 미리보기
                if target in ("momentum", "peak", "value"):
                    h_count = len(data.get("holdings", []))
                    e_count = len(data.get("exits", []))
                    print(f"   ✅ 보유종목: {h_count}개, 이탈종목: {e_count}개 → {out_file.name}")
                else:
                    text_len = len(data.get("raw_text", ""))
                    print(f"   ✅ 텍스트 {text_len:,}자 수집 → {out_file.name}")

            except Exception as e:
                print(f"   ❌ 오류: {e}")
                results["targets"][target] = {"error": str(e)}

        browser.close()

    merged = out_dir / "stockeasy-raw.json"
    merged.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n✅ 수집 완료 → {out_dir}")
    print(f"   통합 파일: {merged.name}")


if __name__ == "__main__":
    main()
