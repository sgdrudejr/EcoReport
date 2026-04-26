#!/usr/bin/env node
// 3단계(v3): 교차단면 팩터 정규화, 공분산 기반 리스크 패널티,
// 계좌별 tax-aware 조정을 결합해 종목·계좌·포트폴리오 점수를 산출합니다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  ROOT_DIR,
  THEME_KEYWORDS_BY_CODE,
  buildRunMetadata,
  clamp,
  enrichPortfolioWithSecurityCodes,
  normalizeText,
  parseDateArgs,
  readJson,
  sigmoid,
  softmax,
  writeJson,
} from "./lib/pipeline-utils.js";
import { loadAnalysisContext } from "./lib/analysis-context.js";
import { buildStockPilotQuantPack } from "./lib/stockpilot-quant.js";

const REGIME_WEIGHTS = {
  BULL: {
    direction: { ma: 0.32, macd: 0.22, rsi: 0.12, adx: 0.12, report: 0.22 },
    timing: { bb: 0.18, rsi: 0.22, stoch: 0.22, volume: 0.14, report: 0.24 },
    bias: 0.2,
  },
  SIDEWAYS: {
    direction: { ma: 0.26, macd: 0.18, rsi: 0.12, adx: 0.1, report: 0.34 },
    timing: { bb: 0.28, rsi: 0.22, stoch: 0.22, volume: 0.1, report: 0.18 },
    bias: 0,
  },
  BEAR: {
    direction: { ma: 0.22, macd: 0.18, rsi: 0.1, adx: 0.1, report: 0.4 },
    timing: { bb: 0.24, rsi: 0.18, stoch: 0.18, volume: 0.08, report: 0.32 },
    bias: -0.2,
  },
  HIGH_VOL: {
    direction: { ma: 0.2, macd: 0.14, rsi: 0.08, adx: 0.08, report: 0.5 },
    timing: { bb: 0.18, rsi: 0.14, stoch: 0.14, volume: 0.08, report: 0.46 },
    bias: -0.35,
  },
};

const MAX_WEIGHT_PROFILES = {
  // allocation은 나머지 가중치의 residual로 계산된다.
  balanced:     { allocation: 0.40, factor: 0.10, tech: 0.25, report: 0.10, regime: 0.05, stage2: 0.05, leading: 0.05 },
  dataSparse:   { allocation: 0.65, factor: 0.05, tech: 0.15, report: 0.05, regime: 0.10, stage2: 0.00, leading: 0.00 },
  reportHeavy:  { allocation: 0.30, factor: 0.10, tech: 0.20, report: 0.25, regime: 0.05, stage2: 0.05, leading: 0.05 },
  tactical:     { allocation: 0.20, factor: 0.10, tech: 0.45, report: 0.10, regime: 0.05, stage2: 0.05, leading: 0.05 },
  riskOff:      { allocation: 0.35, factor: 0.05, tech: 0.20, report: 0.05, regime: 0.15, stage2: 0.10, leading: 0.10 },
};

const DEFAULT_RISK_CAPS = {
  concentration: 10,
  covariance: 8,
  tailRisk: 15,
  dataQuality: 10,
  regimeStress: 10,
  total: 30,
};

const DEFAULT_FACTOR_MODEL = {
  winsorZ: 3.5,
  scoreScale: 14,
  weights: {
    momentum: 0.35,
    research: 0.3,
    income: 0.15,
    macroFit: 0.2,
  },
  autoAdjust: {
    enabled: true,
    source: "data/feedback/latest-feedback.json",
    primaryHorizonDays: 10,
    minSamples: 24,
  },
};

const DEFAULT_COVARIANCE_MODEL = {
  enabled: true,
  shrinkage: 0.35,
  lambda: 0.55,
  minHistory: 20,
  annualization: 252,
  ridge: 0.000001,
};

const DEFAULT_TAX_AWARE_MODEL = {
  enabled: true,
  alpha: 1.6,
  normalTaxRate: 0.154,
  minRiskFloor: 0.08,
  maxMultiplier: 1.15,
  defaultYieldByCategory: {
    "배당/커버드콜": 0.07,
    "현금파킹": 0.032,
    "금": 0,
    "S&P500": 0.013,
    "미국인덱스": 0.013,
    "나스닥100": 0.006,
    "전력기기": 0.004,
    "방산": 0.004,
    "원자력": 0.004,
    "기타": 0,
  },
  accountTaxRates: {
    ISA: 0.099,
    PENSION: 0.154,
    KIS_MAIN: 0.154,
  },
};

const DEFAULT_HOLDING_BLEND_MODEL = {
  enabled: true,
  actionWeight: 0.92,
  factorWeight: 0.08,
  minFactorCoverage: 0.35,
  maxAdjustment: 18,
  gateMode: "sameSignal",
  minFactorDistance: 8,
};

const DEFAULT_STOP_LOSS_CONFIG = {
  enabled: true,
  fromEntry_pct: -0.1,
  fromRecentHigh_pct: -0.15,
  recentHighWindow: 20,
  forcedTrimScore: 35,
};

const STAGE2_SCORE_BY_BIAS = {
  aggressive_add: 64,
  selective_add: 58,
  hold: 50,
  defensive: 44,
  reduce: 38,
};

const REPORT_TYPE_WEIGHTS = {
  stock: 1,
  industry: 0.78,
  theme: 0.88,
  marketvoice: 0.62,
  strategy: 0.34,
  macro: 0.22,
};

const REGIME_TYPE_WEIGHTS = {
  BULL: { holding: 1.0, category: 0.75, theme: 0.8, account: 0.35, portfolio: 0.2 },
  SIDEWAYS: { holding: 1.0, category: 0.75, theme: 0.65, account: 0.35, portfolio: 0.2 },
  BEAR: { holding: 1.0, category: 0.8, theme: 0.75, account: 0.45, portfolio: 0.3 },
  HIGH_VOL: { holding: 0.95, category: 0.85, theme: 0.8, account: 0.55, portfolio: 0.4 },
};

const REGIME_REPORT_TYPE_WEIGHTS = {
  BULL: { stock: 1.0, industry: 0.65, theme: 0.6, marketvoice: 0.55, strategy: 0.45, macro: 0.22 },
  SIDEWAYS: { stock: 1.0, industry: 0.78, theme: 0.88, marketvoice: 0.62, strategy: 0.34, macro: 0.22 },
  BEAR: { stock: 0.9, industry: 0.74, theme: 0.78, marketvoice: 0.68, strategy: 0.5, macro: 0.45 },
  HIGH_VOL: { stock: 0.85, industry: 0.78, theme: 0.82, marketvoice: 0.74, strategy: 0.6, macro: 0.65 },
};

const IMPACT_HALF_LIFE_BY_HORIZON = {
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
};

const DEFAULT_ASSET_RELATION = {
  allowed_tags: [],
  forbidden_tags: ["compliance notice", "disclaimer", "목차", "table of contents"],
  second_order_tags: [],
  allowed_categories: [],
  relation_weights: {
    direct: 1,
    thematic: 0.72,
    second_order: 0.45,
    account: 0.2,
    blocked: 0,
  },
};

let assetRelationConfig = { default: DEFAULT_ASSET_RELATION, assets: {} };

const REGIME_CATEGORY_MULTIPLIERS = {
  BULL: { risk: 1.12, defensive: 0.92, cash: 0.78, other: 1 },
  SIDEWAYS: { risk: 1, defensive: 1, cash: 1, other: 1 },
  BEAR: { risk: 0.82, defensive: 1.08, cash: 1.25, other: 0.95 },
  HIGH_VOL: { risk: 0.72, defensive: 1.12, cash: 1.55, other: 0.9 },
};

const SCORE_WEIGHT_MULTIPLIERS = {
  risk: 1,
  defensive: 0.82,
  cash: 0.22,
  other: 0.55,
};

const STAGE2_STANCE_RAW = {
  buy: 0.65,
  hold: 0.15,
  watch: -0.1,
  trim: -0.55,
  reduce: -0.7,
};

function detectRegime(technical, fred) {
  const market = technical?.market_context ?? {};
  const ma20 = market.ma?.ma20 ?? null;
  const ma60 = market.ma?.ma60 ?? null;
  const close = market.close ?? null;
  const marketScore = market.score ?? 0;

  // FRED 데이터: VIX는 FRED가 더 정확 (fetch-market-data.js가 null 반환하는 경우 보완)
  const vix = fred?.VIXCLS ?? (typeof market.vix === "number" ? market.vix : null);
  const t10y2y = typeof fred?.T10Y2Y === "number" ? fred.T10Y2Y : null;
  const cpiYoy = typeof fred?.CPIAUCSL_YOY === "number" ? fred.CPIAUCSL_YOY : null;
  const cgMomentum = fred?.copper_gold_ratio?.momentum ?? null;

  // 각 신호의 방향성 투표 (bullish: +1, bearish: -1, neutral: 0)
  const votes = [];

  // 1. VIX
  if (vix != null) {
    if (vix >= 30) votes.push({ signal: "vix", vote: -2, label: `VIX ${vix}>=30` });
    else if (vix >= 20) votes.push({ signal: "vix", vote: -1, label: `VIX ${vix}>=20` });
    else votes.push({ signal: "vix", vote: 1, label: `VIX ${vix}<20` });
  }

  // 2. 장단기 금리 스프레드
  if (t10y2y != null) {
    if (t10y2y < -0.5) votes.push({ signal: "yield_curve", vote: -2, label: `T10Y2Y ${t10y2y}<-0.5 (강한 역전)` });
    else if (t10y2y < 0) votes.push({ signal: "yield_curve", vote: -1, label: `T10Y2Y ${t10y2y}<0 (약한 역전)` });
    else if (t10y2y > 0.5) votes.push({ signal: "yield_curve", vote: 1, label: `T10Y2Y ${t10y2y}>0.5` });
    else votes.push({ signal: "yield_curve", vote: 0, label: `T10Y2Y ${t10y2y} (플랫)` });
  }

  // 3. 인플레이션
  if (cpiYoy != null) {
    if (cpiYoy > 4) votes.push({ signal: "inflation", vote: -1, label: `CPI YoY ${cpiYoy}%>4%` });
    else if (cpiYoy > 2.5) votes.push({ signal: "inflation", vote: 0, label: `CPI YoY ${cpiYoy}% 보통` });
    else votes.push({ signal: "inflation", vote: 1, label: `CPI YoY ${cpiYoy}%<2.5%` });
  }

  // 4. 구리/금 비율 방향성
  if (cgMomentum) {
    votes.push({ signal: "copper_gold", vote: cgMomentum === "rising" ? 1 : -1, label: `구리/금 ${cgMomentum}` });
  }

  // 5. 가격 추세 (기존 로직 유지)
  if (close != null && ma20 != null && ma60 != null) {
    if (close > ma20 && ma20 > ma60) votes.push({ signal: "price_trend", vote: 1, label: "가격>MA20>MA60" });
    else if (close < ma20 && ma20 < ma60) votes.push({ signal: "price_trend", vote: -1, label: "가격<MA20<MA60" });
    else votes.push({ signal: "price_trend", vote: 0, label: "추세 혼재" });
  }

  const voteSum = votes.reduce((s, v) => s + v.vote, 0);
  const signals = votes.map((v) => v.label);

  // HIGH_VOL: VIX >= 30 또는 종합 투표 ≤ -3
  if ((vix != null && vix >= 30) || voteSum <= -3) {
    const conf = vix != null && vix >= 30 ? 0.80 : clamp(0.60 + Math.abs(voteSum) * 0.04, 0.60, 0.85);
    return { name: "HIGH_VOL", confidence: toRoundedNumber(conf, 2), voteSum, signals };
  }

  // STAGFLATION: 인플레 높고 스프레드 역전
  if (cpiYoy != null && cpiYoy > 4 && t10y2y != null && t10y2y < 0) {
    return { name: "STAGFLATION", confidence: 0.70, voteSum, signals };
  }

  // BULL: 다수 긍정 신호
  if (voteSum >= 2 && marketScore >= 50) {
    const conf = clamp(0.60 + voteSum * 0.04, 0.60, 0.85);
    return { name: "BULL", confidence: toRoundedNumber(conf, 2), voteSum, signals };
  }

  // BEAR: 다수 부정 신호
  if (voteSum <= -1 && marketScore <= 45) {
    const conf = clamp(0.58 + Math.abs(voteSum) * 0.04, 0.58, 0.82);
    return { name: "BEAR", confidence: toRoundedNumber(conf, 2), voteSum, signals };
  }

  return { name: "SIDEWAYS", confidence: 0.55, voteSum, signals };
}

