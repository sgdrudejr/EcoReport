"""
StockPilot Full Backtest (전체 보유 기간 + 내장 60일 히스토리 활용)
====================================================================
data/technical/*.json 의 daily_returns 60일치를 역산해 확장된 가격 시계열 구성.
점수 구간별 수익률 분석 + 팩터 효과 분석 포함.
"""

import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

# ── 경로 / 종목 ───────────────────────────────────────────────────────

REPO = Path(__file__).parent.parent
TECH_DIR = REPO / "data" / "technical"

HELD = {
    "047810": "한국항공우주",
    "064350": "현대로템",
    "138910": "KODEX 구리선물(H)",
    "434730": "HANARO 원자력iSelect",
    "449450": "PLUS K방산",
}
CANDIDATES = {
    "360750": "TIGER S&P500",
    "133690": "TIGER 나스닥100",
    "458760": "TIGER 미국배당+7%",
    "132030": "KODEX 골드선물",
    "487240": "KODEX AI전력설비",
    "000660": "SK하이닉스",
    "267260": "HD현대일렉트릭",
    "298040": "효성중공업",
    "010120": "LS일렉트릭",
    "423160": "KODEX KOFR",
}
ALL_CODES = {**HELD, **CANDIDATES}

# ── 팩터 계산 (동일 로직) ─────────────────────────────────────────────

def safe(v, default=0):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return default
    return v

def score_rs(s):
    rs = safe(s.get("relative_strength", {}).get("rs_vs_benchmark"), 0)
    if rs >= 0.3: return 100
    if rs >= 0.15: return 80
    if rs >= 0.0: return 60
    if rs >= -0.15: return 40
    if rs >= -0.3: return 20
    return 0

def score_ichimoku(s):
    close = safe(s.get("close"), 0)
    ichi = s.get("ichimoku") or {}
    span_a = safe(ichi.get("senkou_span_a"), 0)
    span_b = safe(ichi.get("senkou_span_b"), 0)
    cloud_top = max(span_a, span_b)
    cloud_bot = min(span_a, span_b)
    if cloud_top <= 0: return 50
    if close > cloud_top:
        ratio = (close - cloud_top) / cloud_top
        return min(100, 60 + ratio * 200)
    if close < cloud_bot:
        ratio = (cloud_bot - close) / cloud_bot
        return max(0, 40 - ratio * 200)
    return 50

def score_adx_momentum(s):
    # [개선 v1.2] 방향 인식: close vs ma60 기준 bullish/bearish 판별
    adx_d = s.get("adx") or {}
    adx = safe(adx_d.get("value"), 0)
    close = safe(s.get("close"), 0)
    ma = s.get("ma") or {}
    ma60 = safe(ma.get("ma60"), 0)
    close_252d = safe(s.get("close_252d"), 0)
    if close_252d <= 0: return 50
    annual_mom = (close / close_252d - 1) * 25
    adx_strength = (adx - 20) * 0.25
    is_bullish = (close > ma60) if ma60 > 0 else (annual_mom >= 0)
    directed_adx = adx_strength if is_bullish else -adx_strength
    raw = 5 + directed_adx + annual_mom   # JS: clamp(5 + directedAdx + annualMom, 0, 10)
    return max(0, min(10, raw)) * 10      # 0-100 scale

def score_heikin_ashi(s):
    # [개선 v1.1] 양방향: 음봉도 차별화 (강한 음봉=0, 중립=50, 강한 양봉=100)
    ha = s.get("heikin_ashi") or {}
    if not ha: return 50
    ha_open = safe(ha.get("ha_open") or ha.get("open"), 0)
    ha_close = safe(ha.get("ha_close") or ha.get("close"), 0)
    if ha_open <= 0: return 50
    close = safe(s.get("close"), 0)
    ha_body = (ha_close - ha_open) / ha_open
    price_confirm = 1.1 if (close > 0 and close >= ha_close) else 0.9
    # JS: clamp(5 + haBody * 200 * priceConfirm, 0, 10) → * 10 for 0-100 scale
    raw = 5 + ha_body * 200 * price_confirm
    return max(0, min(10, raw)) * 10  # 0-100 scale

