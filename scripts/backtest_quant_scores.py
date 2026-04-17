"""
StockPilot Quant Score Backtest (2026-04-06 ~ 2026-04-17)
==========================================================
외부 API 없이 data/technical/*.json 의 embedded 데이터만 사용.

목표:
  1. 날짜별 퀀트 점수 시계열 재현
  2. 실제 수익률(close-to-close) vs 퀀트 점수 비교
  3. 개별 팩터 편향 진단
  4. 개선 포인트 도출
"""

import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

# ── 경로 ──────────────────────────────────────────────────────────────

REPO = Path(__file__).parent.parent
TECH_DIR = REPO / "data" / "technical"

# ── 종목 정의 ─────────────────────────────────────────────────────────

HELD = {
    "047810": "한국항공우주",
    "064350": "현대로템",
    "138910": "KODEX 구리선물(H)",
    "434730": "HANARO 원자력iSelect",
    "449450": "PLUS K방산",
}

CANDIDATES = {
    "360750": "TIGER 미국 S&P500",
    "133690": "TIGER 미국 나스닥100",
    "458760": "TIGER 미국배당+7% 다우존스",
    "132030": "KODEX 골드선물(H)",
    "487240": "KODEX AI전력핵심설비",
    "000660": "SK하이닉스",
    "267260": "HD현대일렉트릭",
    "298040": "효성중공업",
    "010120": "LS일렉트릭",
    "423160": "KODEX KOFR금리액티브",
}

ALL_CODES = {**HELD, **CANDIDATES}

# ── 데이터 로드 ───────────────────────────────────────────────────────

def load_technical_series() -> dict:
    """날짜 → code → 지표 dict 형태로 로드"""
    dates = sorted([
        f.stem for f in TECH_DIR.glob("*.json")
        if f.stem >= "2026-04-06"
    ])
    series = {}
    for date in dates:
        path = TECH_DIR / f"{date}.json"
        d = json.loads(path.read_text())
        series[date] = d.get("scores", {})
    return series, dates


# ── 퀀트 팩터 계산 (stockpilot-quant.js 재현) ─────────────────────────

def safe(v, default=0):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return default
    return v

def score_rs(s: dict) -> float:
    """상대강도 (0~100): 벤치 대비 63일 RS"""
    rs = safe(s.get("relative_strength", {}).get("rs_vs_benchmark"), 0)
    # rs: 음수면 underperform, +0.3 이상 strong
    if rs >= 0.3: return 100
    if rs >= 0.15: return 80
    if rs >= 0.0: return 60
    if rs >= -0.15: return 40
    if rs >= -0.3: return 20
    return 0

def score_ichimoku(s: dict) -> float:
    """이치모쿠 구름 위/아래"""
    close = safe(s.get("close"), 0)
    ichi = s.get("ichimoku") or {}
    span_a = safe(ichi.get("senkou_span_a"), 0)
    span_b = safe(ichi.get("senkou_span_b"), 0)
    cloud_top = max(span_a, span_b)
    cloud_bot = min(span_a, span_b)
    if cloud_top <= 0:
        return 50
    if close > cloud_top:
        # 구름 위: 얼마나 위에 있나
        ratio = (close - cloud_top) / cloud_top
        return min(100, 60 + ratio * 200)
    if close < cloud_bot:
        ratio = (cloud_bot - close) / cloud_bot
        return max(0, 40 - ratio * 200)
    return 50  # 구름 안

def score_adx_momentum(s: dict) -> float:
    """ADX + PDI/MDI"""
    adx_d = s.get("adx") or {}
    adx = safe(adx_d.get("value"), 0)
    pdi = safe(adx_d.get("pdi"), 0)
    mdi = safe(adx_d.get("mdi"), 0)
    if adx < 15:
        return 50  # 추세 없음
    score = 50
    # 추세 강도
    if adx >= 30: score += 20
    elif adx >= 20: score += 10
    # 방향
    if pdi > mdi: score += 20
    else: score -= 20
    return max(0, min(100, score))

def score_heikin_ashi(s: dict) -> float:
    """헤이킨 아시 추세"""
    ha = s.get("heikin_ashi") or {}
    if not ha:
        return 50
    ha_open = safe(ha.get("ha_open"), 0)
    ha_close = safe(ha.get("ha_close"), 0)
    if ha_close > ha_open:
        # 양봉: 얼마나 강한가
        body = (ha_close - ha_open) / max(ha_open, 1)
        return min(100, 60 + body * 500)
    else:
        body = (ha_open - ha_close) / max(ha_open, 1)
        return max(0, 40 - body * 500)

