#!/usr/bin/env node

import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_DIR, clamp } from "./lib/pipeline-utils.js";

const STRATEGY_PATH = path.join(ROOT_DIR, "config", "strategy.json");
const FEEDBACK_DIR = path.join(ROOT_DIR, "data", "feedback", "analysis");
const HISTORY_PATH = path.join(ROOT_DIR, "data", "feedback", "weight-history.jsonl");

const FACTOR_KEYS = ["momentum", "research", "income", "macroFit"];
const MIN_SAMPLE_SIZE = 20;
const MIN_FACTOR_COUNT = 10;
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.5;
const MAX_DELTA = 0.05;

function parseArgs(argv) {
  const args = {
    date: null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function roundWeight(value) {
  return Number(value.toFixed(4));
}

function loadLatestFeedbackAnalysis(dateHint) {
  if (!fsSync.existsSync(FEEDBACK_DIR)) return { fileName: null, data: null };

  const candidateFiles = fsSync
    .readdirSync(FEEDBACK_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse();
  const preferredFiles = dateHint ? [`${dateHint}-feedback.json`, `${dateHint}.json`] : [];
  const filesToTry = [...new Set([...preferredFiles, ...candidateFiles])];

  for (const fileName of filesToTry) {
    try {
      const raw = fsSync.readFileSync(path.join(FEEDBACK_DIR, fileName), "utf8");
      return { fileName, data: JSON.parse(raw) };
    } catch {
      // try next file
    }
  }

  return { fileName: null, data: null };
}

async function loadStrategy() {
  const raw = await fs.readFile(STRATEGY_PATH, "utf8");
  return JSON.parse(raw);
}

function factorDelta(correlation) {
  if (typeof correlation !== "number" || Number.isNaN(correlation)) return 0;
  if (correlation >= 0.3) return 0.05;
  if (correlation >= 0.15) return 0.025;
  if (correlation <= -0.25) return -0.05;
  if (correlation <= -0.15) return -0.025;
  return 0;
}

function chooseResidualKey({ diff, weights, directDeltas, feedbackAnalysis }) {
  const eligible = FACTOR_KEYS.filter((factor) =>
    diff > 0 ? weights[factor] < MAX_WEIGHT - 0.0001 : weights[factor] > MIN_WEIGHT + 0.0001,
  );
  if (eligible.length === 0) return null;

  const neutralCandidates = eligible.filter((factor) => Math.abs(directDeltas[factor] ?? 0) < 0.0001);
  const positiveCandidates = eligible.filter((factor) => (directDeltas[factor] ?? 0) > 0);

  if (diff > 0 && neutralCandidates.length > 0) {
    return [...neutralCandidates].sort((left, right) => weights[left] - weights[right])[0];
  }
  if (diff < 0 && neutralCandidates.length > 0) {
    return [...neutralCandidates].sort((left, right) => weights[right] - weights[left])[0];
  }
  if (diff > 0 && positiveCandidates.length > 0) {
    return [...positiveCandidates].sort((left, right) => {
      const leftCorr = feedbackAnalysis?.factorCorrelations?.[left]?.vs_ret5d ?? -999;
      const rightCorr = feedbackAnalysis?.factorCorrelations?.[right]?.vs_ret5d ?? -999;
      return rightCorr - leftCorr;
    })[0];
  }

  return [...eligible].sort((left, right) =>
    diff > 0 ? weights[left] - weights[right] : weights[right] - weights[left],
  )[0];
}

function rebalanceWeights(weights, directDeltas, feedbackAnalysis) {
  const result = Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, clamp(value, MIN_WEIGHT, MAX_WEIGHT)]),
  );

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const total = Object.values(result).reduce((sum, value) => sum + value, 0);
    const diff = roundWeight(1 - total);
    if (Math.abs(diff) < 0.0001) break;

    const residualKey = chooseResidualKey({
      diff,
      weights: result,
      directDeltas,
      feedbackAnalysis,
    });
    if (!residualKey) break;

    result[residualKey] = clamp(result[residualKey] + diff, MIN_WEIGHT, MAX_WEIGHT);
  }

  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [key, roundWeight(value)]),
  );
}