def score_keltner_volume(s):
    close = safe(s.get("close"), 0)
    kelt = s.get("keltner") or {}
    upper = safe(kelt.get("upper"), 0)
    vol_ratio = safe(s.get("volume_ratio"), 1)
    if upper <= 0: return 50
    kelt_break = (close - upper) / upper
    if kelt_break > 0 and vol_ratio >= 1.5: return 100
    if kelt_break > 0: return 75
    if kelt_break > -0.03: return 55
    return 30

def score_poc(s):
    close = safe(s.get("close"), 0)
    vp = s.get("volume_profile") or {}
    poc = safe(vp.get("poc_price_120d"), 0)
    if poc <= 0: return 50
    ratio = (close - poc) / poc
    if ratio > 0.05: return 80
    if ratio > 0: return 65
    if ratio > -0.05: return 50
    return 30

def score_vwap(s):
    close = safe(s.get("close"), 0)
    vwap_d = s.get("anchored_vwap") or {}
    vwap = safe(vwap_d.get("value"), 0)
    if vwap <= 0: return 50
    ratio = (close - vwap) / vwap
    if ratio > 0.05: return 85
    if ratio > 0: return 65
    if ratio > -0.03: return 50
    return 30

def score_resistance_break(s):
    close = safe(s.get("close"), 0)
    recent = s.get("recent_high") or {}
    rh = safe(recent.get("value") if isinstance(recent, dict) else recent, 0)
    if rh <= 0: return 50
    ratio = close / rh
    if ratio >= 0.98: return 85
    if ratio >= 0.90: return 65
    if ratio >= 0.80: return 45
    return 25

def score_rsi_divergence(s):
    # [개선 v1.1] RSI 다이버전스 → RSI 모멘텀 (과매도 회복 감지)
    # 원래 price_drop_ratio/rsi_rise_value는 항상 null
    rsi_d = s.get("rsi") or {}
    rsi = safe(rsi_d.get("rsi_14") if isinstance(rsi_d, dict) else rsi_d, None)
    if rsi is None:
        return 0  # 데이터 없으면 0 (이전 50→0 개선)
    if rsi <= 30: return 100   # 극도 과매도 = 반등 기대
    if rsi <= 40: return 75
    if rsi <= 55: return 40    # 중립
    if rsi <= 70: return 20    # 과매수 주의
    return 0                    # 극도 과매수

def score_golden_cross(s):
    # [개선 v1.1] 이진 게이트 → 연속 MA 모멘텀 점수
    # JS: gap = (ma_20 - ma_60) / ma_60, 범위 0-5 → * 20 for 0-100 scale
    ma = s.get("ma") or {}
    ma20 = safe(ma.get("ma20"), 0)
    ma60 = safe(ma.get("ma60"), 0)
    if ma60 <= 0: return 50
    gap = (ma20 - ma60) / ma60
    if gap > 0.08:  return 2 * 20   # 과매수 구간
    if gap > 0.02:  return 4 * 20   # 건강한 상승추세
    if gap >= 0:    return 5 * 20   # 방금 골든크로스 (최적)
    if gap >= -0.02: return 4 * 20  # 크로스 임박
    if gap >= -0.05: return 2 * 20  # 회복 조짐
    return max(0, min(20, (1 + (gap + 0.05) * 20) * 20))  # 깊은 하락

def score_stochastic(s):
    stoch = s.get("stochastic") or {}
    k = safe(stoch.get("k"), 50)
    d = safe(stoch.get("d"), 50)
    if k < 20: return 30
    if k > 80: return 40
    if k > d: return 75
    return 50

def score_disparity(s):
    close = safe(s.get("close"), 0)
    ma = s.get("ma") or {}
    ma60 = safe(ma.get("ma60"), 0)
    if ma60 <= 0: return 50
    disp = (close - ma60) / ma60
    if disp > 0.15: return 35
    if disp > 0.05: return 65
    if disp > -0.05: return 70
    if disp > -0.15: return 55
    return 40

