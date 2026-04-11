#!/usr/bin/env node
// 4단계: Stage 1~3 데이터를 모두 활용해 계좌별 실행 계획을 생성합니다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  PREFERRED_LABEL_BY_CATEGORY,
  ROOT_DIR,
  buildRunMetadata,
  enrichPortfolioWithSecurityCodes,
  parseDateArgs,
  readJson,
  resolveSecurityCodeFromCandidates,
  won,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { loadAnalysisContext } from "./lib/analysis-context.js";

const DEFAULT_POSITION_SIZING = {
  method: "inverse_atr",
  maxSinglePosition_pct: 0.3,
  correlationThreshold: 0.85,
  correlationHaircut: 0.5,
  minAtrPct: 0.01,
  fallbackMethod: "ranked",
};

const DEFAULT_ENTRY_CONDITIONS = {
  aggressiveBuyMinScore: 68,
  watchMinScore: 50,
  oversoldRsi: 30,
  overheatRsi: 50,
  emergencyDefenseVix: 35,
  emergencyDefenseDailyDropPct: -0.03,
  fallbackUrgency: "next_tranche",
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value, digits = 4) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function safeCategory(accountKey, code) {
  return (
    CATEGORY_BY_CODE[code]?.[accountKey] ??
    CATEGORY_BY_CODE[code]?.default ??
    "기타"
  );
}

function holdingEntryPrice(holding) {
  if (typeof holding?.avgPrice === "number" && Number.isFinite(holding.avgPrice)) {
    return holding.avgPrice;
  }
  if (
    typeof holding?.purchaseValue === "number" &&
    typeof holding?.quantity === "number" &&
    holding.quantity > 0
  ) {
    return holding.purchaseValue / holding.quantity;
  }
  return null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values, center = mean(values) ?? 0) {
  if (values.length <= 1) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    Math.max(values.length - 1, 1);
  return Math.sqrt(Math.max(variance, 0));
}

function pairwiseCorrelation(leftSeries, rightSeries) {
  const minLength = Math.min(leftSeries?.length ?? 0, rightSeries?.length ?? 0);
  if (minLength < 10) return null;
  const left = leftSeries.slice(-minLength);
  const right = rightSeries.slice(-minLength);
  const meanLeft = mean(left);
  const meanRight = mean(right);
  if (meanLeft == null || meanRight == null) return null;
  const stdLeft = sampleStd(left, meanLeft);
  const stdRight = sampleStd(right, meanRight);
  if (stdLeft <= 1e-9 || stdRight <= 1e-9) return null;

  let covariance = 0;
  for (let index = 0; index < minLength; index += 1) {
    covariance += (left[index] - meanLeft) * (right[index] - meanRight);
  }
  return covariance / ((minLength - 1) * stdLeft * stdRight);
}

function detectEmergencyDefense({ quant, market, entryConfig }) {
  const vix =
    market?.macro?.VIX?.close ??
    quant?.regime?.market_context?.vix ??
    null;
  const marketDrops = Object.values(market?.indices ?? {})
    .map((item) => item?.change_pct)
    .filter((value) => typeof value === "number");
  const worstIndexDrop = marketDrops.length ? Math.min(...marketDrops) : null;
  const triggers = [];

  if (
    typeof vix === "number" &&
    vix >=
      (entryConfig.emergencyDefenseVix ??
        DEFAULT_ENTRY_CONDITIONS.emergencyDefenseVix)
  ) {
    triggers.push(`VIX ${roundNumber(vix, 2)} >= ${entryConfig.emergencyDefenseVix}`);
  }
  if (
    typeof worstIndexDrop === "number" &&
    worstIndexDrop <=
      (entryConfig.emergencyDefenseDailyDropPct ??
        DEFAULT_ENTRY_CONDITIONS.emergencyDefenseDailyDropPct)
  ) {
    triggers.push(
      `시장 낙폭 ${roundNumber(worstIndexDrop * 100, 2)}% <= ${roundNumber(
        (entryConfig.emergencyDefenseDailyDropPct ?? -0.03) * 100,
        2,
      )}%`,
    );
  }

  return {
    enabled: triggers.length > 0,
    vix: roundNumber(vix, 2),
    worstIndexDropPct: roundNumber(
      typeof worstIndexDrop === "number" ? worstIndexDrop * 100 : null,
      2,
    ),
    triggers,
    marketDataAvailable:
      typeof vix === "number" || typeof worstIndexDrop === "number",
  };
}

function classifyEntryCondition({ score, technicalItem, emergencyDefense, entryConfig }) {
  if (emergencyDefense?.enabled) {
    return {
      entryCondition: "emergency_defense",
      urgency: "on_hold",
      conditionMet: false,
      entryTriggers: emergencyDefense.triggers,
      fallback: false,
    };
  }

  const rsi = technicalItem?.rsi ?? null;
  const bollingerPosition = technicalItem?.bollinger?.position ?? null;
  const triggers = [];
  const scoreAvailable = typeof score === "number" && Number.isFinite(score);
  const strongScore =
    scoreAvailable &&
    score >=
      (entryConfig.aggressiveBuyMinScore ??
        DEFAULT_ENTRY_CONDITIONS.aggressiveBuyMinScore);
  const watchScore =
    scoreAvailable &&
    score >= (entryConfig.watchMinScore ?? DEFAULT_ENTRY_CONDITIONS.watchMinScore);
  const oversold =
    typeof rsi === "number" &&
    rsi < (entryConfig.oversoldRsi ?? DEFAULT_ENTRY_CONDITIONS.oversoldRsi) &&
    bollingerPosition === "below_lower";
  const overheated =
    (typeof rsi === "number" &&
      rsi > (entryConfig.overheatRsi ?? DEFAULT_ENTRY_CONDITIONS.overheatRsi)) ||
    bollingerPosition === "above_upper";

  if (typeof rsi === "number") {
    triggers.push(`RSI ${roundNumber(rsi, 1)}`);
  }
  if (bollingerPosition) {
    triggers.push(`볼린저 ${bollingerPosition}`);
  }

  if (strongScore && oversold) {
    return {
      entryCondition: "aggressive",
      urgency: "immediate",
      conditionMet: true,
      entryTriggers: triggers,
      fallback: false,
    };
  }

  if (strongScore) {
    return {
      entryCondition: overheated ? "dca_keep" : "qualified",
      urgency: "next_tranche",
      conditionMet: !overheated,
      entryTriggers: triggers,
      fallback: false,
    };
  }

  if (watchScore) {
    return {
      entryCondition: "watch",
      urgency: "this_week",
      conditionMet: false,
      entryTriggers: triggers,
      fallback: false,
    };
  }

  return {
    entryCondition: "technical_fallback",
    urgency: entryConfig.fallbackUrgency ?? DEFAULT_ENTRY_CONDITIONS.fallbackUrgency,
    conditionMet: false,
    entryTriggers:
      triggers.length > 0 ? triggers : ["기술 조건 또는 점수가 충분하지 않음"],
    fallback: true,
  };
}

