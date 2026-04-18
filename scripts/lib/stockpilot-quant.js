import {
  SECURITIES_BY_CODE,
  clamp,
  resolveSecurityCodeFromCandidates,
} from "./pipeline-utils.js";

const SCORE_KEYS = [
  "Score_RS",
  "Score_Ichimoku",
  "Score_ADX_Mom",
  "Score_HA",
  "Score_Keltner_Vol",
  "Score_POC",
  "Score_VWAP",
  "Score_Resistance_Break",
  "Score_Div",
  "Score_GC",
  "Score_Stoch",
  "Score_Disp",
];

function roundNumber(value, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number.parseFloat(value.toFixed(digits));
}

function pushFlag(flags, value) {
  if (!value) return;
  if (!flags.includes(value)) flags.push(value);
}

function emptyFactors() {
  return Object.fromEntries(SCORE_KEYS.map((key) => [key, null]));
}

function emptyGates() {
  return {
    price_above_ma120: false,
    vix_below_30: false,
    "yield_spread_above_-0.5": false,
    keltner_break_and_volume: false,
    price_above_poc: false,
    price_above_vwap_anchored: false,
    bullish_divergence_detected: false,
    golden_cross_active: false,
    stoch_k_above_d_and_below_80: false,
  };
}

function looksLikeEtfName(name) {
  const normalized = String(name ?? "").trim().toUpperCase();
  return [
    "KODEX",
    "TIGER",
    "ACE",
    "PLUS",
    "HANARO",
    "KBSTAR",
    "ARIRANG",
    "SOL",
    "RISE",
  ].some((prefix) => normalized.startsWith(prefix));
}

function inferAssetClass(code, technicalItem = null, name = null) {
  const security = SECURITIES_BY_CODE[code] ?? null;
  const inferredType =
    security?.type ??
    technicalItem?.type ??
    (looksLikeEtfName(name) ? "etf" : "stock");
  const type = String(inferredType).toLowerCase();
  const exchange = String(
    technicalItem?.exchange ?? security?.exchange ?? security?.region ?? "KR",
  ).toUpperCase();

  if (exchange.includes("NYSE") || exchange.includes("NASDAQ") || exchange === "US") {
    return type === "etf" ? "ETF_US" : "STOCK_US";
  }
  return type === "etf" ? "ETF_KR" : "STOCK_KR";
}

function inferBenchmark(code, technicalItem = null) {
  const security = SECURITIES_BY_CODE[code] ?? null;
  const exchange = String(
    technicalItem?.exchange ?? security?.exchange ?? security?.region ?? "KOSPI",
  ).toUpperCase();
  if (exchange.includes("NASDAQ")) return "^IXIC";
  if (exchange.includes("NYSE") || exchange === "US") return "^GSPC";
  if (exchange.includes("KOSDAQ")) return "^KQ11";
  return "^KS11";
}

function normalizeConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 1);
  }
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "HIGH") return 0.85;
  if (normalized === "MEDIUM") return 0.65;
  if (normalized === "LOW") return 0.45;
  return 0.55;
}

function valueOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function factorScore({
  name,
  required = [],
  compute,
  flags,
  specialNullToZeroFlag = null,
}) {
  const missing = required.filter((entry) => entry.value == null);
  if (missing.length > 0) {
    for (const item of missing) {
      pushFlag(flags, item.flag ?? `missing:${item.key}`);
    }
    if (specialNullToZeroFlag) {
      pushFlag(flags, specialNullToZeroFlag);
    }
    return null;
  }

  try {
    const value = compute();
    if (value == null || !Number.isFinite(value)) {
      pushFlag(flags, `invalid_factor:${name}`);
      return null;
    }
    return roundNumber(value, 3);
  } catch {
    pushFlag(flags, `invalid_factor:${name}`);
    return null;
  }
}

