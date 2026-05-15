#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  buildRunMetadata,
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
  freshnessDays,
  makeEvidence,
  normalizedOutputPath,
  numericSignalDirection,
  uniqueFlags,
} from "./lib/normalized-observations.js";

function strengthFromRankedEtf(item, topN) {
  const rank = Number(item?.rank);
  const rankStrength = Number.isFinite(rank) && topN > 0 ? 1 - (rank - 1) / topN : 0.5;
  const moveStrength = clamp(Math.abs(Number(item?.changePct ?? 0)) / 12, 0, 1);
  const navStrength = clamp(Math.abs(Number(item?.navChangePct ?? 0)) / 12, 0, 1);
  return clamp(rankStrength * 0.5 + Math.max(moveStrength, navStrength) * 0.5, 0.22, 1);
}

function themesForEtf(item) {
  const security = SECURITIES_BY_CODE[compactText(item?.code)] ?? {};
  return [
    ...(item?.sectors ?? []),
    ...(item?.keywords ?? []),
    ...(security.keywords?.theme ?? []),
    ...(security.keywords?.topic_hints ?? []),
  ]
    .map(compactText)
    .filter(Boolean)
    .slice(0, 10);
}

function buildEtfObservation(bundleId, args, item, snapshot) {
  const code = compactText(item?.code);
  const changePct = Number(item?.changePct ?? item?.periodChangePct ?? item?.navChangePct);
  const navGap =
    Number.isFinite(Number(item?.price)) && Number.isFinite(Number(item?.nav)) && Number(item.nav) !== 0
      ? (Number(item.price) - Number(item.nav)) / Number(item.nav)
      : null;
  return {
    observationId: buildObservationId(bundleId, ["security", code || item?.name, item?.rank ?? "rank"]),
    entityType: "security",
    entityId: buildEntityId("security", code || item?.name),
    entityName: item?.name ?? code,
    accountKey: null,
    securityCode: code || null,
    category: "ETF",
    themes: themesForEtf(item),
    direction: numericSignalDirection(changePct, "neutral"),
    strength: strengthFromRankedEtf(item, Number(snapshot?.topN ?? snapshot?.etfs?.length ?? 80)),
    confidence: 0.72,
    freshnessDays: freshnessDays(args.date, snapshot?.date),
    horizon: "1w",
    qualityFlags: uniqueFlags([
      "derived",
      Math.abs(navGap ?? 0) > 0.02 ? "nav_gap" : null,
      themesForEtf(item).length === 0 ? "low_theme_mapping" : null,
    ]),
    evidence: [
      makeEvidence("table_row", {
        title: `KIS ETF rank ${item?.rank ?? "-"}`,
        text: item?.rationale ?? `${item?.name ?? code} change=${item?.changePct ?? "N/A"}%, nav=${item?.nav ?? "N/A"}`,
        value: item?.changePct ?? null,
        refPath: `data/external/kis-etf/${args.date}/etf-ranking.json`,
      }),
      makeEvidence("metric", {
        title: "nav_gap",
        value: navGap == null ? null : Number(navGap.toFixed(6)),
        text: item?.nav == null ? null : `price=${item.price ?? "N/A"} / nav=${item.nav}`,
        refPath: `data/external/kis-etf/${args.date}/etf-ranking.json`,
      }),
    ],
    derivedFrom: [`kis_etf:${code || item?.name}`],
    metadata: {
      rank: item?.rank ?? null,
      price: item?.price ?? null,
      changePct: item?.changePct ?? null,
      nav: item?.nav ?? null,
      navChangePct: item?.navChangePct ?? null,
      volume: item?.volume ?? null,
      collectionMode: snapshot?.collectionMode ?? null,
      capturedAt: snapshot?.capturedAt ?? null,
    },
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const inputPath = path.join(ROOT_DIR, "data", "external", "kis-etf", args.date, "etf-ranking.json");
  const outputPath = normalizedOutputPath(args.date, "kis_etf", args.output);
  const snapshot = await readJson(inputPath, null);

  if (!snapshot?.etfs?.length) {
    throw new Error(`KIS ETF ranking이 없습니다: ${inputPath}`);
  }

  const bundleId = `normalized:kis_etf:${args.date}`;
  const observations = snapshot.etfs
    .slice(0, Number(snapshot.topN ?? 80))
    .map((item) => buildEtfObservation(bundleId, args, item, snapshot));

  const bundle = createBundle({
    date: args.date,
    bundleId,
    source: "kis_etf",
    sourceType: "etf_market_ranking",
    generatedAt: metadata.generatedAt,
    runId: metadata.runId,
    qualitySummary: {
      status: observations.length > 0 ? "ok" : "warn",
      flags: uniqueFlags([
        observations.some((item) => item.qualityFlags.includes("nav_gap")) ? "nav_gap" : null,
        observations.some((item) => item.qualityFlags.includes("low_theme_mapping")) ? "low_theme_mapping" : null,
      ]),
    },
    observations,
  });

  await writeJson(outputPath, bundle);
  console.log(`Wrote ${observations.length} normalized KIS ETF observations to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
