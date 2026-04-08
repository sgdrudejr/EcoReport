#!/usr/bin/env node
// 외부 의존성 실패 시 현재 거래일에 필요한 최소 산출물을 복구합니다.

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  createGeneratedAt,
  parseDateArgs,
  readJson,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { isTradingDay, previousDate } from "./lib/trading-calendar.js";

function parseArgs(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    mode: "all",
    reason: "",
    sourceDate: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mode" && argv[index + 1]) {
      args.mode = argv[index + 1];
      index += 1;
    } else if (token === "--reason" && argv[index + 1]) {
      args.reason = argv[index + 1];
      index += 1;
    } else if (token === "--source-date" && argv[index + 1]) {
      args.sourceDate = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonIfMissing(filePath, payload) {
  if (await fileExists(filePath)) {
    return false;
  }
  await writeJson(filePath, payload);
  return true;
}

async function writeTextIfMissing(filePath, payload) {
  if (await fileExists(filePath)) {
    return false;
  }
  await writeText(filePath, payload);
  return true;
}

async function resolveLatestAvailableDate(date, filePathBuilder, explicitSourceDate = "", lookbackDays = 14) {
  if (explicitSourceDate) {
    const explicitPath = filePathBuilder(explicitSourceDate);
    if (await fileExists(explicitPath)) {
      return explicitSourceDate;
    }
  }

  let cursor = previousDate(date);
  for (let index = 0; index < lookbackDays; index += 1) {
    if (!isTradingDay(cursor)) {
      cursor = previousDate(cursor);
      continue;
    }

    if (await fileExists(filePathBuilder(cursor))) {
      return cursor;
    }
    cursor = previousDate(cursor);
  }

  return null;
}

async function ensureReportsFallback(args) {
  const reportDir = path.join(ROOT_DIR, "data", "reports", args.date);
  const indexPath = path.join(reportDir, "index.json");
  const crawlManifestPath = path.join(reportDir, "crawl-manifest.json");
  const crawlManifestMdPath = path.join(reportDir, "crawl-manifest.md");
  const textManifestPath = path.join(reportDir, "text-manifest.json");
  const textManifestMdPath = path.join(reportDir, "text-manifest.md");
  const createdPaths = [];
  const generatedAt = createGeneratedAt();
  const reason = args.reason || "report collection unavailable";

  await ensureDir(path.join(reportDir, "pdf"));
  await ensureDir(path.join(reportDir, "text"));

  if (
    await writeJsonIfMissing(indexPath, [])
  ) {
    createdPaths.push(indexPath);
  }

  if (
    await writeJsonIfMissing(crawlManifestPath, {
      date: args.date,
      generated_at: generatedAt,
      total_matched_before_dedupe: 0,
      downloaded_count: 0,
      failed_download_count: 0,
      source_counts: {},
      category_counts: {},
      top_brokers: {},
      page_logs: [],
      download_failures: [],
      fallback: true,
      fallback_reason: reason,
    })
  ) {
    createdPaths.push(crawlManifestPath);
  }

  if (
    await writeTextIfMissing(
      crawlManifestMdPath,
      [
        `# ${args.date} 리포트 수집 매니페스트`,
        "",
        "- fallback: true",
        `- fallback_reason: ${reason}`,
        `- generated_at: ${generatedAt}`,
        "- 저장 건수: 0",
      ].join("\n"),
    )
  ) {
    createdPaths.push(crawlManifestMdPath);
  }

  if (
    await writeJsonIfMissing(textManifestPath, {
      date: args.date,
      generated_at: generatedAt,
      total_reports: 0,
      success_count: 0,
      failed_count: 0,
      ocr_used_count: 0,
      ocr_trigger_length: null,
      preview_text_limit: null,
      command_availability: {},
      method_counts: {},
      entries: [],
      fallback: true,
      fallback_reason: reason,
    })
  ) {
    createdPaths.push(textManifestPath);
  }

  if (
    await writeTextIfMissing(
      textManifestMdPath,
      [
        `# ${args.date} 전문 텍스트 매니페스트`,
        "",
        "- fallback: true",
        `- fallback_reason: ${reason}`,
        `- generated_at: ${generatedAt}`,
        "- 성공: 0/0",
      ].join("\n"),
    )
  ) {
    createdPaths.push(textManifestMdPath);
  }

  return createdPaths.length > 0
    ? {
        kind: "reports",
        status: "recovered",
        detail: "빈 리포트 index/text manifest로 복구했습니다.",
        reason,
        createdPaths,
        sourceDate: null,
      }
    : null;
}

async function ensureMarketFallback(args) {
  const marketPath = path.join(ROOT_DIR, "data", "market", `${args.date}.json`);
  if (await fileExists(marketPath)) {
    return null;
  }

  const generatedAt = createGeneratedAt();
  const reason = args.reason || "market snapshot unavailable";
  const sourceDate = await resolveLatestAvailableDate(
    args.date,
    (candidate) => path.join(ROOT_DIR, "data", "market", `${candidate}.json`),
    args.sourceDate,
  );

  let payload = {
    date: args.date,
    generated_at: generatedAt,
    indices: {},
    macro: {},
    watchlist: {},
  };

  if (sourceDate) {
    const sourcePayload = (await readJson(
      path.join(ROOT_DIR, "data", "market", `${sourceDate}.json`),
      null,
    )) ?? null;
    if (sourcePayload) {
      payload = {
        ...sourcePayload,
        date: args.date,
        generated_at: generatedAt,
      };
    }
  }

  payload.fallback = {
    kind: "market",
    reason,
    recoveredFromDate: sourceDate,
  };

  await writeJson(marketPath, payload);

  return {
    kind: "market",
    status: "recovered",
    detail: sourceDate
      ? `시장 스냅샷을 ${sourceDate} 기준 데이터로 복구했습니다.`
      : "빈 시장 스냅샷으로 복구했습니다.",
    reason,
    createdPaths: [marketPath],
    sourceDate,
  };
}

async function ensureTechnicalFallback(args) {
  const technicalPath = path.join(ROOT_DIR, "data", "technical", `${args.date}.json`);
  if (await fileExists(technicalPath)) {
    return null;
  }

  const generatedAt = createGeneratedAt();
  const reason = args.reason || "technical snapshot unavailable";
  const sourceDate = await resolveLatestAvailableDate(
    args.date,
    (candidate) => path.join(ROOT_DIR, "data", "technical", `${candidate}.json`),
    args.sourceDate,
  );

  let payload = {
    date: args.date,
    generated_at: generatedAt,
    market_context: {},
    scores: {},
  };

  if (sourceDate) {
    const sourcePayload = (await readJson(
      path.join(ROOT_DIR, "data", "technical", `${sourceDate}.json`),
      null,
    )) ?? null;
    if (sourcePayload) {
      payload = {
        ...sourcePayload,
        date: args.date,
        generated_at: generatedAt,
      };
    }
  }

  payload.fallback = {
    kind: "technical",
    reason,
    recoveredFromDate: sourceDate,
  };

  await writeJson(technicalPath, payload);

  return {
    kind: "technical",
    status: "recovered",
    detail: sourceDate
      ? `기술 스냅샷을 ${sourceDate} 기준 데이터로 복구했습니다.`
      : "빈 기술 스냅샷으로 복구했습니다.",
    reason,
    createdPaths: [technicalPath],
    sourceDate,
  };
}

function mergeSummaryEntries(existingEntries, nextEntries) {
  const merged = new Map();

  for (const entry of [...existingEntries, ...nextEntries]) {
    merged.set(entry.kind, entry);
  }

  return [...merged.values()];
}

async function appendFallbackSummary(args, nextEntries) {
  if (nextEntries.length === 0) {
    return;
  }

  const jsonPath = path.join(
    ROOT_DIR,
    "data",
    "analysis-state",
    args.date,
    "fallback-summary.json",
  );
  const markdownPath = path.join(
    ROOT_DIR,
    "data",
    "analysis-state",
    args.date,
    "fallback-summary.md",
  );
  const current = (await readJson(jsonPath, { date: args.date, generatedAt: null, entries: [] })) ?? {
    date: args.date,
    generatedAt: null,
    entries: [],
  };
  const entries = mergeSummaryEntries(current.entries ?? [], nextEntries);
  const generatedAt = createGeneratedAt();

  await writeJson(jsonPath, {
    date: args.date,
    runDate: args.runDate,
    effectiveMarketDate: args.effectiveMarketDate,
    generatedAt,
    entries,
  });

  const markdown = [
    `# EcoReport Fallback Summary (${args.date})`,
    "",
    `- generatedAt: ${generatedAt}`,
    ...entries.flatMap((entry) => [
      `## ${entry.kind}`,
      `- detail: ${entry.detail}`,
      `- reason: ${entry.reason}`,
      entry.sourceDate ? `- sourceDate: ${entry.sourceDate}` : null,
      `- createdPaths: ${entry.createdPaths.join(", ")}`,
      "",
    ]),
  ]
    .filter(Boolean)
    .join("\n");

  await writeText(markdownPath, `${markdown}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nextEntries = [];
  const wantedModes =
    args.mode === "all"
      ? ["reports", "market", "technical"]
      : args.mode.split(",").map((item) => item.trim()).filter(Boolean);

  if (wantedModes.includes("reports")) {
    const entry = await ensureReportsFallback(args);
    if (entry) nextEntries.push(entry);
  }

  if (wantedModes.includes("market")) {
    const entry = await ensureMarketFallback(args);
    if (entry) nextEntries.push(entry);
  }

  if (wantedModes.includes("technical")) {
    const entry = await ensureTechnicalFallback(args);
    if (entry) nextEntries.push(entry);
  }

  await appendFallbackSummary(args, nextEntries);

  if (nextEntries.length === 0) {
    console.log("No fallback artifacts were needed.");
    return;
  }

  for (const entry of nextEntries) {
    console.log(`[fallback:${entry.kind}] ${entry.detail}`);
  }
}

main().catch((error) => {
  console.error(`ensure-daily-fallbacks 실패: ${error.message}`);
  process.exit(1);
});