function normalizeStrategyAccountKey(account, strategy) {
  const candidates = [
    account.key,
    account.label,
    account.key === "PENSION" ? "연금저축" : null,
    account.key === "TOSS" ? "토스증권" : null,
    account.key === "ISA" ? "ISA" : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (strategy?.accounts?.[candidate]) {
      return candidate;
    }
  }
  return null;
}

function buildCategoryGaps(account, strategy) {
  const strategyKey = normalizeStrategyAccountKey(account, strategy);
  const targetAllocation = strategy?.accounts?.[strategyKey]?.target_allocation ?? {};
  const holdingsValue = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const totalAssets = Math.max(account.evaluationAmount ?? 0, holdingsValue + (account.cashAvailable ?? 0));
  const amounts = new Map();
  for (const holding of account.holdings ?? []) {
    const category = safeCategory(account.key, holding.code);
    amounts.set(category, (amounts.get(category) ?? 0) + (holding.marketValue ?? 0));
  }
  if (targetAllocation["현금파킹"] != null) {
    amounts.set("현금파킹", account.cashAvailable ?? 0);
  }
  return Object.entries(targetAllocation)
    .map(([category, pct]) => {
      const current = amounts.get(category) ?? 0;
      return {
        category,
        targetPct: pct,
        currentPct: totalAssets > 0 ? current / totalAssets : 0,
        gapAmount: Math.round(totalAssets * pct - current),
      };
    })
    .sort((left, right) => right.gapAmount - left.gapAmount);
}

function executionBuckets(account, quant, stage2Action, strategy, technicalMap) {
  const gaps = buildCategoryGaps(account, strategy);
  const nextTranchePct =
    strategy?.dca_plan?.schedule?.find((item) => item.status !== "done" && item.status !== "completed")?.pct ?? 0.25;
  const deployBudget = Math.round(
    Math.max(0, Math.min(account.cashAvailable ?? 0, (Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0)) * nextTranchePct)),
  );
  const buy = [];
  const trim = [];
  const hold = [];
  const watch = [];

  for (const holding of account.holdings ?? []) {
    const quantHolding =
      quant.positions?.[`${account.key}:${holding.code}`] ??
      quant.holdings?.[holding.code] ??
      null;
    const technicalItem = technicalMap?.[holding.code] ?? null;
    const score = quantHolding?.actionScore ?? 50;
    const entry = {
      code: holding.code,
      name: holding.name,
      score,
      accountKey: account.key,
      currentPrice: holding.currentPrice ?? technicalItem?.close ?? null,
      entryPrice: holdingEntryPrice(holding),
      atrPct: technicalItem?.atr?.pct ?? null,
      rsi: technicalItem?.rsi ?? null,
      bollingerPosition: technicalItem?.bollinger?.position ?? null,
      stopLoss: quantHolding?.stopLoss ?? null,
      reason: quantHolding?.reportImpacts?.[0]?.reason ?? quantHolding?.technicalSignal ?? "점수 기반 분류",
    };
    if (score >= 68) buy.push(entry);
    else if (score <= 38) trim.push(entry);
    else if (score >= 50) hold.push(entry);
    else watch.push(entry);
  }

  const topGap = gaps.find((item) => item.category !== "현금파킹" && item.gapAmount > 0);
  const candidateFromGap = topGap ? PREFERRED_LABEL_BY_CATEGORY[topGap.category] : null;

  return {
    deployBudget,
    reserveCash: Math.max((account.cashAvailable ?? 0) - deployBudget, 0),
    stage2Bias: stage2Action?.bias ?? "hold",
    topGap,
    gapSummary: gaps.slice(0, 4),
    buy,
    trim,
    hold,
    watch,
    candidateFromGap,
    totalAssets: Math.max(
      account.evaluationAmount ?? 0,
      (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0) +
        (account.cashAvailable ?? 0),
    ),
  };
}

function normalizeCandidateConfidence(value) {
  if (typeof value === "number") return Math.max(0, Math.min(value, 1));
  if (value === "HIGH") return 0.85;
  if (value === "MEDIUM") return 0.6;
  if (value === "LOW") return 0.35;
  return 0.5;
}

function isBuyableStance(value) {
  return ["buy", "accumulate", "add"].includes(String(value ?? "").toLowerCase());
}

function hasNegativeActionLanguage(text) {
  return /비중을 조절|비중 조정|축소|trim|reduce|보류|추격 매수는 신중|추가 진입은 보류/i.test(String(text ?? ""));
}

