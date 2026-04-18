#!/usr/bin/env node

import path from "node:path";
import { execFileSync } from "node:child_process";

import { parseDateArgs, writeJson } from "./lib/pipeline-utils.js";

const STRATEGY_MAP = {
  momentum: {
    key: "momentum",
    label: "1호 - 모멘텀 Easy",
    url: "https://stockeasy.intellio.kr/strategy-room/momentum",
  },
  peak: {
    key: "peak",
    label: "2호 - 피크 Easy",
    url: "https://stockeasy.intellio.kr/strategy-room/peak",
  },
  value: {
    key: "value",
    label: "3호 - 밸류 Easy",
    url: "https://stockeasy.intellio.kr/strategy-room/value",
  },
};

function parseCli(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    strategy: "momentum",
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--strategy" && argv[index + 1]) {
      args.strategy = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function runAppleScript(script) {
  return execFileSync("osascript", ["-"], {
    input: script,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function quoted(value) {
  return JSON.stringify(String(value));
}

function buildTextHelpers() {
  return `
    const textOf = (node) => String(node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
    const splitLines = (limit) =>
      (document.body.innerText || "")
        .split("\\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, limit);
    const clickByNeedle = (needle, resultKey) => {
      const candidates = Array.from(
        document.querySelectorAll("button, a, [role='tab'], [role='button'], td, th, tr, div, span")
      );
      const rawTarget =
        candidates.find((node) => textOf(node) === needle) ||
        candidates.find((node) => textOf(node).startsWith(needle)) ||
        candidates.find((node) => textOf(node).includes(needle));
      const target =
        rawTarget?.closest?.("button, a, [role='tab'], [role='button'], td, th, tr, div, span") ||
        rawTarget ||
        null;
      const availableMatches = candidates
        .map((node) => textOf(node))
        .filter((text) => text && text.includes(needle))
        .slice(0, 20);
      if (!target) {
        window[resultKey] = { needle, clicked: false, matchedText: null, availableMatches };
        return false;
      }
      target.scrollIntoView?.({ block: "center", inline: "center" });
      target.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true }));
      target.dispatchEvent?.(new MouseEvent("mouseup", { bubbles: true }));
      target.dispatchEvent?.(new MouseEvent("click", { bubbles: true }));
      target.click?.();
      window[resultKey] = { needle, clicked: true, matchedText: textOf(target), availableMatches };
      return true;
    };
  `.trim();
}

function buildExtractorScript(lineLimit = 320, actionCount = 0) {
  const actionRefs = Array.from(
    { length: actionCount },
    (_, index) => `window.__codexAction${index} || null`,
  ).join(", ");

  return `
    (() => {
      ${buildTextHelpers()}
      return JSON.stringify({
        title: document.title,
        href: location.href,
        lines: splitLines(${lineLimit}),
        actions: [${actionRefs}]
      });
    })();
  `.trim();
}

function buildClickScript(actionText, resultKey) {
  return `
    (() => {
      ${buildTextHelpers()}
      return clickByNeedle(${quoted(actionText)}, ${quoted(resultKey)});
    })();
  `.trim();
}

function fetchPage(url, { lineLimit = 320, actionTexts = [], actionDelaySec = 1.8 } = {}) {
  const extractor = buildExtractorScript(lineLimit, actionTexts.length);
  const actionStatements = actionTexts
    .map(
      (actionText, index) => `
  do JavaScript ${quoted(buildClickScript(actionText, `__codexAction${index}`))} in tempTab
  delay ${actionDelaySec}
      `.trim(),
    )
    .join("\n");

  const script = `
tell application "Safari"
  activate
  if (count of windows) = 0 then
    make new document
    delay 0.5
  end if

  tell front window
    set tempTab to make new tab at end of tabs with properties {URL:${quoted(url)}}
    set current tab to tempTab
  end tell

  delay 3
  ${actionStatements}
  set payload to do JavaScript ${quoted(extractor)} in tempTab
  close tempTab
  return payload
end tell
  `.trim();

  return JSON.parse(runAppleScript(script));
}

function compactLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? "").replace(/,/g, "").replace(/[^\d.+-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePct(value) {
  const parsed = parseNumber(value);
  return parsed == null ? null : parsed / 100;
}

function parseHoldingDays(value) {
  const match = String(value ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeMonthDay(monthDayText, asOfDate) {
  const match = String(monthDayText ?? "").match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const [, monthText, dayText] = match;
  const asOf = String(asOfDate ?? "");
  const asOfYear = Number(asOf.slice(0, 4));
  if (!Number.isFinite(asOfYear)) return null;
  const candidateThisYear = `${asOfYear}-${monthText}-${dayText}`;
  const resolvedYear = candidateThisYear > asOf ? asOfYear - 1 : asOfYear;
  return `${resolvedYear}-${monthText}-${dayText}`;
}

function parseUpdatedDate(lines, asOfDate) {
  const line = lines.find((item) => /^updated\s+\d{2}\/\d{2}$/i.test(item)) ?? null;
  if (!line) return null;
  const match = line.match(/(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const monthDay = `${match[1]}/${match[2]}`;
  return normalizeMonthDay(monthDay, asOfDate);
}

function looksLikeSectorHeader(value) {
  return /^.+\s+\d{1,3}$/.test(String(value ?? "").trim());
}

function looksLikePriceLine(value) {
  return parseNumber(value) != null;
}

function parseHoldings(lines, asOfDate) {
  const start = lines.findIndex((line) => line.includes("섹터") && line.includes("매수가") && line.includes("현재가"));
  if (start < 0) return [];

  const rows = [];
  let index = start + 1;
  let currentSector = null;
  let currentSectorRank = null;

  while (index < lines.length) {
    const line = compactLine(lines[index]);
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith("이탈 종목") || line.startsWith("누적수익률")) {
      break;
    }

    const sectorMatch = line.match(/^(.+?)\s+(\d{1,3})$/);
    if (sectorMatch) {
      currentSector = compactLine(sectorMatch[1]);
      currentSectorRank = Number(sectorMatch[2]);
      index += 1;
      continue;
    }

    const nextLine = compactLine(lines[index + 1]);
    if (/^\d{1,3}$/.test(nextLine)) {
      currentSector = line;
      currentSectorRank = Number(nextLine);
      index += 2;
      continue;
    }

    if (!currentSector) {
      index += 1;
      continue;
    }

    const name = line;
    const metricCells = String(lines[index + 1] ?? "")
      .split("\t")
      .map((item) => compactLine(item))
      .filter(Boolean);
    const buyPrice = parseNumber(metricCells[0]);
    const currentPrice = parseNumber(metricCells[1]);
    const buyDate = normalizeMonthDay(metricCells[2], asOfDate);
    const holdingDays = parseHoldingDays(lines[index + 2]);
    const returnPct = parsePct(lines[index + 3]);

    if (
      currentSector &&
      name &&
      buyPrice != null &&
      currentPrice != null &&
      buyDate &&
      holdingDays != null &&
      returnPct != null &&
      metricCells.length >= 3
    ) {
      rows.push({
        sector: currentSector,
        sectorRank: currentSectorRank,
        name,
        buyPrice,
        currentPrice,
        buyDate,
        holdingDays,
        returnPct,
      });
      index += 4;
      continue;
    }

    index += 1;
  }

  return rows;
}

function parseTradeHistory(lines) {
  const start = lines.findIndex((line) => line.includes("거래일") && line.includes("종목명") && line.includes("매수가"));
  if (start < 0) return [];

  const rows = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("\t")) continue;
    const cells = line.split("\t").map((item) => compactLine(item));
    if (cells.length < 7) continue;
    rows.push({
      exitDate: cells[0] || null,
      name: cells[1] || null,
      buyPrice: parseNumber(cells[2]),
      buyDate: cells[3] || null,
      exitPrice: parseNumber(cells[4]),
      holdingDays: parseHoldingDays(cells[5]),
      returnPct: parsePct(cells[6]),
    });
  }
  return rows;
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  const strategy = STRATEGY_MAP[args.strategy] ?? STRATEGY_MAP.momentum;
  const outputPath =
    args.output ??
    path.join(
      process.cwd(),
      "data",
      "external",
      "stockeasy",
      args.date,
      `${strategy.key}-trade-history.json`,
    );

  const detailPayload = fetchPage(strategy.url, { lineLimit: 320 });
  const historyPayload = fetchPage(strategy.url, {
    lineLimit: 360,
    actionTexts: ["내역"],
    actionDelaySec: 2,
  });

  const payload = {
    source: "stockeasy",
    strategy: {
      key: strategy.key,
      label: strategy.label,
      url: strategy.url,
    },
    capturedAt: new Date().toISOString(),
    asOfDate: args.date,
    updatedDate: parseUpdatedDate(detailPayload.lines, args.date),
    currentHoldings: parseHoldings(detailPayload.lines, args.date),
    tradeHistory: parseTradeHistory(historyPayload.lines),
    raw: {
      detail: detailPayload,
      history: historyPayload,
    },
  };

  await writeJson(outputPath, payload);
  console.log(
    `✅ StockEasy ${strategy.key} history saved: ${outputPath} (holdings=${payload.currentHoldings.length}, trades=${payload.tradeHistory.length})`,
  );
}

main().catch((error) => {
  console.error(`❌ StockEasy strategy history capture failed: ${error.message}`);
  process.exitCode = 1;
});
