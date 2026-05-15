import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  readJson,
  resolveSecurityCodeFromCandidates,
  writeJson,
  writeText,
} from "./pipeline-utils.js";

const DEFAULT_EXCHANGE_PREFIX = "KRX";
const DEFAULT_BASIC_LIMIT = 30;
const DEFAULT_BASIC_PINNED_SYMBOLS = [
  {
    symbol: "FOREXCOM:NAS100",
    name: "US Tech 100 CFD",
    source: "basic_pinned:nasdaq",
    reason: "TradingView Basic watchlist anchor",
  },
  {
    symbol: "KRX:KOSPI",
    name: "KOSPI Composite Index",
    source: "basic_pinned:kospi",
    reason: "TradingView Basic watchlist anchor",
  },
  {
    symbol: "BINANCE:BTCUSDT",
    name: "Bitcoin / TetherUS",
    source: "basic_pinned:bitcoin",
    reason: "TradingView Basic watchlist anchor",
  },
  {
    symbol: "OANDA:XAUUSD",
    name: "Gold",
    source: "basic_pinned:gold",
    reason: "TradingView Basic watchlist anchor",
  },
];

function toText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveInvestedAmount(input) {
  const purchaseValue = toNumber(input.purchaseValue ?? input.purchaseAmount ?? input.buyAmount);
  if (purchaseValue != null) return purchaseValue;

  const quantity = toNumber(input.quantity ?? input.qty);
  const avgPrice = toNumber(input.avgPrice ?? input.averagePrice);
  if (quantity != null && avgPrice != null) return quantity * avgPrice;

  return null;
}

function resolveMarketValue(input) {
  const marketValue = toNumber(input.marketValue ?? input.evaluationAmount ?? input.evalAmount);
  if (marketValue != null) return marketValue;

  const quantity = toNumber(input.quantity ?? input.qty);
  const currentPrice = toNumber(input.currentPrice ?? input.price);
  if (quantity != null && currentPrice != null) return quantity * currentPrice;

  return null;
}

function resolveQuantity(input) {
  return toNumber(input.quantity ?? input.qty);
}

function resolveAvgPrice(input) {
  return toNumber(input.avgPrice ?? input.averagePrice);
}

function normalizeCode(value) {
  const text = toText(value);
  if (!text) return null;
  const normalized = text.toUpperCase().replace(/^A/, "");
  if (/^[0-9A-Z]{6}$/.test(normalized)) return normalized;
  return null;
}

function normalizeTradingViewSymbol({ code, exchangePrefix = DEFAULT_EXCHANGE_PREFIX, tradingViewSymbol }) {
  const explicit = toText(tradingViewSymbol);
  if (explicit && explicit.includes(":")) return explicit.toUpperCase();

  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;
  return `${exchangePrefix}:${normalizedCode}`;
}

function normalizeDate(value) {
  const text = toText(value);
  if (!text) return null;

  const compact = text.replace(/[^\d]/g, "");
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  return null;
}

function parseDateParts(date) {
  const normalized = normalizeDate(date);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  if (![year, month, day].every(Number.isInteger)) return null;
  return { year, month, day };
}

function addSecurity(registry, input) {
  const resolvedCode = normalizeCode(input.code) ?? resolveSecurityCodeFromCandidates(input.code, input.name);
  const code = normalizeCode(resolvedCode);
  if (!code) return;

  const symbol = normalizeTradingViewSymbol({
    code,
    exchangePrefix: input.exchangePrefix,
    tradingViewSymbol: input.tradingViewSymbol,
  });
  if (!symbol) return;

  const securityMaster = SECURITIES_BY_CODE[code] ?? {};
  const existing = registry.get(symbol) ?? {
    symbol,
    code,
    name: toText(input.name) ?? securityMaster.name ?? code,
    exchangePrefix: input.exchangePrefix ?? DEFAULT_EXCHANGE_PREFIX,
    accounts: new Set(),
    sources: new Set(),
    reasons: new Set(),
    latestDate: null,
    priority: 0,
    investedAmount: 0,
    marketValue: 0,
  };

  if (!existing.name || existing.name === code) {
    existing.name = toText(input.name) ?? securityMaster.name ?? code;
  }
  if (input.accountKey || input.account || input.accountLabel) {
    existing.accounts.add(toText(input.accountKey ?? input.account ?? input.accountLabel));
  }
  if (input.source) existing.sources.add(input.source);
  if (input.reason) existing.reasons.add(input.reason);
  if (input.date && (!existing.latestDate || String(input.date) > existing.latestDate)) {
    existing.latestDate = String(input.date);
  }
  existing.priority = Math.max(existing.priority, input.priority ?? 0);
  existing.investedAmount += resolveInvestedAmount(input) ?? 0;
  existing.marketValue += resolveMarketValue(input) ?? 0;

  registry.set(symbol, existing);
}

