#!/usr/bin/env node
// 관심 종목, ETF, 거시 지표 데이터를 수집하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { config as loadEnv } from 'dotenv';
import fetch from 'node-fetch';

loadEnv();

const REQUEST_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 15_000;

const STQOOQ_INDEX_SYMBOLS = {
  SP500: '^SPX',
  NASDAQ: '^NDQ',
};

const STQOOQ_MACRO_SYMBOLS = {
  GOLD: 'GC.F',
  USDKRW: 'USDKRW',
  WTI: 'CL.F',
};

function parseArgs(argv) {
  const args = { date: todayIso() };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = normalizeDate(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`잘못된 날짜 형식입니다: ${value}`);
  }

  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function parseNumber(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized || normalized === 'N/D' || normalized === 'null') {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentChange(current, previous) {
  if (current == null || previous == null || previous === 0) {
    return null;
  }

  return (current - previous) / previous;
}

function roundNumber(value, digits = 4) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return Number.parseFloat(value.toFixed(digits));
}

async function fetchText(url, headers = {}) {
  const { signal, clear } = createTimeoutSignal(FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        accept: 'application/json, text/plain, */*',
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
  const text = await fetchText(url, headers);
  return JSON.parse(text);
}

async function loadWatchlist() {
  const filePath = path.join(process.cwd(), 'config', 'watchlist.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function flattenWatchlist(watchlist) {
  return [
    ...(watchlist.core_etf ?? []).map((item) => ({ ...item, bucket: 'core_etf', type: 'etf' })),
    ...(watchlist.satellite_etf ?? []).map((item) => ({ ...item, bucket: 'satellite_etf', type: 'etf' })),
    ...(watchlist.individual_stocks ?? []).map((item) => ({ ...item, bucket: 'individual_stocks', type: 'stock' })),
  ];
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

async function fetchNaverIndexBasic(code) {
  return fetchJson(`https://m.stock.naver.com/api/index/${code}/basic`);
}

async function fetchNaverIndexPrice(code) {
  return fetchJson(`https://m.stock.naver.com/api/index/${code}/price?page=1&pageSize=2`);
}

function normalizeDomesticEntry(item, basic, prices, realtime) {
  const latest = prices?.[0] ?? {};
  const previous = prices?.[1] ?? {};
  const close = parseNumber(latest.closePrice ?? basic.closePrice);
  const previousClose = parseNumber(previous.closePrice) ?? close - parseNumber(basic.compareToPreviousClosePrice);
  const listedCount = parseNumber(realtime?.countOfListedStock);
  const marketCap =
    item.type === 'stock' && close != null && listedCount != null
      ? Math.round(close * listedCount)
      : null;

  return {
    code: item.code,
    name: basic.stockName ?? item.name,
    symbol: item.code,
    source: 'naver',
    account: item.account ?? null,
    bucket: item.bucket,
    type: item.type,
    close: roundNumber(close, 4),
    previous_close: roundNumber(previousClose, 4),
    change: roundNumber(parseNumber(basic.compareToPreviousClosePrice), 4),
    change_pct: roundNumber(parseNumber(basic.fluctuationsRatio) / 100, 6),
    open: roundNumber(parseNumber(latest.openPrice), 4),
    high: roundNumber(parseNumber(latest.highPrice), 4),
    low: roundNumber(parseNumber(latest.lowPrice), 4),
    volume: parseNumber(latest.accumulatedTradingVolume ?? realtime?.aq),
    fifty_two_week_high: null,
    fifty_two_week_low: null,
    market_cap: marketCap,
    nav: roundNumber(parseNumber(realtime?.nav), 4),
    currency: 'KRW',
    exchange: basic.stockExchangeName ?? null,
    traded_at: basic.localTradedAt ?? latest.localTradedAt ?? null,
  };
}

function normalizeKoreaIndex(basic, prices) {
  const latest = prices?.[0] ?? {};
  const previous = prices?.[1] ?? {};
  const close = parseNumber(latest.closePrice ?? basic.closePrice);
  const previousClose = parseNumber(previous.closePrice) ?? close - parseNumber(basic.compareToPreviousClosePrice);

  return {
    name: basic.stockName ?? 'KOSPI',
    symbol: 'KOSPI',
    source: 'naver',
    close: roundNumber(close, 4),
    previous_close: roundNumber(previousClose, 4),
    change: roundNumber(parseNumber(basic.compareToPreviousClosePrice), 4),
    change_pct: roundNumber(parseNumber(basic.fluctuationsRatio) / 100, 6),
    open: roundNumber(parseNumber(latest.openPrice), 4),
    high: roundNumber(parseNumber(latest.highPrice), 4),
    low: roundNumber(parseNumber(latest.lowPrice), 4),
    volume: null,
    currency: 'KRW',
    exchange: basic.stockExchangeName ?? 'KOSPI',
    traded_at: basic.localTradedAt ?? latest.localTradedAt ?? null,
  };
}

async function fetchStooqQuote(symbol) {
  const text = await fetchText(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=d`, {
    accept: 'text/plain,*/*',
  });

  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith('<'));

  if (!line) {
    throw new Error(`stooq 결과 없음 (${symbol})`);
  }

  const [code, date, time, open, high, low, close, volume] = line.split(',');

  return {
    code,
    date,
    time,
    open: parseNumber(open),
    high: parseNumber(high),
    low: parseNumber(low),
    close: parseNumber(close),
    volume: parseNumber(volume),
  };
}

function normalizeStooqEntry(name, symbol, quote) {
  return {
    name,
    symbol,
    source: 'stooq',
    close: roundNumber(quote.close, 4),
    previous_close: null,
    change: null,
    change_pct: null,
    open: roundNumber(quote.open, 4),
    high: roundNumber(quote.high, 4),
    low: roundNumber(quote.low, 4),
    volume: quote.volume,
    currency: null,
    exchange: null,
    traded_at: quote.date ? `${quote.date}T${quote.time || '000000'}` : null,
  };
}

async function fetchFredSeries(seriesId) {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`, {
    accept: 'text/csv,*/*',
  });

  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, value] = line.split(',');
      return { date, value: parseNumber(value) };
    })
    .filter((row) => row.value != null);

  if (rows.length === 0) {
    throw new Error(`FRED 결과 없음 (${seriesId})`);
  }

  return rows.slice(-2);
}

