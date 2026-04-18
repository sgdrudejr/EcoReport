#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ADX, ATR, EMA, RSI, SMA, Stochastic } from "technicalindicators";

import {
  parseDateArgs,
  readJson,
  resolveSecurityCodeFromCandidates,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { buildStockPilotInput, scoreStockPilotInput } from "./lib/stockpilot-quant.js";

const SCORE_KEYS = [
  "Score_RS",
  "Score_Ichimoku",
  "Score_ADX_Mom",
  "Score_HA",
  "Score_Keltner_Vol",
  "Score_POC",
  "Score_VWAP",
  "Score_Resistance_Break",
  "Score_Div",
  "Score_GC",
  "Score_Stoch",
  "Score_Disp",
];

function parseCli(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    strategy: "momentum",
    input: null,
    output: null,
    markdown: null,
    minDate: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--strategy" && argv[index + 1]) {
      args.strategy = argv[index + 1];
      index += 1;
    } else if (token === "--input" && argv[index + 1]) {
      args.input = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (token === "--markdown" && argv[index + 1]) {
      args.markdown = argv[index + 1];
      index += 1;
    } else if (token === "--min-date" && argv[index + 1]) {
      args.minDate = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function roundNumber(value, digits = 4) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number.parseFloat(value.toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values, avg) {
  if (values.length < 2 || avg == null) return null;
  return values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1);
}

function stddev(values, avg) {
  const value = variance(values, avg);
  return value == null ? null : Math.sqrt(value);
}

function effectSize(posValues, negValues) {
  const posMean = mean(posValues);
  const negMean = mean(negValues);
  const posVar = variance(posValues, posMean) ?? 0;
  const negVar = variance(negValues, negMean) ?? 0;
  const pooled = Math.sqrt((posVar + negVar) / 2);
  if (posMean == null || negMean == null || !(pooled > 0)) return null;
  return (posMean - negMean) / pooled;
}

function compactLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let timeout = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.json();
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      lastError = error;
      if (attempt < attempts) {
        await sleep(350 * attempt);
      }
    }
  }
  throw lastError ?? new Error(`fetch failed: ${url}`);
}

async function fetchText(url, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let timeout = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      lastError = error;
      if (attempt < attempts) {
        await sleep(350 * attempt);
      }
    }
  }
  throw lastError ?? new Error(`fetch failed: ${url}`);
}

