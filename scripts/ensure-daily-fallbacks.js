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

function hasUsableReportPayload(indexEntries, textManifest) {
  return (
    Array.isArray(indexEntries) &&
    indexEntries.length > 0 &&
    Number(textManifest?.success_count ?? 0) > 0
  );
}

function rewriteReportRelativePath(filePath, sourceDate, targetDate) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return filePath;
  }
  return filePath.replace(`data/reports/${sourceDate}/`, `data/reports/${targetDate}/`);
}

async function resolveLatestAvailableReportDate(date, explicitSourceDate = "", lookbackDays = 14) {
  async function isUsable(candidate) {
    const candidateDir = path.join(ROOT_DIR, "data", "reports", candidate);
    const [indexEntries, textManifest] = await Promise.all([
      readJson(path.join(candidateDir, "index.json"), []),
      readJson(path.join(candidateDir, "text-manifest.json"), null),
    ]);
    return hasUsableReportPayload(indexEntries, textManifest);
  }

  if (explicitSourceDate && (await isUsable(explicitSourceDate))) {
    return explicitSourceDate;
  }

  let cursor = previousDate(date);
  for (let index = 0; index < lookbackDays; index += 1) {
    if (!isTradingDay(cursor)) {
      cursor = previousDate(cursor);
      continue;
    }

    if (await isUsable(cursor)) {
      return cursor;
    }
    cursor = previousDate(cursor);
  }

  return null;
}

async function copyReportArtifact(sourceRelativePath, targetRelativePath) {
  if (!sourceRelativePath || !targetRelativePath) {
    return null;
  }

  const sourcePath = path.join(ROOT_DIR, sourceRelativePath);
  const targetPath = path.join(ROOT_DIR, targetRelativePath);
  if (!(await fileExists(sourcePath))) {
    return null;
  }

  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
  return targetPath;
}