function buildInputRow({
  code,
  name,
  asOfDate,
  technicalItem,
  macro,
  accountKey = null,
  sourceType,
  sourceMeta = {},
}) {
  const resolvedCode = resolveSecurityCodeFromCandidates(code, name) ?? code ?? null;
  const security = resolvedCode ? SECURITIES_BY_CODE[resolvedCode] ?? null : null;
  const close = valueOrNull(technicalItem?.close);
  const ma20 = valueOrNull(technicalItem?.ma?.ma20);
  const ma60 = valueOrNull(technicalItem?.ma?.ma60);
  const ma120 = valueOrNull(technicalItem?.ma?.ma120);

  return {
    ticker: resolvedCode,
    code: resolvedCode,
    name: name ?? security?.name ?? resolvedCode,
    asset_class: inferAssetClass(resolvedCode, technicalItem, name ?? security?.name ?? resolvedCode),
    benchmark: inferBenchmark(resolvedCode, technicalItem),
    as_of_date: asOfDate,
    close,
    close_252d: valueOrNull(technicalItem?.close_252d),
    ma_20: ma20,
    ma_60: ma60,
    ma_120: ma120,
    ha_open: valueOrNull(technicalItem?.heikin_ashi?.open),
    ha_close: valueOrNull(technicalItem?.heikin_ashi?.close),
    volume_current: valueOrNull(technicalItem?.volume_current),
    volume_ma_20: valueOrNull(technicalItem?.volume_ma_20),
    keltner_upper: valueOrNull(technicalItem?.keltner?.upper),
    keltner_lower: valueOrNull(technicalItem?.keltner?.lower),
    vwap_anchored: valueOrNull(technicalItem?.anchored_vwap?.value),
    poc_price_120d: valueOrNull(technicalItem?.volume_profile?.poc_price_120d),
    senkou_span_a: valueOrNull(technicalItem?.ichimoku?.senkou_span_a),
    senkou_span_b: valueOrNull(technicalItem?.ichimoku?.senkou_span_b),
    adx_14: valueOrNull(technicalItem?.adx?.value),
    stoch_k_14: valueOrNull(technicalItem?.stochastic?.k),
    stoch_d_14: valueOrNull(technicalItem?.stochastic?.d),
    rsi_14: valueOrNull(technicalItem?.rsi),
    price_drop_ratio: valueOrNull(technicalItem?.rsi_divergence_metrics?.price_drop_ratio),
    rsi_rise_value: valueOrNull(technicalItem?.rsi_divergence_metrics?.rsi_rise_value),
    vix_close: valueOrNull(macro?.vix_close),
    yield_spread_10y_2y: valueOrNull(macro?.yield_spread_10y_2y),
    rs_vs_kospi: valueOrNull(technicalItem?.relative_strength?.rs_vs_benchmark),
    benchmark_used: technicalItem?.relative_strength?.benchmark_used ?? inferBenchmark(resolvedCode, technicalItem),
    sourceType,
    accountKey,
    sourceMeta,
  };
}

