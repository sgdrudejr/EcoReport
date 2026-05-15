#!/usr/bin/env node

import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  ROOT_DIR,
  SECURITIES_MASTER,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

const NAVER_ITEM_URL = "https://finance.naver.com/item/main.naver";

function round(value, digits = 2) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function isFiniteValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function parseExtraArgs(argv) {
  const out = {
    maxEtfRanking: 18,
    concurrency: 4,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--max-etf-ranking" && argv[index + 1]) {
      out.maxEtfRanking = Number.parseInt(argv[index + 1], 10) || out.maxEtfRanking;
      index += 1;
    } else if (token === "--concurrency" && argv[index + 1]) {
      out.concurrency = Number.parseInt(argv[index + 1], 10) || out.concurrency;
      index += 1;
    }
  }
  out.maxEtfRanking = Math.max(0, Math.min(80, out.maxEtfRanking));
  out.concurrency = Math.max(1, Math.min(8, out.concurrency));
  return out;
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/[＋]/g, "+")
    .replace(/[−]/g, "-")
    .replace(/\s+/g, "")
    .trim();
  if (!text || text === "-" || /^N\/?A$/i.test(text)) return null;
  const match = text.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function parseMetricById(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<em[^>]+id=["']${escaped}["'][^>]*>\\s*([^<]+)`, "i"));
  return parseNumber(match?.[1]);
}

function rowCells(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return [];
  const start = html.lastIndexOf("<tr", markerIndex);
  const end = html.indexOf("</tr>", markerIndex);
  if (start < 0 || end < 0) return [];
  const row = html.slice(start, end + 5);
  return [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)]
    .map((match) => ({
      attrs: match[1] ?? "",
      text: cleanHtml(match[2]),
      value: parseNumber(cleanHtml(match[2])),
    }))
    .filter((cell) => cell.text);
}

function financialRowSnapshot(html, marker) {
  const cells = rowCells(html, marker);
  const annual = cells.slice(0, 4).map((cell) => cell.value);
  const quarterly = cells.slice(4).map((cell) => cell.value);
  const annualActual = annual.slice(0, 3).filter((value) => Number.isFinite(value));
  const previousActual = annualActual.length >= 2 ? annualActual.at(-2) : null;
  const latestActual = annualActual.length >= 1 ? annualActual.at(-1) : null;
  const estimate = Number.isFinite(annual[3]) ? annual[3] : null;
  const recentQuarter = quarterly.filter((value) => Number.isFinite(value)).at(-1) ?? null;
  return {
    cells: cells.map((cell) => ({
      text: cell.text,
      value: cell.value,
      strong: /\bcell_strong\b/.test(cell.attrs),
    })),
    latestActual,
    previousActual,
    estimate,
    recentQuarter,
  };
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100, 2);
}

function scorePer(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value <= 12) return 88;
  if (value <= 20) return 75;
  if (value <= 30) return 62;
  if (value <= 45) return 48;
  if (value <= 70) return 36;
  return 24;
}

function scorePbr(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value <= 1) return 86;
  if (value <= 2) return 76;
  if (value <= 4) return 61;
  if (value <= 7) return 45;
  return 30;
}

function scoreRoe(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 25) return 92;
  if (value >= 16) return 80;
  if (value >= 10) return 65;
  if (value >= 5) return 48;
  if (value >= 0) return 35;
  return 20;
}

function scoreMargin(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 25) return 90;
  if (value >= 15) return 77;
  if (value >= 8) return 62;
  if (value >= 3) return 46;
  if (value >= 0) return 34;
  return 18;
}

function scoreGrowth(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 35) return 92;
  if (value >= 18) return 78;
  if (value >= 7) return 64;
  if (value >= 0) return 48;
  if (value >= -15) return 34;
  return 20;
}

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function scoreStockFundamentals(metrics) {
  const valuation = average([
    scorePer(metrics.estimatedPer ?? metrics.per),
    scorePbr(metrics.pbr),
  ]);
  const quality = average([
    scoreRoe(metrics.roe),
    scoreMargin(metrics.operatingMargin),
  ]);
  const growth = average([
    scoreGrowth(metrics.epsGrowthPct),
    scoreGrowth(metrics.estimatedEpsGrowthPct),
  ]);
  const availableGroups = [valuation, quality, growth].filter((value) => Number.isFinite(value)).length;
  if (availableGroups === 0) {
    return {
      overall: 20,
      valuation: null,
      quality: null,
      growth: null,
      confidence: 0,
      label: "수집필요",
    };
  }
  const weightedParts = [
    { value: valuation, weight: 0.35 },
    { value: quality, weight: 0.35 },
    { value: growth, weight: 0.3 },
  ].filter((item) => Number.isFinite(item.value));
  const weightSum = weightedParts.reduce((sum, item) => sum + item.weight, 0);
  const normalized =
    weightSum === 0
      ? 20
      : weightedParts.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum;
  const capped = availableGroups < 2 ? Math.min(normalized, 55) : normalized;
  const overall = Math.max(0, Math.min(100, Math.round(capped)));
  return {
    overall,
    valuation: round(valuation, 0),
    quality: round(quality, 0),
    growth: round(growth, 0),
    confidence: round(availableGroups / 3, 2),
    label: overall >= 75 ? "기본강함" : overall >= 60 ? "기본양호" : overall >= 45 ? "기본보통" : "기본주의",
  };
}

