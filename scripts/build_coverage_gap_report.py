#!/usr/bin/env python3
"""
build_coverage_gap_report.py
보유 종목 중 최근 30일 리포트가 없는 종목을 자동 감지한다. (GPT 불필요)

출력: data/technical/YYYY-MM-DD-coverage-gap.json

사용법:
  python scripts/build_coverage_gap_report.py --date 2026-04-03
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


def extract_holdings(portfolio: dict) -> list[dict]:
    """모든 계좌에서 보유 종목 추출. 현금만 있으면 계좌 자체도 포함."""
    holdings = []
    for acct_key, acct in portfolio.get("accounts", {}).items():
        for h in acct.get("holdings", []):
            holdings.append({
                "code": str(h.get("code", "")),
                "name": h.get("name", ""),
                "accountKey": acct_key,
            })
        # 현금만 있는 계좌도 커버리지 관점에서 트래킹
        if not acct.get("holdings"):
            holdings.append({
                "code": f"CASH_{acct_key}",
                "name": f"{acct.get('label', acct_key)} (현금)",
                "accountKey": acct_key,
                "is_cash": True,
            })
    return holdings


def scan_recent_reports(date_str: str, days: int = 30) -> dict[str, list[str]]:
    """
    최근 N일 site/YYYY-MM-DD/result.json 스캔 → {ticker: [date, ...]} 매핑.
    result.json 안의 ticker, code, 종목코드 패턴을 탐색.
    """
    end_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    start_date = end_date - timedelta(days=days)

    ticker_dates: dict[str, list[str]] = {}
    site_dir = IGZUN_ROOT / "site"

    for d in range(days + 1):
        check_date = start_date + timedelta(days=d)
        check_str = check_date.strftime("%Y-%m-%d")
        result_file = site_dir / check_str / "result.json"
        if not result_file.exists():
            continue

        try:
            data = json.loads(result_file.read_text(encoding="utf-8"))
        except Exception:
            continue

        # result.json 구조에서 ticker/code 추출 (다양한 키 패턴 시도)
        found_codes: set[str] = set()

        def extract_codes(obj, depth=0):
            if depth > 5:
                return
            if isinstance(obj, dict):
                for key in ("ticker", "code", "etf_code", "symbol"):
                    if key in obj and isinstance(obj[key], str):
                        found_codes.add(obj[key].upper())
                for v in obj.values():
                    extract_codes(v, depth + 1)
            elif isinstance(obj, list):
                for item in obj:
                    extract_codes(item, depth + 1)

        extract_codes(data)

        for code in found_codes:
            ticker_dates.setdefault(code, []).append(check_str)

    return ticker_dates


def main():
    parser = argparse.ArgumentParser(description="Build coverage gap report")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=30, help="최근 N일 스캔")
    args = parser.parse_args()
    date = args.date

    portfolio = load_portfolio()
    holdings = extract_holdings(portfolio)
    ticker_map = scan_recent_reports(date, args.days)

    no_reports = []
    has_reports = []

    for h in holdings:
        if h.get("is_cash"):
            continue
        code = h["code"].upper()
        dates_found = ticker_map.get(code, [])
        if not dates_found:
            no_reports.append({
                "code": h["code"],
                "name": h["name"],
                "accountKey": h["accountKey"],
                "last_report_date": None,
                "days_since_last_report": None,
                "alert": f"보유 중이지만 최근 {args.days}일 리포트 없음",
            })
        else:
            last_date = sorted(dates_found)[-1]
            delta = (datetime.strptime(date, "%Y-%m-%d").date()
                     - datetime.strptime(last_date, "%Y-%m-%d").date()).days
            has_reports.append({
                "code": h["code"],
                "name": h["name"],
                "accountKey": h["accountKey"],
                "last_report_date": last_date,
                "days_since_last_report": delta,
                "report_count_30d": len(dates_found),
            })

    result = {
        "date": date,
        "scan_days": args.days,
        "total_holdings": len([h for h in holdings if not h.get("is_cash")]),
        "coverage_rate": (
            f"{len(has_reports)}/{len([h for h in holdings if not h.get('is_cash')])}"
        ),
        "holdings_with_no_recent_reports": no_reports,
        "holdings_with_recent_reports": has_reports,
    }

    out_dir = PILOT_ROOT / "data" / "technical"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-coverage-gap.json"
    out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(str(out_file))

    # 커버리지 갭 요약 출력
    if no_reports:
        print(f"[coverage-gap] ⚠️  {len(no_reports)}개 종목 리포트 없음:")
        for h in no_reports:
            print(f"  - {h['code']} {h['name']} ({h['accountKey']})")
    else:
        print("[coverage-gap] ✓ 모든 보유 종목 커버됨")


if __name__ == "__main__":
    main()
