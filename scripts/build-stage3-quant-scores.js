#!/usr/bin/env node
// 3단계: 리포트 영향 + 기술지표 + 배분 괴리를 합성해 종목/계좌/포트폴리오 점수를 계산합니다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  ROOT_DIR,
  clamp,
  parseDateArgs,
  pct,
  readJson,
  sigmoid,
  softmax,
  won,
  writeJson,
} from "./lib/pipeline-utils.js";

function detectRegime(technical) {
  const market = technical?.market_context ?? {};
  const ma20 = market.ma?.ma20 ?? null;
  const ma60 = market.ma?.ma60 ?? null;
  const close = market.close ?? null;
  if (typeof market.vix === "number" && market.vix >= 30) {
    return { name: "HIGH_VOL", confidence: 0.72 };
  }
  if (close != null && ma20 != null && ma60 != null && close > ma20 && ma20 > ma60 && (market.score ?? 0) >= 55) {
    return { name: "BULL", confidence: 0.68 };
  }
  if (close != null && ma20 != null && ma60 != null && close < ma20 && ma20 < ma60 && (market.score ?? 0) <= 38) {
    return { name: "BEAR", confidence: 0.66 };
  }
  return { name: "SIDEWAYS", confidence: 0.58 };
}

const REGIME_WEIGHTS = {
  BULL: {
    direction: { ma: 0.32, macd: 0.22, rsi: 0.12, adx: 0.12, report: 0.22 },
    timing: { bb: 0.18, rsi: 0.22, stoch: 0.22, volume: 0.14, report: 0.24 },
    bias: 0.2,
  },
  SIDEWAYS: {
    direction: { ma: 0.26, macd: 0.18, rsi: 0.12, adx: 0.10, report: 0.34 },
    timing: { bb: 0.28, rsi: 0.22, stoch: 0.22, volume: 0.10, report: 0.18 },
    bias: 0.0,
  },
  BEAR: {
    direction: { ma: 0.22, macd: 0.18, rsi: 0.10, adx: 0.10, report: 0.40 },
    timing: { bb: 0.24, rsi: 0.18, stoch: 0.18, volume: 0.08, report: 0.32 },
    bias: -0.2,
  },
  HIGH_VOL: {
    direction: { ma: 0.20, macd: 0.14, rsi: 0.08, adx: 0.08, report: 0.50 },
    timing: { bb: 0.18, rsi: 0.14, stoch: 0.14, volume: 0.08, report: 0.46 },
    bias: -0.35,
  },
};

