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
  createBundle,
  freshnessDays,
  makeEvidence,
  normalizedOutputPath,
  toConfidence,
  toStrength,
  uniqueFlags,
} from "./lib/normalized-observations.js";

function evidenceFromExtract(extract) {
  const evidence = [];
  if (extract.key_thesis) {
    evidence.push(
      makeEvidence("snippet", {
        title: extract.title,
        text: extract.key_thesis,
        refPath: extract.text_path ?? null,
      }),
    );
  }
  for (const point of (extract.key_points ?? []).slice(0, 2)) {
    evidence.push(
      makeEvidence("snippet", {
        title: "key_point",
        text: point,
        refPath: extract.text_path ?? null,
      }),
    );
  }
  for (const item of (extract.key_numbers ?? []).slice(0, 2)) {
    evidence.push(
      makeEvidence("metric", {
        title: item?.label ?? "metric",
        text: item?.why_it_matters ?? null,
        value: item?.value ?? null,
        refPath: extract.text_path ?? null,
      }),
    );
  }
  return evidence;
}

function directionFromExtract(extract) {
  const direct = extract.primary_claim?.direction;
  if (direct) return direct;
  const score = Number(extract.sentiment_score);
  if (Number.isFinite(score)) {
    if (score >= 0.2) return "positive";
    if (score <= -0.2) return "negative";
  }
  return "neutral";
}

function strengthFromExtract(extract) {
  const candidateStrength = extract.primary_claim?.strength ?? extract.claim_candidates?.[0]?.strength;
  return toStrength(candidateStrength, 0.52);
}

function qualityFlagsFromExtract(extract, topLevelQuality) {
  const flags = ["derived"];
  if ((extract.quality?.weakClaimCount ?? 0) > 0 || extract.primary_claim?.classification === "weak_claim") {
    flags.push("manual_review_needed");
  }
  if ((topLevelQuality?.weakClaimRatio ?? 0) >= 0.6) {
    flags.push("low_coverage");
  }
  return uniqueFlags(flags);
}

function buildReportObservation(bundleId, date, extract, topLevelQuality) {
  const direction = directionFromExtract(extract);
  const evidence = evidenceFromExtract(extract);
  return {
    observationId: buildObservationId(bundleId, ["report", extract.id]),
    entityType: "report",
    entityId: buildEntityId("report", extract.id),
    entityName: extract.title ?? extract.id,
    accountKey: null,
    securityCode: extract.ticker ?? null,
    category: extract.category ?? null,
    themes: extract.themes ?? [],
    direction,
    strength: strengthFromExtract(extract),
    confidence: toConfidence(
      extract.confidence ?? extract.primary_claim?.classification_confidence,
      0.6,
    ),
    freshnessDays: freshnessDays(date, extract.date),
    horizon: extract.claim_candidates?.[0]?.horizon ?? null,
    qualityFlags: qualityFlagsFromExtract(extract, topLevelQuality),
    evidence,
    derivedFrom: [extract.id],
    metadata: {
      broker: extract.broker ?? null,
      source: extract.source ?? null,
      category: extract.category ?? null,
      reportType: extract.report_type ?? null,
      sector: extract.sector ?? null,
      textPath: extract.text_path ?? null,
      relatedAccounts: extract.related_accounts ?? [],
    },
  };
}

function buildThemeObservations(bundleId, date, extract, topLevelQuality) {
  const direction = directionFromExtract(extract);
  const confidence = toConfidence(
    extract.confidence ?? extract.primary_claim?.classification_confidence,
    0.58,
  );
  const strength = Math.max(0.3, strengthFromExtract(extract) - 0.06);
  const evidence = evidenceFromExtract(extract).slice(0, 2);

  return (extract.themes ?? []).map((theme) => ({
    observationId: buildObservationId(bundleId, ["theme", extract.id, theme]),
    entityType: "theme",
    entityId: buildEntityId("theme", theme),
    entityName: theme,
    accountKey: null,
    securityCode: null,
    category: extract.category ?? null,
    themes: [theme],
    direction,
    strength,
    confidence,
    freshnessDays: freshnessDays(date, extract.date),
    horizon: extract.claim_candidates?.[0]?.horizon ?? null,
    qualityFlags: qualityFlagsFromExtract(extract, topLevelQuality),
    evidence,
    derivedFrom: [extract.id],
    metadata: {
      reportId: extract.id,
      reportTitle: extract.title ?? null,
      broker: extract.broker ?? null,
      reportType: extract.report_type ?? null,
    },
  }));
}