async function fetchKrNameCatalog() {
  const python = `
import json, re, urllib.request
url = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=20) as response:
    html = response.read().decode("euc-kr", "ignore")
rows = re.findall(r"<tr>([\\s\\S]*?)</tr>", html, flags=re.I)
items = []
for row in rows:
    cells = [re.sub(r"<[^>]+>", "", cell).strip() for cell in re.findall(r"<t[hd][^>]*>([\\s\\S]*?)</t[hd]>", row, flags=re.I)]
    if len(cells) < 3:
        continue
    name = re.sub(r"\\s+", " ", cells[0]).strip()
    market = re.sub(r"\\s+", " ", cells[1]).strip()
    code = str(cells[2]).strip().zfill(6)
    if re.fullmatch(r"\\d{6}", code):
        items.append({"name": name, "code": code, "market": market})
print(json.dumps(items, ensure_ascii=False))
  `.trim();
  const raw = execFileSync("python3", ["-c", python], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const rows = JSON.parse(raw);
  const codeByName = new Map();
  const marketByCode = new Map();
  for (const row of rows) {
    if (row?.name && row?.code) {
      codeByName.set(row.name, row.code);
      if (row.market) {
        marketByCode.set(row.code, row.market);
      }
    }
  }
  return { codeByName, marketByCode };
}

async function resolveTradeCodes(historyPayload) {
  const krxCatalog = await fetchKrNameCatalog();
  const unresolved = [];

  const decorate = (row) => {
    const code =
      resolveSecurityCodeFromCandidates(row.code) ??
      krxCatalog.codeByName.get(row.name) ??
      resolveSecurityCodeFromCandidates(row.name) ??
      null;
    if (!code) unresolved.push(row.name);
    return { ...row, code, marketHint: code ? (krxCatalog.marketByCode.get(code) ?? null) : null };
  };

  return {
    currentHoldings: (historyPayload.currentHoldings ?? []).map(decorate),
    tradeHistory: (historyPayload.tradeHistory ?? []).map(decorate),
    unresolvedNames: [...new Set(unresolved)].sort(),
    marketByCode: krxCatalog.marketByCode,
  };
}

async function fetchYahooHistory(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    "?range=2y&interval=1d&includeAdjustedClose=true";
  const payload = await fetchJson(url);
  const result = payload?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart result for ${symbol}`);
  }

  const quote = result.indicators?.quote?.[0] ?? {};
  const timestamps = result.timestamp ?? [];
  const rows = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const ts = timestamps[index];
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    const open = quote.open?.[index] ?? null;
    const high = quote.high?.[index] ?? null;
    const low = quote.low?.[index] ?? null;
    const close = quote.close?.[index] ?? null;
    const volume = quote.volume?.[index] ?? null;
    if ([open, high, low, close].some((value) => value == null || !Number.isFinite(value))) continue;
    rows.push({
      date,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  return rows;
}

async function fetchNaverHistory(symbol) {
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(symbol)}&timeframe=day&count=700&requestType=0`;
  const xml = await fetchText(url);
  const matches = [...xml.matchAll(/<item[^>]*data="([^"]+)"/g)];
  const rows = [];
  for (const match of matches) {
    const data = match[1];
    const [yyyymmdd, openText, highText, lowText, closeText, volumeText] = String(data ?? "").split("|");
    if (!/^\d{8}$/.test(String(yyyymmdd ?? ""))) continue;
    const open = Number(openText);
    const high = Number(highText);
    const low = Number(lowText);
    const close = Number(closeText);
    const volume = Number(volumeText);
    if ([open, high, low, close].some((value) => !Number.isFinite(value))) continue;
    rows.push({
      date: `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return rows;
}

function inferExchangeFromMarketHint(marketHint) {
  const normalized = String(marketHint ?? "").toUpperCase();
  if (normalized.includes("코스닥") || normalized.includes("KOSDAQ")) return "KOSDAQ";
  if (normalized.includes("코스피") || normalized.includes("KOSPI")) return "KOSPI";
  return "KOSPI";
}

function inferSuffixOrderFromMarket(marketHint) {
  const normalized = String(marketHint ?? "").toUpperCase();
  if (normalized.includes("코스닥") || normalized.includes("KOSDAQ")) {
    return [".KQ", ".KS"];
  }
  if (normalized.includes("코스피") || normalized.includes("KOSPI")) {
    return [".KS", ".KQ"];
  }
  return [".KS", ".KQ"];
}

async function fetchYahooHistoryForCode(code, marketHint = null) {
  const suffixes = inferSuffixOrderFromMarket(marketHint);
  for (const suffix of suffixes) {
    try {
      const history = await fetchYahooHistory(`${code}${suffix}`);
      if (history.length >= 120) {
        return {
          symbol: `${code}${suffix}`,
          exchange: suffix === ".KS" ? "KOSPI" : "KOSDAQ",
          history,
        };
      }
    } catch {
      // try next suffix
    }
  }
  try {
    const history = await fetchNaverHistory(code);
    if (history.length >= 120) {
      return {
        symbol: `${code}.NAVER`,
        exchange: inferExchangeFromMarketHint(marketHint),
        history,
      };
    }
  } catch {
    // ignore naver fallback errors
  }
  return null;
}

async function fetchBenchmarkHistory(benchmarkCode) {
  try {
    return await fetchYahooHistory(benchmarkCode);
  } catch {
    const naverSymbol = benchmarkCode === "^KQ11" ? "KOSDAQ" : "KOSPI";
    return await fetchNaverHistory(naverSymbol);
  }
}

function alignSeries(sourceLength, values) {
  const padding = Math.max(sourceLength - values.length, 0);
  return Array.from({ length: padding }, () => null).concat(values);
}

function findPivotIndexes(values, mode, left = 2, right = 2) {
  const pivots = [];
  for (let index = left; index < values.length - right; index += 1) {
    const pivot = values[index];
    if (pivot == null || Number.isNaN(pivot)) continue;
    let isPivot = true;
    for (let offset = 1; offset <= left; offset += 1) {
      const candidate = values[index - offset];
      if (candidate == null || Number.isNaN(candidate)) {
        isPivot = false;
        break;
      }
      if (mode === "low" ? pivot > candidate : pivot < candidate) {
        isPivot = false;
        break;
      }
    }
    if (!isPivot) continue;
    for (let offset = 1; offset <= right; offset += 1) {
      const candidate = values[index + offset];
      if (candidate == null || Number.isNaN(candidate)) {
        isPivot = false;
        break;
      }
      if (mode === "low" ? pivot > candidate : pivot < candidate) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) pivots.push(index);
  }
  return pivots;
}

function detectRsiDivergence(history, rsiSeries) {
  if (!Array.isArray(history) || history.length < 25 || !Array.isArray(rsiSeries) || rsiSeries.length < 10) {
    return { reference: null };
  }
  const lookback = Math.min(45, history.length);
  const startIndex = history.length - lookback;
  const lows = history.slice(startIndex).map((row) => row.low);
  const highs = history.slice(startIndex).map((row) => row.high);
  const alignedRsi = alignSeries(history.length, rsiSeries).slice(startIndex);
  const lowPivots = findPivotIndexes(lows, "low").filter((index) => alignedRsi[index] != null);
  const highPivots = findPivotIndexes(highs, "high").filter((index) => alignedRsi[index] != null);
  const latestLowPair = lowPivots.length >= 2 ? lowPivots.slice(-2) : null;
  const latestHighPair = highPivots.length >= 2 ? highPivots.slice(-2) : null;
  const bullish =
    latestLowPair &&
    lows[latestLowPair[1]] < lows[latestLowPair[0]] * 0.997 &&
    alignedRsi[latestLowPair[1]] > alignedRsi[latestLowPair[0]] + 3;
  const bearish =
    latestHighPair &&
    highs[latestHighPair[1]] > highs[latestHighPair[0]] * 1.003 &&
    alignedRsi[latestHighPair[1]] < alignedRsi[latestHighPair[0]] - 3;

  if (bullish && latestLowPair) {
    const [previousIndex, latestIndex] = latestLowPair;
    return {
      reference: {
        previousDate: history[startIndex + previousIndex].date,
        latestDate: history[startIndex + latestIndex].date,
        previousPrice: roundNumber(lows[previousIndex], 4),
        latestPrice: roundNumber(lows[latestIndex], 4),
        previousRsi: roundNumber(alignedRsi[previousIndex], 2),
        latestRsi: roundNumber(alignedRsi[latestIndex], 2),
      },
    };
  }

  if (bearish && latestHighPair) {
    const [previousIndex, latestIndex] = latestHighPair;
    return {
      reference: {
        previousDate: history[startIndex + previousIndex].date,
        latestDate: history[startIndex + latestIndex].date,
        previousPrice: roundNumber(highs[previousIndex], 4),
        latestPrice: roundNumber(highs[latestIndex], 4),
        previousRsi: roundNumber(alignedRsi[previousIndex], 2),
        latestRsi: roundNumber(alignedRsi[latestIndex], 2),
      },
    };
  }

  return { reference: null };
}

function deriveDivergenceMetrics(divergence) {
  const reference = divergence?.reference ?? null;
  if (!reference) return { price_drop_ratio: null, rsi_rise_value: null };

  return {
    price_drop_ratio:
      reference.previousPrice != null && reference.previousPrice !== 0 && reference.latestPrice != null
        ? roundNumber((reference.latestPrice - reference.previousPrice) / reference.previousPrice, 6)
        : null,
    rsi_rise_value:
      reference.previousRsi != null && reference.latestRsi != null
        ? roundNumber(reference.latestRsi - reference.previousRsi, 4)
        : null,
  };
}

function highest(values, period, endIndex) {
  if (endIndex - period + 1 < 0) return null;
  const window = values.slice(endIndex - period + 1, endIndex + 1).filter((value) => value != null);
  if (window.length < period) return null;
  return Math.max(...window);
}

function lowest(values, period, endIndex) {
  if (endIndex - period + 1 < 0) return null;
  const window = values.slice(endIndex - period + 1, endIndex + 1).filter((value) => value != null);
  if (window.length < period) return null;
  return Math.min(...window);
}

function computeHeikinAshi(history) {
  let prevOpen = null;
  let prevClose = null;
  let latest = null;
  for (const row of history) {
    const haClose = (row.open + row.high + row.low + row.close) / 4;
    const haOpen =
      prevOpen == null || prevClose == null
        ? (row.open + row.close) / 2
        : (prevOpen + prevClose) / 2;
    latest = { open: roundNumber(haOpen, 4), close: roundNumber(haClose, 4) };
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return latest;
}

function computeIchimoku(highs, lows) {
  if (highs.length < 78) return null;
  const spanAShifted = Array.from({ length: highs.length }, () => null);
  const spanBShifted = Array.from({ length: highs.length }, () => null);
  for (let index = 0; index < highs.length; index += 1) {
    const convHigh = highest(highs, 9, index);
    const convLow = lowest(lows, 9, index);
    const baseHigh = highest(highs, 26, index);
    const baseLow = lowest(lows, 26, index);
    const spanBHigh = highest(highs, 52, index);
    const spanBLow = lowest(lows, 52, index);
    if (convHigh == null || convLow == null || baseHigh == null || baseLow == null) continue;
    const conversion = (convHigh + convLow) / 2;
    const base = (baseHigh + baseLow) / 2;
    const spanA = (conversion + base) / 2;
    const spanB = spanBHigh != null && spanBLow != null ? (spanBHigh + spanBLow) / 2 : null;
    const shiftedIndex = index + 26;
    if (shiftedIndex < highs.length) {
      spanAShifted[shiftedIndex] = spanA;
      if (spanB != null) spanBShifted[shiftedIndex] = spanB;
    }
  }
  return {
    senkou_span_a: roundNumber(spanAShifted.at(-1), 4),
    senkou_span_b: roundNumber(spanBShifted.at(-1), 4),
  };
}

function computeApproxVolumeProfilePoc(history, window = 120, bins = 24) {
  const sample = history.slice(-window);
  if (sample.length < 20) return null;
  const typicalPrices = sample.map((row) => (row.high + row.low + row.close) / 3);
  const minPrice = Math.min(...typicalPrices);
  const maxPrice = Math.max(...typicalPrices);
  const range = maxPrice - minPrice;
  if (!(range > 0)) return roundNumber(typicalPrices.at(-1), 4);
  const bucketWidth = range / bins;
  const histogram = Array.from({ length: bins }, () => 0);
  for (let index = 0; index < sample.length; index += 1) {
    const price = typicalPrices[index];
    const volume = sample[index].volume ?? 0;
    const bucket = Math.min(Math.floor((price - minPrice) / bucketWidth), bins - 1);
    histogram[bucket] += volume;
  }
  const maxVolume = Math.max(...histogram);
  const maxIndex = histogram.findIndex((value) => value === maxVolume);
  if (maxIndex < 0) return null;
  return roundNumber(minPrice + (bucketWidth * (maxIndex + 0.5)), 4);
}

function computeAnchoredVwapApprox(history, anchorWindow = 20) {
  const sample = history.slice(-anchorWindow);
  if (sample.length < 5) return null;
  let weighted = 0;
  let volumeTotal = 0;
  for (const row of sample) {
    const price = (row.high + row.low + row.close) / 3;
    const volume = row.volume ?? 0;
    weighted += price * volume;
    volumeTotal += volume;
  }
  if (!(volumeTotal > 0)) return null;
  return roundNumber(weighted / volumeTotal, 4);
}

function computeRelativeStrength(history, benchmarkHistory, window = 63) {
  const securityMap = new Map(history.map((row) => [row.date, row.close]));
  const benchmarkMap = new Map(benchmarkHistory.map((row) => [row.date, row.close]));
  const commonDates = history
    .map((row) => row.date)
    .filter((date) => securityMap.has(date) && benchmarkMap.has(date))
    .sort();
  if (commonDates.length <= window) return null;
  const latestDate = commonDates.at(-1);
  const baseDate = commonDates.at(-(window + 1));
  const securityLatest = securityMap.get(latestDate);
  const securityBase = securityMap.get(baseDate);
  const benchmarkLatest = benchmarkMap.get(latestDate);
  const benchmarkBase = benchmarkMap.get(baseDate);
  if (
    securityLatest == null ||
    securityBase == null ||
    benchmarkLatest == null ||
    benchmarkBase == null ||
    securityBase === 0 ||
    benchmarkBase === 0
  ) {
    return null;
  }
  return roundNumber((securityLatest / securityBase - 1) - (benchmarkLatest / benchmarkBase - 1), 6);
}

function getLatestAndPrevious(series) {
  if (!Array.isArray(series) || series.length === 0) {
    return { latest: null, previous: null };
  }
  return {
    latest: series.at(-1) ?? null,
    previous: series.at(-2) ?? null,
  };
}

function buildTechnicalSnapshot(history, benchmarkHistory, benchmarkCode, exchange) {
  const closes = history.map((row) => row.close);
  const highs = history.map((row) => row.high);
  const lows = history.map((row) => row.low);
  const volumes = history.map((row) => row.volume ?? 0);

  const ma20 = getLatestAndPrevious(SMA.calculate({ period: 20, values: closes })).latest;
  const ma60 = getLatestAndPrevious(SMA.calculate({ period: 60, values: closes })).latest;
  const ma120 = getLatestAndPrevious(SMA.calculate({ period: 120, values: closes })).latest;
  const volumeMa20 = getLatestAndPrevious(SMA.calculate({ period: 20, values: volumes })).latest;
  const ema20 = getLatestAndPrevious(EMA.calculate({ period: 20, values: closes })).latest;
  const rsiSeries = RSI.calculate({ period: 14, values: closes });
  const rsi = getLatestAndPrevious(rsiSeries).latest;
  const stochastic = getLatestAndPrevious(
    Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    }),
  ).latest;
  const adx = getLatestAndPrevious(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 })).latest;
  const atr = getLatestAndPrevious(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 })).latest;

  const close = closes.at(-1) ?? null;
  const heikinAshi = computeHeikinAshi(history);
  const ichimoku = computeIchimoku(highs, lows);
  const divergence = deriveDivergenceMetrics(detectRsiDivergence(history, rsiSeries));

  return {
    close,
    close_252d: closes.length >= 253 ? closes.at(-253) : null,
    ma: {
      ma20: roundNumber(ma20, 4),
      ma60: roundNumber(ma60, 4),
      ma120: roundNumber(ma120, 4),
    },
    heikin_ashi: heikinAshi,
    volume_current: roundNumber(volumes.at(-1) ?? null, 4),
    volume_ma_20: roundNumber(volumeMa20, 4),
    keltner: {
      upper: ema20 != null && atr != null ? roundNumber(ema20 + (atr * 2), 4) : null,
      lower: ema20 != null && atr != null ? roundNumber(ema20 - (atr * 2), 4) : null,
    },
    anchored_vwap: {
      value: computeAnchoredVwapApprox(history, 20),
      anchor_type: "rolling_20d_approx",
    },
    volume_profile: {
      poc_price_120d: computeApproxVolumeProfilePoc(history, 120),
      method: "daily_typical_price_histogram",
    },
    ichimoku,
    adx: adx
      ? {
          value: roundNumber(adx.adx, 2),
          pdi: roundNumber(adx.pdi, 2),
          mdi: roundNumber(adx.mdi, 2),
        }
      : { value: null, pdi: null, mdi: null },
    stochastic: stochastic
      ? {
          k: roundNumber(stochastic.k, 2),
          d: roundNumber(stochastic.d, 2),
        }
      : { k: null, d: null },
    rsi: roundNumber(rsi, 2),
    relative_strength: {
      benchmark_used: benchmarkCode,
      window_days: 63,
      rs_vs_benchmark: computeRelativeStrength(history, benchmarkHistory, 63),
    },
    rsi_divergence_metrics: divergence,
    exchange,
  };
}

function extractMacroValues(data) {
  if (!data || typeof data !== "object") return null;
  const vix_close = typeof data.VIXCLS === "number" ? data.VIXCLS : null;
  const yield_spread_10y_2y = typeof data.T10Y2Y === "number" ? data.T10Y2Y : null;
  if (vix_close == null || yield_spread_10y_2y == null) return null;
  return {
    vix_close,
    yield_spread_10y_2y,
  };
}

async function buildMacroLookup() {
  const macroDir = path.join(process.cwd(), "data", "macro");
  let files = [];
  try {
    files = await fs.readdir(macroDir);
  } catch {
    return {
      availableDates: [],
      completeDates: [],
      resolveMacroForDate: () => null,
    };
  }

  const dates = files
    .map((file) => file.match(/^fred-(\d{4}-\d{2}-\d{2})\.json$/)?.[1] ?? null)
    .filter(Boolean)
    .sort();

  const complete = [];
  for (const date of dates) {
    const data = await readJson(path.join(macroDir, `fred-${date}.json`), null);
    const macro = extractMacroValues(data);
    if (macro) {
      complete.push({ date, ...macro });
    }
  }

  return {
    availableDates: dates,
    completeDates: complete.map((item) => item.date),
    resolveMacroForDate: (targetDate) => {
      for (let index = complete.length - 1; index >= 0; index -= 1) {
        const item = complete[index];
        if (item.date <= targetDate) {
          return {
            macroDate: item.date,
            vix_close: item.vix_close,
            yield_spread_10y_2y: item.yield_spread_10y_2y,
          };
        }
      }
      return null;
    },
  };
}

function normalizeTradeEvents(historyPayload) {
  const buyEvents = [];
  const seenBuys = new Set();
  for (const row of historyPayload.currentHoldings ?? []) {
    if (!row.code || !row.buyDate) continue;
    const key = `${row.code}:${row.buyDate}`;
    if (seenBuys.has(key)) continue;
    seenBuys.add(key);
    buyEvents.push({
      side: "BUY",
      date: row.buyDate,
      code: row.code,
      name: row.name,
      source: "current_holding",
    });
  }
  for (const row of historyPayload.tradeHistory ?? []) {
    if (row.code && row.buyDate) {
      const key = `${row.code}:${row.buyDate}`;
      if (!seenBuys.has(key)) {
        seenBuys.add(key);
        buyEvents.push({
          side: "BUY",
          date: row.buyDate,
          code: row.code,
          name: row.name,
          source: "exit_history",
        });
      }
    }
  }

  const exitEvents = (historyPayload.tradeHistory ?? [])
    .filter((row) => row.code && row.exitDate)
    .map((row) => ({
      side: "EXIT",
      date: row.exitDate,
      code: row.code,
      name: row.name,
      source: "exit_history",
      buyDate: row.buyDate ?? null,
    }));

  return {
    buyEvents: buyEvents.sort((left, right) => left.date.localeCompare(right.date) || left.code.localeCompare(right.code)),
    exitEvents: exitEvents.sort((left, right) => left.date.localeCompare(right.date) || left.code.localeCompare(right.code)),
  };
}

function filterEventsWithMacroCoverage(events, { minDate, resolveMacroForDate }) {
  return events.filter((event) => {
    if (!event?.date) return false;
    if (minDate && event.date < minDate) return false;
    return resolveMacroForDate(event.date) != null;
  });
}

function describeFactor(key) {
  const labels = {
    Score_RS: "상대강도",
    Score_Ichimoku: "구름대 상향 이탈",
    Score_ADX_Mom: "ADX+12개월 모멘텀",
    Score_HA: "하이킨 아시 양봉",
    Score_Keltner_Vol: "켈트너 돌파+거래량",
    Score_POC: "POC 접근성",
    Score_VWAP: "앵커드 VWAP 접근성",
    Score_Resistance_Break: "저항 돌파 접근성",
    Score_Div: "RSI 다이버전스",
    Score_GC: "20-60 골든크로스",
    Score_Stoch: "스토캐스틱 타점",
    Score_Disp: "20일선 이격",
  };
  return labels[key] ?? key;
}

function summarizeFactorAttribution(positiveRows, negativeRows, keys, polarity = "positive") {
  const summary = [];
  for (const key of keys) {
    const posValues = positiveRows.map((row) => row.factors?.[key]).filter((value) => typeof value === "number");
    const negValues = negativeRows.map((row) => row.factors?.[key]).filter((value) => typeof value === "number");
    if (posValues.length < 2 || negValues.length < 2) continue;
    const delta = (mean(posValues) ?? 0) - (mean(negValues) ?? 0);
    const effect = effectSize(posValues, negValues);
    if (effect == null) continue;
    summary.push({
      key,
      label: describeFactor(key),
      meanPositive: roundNumber(mean(posValues), 3),
      meanNegative: roundNumber(mean(negValues), 3),
      delta: roundNumber(delta, 3),
      effect: roundNumber(effect, 3),
      interpretation:
        polarity === "positive"
          ? delta >= 0
            ? "매수 쪽에서 더 높게 관측"
            : "매수 쪽에서 더 낮게 관측"
          : delta <= 0
            ? "매도 쪽에서 더 낮게 관측"
            : "매도 쪽에서 더 높게 관측",
    });
  }

  return summary.sort((left, right) => Math.abs(right.effect) - Math.abs(left.effect));
}

function summarizeGateAttribution(positiveRows, negativeRows) {
  const gates = [
    "price_above_ma120",
    "vix_below_30",
    "yield_spread_above_-0.5",
    "keltner_break_and_volume",
    "price_above_poc",
    "price_above_vwap_anchored",
    "bullish_divergence_detected",
    "golden_cross_active",
    "stoch_k_above_d_and_below_80",
  ];
  return gates
    .map((key) => {
      const posRate = positiveRows.length
        ? positiveRows.filter((row) => row.gates?.[key] === true).length / positiveRows.length
        : 0;
      const negRate = negativeRows.length
        ? negativeRows.filter((row) => row.gates?.[key] === true).length / negativeRows.length
        : 0;
      return {
        key,
        positiveRate: roundNumber(posRate, 3),
        negativeRate: roundNumber(negRate, 3),
        delta: roundNumber(posRate - negRate, 3),
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

function buildOpenIntervals(historyPayload, asOfDate) {
  const intervals = [];
  for (const row of historyPayload.tradeHistory ?? []) {
    if (!row.code || !row.buyDate || !row.exitDate) continue;
    intervals.push({ code: row.code, name: row.name, buyDate: row.buyDate, exitDate: row.exitDate });
  }
  for (const row of historyPayload.currentHoldings ?? []) {
    if (!row.code || !row.buyDate) continue;
    intervals.push({ code: row.code, name: row.name, buyDate: row.buyDate, exitDate: asOfDate });
  }
  return intervals;
}

function inferStyle(buyFactors) {
  const topKeys = buyFactors.slice(0, 5).map((item) => item.key);
  const trendHits = topKeys.filter((key) =>
    ["Score_RS", "Score_Ichimoku", "Score_ADX_Mom", "Score_HA", "Score_GC", "Score_Keltner_Vol"].includes(key),
  ).length;
  const timingHits = topKeys.filter((key) =>
    ["Score_Stoch", "Score_Disp", "Score_Div", "Score_POC", "Score_VWAP"].includes(key),
  ).length;

  if (trendHits >= 3 && timingHits <= 2) {
    return "RS 기반 추세추종 + 돌파 확인형";
  }
  if (trendHits >= 2 && timingHits >= 2) {
    return "추세추종 + 과열/타점 보정 혼합형";
  }
  return "단순 추세형보다는 혼합형";
}

function renderMarkdown(report) {
  const buyTop = report.buyAttribution.topFactors.slice(0, 5);
  const exitTop = report.exitAttribution.topFactors.slice(0, 5);
  return [
    `# StockEasy ${report.strategyLabel} 역추정 요약`,
    "",
    `- 분석 기준일: ${report.asOfDate}`,
    `- 매수 이벤트: ${report.coverage.buyEventsAnalyzed}/${report.coverage.buyEventsTotal}건`,
    `- 매도 이벤트: ${report.coverage.exitEventsAnalyzed}/${report.coverage.exitEventsTotal}건`,
    `- 코드 해석 실패: ${report.coverage.unresolvedNames.length}건`,
    `- 추정 스타일: ${report.inference.likelyStyle}`,
    "",
    "## 매수 쪽 강한 팩터",
    ...buyTop.map(
      (item, index) =>
        `${index + 1}. ${item.label}: 평균 차이 ${item.delta}, 효과크기 ${item.effect} (${item.interpretation})`,
    ),
    "",
    "## 매도 쪽 강한 팩터",
    ...(exitTop.length
      ? exitTop.map(
          (item, index) =>
            `${index + 1}. ${item.label}: 평균 차이 ${item.delta}, 효과크기 ${item.effect} (${item.interpretation})`,
        )
      : ["1. 매도 샘플이 아직 적어 방향성 해석은 참고 수준입니다."]),
    "",
    "## 해석",
    `- 이 전략은 ${report.inference.likelyStyle}에 가장 가깝습니다.`,
    `- 최근 데이터 기준으로 매수는 ${buyTop
      .slice(0, 3)
      .map((item) => item.label)
      .join(", ")} 쪽이 상대적으로 강했습니다.`,
    exitTop.length
      ? `- 매도는 ${exitTop
          .slice(0, 3)
          .map((item) => item.label)
          .join(", ")} 약화가 같이 보였습니다.`
      : "- 매도는 최근 커버 샘플이 적어 추가 수집이 필요합니다.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  const inputPath =
    args.input ??
    path.join(
      process.cwd(),
      "data",
      "external",
      "stockeasy",
      args.date,
      `${args.strategy}-trade-history.json`,
    );
  const outputPath =
    args.output ??
    path.join(
      process.cwd(),
      "data",
      "analysis-state",
      args.date,
      `stockeasy-${args.strategy}-reverse-engineering.json`,
    );
  const markdownPath =
    args.markdown ??
    path.join(
      process.cwd(),
      "knowledge",
      "daily",
      `${args.date}-stockeasy-${args.strategy}-reverse-engineering.md`,
    );

  const rawPayload = await readJson(inputPath, null);
  if (!rawPayload) {
    throw new Error(`StockEasy history not found: ${inputPath}`);
  }

  const resolved = await resolveTradeCodes(rawPayload);
  const historyPayload = {
    ...rawPayload,
    currentHoldings: resolved.currentHoldings,
    tradeHistory: resolved.tradeHistory,
  };
  const macroLookup = await buildMacroLookup();
  const { buyEvents, exitEvents } = normalizeTradeEvents(historyPayload);
  const analyzedBuyEvents = filterEventsWithMacroCoverage(buyEvents, {
    minDate: args.minDate,
    resolveMacroForDate: macroLookup.resolveMacroForDate,
  });
  const analyzedExitEvents = filterEventsWithMacroCoverage(exitEvents, {
    minDate: args.minDate,
    resolveMacroForDate: macroLookup.resolveMacroForDate,
  });
  const universeCodes = [
    ...new Set(
      [
        ...analyzedBuyEvents.map((item) => item.code),
        ...analyzedExitEvents.map((item) => item.code),
      ].filter(Boolean),
    ),
  ];
  const codeMarketHints = new Map();
  for (const row of [...historyPayload.currentHoldings, ...historyPayload.tradeHistory]) {
    if (!row?.code) continue;
    if (!codeMarketHints.has(row.code) && row.marketHint) {
      codeMarketHints.set(row.code, row.marketHint);
    }
  }
  const analysisBlockedReason =
    universeCodes.length === 0
      ? "No analyzable events with macro coverage. Generate more data/macro/fred-YYYY-MM-DD.json or widen min-date."
      : null;

  const codeMarketCache = new Map();
  const benchmarkCache = new Map();
  const macroCache = new Map();

  async function getCodeMarket(code) {
    if (!codeMarketCache.has(code)) {
      codeMarketCache.set(code, fetchYahooHistoryForCode(code, codeMarketHints.get(code) ?? null));
    }
    return codeMarketCache.get(code);
  }

  async function getBenchmarkHistory(benchmarkCode) {
    if (!benchmarkCache.has(benchmarkCode)) {
      benchmarkCache.set(benchmarkCode, fetchBenchmarkHistory(benchmarkCode));
    }
    return benchmarkCache.get(benchmarkCode);
  }

  async function scoreCodeOnDate(code, date) {
    const debug = { code, date };
    const market = await getCodeMarket(code);
    if (!market) {
      debug.reason = "missing_market";
      return { ok: false, reason: "missing_market", debug };
    }

    debug.symbol = market.symbol;
    debug.exchange = market.exchange;

    if (!macroCache.has(date)) {
      macroCache.set(date, macroLookup.resolveMacroForDate(date));
    }
    const macro = macroCache.get(date);
    if (!macro) {
      debug.reason = "missing_macro";
      return { ok: false, reason: "missing_macro", debug };
    }

    debug.macroDate = macro.macroDate;
    debug.macro = {
      vix_close: macro.vix_close,
      yield_spread_10y_2y: macro.yield_spread_10y_2y,
    };

    const history = market.history.filter((row) => row.date <= date);
    debug.historyLength = history.length;
    if (history.length < 120) {
      debug.reason = "insufficient_history";
      return { ok: false, reason: "insufficient_history", debug };
    }

    const benchmarkCode = market.exchange === "KOSDAQ" ? "^KQ11" : "^KS11";
    const benchmarkHistory = (await getBenchmarkHistory(benchmarkCode)).filter((row) => row.date <= date);
    debug.benchmarkCode = benchmarkCode;
    debug.benchmarkLength = benchmarkHistory.length;
    if (benchmarkHistory.length < 120) {
      debug.reason = "insufficient_benchmark_history";
      return { ok: false, reason: "insufficient_benchmark_history", debug };
    }

    const technicalItem = buildTechnicalSnapshot(history, benchmarkHistory, benchmarkCode, market.exchange);
    const input = buildStockPilotInput({
      code,
      name: code,
      asOfDate: date,
      technicalItem,
      macro,
      sourceType: "external_strategy",
      sourceMeta: { strategy: rawPayload.strategy?.key ?? args.strategy },
    });
    const score = scoreStockPilotInput(input);
    debug.reason = "ok";
    debug.finalScore = score.final_score;
    debug.filterScore = score.filter_score;
    debug.flags = score.data_quality_flags;
    return { ok: true, score, debug };
  }

  const dailyUniverseScores = new Map();
  const dailyUniverseDiagnostics = new Map();
  async function getUniverseScores(date) {
    if (dailyUniverseScores.has(date)) return dailyUniverseScores.get(date);
    const entries = [];
    const diagnostics = [];
    for (const code of universeCodes) {
      const outcome = await scoreCodeOnDate(code, date);
      diagnostics.push(outcome.debug ?? { code, date, reason: "missing_debug" });
      if (outcome.ok && outcome.score) entries.push(outcome.score);
    }
    dailyUniverseScores.set(date, entries);
    dailyUniverseDiagnostics.set(date, diagnostics);
    return entries;
  }

  const buyPositiveRows = [];
  const buyNegativeRows = [];
  const buyDebug = [];

  for (const eventDate of [...new Set(analyzedBuyEvents.map((item) => item.date))]) {
    const positives = analyzedBuyEvents.filter((item) => item.date === eventDate).map((item) => item.code);
    const dailyScores = await getUniverseScores(eventDate);
    const positiveRows = dailyScores.filter((item) => positives.includes(item.code));
    const negativeRows = dailyScores.filter((item) => !positives.includes(item.code));
    buyPositiveRows.push(...positiveRows);
    buyNegativeRows.push(...negativeRows);
    buyDebug.push({
      date: eventDate,
      positiveCodes: positives,
      scoredCodes: dailyScores.map((item) => item.code),
      positiveCount: positiveRows.length,
      negativeCount: negativeRows.length,
      diagnostics: dailyUniverseDiagnostics.get(eventDate) ?? [],
    });
  }

  const intervals = buildOpenIntervals(historyPayload, rawPayload.updatedDate ?? args.date);
  const exitPositiveRows = [];
  const exitNegativeRows = [];
  const exitDebug = [];

  for (const eventDate of [...new Set(analyzedExitEvents.map((item) => item.date))]) {
    const exitingCodes = analyzedExitEvents.filter((item) => item.date === eventDate).map((item) => item.code);
    const activeCodes = intervals
      .filter((row) => row.buyDate <= eventDate && row.exitDate >= eventDate)
      .map((row) => row.code);
    const dailyScores = await getUniverseScores(eventDate);
    const positiveRows = dailyScores.filter((item) => exitingCodes.includes(item.code));
    const negativeRows = dailyScores.filter(
      (item) => activeCodes.includes(item.code) && !exitingCodes.includes(item.code),
    );
    exitPositiveRows.push(...positiveRows);
    exitNegativeRows.push(...negativeRows);
    exitDebug.push({
      date: eventDate,
      exitCodes: exitingCodes,
      activeCodes,
      scoredCodes: dailyScores.map((item) => item.code),
      positiveCount: positiveRows.length,
      negativeCount: negativeRows.length,
      diagnostics: dailyUniverseDiagnostics.get(eventDate) ?? [],
    });
  }

  const buyFactorSummary = summarizeFactorAttribution(buyPositiveRows, buyNegativeRows, SCORE_KEYS, "positive");
  const exitFactorSummary = summarizeFactorAttribution(exitPositiveRows, exitNegativeRows, SCORE_KEYS, "negative");
  const report = {
    source: "stockeasy",
    strategy: rawPayload.strategy?.key ?? args.strategy,
    strategyLabel: rawPayload.strategy?.label ?? args.strategy,
    asOfDate: args.date,
    minDate: args.minDate,
    updatedDate: rawPayload.updatedDate ?? null,
    coverage: {
      buyEventsTotal: buyEvents.length,
      buyEventsAnalyzed: analyzedBuyEvents.length,
      exitEventsTotal: exitEvents.length,
      exitEventsAnalyzed: analyzedExitEvents.length,
      universeCodes: universeCodes.length,
      resolvedUniverseCodes: universeCodes.length,
      unresolvedNames: resolved.unresolvedNames,
      macroAvailableDates: macroLookup.availableDates.length,
      macroCompleteDates: macroLookup.completeDates.length,
      macroWindow: macroLookup.completeDates.length
        ? {
            first: macroLookup.completeDates[0],
            last: macroLookup.completeDates.at(-1),
          }
        : null,
      analysisBlockedReason,
    },
    inference: {
      likelyStyle: inferStyle(buyFactorSummary),
      confidence:
        analyzedBuyEvents.length >= 12
          ? "medium"
          : "low",
    },
    buyAttribution: {
      positiveSamples: buyPositiveRows.length,
      negativeSamples: buyNegativeRows.length,
      topFactors: buyFactorSummary,
      topGates: summarizeGateAttribution(buyPositiveRows, buyNegativeRows),
    },
    exitAttribution: {
      positiveSamples: exitPositiveRows.length,
      negativeSamples: exitNegativeRows.length,
      topFactors: exitFactorSummary,
      topGates: summarizeGateAttribution(exitPositiveRows, exitNegativeRows),
    },
    analyzedBuys: analyzedBuyEvents,
    analyzedExits: analyzedExitEvents,
    debug: {
      buyByDate: buyDebug,
      exitByDate: exitDebug,
    },
  };

  await writeJson(outputPath, report);
  await writeText(markdownPath, renderMarkdown(report));
  console.log(`✅ reverse engineering saved: ${outputPath}`);
  console.log(`✅ markdown summary saved: ${markdownPath}`);
}

main().catch((error) => {
  console.error(`❌ StockEasy reverse engineering failed: ${error.message}`);
  process.exitCode = 1;
});
