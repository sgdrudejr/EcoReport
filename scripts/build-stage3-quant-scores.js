#!/usr/bin/env node
// 3단계(v2): 배분/기술/리포트/레짐을 coverage-aware 가중치로 합성하고,
// 리스크 패널티를 별도 계산해 종목·계좌·포트폴리오 점수를 산출합니다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  ROOT_DIR,
  clamp,
  parseDateArgs,
  readJson,
  sigmoid,
  softmax,
  writeJson,
} from "./lib/pipeline-utils.js";

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
  // leading: FRED 선행지표 스코어 (T10Y2Y, VIX, CPI, 구리/금 비율)
  // report 가중치를 0.05 줄여 leading에 할당
  balanced:     { allocation: 0.45, tech: 0.30, report: 0.10, regime: 0.05, stage2: 0.05, leading: 0.05 },
  dataSparse:   { allocation: 0.70, tech: 0.15, report: 0.05, regime: 0.10, stage2: 0.00, leading: 0.00 },
  reportHeavy:  { allocation: 0.35, tech: 0.25, report: 0.25, regime: 0.05, stage2: 0.05, leading: 0.05 },
  tactical:     { allocation: 0.25, tech: 0.50, report: 0.10, regime: 0.05, stage2: 0.05, leading: 0.05 },
  riskOff:      { allocation: 0.45, tech: 0.20, report: 0.05, regime: 0.15, stage2: 0.10, leading: 0.05 },
};

const DEFAULT_RISK_CAPS = {
  concentration: 10,
  tailRisk: 15,
  dataQuality: 10,
  regimeStress: 10,
  total: 25,
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
  strategy: 0.34,
  macro: 0.22,
};

const IMPACT_HALF_LIFE_BY_HORIZON = {
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
};

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
      ? 68
      : regimeName === "BEAR"
        ? 62
        : excessCashPct > 0.2
          ? 28
          : excessCashPct > 0.08
            ? 38
            : Math.abs(excessCashPct) <= 0.05
              ? 57
              : 48;

  return Math.round(clamp(rawScore * 0.15 + policyBase * 0.85, 0, 100));
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

function codeThemeKeywords(code, category) {
  if (code === "487240" || category === "전력기기") return ["전력", "변압", "전력기기", "인프라", "데이터센터"];
  if (code === "449450" || category === "방산") return ["방산", "국방", "무기", "군수"];
  if (code === "434730" || category === "원자력") return ["원자력", "원전", "SMR", "핵"];
  if (code === "132030" || category === "금") return ["금", "gold", "안전자산"];
  if (code === "458760" || category === "배당/커버드콜") return ["배당", "커버드콜", "다우", "프리미엄"];
  if (code === "360750" || category === "S&P500" || category === "미국인덱스") return ["s&p500", "sp500", "미국", "대형주", "지수"];
  if (code === "133690" || category === "나스닥100") return ["나스닥", "nasdaq", "기술주"];
  if (code === "423160" || category === "현금파킹") return ["KOFR", "단기금리", "현금", "파킹"];
  return [];
}

function themeMatchesHolding(code, category, value) {
  const keywords = codeThemeKeywords(code, category);
  if (keywords.length === 0 || typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
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

function impactContribution(impact, referenceDate) {
  const sign = directionSign(impact.direction);
  const strength = clamp(valueOrFallback(impact.strength, 0.3), 0, 1);
  const confidence = normalizeConfidence(impact.confidence);
  const horizonWeight = {
    "1w": 0.8,
    "1m": 1,
    "3m": 1.15,
    "6m": 1.25,
  }[impact.horizon] ?? 1;
  const typeWeight = {
    holding: 1,
    category: 0.75,
    theme: 0.65,
    account: 0.35,
    portfolio: 0.2,
  }[impact.targetType] ?? 0.4;
  const reportTypeWeight = REPORT_TYPE_WEIGHTS[impact.reportType] ?? 0.45;
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

function aggregateHoldingReportImpacts({ impactMap, stage1Extracts, targetCode, accountKey, category, referenceDate }) {
  const confirmed = normalizeImpactMapEntries(impactMap, targetCode, accountKey, category).filter(
    (item) => item.targetType !== "account" && item.targetType !== "portfolio",
  );
  const fallback = normalizeStage1Entries(stage1Extracts, targetCode, accountKey, category, false);
  const rawImpacts = (confirmed.length > 0 ? confirmed : fallback)
    .map((impact) => ({
      ...impact,
      contribution: impactContribution(impact, referenceDate),
    }))
    .filter((impact) => Math.abs(impact.contribution) >= 0.025)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));

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
  };
}