function scoreRecord(input) {
  const flags = [];
  const factors = emptyFactors();
  const gates = emptyGates();

  const filterChecks = {
    price_above_ma120: input.close != null && input.ma_120 != null ? input.close > input.ma_120 : false,
    vix_below_30: input.vix_close != null ? input.vix_close < 30 : false,
    yield_spread_above_neg_0_5:
      input.yield_spread_10y_2y != null ? input.yield_spread_10y_2y > -0.5 : false,
  };

  if (input.close == null) pushFlag(flags, "missing:close");
  if (input.ma_120 == null) pushFlag(flags, "missing:ma_120");
  if (input.vix_close == null) pushFlag(flags, "missing_macro:vix_close");
  if (input.yield_spread_10y_2y == null) pushFlag(flags, "missing_macro:yield_spread_10y_2y");

  gates.price_above_ma120 = filterChecks.price_above_ma120;
  gates.vix_below_30 = filterChecks.vix_below_30;
  gates["yield_spread_above_-0.5"] = filterChecks.yield_spread_above_neg_0_5;

  const filterScore =
    filterChecks.price_above_ma120 &&
    filterChecks.vix_below_30 &&
    filterChecks.yield_spread_above_neg_0_5
      ? 1
      : 0;

  const cloudTop =
    input.senkou_span_a != null && input.senkou_span_b != null
      ? Math.max(input.senkou_span_a, input.senkou_span_b)
      : null;
  const keltnerBreak =
    input.close != null && input.keltner_upper != null && input.keltner_upper !== 0
      ? ((input.close - input.keltner_upper) / input.keltner_upper) * 100
      : null;
  const volRatio =
    input.volume_current != null && input.volume_ma_20 != null && input.volume_ma_20 !== 0
      ? input.volume_current / input.volume_ma_20
      : null;

  factors.Score_RS = factorScore({
    name: "Score_RS",
    required: [{ key: "rs_vs_kospi", value: input.rs_vs_kospi }],
    flags,
    compute: () => clamp(input.rs_vs_kospi * 100, 0, 10),
  });

  factors.Score_Ichimoku = factorScore({
    name: "Score_Ichimoku",
    required: [
      { key: "close", value: input.close },
      { key: "senkou_span_a", value: input.senkou_span_a },
      { key: "senkou_span_b", value: input.senkou_span_b },
    ],
    flags,
    specialNullToZeroFlag: "insufficient_history:ichimoku",
    compute: () => {
      if (cloudTop == null || cloudTop === 0 || input.close <= cloudTop) return 0;
      return clamp(((input.close - cloudTop) / cloudTop) * 100 * 2, 0, 10);
    },
  });

  factors.Score_ADX_Mom = factorScore({
    name: "Score_ADX_Mom",
    required: [
      { key: "adx_14", value: input.adx_14 },
      { key: "close", value: input.close },
      { key: "close_252d", value: input.close_252d, flag: "insufficient_history:252d" },
    ],
    flags,
    compute: () => {
      if (input.close_252d === 0) {
        pushFlag(flags, "div_by_zero:close_252d");
        return null;
      }
      // [개선 v1.2] 방향 인식: ADX 강도 × 방향 부호
      // 이전: clamp(adx강도 + 연간모멘텀, 0, 10) → 하락 추세에서도 ADX 높으면 고점
      // 개선: price vs MA60으로 방향 판별 후 ADX 강도에 방향 부호 적용
      //        상승 추세(close > ma_60): ADX 강도 보상
      //        하락 추세(close < ma_60): ADX 강도에 패널티 (강한 하락이면 낮은 점수)
      const annualMom = (input.close / input.close_252d - 1) * 25;
      const adxStrength = (input.adx_14 - 20) * 0.25;
      const isBullish = input.ma_60 != null ? input.close > input.ma_60 : annualMom >= 0;
      const directedAdx = isBullish ? adxStrength : -adxStrength;
      return clamp(5 + directedAdx + annualMom, 0, 10);
    },
  });

  factors.Score_HA = factorScore({
    name: "Score_HA",
    required: [
      { key: "ha_open", value: input.ha_open },
      { key: "ha_close", value: input.ha_close },
    ],
    flags,
    compute: () => {
      if (input.ha_open === 0) {
        pushFlag(flags, "div_by_zero:ha_open");
        return null;
      }
      // [개선 v1.1] 양방향 채점: 음봉도 차별화
      // haBody: 양수=강세, 음수=약세. ±2.5% 이상에서 포화.
      // 결과 범위 0~10: 중립(ha_close≈ha_open)=5, 강한 양봉=10, 강한 음봉=0
      const haBody = (input.ha_close - input.ha_open) / input.ha_open;
      // 가격이 ha_close 방향으로 확인될 때 보정 (+10%)
      const priceConfirm = input.close != null && input.ha_open > 0
        ? (input.close >= input.ha_close ? 1.1 : 0.9)
        : 1.0;
      return clamp(5 + haBody * 200 * priceConfirm, 0, 10);
    },
  });

  gates.keltner_break_and_volume = Boolean(keltnerBreak != null && keltnerBreak > 0 && volRatio != null && volRatio > 1);
  factors.Score_Keltner_Vol = factorScore({
    name: "Score_Keltner_Vol",
    required: [
      { key: "close", value: input.close },
      { key: "keltner_upper", value: input.keltner_upper },
      { key: "volume_current", value: input.volume_current },
      { key: "volume_ma_20", value: input.volume_ma_20 },
    ],
    flags,
    compute: () => {
      if (!gates.keltner_break_and_volume) return 0;
      // StockEasy momentum/peak 역추정 반영:
      // 돌파폭 + 거래량 급증 신호의 설명력이 높아 가중치를 상향.
      return clamp((keltnerBreak * 3.5) + (volRatio * 2.5), 0, 15);
    },
  });

  gates.price_above_poc = Boolean(input.close != null && input.poc_price_120d != null && input.close >= input.poc_price_120d);
  factors.Score_POC = factorScore({
    name: "Score_POC",
    required: [
      { key: "close", value: input.close },
      { key: "poc_price_120d", value: input.poc_price_120d },
    ],
    flags,
    compute: () => {
      if (!gates.price_above_poc) return 0;
      if (input.poc_price_120d === 0) {
        pushFlag(flags, "div_by_zero:poc_price_120d");
        return null;
      }
      return Math.max(0, 7.5 - (((input.close - input.poc_price_120d) / input.poc_price_120d) * 100 * 2));
    },
  });

  gates.price_above_vwap_anchored =
    Boolean(input.close != null && input.vwap_anchored != null && input.close >= input.vwap_anchored);
  factors.Score_VWAP = factorScore({
    name: "Score_VWAP",
    required: [
      { key: "close", value: input.close },
      { key: "vwap_anchored", value: input.vwap_anchored },
    ],
    flags,
    compute: () => {
      if (!gates.price_above_vwap_anchored) return 0;
      if (input.vwap_anchored === 0) {
        pushFlag(flags, "div_by_zero:vwap_anchored");
        return null;
      }
      return Math.max(0, 7.5 - (((input.close - input.vwap_anchored) / input.vwap_anchored) * 100 * 2));
    },
  });

  factors.Score_Resistance_Break =
    factors.Score_POC != null || factors.Score_VWAP != null
      ? roundNumber((factors.Score_POC ?? 0) + (factors.Score_VWAP ?? 0), 3)
      : null;

  // [개선 v1.3] Score_Div: 추세/돌파형 RSI 레짐 점수
  // 최근 역추정에서 과매도 구간보다 중립~강세 초입(45~68)에서 매수 적합도가 높아
  // 스코어 피크를 해당 구간으로 이동했다.
  // 기존 gates.bullish_divergence_detected는 하위 호환을 위해 유지
  gates.bullish_divergence_detected =
    Boolean(input.price_drop_ratio != null && input.price_drop_ratio < 0 && input.rsi_rise_value != null && input.rsi_rise_value > 0);
  factors.Score_Div = factorScore({
    name: "Score_Div",
    required: [
      { key: "rsi_14", value: input.rsi_14 },
    ],
    flags,
    compute: () => {
      const rsi = input.rsi_14;
      if (rsi < 25) return 1;    // 급락 구간: 추세형 관점에선 보수 처리
      if (rsi < 35) return 3;
      if (rsi < 45) return 6;
      if (rsi <= 68) return 10;  // 추세 지속 가능성이 높은 핵심 구간
      if (rsi <= 78) return 6;
      if (rsi <= 85) return 2;
      return 0;                  // 과열 극단 구간
    },
  });

  // [개선 v1.1] Score_GC: 이진 게이트 → 연속 MA 모멘텀 점수
  // 원인: MA20 < MA60이면 무조건 0 → 매수 임박 종목 탐지 불가, IC 음수
  // 대체: MA20/MA60 간격을 연속 점수화 (골든크로스 직전 구간 최고점)
  // 범위 유지: 0~5
  gates.golden_cross_active =
    Boolean(input.ma_20 != null && input.ma_60 != null && input.ma_20 > input.ma_60);
  factors.Score_GC = factorScore({
    name: "Score_GC",
    required: [
      { key: "ma_20", value: input.ma_20 },
      { key: "ma_60", value: input.ma_60 },
    ],
    flags,
    compute: () => {
      if (input.ma_60 === 0) {
        pushFlag(flags, "div_by_zero:ma_60");
        return null;
      }
      const gap = (input.ma_20 - input.ma_60) / input.ma_60; // + = MA20 above
      // gap > +8%: 이미 과매수 구간 (차익실현 위험)  → 2
      // gap +2~8%: 건강한 상승추세                   → 4
      // gap 0~+2%: 방금 골든크로스 (최적 진입)        → 5
      // gap -2~0%: 크로스 임박 (얼리 포지션)          → 4
      // gap -5~-2%: 하락 중 회복 조짐               → 2
      // gap < -5%: 뚜렷한 하락 추세                 → 0~1
      if (gap > 0.08) return 2;
      if (gap > 0.02) return 4;
      if (gap >= 0)   return 5;
      if (gap >= -0.02) return 4;
      if (gap >= -0.05) return 2;
      return clamp(1 + (gap + 0.05) * 20, 0, 1); // -5% 이하: 0~1 점진 감소
    },
  });

  // 하위 호환을 위해 게이트 키 이름은 유지하되, 돌파형 장세를 반영해 90 미만까지 허용.
  gates.stoch_k_above_d_and_below_80 =
    Boolean(input.stoch_k_14 != null && input.stoch_d_14 != null && input.stoch_k_14 > input.stoch_d_14 && input.stoch_k_14 < 90);
  factors.Score_Stoch = factorScore({
    name: "Score_Stoch",
    required: [
      { key: "stoch_k_14", value: input.stoch_k_14 },
      { key: "stoch_d_14", value: input.stoch_d_14 },
    ],
    flags,
    compute: () => {
      if (input.stoch_k_14 == null || input.stoch_d_14 == null) return null;
      // 추세 전략에서 고점 돌파 구간(80~90)의 신호를 완전 배제하지 않고 약한 점수 부여.
      if (input.stoch_k_14 > input.stoch_d_14) {
        if (input.stoch_k_14 < 80) {
          return clamp(10 - Math.abs(60 - input.stoch_k_14) * 0.2, 0, 10);
        }
        if (input.stoch_k_14 <= 90) {
          return clamp(6 - (input.stoch_k_14 - 80) * 0.3, 2, 6);
        }
      }
      return 0;
    },
  });

  factors.Score_Disp = factorScore({
    name: "Score_Disp",
    required: [
      { key: "close", value: input.close },
      { key: "ma_20", value: input.ma_20 },
    ],
    flags,
    compute: () => {
      if (input.ma_20 === 0) {
        pushFlag(flags, "div_by_zero:ma_20");
        return null;
      }
      return Math.max(0, 5 - Math.abs(100 - ((input.close / input.ma_20) * 100)));
    },
  });

  const stage2Score = roundNumber(
    (factors.Score_RS ?? 0) +
      (factors.Score_Ichimoku ?? 0) +
      (factors.Score_ADX_Mom ?? 0) +
      (factors.Score_HA ?? 0),
    3,
  );
  const stage3Score = roundNumber(
    (factors.Score_Keltner_Vol ?? 0) +
      (factors.Score_Resistance_Break ?? 0) +
      (factors.Score_Div ?? 0) +
      (factors.Score_GC ?? 0),
    3,
  );
  const stage4Score = roundNumber(
    (factors.Score_Stoch ?? 0) +
      (factors.Score_Disp ?? 0),
    3,
  );
  const rawTotal = (stage2Score ?? 0) + (stage3Score ?? 0) + (stage4Score ?? 0);
  const finalScore = roundNumber((Math.round(clamp(filterScore * rawTotal, 0, 100) * 10) / 10), 1);

  return {
    ...input,
    final_score: finalScore,
    filter_score: filterScore,
    stage2_score: stage2Score,
    stage3_score: stage3Score,
    stage4_score: stage4Score,
    factors,
    derived: {
      Cloud_Top: roundNumber(cloudTop, 4),
      Keltner_Break: roundNumber(keltnerBreak, 4),
      Vol_Ratio: roundNumber(volRatio, 4),
    },
    gates,
    data_quality_flags: flags,
    commentary:
      filterScore === 0
        ? [
            !filterChecks.price_above_ma120 ? "price<=ma120" : null,
            !filterChecks.vix_below_30 ? `vix=${input.vix_close ?? "NA"}` : null,
            !filterChecks.yield_spread_above_neg_0_5 ? `spread=${input.yield_spread_10y_2y ?? "NA"}` : null,
          ]
            .filter(Boolean)
            .join(", ")
        : "",
  };
}

