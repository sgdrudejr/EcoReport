#!/usr/bin/env python3
"""
stdin에서 [{code}] JSON을 받아 최근 30거래일 일별 수익률 시계를 stdout으로 출력한다.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import date, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    import requests  # type: ignore
except ModuleNotFoundError:
    requests = None

NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://finance.naver.com",
}


def http_get_json(url, *, params=None, headers=None, timeout=10):
    if requests is not None:
        resp = requests.get(url, params=params, headers=headers, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    query = f"?{urlencode(params)}" if params else ""
    req = Request(f"{url}{query}", headers=headers or {})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get_text(url, *, headers=None, timeout=10):
    if requests is not None:
        resp = requests.get(url, headers=headers, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    req = Request(url, headers=headers or {})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def fetch_naver_prices(code):
    try:
        end_date = date.today()
        start_date = end_date - timedelta(days=180)
        url = f"https://api.stock.naver.com/chart/domestic/item/{code}/day"
        items = http_get_json(
            url,
            params={
                "startDateTime": start_date.strftime("%Y%m%d"),
                "endDateTime": end_date.strftime("%Y%m%d"),
            },
            headers=NAVER_HEADERS,
        )
        if not isinstance(items, list):
            return {}
        result = {}
        for item in items:
            date_str = item.get("localDate") or item.get("localTradedAt") or ""
            close = item.get("closePrice") or item.get("close")
            if date_str and close is not None:
                raw = str(date_str)
                if len(raw) == 8:
                    date_str = f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
                try:
                    result[str(date_str)] = float(str(close).replace(",", ""))
                except ValueError:
                    pass
        return result
    except Exception:
        return {}


def fetch_stooq_prices(symbol):
    try:
        url = f"https://stooq.com/q/d/l/?s={symbol.lower()}&i=d"
        lines = http_get_text(url).strip().split("\n")
        if len(lines) < 2:
            return {}
        result = {}
        for line in lines[1:]:
            parts = line.split(",")
            if len(parts) >= 5:
                try:
                    result[parts[0].strip()] = float(parts[4].strip())
                except ValueError:
                    pass
        return result
    except Exception:
        return {}


def get_prices(code):
    if code.isdigit() and len(code) == 6:
        prices = fetch_naver_prices(code)
        if not prices:
            prices = fetch_stooq_prices(f"{code}.KS")
        return prices
    return fetch_stooq_prices(code)


def build_return_series(prices, limit=30):
    sorted_dates = sorted(prices.keys())
    if len(sorted_dates) < 2:
        return []

    series = []
    for index in range(1, len(sorted_dates)):
        prev_date = sorted_dates[index - 1]
        current_date = sorted_dates[index]
        prev_close = prices[prev_date]
        current_close = prices[current_date]
        if prev_close in (None, 0):
            continue
        series.append(
            {
                "date": current_date,
                "return": round((current_close - prev_close) / prev_close, 6),
            }
        )

    return series[-limit:]


def main():
    payload = json.loads(sys.stdin.read() or "[]")
    codes = []
    seen = set()

    for item in payload:
        code = item.get("code") if isinstance(item, dict) else item
        if not code or code in seen:
            continue
        seen.add(code)
        codes.append(code)

    results = []
    for code in codes:
        prices = get_prices(code)
        results.append(
            {
                "code": code,
                "series": build_return_series(prices, 30),
            }
        )
        time.sleep(0.15)

    json.dump(results, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