def score_keltner_volume(s: dict) -> float:
    """켈트너 채널 + 거래량 비율"""
    close = safe(s.get("close"), 0)
    kelt = s.get("keltner") or {}
    upper = safe(kelt.get("upper"), 0)
    vol_ratio = safe(s.get("volume_ratio"), 1)
    if upper <= 0:
        return 50
    kelt_break = (close - upper) / upper  # + means breakout
    # 켈트너 돌파 + 거래량 확인
    if kelt_break > 0 and vol_ratio >= 1.5:
        return 100
    if kelt_break > 0:
        return 75
    if kelt_break > -0.03:
        return 55
    return 30

def score_poc(s: dict) -> float:
    """Volume Profile POC 대비 위치"""
    close = safe(s.get("close"), 0)
    vp = s.get("volume_profile") or {}
    poc = safe(vp.get("poc_price_120d"), 0)
    if poc <= 0:
        return 50
    ratio = (close - poc) / poc
    if ratio > 0.05: return 80
    if ratio > 0: return 65
    if ratio > -0.05: return 50
    return 30

def score_vwap(s: dict) -> float:
    """VWAP 대비 위치"""
    close = safe(s.get("close"), 0)
    vwap_d = s.get("anchored_vwap") or {}
    vwap = safe(vwap_d.get("value"), 0)
    if vwap <= 0:
        return 50
    ratio = (close - vwap) / vwap
    if ratio > 0.05: return 85
    if ratio > 0: return 65
    if ratio > -0.03: return 50
    return 30

def score_resistance_break(s: dict) -> float:
    """최근 고점 대비 위치"""
    close = safe(s.get("close"), 0)
    recent = s.get("recent_high") or {}
    rh = safe(recent.get("value") if isinstance(recent, dict) else recent, 0)
    if rh <= 0:
        return 50
    ratio = close / rh
    if ratio >= 0.98: return 85  # 고점 근처 = 강세
    if ratio >= 0.90: return 65
    if ratio >= 0.80: return 45
    return 25

def score_rsi_divergence(s: dict) -> float:
    """RSI 다이버전스"""
    div = s.get("rsi_divergence_metrics") or {}
    price_drop = div.get("price_drop_ratio")
    rsi_rise = div.get("rsi_rise_value")
    if price_drop is not None and rsi_rise is not None:
        # 가격 하락 + RSI 상승 = 강한 강세 다이버전스
        if price_drop < 0 and rsi_rise > 0:
            return 100
    return 50  # 데이터 없으면 중립

def score_golden_cross(s: dict) -> float:
    """골든크로스 (MA5 > MA20 > MA60)"""
    ma = s.get("ma") or {}
    ma5 = safe(ma.get("ma5"), 0)
    ma20 = safe(ma.get("ma20"), 0)
    ma60 = safe(ma.get("ma60"), 0)
    if ma5 > ma20 > ma60:
        return 90
    if ma5 > ma20:
        return 70
    if ma5 < ma20 < ma60:
        return 10  # 데드크로스
    return 50

def score_stochastic(s: dict) -> float:
    """스토캐스틱 K: 과매수/과매도 판단"""
    stoch = s.get("stochastic") or {}
    k = safe(stoch.get("k"), 50)
    d = safe(stoch.get("d"), 50)
    # 상승 모멘텀: K > D, K < 80 (과매수 아님)
    if k < 20:
        return 30  # 과매도 (역발상 아님 — 모멘텀 기준)
    if k > 80:
        return 40  # 과매수 = 진입 위험
    if k > d:
        return 75
    return 50

def score_disparity(s: dict) -> float:
    """MA60 이격도"""
    close = safe(s.get("close"), 0)
    ma = s.get("ma") or {}
    ma60 = safe(ma.get("ma60"), 0)
    if ma60 <= 0:
        return 50
    disp = (close - ma60) / ma60  # + means above MA60
    if disp > 0.15: return 35   # 과매수 영역
    if disp > 0.05: return 65
    if disp > -0.05: return 70  # MA60 근처 = 좋은 진입
    if disp > -0.15: return 55
    return 40  # 너무 아래