def score_rsi_level(s):
    """RSI 레벨 팩터 (현재 formula에 없는 추가 후보)"""
    rsi_d = s.get("rsi") or {}
    rsi = safe(rsi_d.get("rsi_14") if isinstance(rsi_d, dict) else rsi_d, 50)
    if rsi < 30: return 85   # 과매도 반등 기대
    if rsi < 40: return 70
    if rsi <= 60: return 55  # 중립
    if rsi <= 70: return 45
    return 30                 # 과매수

# 레짐별 팩터 배율 (JS 동일)
REGIME_MULTIPLIERS = {
    "Risk-Off_DollarStrength": {
        "RS": 1.5, "Ichimoku": 1.3, "Divergence": 1.4,
        "ADX_Mom": 0.5, "HA": 0.7, "GoldenCross": 0.6,
        "Keltner_Vol": 0.8, "Stochastic": 1.2, "Disparity": 1.2,
        "POC": 0.9, "VWAP": 0.9, "Resistance": 0.8,
    },
    "BULL": {k: 1.0 for k in ["RS","Ichimoku","ADX_Mom","HA","Keltner_Vol",
                               "POC","VWAP","Resistance","Divergence","GoldenCross","Stochastic","Disparity"]},
}

BASE_ORIG_MAX = {
    "RS": 10, "Ichimoku": 10, "ADX_Mom": 10, "HA": 10,
    "Keltner_Vol": 15, "POC": 7.5, "VWAP": 7.5, "Resistance": 15,
    "Divergence": 10, "GoldenCross": 5, "Stochastic": 10, "Disparity": 5,
}

def compute_quant_score(s):
    factors = {
        "RS":          score_rs(s),
        "Ichimoku":    score_ichimoku(s),
        "ADX_Mom":     score_adx_momentum(s),
        "HA":          score_heikin_ashi(s),
        "Keltner_Vol": score_keltner_volume(s),
        "POC":         score_poc(s),
        "VWAP":        score_vwap(s),
        "Resistance":  score_resistance_break(s),
        "Divergence":  score_rsi_divergence(s),
        "GoldenCross": score_golden_cross(s),
        "Stochastic":  score_stochastic(s),
        "Disparity":   score_disparity(s),
    }
    # 퍼센타일 정규화는 전체 유니버스 계산 후 applyPercentile에서 처리
    return {"factors": factors, "final_score": None}  # 임시


def applyPercentile(all_scores_by_date: dict, regime_name: str = "BULL") -> dict:
    """날짜별로 교차단면 퍼센타일 정규화 + 레짐 가중치 적용 후 final_score 재계산"""
    mults = REGIME_MULTIPLIERS.get(regime_name, REGIME_MULTIPLIERS["BULL"])
    result = {}
    for date, code_scores in all_scores_by_date.items():
        factor_vals = {f: [] for f in BASE_ORIG_MAX}
        codes = list(code_scores.keys())
        for code in codes:
            for f in BASE_ORIG_MAX:
                v = code_scores[code]["factors"].get(f)
                if v is not None:
                    factor_vals[f].append((v, code))
        # 팩터별 정렬
        factor_sorted = {f: sorted(vals, key=lambda x: x[0]) for f, vals in factor_vals.items()}

        result[date] = {}
        for code in codes:
            pf = {}
            raw_total = 0
            filter_score = code_scores[code].get("filter_score", 1)
            for f in BASE_ORIG_MAX:
                orig = code_scores[code]["factors"].get(f)
                if orig is None:
                    pf[f] = None
                    continue
                sorted_f = factor_sorted[f]
                n = len(sorted_f)
                idx = next((i for i, (v, _) in enumerate(sorted_f) if v == orig), 0)
                ties = sum(1 for v, _ in sorted_f if v == orig)
                avg_rank = idx + (ties - 1) / 2
                pct = (avg_rank / max(n - 1, 1)) * 100 if n > 1 else 50.0
                mult = mults.get(f, 1.0)
                adj = max(0, min(100, 50 + (pct - 50) * mult)) if mult != 1.0 else pct
                pf[f] = round(adj, 2)
                raw_total += (adj / 100) * BASE_ORIG_MAX[f]
            final = round(max(0, min(100, filter_score * raw_total)) * 10) / 10
            result[date][code] = {
                "factors": pf,
                "final_score": final,
                "filter_score": filter_score,
            }
    return result


