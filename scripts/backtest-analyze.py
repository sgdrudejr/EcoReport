#!/usr/bin/env python3
"""
백테스트 수익률 분석기
backtest-collect.js 가 생성한 signals.json 에 실제 수익률(D+5/10/20)을 채워넣는다.

가격 소스: Naver Finance 모바일 API (Korean ETF/Stock)
          Stooq (US/글로벌 ETF)

사용:
  python3 scripts/backtest-analyze.py
  python3 scripts/backtest-analyze.py --input data/backtest/signals.json
  python3 scripts/backtest-analyze.py --min-days 5  # 수익률 계산에 필요한 최소 경과일
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent

NAVER_HISTORY_URL = "https://api.stock.naver.com/chart/domestic/item/{code}/day"
NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://finance.naver.com",
}


def fetch_naver_prices(code: str, count: int = 60) -> dict[str, float]:
    """Naver Finance 모바일 API에서 일별 종가 딕셔너리 {YYYY-MM-DD: close} 반환."""
    try:
        url = f"https://m.stock.naver.com/api/stock/{code}/price"
        resp = requests.get(url, params={"page": 1, "pageSize": count},
                            headers=NAVER_HEADERS, timeout=10)
        resp.raise_for_status()
        items = resp.json()
        if not isinstance(items, list):
            return {}
        result = {}
        for item in items:
            # Naver API 응답 필드: localTradedAt (YYYY-MM-DD), closePrice
            date_str = item.get("localTradedAt") or item.get("localDate") or item.get("date") or ""
            close = item.get("closePrice") or item.get("close") or item.get("endPrice")
            if date_str and close is not None:
                # YYYYMMDD → YYYY-MM-DD 변환 (혹시 8자리인 경우)
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


def fetch_stooq_prices(symbol: str, count: int = 60) -> dict[str, float]:
    """Stooq CSV API에서 일별 종가 딕셔너리 반환."""
    try:
        url = f"https://stooq.com/q/d/l/?s={symbol.lower()}&i=d"
        resp = requests.get(url, timeout=10)
        lines = resp.text.strip().split("\n")
        if len(lines) < 2:
            return {}
        result = {}
        for line in lines[1:]:
            parts = line.split(",")
            if len(parts) >= 5:
                date_str = parts[0].strip()
                close_str = parts[4].strip()
                try:
                    result[date_str] = float(close_str)
                except ValueError:
                    pass
        return result
    except Exception:
        return {}


def get_forward_return(prices: dict[str, float], signal_date: str, days: int) -> float | None:
    """signal_date 이후 영업일 기준 days 일 후의 수익률 계산."""
    sorted_dates = sorted(prices.keys())
    # signal_date 당일 또는 직후 거래일 찾기
    entry_dates = [d for d in sorted_dates if d >= signal_date]
    if not entry_dates:
        return None
    entry_date = entry_dates[0]
    entry_price = prices[entry_date]

    # days 영업일 이후 찾기 (달력 기준으로 approx)
    target_idx = sorted_dates.index(entry_date) + days
    if target_idx >= len(sorted_dates):
        return None  # 아직 데이터 없음
    exit_price = prices[sorted_dates[target_idx]]
    return round((exit_price - entry_price) / entry_price * 100, 4)


PRICE_CACHE: dict[str, dict[str, float]] = {}


def get_prices(code: str) -> dict[str, float]:
    """코드에 맞는 가격 소스에서 가져오기 (캐시)."""
    if code in PRICE_CACHE:
        return PRICE_CACHE[code]

    prices = {}
    # 한국 종목 (6자리 숫자) → Naver
    if code.isdigit() and len(code) == 6:
        prices = fetch_naver_prices(code, count=60)
        if not prices:
            # 백업: stooq (KRX 형식 시도)
            prices = fetch_stooq_prices(f"{code}.KS")
    # 한국 종목 (일부는 .KS 등)
    elif code.endswith(".KS") or code.endswith(".KQ"):
        prices = fetch_stooq_prices(code)
    # 계좌 레벨 신호는 가격 없음
    elif code.startswith("ACCOUNT:"):
        prices = {}
    # 그 외 (US ETF 등)
    else:
        prices = fetch_stooq_prices(code)

    PRICE_CACHE[code] = prices
    return prices


def summarize_results(signals: list[dict]) -> dict:
    """신호별 수익률 통계 계산."""
    signal_groups: dict[str, list[float]] = {}
    regime_groups: dict[str, dict[str, list[float]]] = {}

    for s in signals:
        if s.get("ret_5d") is None:
            continue
        sig = s["signal"]
        ret = s["ret_5d"]
        regime = s.get("regime", "UNKNOWN")

        signal_groups.setdefault(sig, []).append(ret)
        regime_groups.setdefault(regime, {}).setdefault(sig, []).append(ret)

    stats = {}
    for sig, returns in signal_groups.items():
        if not returns:
            continue
        avg = sum(returns) / len(returns)
        # 간단한 샤프 (무위험 0 가정, 일별 기준)
        variance = sum((r - avg) ** 2 for r in returns) / max(len(returns) - 1, 1)
        std = variance ** 0.5
        sharpe = avg / std if std > 0 else 0
        # 적중률: BUY신호 → 양수수익, REDUCE → 음수수익
        if sig in ("BUY", "SELECTIVE_ADD", "AGGRESSIVE_ADD"):
            hit_rate = sum(1 for r in returns if r > 0) / len(returns)
        elif sig == "REDUCE":
            hit_rate = sum(1 for r in returns if r < 0) / len(returns)
        else:
            hit_rate = None

        stats[sig] = {
            "count": len(returns),
            "avg_ret_5d_pct": round(avg, 4),
            "std": round(std, 4),
            "sharpe": round(sharpe, 4),
            "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
            "best": round(max(returns), 4),
            "worst": round(min(returns), 4),
        }

    return {"by_signal": stats, "by_regime": {
        regime: {sig: {"count": len(rs), "avg_ret_5d_pct": round(sum(rs)/len(rs), 4)}
                 for sig, rs in sigs.items()}
        for regime, sigs in regime_groups.items()
    }}


def main():
    parser = argparse.ArgumentParser(description="백테스트 수익률 분석")
    parser.add_argument("--input", default=str(ROOT / "data" / "backtest" / "signals.json"))
    parser.add_argument("--output", default=None)
    parser.add_argument("--min-days", type=int, default=5,
                        help="수익률 계산에 필요한 최소 경과 영업일 (기본 5)")
    parser.add_argument("--delay", type=float, default=0.3,
                        help="API 요청 간 딜레이 초 (기본 0.3)")
    args = parser.parse_args()

    in_path = Path(args.input)
    if not in_path.exists():
        print(f"❌ {in_path} 없음. 먼저 node scripts/backtest-collect.js 를 실행하세요.")
        sys.exit(1)

    data = json.loads(in_path.read_text())
    signals = data["signals"]

    today = datetime.now().strftime("%Y-%m-%d")
    holding_signals = [s for s in signals if not s["code"].startswith("ACCOUNT:")]
    print(f"📊 총 {len(holding_signals)}개 종목 신호 분석 시작 (오늘: {today})")

    min_date_for_5d = (datetime.now() - timedelta(days=args.min_days + 5)).strftime("%Y-%m-%d")

    filled = 0
    skipped_recent = 0
    skipped_no_price = 0
    unique_codes = set(s["code"] for s in holding_signals)

    print(f"  → {len(unique_codes)}개 종목 가격 조회 중...")

    for code in sorted(unique_codes):
        if code.startswith("ACCOUNT:"):
            continue
        prices = get_prices(code)
        if not prices:
            print(f"  ⚠️ {code}: 가격 데이터 없음")
        time.sleep(args.delay)

    for s in signals:
        code = s["code"]
        signal_date = s["date"]

        if signal_date > min_date_for_5d:
            skipped_recent += 1
            continue

        prices = PRICE_CACHE.get(code, {})
        if not prices:
            skipped_no_price += 1
            continue

        s["ret_5d"] = get_forward_return(prices, signal_date, 5)
        s["ret_10d"] = get_forward_return(prices, signal_date, 10)
        s["ret_20d"] = get_forward_return(prices, signal_date, 20)
        if s["ret_5d"] is not None:
            filled += 1

    print(f"\n  ✓ 수익률 계산 완료: {filled}개")
    if skipped_recent > 0:
        print(f"  ⚠️ {skipped_recent}개 스킵 (최근 신호, 아직 {args.min_days}일 미경과)")
    if skipped_no_price > 0:
        print(f"  ⚠️ {skipped_no_price}개 스킵 (가격 데이터 없음)")

    if filled < 10:
        print(f"\n⚠️ 분석 가능한 신호가 {filled}개로 부족합니다 (권장: 30개 이상).")
        print("  시스템이 더 많은 날짜를 축적하면 정확도가 높아집니다.")

    summary = summarize_results(signals)

    out_path = Path(args.output) if args.output else in_path.parent / "results.json"
    data["analysisDate"] = today
    data["summary"] = summary
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # 간단한 콘솔 요약
    print(f"\n📈 신호별 5일 수익률 요약:")
    for sig, stat in summary.get("by_signal", {}).items():
        hr = f", 적중률 {stat['hit_rate']*100:.0f}%" if stat['hit_rate'] is not None else ""
        print(f"  {sig:15s}: avg {stat['avg_ret_5d_pct']:+.2f}%  (n={stat['count']}{hr})")

    print(f"\n✅ 저장: {out_path}")
    print(f"다음 단계: node scripts/backtest-report.js")


if __name__ == "__main__":
    main()