function addWatchlistItems(registry, watchlist, exchangePrefix) {
  for (const [bucket, items] of Object.entries(watchlist ?? {})) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      addSecurity(registry, {
        ...item,
        exchangePrefix,
        source: `config_watchlist:${bucket}`,
        priority: 40,
      });
    }
  }
}

function addPortfolioHoldings(registry, portfolio, exchangePrefix) {
  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      addSecurity(registry, {
        ...holding,
        exchangePrefix,
        accountKey: account.key,
        accountLabel: account.label,
        source: "kis_holding",
        reason: "current KIS holding",
        date: portfolio.date,
        priority: 100,
      });
    }
  }
}

function addAveragePriceEntry(registry, holding, account, portfolio, exchangePrefix) {
  const resolvedCode = normalizeCode(holding.code) ?? resolveSecurityCodeFromCandidates(holding.code, holding.name);
  const code = normalizeCode(resolvedCode);
  if (!code) return;

  const symbol = normalizeTradingViewSymbol({
    code,
    exchangePrefix,
    tradingViewSymbol: holding.tradingViewSymbol,
  });
  if (!symbol) return;

  const quantity = resolveQuantity(holding);
  if (quantity == null || quantity <= 0) return;

  const investedAmount = resolveInvestedAmount(holding);
  const avgPrice = resolveAvgPrice(holding);
  const purchaseValue = investedAmount ?? (avgPrice != null ? avgPrice * quantity : null);
  if (purchaseValue == null || purchaseValue <= 0) return;

  const securityMaster = SECURITIES_BY_CODE[code] ?? {};
  const existing = registry.get(symbol) ?? {
    symbol,
    code,
    name: toText(holding.name) ?? securityMaster.name ?? code,
    accounts: new Set(),
    quantity: 0,
    purchaseValue: 0,
    marketValue: 0,
    latestDate: portfolio?.date ?? null,
  };

  if (!existing.name || existing.name === code) {
    existing.name = toText(holding.name) ?? securityMaster.name ?? code;
  }
  if (account?.key || account?.label) {
    existing.accounts.add(toText(account.key ?? account.label));
  }
  existing.quantity += quantity;
  existing.purchaseValue += purchaseValue;
  existing.marketValue += resolveMarketValue(holding) ?? 0;
  if (portfolio?.date && (!existing.latestDate || String(portfolio.date) > existing.latestDate)) {
    existing.latestDate = String(portfolio.date);
  }

  registry.set(symbol, existing);
}

function buildAveragePriceEntries(portfolio, exchangePrefix) {
  const registry = new Map();

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      addAveragePriceEntry(registry, holding, account, portfolio, exchangePrefix);
    }
  }

  return [...registry.values()]
    .map((entry) => ({
      symbol: entry.symbol,
      code: entry.code,
      name: entry.name,
      accounts: [...entry.accounts].filter(Boolean).sort(),
      quantity: entry.quantity,
      purchaseValue: entry.purchaseValue,
      avgPrice: entry.purchaseValue / entry.quantity,
      marketValue: entry.marketValue,
      latestDate: entry.latestDate,
    }))
    .sort((a, b) => {
      if (b.purchaseValue !== a.purchaseValue) return b.purchaseValue - a.purchaseValue;
      return a.symbol.localeCompare(b.symbol);
    });
}

function extractOrderRows(portfolio) {
  const rows = [];
  for (const account of portfolio?.accounts ?? []) {
    const orderRows = account?.raw?.orders?.rows;
    if (!Array.isArray(orderRows)) continue;
    for (const row of orderRows) {
      rows.push({
        ...row,
        accountKey: row.accountKey ?? account.key,
        accountLabel: row.accountLabel ?? account.label,
      });
    }
  }
  return rows;
}