function scoreEtfFlow({ rank, volume, navGapPct, holdings }) {
  let rankScore = null;
  if (Number.isFinite(rank)) {
    if (rank <= 10) rankScore = 88;
    else if (rank <= 30) rankScore = 72;
    else if (rank <= 80) rankScore = 55;
    else rankScore = 40;
  }

  let volumeScore = null;
  if (Number.isFinite(volume)) {
    if (volume >= 5_000_000) volumeScore = 88;
    else if (volume >= 1_000_000) volumeScore = 76;
    else if (volume >= 200_000) volumeScore = 62;
    else if (volume >= 50_000) volumeScore = 48;
    else volumeScore = 35;
  }

  let navGapScore = null;
  if (Number.isFinite(navGapPct)) {
    const gap = Math.abs(navGapPct);
    if (gap <= 0.15) navGapScore = 86;
    else if (gap <= 0.4) navGapScore = 72;
    else if (gap <= 0.8) navGapScore = 55;
    else navGapScore = 35;
  }

  const topWeight = holdings?.[0]?.weightPct;
  let compositionScore = null;
  if (array(holdings).length > 0) {
    if (array(holdings).length >= 8 && Number.isFinite(topWeight) && topWeight <= 25) compositionScore = 78;
    else if (array(holdings).length >= 5 && Number.isFinite(topWeight) && topWeight <= 40) compositionScore = 66;
    else compositionScore = 52;
  }

  const flowScores = [rankScore, volumeScore, navGapScore].filter((value) => Number.isFinite(value));
  const hasFlow = flowScores.length > 0;
  const overallRaw = average([rankScore, volumeScore, navGapScore, compositionScore]);
  const overall = !hasFlow && Number.isFinite(compositionScore) ? Math.min(compositionScore, 58) : overallRaw;
  const confidence = [rankScore, volumeScore, navGapScore, compositionScore].filter((value) => Number.isFinite(value)).length / 4;
  return {
    overall: overall == null ? 35 : Math.round(overall),
    flow: round(average([rankScore, volumeScore, navGapScore]), 0),
    composition: round(compositionScore, 0),
    confidence: round(confidence, 2),
    label: !hasFlow
      ? "수급부족"
      : overall == null
        ? "수집필요"
        : overall >= 75
          ? "수급강함"
          : overall >= 60
            ? "수급양호"
            : overall >= 45
              ? "수급보통"
          : "수급주의",
  };
}