export function buildStockPilotInput(params) {
  return buildInputRow(params);
}

export function scoreStockPilotInput(input) {
  return scoreRecord(input);
}

/**
 * 커버리지 기반 동적 임계값 계산.
 * factorCoverage + techCoverage 평균이 낮을수록 전체 점수 상한이 낮아지므로
 * 임계값을 비례 조정한다. 커버리지 100% 기준 임계값을 기준으로 스케일.
 *
 * @param {number} baseCut   - 커버리지 100% 기준 임계값
 * @param {number} coverage  - 0~1 사이 실제 커버리지 (factor + tech 평균)
 * @param {number} floor     - 최소 임계값 (0으로 내려가지 않도록)
 */
function scaledCut(baseCut, coverage, floor = 5) {
  // 커버리지 최소 25%를 보정 하한으로 적용 (너무 작아지면 의미 없음)
  const effectiveCov = Math.max(coverage, 0.25);
  return Math.max(baseCut * effectiveCov, floor);
}

function classifyHoldingPolicy(result, coverageMeta = {}) {
  if (result.filter_score === 0) return "EXIT";
  const cov = ((coverageMeta.factorCoverage ?? 0) + (coverageMeta.techCoverage ?? 0)) / 2;
  const score = result.final_score ?? 0;
  if (score >= scaledCut(75, cov, 20)) return "ADD";
  if (score >= scaledCut(50, cov, 14)) return "HOLD";
  if (score >= scaledCut(30, cov, 8))  return "TRIM";
  return "EXIT";
}