async function ensureReportsFallback(args) {
  const reportDir = path.join(ROOT_DIR, "data", "reports", args.date);
  const indexPath = path.join(reportDir, "index.json");
  const crawlManifestPath = path.join(reportDir, "crawl-manifest.json");
  const crawlManifestMdPath = path.join(reportDir, "crawl-manifest.md");
  const textManifestPath = path.join(reportDir, "text-manifest.json");
  const textManifestMdPath = path.join(reportDir, "text-manifest.md");
  const generatedAt = createGeneratedAt();
  const reason = args.reason || "report collection unavailable";

  const [currentIndex, currentTextManifest] = await Promise.all([
    readJson(indexPath, []),
    readJson(textManifestPath, null),
  ]);
  if (hasUsableReportPayload(currentIndex, currentTextManifest)) {
    return null;
  }

  await ensureDir(reportDir);
  await ensureDir(path.join(reportDir, "text"));

  const sourceDate = await resolveLatestAvailableReportDate(args.date, args.sourceDate);
  if (sourceDate) {
    const sourceDir = path.join(ROOT_DIR, "data", "reports", sourceDate);
    const [sourceIndex, sourceCrawlManifest, sourceTextManifest] = await Promise.all([
      readJson(path.join(sourceDir, "index.json"), []),
      readJson(path.join(sourceDir, "crawl-manifest.json"), {}),
      readJson(path.join(sourceDir, "text-manifest.json"), { entries: [] }),
    ]);

    if (hasUsableReportPayload(sourceIndex, sourceTextManifest)) {
      const targetIndex = sourceIndex.map((entry) => ({
        ...entry,
        date: args.date,
        pdf_path: rewriteReportRelativePath(entry.pdf_path, sourceDate, args.date),
        full_text_path: rewriteReportRelativePath(entry.full_text_path, sourceDate, args.date),
      }));
      const targetTextEntries = (sourceTextManifest.entries ?? []).map((entry) => ({
        ...entry,
        pdf_path: rewriteReportRelativePath(entry.pdf_path, sourceDate, args.date),
        text_path: rewriteReportRelativePath(entry.text_path, sourceDate, args.date),
      }));

      const copiedPaths = [];
      const seenSourcePaths = new Set();
      for (const entry of sourceIndex) {
        for (const filePath of [entry.pdf_path, entry.full_text_path]) {
          if (!filePath || seenSourcePaths.has(filePath)) {
            continue;
          }
          seenSourcePaths.add(filePath);
          const copiedPath = await copyReportArtifact(
            filePath,
            rewriteReportRelativePath(filePath, sourceDate, args.date),
          );
          if (copiedPath) copiedPaths.push(copiedPath);
        }
      }
      for (const entry of sourceTextManifest.entries ?? []) {
        const filePath = entry.text_path;
        if (!filePath || seenSourcePaths.has(filePath)) {
          continue;
        }
        seenSourcePaths.add(filePath);
        const copiedPath = await copyReportArtifact(
          filePath,
          rewriteReportRelativePath(filePath, sourceDate, args.date),
        );
        if (copiedPath) copiedPaths.push(copiedPath);
      }

      await writeJson(indexPath, targetIndex);
      await writeJson(crawlManifestPath, {
        ...sourceCrawlManifest,
        date: args.date,
        generated_at: generatedAt,
        fallback: true,
        fallback_reason: reason,
        recovered_from_date: sourceDate,
      });
      await writeText(
        crawlManifestMdPath,
        [
          `# ${args.date} 리포트 수집 매니페스트`,
          "",
          "- fallback: true",
          `- fallback_reason: ${reason}`,
          `- generated_at: ${generatedAt}`,
          `- recovered_from_date: ${sourceDate}`,
          `- 저장 건수: ${targetIndex.length}`,
        ].join("\n"),
      );
      await writeJson(textManifestPath, {
        ...sourceTextManifest,
        date: args.date,
        generated_at: generatedAt,
        entries: targetTextEntries,
        fallback: true,
        fallback_reason: reason,
        recovered_from_date: sourceDate,
      });
      await writeText(
        textManifestMdPath,
        [
          `# ${args.date} 전문 텍스트 매니페스트`,
          "",
          "- fallback: true",
          `- fallback_reason: ${reason}`,
          `- generated_at: ${generatedAt}`,
          `- recovered_from_date: ${sourceDate}`,
          `- 성공: ${Number(sourceTextManifest.success_count ?? 0)}/${Number(sourceTextManifest.total_reports ?? 0)}`,
        ].join("\n"),
      );

      return {
        kind: "reports",
        status: "recovered",
        detail: `리포트 산출물을 ${sourceDate} 기준 ${targetIndex.length}건으로 복구했습니다.`,
        reason,
        createdPaths: [
          indexPath,
          crawlManifestPath,
          crawlManifestMdPath,
          textManifestPath,
          textManifestMdPath,
          ...copiedPaths,
        ],
        sourceDate,
      };
    }
  }

  await writeJson(indexPath, []);
  await writeJson(crawlManifestPath, {
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
  });
  await writeText(
    crawlManifestMdPath,
    [
      `# ${args.date} 리포트 수집 매니페스트`,
      "",
      "- fallback: true",
      `- fallback_reason: ${reason}`,
      `- generated_at: ${generatedAt}`,
      "- 저장 건수: 0",
    ].join("\n"),
  );
  await writeJson(textManifestPath, {
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
  });
  await writeText(
    textManifestMdPath,
    [
      `# ${args.date} 전문 텍스트 매니페스트`,
      "",
      "- fallback: true",
      `- fallback_reason: ${reason}`,
      `- generated_at: ${generatedAt}`,
      "- 성공: 0/0",
    ].join("\n"),
  );

  return {
    kind: "reports",
    status: "recovered",
    detail: "빈 리포트 index/text manifest로 복구했습니다.",
    reason,
    createdPaths: [
      indexPath,
      crawlManifestPath,
      crawlManifestMdPath,
      textManifestPath,
      textManifestMdPath,
    ],
    sourceDate: null,
  };
}

async function ensureMarketFallback(args) {
  const marketPath = path.join(ROOT_DIR, "data", "market", `${args.date}.json`);
  const currentMarket = await readJson(marketPath, null);
  const hasUsableMarketPayload = Boolean(
    currentMarket &&
      (
        Object.keys(currentMarket.indices ?? {}).length > 0 ||
        Object.keys(currentMarket.macro ?? {}).length > 0 ||
        Object.keys(currentMarket.watchlist ?? {}).length > 0 ||
        currentMarket.fallback?.recoveredFromDate
      ),
  );
  if (hasUsableMarketPayload) {
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
  const currentTechnical = await readJson(technicalPath, null);
  const hasUsableTechnicalPayload = Boolean(
    currentTechnical &&
      (
        Object.keys(currentTechnical.scores ?? {}).length > 0 ||
        Object.keys(currentTechnical.market_context ?? {}).length > 0 ||
        currentTechnical.fallback?.recoveredFromDate
      ),
  );
  if (hasUsableTechnicalPayload) {
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