function aggregateAccountDirectImpacts({ impactMap, stage1Extracts, accountKey, referenceDate }) {
  const confirmed = normalizeImpactMapEntries(impactMap, null, accountKey, null).filter(
    (item) => item.targetType === "account" || item.targetType === "portfolio",
  );
  const fallback = normalizeStage1Entries(stage1Extracts, null, accountKey, null, true).filter(
    (item) => item.targetType === "account",
  );
  const rawImpacts = (confirmed.length > 0 ? confirmed : fallback)
    .map((impact) => ({
      ...impact,
      contribution: impactContribution(impact, referenceDate),
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
  const signal = actionScore >= 72 ? "BUY" : actionScore >= 58 ? "HOLD" : actionScore >= 42 ? "WATCH" : "REDUCE";

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

function normalizeStrategyAccountKey(account) {
  if (account.key === "ISA") return "ISA";
  if (account.key === "PENSION") return "연금저축";
  if (account.key === "TOSS") return "토스증권";
  return null;
}

function buildAllocationState(account, strategy) {
  const strategyKey = normalizeStrategyAccountKey(account);
  const targetAllocation = strategy?.accounts?.[strategyKey]?.target_allocation ?? {};
  const holdingsValue = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const totalAssets = Math.max(account.evaluationAmount ?? 0, holdingsValue + (account.cashAvailable ?? 0));
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
  const diff = allocationState.categories.reduce(
    (sum, category) => sum + Math.abs(category.currentPct - category.targetPct),
    0,
  );
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
  const categoryNames = new Set([
    ...allocationState.categories.map((item) => item.category),
    ...Object.keys(desired),
  ]);
  const diff = [...categoryNames].reduce((sum, category) => {
    const currentPct =
      allocationState.categories.find((item) => item.category === category)?.currentPct ?? 0;
    const desiredPct = desired[category] ?? 0;
    return sum + Math.abs(currentPct - desiredPct);
  }, 0);

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
    tech: maxWeights.tech * coverage.techCoverage,
    report: maxWeights.report * coverage.impactCoverage,
    regime: maxWeights.regime * regimeConfidence,
    stage2: maxWeights.stage2 * (coverage.stage2Available ? 1 : 0),
    leading: (maxWeights.leading ?? 0) * (coverage.fredAvailable ? 1 : 0),
  };
  const used = weights.tech + weights.report + weights.regime + weights.stage2 + weights.leading;
  return {
    allocation: toRoundedNumber(Math.max(0, 1 - used), 4),
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
      dataQualityTotal + concentrationTotal + tailRiskTotal + regimeStressTotal,
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
  if (tailRiskTotal > 0) {
    notes.push(`최대낙폭 ${maxDrawdown}% / CVaR(95%) ${cvar95}% 수준으로 꼬리 리스크 패널티가 적용됐습니다.`);
  }

  return {
    total,
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

function holdingExplanation(holding, technicalItem, reportImpact, action) {
  const topDrivers = [];
  const warnings = [];

  if (technicalItem?.score != null) {
    topDrivers.push(`기술 기본점수 ${technicalItem.score}점`);
  } else {
    warnings.push("기술 스냅샷이 없어 리포트/배분 쪽 해석 비중이 커졌습니다.");
  }

  if (reportImpact.impactCount > 0) {
    topDrivers.push(`리포트 영향 ${reportImpact.score}점 (${reportImpact.impactCount}건 연결)`);
  } else {
    warnings.push("직접 연결된 리포트 영향이 아직 없습니다.");
  }

  if (typeof technicalItem?.rsi === "number") {
    topDrivers.push(`RSI ${technicalItem.rsi.toFixed(1)}`);
  }

  if (action.signal === "REDUCE" || action.signal === "WATCH") {
    warnings.push(`${action.signal} 구간이라 비중 확대보다 관찰/점검이 우선입니다.`);
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

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const [portfolio, strategy, technical, stage1, stage2, impactMap, fred] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(ROOT_DIR, "config", "strategy.json"), { accounts: {} }),
    readJson(path.join(ROOT_DIR, "data", "technical", `${args.date}.json`), { scores: {}, market_context: {} }),
    readJson(path.join(stateDir, "stage1-report-extracts-v2.json"), { extracts: [] }),
    readJson(path.join(stateDir, "stage2-strategy-options.json"), null),
    readJson(path.join(stateDir, "impact-map.json"), null),
    readJson(path.join(ROOT_DIR, "data", "macro", `fred-${args.date}.json`), null),
  ]);

  const stage2Data =
    stage2 ??
    (await readJson(path.join(stateDir, "stage2-strategy-options.mock.json"), {
      account_actions: [],
      candidate_scores: [],
    }));
  const regime = detectRegime(technical, fred);
  const leadingIndicator = computeLeadingIndicatorScore(fred);
  const technicalMap = technical.scores ?? {};
  const referenceDate = new Date(`${args.date}T00:00:00Z`);
  const profileName = chooseWeightProfile(strategy, regime);
  const riskCaps = strategy?.scoring?.riskPenaltyCaps ?? DEFAULT_RISK_CAPS;

  const holdingScores = {};
  const accountScores = {};
  const accountCoverage = {};

  for (const account of portfolio.accounts ?? []) {
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
    });

    const weightedTech = [];
    const weightedReport = [];
    const weightedAction = [];

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
      const explanation = holdingExplanation(holding, technicalItem, reportImpact, computed);
      const holdingKey = holding.code;

      holdingScores[holdingKey] = {
        code: holding.code,
        name: holding.name,
        accountKey: account.key,
        accountLabel: account.label,
        category,
        marketValue: holding.marketValue ?? 0,
        technicalSignal: technicalItem?.signal ?? "N/A",
        technicalBaseScore: techBaseScore,
        ...computed,
        reportImpacts: reportImpact.impacts,
        technical: {
          signal: technicalItem?.signal ?? null,
          score: rawTechBaseScore,
          adjustedScore: techBaseScore,
          rsi: technicalItem?.rsi ?? null,
          macd: technicalItem?.macd ?? null,
          bollinger: technicalItem?.bollinger ?? null,
          volumeRatio: technicalItem?.volume_ratio ?? null,
        },
        report: {
          sourceLayer: reportImpact.sourceLayer,
          impactScore: reportImpact.score,
          impactValue: toRoundedNumber(reportImpact.value),
          impactCount: reportImpact.impactCount,
          coverageWeight: reportImpact.coverageWeight,
          directAccountImpactScore: accountDirectImpact.score,
        },
        scores: {
          techScore: techBaseScore,
          reportScore: reportImpact.score,
          actionScore: computed.actionScore,
        },
        explain: explanation,
      };

      const weight = Math.max(holding.marketValue ?? 0, 0);
      if (typeof techBaseScore === "number") weightedTech.push({ weight: scoreWeight, value: techBaseScore });
      if (typeof reportImpact.score === "number") weightedReport.push({ weight: scoreWeight, value: reportImpact.score });
      weightedAction.push({ weight: scoreWeight, value: computed.actionScore });
    }

    const techCoverage =
      (account.holdings ?? []).filter((holding) => typeof technicalMap[holding.code]?.score === "number").length /
      Math.max((account.holdings ?? []).length, 1);
    const impactCoverage =
      (account.holdings ?? []).reduce(
        (sum, holding) => sum + (holdingScores[holding.code]?.report?.coverageWeight ?? 0),
        0,
      ) / Math.max((account.holdings ?? []).length, 1);
    const coverage = {
      techCoverage: toRoundedNumber(techCoverage, 4),
      impactCoverage: toRoundedNumber(impactCoverage, 4),
      stage2Available: Boolean(stage2Action),
      fredAvailable: leadingIndicator.available,
    };
    accountCoverage[account.key] = coverage;

    const weights = effectiveWeights(profileName, coverage, regime.confidence);

    const techScoreRaw = weightedAverage(weightedTech);
    const techScore = techScoreRaw != null ? Math.round(techScoreRaw) : null;
    const holdingReportScore = weightedAverage(weightedReport);
    const reportScore = Math.round(
      clamp(
        (holdingReportScore ?? 50) * 0.85 + (accountDirectImpact.score ?? 50) * 0.15,
        0,
        100,
      ),
    );
    const riskPenalty = computeRiskPenalty({
      account,
      allocationState,
      coverage,
      regime,
      regimeFit,
      riskCaps,
      technicalMap,
    });

    const baseScore = clamp(
      allocationScore * weights.allocation +
        (techScore ?? allocationScore) * weights.tech +
        reportScore * weights.report +
        regimeFit.score * weights.regime +
        stage2Score * weights.stage2 +
        leadingIndicator.score * weights.leading,
      0,
      100,
    );
    const totalScore = Math.round(clamp(baseScore - riskPenalty.total, 0, 100));
    const holdingsScore = Math.round(weightedAverage(weightedAction) ?? 50);

    accountScores[account.key] = {
      key: account.key,
      label: account.label,
      allocationScore,
      holdingsScore: techScore ?? null,
      reportCoverageScore: Math.round(impactCoverage * 100),
      stage2Bias,
      totalScore,
      note: accountNote(totalScore, riskPenalty.total),
      coverage,
      baseScores: {
        allocationScore,
        techScore,
        reportScore,
        regimeFit: regimeFit.score,
        stage2Score,
        leadingScore: leadingIndicator.score,
        actionBlend: holdingsScore,
      },
      effectiveWeights: weights,
      riskPenalty,
      accountDirectImpact: {
        value: toRoundedNumber(accountDirectImpact.value),
        score: accountDirectImpact.score,
        impacts: accountDirectImpact.impacts,
      },
    };
  }

  const totalAssets =
    (portfolio.accounts ?? []).reduce(
      (sum, account) => sum + Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0),
      0,
    ) || 1;

  const portfolioBaseScore = (portfolio.accounts ?? []).reduce((sum, account) => {
    const assets = Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0);
    const accountBase =
      (accountScores[account.key]?.baseScores?.allocationScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.allocation ?? 1) +
      ((accountScores[account.key]?.baseScores?.techScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.tech ?? 0)) +
      ((accountScores[account.key]?.baseScores?.reportScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.report ?? 0)) +
      ((accountScores[account.key]?.baseScores?.regimeFit ?? 50) * (accountScores[account.key]?.effectiveWeights?.regime ?? 0)) +
      ((accountScores[account.key]?.baseScores?.stage2Score ?? 50) * (accountScores[account.key]?.effectiveWeights?.stage2 ?? 0)) +
      ((accountScores[account.key]?.baseScores?.leadingScore ?? 50) * (accountScores[account.key]?.effectiveWeights?.leading ?? 0));
    return sum + accountBase * (assets / totalAssets);
  }, 0);

  const portfolioRiskPenaltyTotal = (portfolio.accounts ?? []).reduce((sum, account) => {
    const assets = Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0);
    return sum + (accountScores[account.key]?.riskPenalty?.total ?? 0) * (assets / totalAssets);
  }, 0);

  const portfolioScore = Math.round(
    clamp(
      (portfolio.accounts ?? []).reduce((sum, account) => {
        const assets = Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0);
        return sum + (accountScores[account.key]?.totalScore ?? 50) * (assets / totalAssets);
      }, 0),
      0,
      100,
    ),
  );

  const outputPath = args.output ?? path.join(stateDir, "stage3-quant-scores.json");
  await writeJson(outputPath, {
    date: args.date,
    generatedAt: new Date().toISOString(),
    regime: {
      ...regime,
      market_context: technical.market_context ?? {},
    },
    leadingIndicator,
    coverage: {
      techCoverage: toRoundedNumber(
        (portfolio.accounts ?? []).reduce((sum, account) => {
          const assets = Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0);
          return sum + (accountCoverage[account.key]?.techCoverage ?? 0) * (assets / totalAssets);
        }, 0),
        4,
      ),
      impactCoverage: toRoundedNumber(
        (portfolio.accounts ?? []).reduce((sum, account) => {
          const assets = Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0);
          return sum + (accountCoverage[account.key]?.impactCoverage ?? 0) * (assets / totalAssets);
        }, 0),
        4,
      ),
      stage2Available: Boolean(stage2Data),
    },
    configUsed: {
      weightProfile: profileName,
      maxWeights: MAX_WEIGHT_PROFILES[profileName],
      riskPenaltyCaps: riskCaps,
    },
    holdings: holdingScores,
    accounts: accountScores,
    portfolio: {
      totalScore: portfolioScore,
      baseScore: toRoundedNumber(portfolioBaseScore, 2),
      riskPenalty: {
        total: toRoundedNumber(portfolioRiskPenaltyTotal, 2),
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
