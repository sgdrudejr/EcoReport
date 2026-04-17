#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

function parseArgs(argv) {
  const args = parseDateArgs(argv);
  args.codes = [];
  args.marketFile = path.join(ROOT_DIR, "data", "intraday", "latest-market-lite.json");
  args.alertsFile = path.join(ROOT_DIR, "data", "intraday", args.date, "emergency-alerts.json");
  args.output = path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage3-intraday-updates.json");

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--codes" && argv[index + 1]) {
      args.codes = argv[index + 1]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
    } else if (token === "--market-file" && argv[index + 1]) {
      args.marketFile = argv[index + 1];
      index += 1;
    } else if (token === "--alerts-file" && argv[index + 1]) {
      args.alertsFile = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function signalFromScore(actionScore) {
  return actionScore >= 72 ? "BUY" : actionScore >= 58 ? "HOLD" : actionScore >= 42 ? "WATCH" : "REDUCE";
}

function unique(items) {
  return [...new Set((items ?? []).filter(Boolean))];
}

function deriveTargetCodes(args, stage3, intradayMarket, alerts) {
  if (args.codes.length > 0) {
    return unique(args.codes);
  }

  const fired = (alerts?.triggers ?? []).filter((item) => item.triggered);
  const alertTriggeredCodes = fired
    .filter((item) => typeof item.detail === "string")
    .flatMap((item) => {
      const match = item.detail.match(/\(([0-9A-Z.^-]+)\)/g) ?? [];
      return match.map((token) => token.replace(/[()]/g, ""));
    });

  const severeMoves = Object.values(intradayMarket?.holdings ?? {})
    .filter((item) => item?.inPortfolio && typeof item?.changePct === "number" && Math.abs(item.changePct) >= 0.03)
    .sort((left, right) => Math.abs(right.changePct) - Math.abs(left.changePct))
    .map((item) => item.code)
    .slice(0, 4);

  return unique([
    ...alertTriggeredCodes,
    ...severeMoves,
    ...Object.values(stage3?.positions ?? {})
      .filter((item) => typeof item?.actionScore === "number" && item.actionScore <= 42)
      .map((item) => item.code)
      .slice(0, 2),
  ]);
}

function computeMacroAdjustment(macros, position) {
  const isRiskAsset = !/금|KOFR|현금/i.test(`${position?.name ?? ""} ${position?.category ?? ""}`);
  if (!isRiskAsset) return { adjustment: 0, reasons: [] };

  const reasons = [];
  let adjustment = 0;

  const vix = macros?.VIX?.close ?? null;
  const vixChangePct = macros?.VIX?.changePct ?? null;
  const usdkrw = macros?.USDKRW?.close ?? null;
  const usdkrwChangePct = macros?.USDKRW?.changePct ?? null;

  if (typeof vix === "number" && vix >= 30) {
    const penalty = clamp((vix - 30) * 0.45, 0, 8);
    adjustment -= penalty;
    reasons.push(`VIX ${vix.toFixed(2)} 고변동성`);
  }
  if (typeof vixChangePct === "number" && vixChangePct >= 0.08) {
    const penalty = clamp(vixChangePct * 40, 0, 6);
    adjustment -= penalty;
    reasons.push(`VIX 급등 ${(vixChangePct * 100).toFixed(2)}%`);
  }
  if (typeof usdkrw === "number" && usdkrw >= 1500) {
    adjustment -= 3;
    reasons.push(`USD/KRW ${usdkrw.toFixed(2)} 고환율`);
  }
  if (typeof usdkrwChangePct === "number" && usdkrwChangePct >= 0.01) {
    const penalty = clamp(usdkrwChangePct * 180, 0, 5);
    adjustment -= penalty;
    reasons.push(`원달러 급변 ${(usdkrwChangePct * 100).toFixed(2)}%`);
  }

  return {
    adjustment: Math.round(adjustment),
    reasons,
  };
}

function computePositionAdjustment(position, marketEntry, macros) {
  if (!marketEntry) {
    return {
      baseScore: position.actionScore ?? 50,
      intradayActionScore: position.actionScore ?? 50,
      intradaySignal: position.signal ?? "HOLD",
      delta: 0,
      triggers: ["intraday market data unavailable"],
    };
  }

  const baseScore = position.actionScore ?? 50;
  const move = marketEntry.changePct ?? 0;
  const clusterPenalty = position?.scoreDecomposition?.clusterPenalty ?? 0;
  const executionConfidence = position?.scoreDecomposition?.executionConfidence ?? 50;
  const priceAdjustment = Math.round(
    clamp(move * 260, -18, 12) +
      (move <= -0.05 ? -7 : 0) +
      (move >= 0.03 ? 4 : 0) -
      clamp(clusterPenalty * 0.4, 0, 5) +
      clamp((executionConfidence - 50) * 0.05, -2, 3),
  );
  const macroAdjustment = computeMacroAdjustment(macros, position);
  const delta = priceAdjustment + macroAdjustment.adjustment;
  const intradayActionScore = Math.round(clamp(baseScore + delta, 0, 100));

  return {
    baseScore,
    intradayActionScore,
    intradaySignal: signalFromScore(intradayActionScore),
    delta,
    marketChangePct: move,
    triggers: [
      `price move ${(move * 100).toFixed(2)}%`,
      ...macroAdjustment.reasons,
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [stage3, intradayMarket, alerts] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage3-quant-scores.json"), null),
    readJson(args.marketFile, null),
    readJson(args.alertsFile, { triggers: [] }),
  ]);

  if (!stage3) {
    throw new Error(`stage3-quant-scores.json 이 없습니다: ${args.date}`);
  }

  const targetCodes = deriveTargetCodes(args, stage3, intradayMarket, alerts);
  const updates = [];

  for (const [positionKey, position] of Object.entries(stage3.positions ?? {})) {
    if (!targetCodes.includes(position.code)) continue;

    const marketEntry = intradayMarket?.holdings?.[position.code] ?? null;
    const intraday = computePositionAdjustment(position, marketEntry, intradayMarket?.macros ?? {});
    updates.push({
      positionKey,
      code: position.code,
      name: position.name,
      accountKey: position.accountKey,
      accountLabel: position.accountLabel,
      baseActionScore: intraday.baseScore,
      intradayActionScore: intraday.intradayActionScore,
      intradaySignal: intraday.intradaySignal,
      delta: intraday.delta,
      marketChangePct: intraday.marketChangePct ?? null,
      triggers: intraday.triggers,
      collectedAt: intradayMarket?.collectedAt ?? null,
    });
  }

  const payload = {
    ...buildRunMetadata(args),
    source: "stage3-intraday-overlay",
    sourceFiles: {
      stage3: path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage3-quant-scores.json"),
      market: args.marketFile,
      alerts: args.alertsFile,
    },
    updatedAt: new Date().toISOString(),
    targetCodes,
    updates,
  };

  await writeJson(args.output, payload);
  console.log(args.output);
}

main().catch((error) => {
  console.error(`[recompute-stage3-intraday] 실패: ${error.message}`);
  process.exit(1);
});
