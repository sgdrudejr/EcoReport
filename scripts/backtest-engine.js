#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import { ROOT_DIR, readJson, writeJson } from "./lib/pipeline-utils.js";
import { insertStage3, TIMESERIES_DB_PATH } from "./lib/timeseries-db.js";

const TAX_EXEMPT_ACCOUNTS = new Set(["ISA", "PENSION"]);
const FACTOR_KEYS = ["momentum", "research", "income", "macroFit"];

function parseArgs(argv) {
  const args = {
    start: null,
    end: null,
    capital: 10_000_000,
    minScore: 58,
    maxPositions: 5,
    rebalance: "daily",
    slippageBps: 10,
    feeBps: 5,
    taxRate: 0.154,
    output: path.join(ROOT_DIR, "data", "backtest", "engine-results.json"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--start" && argv[index + 1]) {
      args.start = argv[index + 1];
      index += 1;
    } else if (token === "--end" && argv[index + 1]) {
      args.end = argv[index + 1];
      index += 1;
    } else if (token === "--capital" && argv[index + 1]) {
      args.capital = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--min-score" && argv[index + 1]) {
      args.minScore = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--max-positions" && argv[index + 1]) {
      args.maxPositions = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--rebalance" && argv[index + 1]) {
      args.rebalance = argv[index + 1];
      index += 1;
    } else if (token === "--slippage-bps" && argv[index + 1]) {
      args.slippageBps = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--fee-bps" && argv[index + 1]) {
      args.feeBps = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--tax-rate" && argv[index + 1]) {
      args.taxRate = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function roundNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number.parseFloat(value.toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  if (values.length === 0) return null;
  return sum(values) / values.length;
}

function isTaxExempt(accountKey) {
  return TAX_EXEMPT_ACCOUNTS.has(String(accountKey ?? "").toUpperCase());
}

async function listAvailableDates() {
  const files = await fs.readdir(path.join(ROOT_DIR, "data", "market"));
  return files
    .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName))
    .map((fileName) => fileName.replace(/\.json$/, ""))
    .sort();
}

function filterDateRange(dates, start, end) {
  return dates.filter((date) => (!start || date >= start) && (!end || date <= end));
}

async function ensureStage3Rows(date, db) {
  const countRow = db
    .prepare("SELECT COUNT(*) AS count FROM stage3_positions WHERE date = ?")
    .get(date);

  if ((countRow?.count ?? 0) > 0) return;

  const artifact = await readJson(
    path.join(ROOT_DIR, "data", "analysis-state", date, "stage3-quant-scores.json"),
    null,
  );

  if (artifact?.positions) {
    insertStage3(artifact);
  }
}

async function loadStage3Rows(date, db) {
  await ensureStage3Rows(date, db);
  const rows = db
    .prepare(
      `
        SELECT position_key, payload_json
        FROM stage3_positions
        WHERE date = ?
        ORDER BY action_score DESC, position_key ASC
      `,
    )
    .all(date);

  return rows
    .map((row) => {
      try {
        const payload = JSON.parse(row.payload_json);
        return {
          ...payload,
          positionKey: payload.positionKey ?? row.position_key,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function loadMarketPrices(date) {
  const market = await readJson(path.join(ROOT_DIR, "data", "market", `${date}.json`), null);
  const byCode = new Map();
  const watchlistItems = Array.isArray(market?.watchlist)
    ? market.watchlist
    : Object.values(market?.watchlist ?? {});

  for (const item of watchlistItems) {
    const close = item?.close ?? null;
    if (item?.code && Number.isFinite(close)) {
      byCode.set(item.code, close);
    }
  }

  return byCode;
}

function shouldRebalance({ rebalance, date, index }) {
  if (index === 0) return true;
  if (rebalance === "daily") return true;
  if (rebalance === "weekly") {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day === 1;
  }
  return false;
}

function buildTargets(rows, prices, args) {
  const allowedSignals = new Set(["BUY", "HOLD"]);
  const ranked = rows
    .filter(
      (row) =>
        row?.code &&
        row?.positionKey &&
        allowedSignals.has(row.signal) &&
        Number.isFinite(row.actionScore) &&
        row.actionScore >= args.minScore &&
        Number.isFinite(prices.get(row.code)),
    )
    .sort((left, right) => {
      const scoreGap = (right.actionScore ?? 0) - (left.actionScore ?? 0);
      if (scoreGap !== 0) return scoreGap;
      return (right.scoreDecomposition?.executionConfidence ?? 0) -
        (left.scoreDecomposition?.executionConfidence ?? 0);
    })
    .slice(0, args.maxPositions);

  if (ranked.length === 0) return [];

  const weights = ranked.map((row) =>
    Math.max((row.actionScore ?? args.minScore) - args.minScore + 1, 1),
  );
  const weightTotal = sum(weights);

  return ranked.map((row, index) => ({
    positionKey: row.positionKey,
    code: row.code,
    name: row.name,
    accountKey: row.accountKey ?? null,
    category: row.category ?? null,
    signal: row.signal ?? null,
    actionScore: row.actionScore ?? null,
    scoreDecomposition: row.scoreDecomposition ?? null,
    factorRaw: row.factor?.raw ?? {},
    weight: weights[index] / weightTotal,
    price: prices.get(row.code),
  }));
}

function computeFactorExposure(targets) {
  const exposure = Object.fromEntries(FACTOR_KEYS.map((key) => [key, 0]));

  for (const target of targets) {
    for (const factorKey of FACTOR_KEYS) {
      exposure[factorKey] += (target.factorRaw?.[factorKey] ?? 0) * target.weight;
    }
  }

  return exposure;
}

function rebalancePortfolio({ holdings, prices, targets, portfolioValue, cashBalance, args }) {
  const grossValue = portfolioValue;
  const desiredValueByKey = new Map(
    targets.map((target) => [target.positionKey, grossValue * target.weight]),
  );

  let tradedNotional = 0;
  let taxPaid = 0;

  for (const [positionKey, holding] of holdings.entries()) {
    const price = prices.get(holding.code) ?? holding.lastPrice ?? null;
    if (!Number.isFinite(price)) continue;

    const currentValue = holding.shares * price;
    const desiredValue = desiredValueByKey.get(positionKey) ?? 0;
    const delta = desiredValue - currentValue;
    tradedNotional += Math.abs(delta);

    if (delta < 0 && !isTaxExempt(holding.accountKey)) {
      const realizedRatio = currentValue > 0 ? Math.abs(delta) / currentValue : 0;
      const realizedCostBasis = holding.costBasis * clamp(realizedRatio, 0, 1);
      const realizedGain = Math.abs(delta) - realizedCostBasis;
      taxPaid += Math.max(realizedGain, 0) * args.taxRate;
    }
  }

  for (const target of targets) {
    if (holdings.has(target.positionKey)) continue;
    tradedNotional += desiredValueByKey.get(target.positionKey) ?? 0;
  }

  const transactionCostRate = (args.slippageBps + args.feeBps) / 10_000;
  const transactionCost = tradedNotional * transactionCostRate;
  const netPortfolioValue = Math.max(grossValue - transactionCost - taxPaid, 0);
  const nextCashBalance = targets.length === 0 ? netPortfolioValue : 0;

  const nextHoldings = new Map();
  for (const target of targets) {
    const price = prices.get(target.code) ?? target.price ?? null;
    if (!Number.isFinite(price) || price <= 0) continue;

    const scaledValue = netPortfolioValue * target.weight;
    nextHoldings.set(target.positionKey, {
      positionKey: target.positionKey,
      code: target.code,
      name: target.name,
      accountKey: target.accountKey,
      shares: scaledValue / price,
      costBasis: scaledValue,
      lastPrice: price,
      actionScore: target.actionScore,
      factorRaw: target.factorRaw,
      scoreDecomposition: target.scoreDecomposition,
      weight: target.weight,
    });
  }

  return {
    holdings: nextHoldings,
    cashBalance: nextCashBalance,
    portfolioValue: netPortfolioValue,
    turnoverPct: grossValue > 0 ? tradedNotional / grossValue : 0,
    transactionCost,
    taxPaid,
  };
}

function markToMarket(holdings, nextPrices, cashBalance = 0) {
  const nextHoldings = new Map();
  let portfolioValue = cashBalance;
  const stale = [];

  for (const [positionKey, holding] of holdings.entries()) {
    const price = nextPrices.get(holding.code) ?? holding.lastPrice ?? null;
    if (!Number.isFinite(price) || price <= 0) {
      stale.push(holding.code);
      continue;
    }

    const marketValue = holding.shares * price;
    portfolioValue += marketValue;
    nextHoldings.set(positionKey, {
      ...holding,
      lastPrice: price,
      marketValue,
    });
  }

  return {
    holdings: nextHoldings,
    portfolioValue,
    staleCodes: [...new Set(stale)],
  };
}

function computeMaxDrawdown(values) {
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;

  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    }
  }

  return maxDrawdown;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allDates = await listAvailableDates();
  const dates = filterDateRange(allDates, args.start, args.end);

  if (dates.length < 2) {
    throw new Error("백테스트에는 최소 2거래일 이상의 market/stage3 데이터가 필요합니다.");
  }

  const db = new Database(TIMESERIES_DB_PATH);
  db.pragma("busy_timeout = 5000");

  try {
    const marketByDate = new Map();
    for (const date of dates) {
      marketByDate.set(date, await loadMarketPrices(date));
    }

    let portfolioValue = args.capital;
    let holdings = new Map();
    let cashBalance = args.capital;
    const rebalanceLog = [];
    const equityCurve = [];
    const factorExposureHistory = [];
    let totalTurnover = 0;
    let totalTransactionCost = 0;
    let totalTaxPaid = 0;

    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index];
      const prices = marketByDate.get(date) ?? new Map();
      const stage3Rows = await loadStage3Rows(date, db);

      if (shouldRebalance({ rebalance: args.rebalance, date, index })) {
        const targets = buildTargets(stage3Rows, prices, args);
        const rebalance = rebalancePortfolio({
          holdings,
          prices,
          targets,
          portfolioValue,
          cashBalance,
          args,
        });

        holdings = rebalance.holdings;
        cashBalance = rebalance.cashBalance;
        portfolioValue = rebalance.portfolioValue;
        totalTurnover += rebalance.turnoverPct;
        totalTransactionCost += rebalance.transactionCost;
        totalTaxPaid += rebalance.taxPaid;

        const factorExposure = computeFactorExposure(targets);
        factorExposureHistory.push({
          date,
          selectedCount: targets.length,
          exposure: Object.fromEntries(
            Object.entries(factorExposure).map(([key, value]) => [key, roundNumber(value, 4)]),
          ),
        });

        rebalanceLog.push({
          date,
          selectedCount: targets.length,
          turnoverPct: roundNumber(rebalance.turnoverPct * 100, 2),
          transactionCost: roundNumber(rebalance.transactionCost, 0),
          taxPaid: roundNumber(rebalance.taxPaid, 0),
          selected: targets.map((target) => ({
            positionKey: target.positionKey,
            code: target.code,
            name: target.name,
            accountKey: target.accountKey,
            actionScore: target.actionScore,
            weightPct: roundNumber(target.weight * 100, 2),
          })),
        });

        equityCurve.push({
          date,
          portfolioValue: roundNumber(portfolioValue, 0),
          dailyReturnPct: null,
          rebalance: true,
        });
      }

      if (index === dates.length - 1) {
        break;
      }

      const nextDate = dates[index + 1];
      const mark = markToMarket(holdings, marketByDate.get(nextDate) ?? new Map(), cashBalance);
      const priorValue = portfolioValue;
      holdings = mark.holdings;
      cashBalance = mark.portfolioValue > 0 && mark.holdings.size === 0 ? mark.portfolioValue : 0;
      portfolioValue = mark.portfolioValue;

      equityCurve.push({
        date: nextDate,
        portfolioValue: roundNumber(portfolioValue, 0),
        dailyReturnPct:
          priorValue > 0 ? roundNumber(((portfolioValue / priorValue) - 1) * 100, 3) : null,
        staleCodes: mark.staleCodes,
        rebalance: false,
      });
    }

    const realizedDailyReturns = equityCurve
      .map((point) => point.dailyReturnPct)
      .filter((value) => Number.isFinite(value));
    const totalReturn = args.capital > 0 ? portfolioValue / args.capital - 1 : 0;
    const annualizedReturn =
      dates.length > 1 && args.capital > 0
        ? Math.pow(Math.max(portfolioValue / args.capital, 1e-9), 252 / (dates.length - 1)) - 1
        : null;
    const maxDrawdown = computeMaxDrawdown(
      equityCurve
        .map((point) => point.portfolioValue)
        .filter((value) => Number.isFinite(value)),
    );
    const winRate =
      realizedDailyReturns.length > 0
        ? realizedDailyReturns.filter((value) => value > 0).length / realizedDailyReturns.length
        : null;

    const payload = {
      generatedAt: new Date().toISOString(),
      engineVersion: "1.0",
      input: {
        start: dates[0],
        end: dates.at(-1),
        capital: args.capital,
        minScore: args.minScore,
        maxPositions: args.maxPositions,
        rebalance: args.rebalance,
        slippageBps: args.slippageBps,
        feeBps: args.feeBps,
        taxRate: args.taxRate,
      },
      summary: {
        dateRange: {
          start: dates[0],
          end: dates.at(-1),
          sessions: dates.length,
        },
        latestPortfolioValue: roundNumber(portfolioValue, 0),
        totalReturnPct: roundNumber(totalReturn * 100, 2),
        annualizedReturnPct: annualizedReturn == null ? null : roundNumber(annualizedReturn * 100, 2),
        maxDrawdownPct: roundNumber(maxDrawdown * 100, 2),
        avgDailyReturnPct: realizedDailyReturns.length > 0 ? roundNumber(mean(realizedDailyReturns), 3) : null,
        winRatePct: winRate == null ? null : roundNumber(winRate * 100, 2),
        rebalanceCount: rebalanceLog.length,
        averageTurnoverPct: rebalanceLog.length > 0 ? roundNumber((totalTurnover / rebalanceLog.length) * 100, 2) : null,
        totalTransactionCost: roundNumber(totalTransactionCost, 0),
        totalTransactionCostPct: args.capital > 0 ? roundNumber((totalTransactionCost / args.capital) * 100, 2) : null,
        totalTaxPaid: roundNumber(totalTaxPaid, 0),
        totalTaxPaidPct: args.capital > 0 ? roundNumber((totalTaxPaid / args.capital) * 100, 2) : null,
      },
      factorExposureHistory,
      rebalanceLog,
      equityCurve,
      notes: [
        "timeseries.db에 stage3 데이터가 없으면 analysis-state JSON을 자동 backfill합니다.",
        "세금은 과세 계좌 매도 이익에 대한 근사치이며, 리밸런싱 시점마다 잔여 cost basis를 현재가로 재기준화합니다.",
        "가격은 data/market/YYYY-MM-DD.json watchlist close를 사용한 close-to-close 근사입니다.",
      ],
    };

    await writeJson(args.output, payload);
    await writeJson(path.join(ROOT_DIR, "data", "backtest", "engine-latest.json"), payload);
    console.log(args.output);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`[backtest-engine] 실패: ${error.message}`);
  process.exit(1);
});