function normalizeBuySide(input, { defaultValue = false } = {}) {
  const sideText = [
    input.side,
    input.type,
    input.tradeType,
    input.orderType,
    input.sll_buy_dvsn_name,
    input.sll_buy_dvsn_cd_name,
    input.trad_dvsn_name,
    input.buySell,
  ]
    .map(toText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!sideText) return defaultValue;
  if (/(sell|ask|매도|sll)/i.test(sideText)) return false;
  if (/(buy|bid|매수)/i.test(sideText)) return true;
  return defaultValue;
}

function normalizeTradeSide(input, { defaultValue = null } = {}) {
  const isBuy = normalizeBuySide(input, { defaultValue });
  return isBuy == null ? null : Boolean(isBuy);
}

function normalizeBuyMarkerEvent(input, { exchangePrefix = DEFAULT_EXCHANGE_PREFIX, currentByCode, currentBySymbol, source }) {
  const explicitSymbol = toText(input.symbol ?? input.tradingViewSymbol);
  const resolvedCode =
    normalizeCode(input.code ?? input.pdno ?? input.stockCode ?? input.ticker) ??
    (explicitSymbol?.includes(":") ? normalizeCode(explicitSymbol.split(":").at(-1)) : null);
  const symbol = normalizeTradingViewSymbol({
    code: resolvedCode,
    exchangePrefix,
    tradingViewSymbol: explicitSymbol,
  });
  if (!symbol) return null;

  const holding = currentBySymbol.get(symbol) ?? (resolvedCode ? currentByCode.get(resolvedCode) : null);
  if (!holding) return null;

  const date = normalizeDate(
    input.date ??
      input.buyDate ??
      input.executionDate ??
      input.executedAt ??
      input.trad_dt ??
      input.ord_dt ??
      input.ccld_dt ??
      input.stlm_dt,
  );
  if (!date) return null;

  const fromManualSource = source?.startsWith("manual");
  const isBuy = normalizeTradeSide(input, { defaultValue: fromManualSource ? true : null });
  if (isBuy == null) return null;

  return {
    symbol: holding.symbol,
    code: holding.code,
    name: holding.name,
    date,
    isBuy,
    accountKey: toText(input.accountKey ?? input.account ?? input.acnt_no),
    accountLabel: toText(input.accountLabel),
    quantity: toNumber(input.quantity ?? input.qty ?? input.ccld_qty ?? input.tot_ccld_qty),
    price: toNumber(input.price ?? input.avgPrice ?? input.executionPrice ?? input.ccld_unpr ?? input.ord_unpr),
    source,
    note: toText(input.note ?? input.memo),
  };
}

async function readManualBuyMarkerEvents() {
  const paths = [
    path.join(ROOT_DIR, "config", "tradingview-buy-events.json"),
    path.join(ROOT_DIR, "data", "tradingview", "buy-events.json"),
  ];
  const events = [];

  for (const filePath of paths) {
    const payload = await readJson(filePath, null);
    const rows = Array.isArray(payload) ? payload : payload?.events;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      events.push({
        ...row,
        source: row.source ?? `manual:${path.relative(ROOT_DIR, filePath)}`,
      });
    }
  }

  return events;
}

async function buildBuyMarkerEntries(portfolio, averagePriceEntries, exchangePrefix) {
  const currentBySymbol = new Map(averagePriceEntries.map((entry) => [entry.symbol, entry]));
  const currentByCode = new Map(averagePriceEntries.map((entry) => [entry.code, entry]));
  const rows = [
    ...(await readManualBuyMarkerEvents()),
    ...extractOrderRows(portfolio).map((row) => ({
      ...row,
      source: row.source ?? "kis_order_fill",
    })),
  ];
  const deduped = new Map();

  for (const row of rows) {
    const normalized = normalizeBuyMarkerEvent(row, {
      exchangePrefix,
      currentByCode,
      currentBySymbol,
      source: row.source,
    });
    if (!normalized) continue;
    const key = [
      normalized.symbol,
      normalized.date,
      normalized.isBuy ? "buy" : "sell",
      normalized.accountKey ?? "",
      normalized.quantity ?? "",
      normalized.price ?? "",
      normalized.source ?? "",
    ].join("|");
    deduped.set(key, normalized);
  }

  const grouped = new Map();
  for (const event of deduped.values()) {
    const key = `${event.symbol}|${event.date}|${event.isBuy ? "buy" : "sell"}`;
    const existing = grouped.get(key) ?? {
      ...event,
      accountKeys: new Set(),
      accountLabels: new Set(),
      sources: new Set(),
      quantity: 0,
      priceCost: 0,
      priceQuantity: 0,
    };
    if (event.accountKey) existing.accountKeys.add(event.accountKey);
    if (event.accountLabel) existing.accountLabels.add(event.accountLabel);
    if (event.source) existing.sources.add(event.source);
    if (event.quantity != null) existing.quantity += event.quantity;
    if (event.price != null && event.quantity != null && event.quantity > 0) {
      existing.priceCost += event.price * event.quantity;
      existing.priceQuantity += event.quantity;
    } else if (existing.price == null && event.price != null) {
      existing.price = event.price;
    }
    grouped.set(key, existing);
  }

  return [...grouped.values()].map((event) => ({
    symbol: event.symbol,
    code: event.code,
    name: event.name,
    date: event.date,
    isBuy: event.isBuy,
    accountKeys: [...event.accountKeys].filter(Boolean).sort(),
    accountLabels: [...event.accountLabels].filter(Boolean).sort(),
    quantity: event.quantity || null,
    price: event.priceQuantity > 0 ? event.priceCost / event.priceQuantity : event.price,
    sources: [...event.sources].filter(Boolean).sort(),
    note: event.note,
  })).sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    return a.date.localeCompare(b.date);
  });
}