function valueOrFallback(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

function aggregateReportImpacts(stage1Extracts, targetCode, accountKey) {
  const impacts = [];
  for (const extract of stage1Extracts ?? []) {
    for (const impact of extract.portfolio_impacts_candidate ?? []) {
      if (impact.target_type === "holding" && impact.target_code === targetCode) {
        impacts.push({ ...impact, reportId: extract.id, title: extract.title, weightType: "holding" });
      } else if (impact.target_type === "account" && impact.account_key === accountKey) {
        impacts.push({ ...impact, reportId: extract.id, title: extract.title, weightType: "account" });
      } else if (
        impact.target_type === "theme" &&
        ((targetCode === "487240" && impact.target_name?.includes("전력")) ||
          (targetCode === "449450" && impact.target_name?.includes("방산")) ||
          (targetCode === "434730" && impact.target_name?.includes("원자력")))
      ) {
        impacts.push({ ...impact, reportId: extract.id, title: extract.title, weightType: "theme" });
      }
    }
  }

  const horizonWeight = { "1w": 0.8, "1m": 1.0, "3m": 1.15, "6m": 1.25 };
  let raw = 0;
  for (const impact of impacts) {
    const sign =
      impact.direction === "positive" ? 1 : impact.direction === "negative" ? -1 : impact.direction === "mixed" ? -0.2 : 0;
    const typeWeight =
      impact.weightType === "holding" ? 1.0 : impact.weightType === "theme" ? 0.55 : 0.22;
    raw += sign * (impact.strength ?? 0.3) * (horizonWeight[impact.horizon] ?? 1) * typeWeight;
  }

  return {
    value: clamp(raw, -2.5, 2.5),
    impacts,
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
    direction: Number.parseFloat(direction.toFixed(3)),
    timing: Number.parseFloat(timing.toFixed(3)),
    reportScore: Number.parseFloat(reportImpact.value.toFixed(3)),
    probabilities: {
      p_buy: Number.parseFloat(pBuy.toFixed(4)),
      p_hold: Number.parseFloat(pHold.toFixed(4)),
      p_sell: Number.parseFloat(pSell.toFixed(4)),
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

function allocationScoreForAccount(account, strategy) {
  const strategyKey = normalizeStrategyAccountKey(account);
  const targetAllocation = strategy?.accounts?.[strategyKey]?.target_allocation ?? {};
  const holdingsValue = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const totalAssets = Math.max(account.evaluationAmount ?? 0, holdingsValue + (account.cashAvailable ?? 0));
  if (totalAssets <= 0) return 50;

  const amounts = new Map();
  for (const holding of account.holdings ?? []) {
    const category =
      CATEGORY_BY_CODE[holding.code]?.[account.key] ??
      CATEGORY_BY_CODE[holding.code]?.default ??
      "기타";
    amounts.set(category, (amounts.get(category) ?? 0) + (holding.marketValue ?? 0));
  }
  if (targetAllocation["현금파킹"] != null) {
    amounts.set("현금파킹", account.cashAvailable ?? 0);
  }

  const categories = new Set([...Object.keys(targetAllocation), ...amounts.keys()]);
  const diff = [...categories].reduce((sum, category) => {
    const currentPct = (amounts.get(category) ?? 0) / totalAssets;
    const targetPct = targetAllocation[category] ?? 0;
    return sum + Math.abs(currentPct - targetPct);
  }, 0);
  return Math.round(clamp((1 - diff / 2) * 100, 0, 100));
}

function accountSummary(account, holdingScores, strategy, stage2Options) {
  const allocationScore = allocationScoreForAccount(account, strategy);
  const totalWeight = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0) || 1;
  const weightedHoldingScore = Math.round(
    (account.holdings ?? []).reduce((sum, holding) => {
      const holdingScore = holdingScores[holding.code]?.actionScore ?? 50;
      return sum + holdingScore * ((holding.marketValue ?? 0) / totalWeight);
    }, 0),
  );

  const stage2Action =
    stage2Options?.account_actions?.find((item) => item.account_key === account.key || item.account_key === normalizeStrategyAccountKey(account)) ??
    null;
  const stage2BiasBoost =
    stage2Action?.bias === "aggressive_add"
      ? 8
      : stage2Action?.bias === "selective_add"
        ? 4
        : stage2Action?.bias === "defensive"
          ? -6
          : 0;

  const reportCoverage = Math.round(
    ((account.holdings ?? []).filter((holding) => (holdingScores[holding.code]?.reportImpacts?.length ?? 0) > 0).length /
      Math.max((account.holdings ?? []).length, 1)) *
      100,
  );

  const totalScore = Math.round(
    clamp(allocationScore * 0.35 + weightedHoldingScore * 0.45 + reportCoverage * 0.10 + (50 + stage2BiasBoost) * 0.10, 0, 100),
  );

  return {
    key: account.key,
    label: account.label,
    allocationScore,
    holdingsScore: weightedHoldingScore,
    reportCoverageScore: reportCoverage,
    stage2Bias: stage2Action?.bias ?? "hold",
    totalScore,
    note:
      totalScore >= 72
        ? "배분과 개별 종목 점수가 함께 양호"
        : totalScore >= 55
          ? "선별적 보강 가능하지만 계좌 내 약한 종목도 존재"
          : "계좌 내 종목 점수 또는 배분 괴리가 커서 재정비 우선",
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const [portfolio, strategy, technical, stage1, stage2] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(ROOT_DIR, "config", "strategy.json"), { accounts: {} }),
    readJson(path.join(ROOT_DIR, "data", "technical", `${args.date}.json`), { scores: {}, market_context: {} }),
    readJson(path.join(stateDir, "stage1-report-extracts-v2.json"), { extracts: [] }),
    readJson(path.join(stateDir, "stage2-strategy-options.json"), null),
  ]);
  const stage2Mock = stage2 ?? (await readJson(path.join(stateDir, "stage2-strategy-options.mock.json"), { account_actions: [] }));
  const regime = detectRegime(technical);
  const technicalMap = technical.scores ?? {};

  const holdingScores = {};
  for (const account of portfolio.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      const technicalItem = technicalMap[holding.code] ?? null;
      const reportImpact = aggregateReportImpacts(stage1.extracts, holding.code, account.key);
      const computed = computeActionScore(technicalItem, reportImpact, regime.name);
      holdingScores[holding.code] = {
        code: holding.code,
        name: holding.name,
        accountKey: account.key,
        accountLabel: account.label,
        marketValue: holding.marketValue ?? 0,
        technicalSignal: technicalItem?.signal ?? "N/A",
        technicalBaseScore: technicalItem?.score ?? null,
        ...computed,
        reportImpacts: reportImpact.impacts.slice(0, 5),
      };
    }
  }

  const accountScores = {};
  for (const account of portfolio.accounts ?? []) {
    accountScores[account.key] = accountSummary(account, holdingScores, strategy, stage2Mock);
  }

  const totalAssets = (portfolio.accounts ?? []).reduce((sum, account) => sum + Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0), 0) || 1;
  const portfolioScore = Math.round(
    (portfolio.accounts ?? []).reduce((sum, account) => {
      const assets = Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0);
      return sum + (accountScores[account.key]?.totalScore ?? 50) * (assets / totalAssets);
    }, 0),
  );

  const outputPath = args.output ?? path.join(stateDir, "stage3-quant-scores.json");
  await writeJson(outputPath, {
    date: args.date,
    generatedAt: new Date().toISOString(),
    regime,
    holdings: holdingScores,
    accounts: accountScores,
    portfolio: {
      totalScore: portfolioScore,
      note:
        portfolioScore >= 72
          ? "포트폴리오 전반이 우호적이나 과열 추격은 금지"
          : portfolioScore >= 55
            ? "선별적 추가와 방어를 병행해야 하는 구간"
            : "현금 방어와 약한 종목 재정리가 우선인 구간",
    },
  });
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage3 quant scores 생성 실패: ${error.message}`);
  process.exit(1);
});
