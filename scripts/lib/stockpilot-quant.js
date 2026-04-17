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
      return clamp(((input.adx_14 - 20) * 0.25) + ((input.close / input.close_252d - 1) * 25), 0, 10);
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
      return clamp(((input.ha_close - input.ha_open) / input.ha_open) * 100 * 2, 0, 10);
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
      return clamp((keltnerBreak * 3) + (volRatio * 2), 0, 15);
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

  gates.bullish_divergence_detected =
    Boolean(input.price_drop_ratio != null && input.price_drop_ratio < 0 && input.rsi_rise_value != null && input.rsi_rise_value > 0);
  factors.Score_Div = factorScore({
    name: "Score_Div",
    required: [
      { key: "price_drop_ratio", value: input.price_drop_ratio, flag: "no_divergence_anchors" },
      { key: "rsi_rise_value", value: input.rsi_rise_value, flag: "no_divergence_anchors" },
    ],
    flags,
    compute: () => {
      if (!gates.bullish_divergence_detected) return 0;
      return clamp((Math.abs(input.price_drop_ratio) * 50) + (input.rsi_rise_value * 0.5), 0, 10);
    },
  });

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
      if (!gates.golden_cross_active) return 0;
      if (input.ma_60 === 0) {
        pushFlag(flags, "div_by_zero:ma_60");
        return null;
      }
      return Math.max(0, 5 - (((input.ma_20 - input.ma_60) / input.ma_60) * 100 * 2));
    },
  });

  gates.stoch_k_above_d_and_below_80 =
    Boolean(input.stoch_k_14 != null && input.stoch_d_14 != null && input.stoch_k_14 > input.stoch_d_14 && input.stoch_k_14 < 80);
  factors.Score_Stoch = factorScore({
    name: "Score_Stoch",
    required: [
      { key: "stoch_k_14", value: input.stoch_k_14 },
      { key: "stoch_d_14", value: input.stoch_d_14 },
    ],
    flags,
    compute: () => {
      if (!gates.stoch_k_above_d_and_below_80) return 0;
      return clamp(10 - Math.abs(50 - input.stoch_k_14) * 0.2, 0, 10);
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

function classifyHoldingPolicy(result) {
  if (result.filter_score === 0) return "EXIT";
  if ((result.final_score ?? 0) >= 75) return "ADD";
  if ((result.final_score ?? 0) >= 50) return "HOLD";
  if ((result.final_score ?? 0) >= 30) return "TRIM";
  return "EXIT";
}

function classifyCandidatePolicy(result, candidateMeta = {}) {
  const stance = String(candidateMeta.stance ?? "hold").toLowerCase();
  if (!["buy", "accumulate", "add"].includes(stance)) {
    return "REJECT";
  }
  if (result.filter_score === 0) return "REJECT";
  if ((result.final_score ?? 0) >= 70) return "BUY";
  if ((result.final_score ?? 0) >= 45) return "WATCH";
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

export function buildStockPilotQuantPack({
  asOfDate,
  normalizedPortfolio,
  technical,
  fred,
  stage2Data,
}) {
  const technicalMap = technical?.scores ?? {};
  const macro = {
    vix_close: valueOrNull(fred?.VIXCLS ?? technical?.market_context?.vix),
    yield_spread_10y_2y: valueOrNull(fred?.T10Y2Y),
  };

  const heldCodes = new Set();
  const holdings = [];

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
        policy_state: classifyHoldingPolicy(scored),
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
      policy_state: classifyCandidatePolicy(scored, item),
    });
  }

  return {
    schema_version: "1.0",
    as_of_date: asOfDate,
    methodology: {
      scoring_model: "stockpilot_deterministic_v1_parallel",
      note: "기존 교차단면 Stage 3 점수와 별도로, StockPilot 공식 수식을 holdings/candidates로 분리 계산합니다.",
      missing_data_policy: "결측 팩터는 null 반환, stage 합산은 0점 처리",
      policy_layers: {
        holdings: ["ADD", "HOLD", "TRIM", "EXIT"],
        candidates: ["BUY", "WATCH", "REJECT"],
      },
    },
    macro,
    holdings,
    candidates,
    summary: {
      n_holdings: holdings.length,
      n_candidates: candidates.length,
      n_passed_filter_holdings: holdings.filter((item) => item.filter_score === 1).length,
      n_passed_filter_candidates: candidates.filter((item) => item.filter_score === 1).length,
      top_holdings: summarizeTop(holdings),
      top_candidates: summarizeTop(candidates),
    },
  };
}