# ── 가격 시계열 재구성 ────────────────────────────────────────────────

def reconstruct_price_history(s: dict) -> list[float]:
    """daily_returns 60개 + close 로 60+1개 가격 리스트 반환 (오래된 → 최근)"""
    dr = s.get("daily_returns", [])
    close = safe(s.get("close"), 0)
    if not dr or close <= 0:
        return []
    prod = 1.0
    for r in dr:
        prod *= (1 + r)
    oldest = close / prod
    prices = [oldest]
    for r in dr:
        prices.append(prices[-1] * (1 + r))
    return prices


def load_series():
    dates = sorted([f.stem for f in TECH_DIR.glob("*.json")])
    series = {}
    for date in dates:
        d = json.loads((TECH_DIR / f"{date}.json").read_text())
        series[date] = d.get("scores", {})
    return series, dates


# ── 미래 수익률 계산 (1/3/5/10일) ─────────────────────────────────────

def build_forward_returns(series, dates):
    """
    각 날짜·종목에 대해 close 기준 forward returns 계산.
    data/technical의 close를 날짜 시퀀스로 사용.
    """
    # code → date → close
    close_map = defaultdict(dict)
    for date in dates:
        for code, s in series[date].items():
            cl = safe(s.get("close"), 0)
            if cl > 0:
                close_map[code][date] = cl

    # forward returns
    fwd = {}
    for code, date_prices in close_map.items():
        sorted_dates = sorted(date_prices.keys())
        fwd[code] = {}
        for i, date in enumerate(sorted_dates):
            c0 = date_prices[date]
            entry = {}
            # N일 후
            for n in [1, 2, 3, 5]:
                if i + n < len(sorted_dates):
                    cn = date_prices[sorted_dates[i + n]]
                    entry[f"fwd_{n}d"] = (cn - c0) / c0 * 100
                else:
                    entry[f"fwd_{n}d"] = None
            # 기간 전체 (첫 날 → 마지막 날)
            first_date = sorted_dates[0]
            last_date = sorted_dates[-1]
            c_first = date_prices[first_date]
            c_last = date_prices[last_date]
            entry["period_return"] = (c_last - c_first) / c_first * 100
            fwd[code][date] = entry
    return fwd, close_map


# ── 점수 구간별 수익률 분석 ───────────────────────────────────────────

def score_bucket(score):
    if score >= 65: return "HIGH (≥65)"
    if score >= 55: return "MID (55-64)"
    if score >= 45: return "LOW (45-54)"
    return "VERY_LOW (<45)"

def analyze_score_buckets(all_scores, fwd_returns, dates):
    """점수 구간별 평균 forward return"""
    buckets = defaultdict(lambda: defaultdict(list))  # bucket → fwd_N → [returns]
    pairs = []  # (score, fwd_1d, fwd_3d)

    for code in all_scores:
        for date in dates[:-1]:  # 마지막 날은 forward 없음
            if date not in all_scores[code]:
                continue
            if code not in fwd_returns or date not in fwd_returns[code]:
                continue
            sc = all_scores[code][date]["final_score"]
            bk = score_bucket(sc)
            fwd = fwd_returns[code][date]
            for key, val in fwd.items():
                if val is not None:
                    buckets[bk][key].append(val)
            if fwd.get("fwd_1d") is not None:
                pairs.append((sc, fwd["fwd_1d"], fwd.get("fwd_3d"), date, code))

    result = {}
    for bk, metrics in buckets.items():
        result[bk] = {}
        for key, vals in metrics.items():
            if vals:
                result[bk][key] = {
                    "mean": round(statistics.mean(vals), 3),
                    "median": round(statistics.median(vals), 3),
                    "std": round(statistics.stdev(vals) if len(vals) > 1 else 0, 3),
                    "n": len(vals),
                    "win_rate": round(sum(1 for v in vals if v > 0) / len(vals) * 100, 1),
                }
    return result, pairs