def compute_quant_score(s: dict) -> dict:
    """전체 팩터 계산 후 final_score 반환"""
    factors = {
        "RS": score_rs(s),
        "Ichimoku": score_ichimoku(s),
        "ADX_Mom": score_adx_momentum(s),
        "HA": score_heikin_ashi(s),
        "Keltner_Vol": score_keltner_volume(s),
        "POC": score_poc(s),
        "VWAP": score_vwap(s),
        "Resistance": score_resistance_break(s),
        "Divergence": score_rsi_divergence(s),
        "GoldenCross": score_golden_cross(s),
        "Stochastic": score_stochastic(s),
        "Disparity": score_disparity(s),
    }

    # 가중 평균 (현재 동일 가중)
    weights = {
        "RS": 1.5,        # 상대강도 우선
        "Ichimoku": 1.2,
        "ADX_Mom": 1.2,
        "HA": 0.8,
        "Keltner_Vol": 1.2,
        "POC": 0.8,
        "VWAP": 0.8,
        "Resistance": 1.0,
        "Divergence": 0.5,   # 데이터 희박
        "GoldenCross": 1.0,
        "Stochastic": 0.8,
        "Disparity": 0.7,
    }

    total_w = sum(weights.values())
    score = sum(factors[k] * weights[k] for k in factors) / total_w

    return {"factors": factors, "final_score": round(score, 1)}


# ── 수익률 계산 ───────────────────────────────────────────────────────

def build_return_table(series: dict, dates: list) -> dict:
    """code → date → close / return dict"""
    prices = defaultdict(dict)
    for date in dates:
        for code, s in series[date].items():
            cl = s.get("close")
            if cl:
                prices[code][date] = cl
    return prices


def compute_returns(prices: dict, dates: list) -> dict:
    """code → date → cumulative return from first date"""
    returns = defaultdict(dict)
    for code, p_map in prices.items():
        sorted_dates = [d for d in dates if d in p_map]
        if not sorted_dates:
            continue
        base = p_map[sorted_dates[0]]
        for d in sorted_dates:
            returns[code][d] = (p_map[d] - base) / base * 100
    return returns


# ── 편향 진단 ─────────────────────────────────────────────────────────

def diagnose_bias(all_scores: dict, returns: dict, dates: list) -> dict:
    """
    all_scores: code → date → {factors, final_score}
    returns: code → date → cumulative_return_pct

    반환:
      - score_distribution: 전 종목 점수 분포 통계
      - factor_bias: 팩터별 평균/std
      - score_vs_return: 날짜별 상관관계
      - top_bias_factors: 편향 심한 팩터 목록
    """
    result = {}

    # 1. 전체 점수 분포
    all_final = [
        all_scores[c][d]["final_score"]
        for c in all_scores for d in all_scores[c]
    ]
    result["score_distribution"] = {
        "mean": round(statistics.mean(all_final), 1),
        "median": round(statistics.median(all_final), 1),
        "stdev": round(statistics.stdev(all_final), 1),
        "min": round(min(all_final), 1),
        "max": round(max(all_final), 1),
        "count": len(all_final),
    }

    # 2. 팩터별 평균/편향
    factor_vals = defaultdict(list)
    for c in all_scores:
        for d in all_scores[c]:
            for f, v in all_scores[c][d]["factors"].items():
                factor_vals[f].append(v)

    factor_stats = {}
    bias_factors = []
    for f, vals in sorted(factor_vals.items()):
        mean_v = statistics.mean(vals)
        std_v = statistics.stdev(vals) if len(vals) > 1 else 0
        factor_stats[f] = {
            "mean": round(mean_v, 1),
            "stdev": round(std_v, 1),
            "min": round(min(vals), 1),
            "max": round(max(vals), 1),
        }
        # 편향 기준: 평균이 60 초과 or 10 미만 = 과편향
        # 또는 std < 10 = 변별력 없음
        issues = []
        if mean_v > 65: issues.append(f"평균 높음 ({mean_v:.0f})")
        if mean_v < 35: issues.append(f"평균 낮음 ({mean_v:.0f})")
        if std_v < 10: issues.append(f"변별력 부족 (σ={std_v:.1f})")
        if std_v > 40: issues.append(f"변동 과다 (σ={std_v:.1f})")
        if issues:
            bias_factors.append({"factor": f, "issues": issues, **factor_stats[f]})
    result["factor_stats"] = factor_stats
    result["bias_factors"] = bias_factors

    # 3. 최종 날짜 점수 vs 누적 수익률 (rank correlation)
    final_date = dates[-1]
    score_ret_pairs = []
    for code in all_scores:
        if final_date in all_scores[code] and final_date in returns.get(code, {}):
            sc = all_scores[code][final_date]["final_score"]
            ret = returns[code][final_date]
            score_ret_pairs.append((code, sc, ret))

    score_ret_pairs.sort(key=lambda x: x[1], reverse=True)
    result["score_vs_return_ranking"] = [
        {"code": c, "name": ALL_CODES.get(c, c), "score": sc, "cum_return_pct": round(ret, 2)}
        for c, sc, ret in score_ret_pairs
    ]

    # 4. 날짜별 점수-수익률 Spearman 상관 (순위 기반)
    correlations = []
    for date in dates[1:]:  # 첫날은 기준
        pairs = []
        for code in all_scores:
            if date in all_scores[code] and date in returns.get(code, {}):
                sc = all_scores[code][date]["final_score"]
                ret = returns[code][date]
                pairs.append((sc, ret))
        if len(pairs) < 3:
            continue
        # Spearman
        n = len(pairs)
        score_ranks = sorted(range(n), key=lambda i: pairs[i][0])
        ret_ranks = sorted(range(n), key=lambda i: pairs[i][1])
        sr = {code_i: r for r, code_i in enumerate(score_ranks)}
        rr = {code_i: r for r, code_i in enumerate(ret_ranks)}
        d2 = sum((sr[i] - rr[i]) ** 2 for i in range(n))
        rho = 1 - (6 * d2) / (n * (n ** 2 - 1))
        correlations.append({"date": date, "spearman_rho": round(rho, 3), "n": n})

    result["score_return_correlations"] = correlations
    if correlations:
        rhos = [c["spearman_rho"] for c in correlations]
        result["avg_spearman_rho"] = round(statistics.mean(rhos), 3)

    return result


