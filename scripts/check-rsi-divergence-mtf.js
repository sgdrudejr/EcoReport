#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

import { RSI } from "technicalindicators";

const ROOT_DIR = process.cwd();
const REQUEST_DELAY_MS = 120;
const FETCH_TIMEOUT_MS = 15_000;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = {
    date: todayIso(),
    minuteDays: 30,
    dailyCount: 220,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--minute-days" && argv[index + 1]) {
      args.minuteDays = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--daily-count" && argv[index + 1]) {
      args.dailyCount = Number(argv[index + 1]);
      index += 1;
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error(`Invalid --date: ${args.date}`);
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function normalizeNumber(value) {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function yyyymmdd(date) {
  return date.replace(/-/g, "");
}

function shiftDate(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
        accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseSiseJson(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[[")) {
    throw new Error(`Unexpected Naver response: ${trimmed.slice(0, 80)}`);
  }
  return vm.runInNewContext(trimmed, Object.create(null), { timeout: 1000 });
}

async function fetchNaverChartRows({ code, timeframe, count, startDate, endDate }) {
  const params = new URLSearchParams({
    symbol: code,
    requestType: startDate && endDate ? "1" : "0",
    timeframe,
  });
  if (startDate && endDate) {
    params.set("startTime", yyyymmdd(startDate));
    params.set("endTime", yyyymmdd(endDate));
  } else {
    params.set("count", String(count));
  }

  const raw = await fetchText(`https://api.finance.naver.com/siseJson.naver?${params.toString()}`);
  return parseSiseJson(raw).slice(1);
}

function normalizeChartRows(rows) {
  return rows
    .map((row) => {
      const stamp = String(row[0] ?? "");
      const close = normalizeNumber(row[4]);
      const open = normalizeNumber(row[1]) ?? close;
      const high = normalizeNumber(row[2]) ?? close;
      const low = normalizeNumber(row[3]) ?? close;
      if (!stamp || close == null) return null;
      return {
        stamp,
        date: stamp.length >= 12
          ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`
          : `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
        open,
        high,
        low,
        close,
        volume: normalizeNumber(row[5]),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.stamp.localeCompare(right.stamp));
}

function minuteOfDay(stamp) {
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  return hour * 60 + minute;
}

function aggregateMinuteRows(rows, timeframe) {
  const grouped = new Map();
  const sessionStart = 9 * 60;
  const minutesPerBar = timeframe === "4h" ? 240 : 60;

  for (const row of rows) {
    if (row.stamp.length < 12) continue;
    const day = row.stamp.slice(0, 8);
    const offset = Math.max(minuteOfDay(row.stamp) - sessionStart, 0);
    const bucket = Math.floor(offset / minutesPerBar);
    const key = `${day}-${bucket}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        stamp: row.stamp,
        date: `${row.date.slice(0, 10)} ${String(Math.floor((sessionStart + bucket * minutesPerBar) / 60)).padStart(2, "0")}:00`,
        open: row.close,
        high: row.close,
        low: row.close,
        close: row.close,
        volume: row.volume ?? 0,
      });
      continue;
    }
    existing.high = Math.max(existing.high, row.close);
    existing.low = Math.min(existing.low, row.close);
    existing.close = row.close;
    existing.volume += row.volume ?? 0;
  }

  return [...grouped.values()].sort((left, right) => left.stamp.localeCompare(right.stamp));
}

function alignSeries(sourceLength, values) {
  return Array.from({ length: Math.max(sourceLength - values.length, 0) }, () => null).concat(values);
}

function findPivotIndexes(values, mode, left = 2, right = 2) {
  const pivots = [];
  for (let index = left; index < values.length - right; index += 1) {
    const pivot = values[index];
    if (pivot == null) continue;
    let isPivot = true;
    for (let offset = 1; offset <= left; offset += 1) {
      if (mode === "low" ? pivot > values[index - offset] : pivot < values[index - offset]) {
        isPivot = false;
        break;
      }
    }
    if (!isPivot) continue;
    for (let offset = 1; offset <= right; offset += 1) {
      if (mode === "low" ? pivot > values[index + offset] : pivot < values[index + offset]) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) pivots.push(index);
  }
  return pivots;
}

function scanPairs({ rows, pivots, prices, rsi, mode, priceTolerance, rsiDelta, recencyBars }) {
  for (let right = pivots.length - 1; right >= 1; right -= 1) {
    const latestIndex = pivots[right];
    if (rows.length - 1 - latestIndex > recencyBars) continue;

    for (let left = right - 1; left >= Math.max(0, right - 4); left -= 1) {
      const previousIndex = pivots[left];
      const previousPrice = prices[previousIndex];
      const latestPrice = prices[latestIndex];
      const previousRsi = rsi[previousIndex];
      const latestRsi = rsi[latestIndex];
      if ([previousPrice, latestPrice, previousRsi, latestRsi].some((value) => value == null)) continue;

      const bullish = mode === "low" && latestPrice < previousPrice * (1 - priceTolerance) && latestRsi > previousRsi + rsiDelta;
      const bearish = mode === "high" && latestPrice > previousPrice * (1 + priceTolerance) && latestRsi < previousRsi - rsiDelta;
      if (!bullish && !bearish) continue;

      return {
        type: bullish ? "bullish" : "bearish",
        previousDate: rows[previousIndex].date,
        latestDate: rows[latestIndex].date,
        previousPrice: round(previousPrice, 4),
        latestPrice: round(latestPrice, 4),
        previousRsi: round(previousRsi, 2),
        latestRsi: round(latestRsi, 2),
        pivotAgeBars: rows.length - 1 - latestIndex,
      };
    }
  }
  return null;
}

function detectDivergence(rows, timeframe) {
  if (!Array.isArray(rows) || rows.length < 35) {
    return {
      status: "insufficient_data",
      type: "none",
      summary: `${timeframe} 데이터가 부족합니다 (${rows?.length ?? 0}개).`,
      bars: rows?.length ?? 0,
    };
  }

  const closes = rows.map((row) => row.close);
  const rsi = alignSeries(rows.length, RSI.calculate({ period: 14, values: closes }));
  const lookback = Math.min(timeframe === "1h" ? 120 : timeframe === "4h" ? 80 : 90, rows.length);
  const sampleRows = rows.slice(-lookback);
  const sampleRsi = rsi.slice(-lookback);
  const lows = sampleRows.map((row) => row.low);
  const highs = sampleRows.map((row) => row.high);
  const leftRight = timeframe === "day" ? 2 : 3;
  const recencyBars = timeframe === "day" ? 18 : timeframe === "4h" ? 12 : 18;
  const priceTolerance = timeframe === "day" ? 0.003 : 0.0015;
  const rsiDelta = timeframe === "day" ? 3 : 2.2;

  const bullish = scanPairs({
    rows: sampleRows,
    pivots: findPivotIndexes(lows, "low", leftRight, leftRight).filter((index) => sampleRsi[index] != null),
    prices: lows,
    rsi: sampleRsi,
    mode: "low",
    priceTolerance,
    rsiDelta,
    recencyBars,
  });
  const bearish = scanPairs({
    rows: sampleRows,
    pivots: findPivotIndexes(highs, "high", leftRight, leftRight).filter((index) => sampleRsi[index] != null),
    prices: highs,
    rsi: sampleRsi,
    mode: "high",
    priceTolerance,
    rsiDelta,
    recencyBars,
  });

  const picked = bullish ?? bearish;
  if (!picked) {
    return {
      status: "checked",
      type: "none",
      latestRsi: round(rsi.at(-1), 2),
      bars: rows.length,
      summary: `${timeframe} 최근 구간에서 확정 RSI 다이버전스 없음.`,
    };
  }

  return {
    status: "checked",
    type: picked.type,
    latestRsi: round(rsi.at(-1), 2),
    bars: rows.length,
    reference: picked,
    summary:
      picked.type === "bullish"
        ? `${timeframe} 강세 다이버전스: 가격 저점 하락, RSI 저점 상승 (${picked.previousDate} -> ${picked.latestDate}).`
        : `${timeframe} 약세 다이버전스: 가격 고점 상승, RSI 고점 하락 (${picked.previousDate} -> ${picked.latestDate}).`,
  };
}

function flattenPortfolioHoldings(portfolio) {
  const byCode = new Map();
  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      const code = String(holding.code ?? "").trim();
      if (!code) continue;
      const existing = byCode.get(code) ?? {
        code,
        name: holding.name ?? code,
        accounts: new Set(),
        quantity: 0,
        purchaseValue: 0,
      };
      if (account.key) existing.accounts.add(account.key);
      existing.quantity += Number(holding.quantity ?? 0);
      existing.purchaseValue += Number(holding.purchaseValue ?? 0);
      byCode.set(code, existing);
    }
  }
  return [...byCode.values()]
    .map((item) => ({ ...item, accounts: [...item.accounts].sort() }))
    .sort((left, right) => right.purchaseValue - left.purchaseValue);
}

function classifyConsensus(timeframes) {
  const types = ["day", "4h", "1h"].map((key) => timeframes[key]?.type).filter((type) => type && type !== "none");
  if (types.includes("bearish") && types.includes("bullish")) return "mixed";
  if (types.includes("bearish")) return "bearish_watch";
  if (types.includes("bullish")) return "bullish_watch";
  return "none";
}

async function analyzeHolding(holding, args) {
  const dailyRaw = await fetchNaverChartRows({
    code: holding.code,
    timeframe: "day",
    count: args.dailyCount,
    startDate: shiftDate(args.date, -420),
    endDate: args.date,
  });
  const minuteRaw = await fetchNaverChartRows({
    code: holding.code,
    timeframe: "minute",
    count: args.minuteDays,
  });
  const dailyRows = normalizeChartRows(dailyRaw).slice(-args.dailyCount);
  const minuteRows = normalizeChartRows(minuteRaw);
  const rows4h = aggregateMinuteRows(minuteRows, "4h");
  const rows1h = aggregateMinuteRows(minuteRows, "1h");

  const timeframes = {
    day: detectDivergence(dailyRows, "day"),
    "4h": detectDivergence(rows4h, "4h"),
    "1h": detectDivergence(rows1h, "1h"),
  };

  return {
    code: holding.code,
    name: holding.name,
    accounts: holding.accounts,
    purchaseValue: holding.purchaseValue,
    consensus: classifyConsensus(timeframes),
    timeframes,
  };
}

function buildMarkdown(payload) {
  const lines = [
    `# RSI Multi-Timeframe Divergence (${payload.date})`,
    "",
    `- Universe: current holdings ${payload.results.length} symbols`,
    `- Order: day -> 4h -> 1h`,
    `- Data note: 4h/1h are aggregated from Naver 1-minute close data; intrabar high/low is approximated from minute closes.`,
    "",
    "| Symbol | Name | Consensus | Day | 4h | 1h |",
    "|---|---|---:|---|---|---|",
  ];

  for (const item of payload.results) {
    lines.push(
      `| ${item.code} | ${item.name} | ${item.consensus} | ${item.timeframes.day.summary} | ${item.timeframes["4h"].summary} | ${item.timeframes["1h"].summary} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portfolio = await readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] });
  const holdings = flattenPortfolioHoldings(portfolio);
  const results = [];

  for (const [index, holding] of holdings.entries()) {
    process.stderr.write(`[${index + 1}/${holdings.length}] ${holding.code} ${holding.name}\n`);
    try {
      results.push(await analyzeHolding(holding, args));
    } catch (error) {
      results.push({
        code: holding.code,
        name: holding.name,
        accounts: holding.accounts,
        purchaseValue: holding.purchaseValue,
        consensus: "error",
        error: error.message,
        timeframes: {},
      });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const payload = {
    date: args.date,
    generatedAt: new Date().toISOString(),
    source: "naver_siseJson",
    universe: "current_portfolio_holdings",
    settings: {
      dailyCount: args.dailyCount,
      minuteDays: args.minuteDays,
      rsiPeriod: 14,
      order: ["day", "4h", "1h"],
    },
    results,
    summary: {
      total: results.length,
      bullishWatch: results.filter((item) => item.consensus === "bullish_watch").map((item) => item.code),
      bearishWatch: results.filter((item) => item.consensus === "bearish_watch").map((item) => item.code),
      mixed: results.filter((item) => item.consensus === "mixed").map((item) => item.code),
      errors: results.filter((item) => item.consensus === "error").map((item) => item.code),
    },
  };

  const jsonPath = path.join(ROOT_DIR, "data", "features", args.date, "rsi-divergence-mtf.json");
  const markdownPath = path.join(ROOT_DIR, "reports", "daily", `${args.date}-rsi-divergence-mtf.md`);
  await writeJson(jsonPath, payload);
  await writeText(markdownPath, buildMarkdown(payload));

  console.log(`Built RSI MTF divergence: ${path.relative(ROOT_DIR, jsonPath)}`);
  console.log(`Built RSI MTF report: ${path.relative(ROOT_DIR, markdownPath)}`);
  console.log(JSON.stringify(payload.summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
