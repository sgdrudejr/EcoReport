#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import fetch from "node-fetch";

import { ROOT_DIR, readJson, writeJson } from "./lib/pipeline-utils.js";

loadEnv();

const FETCH_TIMEOUT_MS = 12_000;
const REQUEST_DELAY_MS = 250;
const MACRO_SYMBOLS = {
  VIX: "^VIX",
  USDKRW: "USDKRW",
  WTI: "CL.F",
};

function parseArgs(argv) {
  const date = new Date().toISOString().slice(0, 10);
  const args = {
    date,
    output: path.join(ROOT_DIR, "data", "intraday", `${date}-market-lite.json`),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized || normalized === "null" || normalized === "N/D") return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value, digits = 6) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Number.parseFloat(value.toFixed(digits));
}

function percentChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

async function fetchText(url, headers = {}) {
  const { signal, clear } = createTimeoutSignal(FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } finally {
    clear();
  }
}

async function fetchJson(url, headers = {}) {
  return JSON.parse(await fetchText(url, headers));
}

async function fetchNaverDomesticBasic(code) {
  return fetchJson(`https://m.stock.naver.com/api/stock/${code}/basic`);
}

async function fetchNaverDomesticPrice(code) {
  return fetchJson(`https://m.stock.naver.com/api/stock/${code}/price?page=1&pageSize=2`);
}

async function fetchNaverDomesticRealtime(code) {
  const payload = await fetchJson(
    `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${code}|SERVICE_RECENT_ITEM:${code}`,
  );
  const areas = payload?.result?.areas ?? [];
  return areas.flatMap((area) => area.datas ?? []).find((item) => item.cd === code) ?? null;
}