function addStage4Plan(registry, stage4Plan, exchangePrefix) {
  for (const accountPlan of stage4Plan?.accountPlans ?? []) {
    for (const item of accountPlan.stagedBuys ?? []) {
      addSecurity(registry, {
        ...item,
        exchangePrefix,
        accountKey: accountPlan.key,
        accountLabel: accountPlan.label,
        source: "stage4_planned_buy",
        date: stage4Plan.date,
        priority: 90,
      });
    }
    for (const item of accountPlan.stage2Candidates ?? []) {
      addSecurity(registry, {
        ...item,
        exchangePrefix,
        accountKey: accountPlan.key,
        accountLabel: accountPlan.label,
        source: "stage4_buy_candidate",
        date: stage4Plan.date,
        priority: 80,
      });
    }
    for (const item of accountPlan.trims ?? []) {
      addSecurity(registry, {
        ...item,
        exchangePrefix,
        accountKey: accountPlan.key,
        accountLabel: accountPlan.label,
        source: "stage4_trim_candidate",
        date: stage4Plan.date,
        priority: 70,
      });
    }
    for (const item of accountPlan.watches ?? []) {
      addSecurity(registry, {
        ...item,
        exchangePrefix,
        accountKey: accountPlan.key,
        accountLabel: accountPlan.label,
        source: "stage4_watch",
        date: stage4Plan.date,
        priority: 60,
      });
    }
    if (accountPlan.candidateFromGap) {
      addSecurity(registry, {
        name: accountPlan.candidateFromGap,
        exchangePrefix,
        accountKey: accountPlan.key,
        accountLabel: accountPlan.label,
        source: "stage4_gap_candidate",
        date: stage4Plan.date,
        priority: 55,
      });
    }
  }
}