function classifyCandidatePolicy(result, candidateMeta = {}, coverageMeta = {}) {
  const stance = String(candidateMeta.stance ?? "hold").toLowerCase();
  if (!["buy", "accumulate", "add", "watch"].includes(stance)) {
    return "REJECT";
  }
  if (result.filter_score === 0) return "REJECT";
  const cov = ((coverageMeta.factorCoverage ?? 0) + (coverageMeta.techCoverage ?? 0)) / 2;
  const score = result.final_score ?? 0;
  // buy/accumulate/add stance → BUY or WATCH 가능
  // watch stance → WATCH만 가능
  if (["buy", "accumulate", "add"].includes(stance)) {
    if (score >= scaledCut(70, cov, 18)) return "BUY";
    if (score >= scaledCut(45, cov, 12)) return "WATCH";
  } else {
    // stance === "watch"
    if (score >= scaledCut(45, cov, 12)) return "WATCH";
  }
  return "REJECT";
}

function summarizeTop(results, limit = 10) {
  return [...results]
    .sort((left, right) => (right.final_score ?? 0) - (left.final_score ?? 0))
    .slice(0, limit)
    .map((item) => ({
      ticker: item.ticker,
      name: item.name,
      final_score: item.final_score,
      policy_state: item.policy_state,
    }));
}