async function fetchStooqDailySeries(symbol) {
  const csv = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=d`, {
    accept: "text/plain,*/*",
  });
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(","))
    .filter((parts) => parts.length >= 5)
    .map((parts) => ({
      date: parts[0]?.trim(),
      open: parseNumber(parts[1]),
      high: parseNumber(parts[2]),
      low: parseNumber(parts[3]),
      close: parseNumber(parts[4]),
      volume: parseNumber(parts[5]),
    }))
    .filter((row) => row.close != null);

  if (rows.length === 0) {
    throw new Error(`stooq 결과 없음 (${symbol})`);
  }

  return rows.slice(-2);
}

async function buildPortfolioUniverse() {
  const [watchlist, portfolio] = await Promise.all([
    readJson(path.join(ROOT_DIR, "config", "watchlist.json"), {}),
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
  ]);

  const watchlistItems = [
    ...(watchlist?.core_etf ?? []).map((item) => ({ ...item, bucket: "core_etf", source: "watchlist" })),
    ...(watchlist?.satellite_etf ?? []).map((item) => ({ ...item, bucket: "satellite_etf", source: "watchlist" })),
    ...(watchlist?.individual_stocks ?? []).map((item) => ({ ...item, bucket: "individual_stocks", source: "watchlist" })),
  ];

  const byCode = new Map();
  for (const item of watchlistItems) {
    if (!item?.code) continue;
    byCode.set(item.code, {
      code: item.code,
      name: item.name,
      bucket: item.bucket ?? null,
      accountKeys: [],
      inPortfolio: false,
    });
  }

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      if (!holding?.code) continue;
      const existing = byCode.get(holding.code) ?? {
        code: holding.code,
        name: holding.name,
        bucket: null,
        accountKeys: [],
        inPortfolio: false,
      };
      byCode.set(holding.code, {
        ...existing,
        name: existing.name ?? holding.name,
        inPortfolio: true,
        accountKeys: [...new Set([...(existing.accountKeys ?? []), account.key])],
      });
    }
  }

  return [...byCode.values()];
}

function normalizeHoldingEntry(item, basic, prices, realtime) {
  const latest = prices?.[0] ?? {};
  const previous = prices?.[1] ?? {};
  const close = parseNumber(realtime?.nv ?? realtime?.closePrice ?? latest.closePrice ?? basic.closePrice);
  const previousClose =
    parseNumber(previous.closePrice) ??
    parseNumber(basic?.closePrice) - parseNumber(basic?.compareToPreviousClosePrice ?? 0);

  return {
    code: item.code,
    name: basic?.stockName ?? item.name ?? item.code,
    bucket: item.bucket ?? null,
    accountKeys: item.accountKeys ?? [],
    inPortfolio: Boolean(item.inPortfolio),
    close: roundNumber(close, 4),
    previousClose: roundNumber(previousClose, 4),
    change: roundNumber(close != null && previousClose != null ? close - previousClose : null, 4),
    changePct: roundNumber(percentChange(close, previousClose), 6),
    volume: parseNumber(latest.accumulatedTradingVolume ?? realtime?.aq),
    tradedAt: basic?.localTradedAt ?? latest?.localTradedAt ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const universe = await buildPortfolioUniverse();
  const [dailyMarket, fred] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "market", `${args.date}.json`), null),
    readJson(path.join(ROOT_DIR, "data", "macro", `fred-${args.date}.json`), null),
  ]);
  const snapshot = {
    date: args.date,
    collectedAt: new Date().toISOString(),
    source: "intraday-lite",
    macros: {},
    holdings: {},
  };

  for (const [label, symbol] of Object.entries(MACRO_SYMBOLS)) {
    try {
      const rows = await fetchStooqDailySeries(symbol);
      const latest = rows.at(-1);
      const previous = rows.at(-2) ?? null;
      snapshot.macros[label] = {
        symbol,
        close: roundNumber(latest?.close ?? null, 4),
        previousClose: roundNumber(previous?.close ?? null, 4),
        change: roundNumber(
          latest?.close != null && previous?.close != null ? latest.close - previous.close : null,
          4,
        ),
        changePct: roundNumber(percentChange(latest?.close ?? null, previous?.close ?? null), 6),
        tradedAt: latest?.date ?? null,
      };
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      const fallback =
        label === "VIX"
          ? {
              close: fred?.VIXCLS ?? dailyMarket?.macro?.VIX?.close ?? null,
              previousClose: dailyMarket?.macro?.VIX?.previous_close ?? null,
              change: dailyMarket?.macro?.VIX?.change ?? null,
              changePct: dailyMarket?.macro?.VIX?.change_pct ?? null,
              tradedAt: fred?.VIXCLS_date ?? dailyMarket?.macro?.VIX?.traded_at ?? null,
            }
          : {
              close: dailyMarket?.macro?.[label]?.close ?? null,
              previousClose: dailyMarket?.macro?.[label]?.previous_close ?? null,
              change: dailyMarket?.macro?.[label]?.change ?? null,
              changePct: dailyMarket?.macro?.[label]?.change_pct ?? null,
              tradedAt: dailyMarket?.macro?.[label]?.traded_at ?? null,
            };

      snapshot.macros[label] = {
        symbol,
        ...fallback,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  for (const item of universe) {
    try {
      const [basic, prices, realtime] = await Promise.all([
        fetchNaverDomesticBasic(item.code),
        fetchNaverDomesticPrice(item.code),
        fetchNaverDomesticRealtime(item.code),
      ]);
      snapshot.holdings[item.code] = normalizeHoldingEntry(item, basic, prices, realtime);
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      snapshot.holdings[item.code] = {
        code: item.code,
        name: item.name ?? item.code,
        bucket: item.bucket ?? null,
        accountKeys: item.accountKeys ?? [],
        inPortfolio: Boolean(item.inPortfolio),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  await writeJson(args.output, snapshot);
  await writeJson(path.join(ROOT_DIR, "data", "intraday", "latest-market-lite.json"), snapshot);
  console.log(args.output);
}

main().catch((error) => {
  console.error(`[fetch-market-data-lite] 실패: ${error.message}`);
  process.exit(1);
});
