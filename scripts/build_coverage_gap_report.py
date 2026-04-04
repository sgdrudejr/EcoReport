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


def extract_holdings(portfolio: dict) -> list:
    """모든 계좌에서 보유 종목 추출."""
    holdings = []
    for acct_key, acct in get_accounts_dict(portfolio).items():
        for h in acct.get("holdings", []):
            holdings.append({
                "code": str(h.get("code", "")),
                "name": h.get("name", ""),
                "accountKey": acct_key,
            })
        if not acct.get("holdings"):
            holdings.append({
                "code": f"CASH_{acct_key}",
                "name": f"{acct.get('label', acct_key)} (현금)",
                "accountKey": acct_key,
                "is_cash": True,
            })
    return holdings


def scan_recent_reports(date_str: str, days: int = 30) -> dict:
    """
    최근 N일 data/reports/{date}/index.json 스캔 → {code: [date, ...]} 매핑.
    code / ticker / symbol 필드를 탐색.
    """
    end_date   = datetime.strptime(date_str, "%Y-%m-%d").date()
    start_date = end_date - timedelta(days=days)

    ticker_dates: dict = {}
    reports_dir = ROOT / "data" / "reports"

    for d in range(days + 1):
        check_date = start_date + timedelta(days=d)
        check_str  = check_date.strftime("%Y-%m-%d")
        index_file = reports_dir / check_str / "index.json"
        if not index_file.exists():
            continue

        try:
            items = json.loads(index_file.read_text(encoding="utf-8"))
        except Exception:
            continue

        if not isinstance(items, list):
            continue

        found_codes: set = set()

        def extract_codes(obj, depth=0):
            if depth > 5:
                return
            if isinstance(obj, dict):
                for key in ("ticker", "code", "etf_code", "symbol", "stockCode"):
                    val = obj.get(key)
                    if isinstance(val, str) and val.strip():
                        found_codes.add(val.upper().strip())
                for v in obj.values():
                    extract_codes(v, depth + 1)
            elif isinstance(obj, list):
                for item in obj:
                    extract_codes(item, depth + 1)

        for item in items:
            extract_codes(item)

        for code in found_codes:
            ticker_dates.setdefault(code, []).append(check_str)

    # stage4-execution-plan 도 스캔 (추가 소스)
    for d in range(days + 1):
        check_date = start_date + timedelta(days=d)
        check_str  = check_date.strftime("%Y-%m-%d")
        plan_file  = ROOT / "data" / "analysis-state" / check_str / "stage4-execution-plan.json"
        if not plan_file.exists():
            continue
        try:
            data = json.loads(plan_file.read_text(encoding="utf-8"))
            found: set = set()

            def scan(obj, depth=0):
                if depth > 6:
                    return
                if isinstance(obj, dict):
                    for key in ("code", "ticker", "symbol"):
                        if key in obj and isinstance(obj[key], str):
                            found.add(obj[key].upper())
                    for v in obj.values():
                        scan(v, depth + 1)
                elif isinstance(obj, list):
                    for item in obj:
                        scan(item, depth + 1)

            scan(data)
            for code in found:
                ticker_dates.setdefault(code, []).append(check_str)
        except Exception:
            pass

    return ticker_dates


def main():
    parser = argparse.ArgumentParser(description="Build coverage gap report")
    parser.add_argument("--date", default=str(date_type.today()), help="YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=30, help="최근 N일 스캔")
    args = parser.parse_args()
    date = args.date

    portfolio  = load_portfolio()
    holdings   = extract_holdings(portfolio)
    ticker_map = scan_recent_reports(date, args.days)

    no_reports  = []
    has_reports = []

    for h in holdings:
        if h.get("is_cash"):
            continue
        code        = h["code"].upper()
        dates_found = ticker_map.get(code, [])
        if not dates_found:
            no_reports.append({
                "code":                h["code"],
                "name":                h["name"],
                "accountKey":          h["accountKey"],
                "last_report_date":    None,
                "days_since_last_report": None,
                "alert":               f"보유 중이지만 최근 {args.days}일 리포트 없음",
            })
        else:
            last_date = sorted(dates_found)[-1]
            delta = (datetime.strptime(date, "%Y-%m-%d").date()
                     - datetime.strptime(last_date, "%Y-%m-%d").date()).days
            has_reports.append({
                "code":                h["code"],
                "name":                h["name"],
                "accountKey":          h["accountKey"],
                "last_report_date":    last_date,
                "days_since_last_report": delta,
                "report_count_30d":    len(set(dates_found)),
            })

    total = len([h for h in holdings if not h.get("is_cash")])
    result = {
        "date":       date,
        "scan_days":  args.days,
        "total_holdings": total,
        "coverage_rate": f"{len(has_reports)}/{total}",
        "holdings_with_no_recent_reports": no_reports,
        "holdings_with_recent_reports":    has_reports,
    }

    out_dir  = ROOT / "data" / "technical"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{date}-coverage-gap.json"
    out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(str(out_file))
    if no_reports:
        print(f"[coverage-gap] ⚠️  {len(no_reports)}개 종목 리포트 없음:")
        for h in no_reports:
            print(f"  - {h['code']} {h['name']} ({h['accountKey']})")
    else:
        print("[coverage-gap] ✓ 모든 보유 종목 커버됨")


if __name__ == "__main__":
    main()