// ── 레짐별 팩터 가중치 조정 테이블 ──────────────────────────────────
// 각 값은 해당 레짐에서 해당 팩터의 상대 비중 배율 (1.0 = 기본값)
const REGIME_FACTOR_MULTIPLIERS = {
  // 성장 국면: 모멘텀 팩터 우선
  Growth: {
    Score_RS: 1.3, Score_Ichimoku: 1.2, Score_ADX_Mom: 1.1, Score_HA: 1.1,
    Score_Keltner_Vol: 1.2, Score_GC: 1.2, Score_Stoch: 0.9, Score_Disp: 0.9,
    Score_Div: 0.8, Score_POC: 1.0, Score_VWAP: 1.0, Score_Resistance_Break: 1.0,
  },
  // 리스크 오프: RS·이치모쿠 방어적 신호 우선, 모멘텀 팩터 축소
  "Risk-Off_DollarStrength": {
    Score_RS: 1.5, Score_Ichimoku: 1.3, Score_Div: 1.4,   // RSI 과매도 반등 더 중요
    Score_ADX_Mom: 0.5, Score_HA: 0.7, Score_GC: 0.6,     // 추세 추종 축소
    Score_Keltner_Vol: 0.8, Score_Stoch: 1.2, Score_Disp: 1.2,
    Score_POC: 0.9, Score_VWAP: 0.9, Score_Resistance_Break: 0.8,
  },
  // 스태그플레이션·침체: 방어 극대화
  "Stagflation-Recession": {
    Score_RS: 1.6, Score_Div: 1.5, Score_Stoch: 1.3, Score_Disp: 1.3,
    Score_ADX_Mom: 0.4, Score_HA: 0.6, Score_GC: 0.5, Score_Keltner_Vol: 0.7,
    Score_Ichimoku: 1.1, Score_POC: 0.8, Score_VWAP: 0.8, Score_Resistance_Break: 0.7,
  },
  // 인플레이션: 실물자산 모멘텀 유지
  Inflationary: {
    Score_RS: 1.4, Score_Ichimoku: 1.1, Score_ADX_Mom: 0.9, Score_HA: 1.0,
    Score_Keltner_Vol: 1.1, Score_GC: 1.0, Score_Div: 1.0, Score_Stoch: 1.0,
    Score_POC: 1.1, Score_VWAP: 1.0, Score_Resistance_Break: 1.0, Score_Disp: 1.0,
  },
};

/** 레짐 이름에서 팩터 배율 맵 반환 */
function getRegimeMultipliers(regimeName) {
  if (!regimeName) return null;
  // 부분 매칭 (e.g. "Risk-Off" 포함하면 해당 레짐 적용)
  for (const [key, mults] of Object.entries(REGIME_FACTOR_MULTIPLIERS)) {
    if (regimeName.includes(key) || key.includes(regimeName)) return mults;
  }
  return null;
}