async function fetchNaverHtml(code) {
  const url = `${NAVER_ITEM_URL}?code=${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 EcoReport/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`Naver Finance ${code} HTTP ${response.status}`);
  }
  return response.text();
}

function parseStockFundamentals(html) {
  const operatingMarginRow = financialRowSnapshot(html, "th_cop_anal11");
  const roeRow = financialRowSnapshot(html, "th_cop_anal13");
  const epsRow = financialRowSnapshot(html, "th_cop_anal17");

  const metrics = {
    per: round(parseMetricById(html, "_per"), 2),
    pbr: round(parseMetricById(html, "_pbr"), 2),
    eps: round(parseMetricById(html, "_eps"), 0),
    estimatedPer: round(parseMetricById(html, "_cns_per"), 2),
    estimatedEps: round(parseMetricById(html, "_cns_eps"), 0),
    dividendYield: round(parseMetricById(html, "_dvr"), 2),
    operatingMargin: round(operatingMarginRow.latestActual, 2),
    operatingMarginEstimate: round(operatingMarginRow.estimate, 2),
    roe: round(roeRow.latestActual, 2),
    roeEstimate: round(roeRow.estimate, 2),
    annualEps: round(epsRow.latestActual, 0),
    previousAnnualEps: round(epsRow.previousActual, 0),
    estimatedAnnualEps: round(epsRow.estimate, 0),
    epsGrowthPct: pctChange(epsRow.latestActual, epsRow.previousActual),
    estimatedEpsGrowthPct: pctChange(epsRow.estimate, epsRow.latestActual),
  };
  return {
    metrics,
    score: scoreStockFundamentals(metrics),
  };
}

function parseEtfComposition(html) {
  const anchor =
    html.indexOf("ETF 주요 구성자산") >= 0
      ? html.indexOf("ETF 주요 구성자산")
      : html.indexOf("구성종목(구성자산)");
  if (anchor < 0) return [];

  const section = html.slice(anchor, anchor + 26000);
  const rows = [...section.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const holdings = [];

  for (const row of rows) {
    const code = row.match(/\/item\/main\.naver\?code=([0-9A-Z]{6})/i)?.[1];
    if (!code) continue;
    const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)].map((match) => cleanHtml(match[2]));
    const name = cells[0];
    const weightPct = parseNumber(cells[2]);
    if (!name || !Number.isFinite(weightPct)) continue;
    holdings.push({
      code,
      name,
      shares: parseNumber(cells[1]),
      weightPct: round(weightPct, 2),
      price: parseNumber(cells[3]),
      changeAmount: parseNumber(cells[4]),
      changePct: round(parseNumber(cells[5]), 2),
    });
    if (holdings.length >= 15) break;
  }

  return holdings;
}

function parseNaverQuote(html) {
  const summaryEnd = html.indexOf("종목 시세 차트");
  const text = cleanHtml(html.slice(0, summaryEnd > 0 ? summaryEnd : 50000));
  const price =
    parseNumber(text.match(/현재가\s+([0-9,]+)/)?.[1]) ??
    parseNumber(text.match(/오늘의시세\s+([0-9,]+)/)?.[1]);
  const volume = parseNumber(text.match(/거래량\s+([0-9,]+)/)?.[1]);
  const changeMatch = text.match(/전일대비\s+(상승|하락)[\s\S]{0,80}?(?:플러스|마이너스)?\s*([0-9.]+)\s*퍼센트/);
  const rawChangePct = parseNumber(changeMatch?.[2]);
  const changePct =
    Number.isFinite(rawChangePct) && changeMatch?.[1] === "하락"
      ? -Math.abs(rawChangePct)
      : rawChangePct;
  return {
    price,
    volume,
    changePct: round(changePct, 2),
  };
}

function marketByCode(market) {
  return new Map(Object.entries(market?.watchlist ?? {}));
}

function etfRankingByCode(ranking) {
  return new Map(array(ranking?.etfs).map((item) => [item.code, item]));
}

function securityMasterByCode() {
  return new Map(array(SECURITIES_MASTER?.securities).map((security) => [security.code, security]));
}

function addCandidate(map, item, source) {
  if (!item?.code) return;
  const code = String(item.code).trim().toUpperCase();
  if (!code) return;
  const existing = map.get(code) ?? { code, sources: new Set() };
  existing.name = existing.name ?? item.name ?? item.prdt_name ?? null;
  existing.type = existing.type ?? item.type ?? null;
  existing.bucket = existing.bucket ?? item.bucket ?? null;
  existing.sources.add(source);
  map.set(code, existing);
}

function buildCandidates({ portfolio, holdingCards, supplement, decisionFeatures, market, etfRanking, maxEtfRanking }) {
  const map = new Map();
  const master = securityMasterByCode();

  for (const security of array(SECURITIES_MASTER?.securities)) {
    addCandidate(map, security, "security-master");
  }
  for (const account of array(portfolio?.accounts)) {
    for (const holding of array(account?.holdings)) {
      addCandidate(map, holding, `portfolio:${account.key}`);
    }
  }
  for (const card of array(holdingCards?.cards)) {
    addCandidate(map, card, `holding-card:${card.accountKey ?? "unknown"}`);
  }
  for (const security of array(supplement?.securitySupplements)) {
    addCandidate(map, security, "source-supplement");
  }
  for (const security of array(decisionFeatures?.securityFeatures)) {
    addCandidate(map, security, "decision-features");
  }
  for (const item of Object.values(market?.watchlist ?? {})) {
    addCandidate(map, item, "market-watchlist");
  }
  for (const item of array(etfRanking?.etfs).slice(0, maxEtfRanking)) {
    addCandidate(map, { ...item, type: "etf" }, "kis-etf-ranking");
  }

  return [...map.values()].map((candidate) => {
    const masterRecord = master.get(candidate.code) ?? {};
    return {
      ...candidate,
      name: candidate.name ?? masterRecord.name ?? candidate.code,
      type: candidate.type ?? masterRecord.type ?? null,
      bucket: candidate.bucket ?? masterRecord.bucket ?? null,
      categories: masterRecord.categories ?? {},
      keywords: masterRecord.keywords ?? {},
      sources: [...candidate.sources],
    };
  });
}

function categoryFor(candidate) {
  return candidate.categories?.default ?? null;
}

function shouldFetch(code) {
  return /^[0-9A-Z]{6}$/i.test(code);
}

function buildMarketSnapshot(code, marketLookup, rankingLookup) {
  const market = marketLookup.get(code) ?? {};
  const ranking = rankingLookup.get(code) ?? {};
  const nav = Number.isFinite(Number(ranking.nav)) ? Number(ranking.nav) : market.nav;
  const price = Number.isFinite(Number(ranking.price)) ? Number(ranking.price) : market.close;
  const navGapPct =
    Number.isFinite(Number(nav)) && Number.isFinite(Number(price)) && Number(nav) !== 0
      ? round(((Number(price) - Number(nav)) / Number(nav)) * 100, 3)
      : null;
  return {
    price: round(price, 0),
    changePct: round(
      Number.isFinite(Number(ranking.changePct))
        ? Number(ranking.changePct)
        : Number.isFinite(Number(market.change_pct))
          ? Number(market.change_pct) * 100
          : null,
      2,
    ),
    volume: Number.isFinite(Number(ranking.volume)) ? Number(ranking.volume) : market.volume ?? null,
    marketCap: market.market_cap ?? null,
    nav: round(nav, 2),
    navGapPct,
    navChangePct: round(ranking.navChangePct, 2),
    rank: ranking.rank ?? null,
    source: {
      market: market.source ?? null,
      etfRanking: ranking.source ?? null,
    },
  };
}

async function collectOne(candidate, context) {
  const market = buildMarketSnapshot(candidate.code, context.marketLookup, context.rankingLookup);
  const ranking = context.rankingLookup.get(candidate.code) ?? {};
  const type = candidate.type ?? (ranking.code ? "etf" : "unknown");
  const record = {
    code: candidate.code,
    name: candidate.name,
    type,
    bucket: candidate.bucket ?? null,
    category: categoryFor(candidate),
    sourceCandidates: candidate.sources,
    sourceUrls: {
      naver: shouldFetch(candidate.code) ? `${NAVER_ITEM_URL}?code=${candidate.code}` : null,
    },
    market,
    metrics: null,
    etf: null,
    score: {
      overall: 20,
      label: "수집필요",
      confidence: 0,
    },
    dataNeeds: [],
    errors: [],
  };

  if (!shouldFetch(candidate.code)) {
    record.dataNeeds.push("NAVER_CODE_UNSUPPORTED");
    return record;
  }

  try {
    const html = await fetchNaverHtml(candidate.code);
    await sleep(40);
    const quote = parseNaverQuote(html);
    if (!isFiniteValue(record.market.price) && isFiniteValue(quote.price)) {
      record.market.price = quote.price;
    }
    if (!isFiniteValue(record.market.volume) && isFiniteValue(quote.volume)) {
      record.market.volume = quote.volume;
    }
    if ((!isFiniteValue(record.market.changePct) || record.market.changePct === 0) && isFiniteValue(quote.changePct)) {
      record.market.changePct = quote.changePct;
    }
    if (type === "etf") {
      const holdings = parseEtfComposition(html);
      const navGapPct = market.navGapPct;
      record.etf = {
        ranking: {
          rank: market.rank,
          changePct: market.changePct,
          volume: market.volume,
          nav: market.nav,
          navGapPct,
          navChangePct: market.navChangePct,
        },
        sectors: array(ranking.sectors),
        keywords: array(ranking.keywords),
        rationale: ranking.rationale ?? "",
        holdings,
        topHoldingWeightPct: holdings[0]?.weightPct ?? null,
        concentrationTop5Pct: round(
          holdings.slice(0, 5).reduce((sum, item) => sum + (Number(item.weightPct) || 0), 0),
          2,
        ),
        flowProxy: {
          label: "거래량/NAV괴리/랭킹",
          rank: market.rank,
          volume: market.volume,
          navGapPct,
        },
      };
      record.score = scoreEtfFlow({
        rank: market.rank,
        volume: market.volume,
        navGapPct,
        holdings,
      });
      if (holdings.length === 0) record.dataNeeds.push("ETF_COMPOSITION_MISSING");
      if (!isFiniteValue(market.volume)) record.dataNeeds.push("ETF_VOLUME_MISSING");
      if (!isFiniteValue(market.nav)) record.dataNeeds.push("ETF_NAV_MISSING");
    } else if (type === "stock") {
      const stock = parseStockFundamentals(html);
      record.metrics = stock.metrics;
      record.score = stock.score;
      for (const [key, value] of Object.entries(stock.metrics)) {
        if (["per", "pbr", "roe", "epsGrowthPct", "operatingMargin"].includes(key) && !Number.isFinite(Number(value))) {
          record.dataNeeds.push(`STOCK_${key.toUpperCase()}_MISSING`);
        }
      }
    } else {
      record.dataNeeds.push("SECURITY_TYPE_UNKNOWN");
    }
  } catch (error) {
    record.errors.push(error.message);
    record.dataNeeds.push("NAVER_FETCH_FAILED");
  }

  return record;
}

async function collectWithConcurrency(candidates, context, concurrency) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await collectOne(candidates[index], context);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseDateArgs(argv);
  const extra = parseExtraArgs(argv);
  const date = args.date;

  const [portfolio, holdingCards, supplement, decisionFeatures, market, etfRanking] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "holding-decision-cards.json"), { cards: [] }),
    readJson(path.join(ROOT_DIR, "data", "features", date, "source-consensus-supplement.json"), {}),
    readJson(path.join(ROOT_DIR, "data", "features", date, "decision-features.json"), {}),
    readJson(path.join(ROOT_DIR, "data", "market", `${date}.json`), {}),
    readJson(path.join(ROOT_DIR, "data", "external", "kis-etf", date, "etf-ranking.json"), { etfs: [] }),
  ]);

  const candidates = buildCandidates({
    portfolio,
    holdingCards,
    supplement,
    decisionFeatures,
    market,
    etfRanking,
    maxEtfRanking: extra.maxEtfRanking,
  });

  const context = {
    marketLookup: marketByCode(market),
    rankingLookup: etfRankingByCode(etfRanking),
  };

  const securities = await collectWithConcurrency(candidates, context, extra.concurrency);
  securities.sort((left, right) => {
    const leftHeld = left.sourceCandidates.some((source) => source.startsWith("portfolio:")) ? 0 : 1;
    const rightHeld = right.sourceCandidates.some((source) => source.startsWith("portfolio:")) ? 0 : 1;
    return leftHeld - rightHeld || (left.type === "etf" ? 0 : 1) - (right.type === "etf" ? 0 : 1) || left.code.localeCompare(right.code);
  });

  const payload = {
    date,
    runDate: args.runDate,
    effectiveMarketDate: args.effectiveMarketDate,
    runId: args.runId,
    generatedAt: new Date().toISOString(),
    source: {
      stockFundamentals: "Naver Finance item main page",
      etfComposition: "Naver Finance ETF composition table",
      etfFlowProxy: "KIS ETF ranking + market watchlist volume/NAV",
      sourceUrls: [
        "https://finance.naver.com/",
        `data/external/kis-etf/${date}/etf-ranking.json`,
        `data/market/${date}.json`,
      ],
    },
    collection: {
      candidateCount: candidates.length,
      fetchedCount: securities.filter((item) => !item.dataNeeds.includes("NAVER_CODE_UNSUPPORTED")).length,
      stockCount: securities.filter((item) => item.type === "stock").length,
      etfCount: securities.filter((item) => item.type === "etf").length,
      maxEtfRanking: extra.maxEtfRanking,
      concurrency: extra.concurrency,
    },
    coverage: {
      withScores: securities.filter((item) => Number(item.score?.confidence ?? 0) > 0).length,
      withStockMetrics: securities.filter((item) => item.metrics).length,
      withEtfComposition: securities.filter((item) => array(item.etf?.holdings).length > 0).length,
      missingDataNeeds: securities.reduce((sum, item) => sum + item.dataNeeds.length, 0),
      errors: securities.reduce((sum, item) => sum + item.errors.length, 0),
    },
    securities,
  };

  const outputPath = args.output
    ? path.resolve(ROOT_DIR, args.output)
    : path.join(ROOT_DIR, "data", "fundamentals", date, "security-fundamentals.json");
  await writeJson(outputPath, payload);
  await writeJson(path.join(ROOT_DIR, "data", "fundamentals", "latest-security-fundamentals.json"), payload);

  console.log(`Wrote fundamental snapshot to ${outputPath}`);
  console.log(
    `securities=${payload.collection.candidateCount} stocks=${payload.collection.stockCount} etfs=${payload.collection.etfCount} composition=${payload.coverage.withEtfComposition}`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