function resolveStage2Candidates(account, stage2Data, bucket) {
  const allCandidates = (stage2Data?.candidate_scores ?? []).map((item) => ({
    ...item,
    resolvedCode: resolveSecurityCodeFromCandidates(item.code, item.name),
  }));
  const accountKeyHints = new Set([account.key, account.label]);
  const buyCodes = new Set(bucket.stage2Bias ? (stage2Data?.account_actions ?? [])
    .find((item) => item.account_key === account.key || item.account_key === account.label)?.buy_candidates ?? [] : []);
  const desiredCategory = bucket.topGap?.category ?? null;

  const matched = allCandidates.filter((item) => {
    const targets = item.target_accounts ?? [];
    const matchesAccount = targets.some((target) => accountKeyHints.has(target));
    const itemCode = item.resolvedCode ?? item.code;
    const itemCategory =
      CATEGORY_BY_CODE[itemCode]?.[account.key] ??
      CATEGORY_BY_CODE[itemCode]?.default ??
      null;
    const matchesCategory = desiredCategory != null && itemCategory === desiredCategory;
    const alreadyHeld = (account.holdings ?? []).some((holding) => holding.code === itemCode);
    const matchesGapLabel =
      bucket.candidateFromGap &&
      (item.name === bucket.candidateFromGap ||
        itemCode === bucket.candidateFromGap ||
        (item.thesis ?? "").includes(bucket.candidateFromGap));
    const matchesBuyCode = buyCodes.has(itemCode);
    return matchesCategory || matchesGapLabel || (matchesAccount && (alreadyHeld || itemCategory !== "기타")) || matchesBuyCode;
  });

  const sorted = matched
    .map((item) => {
      const itemCode = item.resolvedCode ?? item.code;
      const itemCategory =
        CATEGORY_BY_CODE[itemCode]?.[account.key] ??
        CATEGORY_BY_CODE[itemCode]?.default ??
        null;
      const categoryBonus = desiredCategory != null && itemCategory === desiredCategory ? 4 : 0;
      const gapBonus = bucket.candidateFromGap && item.name === bucket.candidateFromGap ? 3 : 0;
      const buyCodeBonus = buyCodes.has(itemCode) ? 2 : 0;
      const holdBonus = (account.holdings ?? []).some((holding) => holding.code === itemCode) ? 1 : 0;
      return {
        ...item,
        __rank: categoryBonus + gapBonus + buyCodeBonus + holdBonus,
      };
    })
    .sort((left, right) => right.__rank - left.__rank);

  const accepted = [];
  const rejected = [];

  for (const item of sorted.slice(0, 5)) {
    const stance = String(item.stance ?? "hold").toLowerCase();
    const candidate = {
      code: item.resolvedCode ?? item.code,
      name: item.name,
      score: null,
      reason: item.thesis ?? "Stage 2 후보 논리",
      source: "stage2",
      stance,
      confidence: normalizeCandidateConfidence(item.confidence),
      targetAccounts: item.target_accounts ?? [],
    };

    if (!isBuyableStance(stance)) {
      rejected.push({
        ...candidate,
        rejectionReason: `Stage 2 stance가 ${stance}라 신규 매수 후보에서 제외`,
      });
      continue;
    }

    if (hasNegativeActionLanguage(candidate.reason)) {
      rejected.push({
        ...candidate,
        rejectionReason: "후보 설명에 비중 축소/보류 신호가 있어 실행 후보에서 제외",
      });
      continue;
    }

    accepted.push(candidate);
  }

  return {
    accepted: accepted.slice(0, 3),
    rejected,
  };
}

function maxCorrelationToPortfolio(code, account, technicalMap) {
  const candidateReturns = technicalMap?.[code]?.daily_returns ?? [];
  if (candidateReturns.length < 10) return null;

  const correlations = (account.holdings ?? [])
    .filter((holding) => holding.code && holding.code !== code)
    .map((holding) =>
      pairwiseCorrelation(candidateReturns, technicalMap?.[holding.code]?.daily_returns ?? []),
    )
    .filter((value) => typeof value === "number");

  if (!correlations.length) return null;
  return correlations.reduce(
    (max, value) => (Math.abs(value) > Math.abs(max) ? value : max),
    correlations[0],
  );
}

function buildCandidateProfile(item, account, quant, technicalMap, entryConfig, emergencyDefense) {
  const quantHolding =
    quant.positions?.[`${account.key}:${item.code}`] ??
    quant.holdings?.[item.code] ??
    null;
  const technicalItem = item.code ? technicalMap?.[item.code] ?? null : null;
  const condition = classifyEntryCondition({
    score: item.score ?? quantHolding?.actionScore ?? null,
    technicalItem,
    emergencyDefense,
    entryConfig,
  });

  return {
    ...item,
    score: item.score ?? quantHolding?.actionScore ?? null,
    technical: {
      rsi: technicalItem?.rsi ?? null,
      bollingerPosition: technicalItem?.bollinger?.position ?? null,
      atrPct: technicalItem?.atr?.pct ?? null,
      dayChangePct: technicalItem?.change_pct ?? null,
      fallback: technicalItem?.fallback ?? null,
    },
    currentPrice: technicalItem?.close ?? null,
    maxCorrelationToPortfolio: item.code
      ? roundNumber(maxCorrelationToPortfolio(item.code, account, technicalMap), 4)
      : null,
    entryCondition: condition.entryCondition,
    entryTriggers: condition.entryTriggers,
    urgency: condition.urgency,
    conditionMet: condition.conditionMet,
    fallback: condition.fallback,
  };
}

function computeSizingWeights(candidates, positionSizing) {
  if (!candidates.length) return [];
  if (
    positionSizing.method === "inverse_atr" &&
    candidates.every(
      (item) =>
        typeof item.technical?.atrPct === "number" &&
        item.technical.atrPct > 0,
    )
  ) {
    const atrFloor = positionSizing.minAtrPct ?? DEFAULT_POSITION_SIZING.minAtrPct;
    const rawWeights = candidates.map((item) => 1 / Math.max(item.technical.atrPct, atrFloor));
    const total = rawWeights.reduce((sum, value) => sum + value, 0) || 1;
    return rawWeights.map((value) => value / total);
  }

  if (positionSizing.fallbackMethod === "equal") {
    return candidates.map(() => 1 / candidates.length);
  }

  return candidates.length === 1
    ? [1]
    : candidates.length === 2
      ? [0.6, 0.4]
      : [0.5, 0.3, 0.2].slice(0, candidates.length);
}

