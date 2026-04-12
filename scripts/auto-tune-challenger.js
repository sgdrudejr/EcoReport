#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_DIR, clamp } from "./lib/pipeline-utils.js";

const STRATEGY_PATH = path.join(ROOT_DIR, "config", "strategy.json");
const FEEDBACK_DIR = path.join(ROOT_DIR, "data", "feedback", "analysis");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "feedback", "challenger-weights.json");
const FACTOR_KEYS = ["momentum", "research", "income", "macroFit"];

function parseArgs(argv) {
  const args = {
    date: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadLatestFeedbackAnalysis(dateHint) {
  const files = (await fs.readdir(FEEDBACK_DIR))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse();
  const preferred = dateHint ? [`${dateHint}-feedback.json`, `${dateHint}.json`] : [];

  for (const fileName of [...new Set([...preferred, ...files])]) {
    try {
      return {
        fileName,
        data: await loadJson(path.join(FEEDBACK_DIR, fileName)),
      };
    } catch {
      // try next
    }
  }

  return { fileName: null, data: null };
}

function factorDelta(correlation) {
  if (typeof correlation !== "number" || Number.isNaN(correlation)) return 0;
  if (correlation >= 0.2) return 0.04;
  if (correlation >= 0.1) return 0.02;
  if (correlation <= -0.2) return -0.04;
  if (correlation <= -0.1) return -0.02;
  return 0;
}

function normalizeWeights(weights) {
  const bounded = Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, clamp(value, 0.05, 0.5)]),
  );
  const total = Object.values(bounded).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(
    Object.entries(bounded).map(([key, value]) => [key, Number((value / total).toFixed(4))]),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = await loadJson(STRATEGY_PATH);
  const feedback = await loadLatestFeedbackAnalysis(args.date);
  if (!feedback.data) {
    console.log("[challenger] feedback analysis 없음");
    return;
  }

  const baseWeights = {
    momentum: strategy?.scoring?.factorModel?.weights?.momentum ?? 0.35,
    research: strategy?.scoring?.factorModel?.weights?.research ?? 0.3,
    income: strategy?.scoring?.factorModel?.weights?.income ?? 0.15,
    macroFit: strategy?.scoring?.factorModel?.weights?.macroFit ?? 0.2,
  };
  const candidateWeights = { ...baseWeights };
  const reasons = [];

  for (const factor of FACTOR_KEYS) {
    const correlation = feedback.data?.factorCorrelations?.[factor]?.vs_ret5d ?? null;
    const delta = factorDelta(correlation);
    if (Math.abs(delta) < 0.0001) continue;
    candidateWeights[factor] += delta;
    reasons.push(
      `${factor}: corr=${typeof correlation === "number" ? correlation.toFixed(4) : "n/a"} -> ${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%p`,
    );
  }

  const normalizedWeights = normalizeWeights(candidateWeights);
  const payload = {
    generatedAt: new Date().toISOString(),
    analysisFile: feedback.fileName,
    baselineWeights: baseWeights,
    challengerWeights: normalizedWeights,
    reasons,
    status: "shadow",
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(OUTPUT_PATH);
}

main().catch((error) => {
  console.error(`[challenger] 실패: ${error.message}`);
  process.exit(1);
});