# ── 팩터 개별 IC (정보계수) ───────────────────────────────────────────

def compute_factor_ic(all_scores, fwd_returns, dates):
    """각 팩터별로 1일 forward return과의 Spearman IC 계산"""
    factor_names = list(BASE_ORIG_MAX.keys())
    factor_data = defaultdict(list)  # factor → [(factor_score, fwd_1d)]

    for code in all_scores:
        for date in dates[:-1]:
            if date not in all_scores[code]: continue
            if code not in fwd_returns or date not in fwd_returns[code]: continue
            fwd_1d = fwd_returns[code][date].get("fwd_1d")
            if fwd_1d is None: continue
            for fname in factor_names:
                fval = all_scores[code][date]["factors"].get(fname, 50)
                factor_data[fname].append((fval, fwd_1d))

    ic_results = {}
    for fname, pairs in factor_data.items():
        if len(pairs) < 5:
            ic_results[fname] = {"ic": 0, "n": len(pairs)}
            continue
        n = len(pairs)
        sorted_by_f = sorted(range(n), key=lambda i: pairs[i][0])
        sorted_by_r = sorted(range(n), key=lambda i: pairs[i][1])
        f_rank = {i: r for r, i in enumerate(sorted_by_f)}
        r_rank = {i: r for r, i in enumerate(sorted_by_r)}
        d2 = sum((f_rank[i] - r_rank[i]) ** 2 for i in range(n))
        rho = 1 - (6 * d2) / (n * (n**2 - 1))
        ic_results[fname] = {"ic": round(rho, 4), "n": n}

    return ic_results


# ── Spearman 상관 ─────────────────────────────────────────────────────

def spearman(pairs):
    """pairs: list of (x, y)"""
    n = len(pairs)
    if n < 3: return 0
    sx = sorted(range(n), key=lambda i: pairs[i][0])
    sy = sorted(range(n), key=lambda i: pairs[i][1])
    xr = {i: r for r, i in enumerate(sx)}
    yr = {i: r for r, i in enumerate(sy)}
    d2 = sum((xr[i] - yr[i])**2 for i in range(n))
    return 1 - (6 * d2) / (n * (n**2 - 1))


# ── 리포트 출력 ───────────────────────────────────────────────────────