function distributeBudget({
  bucket,
  account,
  quant,
  technicalMap,
  stage2Candidates = [],
  positionSizing,
  entryConfig,
  emergencyDefense,
}) {
  const fallbackCandidates =
    bucket.candidateFromGap != null
      ? [
          {
            code: bucket.topGap?.code ?? null,
            name: bucket.candidateFromGap,
            score: null,
            reason: `${bucket.topGap?.category ?? "부족 자산군"} 목표 배분을 메우기 위한 보강`,
            source: "gap",
          },
          ...bucket.buy.slice(0, 2),
        ]
      : bucket.buy.slice(0, 3);
  const candidates = stage2Candidates.length > 0 ? stage2Candidates : fallbackCandidates;
  if (bucket.deployBudget <= 0 || candidates.length === 0 || emergencyDefense?.enabled) return [];

  const profiled = candidates.map((item) =>
    buildCandidateProfile(item, account, quant, technicalMap, entryConfig, emergencyDefense),
  );
  const weights = computeSizingWeights(profiled, positionSizing);

  return profiled.map((item, index) => {
    const rawAmount = Math.round(bucket.deployBudget * (weights[index] ?? 0));
    const correlation =
      typeof item.maxCorrelationToPortfolio === "number"
        ? Math.abs(item.maxCorrelationToPortfolio)
        : null;
    const correlationHaircutApplied =
      correlation != null &&
      correlation >=
        (positionSizing.correlationThreshold ??
          DEFAULT_POSITION_SIZING.correlationThreshold);
    let suggestedAmount = correlationHaircutApplied
      ? Math.round(
          rawAmount *
            (positionSizing.correlationHaircut ??
              DEFAULT_POSITION_SIZING.correlationHaircut),
        )
      : rawAmount;

    const currentMarketValue =
      (account.holdings ?? []).find((holding) => holding.code === item.code)?.marketValue ?? 0;
    const maxSinglePositionAmount = Math.round(
      bucket.totalAssets *
        (positionSizing.maxSinglePosition_pct ??
          DEFAULT_POSITION_SIZING.maxSinglePosition_pct),
    );
    const remainingRoom = Math.max(maxSinglePositionAmount - currentMarketValue, 0);
    suggestedAmount = Math.min(suggestedAmount, remainingRoom);

    return {
      ...item,
      sizingMethod:
        typeof item.technical?.atrPct === "number" &&
        positionSizing.method === "inverse_atr"
          ? "inverse_atr"
          : positionSizing.fallbackMethod ?? DEFAULT_POSITION_SIZING.fallbackMethod,
      baseSuggestedAmount: rawAmount,
      suggestedAmount,
      correlationHaircutApplied,
      maxSinglePositionAmount,
    };
  }).filter((item) => item.suggestedAmount > 0);
}

function validateExecutionPlan({ account, bucket, stagedBuys, trims, holds, rejectedAlternatives }) {
  const validatorFlags = [];
  const validatedBuys = [];
  const rejected = [...rejectedAlternatives];

  for (const item of stagedBuys) {
    const itemCategory =
      CATEGORY_BY_CODE[item.code]?.[account.key] ??
      CATEGORY_BY_CODE[item.code]?.default ??
      null;

    if (
      bucket.topGap?.category &&
      itemCategory &&
      itemCategory !== bucket.topGap.category
    ) {
      validatorFlags.push(`gap_action_mismatch:${item.name}`);
      rejected.push({
        ...item,
        rejectionReason: `부족 자산군(${bucket.topGap.category})과 실행 후보 카테고리(${itemCategory})가 달라 제외`,
      });
      continue;
    }

    if (hasNegativeActionLanguage(item.reason)) {
      validatorFlags.push(`buy_reason_conflict:${item.name}`);
      rejected.push({
        ...item,
        rejectionReason: "매수 후보 설명이 축소/보류 논리와 충돌",
      });
      continue;
    }

    if (!isBuyableStance(item.stance ?? "buy")) {
      validatorFlags.push(`non_buy_stance:${item.name}`);
      rejected.push({
        ...item,
        rejectionReason: `Stage 2 stance(${item.stance ?? "unknown"})와 매수 액션이 충돌`,
      });
      continue;
    }

    if (trims.some((trim) => trim.code && trim.code === item.code)) {
      validatorFlags.push(`buy_trim_conflict:${item.name}`);
      rejected.push({
        ...item,
        rejectionReason: "같은 종목이 trim 후보와 동시에 나타나 실행에서 제외",
      });
      continue;
    }

    validatedBuys.push(item);
  }

  if (validatedBuys.length === 0 && bucket.deployBudget > 0) {
    validatorFlags.push("no_action_after_validation");
  }

  const confidence =
    validatedBuys.length > 0
      ? Number.parseFloat(
          (
            validatedBuys.reduce((sum, item) => sum + normalizeCandidateConfidence(item.confidence), 0) /
            validatedBuys.length
          ).toFixed(2),
        )
      : 0;

  const topEvidence = [
    ...validatedBuys.slice(0, 2).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      source: item.source ?? "stage2",
      reason: item.reason ?? null,
    })),
    ...holds.slice(0, 1).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      source: item.source ?? "stage3",
      reason: item.reason ?? null,
    })),
  ].slice(0, 3);

  return {
    stagedBuys: validatedBuys,
    validatorFlags,
    rejectedAlternatives: rejected.slice(0, 6),
    noAction: validatedBuys.length === 0,
    noActionReason:
      validatedBuys.length === 0
        ? "전략-실행 검증 후 통과한 매수 후보가 없어 no_action으로 유지"
        : null,
    confidence,
    topEvidence,
  };
}

function summarizeMacroTheme(stage2Data) {
  const summary = String(stage2Data?.macro_view?.summary ?? "").replace(/\s+/g, " ").trim();
  if (!summary) return null;
  if (/유가|원유|중동|이란|호르무즈/i.test(summary)) {
    return "중동 지정학 리스크와 유가 상승이 시장 변동성을 키우고 있습니다.";
  }
  if (/금리|CPI|인플레이션|연준|FOMC/i.test(summary)) {
    return "인플레이션과 금리 상방 압력이 위험자산 선호를 누르고 있습니다.";
  }
  if (/AI|데이터센터|전력|반도체/i.test(summary)) {
    return "AI 인프라와 전력 수요가 구조적 성장 축으로 다시 부각되고 있습니다.";
  }
  return summary;
}

function categoryNarrative(category) {
  if (category === "금") return "방어자산과 원자재 헤지";
  if (category === "배당/커버드콜") return "변동성 완충형 인컴 자산";
  if (category === "현금파킹") return "대기 자금과 금리 방어 버퍼";
  if (category === "S&P500" || category === "미국인덱스") return "미국 코어 인덱스";
  if (category === "나스닥100") return "미국 성장/빅테크";
  if (category === "전력기기") return "AI·전력 인프라";
  if (category === "방산") return "지정학 민감 방산";
  if (category === "원자력") return "에너지 안보/원전";
  return category;
}