/**
 * 교차단면 퍼센타일 정규화.
 * 우주(holdings + candidates) 전체에서 각 팩터의 순위를 계산 후
 * 0~100 스케일로 재매핑한다. final_score도 재계산.
 *
 * 장점: 종목 수와 무관하게 점수 분포가 항상 0~100에 걸침 → σ 개선.
 */
function applyPercentileNormalization(allRecords, regimeName) {
  if (allRecords.length === 0) return allRecords;

  const mults = getRegimeMultipliers(regimeName);

  // 팩터별 모든 비-null 값 수집
  const factorValues = {};
  for (const key of SCORE_KEYS) {
    factorValues[key] = allRecords
      .map((r, idx) => ({ val: r.factors[key], idx }))
      .filter((e) => e.val != null)
      .sort((a, b) => a.val - b.val);
  }

  // 각 레코드에 퍼센타일 점수 적용
  return allRecords.map((rec) => {
    const pFactors = { ...rec.factors };
    let rawTotal = 0;

    for (const key of SCORE_KEYS) {
      const sorted = factorValues[key];
      if (sorted.length === 0 || pFactors[key] == null) continue;

      // 해당 값의 순위 (동점 처리: 평균 순위)
      const rank = sorted.findIndex((e) => e.val === pFactors[key]);
      const sameTies = sorted.filter((e) => e.val === pFactors[key]).length;
      const avgRank = rank + (sameTies - 1) / 2;
      const percentile = sorted.length > 1
        ? (avgRank / (sorted.length - 1)) * 100
        : 50;

      // 레짐 배율 적용 (중앙 50 기준 확대/축소)
      const mult = mults?.[key] ?? 1.0;
      const adjusted = mult !== 1.0
        ? clamp(50 + (percentile - 50) * mult, 0, 100)
        : percentile;

      pFactors[key] = roundNumber(adjusted, 2);

      // 기존 stage 비중 유지를 위해 0-10 스케일로 변환 후 합산
      // (원본 범위가 팩터마다 다르므로 퍼센타일 기준 최대값으로 정규화)
      const origMax = getFactorOriginalMax(key);
      rawTotal += (adjusted / 100) * origMax;
    }

    const finalScore = roundNumber(
      Math.round(clamp(rec.filter_score * rawTotal, 0, 100) * 10) / 10,
      1,
    );

    return {
      ...rec,
      factors: pFactors,
      final_score: finalScore,
    };
  });
}

/** 팩터별 원래 스케일 최대값 (stage 합산 기준 복원용) */
function getFactorOriginalMax(key) {
  const maxMap = {
    Score_RS: 10, Score_Ichimoku: 10, Score_ADX_Mom: 10, Score_HA: 10,
    Score_Keltner_Vol: 15, Score_POC: 7.5, Score_VWAP: 7.5,
    Score_Resistance_Break: 15, Score_Div: 10, Score_GC: 5,
    Score_Stoch: 10, Score_Disp: 5,
  };
  return maxMap[key] ?? 10;
}

