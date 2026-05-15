#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  buildPortfolioMaps,
  buildRunMetadata,
  categoryForHolding,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";
import {
  buildEntityId,
  buildObservationId,
  clamp,
  compactText,
  createBundle,
  makeEvidence,
  normalizeAccountKey,
  normalizedOutputPath,
  uniqueFlags,
} from "./lib/normalized-observations.js";

function directionFromTechnical(item) {
  const signal = compactText(item?.signal).toUpperCase();
  const biasSide = compactText(item?.technical_analysis?.execution_bias?.side);
  if (signal === "BUY" || biasSide === "buy_side") return "positive";
  if (signal === "REDUCE" || signal === "SELL" || biasSide === "sell_side") return "negative";
  return "neutral";
}

function strengthFromTechnical(item) {
  const score = Number(item?.score);
  if (Number.isFinite(score)) {
    return clamp(Math.abs(score - 50) / 50, 0.25, 1);
  }
  const change = Math.abs(Number(item?.change_pct ?? 0));
  return clamp(change / 0.08, 0.2, 1);
}

function confidenceFromTechnical(item) {
  const historyPoints = Number(item?.history_points ?? 0);
  if (historyPoints >= 240) return 0.76;
  if (historyPoints >= 120) return 0.68;
  if (historyPoints >= 40) return 0.56;
  return 0.46;
}

function accountTargetsForCode(code, item, portfolioMaps) {
  const holding = portfolioMaps.holdingsByCode.get(code);
  if (holding?.accountKey) return [holding.accountKey];

  const accountKeys = Array.isArray(item?.account_keys)
    ? item.account_keys.map((value) => normalizeAccountKey(value)).filter(Boolean)
    : [];
  if (accountKeys.length > 0) return [...new Set(accountKeys)];

  const account = normalizeAccountKey(item?.account);
  if (account && account !== "전계좌") return [account];

  return [null];
}

function themesForTechnical(code, item, accountKey) {
  const security = SECURITIES_BY_CODE[code] ?? {};
  const category = accountKey ? categoryForHolding(accountKey, code) : categoryForHolding(null, code);
  return [
    category,
    ...(security.keywords?.theme ?? []),
    ...(security.keywords?.topic_hints ?? []),
    item?.bucket,
    item?.type,
  ]
    .map(compactText)
    .filter(Boolean)
    .slice(0, 8);
}

function buildTechnicalObservation(bundleId, args, item, accountKey, portfolioMaps) {
  const code = compactText(item?.code);
  const holding = portfolioMaps.holdingsByCode.get(code);
  const direction = directionFromTechnical(item);
  const executionBias = item?.technical_analysis?.execution_bias;
  const indicatorSummaries = Object.values(item?.technical_analysis?.indicators ?? {})
    .map((indicator) => indicator?.summary)
    .filter(Boolean)
    .slice(0, 3);

  return {
    observationId: buildObservationId(bundleId, ["security", code, accountKey ?? "generic"]),
    entityType: "security",
    entityId: buildEntityId("security", code),
    entityName: item?.name ?? holding?.name ?? code,
    accountKey,
    securityCode: code,
    category: accountKey ? categoryForHolding(accountKey, code) : categoryForHolding(null, code),
    themes: themesForTechnical(code, item, accountKey),
    direction,
    strength: strengthFromTechnical(item),
    confidence: confidenceFromTechnical(item),
    freshnessDays: 0,
    horizon: "1w",
    qualityFlags: uniqueFlags([
      "derived",
      Number(item?.history_points ?? 0) < 120 ? "short_history" : null,
      direction === "neutral" ? "mixed_signal" : null,
    ]),
    evidence: [
      makeEvidence("metric", {
        title: "technical_score",
        value: item?.score ?? null,
        text: item?.signal_reason ?? null,
        refPath: `data/technical/${args.date}.json`,
      }),
      makeEvidence("metric", {
        title: "rsi",
        value: item?.rsi ?? null,
        text: item?.technical_analysis?.indicators?.rsi?.summary ?? null,
        refPath: `data/technical/${args.date}.json`,
      }),
      makeEvidence("derived_note", {
        title: executionBias?.label ?? "execution_bias",
        text: [executionBias?.summary, ...indicatorSummaries].filter(Boolean).join(" / "),
        refPath: `data/technical/${args.date}.json`,
      }),
    ],
    derivedFrom: [`technical:${code}`],
    metadata: {
      signal: item?.signal ?? null,
      score: item?.score ?? null,
      rsi: item?.rsi ?? null,
      changePct: item?.change_pct ?? null,
      historyPoints: item?.history_points ?? null,
      alerts: item?.alerts ?? [],
      sourceBucket: item?.bucket ?? null,
      inPortfolio: Boolean(holding ?? item?.in_portfolio),
    },
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const inputPath = path.join(ROOT_DIR, "data", "technical", `${args.date}.json`);
  const outputPath = normalizedOutputPath(args.date, "technical", args.output);
  const technical = await readJson(inputPath, null);

  if (!technical?.scores || Object.keys(technical.scores).length === 0) {
    throw new Error(`technical 스냅샷이 없습니다: ${inputPath}`);
  }

  const [portfolio, watchlist] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(ROOT_DIR, "config", "watchlist.json"), {}),
  ]);
  const portfolioMaps = buildPortfolioMaps(portfolio, watchlist);
  const bundleId = `normalized:technical:${args.date}`;
  const observations = [];

  for (const item of Object.values(technical.scores ?? {})) {
    const code = compactText(item?.code);
    if (!code) continue;
    for (const accountKey of accountTargetsForCode(code, item, portfolioMaps)) {
      observations.push(buildTechnicalObservation(bundleId, args, item, accountKey, portfolioMaps));
    }
  }

  const coverageWarnCount =
    (technical.coverage?.fallback?.length ?? 0) + (technical.coverage?.failed?.length ?? 0);
  const bundle = createBundle({
    date: args.date,
    bundleId,
    source: "technical",
    sourceType: "technical_signal",
    generatedAt: metadata.generatedAt,
    runId: metadata.runId,
    qualitySummary: {
      status: coverageWarnCount > 0 ? "warn" : "ok",
      flags: uniqueFlags([
        coverageWarnCount > 0 ? "coverage_gap" : null,
        observations.some((item) => item.qualityFlags.includes("short_history")) ? "short_history" : null,
      ]),
    },
    observations,
  });

  await writeJson(outputPath, bundle);
  console.log(`Wrote ${observations.length} normalized Technical observations to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
