#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { ROOT_DIR, clamp } from "./lib/pipeline-utils.js";

const SNAPSHOT_DIR = path.join(ROOT_DIR, "data", "feedback", "snapshots");
const CHALLENGER_PATH = path.join(ROOT_DIR, "data", "feedback", "challenger-weights.json");
const STRATEGY_PATH = path.join(ROOT_DIR, "config", "strategy.json");
const REPORT_PATH = path.join(ROOT_DIR, "data", "feedback", "challenger-backtest.json");
const FACTOR_KEYS = ["momentum", "research", "income", "macroFit"];

function parseArgs(argv) {
  const args = {
    date: null,
    lookback: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--lookback" && argv[index + 1]) {
      args.lookback = Number(argv[index + 1]) || 20;
      index += 1;
    }
  }

  return args;
}

function bestReturn(item) {
  return item.ret_5d ?? item.ret_3d ?? item.ret_1d ?? null;
}

function fetchReturns(requests) {
  if (requests.length === 0) return [];
  try {
    const result = execFileSync(
      path.join(ROOT_DIR, ".venv", "bin", "python"),
      [path.join(ROOT_DIR, "scripts", "fetch-forward-returns.py")],
      { input: JSON.stringify(requests), encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(result);
  } catch (error) {
    console.error(`[challenger-backtest] 수익률 조회 실패: ${error.message}`);
    return [];
  }
}

function computeWeightedZ(factors, weights) {
  return FACTOR_KEYS.reduce((sum, factor) => sum + (Number(factors?.[factor] ?? 0) * (weights[factor] ?? 0)), 0);
}

function hitRate(items, key) {
  const actionable = items.filter((item) => item[key] >= 68 && bestReturn(item) != null);
  const fallback = items.filter((item) => item[key] >= 58 && bestReturn(item) != null);
  const sample = actionable.length >= 2 ? actionable : fallback;
  if (sample.length === 0) return null;
  const hits = sample.filter((item) => bestReturn(item) > 0).length;
  return hits / sample.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fsSync.existsSync(CHALLENGER_PATH)) {
    console.log("[challenger-backtest] challenger weights 없음");
    return;
  }

  const challenger = JSON.parse(await fs.readFile(CHALLENGER_PATH, "utf8"));
  const strategy = JSON.parse(await fs.readFile(STRATEGY_PATH, "utf8"));
  const baselineWeights = challenger.baselineWeights ?? {
    momentum: strategy?.scoring?.factorModel?.weights?.momentum ?? 0.35,
    research: strategy?.scoring?.factorModel?.weights?.research ?? 0.3,
    income: strategy?.scoring?.factorModel?.weights?.income ?? 0.15,
    macroFit: strategy?.scoring?.factorModel?.weights?.macroFit ?? 0.2,
  };
  const challengerWeights = challenger.challengerWeights ?? challenger.weights ?? null;

  if (!challengerWeights) {
    throw new Error("challengerWeights가 없습니다.");
  }

  const files = (await fs.readdir(SNAPSHOT_DIR))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .slice(-args.lookback);
  const snapshots = await Promise.all(
    files.map(async (file) => JSON.parse(await fs.readFile(path.join(SNAPSHOT_DIR, file), "utf8"))),
  );

  const requests = [];
  const seen = new Set();
  for (const snapshot of snapshots) {
    for (const position of snapshot.positions ?? []) {
      const key = `${position.code}:${snapshot.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        requests.push({ code: position.code, date: snapshot.date });
      }
    }
  }
  const returns = fetchReturns(requests);
  const returnMap = new Map(returns.map((item) => [`${item.code}:${item.date}`, item]));

  const scored = [];
  for (const snapshot of snapshots) {
    for (const position of snapshot.positions ?? []) {
      const returnItem = returnMap.get(`${position.code}:${snapshot.date}`) ?? {};
      const baselineWeightedZ = computeWeightedZ(position.factors, baselineWeights);
      const challengerWeightedZ = computeWeightedZ(position.factors, challengerWeights);
      const challengerScore = Math.round(
        clamp(
          (position.actionScore ?? 50) + (challengerWeightedZ - baselineWeightedZ) * 12,
          0,
          100,
        ),
      );
      scored.push({
        ...position,
        date: snapshot.date,
        ret_1d: returnItem.ret_1d ?? null,
        ret_3d: returnItem.ret_3d ?? null,
        ret_5d: returnItem.ret_5d ?? null,
        baselineScore: position.actionScore ?? 50,
        challengerScore,
      });
    }
  }

  const baselineHitRate = hitRate(scored, "baselineScore");
  const challengerHitRate = hitRate(scored, "challengerScore");
  const improvement =
    baselineHitRate != null && challengerHitRate != null
      ? Number((challengerHitRate - baselineHitRate).toFixed(4))
      : null;
  const shouldPromote = improvement != null && improvement >= 0.02;

  if (shouldPromote) {
    strategy.scoring = strategy.scoring ?? {};
    strategy.scoring.factorModel = strategy.scoring.factorModel ?? {};
    strategy.scoring.factorModel.weights = {
      ...strategy.scoring.factorModel.weights,
      ...challengerWeights,
    };
    await fs.writeFile(STRATEGY_PATH, `${JSON.stringify(strategy, null, 2)}\n`, "utf8");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackSnapshots: files.length,
    baselineHitRate,
    challengerHitRate,
    improvement,
    promoted: shouldPromote,
    challengerWeights,
  };
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(REPORT_PATH);
}

main().catch((error) => {
  console.error(`[challenger-backtest] 실패: ${error.message}`);
  process.exit(1);
});