function normalizeFredEntry(name, seriesRows) {
  const latest = seriesRows.at(-1);
  const previous = seriesRows.at(-2) ?? null;

  return {
    name,
    symbol: name,
    source: 'fred',
    close: roundNumber(latest?.value, 4),
    previous_close: roundNumber(previous?.value ?? null, 4),
    change:
      latest?.value != null && previous?.value != null
        ? roundNumber(latest.value - previous.value, 4)
        : null,
    change_pct: roundNumber(percentChange(latest?.value ?? null, previous?.value ?? null), 6),
    open: null,
    high: null,
    low: null,
    volume: null,
    currency: null,
    exchange: null,
    traded_at: latest?.date ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.join(process.cwd(), 'data', 'market', `${args.date}.json`);
  const watchlist = await loadWatchlist();
  const watchlistItems = flattenWatchlist(watchlist);

  const output = {
    date: args.date,
    collected_at: new Date().toISOString(),
    indices: {},
    macro: {},
    watchlist: {},
  };

  try {
    const [kospiBasic, kospiPrices] = await Promise.all([
      fetchNaverIndexBasic('KOSPI'),
      fetchNaverIndexPrice('KOSPI'),
    ]);
    output.indices.KOSPI = normalizeKoreaIndex(kospiBasic, kospiPrices);
    console.log('- 지수 KOSPI 수집 완료 (naver)');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ 지수 수집 실패 (KOSPI): ${message}`);
  }

  for (const [label, symbol] of Object.entries(STQOOQ_INDEX_SYMBOLS)) {
    try {
      const quote = await fetchStooqQuote(symbol);
      output.indices[label] = normalizeStooqEntry(label, symbol, quote);
      console.log(`- 지수 ${label} 수집 완료 (stooq)`);
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ 지수 수집 실패 (${label}): ${message}`);
    }
  }

  try {
    const vixRows = await fetchFredSeries('VIXCLS');
    output.macro.VIX = normalizeFredEntry('VIX', vixRows);
    console.log('- 매크로 VIX 수집 완료 (fred)');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ 매크로 수집 실패 (VIX): ${message}`);
  }

  for (const [label, symbol] of Object.entries(STQOOQ_MACRO_SYMBOLS)) {
    try {
      const quote = await fetchStooqQuote(symbol);
      output.macro[label] = normalizeStooqEntry(label, symbol, quote);
      console.log(`- 매크로 ${label} 수집 완료 (stooq)`);
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ 매크로 수집 실패 (${label}): ${message}`);
    }
  }

  for (const item of watchlistItems) {
    try {
      const [basic, prices, realtime] = await Promise.all([
        fetchNaverDomesticBasic(item.code),
        fetchNaverDomesticPrice(item.code),
        fetchNaverDomesticRealtime(item.code),
      ]);

      output.watchlist[item.code] = normalizeDomesticEntry(item, basic, prices, realtime);
      console.log(`- 관심종목 ${item.name} 수집 완료 (naver)`);
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ 관심종목 수집 실패 (${item.name}): ${message}`);
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('✅ 시장 데이터 저장 완료');
  console.log(`📁 ${outputPath}`);
}

main().catch((error) => {
  console.error(`❌ fetch-market-data 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