function buildReasons(feedbackAnalysis, directWeights, nextWeights, previousWeights) {
  return FACTOR_KEYS.flatMap((factor) => {
    const correlation = feedbackAnalysis?.factorCorrelations?.[factor]?.vs_ret5d ?? null;
    const count = feedbackAnalysis?.factorCorrelations?.[factor]?.count ?? 0;
    const directDiff = roundWeight((directWeights[factor] ?? 0) - (previousWeights[factor] ?? 0));
    const finalDiff = roundWeight((nextWeights[factor] ?? 0) - (directWeights[factor] ?? 0));

    if (count < MIN_FACTOR_COUNT) {
      return [`${factor} count=${count} < ${MIN_FACTOR_COUNT} -> 스킵`];
    }

    const reasons = [];
    if (Math.abs(directDiff) >= 0.0001) {
      reasons.push(
        `${factor} r=${typeof correlation === "number" ? correlation.toFixed(2) : "n/a"} -> ${directDiff > 0 ? "+" : ""}${(directDiff * 100).toFixed(1)}%p`,
      );
    }
    if (Math.abs(finalDiff) >= 0.0001) {
      reasons.push(`${factor} 재분배 -> ${finalDiff > 0 ? "+" : ""}${(finalDiff * 100).toFixed(1)}%p`);
    }
    return reasons;
  });
}

async function appendHistory(entry) {
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.appendFile(HISTORY_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = await loadStrategy();
  const feedback = loadLatestFeedbackAnalysis(args.date);
  const feedbackAnalysis = feedback.data;

  if (!feedbackAnalysis) {
    console.log("[auto-tune] feedback analysis 파일이 없어 스킵합니다.");
    return;
  }

  if ((feedbackAnalysis.sampleSize ?? 0) < MIN_SAMPLE_SIZE) {
    console.log(
      `[auto-tune] sampleSize ${(feedbackAnalysis.sampleSize ?? 0)} < ${MIN_SAMPLE_SIZE} 이라 스킵합니다.`,
    );
    return;
  }

  const currentWeights = {
    momentum: strategy?.scoring?.factorModel?.weights?.momentum ?? 0.35,
    research: strategy?.scoring?.factorModel?.weights?.research ?? 0.3,
    income: strategy?.scoring?.factorModel?.weights?.income ?? 0.15,
    macroFit: strategy?.scoring?.factorModel?.weights?.macroFit ?? 0.2,
  };

  const adjustedWeights = { ...currentWeights };
  const directDeltas = Object.fromEntries(FACTOR_KEYS.map((factor) => [factor, 0]));
  const rawReasons = [];

  for (const factor of FACTOR_KEYS) {
    const count = feedbackAnalysis?.factorCorrelations?.[factor]?.count ?? 0;
    if (count < MIN_FACTOR_COUNT) {
      rawReasons.push(`${factor} count=${count} < ${MIN_FACTOR_COUNT} -> 스킵`);
      continue;
    }

    const correlation = feedbackAnalysis?.factorCorrelations?.[factor]?.vs_ret5d ?? null;
    const proposedDelta = clamp(factorDelta(correlation), -MAX_DELTA, MAX_DELTA);

    if (Math.abs(proposedDelta) < 0.0001) {
      continue;
    }

    directDeltas[factor] = proposedDelta;
    adjustedWeights[factor] = clamp(
      currentWeights[factor] + proposedDelta,
      MIN_WEIGHT,
      MAX_WEIGHT,
    );
  }

  const normalizedWeights = rebalanceWeights(adjustedWeights, directDeltas, feedbackAnalysis);
  const reasons = [
    ...buildReasons(feedbackAnalysis, adjustedWeights, normalizedWeights, currentWeights),
    ...rawReasons,
  ];

  const hasMeaningfulChange = FACTOR_KEYS.some(
    (factor) => Math.abs((normalizedWeights[factor] ?? 0) - (currentWeights[factor] ?? 0)) >= 0.0001,
  );

  if (!hasMeaningfulChange) {
    console.log("[auto-tune] 유의미한 가중치 변경이 없어 스킵합니다.");
    return;
  }

  const historyEntry = {
    date: args.date ?? new Date().toISOString().slice(0, 10),
    analysisFile: feedback.fileName,
    dryRun: args.dryRun,
    previous: currentWeights,
    updated: normalizedWeights,
    reasons,
  };

  if (args.dryRun) {
    console.log(JSON.stringify(historyEntry, null, 2));
    return;
  }

  strategy.scoring = strategy.scoring ?? {};
  strategy.scoring.factorModel = strategy.scoring.factorModel ?? {};
  strategy.scoring.factorModel.weights = {
    ...strategy.scoring.factorModel.weights,
    ...normalizedWeights,
  };

  await fs.writeFile(STRATEGY_PATH, `${JSON.stringify(strategy, null, 2)}\n`, "utf8");
  await appendHistory(historyEntry);

  console.log(
    `[auto-tune] strategy.json 업데이트 완료 (${feedback.fileName ?? "feedback analysis"})`,
  );
}

main().catch((error) => {
  console.error(`[auto-tune] 실패: ${error.message}`);
  process.exit(1);
});
