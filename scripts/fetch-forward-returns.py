#!/usr/bin/env python3
"""
stdin에서 [{code, date}] JSON을 받아 5/10/20일 forward return을 계산해 stdout으로 출력한다.
backtest-analyze.py의 가격 조회 로직을 재사용한다.
"""

from __future__ import annotations

import json
import sys
import time
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


def fetch_naver_prices(code, count=80):
    """Naver Finance chart API (domestic)로 일별 종가 조회."""
    try:
        url = f"https://api.stock.naver.com/chart/domestic/item/{code}/day"
        items = http_get_json(url, params={"startDateTime": "20260101", "endDateTime": "20261231"}, headers=NAVER_HEADERS)
        if not isinstance(items, list):
            return {}
        result = {}
        for item in items:
            date_str = item.get("localDate") or item.get("localTradedAt") or ""
            close = item.get("closePrice") or item.get("close")
            if date_str and close is not None:
                if len(str(date_str)) == 8:
                    d = str(date_str)
                    date_str = f"{d[:4]}-{d[4:6]}-{d[6:]}"
                try:
                    result[str(date_str)] = float(str(close).replace(",", ""))
                except ValueError:
                    pass
        return result
    except Exception:
        return {}


def fetch_stooq_prices(symbol, count=80):
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


def forward_return(prices, signal_date, days):
    sorted_dates = sorted(prices.keys())
    entry_dates = [d for d in sorted_dates if d >= signal_date]
    if not entry_dates:
        return None
    entry_date = entry_dates[0]
    entry_price = prices[entry_date]
    target_idx = sorted_dates.index(entry_date) + days
    if target_idx >= len(sorted_dates):
        return None
    exit_price = prices[sorted_dates[target_idx]]
    return round((exit_price - entry_price) / entry_price * 100, 4)


def main():
    data = json.loads(sys.stdin.read())
    price_cache = {}
    results = []

    for item in data:
        code = item.get("code")
        date = item.get("date")
        if not code or not date:
            continue

        if code not in price_cache:
            price_cache[code] = get_prices(code)
            time.sleep(0.15)  # rate limit

        prices = price_cache[code]
        results.append({
            "code": code,
            "date": date,
            "ret_1d": forward_return(prices, date, 1),
            "ret_3d": forward_return(prices, date, 3),
            "ret_5d": forward_return(prices, date, 5),
            "ret_10d": forward_return(prices, date, 10),
            "ret_20d": forward_return(prices, date, 20),
        })

    json.dump(results, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
