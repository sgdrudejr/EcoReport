#!/usr/bin/env node
// auto-tune-challenger 결과를 feedback snapshot 기준으로 가볍게 검증합니다.

import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_DIR, readJson, writeJson } from "./lib/pipeline-utils.js";

const SNAPSHOT_DIR = path.join(ROOT_DIR, "data", "feedback", "snapshots");
const CHALLENGER_WEIGHTS_PATH = path.join(ROOT_DIR, "data", "feedback", "challenger-weights.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "feedback", "challenger-backtest.json");
const FACTOR_KEYS = ["momentum", "research", "income", "macroFit"];

function parseArgs(argv) {
  const args = { date: null, minSamples: 24 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--min-samples" && argv[index + 1]) {
      args.minSamples = Number(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function scoreFromWeights(factors, weights) {
  if (!factors || !weights) return null;
  let total = 0;
  let used = 0;
  for (const key of FACTOR_KEYS) {
    const factor = factors[key];
    const weight = weights[key];
    if (typeof factor !== "number" || typeof weight !== "number") continue;
    total += factor * weight;
    used += Math.abs(weight);
  }
  if (used <= 0) return null;
  return total / used;
}

function signalFromScore(score) {
  if (score == null) return "UNKNOWN";
  if (score >= 0.55) return "BUY";
  if (score >= 0.15) return "WATCH";
  if (score <= -0.45) return "REDUCE";
  return "HOLD";
}

function signalHit(signal, position) {
  const actionScore = position?.actionScore;
  if (typeof actionScore !== "number") return null;
  if (signal === "BUY") return actionScore >= 58;
  if (signal === "WATCH") return actionScore >= 48;
  if (signal === "HOLD") return actionScore >= 42 && actionScore < 66;
  if (signal === "REDUCE") return actionScore <= 45;
  return null;
}

async function listSnapshots(dateHint) {
  let files = [];
  try {
    files = await fs.readdir(SNAPSHOT_DIR);
  } catch {
    return [];
  }
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .filter((file) => !dateHint || file.replace(/\.json$/, "") <= dateHint)
    .sort();
}

function hitRate(values) {
  const usable = values.filter((value) => value != null);
  if (usable.length === 0) return null;
  return usable.filter(Boolean).length / usable.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = await readJson(path.join(ROOT_DIR, "config", "strategy.json"), {});
  const challenger = await readJson(CHALLENGER_WEIGHTS_PATH, null);
  const baselineWeights = strategy?.scoring?.factorModel?.weights ?? {};
  const challengerWeights = challenger?.challengerWeights ?? baselineWeights;
  const files = await listSnapshots(args.date);

  const baselineHits = [];
  const challengerHits = [];
  let positionCount = 0;

  for (const file of files) {
    const snapshot = await readJson(path.join(SNAPSHOT_DIR, file), null);
    for (const position of snapshot?.positions ?? []) {
      const baselineSignal = signalFromScore(scoreFromWeights(position.factors, baselineWeights));
      const challengerSignal = signalFromScore(scoreFromWeights(position.factors, challengerWeights));
      const baselineHit = signalHit(baselineSignal, position);
      const challengerHit = signalHit(challengerSignal, position);
      if (baselineHit != null || challengerHit != null) positionCount += 1;
      baselineHits.push(baselineHit);
      challengerHits.push(challengerHit);
    }
  }

  const baselineHitRate = hitRate(baselineHits);
  const challengerHitRate = hitRate(challengerHits);
  const improvement =
    baselineHitRate == null || challengerHitRate == null
      ? null
      : Number((challengerHitRate - baselineHitRate).toFixed(4));
  const promoted =
    typeof improvement === "number" &&
    positionCount >= args.minSamples &&
    improvement >= 0.03;

  const payload = {
    generatedAt: new Date().toISOString(),
    analysisDate: args.date,
    lookbackSnapshots: files.length,
    positionCount,
    minSamples: args.minSamples,
    baselineHitRate,
    challengerHitRate,
    improvement,
    promoted,
    challengerWeights,
    status: positionCount >= args.minSamples ? "evaluated" : "insufficient_samples",
  };

  await writeJson(OUTPUT_PATH, payload);
  console.log(OUTPUT_PATH);
}

main().catch((error) => {
  console.error(`[backtest-challenger] 실패: ${error.message}`);
  process.exit(1);
});