def print_full_report(dates, all_scores, fwd_returns, close_map, score_buckets, factor_ic, pairs):
    W = "=" * 75
    SEP = "─" * 75

    print(f"\n{W}")
    print("  StockPilot Full Backtest Report  |  모든 보유 날짜 + 60일 히스토리")
    print(f"  기간: {dates[0]} ~ {dates[-1]}  |  {len(dates)}영업일  |  {len(ALL_CODES)}종목")
    print(W)

    # ── 1. 전체 점수 분포 ────────────────────────────
    all_final = [
        all_scores[c][d]["final_score"]
        for c in all_scores for d in all_scores[c]
    ]
    mean_s = statistics.mean(all_final)
    std_s  = statistics.stdev(all_final) if len(all_final) > 1 else 0
    print(f"\n{SEP}")
    print("  [1] 전체 점수 분포")
    print(SEP)
    print(f"  n={len(all_final)}  평균={mean_s:.1f}  σ={std_s:.1f}  "
          f"중앙={statistics.median(all_final):.1f}  최소={min(all_final):.1f}  최대={max(all_final):.1f}")
    # ASCII 히스토그램
    buckets_hist = [0] * 10
    for sc in all_final:
        idx = min(9, int(sc // 10))
        buckets_hist[idx] += 1
    total = len(all_final)
    print()
    for i, cnt in enumerate(buckets_hist):
        bar = "█" * max(0, int(cnt / total * 50))
        pct = cnt / total * 100
        print(f"  {i*10:3d}~{i*10+9:3d}  {bar:<50}  {cnt:3d} ({pct:.0f}%)")

    # ── 2. 팩터 IC ───────────────────────────────────
    print(f"\n{SEP}")
    print("  [2] 팩터별 IC (Spearman ρ vs 1일 forward return)  ← 핵심 예측력 지표")
    print(SEP)
    print(f"  {'팩터':<20}  {'IC':>8}  {'n':>5}  판정")
    sorted_ic = sorted(factor_ic.items(), key=lambda x: abs(x[1]["ic"]), reverse=True)
    for fname, r in sorted_ic:
        ic = r["ic"]
        verdict = "✓ 유의미" if abs(ic) >= 0.15 else ("△ 약함" if abs(ic) >= 0.05 else "✗ 무효")
        direction = "↑(순방향)" if ic > 0 else "↓(역방향)" if ic < 0 else ""
        print(f"  {fname:<20}  {ic:>+8.4f}  {r['n']:>5}  {verdict} {direction}")

    # ── 3. 점수 구간별 수익률 ────────────────────────
    print(f"\n{SEP}")
    print("  [3] 점수 구간별 Forward Return 통계")
    print(SEP)
    bucket_order = ["HIGH (≥65)", "MID (55-64)", "LOW (45-54)", "VERY_LOW (<45)"]
    horizons = ["fwd_1d", "fwd_2d", "fwd_3d", "fwd_5d"]
    hz_labels = ["1일후", "2일후", "3일후", "5일후"]

    header = f"  {'구간':<18}"
    for h in hz_labels:
        header += f"  {h:>10}"
    print(header)
    print(f"  {'':─<18}" + "──────────" * len(hz_labels))

    for bk in bucket_order:
        if bk not in score_buckets:
            continue
        row = f"  {bk:<18}"
        for hz in horizons:
            if hz in score_buckets[bk]:
                stats = score_buckets[bk][hz]
                row += f"  {stats['mean']:>+6.2f}% (W{stats['win_rate']:.0f}%)"
            else:
                row += "       -      "
        print(row)

    print(f"\n  ※ W=승률(수익>0인 비율)")

    # 구간별 승률 요약
    print(f"\n  구간별 평균 1일 수익률 비교:")
    for bk in bucket_order:
        if bk in score_buckets and "fwd_1d" in score_buckets[bk]:
            s = score_buckets[bk]["fwd_1d"]
            bar_len = int(abs(s["mean"]) * 20)
            bar = ("+" if s["mean"] >= 0 else "-") * bar_len
            print(f"  {bk:<18}  {s['mean']:>+6.3f}%  |{bar:<20}|  승률 {s['win_rate']:.0f}%  n={s['n']}")

    # ── 4. 날짜별 Spearman ρ ──────────────────────────
    print(f"\n{SEP}")
    print("  [4] 날짜별 전체 점수 → 1일 forward return Spearman ρ")
    print(SEP)
    date_rhos = []
    for date in dates[:-1]:
        day_pairs = []
        for code in all_scores:
            if date not in all_scores[code]: continue
            if code not in fwd_returns or date not in fwd_returns[code]: continue
            fwd = fwd_returns[code][date].get("fwd_1d")
            if fwd is None: continue
            sc = all_scores[code][date]["final_score"]
            day_pairs.append((sc, fwd))
        if len(day_pairs) < 3: continue
        rho = spearman(day_pairs)
        date_rhos.append((date, rho, len(day_pairs)))
        bar = "+" * int(abs(rho) * 25) if rho > 0 else "-" * int(abs(rho) * 25)
        print(f"  {date}  ρ={rho:+.3f}  |{bar:<25}|  n={len(day_pairs)}")
    if date_rhos:
        avg_rho = statistics.mean(r for _, r, _ in date_rhos)
        print(f"\n  평균 ρ = {avg_rho:+.3f}  (|ρ|>0.3 유의미 / >0.5 강함)")

    # ── 5. 종목별 점수 시계열 + 누적 수익률 ──────────
    print(f"\n{SEP}")
    print("  [5] 종목별 점수 시계열 & 누적 수익률")
    print(SEP)
    header = f"  {'종목':<20}"
    for d in dates: header += f" {d[5:]:>8}"
    header += f"  {'누적수익':>8}"
    print(header)
    print(f"  {'':─<20}" + "─"*9*len(dates) + "──────────")

    for code, name in sorted(ALL_CODES.items(), key=lambda x: x[1]):
        row = f"  {name:<20}"
        for d in dates:
            if code in all_scores and d in all_scores[code]:
                sc = all_scores[code][d]["final_score"]
                row += f" {sc:>8.1f}"
            else:
                row += f" {'N/A':>8}"
        # 누적 수익률 (첫 close → 마지막 close)
        if code in close_map:
            sorted_d = sorted(close_map[code].keys())
            if len(sorted_d) >= 2:
                c0 = close_map[code][sorted_d[0]]
                cn = close_map[code][sorted_d[-1]]
                cum = (cn - c0) / c0 * 100
                row += f"  {cum:>+7.2f}%"
        print(row)

    # ── 6. 팩터 상세 (최종일) ────────────────────────
    final_date = dates[-1]
    print(f"\n{SEP}")
    print(f"  [6] 팩터별 상세 점수 ({final_date} 기준)")
    print(SEP)
    print(f"  {'종목':<20} {'RS':>5} {'Ich':>5} {'ADX':>5} {'HA':>5} {'Kelt':>5} {'POC':>5} {'VW':>5} {'Res':>5} {'Div':>5} {'GC':>5} {'Stch':>5} {'Disp':>5}  {'총점':>6}")
    print(f"  {'':─<20}" + "──────"*12 + "────────")
    for code, name in sorted(ALL_CODES.items(), key=lambda x: x[1]):
        if code not in all_scores or final_date not in all_scores[code]: continue
        f = all_scores[code][final_date]["factors"]
        sc = all_scores[code][final_date]["final_score"]
        print(
            f"  {name:<20}"
            f" {f['RS']:>5.0f} {f['Ichimoku']:>5.0f} {f['ADX_Mom']:>5.0f}"
            f" {f['HA']:>5.0f} {f['Keltner_Vol']:>5.0f} {f['POC']:>5.0f}"
            f" {f['VWAP']:>5.0f} {f['Resistance']:>5.0f} {f['Divergence']:>5.0f}"
            f" {f['GoldenCross']:>5.0f} {f['Stochastic']:>5.0f} {f['Disparity']:>5.0f}"
            f"  {sc:>6.1f}"
        )

    # ── 7. 핵심 진단 & 개선안 ─────────────────────────
    print(f"\n{SEP}")
    print("  [7] 핵심 진단 & 수식 개선안")
    print(SEP)

    improvements = []

    # 점수 압축
    if std_s < 8:
        improvements.append({
            "grade": "🔴 CRITICAL",
            "issue": f"점수 압축 (σ={std_s:.1f}) — 모든 종목이 50~70점에 몰려 선택 불가",
            "fix": [
                "각 팩터 출력에 percentile 변환 적용: (rank / n) * 100",
                "중립점 50 대신 실제 우주 분포 기준으로 z-score 스케일링",
                "팩터 간 상관관계 제거 (PCA 후 직교 팩터 사용)",
            ]
        })

    # 역방향 IC 팩터들
    neg_ic_factors = [(f, r["ic"]) for f, r in factor_ic.items() if r["ic"] < -0.1]
    if neg_ic_factors:
        for fname, ic in neg_ic_factors:
            improvements.append({
                "grade": "🔴 HIGH",
                "issue": f"{fname} IC={ic:.4f} — 역방향 예측 (높을수록 수익 나쁨)",
                "fix": [
                    f"{fname} 팩터 점수 반전 적용 (100 - score) 또는 비중 0으로 제거",
                    "해당 팩터가 역추세 지표인지 검토 (e.g. Resistance는 고점 근접 = 리스크)"
                ]
            })

    # 제로 변동 팩터
    zero_ic = [(f, r) for f, r in factor_ic.items() if abs(r["ic"]) < 0.02]
    for fname, r in zero_ic:
        improvements.append({
            "grade": "🟡 MEDIUM",
            "issue": f"{fname} IC≈0 — 예측력 없음 (σ 낮거나 데이터 부족)",
            "fix": [
                f"{fname} 팩터 비중 0 (제거) 또는 데이터 품질 개선 후 재도입",
            ]
        })

    # 높은 IC 팩터 비중 강화 제안
    strong_ic = [(f, r["ic"]) for f, r in factor_ic.items() if r["ic"] > 0.15]
    if strong_ic:
        names = ", ".join(f"{f}(ρ={ic:.2f})" for f, ic in sorted(strong_ic, key=lambda x: -x[1]))
        improvements.append({
            "grade": "🟢 OPPORTUNITY",
            "issue": f"예측력 있는 팩터 발견: {names}",
            "fix": ["해당 팩터 비중을 현재 대비 2x 상향 조정", "앙상블 가중치 IC 비례 배분 (IC-weighted)"]
        })

    # 기간 전체 Spearman
    if date_rhos:
        avg_rho = statistics.mean(r for _, r, _ in date_rhos)
        if avg_rho < 0:
            improvements.append({
                "grade": "🔴 CRITICAL",
                "issue": f"평균 ρ={avg_rho:.3f} < 0 — 현재 모델이 수익률을 역으로 예측하고 있음",
                "fix": [
                    "GoldenCross / Resistance 등 고편향 팩터 즉시 재보정",
                    "Risk-Off 레짐 중에는 모든 점수에 -10 패널티 적용",
                    "RS 팩터 단독으로만 사용했을 때 IC 재측정 후 베이스라인 설정"
                ]
            })

    for i, imp in enumerate(improvements):
        print(f"\n  {i+1}. {imp['grade']}")
        print(f"     문제: {imp['issue']}")
        for fix in imp["fix"]:
            print(f"     → {fix}")

    print(f"\n{W}\n")


# ── 메인 ──────────────────────────────────────────────────────────────

def main():
    print("데이터 로드 중...")
    series, dates = load_series()

    print(f"퀀트 점수 계산 중... ({len(dates)}일 × {len(ALL_CODES)}종목)")
    # 1단계: raw 팩터 계산 (날짜×종목)
    raw_by_date = {}
    for date in dates:
        raw_by_date[date] = {}
        for code in ALL_CODES:
            if code in series[date]:
                result = compute_quant_score(series[date][code])
                result["filter_score"] = 1
                raw_by_date[date][code] = result

    # 2단계: 퍼센타일 정규화 + 레짐 가중치 (4월 = Risk-Off)
    BACKTEST_REGIME = "Risk-Off_DollarStrength"
    print(f"  → 레짐 가중치: {BACKTEST_REGIME}")
    normalized_by_date = applyPercentile(raw_by_date, BACKTEST_REGIME)

    # 3단계: code→date 형태로 재구성
    all_scores = {}
    for date, code_map in normalized_by_date.items():
        for code, result in code_map.items():
            if code not in all_scores:
                all_scores[code] = {}
            all_scores[code][date] = result

    print("Forward return 계산 중...")
    fwd_returns, close_map = build_forward_returns(series, dates)

    print("점수 구간별 분석 중...")
    score_buckets, pairs = analyze_score_buckets(all_scores, fwd_returns, dates)

    print("팩터 IC 계산 중...")
    factor_ic = compute_factor_ic(all_scores, fwd_returns, dates)

    print_full_report(dates, all_scores, fwd_returns, close_map, score_buckets, factor_ic, pairs)

    # 저장
    out = {
        "dates": dates,
        "scores": {c: {d: v for d, v in by_d.items()} for c, by_d in all_scores.items()},
        "score_buckets": score_buckets,
        "factor_ic": factor_ic,
        "fwd_returns": {c: {d: v for d, v in by_d.items()} for c, by_d in fwd_returns.items() if c in ALL_CODES},
    }
    out_path = REPO / "data" / "backtest" / "quant_full_backtest.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"✓ 결과 저장: {out_path}")


if __name__ == "__main__":
    main()