function resolveExecutionCategory(accountKey, code) {
  if (!code) return null;
  return CATEGORY_BY_CODE[code]?.[accountKey] ?? CATEGORY_BY_CODE[code]?.default ?? null;
}

function detectVolatilityBucket({ technicalItem, category }) {
  let score = 0;
  const normalizedCategory = String(category ?? "");

  if (
    ["방산", "원자력", "전력기기", "구리", "개별주"].includes(normalizedCategory)
  ) {
    score += 2;
  } else if (
    ["나스닥100", "미국인덱스", "S&P500", "금", "배당/커버드콜", "현금파킹"].includes(
      normalizedCategory,
    )
  ) {
    score += 0;
  } else {
    score += 1;
  }

  const absoluteMove = Math.abs(Number(technicalItem?.change_pct ?? 0));
  if (absoluteMove >= 0.03) score += 1;
  if (absoluteMove >= 0.05) score += 1;

  const rsi = Number(technicalItem?.rsi ?? 50);
  if (rsi >= 68 || rsi <= 32) score += 1;

  const volumeRatio = Number(technicalItem?.volume_ratio ?? 1);
  if (volumeRatio >= 1.8) score += 1;

  const bollingerPosition = technicalItem?.bollinger?.position ?? null;
  if (bollingerPosition === "above_upper" || bollingerPosition === "below_lower") {
    score += 1;
  }

  if ((technicalItem?.alerts ?? []).length > 0) {
    score += 1;
  }

  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function buildExecutionGuardrails({ account, bucket, item, technicalItem, category }) {
  const deployPct =
    bucket.deployBudget > 0 && typeof item.suggestedAmount === "number"
      ? item.suggestedAmount / bucket.deployBudget
      : null;
  const accountBase = Math.max(
    account.evaluationAmount ?? 0,
    (account.evaluationAmount ?? 0) + (account.cashAvailable ?? 0),
  );
  const accountPct =
    accountBase > 0 && typeof item.suggestedAmount === "number"
      ? item.suggestedAmount / accountBase
      : null;
  const volatilityBucket = detectVolatilityBucket({ technicalItem, category });

  const positionSizeLabel =
    deployPct == null
      ? null
      : deployPct <= 0.2
        ? "소"
        : deployPct <= 0.45
          ? "중"
          : "대";

  const baseStopLoss =
    volatilityBucket === "high" ? 0.08 : volatilityBucket === "medium" ? 0.06 : 0.04;
  const stopLossPct =
    ["방산", "원자력", "전력기기", "개별주"].includes(String(category ?? ""))
      ? baseStopLoss + 0.01
      : baseStopLoss;

  const rsi = Number(technicalItem?.rsi ?? 50);
  const bollingerPosition = technicalItem?.bollinger?.position ?? null;

  let entryCondition;
  if (volatilityBucket === "high") {
    entryCondition =
      "고변동성 구간이라 장대 양봉 추격 대신 2~3회 분할 접근이 우선입니다.";
  } else if (rsi >= 68 || bollingerPosition === "above_upper") {
    entryCondition =
      "단기 과열 신호가 있어 시가 추격보다 눌림 또는 종가 안정 확인 후 진입하는 편이 좋습니다.";
  } else if (rsi <= 35 || bollingerPosition === "below_lower") {
    entryCondition =
      "과매도 반등 초입일 수 있어 1차 소액 진입 후 후속 확인을 붙이는 방식이 적절합니다.";
  } else {
    entryCondition =
      "특별한 과열 신호는 없어도 한 번에 넣기보다 2회 이상 분할 진입이 안정적입니다.";
  }

  const stopLossNote = `${Math.round(stopLossPct * 100)}% 손실 또는 20일선/핵심 논리 훼손 시 재평가`;

  return {
    volatilityBucket,
    entryCondition,
    stopLossPct: Number.parseFloat((stopLossPct * 100).toFixed(1)),
    stopLossNote,
    positionSizePctOfDeployBudget:
      deployPct == null ? null : Number.parseFloat((deployPct * 100).toFixed(1)),
    positionSizePctOfAccount:
      accountPct == null ? null : Number.parseFloat((accountPct * 100).toFixed(1)),
    positionSizeLabel,
  };
}

function accountPersona(accountKey) {
  if (accountKey === "ISA") {
    return "절세 계좌 특성상 국내 ETF 중심의 방어·인컴·테마 배치를 유연하게 조정하는 역할";
  }
  if (accountKey === "PENSION") {
    return "장기 복리 관점에서 미국 코어 자산과 방어 자산을 안정적으로 쌓는 역할";
  }
  if (accountKey === "TOSS") {
    return "전술 테마와 성장 섹터를 민첩하게 반영하는 역할";
  }
  if (accountKey === "KIS_MAIN") {
    return "전술 테마와 현금 운용을 함께 조절하며 국내 ETF 알파를 쌓는 역할";
  }
  return "계좌 목적에 맞는 자산 배분 역할";
}

function buildClusterWarningLookup(holdingClusters) {
  const warningByCode = new Map();

  for (const cluster of holdingClusters?.clusters ?? []) {
    if ((cluster?.holdings ?? []).length < 3) continue;
    for (const holding of cluster.holdings ?? []) {
      if (!holding?.code) continue;
      warningByCode.set(holding.code, {
        clusterId: cluster.id ?? null,
        warning:
          cluster.warning ??
          `⚠ 같은 클러스터에 ${(cluster.holdings ?? []).length}종목 이상 집중`,
        holdingCount: (cluster.holdings ?? []).length,
        avgCorrelation: cluster.avgCorrelation ?? null,
      });
    }
  }

  return warningByCode;
}

function topImpactReasons(impactMap, account, limit = 3) {
  const reasons = [];

  for (const report of impactMap?.reports ?? []) {
    for (const impact of report.impacts ?? []) {
      const target = impact.target ?? {};
      const matchesAccount = target.accountKey === account.key;
      const matchesHolding =
        target.type === "holding" &&
        (account.holdings ?? []).some((holding) => holding.code === target.code);
      const matchesCategory =
        target.type === "category" &&
        Boolean(target.accountKey === account.key && target.name);
      if (!matchesAccount && !matchesHolding && !matchesCategory) continue;

      reasons.push({
        reportTitle: report.title,
        direction: impact.direction ?? "neutral",
        targetType: target.type ?? "unknown",
        targetName: target.name ?? target.code ?? account.label,
        text: impact.evidence?.snippets?.[0] ?? null,
        riskTags: impact.riskTags ?? [],
      });
    }
  }

  return reasons.slice(0, limit);
}

function simplifyDriverText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^[•\-–—\s]+/, "")
    .replace(/\s*\.\.\.\s*$/, "")
    .trim();
  if (cleaned.length <= 180) return cleaned;
  const sentence = cleaned.match(/^(.{40,180}?[.!?])(?:\s|$)/)?.[1];
  if (sentence) return sentence.trim();
  return `${cleaned.slice(0, 177).trim()}...`;
}