# ── 개선 포인트 도출 ──────────────────────────────────────────────────

def derive_improvements(diagnosis: dict, all_scores: dict, returns: dict) -> list:
    improvements = []

    dist = diagnosis["score_distribution"]
    if dist["mean"] > 60:
        improvements.append({
            "area": "점수 인플레이션",
            "severity": "HIGH",
            "description": f"전체 평균 점수 {dist['mean']}점 — 과도하게 높음. 0~100 균형 조정 필요.",
            "suggestion": "각 팩터 기준점 재조정 (현재 중립=50 기준이 실제로 60+로 편향됨)",
        })

    if dist["stdev"] < 10:
        improvements.append({
            "area": "변별력 부족",
            "severity": "HIGH",
            "description": f"점수 표준편차 {dist['stdev']} — 종목 간 차별화가 안 됨.",
            "suggestion": "팩터 스케일 조정 또는 non-linear 변환 적용",
        })

    for bf in diagnosis["bias_factors"]:
        improvements.append({
            "area": f"팩터 편향: {bf['factor']}",
            "severity": "MEDIUM",
            "description": f"평균={bf['mean']}, σ={bf['stdev']} — {', '.join(bf['issues'])}",
            "suggestion": "해당 팩터의 scoring 기준선(breakpoint) 재보정",
        })

    rho = diagnosis.get("avg_spearman_rho", 0)
    if abs(rho) < 0.2:
        improvements.append({
            "area": "예측력 낮음",
            "severity": "HIGH",
            "description": f"평균 Spearman ρ = {rho} — 점수가 실제 수익률 순위와 거의 무관.",
            "suggestion": "RS 팩터 비중 강화 / 고점 대비 위치 팩터 재검토",
        })
    elif rho > 0.35:
        improvements.append({
            "area": "예측력 확인",
            "severity": "LOW",
            "description": f"평균 Spearman ρ = {rho} — 유의미한 예측력 있음.",
            "suggestion": "높은 ρ 팩터 비중을 더 높여 활용",
        })

    # 구체적 종목 분석: 점수 高 & 수익 低 (false positive)
    ranking = diagnosis.get("score_vs_return_ranking", [])
    top_score = ranking[:3]
    bottom_ret = sorted(ranking, key=lambda x: x["cum_return_pct"])[:3]
    fp = [r for r in top_score if r["cum_return_pct"] < 0]
    if fp:
        names = ", ".join(r["name"] for r in fp)
        improvements.append({
            "area": "False Positive 종목",
            "severity": "MEDIUM",
            "description": f"점수 상위권이지만 실제 하락: {names}",
            "suggestion": "시황 레짐 필터 강화 — Risk-Off 국면에서 모든 점수 일괄 패널티 적용",
        })

    return improvements


