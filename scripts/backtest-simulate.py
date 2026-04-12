#!/usr/bin/env python3
"""
Stage 3 스코어링 백테스트 시뮬레이터

1~4월 가격 데이터로 기술 지표를 계산하고,
현재 Stage 3 수식을 적용해 매일 시그널을 생성한 뒤
실제 forward return과 비교한다.

리포트/Stage2 데이터 없이 기술+팩터 점수만으로 시뮬레이션.

사용:
  .venv/bin/python scripts/backtest-simulate.py
  .venv/bin/python scripts/backtest-simulate.py --start 20260102 --end 20260410
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

try:
    import requests
except ModuleNotFoundError:
    print("requests 패키지 필요: pip install requests", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://finance.naver.com",
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="20260102")
    p.add_argument("--end", default="20260410")
    p.add_argument("--forward-days", type=int, nargs="+", default=[1, 3, 5, 10, 20])
    p.add_argument("--output", default=str(ROOT / "data" / "backtest" / "simulation-results.json"))
    return p.parse_args()


# ── 가격 조회 ──────────────────────────────────────────────────────────────

def fetch_prices(code: str, start: str, end: str) -> list[dict]:
    """Naver chart API에서 일별 OHLCV 가져오기."""
    url = f"https://api.stock.naver.com/chart/domestic/item/{code}/day"
    resp = requests.get(url, params={"startDateTime": start, "endDateTime": end},
                        headers=NAVER_HEADERS, timeout=15)
    resp.raise_for_status()
    items = resp.json()
    result = []
    for item in items:
        d = str(item["localDate"])
        result.append({
            "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
            "open": float(item.get("openPrice", 0)),
            "high": float(item.get("highPrice", 0)),
            "low": float(item.get("lowPrice", 0)),
            "close": float(item.get("closePrice", 0)),
            "volume": int(item.get("accumulatedTradingVolume", 0)),
        })
    return sorted(result, key=lambda x: x["date"])


# ── 기술 지표 계산 ─────────────────────────────────────────────────────────

def sma(closes: list[float], period: int) -> float | None:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def ema(closes: list[float], period: int) -> float | None:
    if len(closes) < period:
        return None
    k = 2 / (period + 1)
    val = sum(closes[:period]) / period
    for c in closes[period:]:
        val = c * k + val * (1 - k)
    return val


def rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def macd(closes: list[float]) -> tuple[float, float, float] | None:
    """Returns (macd_line, signal, histogram)."""
    if len(closes) < 26:
        return None
    fast = ema(closes, 12)
    slow = ema(closes, 26)
    if fast is None or slow is None:
        return None
    line = fast - slow
    # Approximate signal as EMA(9) of MACD line history
    macd_history = []
    for i in range(26, len(closes) + 1):
        f = ema(closes[:i], 12)
        s = ema(closes[:i], 26)
        if f is not None and s is not None:
            macd_history.append(f - s)
    signal = ema(macd_history, 9) if len(macd_history) >= 9 else line
    return line, signal, line - signal


def bollinger(closes: list[float], period: int = 20, std_mult: float = 2.0):
    if len(closes) < period:
        return None
    window = closes[-period:]
    mid = sum(window) / period
    std = math.sqrt(sum((x - mid) ** 2 for x in window) / period)
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    return {"mid": mid, "upper": upper, "lower": lower, "bandwidth": upper - lower}


def adx(highs, lows, closes, period=14):
    if len(closes) < period + 1:
        return None
    plus_dm, minus_dm, tr_list = [], [], []
    for i in range(1, len(closes)):
        h_diff = highs[i] - highs[i - 1]
        l_diff = lows[i - 1] - lows[i]
        plus_dm.append(h_diff if h_diff > l_diff and h_diff > 0 else 0)
        minus_dm.append(l_diff if l_diff > h_diff and l_diff > 0 else 0)
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        tr_list.append(tr)
    if len(tr_list) < period:
        return None
    atr = sum(tr_list[-period:]) / period
    if atr == 0:
        return None
    plus_di = 100 * sum(plus_dm[-period:]) / period / atr
    minus_di = 100 * sum(minus_dm[-period:]) / period / atr
    dx = abs(plus_di - minus_di) / max(plus_di + minus_di, 1e-9) * 100
    return dx


def stochastic(highs, lows, closes, k_period=14, d_period=3):
    if len(closes) < k_period:
        return None
    h = max(highs[-k_period:])
    l = min(lows[-k_period:])
    if h == l:
        return {"k": 50, "d": 50}
    k = (closes[-1] - l) / (h - l) * 100
    return {"k": k, "d": k}  # Simplified


# ── Stage 3 수식 시뮬레이션 ─────────────────────────────────────────────────

def clamp(val, lo, hi):
    return max(lo, min(hi, val))


def derive_features(closes, highs, lows, volumes):
    """Stage 3 feature vector 재현."""
    close = closes[-1]
    ma5 = sma(closes, 5)
    ma20 = sma(closes, 20)
    ma60 = sma(closes, 60) or sma(closes, len(closes))
    ma120 = sma(closes, 120) or ma60

    if not all([ma20, ma60, ma120]):
        return None

    ma_trend = clamp(
        10 * (close / ma20 - 1) + 12 * (ma20 / ma60 - 1) + 14 * (ma60 / ma120 - 1),
        -2.5, 2.5
    )

    macd_result = macd(closes)
    macd_z = 0
    if macd_result:
        line, signal, hist = macd_result
        macd_z = clamp(hist / max(abs(signal), 1e-9), -2.5, 2.5)

    rsi_val = rsi(closes) or 50
    rsi_mid = clamp((rsi_val - 50) / 12.5, -2.5, 2.5)
    rsi_timing = clamp((50 - rsi_val) / 10, -2.5, 2.5)

    adx_val = adx(highs, lows, closes) or 20
    adx_trend = clamp((adx_val - 20) / 12, -2.0, 2.0)

    bb = bollinger(closes)
    bb_dist = 0
    if bb and bb["bandwidth"] > 0:
        bb_dist = clamp((close - bb["mid"]) / (bb["bandwidth"] / 2), -2.5, 2.5)

    stoch = stochastic(highs, lows, closes)
    stoch_timing = 0
    if stoch:
        stoch_timing = clamp((50 - (stoch["k"] + stoch["d"]) / 2) / 12, -2.5, 2.5)

    avg_vol = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
    vol_ratio = volumes[-1] / max(avg_vol, 1)
    volume_z = clamp(vol_ratio - 1, -1.5, 2.5)

    return {
        "maTrend": ma_trend,
        "macdZ": macd_z,
        "rsiMid": rsi_mid,
        "adxTrend": adx_trend,
        "bbDist": bb_dist,
        "rsiTiming": rsi_timing,
        "stochTiming": stoch_timing,
        "volumeZ": volume_z,
        "rsi": rsi_val,
        "close": close,
    }


def compute_action_score(features):
    """Simplified Stage 3 actionScore computation."""
    f = features

    # Direction (SIDEWAYS weights as default)
    direction_raw = (
        0.32 * f["maTrend"] +
        0.22 * f["macdZ"] +
        0.12 * f["rsiMid"] +
        0.12 * f["adxTrend"] +
        0.22 * 0  # report impact = 0 (no reports in simulation)
    )

    # Timing
    timing_raw = (
        0.28 * f["bbDist"] +
        0.22 * f["rsiTiming"] +
        0.18 * f["stochTiming"] +
        0.14 * f["volumeZ"] +
        0.18 * 0  # report = 0
    )

    # Combined
    combined = 0.58 * direction_raw + 0.27 * timing_raw + 0.15 * 0  # report=0

    # Sigmoid → 0-100
    score = 1 / (1 + math.exp(-combined)) * 100
    score = round(clamp(score, 0, 100))

    # Signal
    if score >= 72:
        signal = "BUY"
    elif score >= 58:
        signal = "HOLD"
    elif score >= 42:
        signal = "WATCH"
    else:
        signal = "REDUCE"

    # Momentum factor (for factor analysis)
    momentum = 0.36 * f["maTrend"] + 0.28 * f["macdZ"] + 0.20 * f["rsiMid"] + 0.16 * f["adxTrend"]

    return {
        "actionScore": score,
        "signal": signal,
        "direction": direction_raw,
        "timing": timing_raw,
        "momentum": momentum,
        "rsi": f["rsi"],
    }


# ── 메인 ────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # 포트폴리오 종목 로드
    portfolio = json.loads((ROOT / "data" / "portfolio" / "latest.json").read_text())
    holdings = {}
    for acct in portfolio.get("accounts", []):
        for h in acct.get("holdings", []):
            code = h.get("code")
            if code and code not in holdings:
                holdings[code] = {"name": h.get("name", "?"), "accountKey": acct["key"]}

    # watchlist도 추가
    try:
        watchlist = json.loads((ROOT / "config" / "watchlist.json").read_text())
        for section in ["core_etf", "satellite_etf", "individual_stocks"]:
            for item in watchlist.get(section, []):
                code = item.get("code")
                if code and code not in holdings:
                    holdings[code] = {"name": item.get("name", "?"), "accountKey": item.get("account", "?")}
    except Exception:
        pass

    print(f"[backtest] {len(holdings)}개 종목, {args.start}~{args.end}", file=sys.stderr)

    # 가격 데이터 수집
    all_prices = {}
    for code in holdings:
        try:
            prices = fetch_prices(code, args.start, args.end)
            if prices:
                all_prices[code] = prices
                print(f"  {code} {holdings[code]['name'][:20]}: {len(prices)}일", file=sys.stderr)
            time.sleep(0.2)
        except Exception as e:
            print(f"  {code}: 가격 조회 실패 ({e})", file=sys.stderr)

    # 매일 시뮬레이션
    all_signals = []
    min_warmup = 30  # 기술지표 계산에 최소 30일 필요

    for code, prices in all_prices.items():
        closes = [p["close"] for p in prices]
        highs = [p["high"] for p in prices]
        lows = [p["low"] for p in prices]
        volumes = [p["volume"] for p in prices]
        dates = [p["date"] for p in prices]

        for i in range(min_warmup, len(prices)):
            features = derive_features(
                closes[:i + 1], highs[:i + 1], lows[:i + 1], volumes[:i + 1]
            )
            if features is None:
                continue

            result = compute_action_score(features)

            # Forward returns
            forward_returns = {}
            for days in args.forward_days:
                if i + days < len(prices):
                    entry = closes[i]
                    exit_p = closes[i + days]
                    forward_returns[f"ret_{days}d"] = round((exit_p - entry) / entry * 100, 4)
                else:
                    forward_returns[f"ret_{days}d"] = None

            all_signals.append({
                "date": dates[i],
                "code": code,
                "name": holdings[code]["name"],
                "accountKey": holdings[code]["accountKey"],
                "close": closes[i],
                **result,
                **forward_returns,
            })

    print(f"\n[backtest] 총 {len(all_signals)}개 시그널 생성", file=sys.stderr)

    # 분석
    with_5d = [s for s in all_signals if s.get("ret_5d") is not None]
    print(f"[backtest] 5d return 확보: {len(with_5d)}", file=sys.stderr)

    def pearson(xs, ys):
        n = len(xs)
        if n < 3:
            return None
        mx, my = sum(xs) / n, sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dx2 = sum((x - mx) ** 2 for x in xs)
        dy2 = sum((y - my) ** 2 for y in ys)
        denom = math.sqrt(dx2 * dy2)
        return round(num / denom, 4) if denom > 0 else None

    def hit_rate(items, score_threshold, higher=True):
        filtered = [s for s in items if s["actionScore"] >= score_threshold] if higher else \
                   [s for s in items if s["actionScore"] <= score_threshold]
        if not filtered:
            return None, 0
        if higher:
            hits = sum(1 for s in filtered if s["ret_5d"] > 0)
        else:
            hits = sum(1 for s in filtered if s["ret_5d"] < 0)
        return round(hits / len(filtered), 4), len(filtered)

    # 상관관계
    score_corr = {}
    for period in ["1d", "3d", "5d", "10d", "20d"]:
        key = f"ret_{period}"
        valid = [s for s in all_signals if s.get(key) is not None]
        if valid:
            score_corr[f"actionScore_vs_{key}"] = {
                "r": pearson([s["actionScore"] for s in valid], [s[key] for s in valid]),
                "n": len(valid),
            }

    # 시그널 적중률
    buy_hr, buy_n = hit_rate(with_5d, 72)
    hold_hr, hold_n = hit_rate(with_5d, 58)
    reduce_hr, reduce_n = hit_rate(with_5d, 42, higher=False)

    # 팩터 상관관계
    momentum_corr = pearson(
        [s["momentum"] for s in with_5d],
        [s["ret_5d"] for s in with_5d],
    )

    # 월별 분석
    monthly = defaultdict(list)
    for s in with_5d:
        month = s["date"][:7]
        monthly[month].append(s)

    monthly_stats = {}
    for month, signals in sorted(monthly.items()):
        buy_hr_m, buy_n_m = hit_rate(signals, 72)
        monthly_stats[month] = {
            "signals": len(signals),
            "avgReturn5d": round(sum(s["ret_5d"] for s in signals) / len(signals), 4),
            "buyHitRate": buy_hr_m,
            "buyCount": buy_n_m,
            "scoreCorr": pearson([s["actionScore"] for s in signals], [s["ret_5d"] for s in signals]),
        }

    # 종목별 분석
    by_code = defaultdict(list)
    for s in with_5d:
        by_code[s["code"]].append(s)

    code_stats = {}
    for code, signals in by_code.items():
        buy_hr_c, buy_n_c = hit_rate(signals, 72)
        code_stats[code] = {
            "name": signals[0]["name"],
            "signals": len(signals),
            "avgReturn5d": round(sum(s["ret_5d"] for s in signals) / len(signals), 4),
            "buyHitRate": buy_hr_c,
            "buyCount": buy_n_c,
            "scoreCorr": pearson([s["actionScore"] for s in signals], [s["ret_5d"] for s in signals]),
        }

    analysis = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "period": f"{args.start}~{args.end}",
        "totalSignals": len(all_signals),
        "signalsWithReturn": len(with_5d),
        "holdingsCount": len(all_prices),
        "scoreReturnCorrelation": score_corr,
        "signalHitRates": {
            "buy_72_hit_5d": {"rate": buy_hr, "count": buy_n},
            "hold_58_hit_5d": {"rate": hold_hr, "count": hold_n},
            "reduce_42_hit_5d": {"rate": reduce_hr, "count": reduce_n},
        },
        "factorCorrelation": {
            "momentum_vs_ret5d": momentum_corr,
        },
        "monthlyBreakdown": monthly_stats,
        "byHolding": code_stats,
    }

    # 출력
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2) + "\n")
    print(f"\n[backtest] 결과 저장: {output_path}", file=sys.stderr)

    # 요약 출력
    print("\n" + "=" * 60)
    print(f"백테스트 요약: {args.start}~{args.end}")
    print(f"총 시그널: {len(all_signals)}, 5d return 확보: {len(with_5d)}")
    print(f"종목 수: {len(all_prices)}")
    print("=" * 60)

    print(f"\n점수-수익률 상관관계:")
    for key, val in score_corr.items():
        print(f"  {key}: r={val['r']} (n={val['n']})")

    print(f"\n시그널 적중률:")
    print(f"  BUY(≥72):    {buy_hr} ({buy_n}건)")
    print(f"  HOLD(≥58):   {hold_hr} ({hold_n}건)")
    print(f"  REDUCE(≤42): {reduce_hr} ({reduce_n}건)")

    print(f"\n팩터 상관:")
    print(f"  momentum vs ret_5d: {momentum_corr}")

    print(f"\n월별:")
    for month, stats in sorted(monthly_stats.items()):
        print(f"  {month}: n={stats['signals']}, avgRet={stats['avgReturn5d']}%, "
              f"buyHR={stats['buyHitRate']}({stats['buyCount']}), scoreCorr={stats['scoreCorr']}")

    print(f"\n종목별:")
    for code, stats in sorted(code_stats.items(), key=lambda x: x[1]["avgReturn5d"], reverse=True):
        print(f"  {code} {stats['name'][:20]}: n={stats['signals']}, avgRet={stats['avgReturn5d']}%, "
              f"buyHR={stats['buyHitRate']}({stats['buyCount']}), scoreCorr={stats['scoreCorr']}")

    # JSON도 stdout으로
    json.dump(analysis, sys.stdout, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
