#!/usr/bin/env node

import path from "node:path";

import {
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";
import {
  normalizedOutputPath,
  normalizeAccountKey,
} from "./lib/normalized-observations.js";

function featureOutputPath(date, filename, rawPath = null) {
  if (rawPath) {
    return path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
  }
  return path.join(process.cwd(), "data", "features", date, filename);
}

function scoreSign(direction) {
  if (direction === "positive") return 1;
  if (direction === "negative") return -1;
  if (direction === "mixed") return 0;
  return 0;
}

function emptySupportVector() {
  return {
    reports: 0,
    stockeasy: 0,
    marketvoice: 0,
    technical: 0,
    kis_etf: 0,
    news: 0,
    macro: 0,
    llm: 0,
  };
}

function accumulateSupport(target, source, value) {
  if (!(source in target)) return;
  target[source] = Math.max(target[source], value);
}

function netScoreFromObservations(items) {
  if (!items.length) return 0;
  const total = items.reduce(
    (sum, item) => sum + scoreSign(item.direction) * (item.strength ?? 0) * (item.confidence ?? 0),
    0,
  );
  return Number((total / items.length).toFixed(4));
}

function sourceConflict(items) {
  const seen = new Set(items.map((item) => item.direction).filter(Boolean));
  return seen.has("positive") && seen.has("negative");
}

function sourceCount(items) {
  return new Set(items.map((item) => item.bundleSource).filter(Boolean)).size;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const bundles = (await Promise.all([
    readJson(normalizedOutputPath(args.date, "reports"), null),
    readJson(normalizedOutputPath(args.date, "stockeasy"), null),
    readJson(normalizedOutputPath(args.date, "marketvoice"), null),
    readJson(normalizedOutputPath(args.date, "technical"), null),
    readJson(normalizedOutputPath(args.date, "kis_etf"), null),
    readJson(normalizedOutputPath(args.date, "news"), null),
  ])).filter(Boolean);
  const strategy = await readJson(path.join(process.cwd(), "config", "strategy.json"), { accounts: {} });

  if (bundles.length === 0) {
    throw new Error("normalized bundles가 없어 decision features를 만들 수 없습니다.");
  }

  const all = bundles.flatMap((bundle) =>
    (bundle.observations ?? []).map((observation) => ({ ...observation, bundleSource: bundle.source })),
  );

  const accountKeys = Object.keys(strategy.accounts ?? {}).map((key) => normalizeAccountKey(key) ?? key);
  const accountFeatures = accountKeys.map((accountKey) => {
    const items = all.filter((item) => normalizeAccountKey(item.accountKey) === accountKey);
    const support = emptySupportVector();
    for (const item of items) {
      accumulateSupport(
        support,
        item.bundleSource,
        Math.abs(scoreSign(item.direction) * (item.strength ?? 0) * (item.confidence ?? 0)),
      );
    }
    return {
      accountKey,
      netScore: netScoreFromObservations(items),
      support,
      topSupportingThemes: [...new Set(items.flatMap((item) => item.themes ?? []).filter(Boolean))].slice(0, 5),
      topRisks: [...new Set(items.flatMap((item) => item.metadata?.riskTags ?? []).filter(Boolean))].slice(0, 5),
    };
  });

  const securityGroups = new Map();
  for (const item of all.filter((item) => item.entityType === "security" && item.securityCode)) {
    const list = securityGroups.get(item.securityCode) ?? [];
    list.push(item);
    securityGroups.set(item.securityCode, list);
  }
  const securityFeatures = [...securityGroups.entries()].map(([code, items]) => {
    const support = emptySupportVector();
    for (const item of items) {
      accumulateSupport(
        support,
        item.bundleSource,
        Math.abs(scoreSign(item.direction) * (item.strength ?? 0) * (item.confidence ?? 0)),
      );
    }
    return {
      code,
      name: items[0]?.entityName ?? code,
      netScore: netScoreFromObservations(items),
      support,
      sourceCount: sourceCount(items),
      candidateAccounts: [...new Set(items.map((item) => normalizeAccountKey(item.accountKey)).filter(Boolean))],
    };
  });

  const themeGroups = new Map();
  for (const item of all) {
    for (const theme of item.themes ?? []) {
      const list = themeGroups.get(theme) ?? [];
      list.push(item);
      themeGroups.set(theme, list);
    }
    if (item.entityType === "theme" && item.entityName) {
      const list = themeGroups.get(item.entityName) ?? [];
      list.push(item);
      themeGroups.set(item.entityName, list);
    }
  }
  const themeFeatures = [...themeGroups.entries()].map(([theme, items]) => {
    const support = emptySupportVector();
    for (const item of items) {
      accumulateSupport(
        support,
        item.bundleSource,
        Math.abs(scoreSign(item.direction) * (item.strength ?? 0) * (item.confidence ?? 0)),
      );
    }
    return {
      theme,
      netScore: netScoreFromObservations(items),
      support,
      sourceCount: sourceCount(items),
    };
  });

  const sourceConflicts = [];
  for (const [code, items] of securityGroups.entries()) {
    if (sourceConflict(items)) {
      sourceConflicts.push({
        entityType: "security",
        entityId: code,
        directions: [...new Set(items.map((item) => item.direction))],
        sources: [...new Set(items.map((item) => item.bundleSource))],
      });
    }
  }
  for (const [theme, items] of themeGroups.entries()) {
    if (sourceConflict(items)) {
      sourceConflicts.push({
        entityType: "theme",
        entityId: theme,
        directions: [...new Set(items.map((item) => item.direction))],
        sources: [...new Set(items.map((item) => item.bundleSource))],
      });
    }
  }

  const output = {
    date: args.date,
    generatedAt: metadata.generatedAt,
    accountFeatures,
    securityFeatures,
    themeFeatures,
    consensus: {
      topAlignedThemes: themeFeatures
        .filter((item) => item.netScore > 0 && item.sourceCount >= 2)
        .sort((a, b) => b.netScore - a.netScore)
        .slice(0, 10)
        .map((item) => item.theme),
      topAlignedSecurities: securityFeatures
        .filter((item) => item.netScore > 0 && item.sourceCount >= 2)
        .sort((a, b) => b.netScore - a.netScore)
        .slice(0, 10)
        .map((item) => item.code),
    },
    divergence: {
      sourceConflicts,
      policyConflicts: [],
    },
    quality: {
      overallStatus: bundles.some((bundle) => bundle.qualitySummary?.status === "warn") ? "warn" : "ok",
      flags: [...new Set(bundles.flatMap((bundle) => bundle.qualitySummary?.flags ?? []))],
    },
  };

  await writeJson(featureOutputPath(args.date, "decision-features.json", args.output), output);
  await writeJson(featureOutputPath(args.date, "account-feature-matrix.json"), {
    date: args.date,
    generatedAt: metadata.generatedAt,
    accountFeatures,
  });
  await writeJson(featureOutputPath(args.date, "security-feature-matrix.json"), {
    date: args.date,
    generatedAt: metadata.generatedAt,
    securityFeatures,
  });
  await writeJson(featureOutputPath(args.date, "theme-feature-matrix.json"), {
    date: args.date,
    generatedAt: metadata.generatedAt,
    themeFeatures,
  });
  await writeJson(featureOutputPath(args.date, "cross-source-consensus.json"), {
    date: args.date,
    generatedAt: metadata.generatedAt,
    consensus: output.consensus,
  });
  await writeJson(featureOutputPath(args.date, "source-divergence.json"), {
    date: args.date,
    generatedAt: metadata.generatedAt,
    divergence: output.divergence,
  });
  await writeJson(featureOutputPath(args.date, "quality-matrix.json"), {
    date: args.date,
    generatedAt: metadata.generatedAt,
    quality: output.quality,
  });

  console.log(
    `Wrote decision features for ${accountFeatures.length} accounts, ${securityFeatures.length} securities, ${themeFeatures.length} themes`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