async function readJsonl(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function addExecutionHistory(registry, exchangePrefix) {
  const historyPath = path.join(ROOT_DIR, "data", "feedback", "ghost-portfolio.jsonl");
  const rows = await readJsonl(historyPath);
  for (const item of rows) {
    addSecurity(registry, {
      ...item,
      exchangePrefix,
      accountKey: item.accountKey,
      accountLabel: item.accountLabel,
      source: "ghost_execution_history",
      date: item.date,
      priority: 50,
    });
  }
}

function serializeEntries(registry) {
  return [...registry.values()]
    .map((entry) => ({
      ...entry,
      accounts: [...entry.accounts].filter(Boolean).sort(),
      sources: [...entry.sources].filter(Boolean).sort(),
      reasons: [...entry.reasons].filter(Boolean).slice(0, 6),
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.symbol.localeCompare(b.symbol);
    });
}

function createPinnedEntry(item) {
  return {
    symbol: item.symbol,
    code: null,
    name: item.name,
    exchangePrefix: item.symbol.split(":")[0],
    accounts: [],
    sources: [item.source],
    reasons: [item.reason],
    latestDate: null,
    priority: 1000,
    investedAmount: 0,
    marketValue: 0,
    pinned: true,
  };
}

function compareBasicCandidate(a, b) {
  const aInvested = a.investedAmount || 0;
  const bInvested = b.investedAmount || 0;
  if (bInvested !== aInvested) return bInvested - aInvested;

  const aMarket = a.marketValue || 0;
  const bMarket = b.marketValue || 0;
  if (bMarket !== aMarket) return bMarket - aMarket;

  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.symbol.localeCompare(b.symbol);
}

function buildBasicEntries(entries, { pinnedSymbols = DEFAULT_BASIC_PINNED_SYMBOLS, limit = DEFAULT_BASIC_LIMIT } = {}) {
  const picked = [];
  const seen = new Set();

  for (const item of pinnedSymbols) {
    const symbol = toText(item.symbol)?.toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    picked.push(createPinnedEntry({ ...item, symbol }));
    seen.add(symbol);
  }

  const rankedEntries = [...entries].sort(compareBasicCandidate);
  for (const entry of rankedEntries) {
    if (picked.length >= limit) break;
    if (seen.has(entry.symbol)) continue;
    picked.push(entry);
    seen.add(entry.symbol);
  }

  return picked;
}

function formatPineNumber(value) {
  if (!Number.isFinite(value)) return "na";
  return String(Number(value.toFixed(6)));
}

function formatPineString(value) {
  return JSON.stringify(String(value ?? ""));
}

function buildPineSymbolCondition(symbol) {
  const symbols = new Set([symbol]);
  const [exchange, ticker] = String(symbol).split(":");
  if (exchange === "KRX" && ticker) symbols.add(`KRX_DLY:${ticker}`);

  return [...symbols]
    .map((candidate) => `syminfo.tickerid == ${formatPineString(candidate)}`)
    .join(" or ");
}

function formatBuyMarkerLabel(entry) {
  return "";
}

function buildAveragePricePine(entries, { buyMarkerEntries = [], generatedAt, date } = {}) {
  const lines = [
    "//@version=5",
    'indicator("KIS Avg + Buy Markers + RSI MTF", overlay=true, max_lines_count=100, max_labels_count=100)',
    "",
    "var line avgLine = na",
    "var label avgLabel = na",
    "var table rsiTable = table.new(position.top_right, 3, 7, border_width=1)",
    "",
    "isEventBar(int eventTs) => time <= eventTs and time_close > eventTs",
    "fRsiDivSignal(int recentBars) =>",
    "    float r = ta.rsi(close, 14)",
    "    float pl = ta.pivotlow(low, 2, 2)",
    "    float ph = ta.pivothigh(high, 2, 2)",
    "    float prevPl = ta.valuewhen(not na(pl), pl, 1)",
    "    float prevPlRsi = ta.valuewhen(not na(pl), r[2], 1)",
    "    float prevPh = ta.valuewhen(not na(ph), ph, 1)",
    "    float prevPhRsi = ta.valuewhen(not na(ph), r[2], 1)",
    "    bool bull = not na(pl) and not na(prevPl) and pl < prevPl * 0.997 and r[2] > prevPlRsi + 3",
    "    bool bear = not na(ph) and not na(prevPh) and ph > prevPh * 1.003 and r[2] < prevPhRsi - 3",
    "    int bullAgo = nz(ta.barssince(bull), 100000)",
    "    int bearAgo = nz(ta.barssince(bear), 100000)",
    "    bool recentBull = bullAgo <= recentBars",
    "    bool recentBear = bearAgo <= recentBars",
    "    int signal = recentBull and (not recentBear or bullAgo < bearAgo) ? 1 : recentBear ? -1 : 0",
    "    int age = signal == 1 ? bullAgo : signal == -1 ? bearAgo : na",
    "    [signal, r, age]",
    "fRsiDivEvent() =>",
    "    float r = ta.rsi(close, 14)",
    "    float pl = ta.pivotlow(low, 2, 2)",
    "    float ph = ta.pivothigh(high, 2, 2)",
    "    float prevPl = ta.valuewhen(not na(pl), pl, 1)",
    "    float prevPlRsi = ta.valuewhen(not na(pl), r[2], 1)",
    "    float prevPh = ta.valuewhen(not na(ph), ph, 1)",
    "    float prevPhRsi = ta.valuewhen(not na(ph), r[2], 1)",
    "    bool bull = not na(pl) and not na(prevPl) and pl < prevPl * 0.997 and r[2] > prevPlRsi + 3",
    "    bool bear = not na(ph) and not na(prevPh) and ph > prevPh * 1.003 and r[2] < prevPhRsi - 3",
    "    [bull ? pl : na, bear ? ph : na]",
    "divText(int signal, int age) => signal == 1 ? \"상승Div \" + str.tostring(age) + \"봉전\" : signal == -1 ? \"하락Div \" + str.tostring(age) + \"봉전\" : \"없음\"",
    "divColor(int signal) => signal == 1 ? color.new(color.lime, 0) : signal == -1 ? color.new(color.red, 0) : color.new(color.gray, 35)",
    "",
    "float avgPrice = na",
    "float quantity = na",
    "float purchaseValue = na",
    "",
  ];

  for (const entry of entries) {
    lines.push(`if ${buildPineSymbolCondition(entry.symbol)}`);
    lines.push(`    avgPrice := ${formatPineNumber(entry.avgPrice)}`);
    lines.push(`    quantity := ${formatPineNumber(entry.quantity)}`);
    lines.push(`    purchaseValue := ${formatPineNumber(entry.purchaseValue)}`);
  }

  const renderableBuyMarkers = buyMarkerEntries
    .map((entry) => ({
      ...entry,
      dateParts: parseDateParts(entry.date),
    }))
    .filter((entry) => entry.dateParts);

  if (renderableBuyMarkers.length > 0) {
    lines.push("", "// Trade execution pins. Exact dates come from manual events or KIS order rows.");
    for (const [index, entry] of renderableBuyMarkers.entries()) {
      const { year, month, day } = entry.dateParts;
      const eventTsVar = `buyTs_${entry.code}_${entry.date.replaceAll("-", "_")}_${index + 1}`;
      const markerColor = entry.isBuy === false ? "red" : "lime";
      const fallbackY = entry.isBuy === false ? "high" : "low";
      const markerY = entry.price != null ? formatPineNumber(entry.price) : fallbackY;
      lines.push(`int ${eventTsVar} = timestamp("Asia/Seoul", ${year}, ${month}, ${day}, 12, 0)`);
      lines.push(`if (${buildPineSymbolCondition(entry.symbol)}) and isEventBar(${eventTsVar})`);
      lines.push(
        `    label.new(bar_index, ${markerY}, ${formatPineString(formatBuyMarkerLabel(entry))}, style=label.style_circle, textcolor=color.white, color=color.new(color.${markerColor}, 50), size=size.tiny)`,
      );
    }
  }

  lines.push(
    "",
    "[divM, rsiM, ageM] = request.security(syminfo.tickerid, \"M\", fRsiDivSignal(6))",
    "[divW, rsiW, ageW] = request.security(syminfo.tickerid, \"W\", fRsiDivSignal(8))",
    "[divD, rsiD, ageD] = request.security(syminfo.tickerid, \"D\", fRsiDivSignal(20))",
    "[div4h, rsi4h, age4h] = request.security(syminfo.tickerid, \"240\", fRsiDivSignal(18))",
    "[div1h, rsi1h, age1h] = request.security(syminfo.tickerid, \"60\", fRsiDivSignal(24))",
    "[div30m, rsi30m, age30m] = request.security(syminfo.tickerid, \"30\", fRsiDivSignal(32))",
    "[bullDivPrice, bearDivPrice] = fRsiDivEvent()",
    "plotshape(bullDivPrice, title=\"상승 RSI Div\", style=shape.circle, location=location.absolute, offset=-2, color=color.new(color.lime, 0), size=size.tiny)",
    "plotshape(bearDivPrice, title=\"하락 RSI Div\", style=shape.circle, location=location.absolute, offset=-2, color=color.new(color.red, 0), size=size.tiny)",
    "",
    "if barstate.islast",
    "    table.cell(rsiTable, 0, 0, \"RSI Div\", text_color=color.white, bgcolor=color.new(color.black, 0), text_size=size.normal)",
    "    table.cell(rsiTable, 1, 0, \"RSI\", text_color=color.white, bgcolor=color.new(color.black, 0), text_size=size.normal)",
    "    table.cell(rsiTable, 2, 0, \"Signal\", text_color=color.white, bgcolor=color.new(color.black, 0), text_size=size.normal)",
    "    table.cell(rsiTable, 0, 1, \"M\", text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 1, 1, str.tostring(rsiM, \"#.0\"), text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 2, 1, divText(divM, ageM), text_color=color.white, bgcolor=divColor(divM), text_size=size.normal)",
    "    table.cell(rsiTable, 0, 2, \"W\", text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 1, 2, str.tostring(rsiW, \"#.0\"), text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 2, 2, divText(divW, ageW), text_color=color.white, bgcolor=divColor(divW), text_size=size.normal)",
    "    table.cell(rsiTable, 0, 3, \"D\", text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 1, 3, str.tostring(rsiD, \"#.0\"), text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 2, 3, divText(divD, ageD), text_color=color.white, bgcolor=divColor(divD), text_size=size.normal)",
    "    table.cell(rsiTable, 0, 4, \"4H\", text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 1, 4, str.tostring(rsi4h, \"#.0\"), text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 2, 4, divText(div4h, age4h), text_color=color.white, bgcolor=divColor(div4h), text_size=size.normal)",
    "    table.cell(rsiTable, 0, 5, \"1H\", text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 1, 5, str.tostring(rsi1h, \"#.0\"), text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 2, 5, divText(div1h, age1h), text_color=color.white, bgcolor=divColor(div1h), text_size=size.normal)",
    "    table.cell(rsiTable, 0, 6, \"30m\", text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 1, 6, str.tostring(rsi30m, \"#.0\"), text_color=color.white, bgcolor=color.new(color.black, 15), text_size=size.normal)",
    "    table.cell(rsiTable, 2, 6, divText(div30m, age30m), text_color=color.white, bgcolor=divColor(div30m), text_size=size.normal)",
    "    if not na(avgPrice)",
    '        string labelText = "평단: " + str.tostring(avgPrice, format.mintick)',
    "        if na(avgLine)",
    "            avgLine := line.new(bar_index - 1, avgPrice, bar_index, avgPrice, extend=extend.both, color=color.new(color.orange, 50), width=2)",
    "        else",
    "            line.set_xy1(avgLine, bar_index - 1, avgPrice)",
    "            line.set_xy2(avgLine, bar_index, avgPrice)",
    "            line.set_color(avgLine, color.new(color.orange, 50))",
    "            line.set_width(avgLine, 2)",
    "        if na(avgLabel)",
    "            avgLabel := label.new(bar_index, avgPrice, labelText, style=label.style_label_left, textcolor=color.white, color=color.new(color.orange, 50), size=size.large)",
    "        else",
    "            label.set_xy(avgLabel, bar_index, avgPrice)",
    "            label.set_text(avgLabel, labelText)",
    "            label.set_textcolor(avgLabel, color.white)",
    "            label.set_color(avgLabel, color.new(color.orange, 50))",
    "    else",
    "        if not na(avgLine)",
    "            line.delete(avgLine)",
    "            avgLine := na",
    "        if not na(avgLabel)",
    "            label.delete(avgLabel)",
    "            avgLabel := na",
    "",
    `// Generated from KIS portfolio${date ? ` for ${date}` : ""} at ${generatedAt ?? "unknown"}.`,
  );

  return `${lines.join("\n")}\n`;
}

export async function buildTradingViewWatchlistArtifacts({
  date,
  portfolio = null,
  exchangePrefix = DEFAULT_EXCHANGE_PREFIX,
} = {}) {
  const effectiveDate = date ?? portfolio?.date;
  const registry = new Map();
  const watchlist = await readJson(path.join(ROOT_DIR, "config", "watchlist.json"), {});
  const latestPortfolio =
    portfolio ?? (await readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), null));
  const stage4Plan = effectiveDate
    ? await readJson(
        path.join(ROOT_DIR, "data", "analysis-state", effectiveDate, "stage4-execution-plan.json"),
        null,
      )
    : null;

  addPortfolioHoldings(registry, latestPortfolio, exchangePrefix);
  addWatchlistItems(registry, watchlist, exchangePrefix);
  addStage4Plan(registry, stage4Plan, exchangePrefix);
  await addExecutionHistory(registry, exchangePrefix);

  const entries = serializeEntries(registry);
  const symbols = entries.map((entry) => entry.symbol);
  const basicEntries = buildBasicEntries(entries);
  const basicSymbols = basicEntries.map((entry) => entry.symbol);
  const averagePriceEntries = buildAveragePriceEntries(latestPortfolio, exchangePrefix);
  const buyMarkerEntries = await buildBuyMarkerEntries(latestPortfolio, averagePriceEntries, exchangePrefix);
  const generatedAt = new Date().toISOString();
  const outputDir = path.join(ROOT_DIR, "data", "tradingview", effectiveDate ?? "latest");
  const txtPath = path.join(outputDir, "watchlist.txt");
  const manifestPath = path.join(outputDir, "watchlist-manifest.json");
  const basicTxtPath = path.join(outputDir, "watchlist-basic.txt");
  const basicManifestPath = path.join(outputDir, "watchlist-basic-manifest.json");
  const avgPricePinePath = path.join(outputDir, "avg-price-lines.pine");
  const avgPriceManifestPath = path.join(outputDir, "avg-price-lines-manifest.json");
  const latestTxtPath = path.join(ROOT_DIR, "data", "tradingview", "latest-watchlist.txt");
  const latestManifestPath = path.join(ROOT_DIR, "data", "tradingview", "latest-watchlist-manifest.json");
  const latestBasicTxtPath = path.join(ROOT_DIR, "data", "tradingview", "latest-watchlist-basic.txt");
  const latestBasicManifestPath = path.join(
    ROOT_DIR,
    "data",
    "tradingview",
    "latest-watchlist-basic-manifest.json",
  );
  const latestAvgPricePinePath = path.join(ROOT_DIR, "data", "tradingview", "latest-avg-price-lines.pine");
  const latestAvgPriceManifestPath = path.join(
    ROOT_DIR,
    "data",
    "tradingview",
    "latest-avg-price-lines-manifest.json",
  );

  const manifest = {
    date: effectiveDate ?? null,
    generatedAt,
    format: "TradingView import .txt: exchange-prefixed symbols, comma-separated",
    exchangePrefix,
    symbolCount: symbols.length,
    symbols,
    entries,
  };
  const basicManifest = {
    ...manifest,
    format: "TradingView Basic watchlist: pinned macro symbols plus highest-priority KIS symbols, comma-separated",
    planLimit: DEFAULT_BASIC_LIMIT,
    pinnedSymbols: DEFAULT_BASIC_PINNED_SYMBOLS.map((item) => item.symbol),
    symbolCount: basicSymbols.length,
    symbols: basicSymbols,
    entries: basicEntries,
  };
  const avgPriceManifest = {
    date: effectiveDate ?? null,
    generatedAt,
    format:
      "TradingView Pine Script v5 indicator: horizontal average purchase price line plus vertical buy markers per KIS holding",
    exchangePrefix,
    symbolCount: averagePriceEntries.length,
    buyMarkerEventCount: buyMarkerEntries.length,
    buyMarkerSymbols: [...new Set(buyMarkerEntries.map((entry) => entry.symbol))],
    symbols: averagePriceEntries.map((entry) => entry.symbol),
    entries: averagePriceEntries,
    buyMarkers: buyMarkerEntries,
  };
  const avgPricePine = buildAveragePricePine(averagePriceEntries, {
    buyMarkerEntries,
    generatedAt,
    date: effectiveDate,
  });

  await writeText(txtPath, `${symbols.join(",")}\n`);
  await writeJson(manifestPath, manifest);
  await writeText(basicTxtPath, `${basicSymbols.join(",")}\n`);
  await writeJson(basicManifestPath, basicManifest);
  await writeText(avgPricePinePath, avgPricePine);
  await writeJson(avgPriceManifestPath, avgPriceManifest);
  await writeText(latestTxtPath, `${symbols.join(",")}\n`);
  await writeJson(latestManifestPath, manifest);
  await writeText(latestBasicTxtPath, `${basicSymbols.join(",")}\n`);
  await writeJson(latestBasicManifestPath, basicManifest);
  await writeText(latestAvgPricePinePath, avgPricePine);
  await writeJson(latestAvgPriceManifestPath, avgPriceManifest);

  return {
    txtPath,
    manifestPath,
    basicTxtPath,
    basicManifestPath,
    avgPricePinePath,
    avgPriceManifestPath,
    latestTxtPath,
    latestManifestPath,
    latestBasicTxtPath,
    latestBasicManifestPath,
    latestAvgPricePinePath,
    latestAvgPriceManifestPath,
    symbolCount: symbols.length,
    basicSymbolCount: basicSymbols.length,
    averagePriceSymbolCount: averagePriceEntries.length,
    buyMarkerEventCount: buyMarkerEntries.length,
  };
}
