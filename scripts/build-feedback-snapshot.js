#!/usr/bin/env node
// F1: Stage 3/4 산출물을 매일 스냅샷으로 고정해 이후 성과 비교의 기준점으로 사용합니다.

import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  enrichPortfolioWithSecurityCodes,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

function buildPortfolioPositionMap(portfolio) {
  const positions = new Map();

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      if (!holding.code) continue;
      positions.set(`${account.key}:${holding.code}`, {
        accountKey: account.key,
        accountLabel: account.label,
        code: holding.code,
        name: holding.name,
        currentPrice:
          typeof holding.currentPrice === "number" ? holding.currentPrice : null,
        avgPrice: typeof holding.avgPrice === "number" ? holding.avgPrice : null,
        quantity: typeof holding.quantity === "number" ? holding.quantity : null,
        marketValue:
          typeof holding.marketValue === "number" ? holding.marketValue : null,
        purchaseValue:
          typeof holding.purchaseValue === "number" ? holding.purchaseValue : null,
        profitLoss:
          typeof holding.profitLoss === "number" ? holding.profitLoss : null,
        profitRate:
          typeof holding.profitRate === "number" ? holding.profitRate : null,
      });
    }
  }

  return positions;
}

function normalizeStage4Plan(plan) {
  return {
    key: plan?.key ?? null,
    label: plan?.label ?? null,
    totalScore: plan?.totalScore ?? null,
    stage2Bias: plan?.stage2Bias ?? null,
    deployBudget: plan?.deployBudget ?? null,
    reserveCash: plan?.reserveCash ?? null,
    topGap: plan?.topGap ?? null,
    candidateFromGap: plan?.candidateFromGap ?? null,
    stagedBuys: (plan?.stagedBuys ?? []).map((item) => ({
      code: item?.code ?? null,
      name: item?.name ?? null,
      suggestedAmount: item?.suggestedAmount ?? null,
      reason: item?.reason ?? null,
      source: item?.source ?? null,
    })),
    trims: (plan?.trims ?? []).map((item) => ({
      code: item?.code ?? null,
      name: item?.name ?? null,
      score: item?.score ?? null,
      reason: item?.reason ?? null,
    })),
    holds: (plan?.holds ?? []).map((item) => ({
      code: item?.code ?? null,
      name: item?.name ?? null,
      score: item?.score ?? null,
      reason: item?.reason ?? null,
    })),
    watches: (plan?.watches ?? []).map((item) => ({
      code: item?.code ?? null,
      name: item?.name ?? null,
      score: item?.score ?? null,
      reason: item?.reason ?? null,
    })),
  };
}

function normalizePosition(positionKey, stage3Position, portfolioPosition) {
  return {
    positionKey,
    code: stage3Position?.code ?? portfolioPosition?.code ?? null,
    name: stage3Position?.name ?? portfolioPosition?.name ?? null,
    accountKey: stage3Position?.accountKey ?? portfolioPosition?.accountKey ?? null,
    accountLabel:
      stage3Position?.accountLabel ?? portfolioPosition?.accountLabel ?? null,
    category: stage3Position?.category ?? null,
    signal: stage3Position?.signal ?? null,
    conviction: stage3Position?.conviction ?? null,
    actionScore:
      stage3Position?.actionScore ?? stage3Position?.scores?.actionScore ?? null,
    rawActionScore:
      stage3Position?.rawActionScore ??
      stage3Position?.scores?.rawActionScore ??
      null,
    technicalBaseScore:
      stage3Position?.technicalBaseScore ??
      stage3Position?.scores?.techScore ??
      null,
    reportScore:
      stage3Position?.report?.impactScore ??
      stage3Position?.scores?.reportScore ??
      null,
    factorScore:
      stage3Position?.factor?.score ??
      stage3Position?.scores?.factorScore ??
      null,
    entryPrice:
      portfolioPosition?.currentPrice ??
      stage3Position?.technical?.close ??
      portfolioPosition?.avgPrice ??
      null,
    currentPrice: portfolioPosition?.currentPrice ?? null,
    avgPrice: portfolioPosition?.avgPrice ?? null,
    quantity: portfolioPosition?.quantity ?? null,
    marketValue:
      portfolioPosition?.marketValue ?? stage3Position?.marketValue ?? null,
    purchaseValue: portfolioPosition?.purchaseValue ?? null,
    profitLoss: portfolioPosition?.profitLoss ?? null,
    profitRate: portfolioPosition?.profitRate ?? null,
    factors: {
      raw: stage3Position?.factor?.raw ?? {},
      zScores: stage3Position?.factor?.zScores ?? {},
      weightedZ: stage3Position?.factor?.weightedZ ?? null,
      coverage: stage3Position?.factor?.factorCoverage ?? null,
      availability: stage3Position?.factor?.availability ?? {},
    },
    report: {
      available: stage3Position?.report?.available ?? null,
      impactScore: stage3Position?.report?.impactScore ?? null,
      impactValue: stage3Position?.report?.impactValue ?? null,
      impactCount: stage3Position?.report?.impactCount ?? null,
      unavailableReason: stage3Position?.report?.unavailableReason ?? null,
    },
    probabilities: stage3Position?.probabilities ?? {},
    explain: {
      topDrivers: stage3Position?.explain?.topDrivers ?? [],
      warnings: stage3Position?.explain?.warnings ?? [],
    },
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const outputPath =
    args.output ??
    path.join(ROOT_DIR, "data", "feedback", "snapshots", `${args.date}.json`);

  const [portfolio, stage3, stage4] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), {
      accounts: [],
    }),
    readJson(path.join(stateDir, "stage3-quant-scores.json"), null),
    readJson(path.join(stateDir, "stage4-execution-plan.json"), null),
  ]);

  if (!stage3 || !stage4) {
    throw new Error("stage3 또는 stage4 산출물이 없어 feedback snapshot을 만들 수 없습니다.");
  }

  const normalizedPortfolio = enrichPortfolioWithSecurityCodes(portfolio);
  const portfolioPositions = buildPortfolioPositionMap(normalizedPortfolio);
  const stage3Positions = stage3.positions ?? {};

  const positions = Object.entries(stage3Positions).map(([positionKey, item]) =>
    normalizePosition(positionKey, item, portfolioPositions.get(positionKey) ?? null),
  );

  const payload = {
    ...buildRunMetadata(args, {
      date: stage4.date ?? stage3.date ?? args.date,
      runDate: stage4.runDate ?? stage3.runDate ?? args.runDate,
      effectiveMarketDate:
        stage4.effectiveMarketDate ??
        stage3.effectiveMarketDate ??
        args.effectiveMarketDate,
    }),
    portfolioDate: normalizedPortfolio?.date ?? null,
    portfolioUpdatedAt: normalizedPortfolio?.updatedAt ?? null,
    regime: stage4.regime ?? stage3.regime ?? null,
    portfolioScore: stage4.portfolioScore ?? stage3.portfolio?.totalScore ?? null,
    coverage: stage3.coverage ?? null,
    configUsed: stage3.configUsed ?? null,
    positions,
    accountPlans: (stage4.accountPlans ?? []).map(normalizeStage4Plan),
  };

  await writeJson(outputPath, payload);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`feedback snapshot 생성 실패: ${error.message}`);
  process.exit(1);
});