function buildMacroCommentary({
  account,
  bucket,
  stage2Action,
  stage2Data,
  stage1Drivers,
  impactMap,
}) {
  const macroHeadline = summarizeMacroTheme(stage2Data);
  const gapCategory = bucket.topGap?.category ?? null;
  const assetFocus = gapCategory ? categoryNarrative(gapCategory) : null;
  const persona = accountPersona(account.key);
  const firstBuy = bucket.stage2Candidates?.[0] ?? bucket.buy?.[0] ?? null;
  const reserveNote = stage2Action?.reserve_cash_note
    ? String(stage2Action.reserve_cash_note).replace(/\s+/g, " ").trim()
    : null;
  const rationale = stage2Action?.rationale
    ? String(stage2Action.rationale).replace(/\s+/g, " ").trim()
    : null;
  const isReadableDriver = (value) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 28) return false;
    if ((text.match(/\b\d[\d,.-]*\b/g) ?? []).length >= 10) return false;
    if ((text.match(/[u│■•□]/g) ?? []).length >= 3) return false;
    if (/다올투자증권|여의나루로|본사영업점/i.test(text)) return false;
    return true;
  };

  const mappedDrivers = topImpactReasons(impactMap, account, 3)
    .map((item) => {
      const reportLabel = simplifyDriverText(item.reportTitle)?.replace(/^\[[^\]]+\]\s*/, "") ?? "관련 리포트";
      const directionLabel =
        item.direction === "positive"
          ? "긍정"
          : item.direction === "negative"
            ? "부정"
            : item.direction === "mixed"
              ? "혼합"
              : "중립";
      const riskHint =
        item.riskTags?.includes("oil")
          ? "유가"
          : item.riskTags?.includes("rates")
            ? "금리"
            : item.riskTags?.includes("geopolitics")
              ? "지정학"
              : item.riskTags?.includes("ai")
                ? "AI 인프라"
                : item.riskTags?.includes("defense")
                  ? "방산"
                  : null;
      const base = `${reportLabel}는 ${item.targetName}에 ${directionLabel} 신호를 줍니다${riskHint ? ` (${riskHint})` : ""}.`;
      return base;
    })
    .filter(Boolean);

  const researchDrivers = (stage1Drivers ?? [])
    .map((item) => String(item.thesis ?? "").replace(/\s+/g, " ").trim())
    .map((item) => simplifyDriverText(item))
    .filter((item) => isReadableDriver(item))
    .slice(0, 2);

  const summaryParts = [
    macroHeadline,
    assetFocus ? `${account.label}은 ${assetFocus} 비중 조정이 핵심입니다.` : null,
    `${persona}로 작동하는 계좌입니다.`,
  ].filter(Boolean);

  const actionLine =
    bucket.emergencyDefense?.enabled
      ? `${account.label}은 긴급 방어 모드라 신규 매수보다 현금 비중 유지와 기존 포지션 점검이 우선입니다.`
      : bucket.deployBudget > 0 && (bucket.topGap || firstBuy)
      ? `${account.label}은 ${bucket.topGap?.category ?? "핵심 자산"}을 우선 보강하고, ${
          firstBuy?.name ?? bucket.candidateFromGap ?? "선별 후보"
        }를 중심으로 ${won(bucket.deployBudget)} 한도에서 분할 접근하는 편이 좋습니다.`
      : `${account.label}은 지금은 공격적 확대보다 기존 포지션과 현금 비중을 재점검하는 편이 좋습니다.`;

  return {
    summary: summaryParts.join(" "),
    drivers: [
      ...(macroHeadline ? [macroHeadline] : []),
      ...(rationale ? [rationale] : []),
      ...mappedDrivers,
      ...researchDrivers,
    ].slice(0, 4),
    assetFocus: [
      ...(assetFocus ? [assetFocus] : []),
      ...(bucket.topGap?.category ? [bucket.topGap.category] : []),
      ...bucket.gapSummary.slice(0, 2).map((item) => item.category),
    ]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 4),
    actionLine,
    reserveNote,
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const context = await loadAnalysisContext(args, {
    portfolio: true,
    strategy: true,
    stage1: true,
    stage2: true,
    stage2Mock: true,
    stage3: true,
    technical: true,
    impactMap: true,
    stage2Resolved: true,
  });
  const { paths, data } = context;
  const stateDir = paths.analysisDir;
  const portfolio = data.portfolio;
  const strategy = data.strategy;
  const stage1 = data.stage1;
  const quant = data.stage3;
  const impactMap = data.impactMap;
  const stage2Data = data.stage2Data;
  const technical = data.technical ?? { scores: {}, market_context: {} };
  const technicalMap = technical.scores ?? {};
  const market = await readJson(path.join(ROOT_DIR, "data", "market", `${args.date}.json`), {
    indices: {},
    macro: {},
    watchlist: {},
  });
  const normalizedPortfolio = enrichPortfolioWithSecurityCodes(portfolio);
  const holdingClusters = await readJson(path.join(stateDir, "holding-clusters.json"), {
    clusters: [],
  });
  const clusterWarningByCode = buildClusterWarningLookup(holdingClusters);
  const positionSizing = {
    ...DEFAULT_POSITION_SIZING,
    ...(strategy?.positionSizing ?? {}),
  };
  const entryConfig = {
    ...DEFAULT_ENTRY_CONDITIONS,
    ...(strategy?.entryConditions ?? {}),
  };
  const emergencyDefense = detectEmergencyDefense({
    quant,
    market,
    entryConfig,
  });

  const accountPlans = (normalizedPortfolio.accounts ?? []).map((account) => {
    const stage2Action =
      stage2Data.account_actions?.find(
        (item) =>
          item.account_key === account.key ||
          item.account_key === normalizeStrategyAccountKey(account, strategy),
      ) ??
      null;
    const bucket = executionBuckets(account, quant, stage2Action, strategy, technicalMap);
    bucket.emergencyDefense = emergencyDefense;
    const stage2Resolution = resolveStage2Candidates(account, stage2Data, bucket);
    const stage2Candidates = stage2Resolution.accepted;
    bucket.stage2Candidates = stage2Resolution;
    const stage1Drivers = stage1.extracts
      .filter((item) => item.related_accounts?.includes(account.key))
      .slice(0, 4)
      .map((item) => ({
        id: item.id,
        title: item.title,
        thesis: item.primary_claim?.summary ?? item.key_thesis,
      }));
    const rawStagedBuys = distributeBudget({
      bucket,
      account,
      quant,
      technicalMap,
      stage2Candidates,
      positionSizing,
      entryConfig,
      emergencyDefense,
    });
    const validation = validateExecutionPlan({
      account,
      bucket,
      stagedBuys: rawStagedBuys,
      trims: bucket.trim.slice(0, 3),
      holds: bucket.hold.slice(0, 3),
      rejectedAlternatives: stage2Resolution.rejected,
    });
    const macroCommentary = buildMacroCommentary({
      account,
      bucket,
      stage2Action,
      stage2Data,
      stage1Drivers,
      impactMap,
    });
    if (validation.noAction) {
      macroCommentary.actionLine = `${account.label}은 오늘은 no_action으로 유지합니다. ${validation.noActionReason}`;
    }
    const stagedBuys = validation.stagedBuys.map((item) => {
      const technicalItem = item.code ? technicalMap[item.code] ?? null : null;
      const category =
        resolveExecutionCategory(account.key, item.code) ??
        bucket.topGap?.category ??
        null;
      const clusterInfo = item.code ? clusterWarningByCode.get(item.code) ?? null : null;
      return {
        ...item,
        ...buildExecutionGuardrails({
          account,
          bucket,
          item,
          technicalItem,
          category,
        }),
        clusterId: clusterInfo?.clusterId ?? null,
        clusterWarning: clusterInfo?.warning ?? null,
        clusterHoldingCount: clusterInfo?.holdingCount ?? null,
        clusterAvgCorrelation: clusterInfo?.avgCorrelation ?? null,
      };
    });
    const clusterWarnings = stagedBuys
      .filter((item) => item.clusterWarning)
      .map((item) => item.clusterWarning);

    return {
      key: account.key,
      label: account.label,
      totalScore: quant.accounts?.[account.key]?.totalScore ?? 50,
      stage2Bias: bucket.stage2Bias,
      deployBudget: emergencyDefense.enabled ? 0 : bucket.deployBudget,
      plannedDeployBudget: bucket.deployBudget,
      reserveCash: emergencyDefense.enabled ? account.cashAvailable ?? 0 : bucket.reserveCash,
      topGap: bucket.topGap,
      candidateFromGap: bucket.candidateFromGap,
      stage2Candidates,
      stagedBuys,
      trims: bucket.trim.slice(0, 3),
      holds: bucket.hold.slice(0, 3),
      watches: bucket.watch.slice(0, 3),
      macroCommentary,
      stage1Drivers,
      emergencyDefense,
      technicalFallback:
        technical?.fallback?.recoveredFromDate == null &&
        Object.keys(technicalMap).length === 0
          ? technical?.fallback ?? { kind: "technical", reason: "no_technical_data" }
          : technical?.fallback ?? null,
      validatorFlags: validation.validatorFlags,
      clusterWarnings,
      rejectedAlternatives: validation.rejectedAlternatives,
      noAction: validation.noAction,
      noActionReason: validation.noActionReason,
      confidence: validation.confidence,
      topEvidence: validation.topEvidence,
    };
  });

  const outputJson = args.output ?? path.join(stateDir, "stage4-execution-plan.json");
  const outputMarkdown =
    args.markdown ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-stage4-execution-plan.md`);
  const outputBriefing =
    args.briefing ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-briefing.md`);
  const runMeta = buildRunMetadata(args);

  const payload = {
    ...runMeta,
    portfolioScore: quant.portfolio?.totalScore ?? 50,
    regime: quant.regime ?? null,
    emergencyDefense,
    positionSizing,
    entryConditions: entryConfig,
    technicalFallback: technical?.fallback ?? null,
    marketFallback: market?.fallback ?? null,
    accountPlans,
  };

  const regimeConfidence =
    typeof quant.regime?.confidence === "number" ? quant.regime.confidence.toFixed(2) : "N/A";

  const markdown = [
    `# EcoReport Stage 4 Execution Plan (${args.date})`,
    "",
    `- 실행일: ${runMeta.runDate}`,
    `- 기준 거래일: ${runMeta.effectiveMarketDate}`,
    `- run_id: ${runMeta.runId ?? "N/A"}`,
    `- 포트폴리오 총점: ${quant.portfolio?.totalScore ?? "N/A"}점`,
    `- 레짐: ${quant.regime?.name ?? "N/A"} (신뢰도 ${regimeConfidence})`,
    `- 긴급 방어 모드: ${emergencyDefense.enabled ? `YES / ${emergencyDefense.triggers.join(", ")}` : "NO"}`,
    "",
    ...accountPlans.flatMap((account) => [
      `## ${account.label} (${account.key})`,
      `- 계좌 총점: ${account.totalScore}점`,
      `- Stage 2 bias: ${account.stage2Bias}`,
      `- 이번 단계 투입 가능 금액: ${won(account.deployBudget)}${account.plannedDeployBudget !== account.deployBudget ? ` (원안 ${won(account.plannedDeployBudget)})` : ""}`,
      `- 남길 예수금: ${won(account.reserveCash)}`,
      `- 검증 confidence: ${account.confidence ?? 0}`,
      `- validator flags: ${account.validatorFlags?.join(", ") || "없음"}`,
      `- cluster warnings: ${account.clusterWarnings?.join(", ") || "없음"}`,
      `- 가장 부족한 자산군: ${account.topGap ? `${account.topGap.category} / ${won(Math.max(account.topGap.gapAmount, 0))}` : "없음"}`,
      `- 우선 보강 후보: ${account.candidateFromGap ?? "없음"}`,
      `- 매크로 → 자산군 → 액션: ${account.macroCommentary?.actionLine ?? "요약 없음"}`,
      ...(account.technicalFallback ? [`- 기술 폴백: ${account.technicalFallback.reason ?? "no technical"}${account.technicalFallback.recoveredFromDate ? ` / ${account.technicalFallback.recoveredFromDate} 기준 복구` : ""}`] : []),
      "",
      "### 1차 실행",
      ...(account.stagedBuys.length > 0
        ? account.stagedBuys.map(
            (item) =>
              `- ${item.name}${item.code ? `(${item.code})` : ""} ${won(item.suggestedAmount)} / 사이징: ${item.positionSizeLabel ?? "-"}${item.positionSizePctOfDeployBudget != null ? ` (${item.positionSizePctOfDeployBudget}% of deploy)` : ""} / 진입: ${item.entryCondition ?? "-"} / 리스크: ${item.stopLossNote ?? "-"}${item.clusterWarning ? ` / 클러스터: ${item.clusterWarning}` : ""} / 이유: ${item.reason}`,
          )
        : [`- 즉시 매수 후보 없음${account.noActionReason ? ` / ${account.noActionReason}` : ""}`]),
      "",
      "### 비중 축소/재점검",
      ...(account.trims.length > 0
        ? account.trims.map((item) => `- ${item.name}(${item.code}) / ${item.score}점 / ${item.stopLoss?.triggered ? "손절 발동 / " : ""}${item.reason}`)
        : ["- 즉시 축소 대상 없음"]),
      "",
      "### 유지/관찰",
      ...(account.holds.length > 0 ? account.holds.map((item) => `- 유지: ${item.name}(${item.code}) / ${item.score}점`) : ["- 유지 후보 없음"]),
      ...(account.watches.length > 0 ? account.watches.map((item) => `- 관찰: ${item.name}(${item.code}) / ${item.score}점`) : []),
      "",
      "### Stage 1 근거",
      ...(account.stage1Drivers.length > 0
        ? account.stage1Drivers.map((item) => `- ${item.id}: ${item.title} / ${item.thesis}`)
        : ["- 직접 관련 리포트 추출 없음"]),
      "",
      "### Rejected Alternatives",
      ...(account.rejectedAlternatives?.length > 0
        ? account.rejectedAlternatives.map((item) => `- ${item.name}${item.code ? `(${item.code})` : ""} / ${item.rejectionReason}`)
        : ["- 거절된 대안 없음"]),
      "",
      "### 매크로 코멘터리",
      ...(account.macroCommentary?.drivers?.length > 0
        ? account.macroCommentary.drivers.map((item) => `- ${item}`)
        : ["- 직접 연결된 거시 코멘트 없음"]),
      "",
    ]),
  ].join("\n");

  const briefing = [
    `# EcoReport 어드바이저 브리핑 (${args.date})`,
    "",
    `- run_date: ${runMeta.runDate}`,
    `- effective_market_date: ${runMeta.effectiveMarketDate}`,
    `- run_id: ${runMeta.runId ?? "N/A"}`,
    `- generated_at: ${runMeta.generatedAt}`,
    `- 포트폴리오 총점: ${quant.portfolio?.totalScore ?? "N/A"}점`,
    `- 현재 레짐: ${quant.regime?.name ?? "N/A"} / 신뢰도 ${regimeConfidence}`,
    `- 긴급 방어: ${emergencyDefense.enabled ? emergencyDefense.triggers.join(", ") : "없음"}`,
    `- 핵심 코멘트: ${quant.portfolio?.note ?? "요약 없음"}`,
    "",
    "## 오늘의 우선 액션",
    ...accountPlans.map((account) => {
      const firstBuy = account.stagedBuys[0];
      const topGap = account.topGap?.category ?? "없음";
      return `- ${account.label}: ${topGap} 보강 우선 / ${account.totalScore}점 / 1차 ${firstBuy ? `${firstBuy.name} ${won(firstBuy.suggestedAmount)}` : `no_action (${account.noActionReason ?? "검증 후 보류"})`}`;
    }),
    "",
    "## 계좌별 코멘트",
    ...accountPlans.flatMap((account) => [
      `### ${account.label}`,
      `- 계좌 총점: ${account.totalScore}점`,
      ...(account.macroCommentary?.summary ? [`- 매크로 요약: ${account.macroCommentary.summary}`] : []),
      `- 부족한 자산군: ${account.topGap ? `${account.topGap.category} (${won(Math.max(account.topGap.gapAmount, 0))})` : "없음"}`,
      `- 남길 예수금: ${won(account.reserveCash)}`,
      `- validator: ${account.validatorFlags?.join(", ") || "없음"}`,
      ...(account.clusterWarnings?.length > 0
        ? [`- 클러스터 경고: ${account.clusterWarnings.join(", ")}`]
        : []),
      `- 우선 후보: ${account.stage2Candidates.length > 0 ? account.stage2Candidates.map((item) => item.name).join(", ") : account.candidateFromGap ?? "없음"}`,
      ...(account.macroCommentary?.actionLine ? [`- 액션 연결: ${account.macroCommentary.actionLine}`] : []),
      ...(account.rejectedAlternatives?.length > 0
        ? [`- 제외된 대안: ${account.rejectedAlternatives.map((item) => item.name).join(", ")}`]
        : []),
      ...(account.trims.length > 0
        ? [`- 재점검 필요: ${account.trims.map((item) => `${item.name} ${item.score}점`).join(", ")}`]
        : [`- 재점검 필요: 즉시 축소 대상 없음`]),
      "",
    ]),
  ].join("\n");

  await writeJson(outputJson, payload);
  await writeText(outputMarkdown, `${markdown}\n`);
  await writeText(outputBriefing, `${briefing}\n`);
  console.log(outputJson);
}

main().catch((error) => {
  console.error(`stage4 execution plan 생성 실패: ${error.message}`);
  process.exit(1);
});
