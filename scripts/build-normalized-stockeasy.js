#!/usr/bin/env node

import path from "node:path";

import {
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";
import {
  buildEntityId,
  buildObservationId,
  clamp,
  createBundle,
  freshnessDays,
  makeEvidence,
  normalizedOutputPath,
  numericSignalDirection,
  numericSignalStrength,
  toConfidence,
  toDirection,
  uniqueFlags,
} from "./lib/normalized-observations.js";

function buildSignalObservation(bundleId, date, snapshot) {
  const signal = snapshot.marketAnalysis?.marketSignal ?? snapshot.marketSignal ?? {};
  const shortSignal = String(signal.shortSignal ?? "").trim();
  const longSignal = String(signal.longSignal ?? "").trim();
  const directions = [toDirection(shortSignal, "neutral"), toDirection(longSignal, "neutral")];
  const direction =
    directions.includes("negative") ? "negative" : directions.includes("positive") ? "positive" : "neutral";

  return {
    observationId: buildObservationId(bundleId, ["macro_event", "market_signal"]),
    entityType: "macro_event",
    entityId: buildEntityId("macro_event", "stockeasy_market_signal"),
    entityName: "StockEasy Market Signal",
    accountKey: null,
    securityCode: null,
    category: null,
    themes: [],
    direction,
    strength: shortSignal === longSignal ? 0.78 : 0.6,
    confidence: 0.74,
    freshnessDays: freshnessDays(date, snapshot.sourceTradingDate ?? snapshot.captureDate),
    horizon: "1w",
    qualityFlags: ["derived"],
    evidence: [
      makeEvidence("derived_note", {
        title: "short_long_signal",
        text: `short=${shortSignal || "N/A"}, long=${longSignal || "N/A"}`,
        refPath: "data/external/stockeasy/DATE/snapshot.json",
      }),
      makeEvidence("snippet", {
        title: signal.updatedAtLabel ?? "updated_at",
        text: signal.updatedAtLabel ?? null,
      }),
    ],
    derivedFrom: ["stockeasy.marketAnalysis.marketSignal"],
    metadata: {
      shortSignal,
      longSignal,
      updatedAtLabel: signal.updatedAtLabel ?? null,
    },
  };
}

function buildIndexObservations(bundleId, date, snapshot) {
  const signal = snapshot.marketAnalysis?.marketSignal ?? {};
  return ["kospi", "kosdaq"]
    .map((key) => {
      const item = signal[key];
      if (!item) return null;
      const strength = clamp(Number(item.recommendedExposure ?? 0) / 100, 0, 1);
      return {
        observationId: buildObservationId(bundleId, ["sector", key]),
        entityType: "sector",
        entityId: buildEntityId("sector", item.market ?? key),
        entityName: item.market ?? key.toUpperCase(),
        accountKey: null,
        securityCode: null,
        category: null,
        themes: [],
        direction: strength >= 0.6 ? "positive" : strength <= 0.3 ? "negative" : "neutral",
        strength: strength || 0.5,
        confidence: 0.7,
        freshnessDays: freshnessDays(date, snapshot.sourceTradingDate ?? snapshot.captureDate),
        horizon: "1w",
        qualityFlags: ["derived"],
        evidence: [
          makeEvidence("derived_note", {
            title: item.statusLabel ?? item.market ?? key,
            text: `recommendedExposure=${item.recommendedExposure ?? "N/A"} / distributionDays=${item.distributionDays ?? "N/A"}`,
          }),
        ],
        derivedFrom: [`stockeasy.marketSignal.${key}`],
        metadata: item,
      };
    })
    .filter(Boolean);
}

function buildSectorRows(bundleId, date, rows, subtype, snapshot) {
  return (rows ?? []).map((row) => {
    const signalValue = Number(row.signal);
    return {
      observationId: buildObservationId(bundleId, ["sector", subtype, row.sector]),
      entityType: "sector",
      entityId: buildEntityId("sector", row.sector),
      entityName: row.sector,
      accountKey: null,
      securityCode: null,
      category: null,
      themes: [],
      direction: numericSignalDirection(signalValue, "neutral"),
      strength: numericSignalStrength(signalValue, 10, 0.48),
      confidence: subtype === "leading" ? 0.76 : 0.72,
      freshnessDays: freshnessDays(date, snapshot.sourceTradingDate ?? snapshot.captureDate),
      horizon: subtype === "leading" ? "1m" : "1w",
      qualityFlags: ["derived"],
      evidence: [
        makeEvidence("table_row", {
          title: `${subtype}_sector`,
          text: `${row.position ?? row.holdDays ?? ""} / leaders: ${row.leaderLabel ?? ""}`.trim(),
          value: row.signal ?? null,
        }),
      ],
      derivedFrom: [`stockeasy.marketAnalysis.${subtype}`],
      metadata: row,
    };
  });
}

function buildThemeObservations(bundleId, date, snapshot) {
  return (snapshot.marketThemes?.themes ?? []).map((theme) => {
    const leaderRs = (theme.leaders ?? [])
      .map((item) => Number(item.rs))
      .filter(Number.isFinite);
    const avgLeaderRs =
      leaderRs.length > 0 ? leaderRs.reduce((sum, value) => sum + value, 0) / leaderRs.length : null;
    return {
      observationId: buildObservationId(bundleId, ["theme", theme.name]),
      entityType: "theme",
      entityId: buildEntityId("theme", theme.name),
      entityName: theme.name,
      accountKey: null,
      securityCode: null,
      category: null,
      themes: [theme.name],
      direction: "positive",
      strength: clamp((avgLeaderRs ?? 60) / 100, 0, 1),
      confidence: 0.74,
      freshnessDays: freshnessDays(date, snapshot.sourceTradingDate ?? snapshot.captureDate),
      horizon: "1w",
      qualityFlags: ["derived"],
      evidence: [
        makeEvidence("table_row", {
          title: `theme_rank_${theme.rank ?? ""}`.trim(),
          text: (theme.leaders ?? [])
            .slice(0, 3)
            .map((item) => `${item.name}(${item.rs ?? "N/A"})`)
            .join(", "),
        }),
      ],
      derivedFrom: ["stockeasy.marketThemes.themes"],
      metadata: theme,
    };
  });
}

function buildSecurityRows(bundleId, date, rows, subtype, snapshot, confidence = 0.72) {
  return (rows ?? []).map((row) => ({
    observationId: buildObservationId(bundleId, ["security", subtype, row.code ?? row.name]),
    entityType: "security",
    entityId: buildEntityId("security", row.code ?? row.name),
    entityName: row.name ?? row.code,
    accountKey: null,
    securityCode: row.code ?? null,
    category: row.sector ?? null,
    themes: [row.sector].filter(Boolean),
    direction: numericSignalDirection(Number(row.changePct), "positive"),
    strength: clamp(Number(row.rs ?? row.score ?? 50) / 100, 0, 1),
    confidence,
    freshnessDays: freshnessDays(date, snapshot.sourceTradingDate ?? snapshot.captureDate),
    horizon: subtype === "top100" ? "1m" : "1w",
    qualityFlags: ["derived"],
    evidence: [
      makeEvidence("table_row", {
        title: subtype,
        text: `${row.sector ?? ""} / price=${row.price ?? "N/A"} / rs=${row.rs ?? row.score ?? "N/A"}`,
        value: row.changePct ?? null,
      }),
    ],
    derivedFrom: [`stockeasy.stockAnalysis.${subtype}`],
    metadata: row,
  }));
}

function buildReportRows(bundleId, date, rows, section, snapshot) {
  return (rows ?? []).map((row, index) => {
    const entityType = section === "industry" ? "theme" : "security";
    const rawId = section === "industry" ? row.sector ?? `${section}_${index + 1}` : row.name ?? `${section}_${index + 1}`;
    const direction = row.opinion && row.opinion !== "-" ? "positive" : "neutral";
    return {
      observationId: buildObservationId(bundleId, ["report", section, row.date, rawId]),
      entityType,
      entityId: buildEntityId(entityType, rawId),
      entityName: rawId,
      accountKey: null,
      securityCode: section === "company" ? row.code ?? null : null,
      category: section === "industry" ? row.sector ?? null : null,
      themes: [row.sector].filter(Boolean),
      direction,
      strength:
        section === "company"
          ? clamp(Math.abs(Number(row.gapPct ?? 0)) / 40, 0.25, 1)
          : 0.62,
      confidence: section === "company" ? 0.72 : 0.68,
      freshnessDays: 0,
      horizon: "1m",
      qualityFlags: uniqueFlags([
        "derived",
        snapshot.stockAnalysis?.reports?.industry?.detailMode === "table_summary_only" && section === "industry"
          ? "partial"
          : null,
      ]),
      evidence: [
        makeEvidence("snippet", {
          title: row.title ?? null,
          text: row.summary ?? null,
        }),
      ],
      derivedFrom: [`stockeasy.stockAnalysis.reports.${section}`],
      metadata: row,
    };
  });
}

function buildStrategyObservations(bundleId, date, snapshot) {
  const summary = snapshot.strategyRoom?.summary ?? {};
  const strategyRows = (snapshot.strategyRoom?.strategies ?? []).map((strategy) => ({
    observationId: buildObservationId(bundleId, ["strategy_rule", strategy.key]),
    entityType: "strategy_rule",
    entityId: buildEntityId("strategy_rule", strategy.key),
    entityName: strategy.name ?? strategy.key,
    accountKey: null,
    securityCode: null,
    category: null,
    themes: [],
    direction: strategy.bias === "cooling" ? "negative" : strategy.bias === "selective" ? "neutral" : "positive",
    strength: clamp(Math.abs(Number(strategy.weekDeltaPct ?? 0)) / 60, 0.3, 1),
    confidence: 0.74,
    freshnessDays: freshnessDays(date, snapshot.sourceTradingDate ?? snapshot.captureDate),
    horizon: "1w",
    qualityFlags: ["derived"],
    evidence: [
      makeEvidence("derived_note", {
        title: strategy.style ?? null,
        text: strategy.description ?? null,
        value: strategy.weekDeltaPct ?? null,
      }),
    ],
    derivedFrom: ["stockeasy.strategyRoom.strategies"],
    metadata: strategy,
  }));

  strategyRows.push({
    observationId: buildObservationId(bundleId, ["macro_event", "strategy_room_summary"]),
    entityType: "macro_event",
    entityId: buildEntityId("macro_event", "stockeasy_strategy_room_summary"),
    entityName: "StockEasy Strategy Room Summary",
    accountKey: null,
    securityCode: null,
    category: null,
    themes: [],
    direction: toDirection(summary.overallBias, "neutral"),
    strength: clamp((Number(summary.riskOnCount ?? 0) + 1) / 4, 0.25, 1),
    confidence: 0.72,
    freshnessDays: freshnessDays(date, snapshot.sourceTradingDate ?? snapshot.captureDate),
    horizon: "1w",
    qualityFlags: ["derived"],
    evidence: [
      makeEvidence("derived_note", {
        title: summary.strongestName ?? null,
        text: `overallBias=${summary.overallBias ?? "N/A"} / strongestWeekDeltaPct=${summary.strongestWeekDeltaPct ?? "N/A"}`,
      }),
    ],
    derivedFrom: ["stockeasy.strategyRoom.summary"],
    metadata: summary,
  });

  return strategyRows;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const inputPath = path.join(
    path.dirname(normalizedOutputPath(args.date, "stockeasy")),
    "..",
    "..",
    "external",
    "stockeasy",
    args.date,
    "snapshot.json",
  );
  const outputPath = normalizedOutputPath(args.date, "stockeasy", args.output);
  const snapshot = await readJson(inputPath, null);

  if (!snapshot) {
    throw new Error(`StockEasy snapshot이 없습니다: ${inputPath}`);
  }

  const bundleId = `normalized:stockeasy:${args.date}`;
  const observations = [
    buildSignalObservation(bundleId, args.date, snapshot),
    ...buildIndexObservations(bundleId, args.date, snapshot),
    ...buildSectorRows(bundleId, args.date, snapshot.marketAnalysis?.sectors?.rows, "sectors", snapshot),
    ...buildSectorRows(bundleId, args.date, snapshot.marketAnalysis?.leadingSectors?.rows, "leading", snapshot),
    ...buildThemeObservations(bundleId, args.date, snapshot),
    ...buildSecurityRows(bundleId, args.date, snapshot.stockAnalysis?.stockLeaders, "leaders", snapshot),
    ...buildSecurityRows(bundleId, args.date, snapshot.stockAnalysis?.promisingSectorTop100, "top100", snapshot, 0.76),
    ...buildSecurityRows(bundleId, args.date, snapshot.stockAnalysis?.sectorRs?.map((row) => ({ ...row, code: null, name: row.sector })), "sector_rs", snapshot, 0.68),
    ...buildReportRows(bundleId, args.date, snapshot.stockAnalysis?.reports?.companyOverview?.rows, "company", snapshot),
    ...buildReportRows(bundleId, args.date, snapshot.stockAnalysis?.reports?.industry?.rows, "industry", snapshot),
    ...buildStrategyObservations(bundleId, args.date, snapshot),
  ].filter(Boolean);

  const stale = freshnessDays(args.date, snapshot.sourceTradingDate ?? snapshot.captureDate) > 1;
  const bundle = createBundle({
    date: args.date,
    bundleId,
    source: "stockeasy",
    sourceType: "market_capture",
    generatedAt: metadata.generatedAt,
    runId: metadata.runId,
    qualitySummary: {
      status: stale ? "warn" : "ok",
      flags: uniqueFlags([
        stale ? "stale" : null,
        snapshot.stockAnalysis?.reports?.industry?.detailMode === "table_summary_only" ? "partial" : null,
      ]),
    },
    observations,
  });

  await writeJson(outputPath, bundle);
  console.log(`Wrote ${observations.length} normalized StockEasy observations to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
