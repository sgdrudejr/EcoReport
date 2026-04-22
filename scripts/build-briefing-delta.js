#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  readText,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { isTradingDay, previousDate } from "./lib/trading-calendar.js";

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, limit = 180) {
  const text = compact(value);
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function normalizeLine(line) {
  return compact(String(line ?? "").replace(/^[-*#>\d.\s]+/, ""));
}

function isSignalLine(line) {
  const text = normalizeLine(line);
  if (!text) return false;
  if (text.length < 18) return false;
  if (/^(date|runDate|effectiveMarketDate|runId|generatedAt|model|source)\s*:/i.test(text)) return false;
  return true;
}

function extractSignalUnits(markdown) {
  const result = [];
  const seen = new Set();

  for (const rawLine of String(markdown ?? "").split("\n")) {
    const line = normalizeLine(rawLine);
    const key = line.toLowerCase();
    if (!isSignalLine(line) || seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }

  return result;
}

async function findPreviousBriefingDate(date, maxLookback = 14) {
  let cursor = previousDate(date);
  for (let index = 0; index < maxLookback; index += 1) {
    if (!isTradingDay(cursor)) {
      cursor = previousDate(cursor);
      continue;
    }
    const candidate = path.join(ROOT_DIR, "knowledge", "daily", `${cursor}-gemini-briefing-rich.md`);
    const exists = Boolean(await readText(candidate, ""));
    if (exists) return cursor;
    cursor = previousDate(cursor);
  }
  return null;
}

function buildDiff(currentUnits, previousUnits, limit = 12) {
  const previousSet = new Set(previousUnits.map((item) => item.toLowerCase()));
  const currentSet = new Set(currentUnits.map((item) => item.toLowerCase()));

  const added = currentUnits.filter((item) => !previousSet.has(item.toLowerCase())).slice(0, limit);
  const removed = previousUnits.filter((item) => !currentSet.has(item.toLowerCase())).slice(0, limit);
  const carry = currentUnits.filter((item) => previousSet.has(item.toLowerCase())).slice(0, limit);

  return { added, removed, carry };
}

function renderMarkdown({ date, previousTradingDate, currentPath, previousPath, diff }) {
  const lines = [
    `# ${date} Briefing Delta`,
    "",
    `- current: ${currentPath}`,
    `- previous: ${previousPath ?? "N/A"}`,
    `- previousTradingDate: ${previousTradingDate ?? "N/A"}`,
    `- addedCount: ${diff.added.length}`,
    `- removedCount: ${diff.removed.length}`,
    `- carryCount: ${diff.carry.length}`,
    "",
    "## 오늘 새로 강해진 포인트",
    ...(diff.added.length ? diff.added.map((item) => `- ${truncate(item, 220)}`) : ["- 의미 있는 신규 변화가 감지되지 않았습니다."]),
    "",
    "## 오늘 약해지거나 사라진 포인트",
    ...(diff.removed.length ? diff.removed.map((item) => `- ${truncate(item, 220)}`) : ["- 의미 있는 제거 포인트가 없습니다."]),
    "",
    "## 계속 유지되는 포인트",
    ...(diff.carry.length ? diff.carry.map((item) => `- ${truncate(item, 220)}`) : ["- 공통 포인트를 추출하지 못했습니다."]),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const currentPath =
    args.briefing
      ? path.isAbsolute(args.briefing)
        ? args.briefing
        : path.join(ROOT_DIR, args.briefing)
      : path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-gemini-briefing-rich.md`);

  const previousTradingDate = await findPreviousBriefingDate(args.date);
  const previousPath = previousTradingDate
    ? path.join(ROOT_DIR, "knowledge", "daily", `${previousTradingDate}-gemini-briefing-rich.md`)
    : null;

  const outputMarkdown =
    args.output
      ? path.isAbsolute(args.output)
        ? args.output
        : path.join(ROOT_DIR, args.output)
      : path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-briefing-delta.md`);

  const outputJson = path.join(ROOT_DIR, "data", "analysis-state", args.date, "briefing-delta.json");

  const currentMarkdown = await readText(currentPath, "");
  if (!compact(currentMarkdown)) {
    throw new Error(`현재 브리핑을 읽을 수 없습니다: ${currentPath}`);
  }

  const previousMarkdown = previousPath ? await readText(previousPath, "") : "";

  const currentUnits = extractSignalUnits(currentMarkdown);
  const previousUnits = extractSignalUnits(previousMarkdown);
  const diff = buildDiff(currentUnits, previousUnits);

  const payload = {
    date: args.date,
    previousTradingDate,
    currentPath,
    previousPath,
    stats: {
      currentUnitCount: currentUnits.length,
      previousUnitCount: previousUnits.length,
      addedCount: diff.added.length,
      removedCount: diff.removed.length,
      carryCount: diff.carry.length,
    },
    diff,
  };

  await writeJson(outputJson, payload);
  await writeText(outputMarkdown, renderMarkdown({
    date: args.date,
    previousTradingDate,
    currentPath,
    previousPath,
    diff,
  }));

  console.log(`saved: ${outputMarkdown}`);
  console.log(`json: ${outputJson}`);
  console.log(`previousTradingDate: ${previousTradingDate ?? "N/A"}`);
}

main().catch((error) => {
  console.error(`briefing delta 생성 실패: ${error.message}`);
  process.exit(1);
});