function computeLeadingIndicatorScore(fred) {
  if (!fred) return { score: 50, available: false };
  const signals = fred.leading_signals ?? {};
  const composite = signals.composite_score;
  if (typeof composite !== "number") return { score: 50, available: false };
  return {
    score: Math.round(clamp(composite, 0, 100)),
    available: true,
    t10y2y: fred.T10Y2Y ?? null,
    vix: fred.VIXCLS ?? null,
    cpiYoy: fred.CPIAUCSL_YOY ?? null,
    cgMomentum: fred.copper_gold_ratio?.momentum ?? null,
  };
}

function valueOrFallback(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toRoundedNumber(value, digits = 3) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Number.parseFloat(value.toFixed(digits));
}

function normalizeConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 1);
  }
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "HIGH") return 0.85;
    if (normalized === "MEDIUM") return 0.65;
    if (normalized === "LOW") return 0.45;
  }
  return 0.55;
}

function holdingCategory(accountKey, code) {
  if (!code) return "기타";
  const mapping = CATEGORY_BY_CODE[code];
  if (!mapping) return "기타";
  if (mapping[accountKey]) return mapping[accountKey];
  return mapping.default;
}

function categoryBucket(category) {
  if (category === "현금파킹") return "cash";
  if (category === "금" || category === "배당/커버드콜") return "defensive";
  if (category === "기타") return "other";
  return "risk";
}

function categoryScoreWeight(category, marketValue) {
  const bucket = categoryBucket(category);
  const multiplier = SCORE_WEIGHT_MULTIPLIERS[bucket] ?? 1;
  return Math.max(marketValue ?? 0, 0) * multiplier;
}

function getCategoryCurrentPct(allocationState, categoryName) {
  return allocationState.categories.find((item) => item.category === categoryName)?.currentPct ?? 0;
}

function allocationDiffPenalty(
  categories,
  desiredAllocation,
  { cashOverweightWeight = 0.2, cashFundedShortfallWeight = 0.45 } = {},
) {
  const currentPctByCategory = new Map(
    (categories ?? []).map((item) => [item.category, item.currentPct ?? 0]),
  );
  const categoryNames = [...new Set([
    ...(categories ?? []).map((item) => item.category),
    ...Object.keys(desiredAllocation ?? {}),
  ])];

  const currentCashPct = currentPctByCategory.get("현금파킹") ?? 0;
  const desiredCashPct = desiredAllocation?.["현금파킹"] ?? 0;
  let diff = 0;
  let remainingCashBuffer = Math.max(currentCashPct - desiredCashPct, 0);

  if (currentCashPct > desiredCashPct) {
    // 여유 현금은 과도한 리스크보다는 완만한 기회비용으로만 반영한다.
    diff += (currentCashPct - desiredCashPct) * cashOverweightWeight;
  } else {
    diff += desiredCashPct - currentCashPct;
  }

  const nonCashGaps = categoryNames
    .filter((category) => category !== "현금파킹")
    .map((category) => ({
      category,
      gap: (currentPctByCategory.get(category) ?? 0) - (desiredAllocation?.[category] ?? 0),
    }));

  for (const item of nonCashGaps
    .filter((entry) => entry.gap < 0)
    .sort((left, right) => Math.abs(right.gap) - Math.abs(left.gap))) {
    const shortfall = Math.abs(item.gap);
    const cashCovered = Math.min(shortfall, remainingCashBuffer);
    diff += cashCovered * cashFundedShortfallWeight + (shortfall - cashCovered);
    remainingCashBuffer -= cashCovered;
  }

  for (const item of nonCashGaps.filter((entry) => entry.gap >= 0)) {
    diff += item.gap;
  }

  return diff;
}

function adjustedTechnicalScore({ category, rawScore, regimeName, allocationState }) {
  if (typeof rawScore !== "number") return null;

  if (category !== "현금파킹") {
    return rawScore;
  }

  const currentCashPct = getCategoryCurrentPct(allocationState, "현금파킹");
  const targetCashPct = allocationState.targetAllocation["현금파킹"] ?? 0;
  const excessCashPct = currentCashPct - targetCashPct;
  const policyBase =
    regimeName === "HIGH_VOL"
      ? 74
      : regimeName === "BEAR"
        ? 68
        : excessCashPct > 0.2
          ? 56
          : excessCashPct > 0.08
            ? 60
            : Math.abs(excessCashPct) <= 0.05
              ? 62
              : 58;

  return Math.round(clamp(rawScore * 0.1 + policyBase * 0.9, 0, 100));
}

function deriveFeatureVector(technicalItem) {
  const close = valueOrFallback(technicalItem?.close, 0);
  const ma20 = valueOrFallback(technicalItem?.ma?.ma20, close || 1);
  const ma60 = valueOrFallback(technicalItem?.ma?.ma60, ma20 || 1);
  const ma120 = valueOrFallback(technicalItem?.ma?.ma120, ma60 || 1);
  const rsi = valueOrFallback(technicalItem?.rsi, 50);
  const macdHist = valueOrFallback(technicalItem?.macd?.histogram, 0);
  const macdSignal = Math.abs(valueOrFallback(technicalItem?.macd?.signal, 1)) || 1;
  const adx = valueOrFallback(technicalItem?.adx?.value, 20);
  const stochK = valueOrFallback(technicalItem?.stochastic?.k, 50);
  const stochD = valueOrFallback(technicalItem?.stochastic?.d, 50);
  const volumeRatio = valueOrFallback(technicalItem?.volume_ratio, 1);

  const maTrend = clamp((((close / ma20) - 1) * 10 + ((ma20 / ma60) - 1) * 12 + ((ma60 / ma120) - 1) * 14), -2.5, 2.5);
  const macdZ = clamp(macdHist / macdSignal, -2.5, 2.5);
  const rsiMid = clamp((rsi - 50) / 12.5, -2.5, 2.5);
  const adxTrend = clamp((adx - 20) / 12, -2.0, 2.0);

  let bbDist = 0;
  const bbPosition = technicalItem?.bollinger?.position;
  if (bbPosition === "below_lower") bbDist = 1.7;
  else if (bbPosition === "lower_half") bbDist = 0.45;
  else if (bbPosition === "upper_half") bbDist = -0.35;
  else if (bbPosition === "above_upper") bbDist = -1.7;

  const rsiTiming = clamp((50 - rsi) / 10, -2.5, 2.5);
  const stochTiming = clamp((50 - (stochK + stochD) / 2) / 12, -2.5, 2.5);
  const volumeZ = clamp(volumeRatio - 1, -1.5, 2.5);

  return {
    maTrend,
    macdZ,
    rsiMid,
    adxTrend,
    bbDist,
    rsiTiming,
    stochTiming,
    volumeZ,
  };
}

function codeThemeKeywords(code, _category) {
  // securities.json의 keywords.theme 기반 (THEME_KEYWORDS_BY_CODE)
  return THEME_KEYWORDS_BY_CODE[code] ?? [];
}

