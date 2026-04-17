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
  normalizeAccountKey,
  normalizedOutputPath,
  toConfidence,
  toStrength,
  uniqueFlags,
} from "./lib/normalized-observations.js";

function buildTopicObservation(bundleId, date, topic) {
  const topicEntityId = buildEntityId("macro_event", topic.numericId ?? topic.title);
  return {
    observationId: buildObservationId(bundleId, ["topic", topic.numericId ?? topic.topicId]),
    entityType: "macro_event",
    entityId: topicEntityId,
    entityName: topic.title ?? topic.numericId,
    accountKey: null,
    securityCode: null,
    category: null,
    themes: topic.signalLabels ?? [],
    direction: topic.signalDirection ?? "neutral",
    strength: Math.max(0.35, Math.min(1, Number(topic.relevanceScore ?? 50) / 100)),
    confidence: topic.quoteCount > 0 ? 0.72 : 0.58,
    freshnessDays: freshnessDays(date, String(topic.displayUpdatedAt ?? "").slice(0, 10)),
    horizon: "1w",
    qualityFlags: uniqueFlags([
      "derived",
      topic.quoteCount === 0 ? "low_coverage" : null,
    ]),
    evidence: [
      makeEvidence("snippet", {
        title: topic.title ?? null,
        text: topic.summary ?? null,
        url: topic.topicUrl ?? null,
      }),
      makeEvidence("derived_note", {
        title: "portfolio_linkage",
        text: topic.portfolioLinkage ?? null,
      }),
    ],
    derivedFrom: [topic.topicId ?? topic.numericId ?? topic.title],
    metadata: {
      signalLabels: topic.signalLabels ?? [],
      mainSource: topic.mainSource ?? null,
      deepResearchQuestion: topic.deepResearchQuestion ?? null,
      topicEntityId,
    },
  };
}

function resolveTargetEntity(target) {
  if (target?.type === "holding") {
    return {
      entityType: "security",
      entityId: buildEntityId("security", target.code ?? target.name),
      entityName: target.name ?? target.code,
      securityCode: target.code ?? null,
      accountKey: normalizeAccountKey(target.accountKey),
      category: null,
    };
  }
  if (target?.type === "account") {
    return {
      entityType: "account",
      entityId: buildEntityId("account", normalizeAccountKey(target.accountKey) ?? target.name),
      entityName: target.name ?? normalizeAccountKey(target.accountKey),
      securityCode: null,
      accountKey: normalizeAccountKey(target.accountKey),
      category: null,
    };
  }
  if (target?.type === "category") {
    return {
      entityType: "category",
      entityId: buildEntityId("category", `${normalizeAccountKey(target.accountKey) ?? "GENERIC"}_${target.name}`),
      entityName: target.name ?? "category",
      securityCode: null,
      accountKey: normalizeAccountKey(target.accountKey),
      category: target.name ?? null,
    };
  }
  return {
    entityType: "theme",
    entityId: buildEntityId("theme", target?.name ?? "unknown"),
    entityName: target?.name ?? "unknown",
    securityCode: null,
    accountKey: normalizeAccountKey(target?.accountKey),
    category: target?.name ?? null,
  };
}

function buildImpactObservations(bundleId, date, topic) {
  return (topic.impactEntries ?? []).map((impact, index) => {
    const target = resolveTargetEntity(impact.target);
    const topicEntityId = buildEntityId("macro_event", topic.numericId ?? topic.title);
    return {
      observationId: buildObservationId(bundleId, [
        "impact",
        topic.numericId ?? topic.topicId,
        target.entityType,
        target.entityName,
        index + 1,
      ]),
      entityType: target.entityType,
      entityId: target.entityId,
      entityName: target.entityName,
      accountKey: target.accountKey,
      securityCode: target.securityCode,
      category: target.category,
      themes: topic.signalLabels ?? [],
      direction: impact.direction ?? topic.signalDirection ?? "neutral",
      strength: toStrength(impact.strength, 0.56),
      confidence: toConfidence(impact.confidence, 0.58),
      freshnessDays: freshnessDays(date, String(topic.displayUpdatedAt ?? "").slice(0, 10)),
      horizon: impact.horizon ?? "1w",
      qualityFlags: uniqueFlags([
        "derived",
        topic.quoteCount === 0 ? "low_coverage" : null,
      ]),
      evidence: [
        ...((impact.evidence?.snippets ?? []).slice(0, 2).map((snippet) =>
          makeEvidence("snippet", {
            title: topic.title ?? null,
            text: snippet,
            url: topic.topicUrl ?? null,
          }),
        )),
        makeEvidence("derived_note", {
          title: "risk_tags",
          text: (impact.riskTags ?? []).join(", ") || null,
        }),
      ],
      derivedFrom: [topic.topicId ?? topic.numericId ?? topic.title],
      metadata: {
        topicEntityId,
        topicTitle: topic.title ?? null,
        channels: impact.channels ?? [],
        riskTags: impact.riskTags ?? [],
        regimeAssumptions: impact.regimeAssumptions ?? [],
        deepResearchQuestion: topic.deepResearchQuestion ?? null,
      },
    };
  });
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const inputPath = path.join(
    path.dirname(normalizedOutputPath(args.date, "marketvoice")),
    "..",
    "..",
    "analysis-state",
    args.date,
    "marketvoice-linked.json",
  );
  const outputPath = normalizedOutputPath(args.date, "marketvoice", args.output);
  const marketvoice = await readJson(inputPath, null);

  if (!marketvoice?.topics?.length) {
    throw new Error(`MarketVoice linked data가 없습니다: ${inputPath}`);
  }

  const bundleId = `normalized:marketvoice:${args.date}`;
  const observations = [];
  for (const topic of marketvoice.topics) {
    observations.push(buildTopicObservation(bundleId, args.date, topic));
    observations.push(...buildImpactObservations(bundleId, args.date, topic));
  }

  const bundle = createBundle({
    date: args.date,
    bundleId,
    source: "marketvoice",
    sourceType: "event_feed",
    generatedAt: metadata.generatedAt,
    runId: metadata.runId,
    qualitySummary: {
      status: (marketvoice.summary?.highPriorityTopics ?? 0) > 0 ? "ok" : "warn",
      flags: uniqueFlags([
        marketvoice.topics.some((topic) => topic.quoteCount === 0) ? "low_coverage" : null,
      ]),
    },
    observations,
  });

  await writeJson(outputPath, bundle);
  console.log(`Wrote ${observations.length} normalized MarketVoice observations to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