function buildSectorObservation(bundleId, date, extract, topLevelQuality) {
  if (!extract.sector) return null;
  return {
    observationId: buildObservationId(bundleId, ["sector", extract.id, extract.sector]),
    entityType: "sector",
    entityId: buildEntityId("sector", extract.sector),
    entityName: extract.sector,
    accountKey: null,
    securityCode: null,
    category: extract.category ?? null,
    themes: extract.themes ?? [],
    direction: directionFromExtract(extract),
    strength: Math.max(0.28, strengthFromExtract(extract) - 0.1),
    confidence: toConfidence(
      extract.confidence ?? extract.primary_claim?.classification_confidence,
      0.56,
    ),
    freshnessDays: freshnessDays(date, extract.date),
    horizon: extract.claim_candidates?.[0]?.horizon ?? null,
    qualityFlags: qualityFlagsFromExtract(extract, topLevelQuality),
    evidence: evidenceFromExtract(extract).slice(0, 2),
    derivedFrom: [extract.id],
    metadata: {
      reportId: extract.id,
      reportTitle: extract.title ?? null,
      reportType: extract.report_type ?? null,
      broker: extract.broker ?? null,
    },
  };
}

function buildHoldingObservations(bundleId, date, extract, topLevelQuality) {
  const evidence = evidenceFromExtract(extract).slice(0, 2);
  return (extract.portfolio_impacts_candidate ?? [])
    .filter((item) => item.target_type === "holding" && item.target_code)
    .map((item) => ({
      observationId: buildObservationId(bundleId, ["security", extract.id, item.target_code]),
      entityType: "security",
      entityId: buildEntityId("security", item.target_code),
      entityName: item.target_name ?? item.target_code,
      accountKey: item.account_key ?? null,
      securityCode: item.target_code,
      category: null,
      themes: extract.themes ?? [],
      direction: item.direction ?? directionFromExtract(extract),
      strength: toStrength(item.strength, strengthFromExtract(extract)),
      confidence: toConfidence(extract.confidence, 0.58),
      freshnessDays: freshnessDays(date, extract.date),
      horizon: item.horizon ?? null,
      qualityFlags: qualityFlagsFromExtract(extract, topLevelQuality),
      evidence,
      derivedFrom: [extract.id],
      metadata: {
        reportId: extract.id,
        reportTitle: extract.title ?? null,
        broker: extract.broker ?? null,
        actionHint: item.action_hint ?? null,
        reason: item.reason ?? null,
      },
    }));
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const inputPath = path.join(
    path.dirname(normalizedOutputPath(args.date, "reports")),
    "..",
    "..",
    "analysis-state",
    args.date,
    "stage1-report-extracts-v2.json",
  );
  const outputPath = normalizedOutputPath(args.date, "reports", args.output);
  const stage1 = await readJson(inputPath, null);

  if (!stage1?.extracts?.length) {
    throw new Error(`Stage 1 extracts가 없습니다: ${inputPath}`);
  }

  const bundleId = `normalized:reports:${args.date}`;
  const observations = [];

  for (const extract of stage1.extracts) {
    observations.push(buildReportObservation(bundleId, args.date, extract, stage1.quality));
    const sectorObservation = buildSectorObservation(bundleId, args.date, extract, stage1.quality);
    if (sectorObservation) observations.push(sectorObservation);
    observations.push(...buildThemeObservations(bundleId, args.date, extract, stage1.quality));
    observations.push(...buildHoldingObservations(bundleId, args.date, extract, stage1.quality));
  }

  const bundle = createBundle({
    date: args.date,
    bundleId,
    source: "reports",
    sourceType: "research",
    generatedAt: metadata.generatedAt,
    runId: metadata.runId,
    qualitySummary: {
      status: (stage1.quality?.weakClaimRatio ?? 0) >= 0.6 ? "warn" : "ok",
      flags: uniqueFlags([
        (stage1.quality?.weakClaimRatio ?? 0) >= 0.6 ? "low_coverage" : null,
      ]),
    },
    observations,
  });

  await writeJson(outputPath, bundle);
  console.log(`Wrote ${observations.length} normalized report observations to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