function themeMatchesHolding(code, category, value) {
  const keywords = codeThemeKeywords(code, category);
  if (keywords.length === 0 || typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function assetRelationSpec(code) {
  return {
    ...DEFAULT_ASSET_RELATION,
    ...(assetRelationConfig.default ?? {}),
    ...(assetRelationConfig.assets?.[code] ?? {}),
    relation_weights: {
      ...DEFAULT_ASSET_RELATION.relation_weights,
      ...(assetRelationConfig.default?.relation_weights ?? {}),
      ...(assetRelationConfig.assets?.[code]?.relation_weights ?? {}),
    },
  };
}

function relationTagHit(haystack, tags = []) {
  return tags.some((tag) => haystack.includes(normalizeText(tag)));
}

function classifyImpactRelation({ impact, targetCode, category }) {
  const spec = assetRelationSpec(targetCode);
  const haystack = normalizeText(
    [
      impact.title,
      impact.reason,
      impact.targetType,
      impact.reportType,
      category,
      ...(impact.evidenceNumbers ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (relationTagHit(haystack, spec.forbidden_tags)) {
    return { relationType: "blocked", relationWeight: 0, evidenceScore: 0 };
  }

  if (impact.targetType === "holding") {
    return { relationType: "direct", relationWeight: spec.relation_weights.direct ?? 1, evidenceScore: 1 };
  }

  const categoryHit =
    spec.allowed_categories.includes(category) ||
    relationTagHit(haystack, spec.allowed_categories);
  const allowedHit = relationTagHit(haystack, spec.allowed_tags);
  const secondOrderHit = relationTagHit(haystack, spec.second_order_tags);

  if (categoryHit || allowedHit) {
    return {
      relationType: "thematic",
      relationWeight: spec.relation_weights.thematic ?? 0.72,
      evidenceScore: categoryHit ? 0.82 : 0.72,
    };
  }

  if (secondOrderHit) {
    return {
      relationType: "second_order",
      relationWeight: spec.relation_weights.second_order ?? 0.45,
      evidenceScore: 0.48,
    };
  }

  if (impact.targetType === "account" || impact.targetType === "portfolio") {
    return {
      relationType: "account",
      relationWeight: spec.relation_weights.account ?? 0.2,
      evidenceScore: 0.25,
    };
  }

  return { relationType: "blocked", relationWeight: 0, evidenceScore: 0 };
}

function parseDateValue(dateText) {
  if (typeof dateText !== "string" || !dateText) return null;
  const parsed = new Date(`${dateText}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decayWeight(referenceDate, publishedDateText, halfLifeDays) {
  const publishedDate = parseDateValue(publishedDateText);
  if (!publishedDate) return 1;
  const ageDays = Math.max(
    0,
    Math.floor((referenceDate.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const denominator = Math.max(halfLifeDays ?? 30, 1);
  return Math.pow(0.5, ageDays / denominator);
}

function directionSign(direction) {
  if (direction === "positive") return 1;
  if (direction === "negative") return -1;
  if (direction === "mixed") return -0.2;
  return 0;
}

function impactContribution(impact, referenceDate, regimeName = "SIDEWAYS") {
  const sign = directionSign(impact.direction);
  const strength = clamp(valueOrFallback(impact.strength, 0.3), 0, 1);
  const confidence = normalizeConfidence(impact.confidence);
  const horizonWeight = {
    "1w": 0.8,
    "1m": 1,
    "3m": 1.15,
    "6m": 1.25,
  }[impact.horizon] ?? 1;
  const typeWeight =
    (REGIME_TYPE_WEIGHTS[regimeName] ?? REGIME_TYPE_WEIGHTS.SIDEWAYS)[impact.targetType] ?? 0.4;
  const reportTypeWeight =
    (REGIME_REPORT_TYPE_WEIGHTS[regimeName] ?? REGIME_REPORT_TYPE_WEIGHTS.SIDEWAYS)[impact.reportType] ??
    REPORT_TYPE_WEIGHTS[impact.reportType] ??
    0.45;
  const halfLifeDays = impact.decayHalfLifeDays ?? IMPACT_HALF_LIFE_BY_HORIZON[impact.horizon] ?? 30;
  const decay = decayWeight(referenceDate, impact.publishedDate, halfLifeDays);
  return sign * strength * confidence * horizonWeight * typeWeight * reportTypeWeight * decay;
}

function normalizeImpactMapEntries(impactMap, targetCode, accountKey, category) {
  const entries = [];
  for (const report of impactMap?.reports ?? []) {
    for (const impact of report.impacts ?? []) {
      const target = impact.target ?? {};
      const targetType = target.type ?? null;
      const matchesHolding =
        (targetType === "holding" && target.code === targetCode) ||
        (targetType === "theme" && themeMatchesHolding(targetCode, category, target.name)) ||
        (targetType === "category" && target.name === category);
      const matchesAccount =
        targetType === "account" &&
        (target.accountKey === accountKey || target.name === accountKey);
      const matchesPortfolio = targetType === "portfolio";

      if (!matchesHolding && !matchesAccount && !matchesPortfolio) continue;

      entries.push({
        reportId: report.reportId,
        title: report.title,
        broker: report.broker ?? null,
        publishedDate: report.publishedDate ?? impact.publishedDate ?? null,
        reportType: report.reportMeta?.report_type ?? null,
        targetType,
        direction: impact.direction ?? "neutral",
        strength: impact.strength ?? 0.3,
        confidence: impact.confidence ?? 0.6,
        horizon: impact.horizon ?? "1m",
        decayHalfLifeDays: impact.decayHalfLifeDays ?? null,
        reason:
          impact.evidence?.snippets?.[0] ??
          impact.evidence?.numbers?.[0] ??
          report.reportMeta?.key_numbers?.[0] ??
          "impact-map 근거",
        evidenceNumbers: impact.evidence?.numbers ?? [],
      });
    }
  }
  return entries;
}

function normalizeStage1Entries(stage1Extracts, targetCode, accountKey, category, includeAccountWide = false) {
  const entries = [];
  for (const extract of stage1Extracts ?? []) {
    const extractConfidence = normalizeConfidence(extract.confidence);
    const relatedHolding =
      (extract.related_holdings_in_my_portfolio ?? []).some((item) => item?.code === targetCode);
    const relatedAccount = (extract.related_accounts ?? []).includes(accountKey);
    for (const impact of extract.portfolio_impacts_candidate ?? []) {
      const targetType = impact.target_type ?? "holding";
      const matchesHolding =
        (targetType === "holding" && impact.target_code === targetCode) ||
        (targetType === "theme" && themeMatchesHolding(targetCode, category, impact.target_name)) ||
        (targetType === "category" && impact.target_name === category);
      const matchesAccount = targetType === "account" && impact.account_key === accountKey;
      if (!matchesHolding && !(includeAccountWide && matchesAccount)) continue;
      if (!matchesHolding && !relatedAccount) continue;
      if (matchesHolding && !relatedHolding && extractConfidence < 0.7 && valueOrFallback(impact.strength, 0) < 0.55) {
        continue;
      }

      entries.push({
        reportId: extract.id,
        title: extract.title,
        broker: extract.broker ?? null,
        publishedDate: extract.date ?? null,
        reportType: extract.report_type ?? null,
        targetType,
        direction: impact.direction ?? "neutral",
        strength: impact.strength ?? 0.3,
        confidence: extractConfidence,
        horizon: impact.horizon ?? "1m",
        decayHalfLifeDays: IMPACT_HALF_LIFE_BY_HORIZON[impact.horizon] ?? 30,
        reason: impact.reason ?? extract.key_thesis ?? "Stage 1 후보 영향",
        evidenceNumbers: extract.key_numbers ?? [],
      });
    }
  }
  return entries;
}

function aggregateHoldingReportImpacts({
  impactMap,
  stage1Extracts,
  targetCode,
  accountKey,
  category,
  referenceDate,
  regimeName,
}) {
  const confirmed = normalizeImpactMapEntries(impactMap, targetCode, accountKey, category).filter(
    (item) => item.targetType !== "account" && item.targetType !== "portfolio",
  );
  const fallback = normalizeStage1Entries(stage1Extracts, targetCode, accountKey, category, false);
  const relationCounts = {
    direct: 0,
    thematic: 0,
    second_order: 0,
    blocked: 0,
  };
  const relationCandidates = (confirmed.length > 0 ? confirmed : fallback).map((impact) => {
    const relation = classifyImpactRelation({ impact, targetCode, category });
    relationCounts[relation.relationType] = (relationCounts[relation.relationType] ?? 0) + 1;
    return {
      ...impact,
      relationType: relation.relationType,
      relationWeight: relation.relationWeight,
      evidenceScore: relation.evidenceScore,
      contribution: impactContribution(impact, referenceDate, regimeName) * relation.relationWeight,
    };
  });
  const rawImpacts = relationCandidates
    .filter((impact) => impact.relationWeight > 0)
    .filter((impact) => Math.abs(impact.contribution) >= 0.025)
    .sort((left, right) => {
      if (right.evidenceScore !== left.evidenceScore) return right.evidenceScore - left.evidenceScore;
      return Math.abs(right.contribution) - Math.abs(left.contribution);
    });

  const impacts = rawImpacts.slice(0, confirmed.length > 0 ? 8 : 6);
  const averageContribution =
    impacts.length > 0
      ? impacts.reduce((sum, impact) => sum + impact.contribution, 0) / impacts.length
      : 0;
  const contributionScale =
    confirmed.length > 0
      ? clamp(Math.log2(impacts.length + 1), 0.6, 1.85)
      : clamp(Math.log2(impacts.length + 1) * 0.82, 0.45, 1.35);
  const raw = averageContribution * contributionScale * 2.4;
  const score = Math.round(sigmoid(raw * 1.2) * 100);
  const directHoldingHits = impacts.filter((impact) => impact.targetType === "holding").length;
  const thematicHits = impacts.filter(
    (impact) => impact.targetType === "category" || impact.targetType === "theme",
  ).length;
  const coverageWeight = clamp(
    directHoldingHits > 0
      ? 1
      : thematicHits > 0
        ? 0.55
        : impacts.length > 0
          ? 0.3
          : 0,
    0,
    1,
  );
  return {
    sourceLayer: confirmed.length > 0 ? "impact-map" : "stage1-candidate-capped",
    value: clamp(raw, -2.5, 2.5),
    score,
    coverageWeight: toRoundedNumber(coverageWeight, 3),
    impacts: impacts.slice(0, 5).map(({ contribution, ...rest }) => ({
      ...rest,
      contribution: toRoundedNumber(contribution, 4),
    })),
    impactCount: rawImpacts.length,
    relationSummary: {
      directCount: relationCounts.direct,
      thematicCount: relationCounts.thematic,
      secondOrderCount: relationCounts.second_order,
      blockedCount: relationCounts.blocked,
      unrelatedEvidenceRatio:
        relationCandidates.length > 0
          ? toRoundedNumber((relationCounts.blocked ?? 0) / relationCandidates.length, 4)
          : 0,
    },
  };
}

function aggregateAccountDirectImpacts({
  impactMap,
  stage1Extracts,
  accountKey,
  referenceDate,
  regimeName,
}) {
  const confirmed = normalizeImpactMapEntries(impactMap, null, accountKey, null).filter(
    (item) => item.targetType === "account" || item.targetType === "portfolio",
  );
  const fallback = normalizeStage1Entries(stage1Extracts, null, accountKey, null, true).filter(
    (item) => item.targetType === "account",
  );
  const rawImpacts = (confirmed.length > 0 ? confirmed : fallback)
    .map((impact) => ({
      ...impact,
      contribution: impactContribution(impact, referenceDate, regimeName),
    }))
    .filter((impact) => Math.abs(impact.contribution) >= 0.03)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));

  const impacts = rawImpacts.slice(0, confirmed.length > 0 ? 6 : 4);
  const averageContribution =
    impacts.length > 0
      ? impacts.reduce((sum, impact) => sum + impact.contribution, 0) / impacts.length
      : 0;
  const raw = averageContribution * clamp(Math.log2(impacts.length + 1), 0.5, 1.6) * 1.9;
  return {
    value: clamp(raw, -1.5, 1.5),
    score: Math.round(sigmoid(raw * 1.1) * 100),
    impacts: impacts.slice(0, 4).map(({ contribution, ...rest }) => ({
      ...rest,
      contribution: toRoundedNumber(contribution, 4),
    })),
  };
}

function computeActionScore(technicalItem, reportImpact, regimeName) {
  const features = deriveFeatureVector(technicalItem);
  const weights = REGIME_WEIGHTS[regimeName] ?? REGIME_WEIGHTS.SIDEWAYS;

  const direction =
    features.maTrend * weights.direction.ma +
    features.macdZ * weights.direction.macd +
    features.rsiMid * weights.direction.rsi +
    features.adxTrend * weights.direction.adx +
    reportImpact.value * weights.direction.report;

  const timing =
    features.bbDist * weights.timing.bb +
    features.rsiTiming * weights.timing.rsi +
    features.stochTiming * weights.timing.stoch +
    features.volumeZ * weights.timing.volume +
    reportImpact.value * weights.timing.report;

  const raw = 0.58 * direction + 0.27 * timing + 0.15 * reportImpact.value + weights.bias;
  const actionScore = Math.round(sigmoid(raw) * 100);

  const [pBuy, pHold, pSell] = softmax([
    0.9 * direction + 0.5 * timing + 0.7 * reportImpact.value + weights.bias,
    0.15 - Math.abs(direction - timing) * 0.1,
    -0.9 * direction - 0.45 * timing - 0.7 * reportImpact.value - weights.bias,
  ]);

  const sameSign =
    Math.sign(direction || 0) === Math.sign(timing || 0) &&
    Math.sign(direction || 0) === Math.sign(reportImpact.value || 0);
  const magnitude = Math.abs(direction) + Math.abs(timing) + Math.abs(reportImpact.value);
  const conviction = sameSign && magnitude > 2.8 ? "HIGH" : magnitude > 1.7 ? "MEDIUM" : "LOW";
  const signal = actionSignalFromScore(actionScore);

  return {
    actionScore,
    direction: toRoundedNumber(direction),
    timing: toRoundedNumber(timing),
    reportScore: toRoundedNumber(reportImpact.value),
    probabilities: {
      p_buy: toRoundedNumber(pBuy, 4),
      p_hold: toRoundedNumber(pHold, 4),
      p_sell: toRoundedNumber(pSell, 4),
    },
    conviction,
    signal,
    features,
  };
}

function actionSignalFromScore(actionScore) {
  return actionScore >= 72 ? "BUY" : actionScore >= 58 ? "HOLD" : actionScore >= 42 ? "WATCH" : "REDUCE";
}

function normalizeStrategyAccountKey(account, strategy) {
  const candidates = [
    account.key,
    account.label,
    account.key === "PENSION" ? "연금저축" : null,
    account.key === "ISA" ? "ISA" : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (strategy?.accounts?.[candidate]) {
      return candidate;
    }
  }
  return null;
}

function buildAllocationState(account, strategy) {
  const strategyKey = normalizeStrategyAccountKey(account, strategy);
  const targetAllocation = strategy?.accounts?.[strategyKey]?.target_allocation ?? {};
  const holdingsValue = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const totalAssets = accountTotalAssets(account);
  const amounts = new Map();
  for (const holding of account.holdings ?? []) {
    const category = holdingCategory(account.key, holding.code);
    amounts.set(category, (amounts.get(category) ?? 0) + (holding.marketValue ?? 0));
  }
  if (targetAllocation["현금파킹"] != null) {
    amounts.set("현금파킹", account.cashAvailable ?? 0);
  }

  const categories = [...new Set([...Object.keys(targetAllocation), ...amounts.keys()])].map((category) => {
    const currentAmount = amounts.get(category) ?? 0;
    const currentPct = totalAssets > 0 ? currentAmount / totalAssets : 0;
    const targetPct = targetAllocation[category] ?? 0;
    return {
      category,
      currentAmount,
      currentPct,
      targetPct,
      gapPct: targetPct - currentPct,
    };
  });

  return {
    totalAssets,
    holdingsValue,
    cashValue: account.cashAvailable ?? 0,
    targetAllocation,
    categories,
  };
}

function allocationScoreForAccount(allocationState) {
  const diff = allocationDiffPenalty(allocationState.categories, allocationState.targetAllocation);
  return Math.round(clamp((1 - diff / 2) * 100, 0, 100));
}

function adjustedRegimeTargets(targetAllocation, regimeName) {
  const multipliers = REGIME_CATEGORY_MULTIPLIERS[regimeName] ?? REGIME_CATEGORY_MULTIPLIERS.SIDEWAYS;
  const weighted = Object.entries(targetAllocation).map(([category, pct]) => {
    const bucket = categoryBucket(category);
    const multiplier = multipliers[bucket] ?? 1;
    return [category, pct * multiplier];
  });
  const total = weighted.reduce((sum, [, value]) => sum + value, 0) || 1;
  return Object.fromEntries(weighted.map(([category, value]) => [category, value / total]));
}

function computeRegimeFit(allocationState, regimeName) {
  const desired = adjustedRegimeTargets(allocationState.targetAllocation, regimeName);
  const diff = allocationDiffPenalty(allocationState.categories, desired, {
    cashOverweightWeight: 0.25,
    cashFundedShortfallWeight: 0.55,
  });

  return {
    score: Math.round(clamp((1 - diff / 2) * 100, 0, 100)),
    desiredAllocation: desired,
  };
}

function chooseWeightProfile(strategy, regime) {
  const explicit = strategy?.scoring?.weightProfile ?? strategy?.score_profile ?? null;
  if (explicit && MAX_WEIGHT_PROFILES[explicit]) return explicit;
  if (regime.name === "HIGH_VOL" || regime.name === "BEAR") return "riskOff";
  return "balanced";
}

function effectiveWeights(profileName, coverage, regimeConfidence) {
  const maxWeights = MAX_WEIGHT_PROFILES[profileName] ?? MAX_WEIGHT_PROFILES.balanced;
  const weights = {
    factor: (maxWeights.factor ?? 0) * (coverage.factorCoverage ?? 0),
    tech: maxWeights.tech * coverage.techCoverage,
    report: maxWeights.report * coverage.impactCoverage,
    regime: maxWeights.regime * regimeConfidence,
    stage2: maxWeights.stage2 * (coverage.stage2Available ? 1 : 0),
    leading: (maxWeights.leading ?? 0) * (coverage.fredAvailable ? 1 : 0),
  };
  const used = weights.factor + weights.tech + weights.report + weights.regime + weights.stage2 + weights.leading;
  return {
    allocation: toRoundedNumber(Math.max(0, 1 - used), 4),
    factor: toRoundedNumber(weights.factor, 4),
    tech: toRoundedNumber(weights.tech, 4),
    report: toRoundedNumber(weights.report, 4),
    regime: toRoundedNumber(weights.regime, 4),
    stage2: toRoundedNumber(weights.stage2, 4),
    leading: toRoundedNumber(weights.leading, 4),
  };
}

function computeRiskPenalty({
  account,
  allocationState,
  coverage,
  regime,
  regimeFit,
  riskCaps,
  technicalMap,
  covarianceModel,
}) {
  const investable = (account.holdings ?? []).filter((holding) => (holding.marketValue ?? 0) > 0);
  const totalInvestable = investable.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0) || 1;
  const weights = investable.map((holding) => (holding.marketValue ?? 0) / totalInvestable);
  const hhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const maxPosition = weights.length > 0 ? Math.max(...weights) : 0;
  const hhiPenalty = hhi > 0.4 ? clamp(((hhi - 0.4) / 0.2) * 6, 0, 6) : 0;
  const maxPositionPenalty =
    maxPosition > 0.45 ? clamp(((maxPosition - 0.45) / 0.25) * 4, 0, 4) : 0;
  const concentrationTotal = clamp(hhiPenalty + maxPositionPenalty, 0, riskCaps.concentration);

  const unmappedPct =
    allocationState.categories.find((category) => category.category === "기타")?.currentPct ?? 0;
  const incompletePenalty = account.incomplete ? 5 : 0;
  const unmappedPenalty =
    unmappedPct > 0.05 ? clamp(3 + ((unmappedPct - 0.05) / 0.15) * 2, 0, 5) : 0;
  const missingTechnicalPenalty =
    coverage.techCoverage < 0.67 ? clamp((0.67 - coverage.techCoverage) * 6, 0, 4) : 0;
  const dataQualityTotal = clamp(
    incompletePenalty + unmappedPenalty + missingTechnicalPenalty,
    0,
    riskCaps.dataQuality,
  );

  const currentRiskPct = allocationState.categories
    .filter((category) => categoryBucket(category.category) === "risk")
    .reduce((sum, category) => sum + category.currentPct, 0);
  const desiredRiskPct = Object.entries(regimeFit.desiredAllocation)
    .filter(([category]) => categoryBucket(category) === "risk")
    .reduce((sum, [, pct]) => sum + pct, 0);
  const regimeStressExcess = Math.max(currentRiskPct - desiredRiskPct, 0);
  const regimeStressTotal =
    regime.name === "HIGH_VOL" || regime.name === "BEAR"
      ? clamp(((regimeStressExcess - 0.05) / 0.25) * riskCaps.regimeStress, 0, riskCaps.regimeStress)
      : 0;

  const covarianceInputs = investable
    .map((holding) => {
      const tech = technicalMap[holding.code];
      return {
        code: holding.code,
        weight: (holding.marketValue ?? 0) / totalInvestable,
        returns: tech?.daily_returns ?? [],
      };
    })
    .filter((entry) => entry.returns.length >= (covarianceModel?.minHistory ?? DEFAULT_COVARIANCE_MODEL.minHistory));
  const sampleCovariance = computeSampleCovarianceMatrix(covarianceInputs);
  const shrunkCovariance = covarianceModel?.enabled
    ? shrinkCovarianceMatrix(
        sampleCovariance?.matrix ?? null,
        covarianceModel?.shrinkage ?? DEFAULT_COVARIANCE_MODEL.shrinkage,
        covarianceModel?.ridge ?? DEFAULT_COVARIANCE_MODEL.ridge,
      )
    : null;
  const covarianceVariance =
    covarianceInputs.length > 1 && shrunkCovariance
      ? quadraticForm(
          covarianceInputs.map((entry) => entry.weight),
          shrunkCovariance,
        )
      : 0;
  const portfolioVolatility =
    covarianceVariance > 0
      ? Math.sqrt(covarianceVariance * (covarianceModel?.annualization ?? DEFAULT_COVARIANCE_MODEL.annualization))
      : 0;
  const covariancePenaltyRaw =
    (covarianceModel?.lambda ?? DEFAULT_COVARIANCE_MODEL.lambda) * portfolioVolatility * 10;
  const covarianceTotal =
    covarianceInputs.length > 1
      ? clamp(covariancePenaltyRaw, 0, riskCaps.covariance ?? DEFAULT_RISK_CAPS.covariance)
      : 0;

  // CVaR / MaxDrawdown (포트폴리오 가중 일별 수익률 기반)
  const holdingReturns = investable
    .map((holding) => {
      const tech = technicalMap[holding.code];
      return { weight: (holding.marketValue ?? 0) / totalInvestable, returns: tech?.daily_returns ?? [] };
    })
    .filter((h) => h.returns.length >= 10);

  let tailRiskTotal = 0;
  let maxDrawdown = null;
  let cvar95 = null;

  if (holdingReturns.length > 0) {
    // 포트폴리오 일별 수익률 (가중 평균)
    const minLen = Math.min(...holdingReturns.map((h) => h.returns.length));
    const portReturns = Array.from({ length: minLen }, (_, i) =>
      holdingReturns.reduce((sum, h) => sum + h.returns[h.returns.length - minLen + i] * h.weight, 0)
    );

    // MaxDrawdown: 누적 수익률 기준 최대 낙폭
    let peak = 1;
    let cumulative = 1;
    let maxDD = 0;
    for (const r of portReturns) {
      cumulative *= 1 + r;
      if (cumulative > peak) peak = cumulative;
      const dd = (peak - cumulative) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    maxDrawdown = toRoundedNumber(maxDD * 100, 2);

    // CVaR 95%: 하위 5% 수익률의 평균
    const sorted = [...portReturns].sort((a, b) => a - b);
    const cutoff = Math.max(1, Math.floor(sorted.length * 0.05));
    const tail = sorted.slice(0, cutoff);
    cvar95 = toRoundedNumber((tail.reduce((s, r) => s + r, 0) / tail.length) * 100, 4);

    // 패널티 계산
    let ddPenalty = 0;
    if (maxDD > 0.25) ddPenalty = clamp(((maxDD - 0.25) / 0.15) * 10, 0, 10);
    else if (maxDD > 0.15) ddPenalty = clamp(((maxDD - 0.15) / 0.10) * 5, 0, 5);

    const cvarPct = Math.abs(cvar95);
    const cvarPenalty = cvarPct > 3 ? clamp(((cvarPct - 3) / 3) * 5, 0, 5) : 0;

    tailRiskTotal = clamp(ddPenalty + cvarPenalty, 0, riskCaps.tailRisk);
  }

  const total = Math.round(
    clamp(
      dataQualityTotal + concentrationTotal + covarianceTotal + tailRiskTotal + regimeStressTotal,
      0,
      riskCaps.total,
    ),
  );

  const notes = [];
  if (account.incomplete) {
    notes.push("부분 캡처 계좌라 데이터 품질 패널티가 적용됐습니다.");
  }
  if (unmappedPct > 0.05) {
    notes.push(`'기타' 비중 ${toRoundedNumber(unmappedPct * 100, 1)}%가 남아 분류 품질 패널티가 붙었습니다.`);
  }
  if (regimeStressTotal > 0) {
    notes.push(`${regime.name} 레짐 대비 위험자산 비중이 높아 레짐 스트레스 패널티가 적용됐습니다.`);
  }
  if (concentrationTotal > 0) {
    notes.push("단일 포지션 또는 집중도가 높아 분산 패널티가 반영됐습니다.");
  }
  if (covarianceTotal > 0) {
    notes.push(`축소 공분산 기준 연율 변동성 ${toRoundedNumber(portfolioVolatility * 100, 2)}%로 상관 리스크 패널티가 반영됐습니다.`);
  }
  if (tailRiskTotal > 0) {
    notes.push(`최대낙폭 ${maxDrawdown}% / CVaR(95%) ${cvar95}% 수준으로 꼬리 리스크 패널티가 적용됐습니다.`);
  }

  return {
    total,
    portfolioVolatility: toRoundedNumber(portfolioVolatility, 4),
    breakdown: {
      dataQuality: {
        total: toRoundedNumber(dataQualityTotal, 2),
        incompletePenalty: toRoundedNumber(incompletePenalty, 2),
        unmappedExposurePct: toRoundedNumber(unmappedPct * 100, 2),
        unmappedPenalty: toRoundedNumber(unmappedPenalty, 2),
        missingTechnicalPenalty: toRoundedNumber(missingTechnicalPenalty, 2),
      },
      concentration: {
        total: toRoundedNumber(concentrationTotal, 2),
        hhi: toRoundedNumber(hhi, 4),
        hhiPenalty: toRoundedNumber(hhiPenalty, 2),
        maxPositionPct: toRoundedNumber(maxPosition * 100, 2),
        maxPositionPenalty: toRoundedNumber(maxPositionPenalty, 2),
      },
      covariance: {
        total: toRoundedNumber(covarianceTotal, 2),
        annualizedVolatility: toRoundedNumber(portfolioVolatility * 100, 2),
        sampleCount: sampleCovariance?.sampleCount ?? null,
        holdingsWithData: covarianceInputs.length,
        shrinkage: toRoundedNumber(covarianceModel?.shrinkage ?? DEFAULT_COVARIANCE_MODEL.shrinkage, 3),
        lambda: toRoundedNumber(covarianceModel?.lambda ?? DEFAULT_COVARIANCE_MODEL.lambda, 3),
      },
      tailRisk: {
        total: toRoundedNumber(tailRiskTotal, 2),
        method: holdingReturns.length > 0 ? "portfolio_weighted_returns" : "not_applicable",
        maxDrawdownPct: maxDrawdown,
        cvar95Pct: cvar95,
        holdingsWithData: holdingReturns.length,
      },
      regimeStress: {
        total: toRoundedNumber(regimeStressTotal, 2),
        currentRiskPct: toRoundedNumber(currentRiskPct * 100, 2),
        desiredRiskPct: toRoundedNumber(desiredRiskPct * 100, 2),
        excessRiskPct: toRoundedNumber(regimeStressExcess * 100, 2),
      },
    },
    notes,
  };
}

function holdingExplanation(
  holding,
  technicalItem,
  reportImpact,
  action,
  finalAction = null,
  stopLoss = null,
) {
  const topDrivers = [];
  const warnings = [];
  const effectiveAction = finalAction ?? action;

  if (technicalItem?.score != null) {
    topDrivers.push(`기술 기본점수 ${technicalItem.score}점`);
  } else {
    warnings.push("기술 스냅샷이 없어 리포트/배분 쪽 해석 비중이 커졌습니다.");
  }

  if (reportImpact.impactCount > 0) {
    topDrivers.push(`리포트 영향 ${reportImpact.score}점 (${reportImpact.impactCount}건 연결)`);
  }

  if (typeof technicalItem?.rsi === "number") {
    topDrivers.push(`RSI ${technicalItem.rsi.toFixed(1)}`);
  }

  if (effectiveAction?.blended && Math.abs(effectiveAction.delta ?? 0) >= 4) {
    const signedDelta = `${(effectiveAction.delta ?? 0) > 0 ? "+" : ""}${effectiveAction.delta}`;
    topDrivers.push(`팩터 보정 ${signedDelta}점`);
  }

  if (effectiveAction?.signal === "REDUCE" || effectiveAction?.signal === "WATCH") {
    warnings.push(`${effectiveAction.signal} 구간이라 비중 확대보다 관찰/점검이 우선입니다.`);
  }

  if (stopLoss?.triggered) {
    warnings.push("손절 규칙이 발동해 최종 신호를 강제 Trim 구간으로 낮췄습니다.");
    topDrivers.push("손절 오버라이드 적용");
  }

  return { topDrivers, warnings };
}

function accountNote(totalScore, riskPenaltyTotal) {
  if (totalScore >= 72 && riskPenaltyTotal <= 5) {
    return "배분·기술·리포트가 비교적 균형적이며 리스크 패널티도 낮습니다.";
  }
  if (riskPenaltyTotal >= 10) {
    return "기본 점수보다 리스크 패널티가 점수를 크게 누르고 있어 구조 조정이 우선입니다.";
  }
  if (totalScore >= 55) {
    return "선별적 보강은 가능하지만 약한 자산군과 패널티 요인을 함께 줄여야 합니다.";
  }
  return "배분 괴리 또는 리스크 패널티가 커서 공격적 확대보다 재정비가 우선입니다.";
}

function weightedAverage(items) {
  const totalWeight = items.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
  if (totalWeight <= 0) return null;
  return items.reduce((sum, item) => sum + item.value * (item.weight / totalWeight), 0);
}

function accountTotalAssets(account) {
  const holdingsValue = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  return Math.max(account.evaluationAmount ?? 0, holdingsValue + (account.cashAvailable ?? 0));
}

function normalizeStage2CandidateMap(stage2Data) {
  const entries = (stage2Data?.candidate_scores ?? []).map((item) => {
    const confidence = normalizeConfidence(item?.confidence);
    return [
      item.code,
      {
        stance: item?.stance ?? "hold",
        confidence,
        targetAccounts: item?.target_accounts ?? [],
      },
    ];
  });
  return new Map(entries);
}

function positionKey(accountKey, code) {
  return `${accountKey}:${code}`;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values, center) {
  if (values.length <= 1) return 0;
  const avg = typeof center === "number" ? center : mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    Math.max(values.length - 1, 1);
  return Math.sqrt(Math.max(variance, 0));
}

function stage2ResearchRaw(candidate) {
  if (!candidate) return 0;
  const stance = STAGE2_STANCE_RAW[candidate.stance] ?? 0;
  return stance + (candidate.confidence - 0.5) * 0.8;
}

function factorAvailability(rawFactors) {
  const availability = {
    momentum: rawFactors.momentumAvailable ? 1 : 0,
    research: rawFactors.researchAvailable ? 1 : 0,
    income: 1,
    macroFit: 1,
  };
  const factorCoverage = mean(Object.values(availability));
  return {
    availability,
    factorCoverage: toRoundedNumber(factorCoverage, 4),
  };
}

function estimateIncomeYield(category, taxAwareConfig) {
  const defaultYieldMap = taxAwareConfig?.defaultYieldByCategory ?? {};
  return clamp(valueOrFallback(defaultYieldMap[category], 0), 0, 0.25);
}

function shouldApplyFactorBlend(rawScore, factorScore, holdingBlendConfig) {
  const gateMode = holdingBlendConfig?.gateMode ?? "none";
  if (gateMode === "none") return true;

  if (gateMode === "sameSide50") {
    return (
      Math.sign(rawScore - 50) === Math.sign(factorScore - 50) ||
      rawScore === 50 ||
      factorScore === 50
    );
  }

  const rawSignal = actionSignalFromScore(rawScore);
  const factorSignal = actionSignalFromScore(factorScore);
  if (gateMode === "sameSignal") {
    return rawSignal === factorSignal;
  }

  if (gateMode === "sameSignalStrong") {
    return (
      rawSignal === factorSignal &&
      Math.abs(factorScore - 50) >= Math.max(valueOrFallback(holdingBlendConfig?.minFactorDistance, 8), 0)
    );
  }

  return true;
}

function blendHoldingActionScore({
  rawActionScore,
  factorScore,
  factorCoverage,
  holdingBlendConfig,
}) {
  const rawScore = clamp(Math.round(valueOrFallback(rawActionScore, 50)), 0, 100);
  const coverage = clamp(valueOrFallback(factorCoverage, 0), 0, 1);
  const factorAvailable = typeof factorScore === "number" && Number.isFinite(factorScore);
  const roundedFactorScore =
    factorAvailable
      ? Math.round(clamp(factorScore, 0, 100))
      : null;
  const rawSignal = actionSignalFromScore(rawScore);
  const factorSignal = roundedFactorScore != null ? actionSignalFromScore(roundedFactorScore) : null;
  const factorAllowed =
    roundedFactorScore != null &&
    shouldApplyFactorBlend(rawScore, roundedFactorScore, holdingBlendConfig);

  if (!holdingBlendConfig?.enabled || !factorAvailable || !factorAllowed) {
    return {
      score: rawScore,
      signal: rawSignal,
      blended: false,
      rawActionScore: rawScore,
      factorScore: roundedFactorScore,
      actionWeight: 1,
      factorWeight: 0,
      factorCoverage: toRoundedNumber(coverage, 4),
      delta: 0,
      gateMode: holdingBlendConfig?.gateMode ?? "none",
      factorApplied: false,
      rawSignal,
      factorSignal,
    };
  }

  const baseActionWeight = Math.max(valueOrFallback(holdingBlendConfig.actionWeight, 0.72), 0);
  const baseFactorWeight = Math.max(valueOrFallback(holdingBlendConfig.factorWeight, 0.28), 0);
  const minFactorCoverage = clamp(
    valueOrFallback(holdingBlendConfig.minFactorCoverage, 0.35),
    0,
    1,
  );
  const factorCoverageMultiplier =
    minFactorCoverage + coverage * (1 - minFactorCoverage);
  const effectiveActionWeight = baseActionWeight;
  const effectiveFactorWeight = baseFactorWeight * factorCoverageMultiplier;
  const totalWeight = effectiveActionWeight + effectiveFactorWeight;
  const normalizedActionWeight = totalWeight > 0 ? effectiveActionWeight / totalWeight : 1;
  const normalizedFactorWeight = totalWeight > 0 ? effectiveFactorWeight / totalWeight : 0;
  const unconstrainedScore =
    rawScore * normalizedActionWeight +
    clamp(factorScore, 0, 100) * normalizedFactorWeight;
  const maxAdjustment = Math.max(valueOrFallback(holdingBlendConfig.maxAdjustment, 18), 0);
  const blendedScore = clamp(
    unconstrainedScore,
    rawScore - maxAdjustment,
    rawScore + maxAdjustment,
  );
  const finalScore = Math.round(clamp(blendedScore, 0, 100));

  return {
    score: finalScore,
    signal: actionSignalFromScore(finalScore),
    blended: true,
    rawActionScore: rawScore,
    factorScore: roundedFactorScore,
    actionWeight: toRoundedNumber(normalizedActionWeight, 4),
    factorWeight: toRoundedNumber(normalizedFactorWeight, 4),
    factorCoverage: toRoundedNumber(coverage, 4),
    delta: toRoundedNumber(finalScore - rawScore, 2),
    gateMode: holdingBlendConfig?.gateMode ?? "none",
    factorApplied: true,
    rawSignal,
    factorSignal,
  };
}

function deriveHoldingEntryPrice(holding) {
  if (typeof holding?.avgPrice === "number" && Number.isFinite(holding.avgPrice)) {
    return holding.avgPrice;
  }

  if (
    typeof holding?.purchaseValue === "number" &&
    Number.isFinite(holding.purchaseValue) &&
    typeof holding?.quantity === "number" &&
    Number.isFinite(holding.quantity) &&
    holding.quantity > 0
  ) {
    return holding.purchaseValue / holding.quantity;
  }

  return null;
}

function applyStopLossOverride({
  holding,
  technicalItem,
  finalAction,
  stopLossConfig,
}) {
  const config = {
    ...DEFAULT_STOP_LOSS_CONFIG,
    ...(stopLossConfig ?? {}),
  };
  const entryPrice = deriveHoldingEntryPrice(holding);
  const currentPrice =
    technicalItem?.close ??
    (typeof holding?.currentPrice === "number" ? holding.currentPrice : null);
  const recentHigh = technicalItem?.recent_high?.value ?? null;
  const drawdownFromEntry =
    entryPrice != null && currentPrice != null && entryPrice !== 0
      ? currentPrice / entryPrice - 1
      : null;
  const drawdownFromRecentHigh =
    recentHigh != null && currentPrice != null && recentHigh !== 0
      ? currentPrice / recentHigh - 1
      : null;
  const triggers = [];

  if (
    config.enabled !== false &&
    drawdownFromEntry != null &&
    drawdownFromEntry <= (config.fromEntry_pct ?? DEFAULT_STOP_LOSS_CONFIG.fromEntry_pct)
  ) {
    triggers.push({
      type: "entry_drawdown",
      thresholdPct: config.fromEntry_pct ?? DEFAULT_STOP_LOSS_CONFIG.fromEntry_pct,
      observedPct: toRoundedNumber(drawdownFromEntry, 4),
    });
  }

  if (
    config.enabled !== false &&
    drawdownFromRecentHigh != null &&
    drawdownFromRecentHigh <=
      (config.fromRecentHigh_pct ?? DEFAULT_STOP_LOSS_CONFIG.fromRecentHigh_pct)
  ) {
    triggers.push({
      type: "recent_high_drawdown",
      thresholdPct:
        config.fromRecentHigh_pct ?? DEFAULT_STOP_LOSS_CONFIG.fromRecentHigh_pct,
      observedPct: toRoundedNumber(drawdownFromRecentHigh, 4),
      recentHighWindow:
        technicalItem?.recent_high?.window ??
        config.recentHighWindow ??
        DEFAULT_STOP_LOSS_CONFIG.recentHighWindow,
    });
  }

  if (!triggers.length) {
    return {
      finalAction,
      stopLoss: {
        enabled: config.enabled !== false,
        triggered: false,
        entryPrice: toRoundedNumber(entryPrice, 4),
        currentPrice: toRoundedNumber(currentPrice, 4),
        recentHigh: toRoundedNumber(recentHigh, 4),
        drawdownFromEntryPct: toRoundedNumber(drawdownFromEntry, 4),
        drawdownFromRecentHighPct: toRoundedNumber(drawdownFromRecentHigh, 4),
        triggers: [],
      },
    };
  }

  const forcedScore = Math.min(
    finalAction.score,
    config.forcedTrimScore ?? DEFAULT_STOP_LOSS_CONFIG.forcedTrimScore,
  );
  return {
    finalAction: {
      ...finalAction,
      score: forcedScore,
      signal: actionSignalFromScore(forcedScore),
      stopLossApplied: true,
      stopLossTriggers: triggers,
    },
    stopLoss: {
      enabled: true,
      triggered: true,
      entryPrice: toRoundedNumber(entryPrice, 4),
      currentPrice: toRoundedNumber(currentPrice, 4),
      recentHigh: toRoundedNumber(recentHigh, 4),
      drawdownFromEntryPct: toRoundedNumber(drawdownFromEntry, 4),
      drawdownFromRecentHighPct: toRoundedNumber(drawdownFromRecentHigh, 4),
      forcedScore,
      forcedSignal: actionSignalFromScore(forcedScore),
      triggers,
    },
  };
}

function computeFactorRawInputs({
  technicalItem,
  reportImpact,
  stage2Candidate,
  category,
  allocationState,
  regimeFit,
  taxAwareConfig,
}) {
  const features = deriveFeatureVector(technicalItem);
  const currentPct =
    allocationState.categories.find((item) => item.category === category)?.currentPct ?? 0;
  const desiredPct = regimeFit.desiredAllocation?.[category] ?? 0;
  const macroGap = desiredPct - currentPct;
  const momentum =
    features.maTrend * 0.36 +
    features.macdZ * 0.28 +
    features.rsiMid * 0.2 +
    features.adxTrend * 0.16;
  const research =
    reportImpact.value * 0.7 +
    stage2ResearchRaw(stage2Candidate) * 0.3;
  const income = estimateIncomeYield(category, taxAwareConfig);
  const macroFit = clamp(macroGap * 8, -2.5, 2.5);

  return {
    values: {
      momentum,
      research,
      income,
      macroFit,
    },
    momentumAvailable: typeof technicalItem?.score === "number",
    researchAvailable: reportImpact.impactCount > 0 || Boolean(stage2Candidate),
  };
}

function computeCrossSectionalFactorScores(positionRows, factorModel) {
  const factorNames = Object.keys(factorModel.weights ?? DEFAULT_FACTOR_MODEL.weights);
  const statsByFactor = {};
  for (const factorName of factorNames) {
    const values = positionRows
      .map((row) => row.factorRaw?.values?.[factorName])
      .filter((value) => typeof value === "number" && Number.isFinite(value));
    const center = mean(values);
    const dispersion = sampleStd(values, center);
    statsByFactor[factorName] = {
      mean: center,
      std: dispersion,
      count: values.length,
    };
  }

  for (const row of positionRows) {
    const zScores = {};
    let weightedZ = 0;
    for (const factorName of factorNames) {
      const rawValue = row.factorRaw?.values?.[factorName];
      const stats = statsByFactor[factorName];
      const z =
        typeof rawValue === "number" &&
        Number.isFinite(rawValue) &&
        stats?.std > 1e-9
          ? (rawValue - stats.mean) / stats.std
          : 0;
      const winsorized = clamp(z, -(factorModel.winsorZ ?? 3.5), factorModel.winsorZ ?? 3.5);
      zScores[factorName] = toRoundedNumber(winsorized, 4);
      weightedZ += winsorized * (factorModel.weights?.[factorName] ?? 0);
    }

    const boundedScore = clamp(50 + weightedZ * (factorModel.scoreScale ?? 14), 0, 100);
    const availability = factorAvailability(row.factorRaw);
    row.factor = {
      raw: Object.fromEntries(
        factorNames.map((factorName) => [
          factorName,
          toRoundedNumber(row.factorRaw?.values?.[factorName] ?? 0, 4),
        ]),
      ),
      zScores,
      weightedZ: toRoundedNumber(weightedZ, 4),
      score: Math.round(boundedScore),
      factorCoverage: availability.factorCoverage,
      availability: availability.availability,
    };
  }

  return {
    factorNames,
    statsByFactor: Object.fromEntries(
      Object.entries(statsByFactor).map(([factorName, stats]) => [
        factorName,
        {
          mean: toRoundedNumber(stats.mean, 4),
          std: toRoundedNumber(stats.std, 4),
          count: stats.count,
        },
      ]),
    ),
  };
}

function normalizeFactorWeights(weights) {
  const safeWeights = Object.fromEntries(
    Object.entries(weights ?? {}).map(([key, value]) => [
      key,
      typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : 0,
    ]),
  );
  const total = Object.values(safeWeights).reduce((sum, value) => sum + value, 0);
  if (total <= 1e-9) return safeWeights;

  return Object.fromEntries(
    Object.entries(safeWeights).map(([key, value]) => [key, toRoundedNumber(value / total, 4)]),
  );
}

async function resolveFeedbackAdjustedFactorModel(strategy) {
  const configuredModel = {
    ...DEFAULT_FACTOR_MODEL,
    ...(strategy?.scoring?.factorModel ?? {}),
    autoAdjust: {
      ...DEFAULT_FACTOR_MODEL.autoAdjust,
      ...(strategy?.scoring?.factorModel?.autoAdjust ?? {}),
    },
    weights: normalizeFactorWeights({
      ...DEFAULT_FACTOR_MODEL.weights,
      ...(strategy?.scoring?.factorModel?.weights ?? {}),
    }),
  };

  if (configuredModel.autoAdjust?.enabled === false) {
    return {
      factorModel: configuredModel,
      autoAdjustMeta: {
        enabled: false,
        applied: false,
        reason: "disabled_in_config",
        baseWeights: configuredModel.weights,
        appliedWeights: configuredModel.weights,
      },
    };
  }

  const sourcePath = path.join(
    ROOT_DIR,
    configuredModel.autoAdjust?.source ?? DEFAULT_FACTOR_MODEL.autoAdjust.source,
  );
  const feedback = await readJson(sourcePath, null);
  const suggestedWeights = feedback?.autoAdjustment?.suggestedWeights ?? null;
  const minSamples = configuredModel.autoAdjust?.minSamples ?? 24;
  const readyFactors = feedback?.autoAdjustment?.readyFactors ?? 0;

  if (!suggestedWeights || readyFactors <= 0) {
    return {
      factorModel: configuredModel,
      autoAdjustMeta: {
        enabled: true,
        applied: false,
        reason: "no_feedback_suggestion",
        baseWeights: configuredModel.weights,
        appliedWeights: configuredModel.weights,
        source: configuredModel.autoAdjust?.source ?? null,
      },
    };
  }

  const eligibleFactors = Object.values(
    feedback?.factorPredictivePower ?? {},
  ).filter(
    (metric) =>
      (metric?.[`ret_${configuredModel.autoAdjust?.primaryHorizonDays ?? 10}d`]?.sampleCount ??
        0) >= minSamples,
  ).length;

  if (eligibleFactors <= 0) {
    return {
      factorModel: configuredModel,
      autoAdjustMeta: {
        enabled: true,
        applied: false,
        reason: "insufficient_samples",
        baseWeights: configuredModel.weights,
        appliedWeights: configuredModel.weights,
        source: configuredModel.autoAdjust?.source ?? null,
        minSamples,
      },
    };
  }

  const appliedWeights = normalizeFactorWeights({
    ...configuredModel.weights,
    ...suggestedWeights,
  });

  return {
    factorModel: {
      ...configuredModel,
      weights: appliedWeights,
    },
    autoAdjustMeta: {
      enabled: true,
      applied: true,
      reason: "feedback_latest",
      source: configuredModel.autoAdjust?.source ?? null,
      analysisDate: feedback?.analysisDate ?? null,
      primaryHorizonDays:
        feedback?.autoAdjustment?.primaryHorizonDays ??
        configuredModel.autoAdjust?.primaryHorizonDays ??
        null,
      minSamples,
      baseWeights: configuredModel.weights,
      appliedWeights,
      suggestedWeights: normalizeFactorWeights(suggestedWeights),
      deltas: feedback?.autoAdjustment?.deltas ?? null,
    },
  };
}

function computeSampleCovarianceMatrix(returnSeries) {
  const sampleCount = Math.min(...returnSeries.map((entry) => entry.returns.length));
  if (!Number.isFinite(sampleCount) || sampleCount <= 1) return null;

  const aligned = returnSeries.map((entry) => ({
    ...entry,
    returns: entry.returns.slice(entry.returns.length - sampleCount),
  }));
  const means = aligned.map((entry) => mean(entry.returns));

  const matrix = aligned.map((left, leftIndex) =>
    aligned.map((right, rightIndex) => {
      let cov = 0;
      for (let index = 0; index < sampleCount; index += 1) {
        cov += (left.returns[index] - means[leftIndex]) * (right.returns[index] - means[rightIndex]);
      }
      return cov / Math.max(sampleCount - 1, 1);
    }),
  );

  return { matrix, sampleCount };
}

function shrinkCovarianceMatrix(sampleCovariance, shrinkage = 0.35, ridge = 0.000001) {
  if (!sampleCovariance) return null;
  const size = sampleCovariance.length;
  const variances = sampleCovariance.map((row, index) => Math.max(row[index], ridge));
  const correlations = [];

  for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
    for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex += 1) {
      const denom = Math.sqrt(variances[rowIndex] * variances[columnIndex]) || 1;
      correlations.push(sampleCovariance[rowIndex][columnIndex] / denom);
    }
  }

  const averageCorrelation = correlations.length > 0 ? mean(correlations) : 0;
  return sampleCovariance.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      const varianceLeft = variances[rowIndex];
      const varianceRight = variances[columnIndex];
      const target =
        rowIndex === columnIndex
          ? varianceLeft + ridge
          : averageCorrelation * Math.sqrt(varianceLeft * varianceRight);
      return (1 - shrinkage) * value + shrinkage * target;
    }),
  );
}

function quadraticForm(weights, matrix) {
  if (!matrix || !weights.length) return 0;
  let total = 0;
  for (let rowIndex = 0; rowIndex < weights.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < weights.length; columnIndex += 1) {
      total += weights[rowIndex] * matrix[rowIndex][columnIndex] * weights[columnIndex];
    }
  }
  return total;
}

function computeTaxAwareAdjustment({
  account,
  positions,
  taxAwareConfig,
  preTaxScore,
  portfolioVolatility,
}) {
  if (!taxAwareConfig?.enabled) {
    return {
      enabled: false,
      preTaxScore,
      afterTaxScore: preTaxScore,
      multiplier: 1,
      expectedYield: null,
      taxSpread: null,
      riskProxy: portfolioVolatility,
      lift: 0,
    };
  }

  const investable = positions.filter((position) => (position.marketValue ?? 0) > 0);
  const totalInvestable = investable.reduce((sum, position) => sum + Math.max(position.marketValue ?? 0, 0), 0) || 1;
  const portfolioYield = investable.reduce((sum, position) => {
    const weight = Math.max(position.marketValue ?? 0, 0) / totalInvestable;
    return sum + (position.incomeYield ?? 0) * weight;
  }, 0);
  const accountTaxRate =
    taxAwareConfig.accountTaxRates?.[account.key] ??
    taxAwareConfig.accountTaxRates?.[account.label] ??
    taxAwareConfig.normalTaxRate ??
    DEFAULT_TAX_AWARE_MODEL.normalTaxRate;
  const normalTaxRate = taxAwareConfig.normalTaxRate ?? DEFAULT_TAX_AWARE_MODEL.normalTaxRate;
  const taxSpread = Math.max(normalTaxRate - accountTaxRate, 0);
  const riskProxy = Math.max(
    valueOrFallback(portfolioVolatility, 0),
    taxAwareConfig.minRiskFloor ?? DEFAULT_TAX_AWARE_MODEL.minRiskFloor,
  );
  const lift =
    taxAwareConfig.alpha *
    ((portfolioYield * taxSpread) / riskProxy);
  const multiplier = clamp(
    1 + lift,
    0.9,
    taxAwareConfig.maxMultiplier ?? DEFAULT_TAX_AWARE_MODEL.maxMultiplier,
  );
  const afterTaxScore = clamp(preTaxScore * multiplier, 0, 100);

  return {
    enabled: true,
    preTaxScore: toRoundedNumber(preTaxScore, 2),
    afterTaxScore: toRoundedNumber(afterTaxScore, 2),
    multiplier: toRoundedNumber(multiplier, 4),
    expectedYield: toRoundedNumber(portfolioYield, 4),
    normalTaxRate: toRoundedNumber(normalTaxRate, 4),
    accountTaxRate: toRoundedNumber(accountTaxRate, 4),
    taxSpread: toRoundedNumber(taxSpread, 4),
    riskProxy: toRoundedNumber(riskProxy, 4),
    lift: toRoundedNumber(lift, 4),
    addedScore: toRoundedNumber(afterTaxScore - preTaxScore, 2),
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  assetRelationConfig =
    (await readJson(path.join(ROOT_DIR, "config", "asset-relations.json"), null)) ?? {
      default: DEFAULT_ASSET_RELATION,
      assets: {},
    };
  const context = await loadAnalysisContext(args, {
    portfolio: true,
    strategy: true,
    technical: true,
    stage1: true,
    stage2: true,
    impactMap: true,
    fred: true,
    stage2Resolved: true,
  });
  const { paths, data } = context;
  const stateDir = paths.analysisDir;
  const portfolio = data.portfolio;
  const strategy = data.strategy;
  const technical = data.technical;
  const stage1 = data.stage1;
  const impactMap = data.impactMap;
  const fred = data.fred;
  const stage2Enriched = await readJson(path.join(stateDir, "stage2-strategy-options.enriched.json"), null);
  const stage2Data = stage2Enriched ?? data.stage2Data;
  if (!stage2Enriched && data.stage2Mode === "missing") {
    throw new Error(`Stage 2 real LLM output missing: ${paths.stage2}`);
  }
  const normalizedPortfolio = enrichPortfolioWithSecurityCodes(portfolio);
  const regime = detectRegime(technical, fred);
  const leadingIndicator = computeLeadingIndicatorScore(fred);
  const technicalMap = technical.scores ?? {};
  const referenceDate = new Date(`${args.date}T00:00:00Z`);
  const profileName = chooseWeightProfile(strategy, regime);
  const { factorModel, autoAdjustMeta } = await resolveFeedbackAdjustedFactorModel(strategy);
  const covarianceModel = {
    ...DEFAULT_COVARIANCE_MODEL,
    ...(strategy?.scoring?.covarianceModel ?? {}),
  };
  const taxAwareConfig = {
    ...DEFAULT_TAX_AWARE_MODEL,
    ...(strategy?.scoring?.taxAware ?? {}),
    defaultYieldByCategory: {
      ...DEFAULT_TAX_AWARE_MODEL.defaultYieldByCategory,
      ...(strategy?.scoring?.taxAware?.defaultYieldByCategory ?? {}),
    },
    accountTaxRates: {
      ...DEFAULT_TAX_AWARE_MODEL.accountTaxRates,
      ...(strategy?.scoring?.taxAware?.accountTaxRates ?? {}),
    },
  };
  const holdingBlendConfig = {
    ...DEFAULT_HOLDING_BLEND_MODEL,
    ...(strategy?.scoring?.holdingBlend ?? {}),
  };
  const stopLossConfig = {
    ...DEFAULT_STOP_LOSS_CONFIG,
    ...(strategy?.stopLoss ?? {}),
  };
  const riskCaps = {
    ...DEFAULT_RISK_CAPS,
    ...(strategy?.scoring?.riskPenaltyCaps ?? {}),
  };
  const stage1ReportCount = stage1.reportCount ?? stage1.extracts?.length ?? 0;
  const stage2CandidateMap = normalizeStage2CandidateMap(stage2Data);

  const holdingScores = {};
  const positionScores = {};
  const accountScores = {};
  const accountCoverage = {};
  const accountContext = {};
  const positionRows = [];

  for (const account of normalizedPortfolio.accounts ?? []) {
    const allocationState = buildAllocationState(account, strategy);
    const allocationScore = allocationScoreForAccount(allocationState);
    const regimeFit = computeRegimeFit(allocationState, regime.name);
    const stage2Action =
      stage2Data?.account_actions?.find(
        (item) =>
          item.account_key === account.key ||
          item.account_key === normalizeStrategyAccountKey(account),
      ) ?? null;
    const stage2Bias = stage2Action?.bias ?? "hold";
    const stage2Score = STAGE2_SCORE_BY_BIAS[stage2Bias] ?? 50;
    const accountDirectImpact = aggregateAccountDirectImpacts({
      impactMap,
      stage1Extracts: stage1.extracts,
      accountKey: account.key,
      referenceDate,
      regimeName: regime.name,
    });
    accountContext[account.key] = {
      account,
      allocationState,
      allocationScore,
      regimeFit,
      stage2Action,
      stage2Bias,
      stage2Score,
      accountDirectImpact,
    };

    for (const holding of account.holdings ?? []) {
      const technicalItem = technicalMap[holding.code] ?? null;
      const category = holdingCategory(account.key, holding.code);
      const reportImpact = aggregateHoldingReportImpacts({
        impactMap,
        stage1Extracts: stage1.extracts,
        targetCode: holding.code,
        accountKey: account.key,
        category,
        referenceDate,
        regimeName: regime.name,
      });
      const computed = computeActionScore(technicalItem, reportImpact, regime.name);
      const rawTechBaseScore = technicalItem?.score ?? null;
      const techBaseScore = adjustedTechnicalScore({
        category,
        rawScore: rawTechBaseScore,
        regimeName: regime.name,
        allocationState,
      });
      const scoreWeight = categoryScoreWeight(category, holding.marketValue ?? 0);
      const stage2Candidate = stage2CandidateMap.get(holding.code) ?? null;
      const factorRaw = computeFactorRawInputs({
        technicalItem,
        reportImpact,
        stage2Candidate,
        category,
        allocationState,
        regimeFit,
        taxAwareConfig,
      });

      positionRows.push({
        positionKey: positionKey(account.key, holding.code),
        code: holding.code,
        name: holding.name,
        accountKey: account.key,
        accountLabel: account.label,
        marketValue: holding.marketValue ?? 0,
        category,
        scoreWeight,
        holding,
        technicalItem,
        technicalBaseScore: techBaseScore,
        rawTechBaseScore,
        reportImpact,
        computed,
        accountDirectImpact,
        factorRaw,
        incomeYield: estimateIncomeYield(category, taxAwareConfig),
      });
    }
  }

  const factorStats = computeCrossSectionalFactorScores(positionRows, factorModel);
  const bestHoldingWeightByCode = new Map();

  for (const row of positionRows) {
    const blendedAction = blendHoldingActionScore({
      rawActionScore: row.computed.actionScore,
      factorScore: row.factor?.score,
      factorCoverage: row.factor?.factorCoverage,
      holdingBlendConfig,
    });
    const stopLossApplied = applyStopLossOverride({
      holding: row.holding,
      technicalItem: row.technicalItem,
      finalAction: blendedAction,
      stopLossConfig,
    });
    row.finalAction = stopLossApplied.finalAction;
    row.stopLoss = stopLossApplied.stopLoss;
  }

  for (const row of positionRows) {
    const holdingReportAvailable = row.reportImpact.impactCount > 0;
    const holdingReportUnavailableReason =
      holdingReportAvailable
        ? null
        : stage1ReportCount <= 0
          ? "no_report_input"
          : "no_linked_report";
    const payload = {
      positionKey: row.positionKey,
      code: row.code,
      name: row.name,
      accountKey: row.accountKey,
      accountLabel: row.accountLabel,
      category: row.category,
      marketValue: row.marketValue,
      incomeYield: toRoundedNumber(row.incomeYield, 4),
      technicalSignal: row.technicalItem?.signal ?? "N/A",
      technicalBaseScore: row.technicalBaseScore,
      ...row.computed,
      actionScore: row.finalAction.score,
      rawActionScore: row.finalAction.rawActionScore,
      signal: row.finalAction.signal,
      rawSignal: row.computed.signal,
      reportImpacts: row.reportImpact.impacts,
      technical: {
        signal: row.technicalItem?.signal ?? null,
        score: row.rawTechBaseScore,
        adjustedScore: row.technicalBaseScore,
        rsi: row.technicalItem?.rsi ?? null,
        macd: row.technicalItem?.macd ?? null,
        bollinger: row.technicalItem?.bollinger ?? null,
        atr: row.technicalItem?.atr ?? null,
        recentHigh: row.technicalItem?.recent_high ?? null,
        volumeRatio: row.technicalItem?.volume_ratio ?? null,
      },
      report: {
        sourceLayer: row.reportImpact.sourceLayer,
        available: holdingReportAvailable,
        unavailableReason: holdingReportUnavailableReason,
        impactScore: holdingReportAvailable ? row.reportImpact.score : null,
        impactValue: toRoundedNumber(row.reportImpact.value),
        impactCount: row.reportImpact.impactCount,
        coverageWeight: row.reportImpact.coverageWeight,
        directAccountImpactScore: row.accountDirectImpact.score,
        relationSummary: row.reportImpact.relationSummary,
      },
      factor: row.factor,
      actionBlend: row.finalAction,
      stopLoss: row.stopLoss,
      scores: {
        factorScore: row.factor.score,
        techScore: row.technicalBaseScore,
        reportScore: holdingReportAvailable ? row.reportImpact.score : null,
        actionScore: row.finalAction.score,
        rawActionScore: row.finalAction.rawActionScore,
      },
      explain: holdingExplanation(
        row.holding,
        row.technicalItem,
        row.reportImpact,
        row.computed,
        row.finalAction,
        row.stopLoss,
      ),
    };
    positionScores[row.positionKey] = payload;

    const bestWeight = bestHoldingWeightByCode.get(row.code) ?? -1;
    if (row.scoreWeight >= bestWeight) {
      holdingScores[row.code] = payload;
      bestHoldingWeightByCode.set(row.code, row.scoreWeight);
    }
  }

  for (const account of normalizedPortfolio.accounts ?? []) {
    const context = accountContext[account.key];
    const accountPositions = positionRows.filter((row) => row.accountKey === account.key);
    const weightedTech = [];
    const weightedFactor = [];
    const weightedReport = [];
    const weightedAction = [];
    const weightedRawAction = [];

    for (const row of accountPositions) {
      if (typeof row.technicalBaseScore === "number") {
        weightedTech.push({ weight: row.scoreWeight, value: row.technicalBaseScore });
      }
      if (typeof row.factor?.score === "number") {
        weightedFactor.push({ weight: row.scoreWeight, value: row.factor.score });
      }
      if (typeof row.reportImpact.score === "number") {
        weightedReport.push({ weight: row.scoreWeight, value: row.reportImpact.score });
      }
      weightedAction.push({ weight: row.scoreWeight, value: row.finalAction.score });
      weightedRawAction.push({ weight: row.scoreWeight, value: row.computed.actionScore });
    }

    const techCoverage =
      (accountPositions.filter((row) => typeof row.rawTechBaseScore === "number").length /
        Math.max(accountPositions.length, 1));
    const factorCoverage =
      mean(accountPositions.map((row) => row.factor?.factorCoverage ?? 0));
    const impactCoverage =
      accountPositions.reduce(
        (sum, row) => sum + (row.reportImpact.coverageWeight ?? 0),
        0,
      ) / Math.max(accountPositions.length, 1);
    const coverage = {
      factorCoverage: toRoundedNumber(factorCoverage, 4),
      techCoverage: toRoundedNumber(techCoverage, 4),
      impactCoverage: toRoundedNumber(impactCoverage, 4),
      stage2Available: Boolean(context.stage2Action),
      fredAvailable: leadingIndicator.available,
    };
    accountCoverage[account.key] = coverage;

    const weights = effectiveWeights(profileName, coverage, regime.confidence);

    const techScoreRaw = weightedAverage(weightedTech);
    const techScore = techScoreRaw != null ? Math.round(techScoreRaw) : null;
    const factorScoreRaw = weightedAverage(weightedFactor);
    const factorScore = factorScoreRaw != null ? Math.round(factorScoreRaw) : null;
    const holdingReportScore = weightedAverage(weightedReport);
    const reportScore = Math.round(
      clamp(
        (holdingReportScore ?? 50) * 0.85 + (context.accountDirectImpact.score ?? 50) * 0.15,
        0,
        100,
      ),
    );
    const reportAvailable = impactCoverage > 0;
    const reportUnavailableReason =
      reportAvailable
        ? null
        : stage1ReportCount <= 0
          ? "no_report_input"
          : "no_mapped_impacts";
    const riskPenalty = computeRiskPenalty({
      account,
      allocationState: context.allocationState,
      coverage,
      regime,
      regimeFit: context.regimeFit,
      riskCaps,
      technicalMap,
      covarianceModel,
    });

    const baseScore = clamp(
      context.allocationScore * weights.allocation +
        (factorScore ?? 50) * (weights.factor ?? 0) +
        (techScore ?? context.allocationScore) * weights.tech +
        reportScore * weights.report +
        context.regimeFit.score * weights.regime +
        context.stage2Score * weights.stage2 +
        leadingIndicator.score * weights.leading,
      0,
      100,
    );
    const preTaxScore = clamp(baseScore - riskPenalty.total, 0, 100);
    const taxAdjustment = computeTaxAwareAdjustment({
      account,
      positions: accountPositions,
      taxAwareConfig,
      preTaxScore,
      portfolioVolatility: riskPenalty.portfolioVolatility,
    });
    const totalScore = Math.round(clamp(taxAdjustment.afterTaxScore ?? preTaxScore, 0, 100));
    const holdingsScore = Math.round(weightedAverage(weightedAction) ?? 50);
    const rawHoldingsScore = Math.round(weightedAverage(weightedRawAction) ?? 50);

    accountScores[account.key] = {
      key: account.key,
      label: account.label,
      allocationScore: context.allocationScore,
      holdingsScore,
      factorScore,
      reportCoverageScore: reportAvailable ? Math.round(impactCoverage * 100) : null,
      reportStatus: reportAvailable ? "available" : "unavailable",
      reportUnavailableReason,
      stage2Bias: context.stage2Bias,
      preTaxScore: toRoundedNumber(preTaxScore, 2),
      baseScore: toRoundedNumber(baseScore, 2),
      totalScore,
      note: accountNote(totalScore, riskPenalty.total),
      coverage,
      baseScores: {
        allocationScore: context.allocationScore,
        factorScore,
        techScore,
        reportScore: reportAvailable ? reportScore : null,
        regimeFit: context.regimeFit.score,
        stage2Score: context.stage2Score,
        leadingScore: leadingIndicator.score,
        actionBlend: holdingsScore,
        rawActionBlend: rawHoldingsScore,
      },
      rawHoldingsScore,
      effectiveWeights: weights,
      riskPenalty,
      taxAdjustment,
      accountDirectImpact: {
        value: toRoundedNumber(context.accountDirectImpact.value),
        score: context.accountDirectImpact.score,
        impacts: context.accountDirectImpact.impacts,
      },
    };
  }

  const totalAssets =
    (normalizedPortfolio.accounts ?? []).reduce(
      (sum, account) => sum + accountTotalAssets(account),
      0,
    ) || 1;

  const portfolioBaseScore = (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
    const assets = accountTotalAssets(account);
    const accountBase =
      (accountScores[account.key]?.baseScores?.allocationScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.allocation ?? 1) +
      ((accountScores[account.key]?.baseScores?.factorScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.factor ?? 0)) +
      ((accountScores[account.key]?.baseScores?.techScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.tech ?? 0)) +
      ((accountScores[account.key]?.baseScores?.reportScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.report ?? 0)) +
      ((accountScores[account.key]?.baseScores?.regimeFit ?? 50) * (accountScores[account.key]?.effectiveWeights?.regime ?? 0)) +
      ((accountScores[account.key]?.baseScores?.stage2Score ?? 50) * (accountScores[account.key]?.effectiveWeights?.stage2 ?? 0)) +
      ((accountScores[account.key]?.baseScores?.leadingScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.leading ?? 0));
    return sum + accountBase * (assets / totalAssets);
  }, 0);

  const portfolioRiskPenaltyTotal = (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
    const assets = accountTotalAssets(account);
    return sum + (accountScores[account.key]?.riskPenalty?.total ?? 0) * (assets / totalAssets);
  }, 0);

  const portfolioPreTaxScore = (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
    const assets = accountTotalAssets(account);
    return sum + (accountScores[account.key]?.preTaxScore ?? 50) * (assets / totalAssets);
  }, 0);

  const portfolioTaxAdded = (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
    const assets = accountTotalAssets(account);
    return sum + (accountScores[account.key]?.taxAdjustment?.addedScore ?? 0) * (assets / totalAssets);
  }, 0);

  const portfolioScore = Math.round(
    clamp(
      (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
        const assets = accountTotalAssets(account);
        return sum + (accountScores[account.key]?.totalScore ?? 50) * (assets / totalAssets);
      }, 0),
      0,
      100,
    ),
  );
  // stage3가 이미 계산한 coverage를 stockpilot에 전달해 임계값 동적 조정에 활용
  const portfolioCoverageSummary = {
    factorCoverage: toRoundedNumber(
      (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
        const assets = accountTotalAssets(account);
        const cov = accountCoverage[account.key]?.factorCoverage ?? 0;
        return sum + cov * assets;
      }, 0) / Math.max(totalAssets, 1),
      4,
    ),
    techCoverage: toRoundedNumber(
      (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
        const acctAssets = accountTotalAssets(account);
        const cov = accountCoverage[account.key]?.techCoverage ?? 0;
        return sum + cov * acctAssets;
      }, 0) / Math.max(totalAssets, 1),
      4,
    ),
  };
  const stockpilotQuant = buildStockPilotQuantPack({
    asOfDate: args.date,
    normalizedPortfolio,
    technical,
    fred,
    stage2Data,
    coverageMeta: portfolioCoverageSummary,
    regimeName: regime?.name ?? null,
  });

  const outputPath = args.output ?? path.join(stateDir, "stage3-quant-scores.json");
  const runMeta = buildRunMetadata(args);
  await writeJson(outputPath, {
    ...runMeta,
    reportInputs: {
      reportCount: stage1ReportCount,
      available: stage1ReportCount > 0,
    },
    regime: {
      ...regime,
      market_context: technical.market_context ?? {},
    },
    leadingIndicator,
    coverage: {
      factorCoverage: toRoundedNumber(
        (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
          const assets = accountTotalAssets(account);
          return sum + (accountCoverage[account.key]?.factorCoverage ?? 0) * (assets / totalAssets);
        }, 0),
        4,
      ),
      techCoverage: toRoundedNumber(
        (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
          const assets = accountTotalAssets(account);
          return sum + (accountCoverage[account.key]?.techCoverage ?? 0) * (assets / totalAssets);
        }, 0),
        4,
      ),
      impactCoverage: toRoundedNumber(
        (normalizedPortfolio.accounts ?? []).reduce((sum, account) => {
          const assets = accountTotalAssets(account);
          return sum + (accountCoverage[account.key]?.impactCoverage ?? 0) * (assets / totalAssets);
        }, 0),
        4,
      ),
      stage2Available: Boolean(stage2Data),
    },
    quality: {
      unrelatedEvidenceRatio: toRoundedNumber(
        mean(
          Object.values(positionScores).map(
            (position) => position?.report?.relationSummary?.unrelatedEvidenceRatio ?? 0,
          ),
        ),
        4,
      ),
      blockedEvidenceCount: Object.values(positionScores).reduce(
        (sum, position) => sum + (position?.report?.relationSummary?.blockedCount ?? 0),
        0,
      ),
    },
    configUsed: {
      weightProfile: profileName,
      maxWeights: MAX_WEIGHT_PROFILES[profileName],
      factorModel: {
        ...factorModel,
        baseWeights: autoAdjustMeta?.baseWeights ?? factorModel.weights,
        appliedWeights: autoAdjustMeta?.appliedWeights ?? factorModel.weights,
        autoAdjust: autoAdjustMeta,
      },
      stopLoss: stopLossConfig,
      holdingBlend: holdingBlendConfig,
      covarianceModel,
      taxAware: {
        enabled: taxAwareConfig.enabled,
        alpha: taxAwareConfig.alpha,
        normalTaxRate: taxAwareConfig.normalTaxRate,
        minRiskFloor: taxAwareConfig.minRiskFloor,
        maxMultiplier: taxAwareConfig.maxMultiplier,
      },
      riskPenaltyCaps: riskCaps,
    },
    factorStats,
    holdings: holdingScores,
    positions: positionScores,
    stockpilotQuant,
    accounts: accountScores,
    portfolio: {
      totalScore: portfolioScore,
      baseScore: toRoundedNumber(portfolioBaseScore, 2),
      preTaxScore: toRoundedNumber(portfolioPreTaxScore, 2),
      riskPenalty: {
        total: toRoundedNumber(portfolioRiskPenaltyTotal, 2),
      },
      taxAdjustment: {
        addedScore: toRoundedNumber(portfolioTaxAdded, 2),
        afterTaxScore: toRoundedNumber(portfolioPreTaxScore + portfolioTaxAdded, 2),
      },
      note:
        portfolioScore >= 72
          ? "포트폴리오 전반이 우호적이지만 과열 추격은 금지"
          : portfolioScore >= 55
            ? "선별적 추가와 방어를 병행해야 하는 구간"
            : "배분 괴리와 리스크 패널티를 먼저 줄여야 하는 구간",
    },
  });
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage3 quant scores 생성 실패: ${error.message}`);
  process.exit(1);
});
