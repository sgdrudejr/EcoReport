#!/usr/bin/env node
// 최신 포트폴리오 스냅샷을 기준으로 보유 종목 종가를 반영한 일별 평가 레이어를 생성합니다.

import path from "node:path";
import fetch from "node-fetch";

import {
  ROOT_DIR,
  SECURITIES_MASTER,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

const PORTFOLIO_FILE = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
const MARKET_DIR = path.join(ROOT_DIR, "data", "market");
const OUTPUT_DIR = path.join(ROOT_DIR, "data", "portfolio", "valuation");

const FETCH_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 350;

const CODE_CORRECTIONS = {
  "2921050": "292150",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`잘못된 날짜 형식입니다: ${value}`);
  }

  return value;
}

function parseArgs(argv) {
  const args = {
    date: todayIso(),
    marketDate: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = normalizeDate(argv[index + 1]);
      index += 1;
    } else if (token === "--market-date" && argv[index + 1]) {
      args.marketDate = normalizeDate(argv[index + 1]);
      index += 1;
    }
  }

  return args;
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

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized || normalized === "N/D" || normalized === "null") {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return Number.parseFloat(value.toFixed(digits));
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(합성\)/g, "")
    .replace(/(\.\.\.|…)+$/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function holdingKey(holding) {
  const code = sanitizeCode(holding.resolvedCode ?? holding.code);
  if (code && code.length === 6) {
    return `code:${code}`;
  }

  return `name:${normalizeName(holding.name)}`;
}

function dedupeHoldings(holdings) {
  const byKey = new Map();

  for (const holding of holdings) {
    const key = holdingKey(holding);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...holding });
      continue;
    }

    const primary =
      (holding.priceSource ? 1 : 0) +
        (holding.code ? 1 : 0) +
        (holding.resolvedCode ? 1 : 0) +
        (holding.avgPrice != null ? 1 : 0) +
        (holding.purchaseValue != null ? 1 : 0) >=
      (existing.priceSource ? 1 : 0) +
        (existing.code ? 1 : 0) +
        (existing.resolvedCode ? 1 : 0) +
        (existing.avgPrice != null ? 1 : 0) +
        (existing.purchaseValue != null ? 1 : 0)
        ? holding
        : existing;
    const secondary = primary === holding ? existing : holding;

    byKey.set(key, {
      ...secondary,
      ...primary,
      snapshotIndex: Math.min(existing.snapshotIndex, holding.snapshotIndex),
      code: primary.code ?? secondary.code ?? null,
      resolvedCode: primary.resolvedCode ?? secondary.resolvedCode ?? null,
      name: primary.name ?? secondary.name,
      quantity: primary.quantity ?? secondary.quantity ?? null,
      avgPrice: primary.avgPrice ?? secondary.avgPrice ?? null,
      currentPrice: primary.currentPrice ?? secondary.currentPrice ?? null,
      marketValue: primary.marketValue ?? secondary.marketValue ?? null,
      purchaseValue: primary.purchaseValue ?? secondary.purchaseValue ?? null,
      profitLoss: primary.profitLoss ?? secondary.profitLoss ?? null,
      profitRate: primary.profitRate ?? secondary.profitRate ?? null,
      stale: Boolean(primary.stale && secondary.stale),
      priceWarning: primary.priceWarning ?? secondary.priceWarning ?? null,
      note: primary.note ?? secondary.note ?? null,
    });
  }

  return [...byKey.values()];
}

function extractDate(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const compactMatch = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  return null;
}