# ── 출력 포맷 ─────────────────────────────────────────────────────────

def print_report(series, dates, all_scores, returns, diagnosis, improvements):
    W = "=" * 70

    print(f"\n{W}")
    print("  StockPilot Quant Score Backtest Report")
    print(f"  기간: {dates[0]} ~ {dates[-1]} ({len(dates)}일)")
    print(f"  대상: {len(ALL_CODES)}종목 (보유 {len(HELD)} + 후보 {len(CANDIDATES)})")
    print(W)

    # 1. 점수 분포
    dist = diagnosis["score_distribution"]
    print(f"\n{'─'*70}")
    print(f"  [1] 전체 점수 분포 (n={dist['count']})")
    print(f"{'─'*70}")
    print(f"  평균: {dist['mean']:5.1f}  |  중앙값: {dist['median']:5.1f}  |  σ: {dist['stdev']:4.1f}")
    print(f"  최소: {dist['min']:5.1f}  |  최대: {dist['max']:5.1f}")

    # 히스토그램 (ASCII)
    buckets = [0] * 10
    for c in all_scores:
        for d in all_scores[c]:
            sc = all_scores[c][d]["final_score"]
            idx = min(9, int(sc // 10))
            buckets[idx] += 1
    total = sum(buckets)
    print()
    for i, cnt in enumerate(buckets):
        bar = "█" * int(cnt / max(total, 1) * 40)
        print(f"  {i*10:3d}-{i*10+9:3d} | {bar:<40} {cnt:3d}")

    # 2. 팩터별 편향
    print(f"\n{'─'*70}")
    print(f"  [2] 팩터별 점수 분포")
    print(f"{'─'*70}")
    print(f"  {'팩터':<20} {'평균':>6} {'σ':>6} {'최소':>6} {'최대':>6}  상태")
    for fname, fstat in sorted(diagnosis["factor_stats"].items()):
        mean = fstat["mean"]
        std = fstat["stdev"]
        # 상태 판정
        if mean > 65 or mean < 35:
            status = "⚠ 편향"
        elif std < 10:
            status = "⚠ 변별력↓"
        else:
            status = "✓"
        print(f"  {fname:<20} {mean:>6.1f} {std:>6.1f} {fstat['min']:>6.1f} {fstat['max']:>6.1f}  {status}")

    # 3. 날짜별 점수 시계열
    print(f"\n{'─'*70}")
    print(f"  [3] 날짜별 퀀트 점수 시계열")
    print(f"{'─'*70}")
    header = f"  {'종목':<22}"
    for d in dates:
        header += f" {d[5:]:>10}"
    print(header)
    print(f"  {'':-<22}" + "-" * (11 * len(dates)))

    for code, name in sorted(ALL_CODES.items(), key=lambda x: x[1]):
        row = f"  {name:<22}"
        for d in dates:
            if code in all_scores and d in all_scores[code]:
                sc = all_scores[code][d]["final_score"]
                row += f" {sc:>10.1f}"
            else:
                row += f" {'N/A':>10}"
        print(row)

    # 4. 누적 수익률 vs 점수
    print(f"\n{'─'*70}")
    print(f"  [4] 점수 vs 실제 수익률 ({dates[0]} → {dates[-1]})")
    print(f"{'─'*70}")
    ranking = diagnosis["score_vs_return_ranking"]
    print(f"  {'순위':>4}  {'종목':<26}  {'점수':>6}  {'수익률':>8}  판정")
    for i, r in enumerate(ranking):
        ret = r["cum_return_pct"]
        score = r["score"]
        if score >= 60 and ret > 0: verdict = "✓ 적중"
        elif score >= 60 and ret < 0: verdict = "✗ FP"
        elif score < 40 and ret < 0: verdict = "✓ 적중"
        elif score < 40 and ret > 0: verdict = "✗ FN"
        else: verdict = "△ 중립"
        ret_str = f"{ret:+.2f}%"
        print(f"  {i+1:>4}  {r['name']:<26}  {score:>6.1f}  {ret_str:>8}  {verdict}")

    # 5. 상관관계
    print(f"\n{'─'*70}")
    print(f"  [5] 날짜별 Spearman ρ (점수 순위 ↔ 수익률 순위)")
    print(f"{'─'*70}")
    for corr in diagnosis["score_return_correlations"]:
        rho = corr["spearman_rho"]
        bar = "+" if rho > 0 else "-"
        bar_len = int(abs(rho) * 30)
        bar_str = bar * bar_len
        print(f"  {corr['date']}  ρ={rho:+.3f}  |{bar_str:<30}|  n={corr['n']}")
    avg_rho = diagnosis.get("avg_spearman_rho", 0)
    print(f"\n  평균 ρ = {avg_rho:+.3f}  (|ρ|>0.3 = 유의미, |ρ|>0.5 = 강한 예측력)")

    # 6. 개선 포인트
    print(f"\n{'─'*70}")
    print(f"  [6] 개선 포인트 ({len(improvements)}건)")
    print(f"{'─'*70}")
    for i, imp in enumerate(improvements):
        sev_emoji = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(imp["severity"], "⚪")
        print(f"\n  {i+1}. {sev_emoji} [{imp['severity']}] {imp['area']}")
        print(f"     현황: {imp['description']}")
        print(f"     제안: {imp['suggestion']}")

    print(f"\n{W}\n")

    # 7. 개별 종목 팩터 상세 (최종일)
    final_date = dates[-1]
    print(f"\n{'─'*70}")
    print(f"  [7] 개별 팩터 상세 ({final_date})")
    print(f"{'─'*70}")
    print(f"  {'종목':<22} {'RS':>5} {'Ich':>5} {'ADX':>5} {'HA':>5} {'Kelt':>5} {'POC':>5} {'VW':>5} {'Res':>5} {'Div':>5} {'GC':>5} {'Stoch':>6} {'Disp':>5} {'총점':>6}")
    print(f"  {'':-<22}" + "-"*77)
    for code, name in sorted(ALL_CODES.items(), key=lambda x: x[1]):
        if code not in all_scores or final_date not in all_scores[code]:
            continue
        f = all_scores[code][final_date]["factors"]
        sc = all_scores[code][final_date]["final_score"]
        print(
            f"  {name:<22}"
            f" {f['RS']:>5.0f}"
            f" {f['Ichimoku']:>5.0f}"
            f" {f['ADX_Mom']:>5.0f}"
            f" {f['HA']:>5.0f}"
            f" {f['Keltner_Vol']:>5.0f}"
            f" {f['POC']:>5.0f}"
            f" {f['VWAP']:>5.0f}"
            f" {f['Resistance']:>5.0f}"
            f" {f['Divergence']:>5.0f}"
            f" {f['GoldenCross']:>5.0f}"
            f" {f['Stochastic']:>6.0f}"
            f" {f['Disparity']:>5.0f}"
            f" {sc:>6.1f}"
        )


# ── 메인 ──────────────────────────────────────────────────────────────

def main():
    print("데이터 로드 중...")
    series, dates = load_technical_series()
    prices = build_return_table(series, dates)
    returns = compute_returns(prices, dates)

    print("퀀트 점수 계산 중...")
    all_scores = {}
    for date in dates:
        for code in ALL_CODES:
            if code in series[date]:
                result = compute_quant_score(series[date][code])
                if code not in all_scores:
                    all_scores[code] = {}
                all_scores[code][date] = result

    print("편향 진단 중...")
    diagnosis = diagnose_bias(all_scores, returns, dates)

    print("개선 포인트 도출 중...")
    improvements = derive_improvements(diagnosis, all_scores, returns)

    print_report(series, dates, all_scores, returns, diagnosis, improvements)

    # JSON 저장
    output = {
        "dates": dates,
        "all_scores": {
            code: {
                date: {"final_score": v["final_score"], "factors": v["factors"]}
                for date, v in by_date.items()
            }
            for code, by_date in all_scores.items()
        },
        "returns": {c: dict(v) for c, v in returns.items() if c in ALL_CODES},
        "diagnosis": diagnosis,
        "improvements": improvements,
    }
    out_path = REPO / "data" / "backtest" / "quant_backtest_2026-04-06.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"✓ 결과 저장: {out_path}")


if __name__ == "__main__":
    main()