export function buildStockPilotQuantPack({
  asOfDate,
  normalizedPortfolio,
  technical,
  fred,
  stage2Data,
  coverageMeta: externalCoverageMeta = null,
  regimeName = null,
}) {
  const technicalMap = technical?.scores ?? {};
  const macro = {
    vix_close: valueOrNull(fred?.VIXCLS ?? technical?.market_context?.vix),
    yield_spread_10y_2y: valueOrNull(fred?.T10Y2Y),
  };

  const heldCodes = new Set();
  const holdings = [];

  // 커버리지 메타: 보유+후보 전체 유니버스 기준으로 기술 데이터 가용 비율 계산
  // (보유 종목만 보면 held codes에 기술 데이터가 많아 coverage가 과대평가됨)
  const heldCodesList = (normalizedPortfolio?.accounts ?? []).flatMap(
    (a) => (a.holdings ?? []).map((h) => h.code).filter(Boolean),
  );
  const candidateCodesList = (stage2Data?.candidate_scores ?? [])
    .map((item) => item.code)
    .filter(Boolean);
  const universeAllCodes = [...new Set([...heldCodesList, ...candidateCodesList])];
  const universeWithTech = universeAllCodes.filter((c) => Boolean(technicalMap[c]));
  const techCoverage = universeAllCodes.length > 0 ? universeWithTech.length / universeAllCodes.length : 0;
  const factorCoverage = techCoverage * 0.85;
  // 외부에서 stage3가 계산한 coverage를 받으면 우선 사용 (더 정확함)
  const coverageMeta = externalCoverageMeta ?? { factorCoverage, techCoverage };

  for (const account of normalizedPortfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      const code = resolveSecurityCodeFromCandidates(holding.code, holding.name) ?? holding.code ?? null;
      if (!code) continue;
      heldCodes.add(code);
      const input = buildInputRow({
        code,
        name: holding.name,
        asOfDate,
        technicalItem: technicalMap[code] ?? null,
        macro,
        accountKey: account.key,
        sourceType: "holding",
        sourceMeta: {
          accountLabel: account.label,
          quantity: holding.quantity ?? null,
          avgPrice: holding.avgPrice ?? null,
          currentPrice: holding.currentPrice ?? null,
          profitRate: holding.profitRate ?? null,
          marketValue: holding.marketValue ?? null,
        },
      });
      const scored = scoreRecord(input);
      holdings.push({
        ...scored,
        position_key: `${account.key}:${code}`,
        policy_state: classifyHoldingPolicy(scored, coverageMeta),
      });
    }
  }

  const candidates = [];
  const seenCandidates = new Set();
  for (const item of stage2Data?.candidate_scores ?? []) {
    const code = resolveSecurityCodeFromCandidates(item.code, item.name) ?? item.code ?? null;
    if (!code || heldCodes.has(code) || seenCandidates.has(code)) continue;
    seenCandidates.add(code);
    const input = buildInputRow({
      code,
      name: item.name,
      asOfDate,
      technicalItem: technicalMap[code] ?? null,
      macro,
      sourceType: "candidate",
      sourceMeta: {
        stance: item.stance ?? null,
        confidence: normalizeConfidence(item.confidence),
        target_accounts: item.target_accounts ?? [],
        horizon: item.horizon ?? null,
        thesis: item.thesis ?? null,
      },
    });
    const scored = scoreRecord(input);
    candidates.push({
      ...scored,
      policy_state: classifyCandidatePolicy(scored, item, coverageMeta),
    });
  }

  // ── 퍼센타일 정규화 + 레짐 가중치 적용 ────────────────────────────
  // 전체 유니버스(보유 + 후보)를 합쳐 교차단면 순위 기반 점수 재계산
  const allRaw = [...holdings, ...candidates];
  const allNormalized = applyPercentileNormalization(allRaw, regimeName);

  // 정규화 결과를 보유/후보로 분리하고 policy_state 재분류
  const normalizedHoldings = allNormalized
    .slice(0, holdings.length)
    .map((rec) => ({
      ...rec,
      policy_state: classifyHoldingPolicy(rec, coverageMeta),
    }));

  const normalizedCandidates = allNormalized
    .slice(holdings.length)
    .map((rec, idx) => {
      const originalItem = (stage2Data?.candidate_scores ?? [])[idx] ?? {};
      return {
        ...rec,
        policy_state: classifyCandidatePolicy(rec, originalItem, coverageMeta),
      };
    });

  return {
    schema_version: "1.1",
    as_of_date: asOfDate,
    methodology: {
      scoring_model: "stockpilot_deterministic_v1.2_percentile",
      note: "v1.2: ADX_Mom 방향 인식, HA 양방향, Div→RSI모멘텀, 퍼센타일 정규화, 레짐별 가중치 적용.",
      missing_data_policy: "결측 팩터는 null 반환, stage 합산은 0점 처리",
      regime_applied: regimeName ?? "unknown",
      policy_layers: {
        holdings: ["ADD", "HOLD", "TRIM", "EXIT"],
        candidates: ["BUY", "WATCH", "REJECT"],
      },
    },
    macro,
    holdings: normalizedHoldings,
    candidates: normalizedCandidates,
    summary: {
      n_holdings: normalizedHoldings.length,
      n_candidates: normalizedCandidates.length,
      n_passed_filter_holdings: normalizedHoldings.filter((item) => item.filter_score === 1).length,
      n_passed_filter_candidates: normalizedCandidates.filter((item) => item.filter_score === 1).length,
      top_holdings: summarizeTop(normalizedHoldings),
      top_candidates: summarizeTop(normalizedCandidates),
    },
  };
}