function sanitizeCode(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function coercePurchaseValue(holding) {
  if (holding.purchaseValue != null) {
    return holding.purchaseValue;
  }

  if (holding.quantity != null && holding.avgPrice != null) {
    return Math.round(holding.quantity * holding.avgPrice);
  }

  return null;
}

function coerceProfitLoss(holding, purchaseValue, marketValue) {
  if (purchaseValue != null && marketValue != null) {
    return marketValue - purchaseValue;
  }

  return holding.profitLoss ?? null;
}

function coerceProfitRate(holding, purchaseValue, profitLoss) {
  if (purchaseValue != null && purchaseValue > 0 && profitLoss != null) {
    return (profitLoss / purchaseValue) * 100;
  }

  return holding.profitRate ?? null;
}

function buildSecurityLookup() {
  const byName = new Map();
  const canonicalCodes = new Set();

  for (const security of SECURITIES_MASTER.securities ?? []) {
    const code = sanitizeCode(CODE_CORRECTIONS[security.code] ?? security.code);
    if (!code) continue;

    canonicalCodes.add(code);

    const names = [
      security.name,
      ...(security.keywords?.aliases ?? []),
    ];

    for (const name of names) {
      const key = normalizeName(name);
      if (!key || byName.has(key)) continue;
      byName.set(key, code);
    }
  }

  return { byName, canonicalCodes };
}

function resolveHoldingCode(holding, lookup) {
  const rawCode = sanitizeCode(holding.code);
  const correctedCode = rawCode ? sanitizeCode(CODE_CORRECTIONS[rawCode] ?? rawCode) : null;

  if (correctedCode && correctedCode.length === 6) {
    return {
      code: correctedCode,
      matchedBy: correctedCode === rawCode ? "code" : "corrected_code",
    };
  }

  const nameKey = normalizeName(holding.name);
  if (nameKey && lookup.byName.has(nameKey)) {
    return {
      code: lookup.byName.get(nameKey),
      matchedBy: "name",
    };
  }

  if (nameKey) {
    for (const [candidateKey, code] of lookup.byName.entries()) {
      if (
        candidateKey.startsWith(nameKey) ||
        nameKey.startsWith(candidateKey)
      ) {
        return {
          code,
          matchedBy: "name_prefix",
        };
      }
    }
  }

  if (rawCode && rawCode.length === 6) {
    return {
      code: rawCode,
      matchedBy: "raw_code",
    };
  }

  return {
    code: null,
    matchedBy: null,
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
  const text = await fetchText(url, headers);
  return JSON.parse(text);
}

async function fetchNaverDomesticBasic(code) {
  return fetchJson(`https://m.stock.naver.com/api/stock/${code}/basic`);
}

async function fetchNaverDomesticPrice(code) {
  return fetchJson(`https://m.stock.naver.com/api/stock/${code}/price?page=1&pageSize=2`);
}

function normalizeQuoteFromMarket(code, item) {
  if (!item || item.close == null) {
    return null;
  }

  return {
    code,
    name: item.name ?? null,
    currentPrice: item.close,
    priceDate: extractDate(item.traded_at) ?? null,
    tradedAt: item.traded_at ?? null,
    priceSource: item.source ?? "market_cache",
  };
}

async function fetchLatestQuote(code) {
  const [basic, prices] = await Promise.all([
    fetchNaverDomesticBasic(code),
    fetchNaverDomesticPrice(code),
  ]);
  const latest = prices?.[0] ?? {};
  const currentPrice = parseNumber(latest.closePrice ?? basic.closePrice);

  if (currentPrice == null) {
    throw new Error("종가를 찾을 수 없습니다.");
  }

  return {
    code,
    name: basic.stockName ?? null,
    currentPrice: roundNumber(currentPrice, 4),
    priceDate: extractDate(latest.localTradedAt ?? basic.localTradedAt) ?? null,
    tradedAt: latest.localTradedAt ?? basic.localTradedAt ?? null,
    priceSource: "naver",
  };
}

async function loadMarketSnapshot(dateHint) {
  if (dateHint) {
    const exactFile = path.join(MARKET_DIR, `${dateHint}.json`);
    const exact = await readJson(exactFile, null);
    if (exact) {
      return exact;
    }
  }

  const fs = await import("node:fs/promises");
  try {
    const files = (await fs.readdir(MARKET_DIR))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) {
      return null;
    }

    return readJson(path.join(MARKET_DIR, files[0]), null);
  } catch {
    return null;
  }
}

function buildStaleValuation({ holding, resolvedCode, matchedBy, reason }) {
  const purchaseValue = coercePurchaseValue(holding);
  const marketValue = holding.marketValue ?? null;
  const profitLoss = coerceProfitLoss(holding, purchaseValue, marketValue);
  const profitRate = coerceProfitRate(holding, purchaseValue, profitLoss);

  return {
    code: holding.code ?? null,
    resolvedCode,
    matchedBy,
    name: holding.name,
    quantity: holding.quantity ?? null,
    avgPrice: holding.avgPrice ?? null,
    currentPrice: holding.currentPrice ?? null,
    marketValue,
    purchaseValue,
    profitLoss: roundNumber(profitLoss, 4),
    profitRate: roundNumber(profitRate, 6),
    priceDate: null,
    tradedAt: null,
    priceSource: null,
    stale: true,
    priceWarning: reason,
    note: holding.note ?? null,
  };
}

function buildFreshValuation({ holding, resolvedCode, matchedBy, quote }) {
  const purchaseValue = coercePurchaseValue(holding);
  const marketValue =
    holding.quantity != null && quote.currentPrice != null
      ? Math.round(holding.quantity * quote.currentPrice)
      : (holding.marketValue ?? null);
  const profitLoss = coerceProfitLoss(holding, purchaseValue, marketValue);
  const profitRate = coerceProfitRate(holding, purchaseValue, profitLoss);

  return {
    code: holding.code ?? null,
    resolvedCode,
    matchedBy,
    name: quote.name ?? holding.name,
    quantity: holding.quantity ?? null,
    avgPrice: holding.avgPrice ?? null,
    currentPrice: quote.currentPrice,
    marketValue,
    purchaseValue,
    profitLoss: roundNumber(profitLoss, 4),
    profitRate: roundNumber(profitRate, 6),
    priceDate: quote.priceDate ?? null,
    tradedAt: quote.tradedAt ?? null,
    priceSource: quote.priceSource ?? "naver",
    stale: false,
    priceWarning: null,
    note: holding.note ?? null,
  };
}

function sumBy(items, selector) {
  return items.reduce((sum, item) => sum + (selector(item) ?? 0), 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portfolio = await readJson(PORTFOLIO_FILE, null);

  if (!portfolio?.accounts?.length) {
    throw new Error("data/portfolio/latest.json 에 유효한 계좌 스냅샷이 없습니다.");
  }

  const market = await loadMarketSnapshot(args.marketDate ?? args.date);
  const lookup = buildSecurityLookup();
  const quoteCache = new Map();

  async function getQuote(code) {
    if (!code) {
      return null;
    }

    if (quoteCache.has(code)) {
      return quoteCache.get(code);
    }

    const cachedQuote = normalizeQuoteFromMarket(code, market?.watchlist?.[code] ?? null);
    if (cachedQuote) {
      quoteCache.set(code, cachedQuote);
      return cachedQuote;
    }

    try {
      const fetched = await fetchLatestQuote(code);
      quoteCache.set(code, fetched);
      await sleep(REQUEST_DELAY_MS);
      return fetched;
    } catch (error) {
      const failed = {
        code,
        error: error instanceof Error ? error.message : String(error),
      };
      quoteCache.set(code, failed);
      return failed;
    }
  }

  const accounts = [];

  for (const account of portfolio.accounts) {
    const holdings = [];

    for (const [index, holding] of (account.holdings ?? []).entries()) {
      const resolved = resolveHoldingCode(holding, lookup);

      if (!resolved.code) {
        holdings.push({
          snapshotIndex: index,
          ...buildStaleValuation({
            holding,
            resolvedCode: null,
            matchedBy: null,
            reason: "종목 코드를 확정하지 못했습니다.",
          }),
        });
        continue;
      }

      const quote = await getQuote(resolved.code);
      if (!quote || quote.error) {
        holdings.push({
          snapshotIndex: index,
          ...buildStaleValuation({
            holding,
            resolvedCode: resolved.code,
            matchedBy: resolved.matchedBy,
            reason: quote?.error ?? "시세 조회에 실패했습니다.",
          }),
        });
        continue;
      }

      holdings.push({
        snapshotIndex: index,
        ...buildFreshValuation({
          holding,
          resolvedCode: resolved.code,
          matchedBy: resolved.matchedBy,
          quote,
        }),
      });
    }

    const uniqueHoldings = dedupeHoldings(holdings);
    const pricedHoldingCount = uniqueHoldings.filter((item) => !item.stale).length;
    const unpricedHoldingCount = uniqueHoldings.length - pricedHoldingCount;
    const holdingsValue = sumBy(uniqueHoldings, (item) => item.marketValue);
    const holdingsPurchaseValue = sumBy(uniqueHoldings, (item) => item.purchaseValue);
    const holdingsProfitLoss = sumBy(uniqueHoldings, (item) => item.profitLoss);
    const holdingsProfitRate =
      holdingsPurchaseValue > 0
        ? (holdingsProfitLoss / holdingsPurchaseValue) * 100
        : null;

    accounts.push({
      key: account.key,
      label: account.label,
      accountNumber: account.accountNumber ?? null,
      snapshotEvaluationAmount: account.evaluationAmount ?? null,
      evaluationAmount: account.evaluationAmount ?? null,
      cashAvailable: account.cashAvailable ?? null,
      settlementCash: account.settlementCash ?? null,
      principal: account.principal ?? null,
      profitLoss: roundNumber(account.profitLoss ?? null, 6),
      profitRate: roundNumber(account.profitRate ?? null, 6),
      holdingsValue,
      holdingsPurchaseValue,
      holdingsProfitLoss: roundNumber(holdingsProfitLoss, 6),
      holdingsProfitRate: roundNumber(holdingsProfitRate, 6),
      holdingCount: uniqueHoldings.length,
      pricedHoldingCount,
      unpricedHoldingCount,
      holdings,
    });
  }

  const totals = {
    totalEvaluationAmount: sumBy(accounts, (item) => item.evaluationAmount),
    totalCashAvailable: sumBy(accounts, (item) => item.cashAvailable),
    totalHoldingsValue: sumBy(accounts, (item) => item.holdingsValue),
    totalHoldingsPurchaseValue: sumBy(accounts, (item) => item.holdingsPurchaseValue),
    totalHoldingsProfitLoss: roundNumber(sumBy(accounts, (item) => item.holdingsProfitLoss), 6),
    totalHoldingCount: sumBy(accounts, (item) => item.holdingCount),
    pricedHoldingCount: sumBy(accounts, (item) => item.pricedHoldingCount),
    unpricedHoldingCount: sumBy(accounts, (item) => item.unpricedHoldingCount),
  };

  totals.totalHoldingsProfitRate =
    totals.totalHoldingsPurchaseValue > 0
      ? roundNumber(
          (totals.totalHoldingsProfitLoss / totals.totalHoldingsPurchaseValue) * 100,
          6,
        )
      : null;

  const valuation = {
    date: args.date,
    pricedAt: new Date().toISOString(),
    source: {
      provider: "naver",
      note:
        "최신 포트폴리오 스냅샷의 매수 기준값과 네이버 시세를 결합한 일별 평가 레이어",
    },
    marketSnapshotDate: market?.date ?? null,
    snapshotDate: portfolio.date,
    snapshotUpdatedAt: portfolio.updatedAt,
    totals,
    accounts,
  };

  const latestFile = path.join(OUTPUT_DIR, "latest.json");
  const datedFile = path.join(OUTPUT_DIR, `${args.date}.json`);

  await writeJson(latestFile, valuation);
  await writeJson(datedFile, valuation);

  console.log("✅ 포트폴리오 일별 평가 저장 완료");
  console.log(`📁 ${latestFile}`);
  console.log(
    `📊 평가 종목 ${totals.pricedHoldingCount}/${totals.totalHoldingCount}개 · 합산 손익 ${Math.round(
      totals.totalHoldingsProfitLoss ?? 0,
    ).toLocaleString("ko-KR")}원`,
  );
  if (totals.unpricedHoldingCount > 0) {
    console.log(`⚠️ 시세 미반영 종목 ${totals.unpricedHoldingCount}개`);
  }
}

main().catch((error) => {
  console.error(
    `❌ refresh-portfolio-valuation 실패: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
