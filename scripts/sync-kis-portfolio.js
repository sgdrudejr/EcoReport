#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";

import {
  ROOT_DIR,
  enrichPortfolioWithSecurityCodes,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";
import { loadLocalPaths, resolveLocalPath } from "./lib/local-paths.js";
import { buildTradingViewWatchlistArtifacts } from "./lib/tradingview-watchlist.js";

const DEFAULT_SYNC_CONFIG = {
  sources: [
    {
      type: "kis",
      enabled: true,
      portfolioKey: "KIS_MAIN",
      label: "한투 일반",
      env: "real",
      account: "",
      authProfile: "",
      includeInLatest: true,
      skipRealized: false,
    },
  ],
};
const DEFAULT_ORDER_LOOKBACK_DAYS = 90;

function compactDate(date) {
  return String(date ?? "").replace(/-/g, "");
}

function shiftDate(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function resolveOrderHistoryStart(source, date) {
  const explicit = toText(source.orderHistoryStart ?? process.env.KIS_ORDER_HISTORY_START);
  if (explicit) return explicit;

  const lookbackDays = toNumber(source.orderHistoryLookbackDays ?? process.env.KIS_ORDER_HISTORY_LOOKBACK_DAYS);
  const boundedLookbackDays =
    lookbackDays != null && lookbackDays > 0 ? Math.min(Math.floor(lookbackDays), 90) : DEFAULT_ORDER_LOOKBACK_DAYS;
  return shiftDate(date, -(boundedLookbackDays - 1));
}

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeAccountNumber(value) {
  const text = toText(value);
  if (!text) return "";
  const digitsOnly = text.replace(/\D/g, "");
  return digitsOnly;
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function firstRecord(records) {
  return Array.isArray(records) && records.length > 0 ? records[0] : {};
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function buildCashBreakdown(raw) {
  const summary = firstRecord(raw.balance?.summary);
  const realizedSummary = firstRecord(raw.realized?.summary);
  const orderableSummary = firstRecord(raw.orderable?.summary ?? raw.orderable?.rows);

  const nonReceivableBuyAmount = firstNumber(orderableSummary.nrcvb_buy_amt);
  const orderableCash = firstNumber(orderableSummary.ord_psbl_cash);
  const maxBuyAmount = firstNumber(orderableSummary.max_buy_amt);
  const reusableAmount = firstNumber(orderableSummary.ruse_psbl_amt);
  const depositCash = firstNumber(summary.dnca_tot_amt, realizedSummary.dnca_tot_amt);
  const nextSettlementCash = firstNumber(
    summary.nxdy_excc_amt,
    realizedSummary.nxdy_excc_amt,
  );
  const previousReceivableSettlementCash = firstNumber(
    summary.prvs_rcdl_excc_amt,
    realizedSummary.prvs_rcdl_excc_amt,
  );
  const todaySellAmount = firstNumber(summary.thdt_sll_amt, realizedSummary.thdt_sll_amt);
  const todayBuyAmount = firstNumber(summary.thdt_buy_amt, realizedSummary.thdt_buy_amt);
  const cmaEvaluationAmount = firstNumber(
    orderableSummary.cma_evlu_amt,
    orderableSummary.cma_evlu_amt_icld_amt,
    summary.cma_evlu_amt,
    realizedSummary.cma_evlu_amt,
  );
  const buyableCash = firstNumber(
    nonReceivableBuyAmount,
    orderableCash,
    maxBuyAmount,
    depositCash,
  );

  return {
    source: depositCash != null
      ? "kis_inquire_balance.dnca_tot_amt"
      : orderableCash != null
        ? "kis_inquire_psbl_order.ord_psbl_cash"
        : nonReceivableBuyAmount != null
          ? "kis_inquire_psbl_order.nrcvb_buy_amt"
          : maxBuyAmount != null
            ? "kis_inquire_psbl_order.max_buy_amt"
            : "none",
    buyableSource: nonReceivableBuyAmount != null
      ? "kis_inquire_psbl_order.nrcvb_buy_amt"
      : orderableCash != null
        ? "kis_inquire_psbl_order.ord_psbl_cash"
        : maxBuyAmount != null
          ? "kis_inquire_psbl_order.max_buy_amt"
          : depositCash != null
            ? "kis_inquire_balance.dnca_tot_amt"
            : "none",
    buyableCash,
    nonReceivableBuyAmount,
    orderableCash,
    maxBuyAmount,
    reusableAmount,
    depositCash,
    nextSettlementCash,
    previousReceivableSettlementCash,
    todaySellAmount,
    todayBuyAmount,
    cmaEvaluationAmount,
    orderableError: toText(raw.orderable?.error),
    orderableQuery: raw.orderable_query ?? null,
  };
}

function resolveOpenTradingApiPaths() {
  const localPaths = loadLocalPaths();
  const root =
    resolveLocalPath(
      localPaths.openTradingApiRoot,
      process.env.OPEN_TRADING_API_ROOT,
      process.env.KIS_OPEN_TRADING_API_ROOT,
      path.join(ROOT_DIR, "open-trading-api"),
      path.join(path.dirname(ROOT_DIR), "open-trading-api"),
    ) ?? path.join(ROOT_DIR, "open-trading-api");
  const python = path.join(root, ".venv", "bin", "python");
  const script = path.join(
    root,
    "examples_user",
    "domestic_stock",
    "readonly_account_snapshot.py",
  );
  const orderableScript = path.join(ROOT_DIR, "scripts", "fetch-kis-orderable-snapshot.py");

  if (!fs.existsSync(root)) {
    throw new Error(`open-trading-api 경로를 찾을 수 없습니다: ${root}`);
  }
  if (!fs.existsSync(script)) {
    throw new Error(`KIS 조회 스크립트를 찾을 수 없습니다: ${script}`);
  }
  if (!fs.existsSync(python)) {
    throw new Error(`open-trading-api Python 환경을 찾을 수 없습니다: ${python}`);
  }
  if (!fs.existsSync(orderableScript)) {
    throw new Error(`KIS 주문가능금액 보강 스크립트를 찾을 수 없습니다: ${orderableScript}`);
  }

  return { root, python, script, orderableScript };
}

function resolveKisConfigRoot() {
  const localPaths = loadLocalPaths();
  return (
    resolveLocalPath(
      localPaths.kisConfigRoot,
      process.env.KIS_CONFIG_ROOT,
      path.join(process.env.HOME ?? "", "KIS", "config"),
      path.join(os.homedir(), "KIS", "config"),
    ) ?? path.join(os.homedir(), "KIS", "config")
  );
}

function sanitizeSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function resolveAuthConfigPath(source, kisConfigRoot) {
  const explicitPath = toText(source.authConfigPath);
  const authProfile = toText(source.authProfile);

  const candidates = [];
  if (explicitPath) {
    candidates.push(resolveLocalPath(explicitPath));
    candidates.push(path.resolve(kisConfigRoot, explicitPath));
    candidates.push(path.resolve(ROOT_DIR, explicitPath));
  }
  if (authProfile) {
    candidates.push(path.join(kisConfigRoot, `kis_devlp-${authProfile}.yaml`));
  }
  if (!explicitPath && !authProfile) {
    candidates.push(path.join(kisConfigRoot, "kis_devlp.yaml"));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `KIS 인증 파일을 찾을 수 없습니다 (${source.portfolioKey}). ${authProfile ? `kis_devlp-${authProfile}.yaml` : "kis_devlp.yaml"} 파일과 KIS config 경로를 확인하세요.`,
  );
}

function prepareSourceAuthRuntime(source, context) {
  const authConfigPath = resolveAuthConfigPath(source, context.kisConfigRoot);
  const authTag = sanitizeSegment(source.authProfile || source.portfolioKey || source.label);
  const runtimeHome = path.join(os.tmpdir(), "ecoreport-kis-runtime", authTag);
  const configRoot = path.join(runtimeHome, "KIS", "config");
  const linkedConfigPath = path.join(configRoot, "kis_devlp.yaml");
  const tokenPath = path.join(configRoot, `KIS${compactDate(context.date)}`);

  fs.mkdirSync(configRoot, { recursive: true });

  if (fs.existsSync(linkedConfigPath)) {
    fs.rmSync(linkedConfigPath, { force: true });
  }
  fs.symlinkSync(authConfigPath, linkedConfigPath);
  fs.writeFileSync(tokenPath, "", { flag: "a" });
  fs.accessSync(configRoot, fs.constants.W_OK);
  fs.accessSync(tokenPath, fs.constants.W_OK);

  return {
    authConfigPath,
    authTag,
    runtimeHome,
    configRoot,
    tokenPath,
  };
}

function buildCommandArgs({ scriptPath, source, rawPath, date }) {
  const orderHistoryStart = resolveOrderHistoryStart(source, date);
  const args = [
    scriptPath,
    "--env",
    source.env ?? "real",
    "--start",
    compactDate(orderHistoryStart),
    "--end",
    compactDate(date),
    "--side",
    "buy",
    "--filled",
    "filled",
    "--json-out",
    rawPath,
    "--quiet",
  ];

  if (source.account) {
    args.push("--account", source.account);
  }
  if (source.skipRealized) {
    args.push("--skip-realized");
  }

  return args;
}

function buildHolding(row) {
  const quantity = toNumber(row.hldg_qty);
  const avgPrice = toNumber(row.pchs_avg_pric);
  const currentPrice = toNumber(row.prpr);
  const marketValue = toNumber(row.evlu_amt);
  const purchaseValue =
    toNumber(row.pchs_amt) ??
    (quantity != null && avgPrice != null ? Math.round(quantity * avgPrice) : null);
  const profitLoss =
    toNumber(row.evlu_pfls_amt) ??
    (marketValue != null && purchaseValue != null ? marketValue - purchaseValue : null);
  const profitRate =
    toNumber(row.evlu_pfls_rt) ??
    (purchaseValue && profitLoss != null ? round2((profitLoss / purchaseValue) * 100) : null);

  return {
    code: toText(row.pdno),
    name: toText(row.prdt_name) ?? toText(row.pdno) ?? "알 수 없음",
    quantity,
    avgPrice,
    currentPrice,
    marketValue,
    purchaseValue,
    profitLoss,
    profitRate,
    note: null,
  };
}

function buildPortfolioAccount(raw, source) {
  const summary = firstRecord(raw.balance?.summary);
  const realizedSummary = firstRecord(raw.realized?.summary);
  const holdings = (raw.balance?.rows ?? [])
    .map(buildHolding)
    .filter(
      (holding) =>
        (holding.quantity ?? 0) > 0 ||
        (holding.marketValue ?? 0) > 0 ||
        (holding.purchaseValue ?? 0) > 0,
    );

  const holdingsValue = holdings.reduce(
    (sum, holding) => sum + (holding.marketValue ?? 0),
    0,
  );
  const holdingsPurchaseValue = holdings.reduce(
    (sum, holding) => sum + (holding.purchaseValue ?? 0),
    0,
  );
  const holdingsProfitLoss = holdings.reduce(
    (sum, holding) => sum + (holding.profitLoss ?? 0),
    0,
  );

  const cashBreakdown = buildCashBreakdown(raw);
  const cashAvailable = cashBreakdown.depositCash ?? 0;
  const settlementCash =
    cashBreakdown.nextSettlementCash ??
    cashBreakdown.previousReceivableSettlementCash ??
    cashBreakdown.depositCash ??
    cashAvailable;
  const evaluationAmount =
    toNumber(summary.tot_evlu_amt) ??
    toNumber(summary.evlu_amt_smtl_amt) ??
    holdingsValue + cashAvailable;
  const principal =
    toNumber(summary.pchs_amt_smtl_amt) ??
    (holdingsPurchaseValue > 0 ? holdingsPurchaseValue : null);
  const profitLoss =
    toNumber(summary.evlu_pfls_smtl_amt) ??
    (holdings.length > 0 ? holdingsProfitLoss : null);
  const profitRate =
    principal && profitLoss != null
      ? round2((profitLoss / principal) * 100)
      : null;

  return {
    key: source.portfolioKey,
    label: source.label,
    accountNumber: raw.account?.formatted ?? null,
    evaluationAmount,
    cashAvailable,
    buyableCash: cashBreakdown.buyableCash,
    depositCash: cashBreakdown.depositCash,
    orderableCash: cashBreakdown.orderableCash,
    settlementCash,
    cashBreakdown,
    principal,
    profitLoss,
    profitRate,
    screenshots: [],
    incomplete: false,
    holdings,
    raw,
  };
}

function upsertAccount(accounts, nextAccount) {
  const existing = Array.isArray(accounts) ? accounts : [];
  const index = existing.findIndex((account) => account.key === nextAccount.key);
  if (index === -1) {
    return [...existing, nextAccount];
  }
  return existing.map((account, currentIndex) =>
    currentIndex === index ? nextAccount : account,
  );
}

function buildDefaultSnapshot(date) {
  return {
    date,
    updatedAt: new Date().toISOString(),
    source: {
      method: "broker_api_sync",
      reviewer: "seo",
      note: "",
    },
    accounts: [],
  };
}

async function runSourceSync(source, context) {
  const rawPath = path.join(
    ROOT_DIR,
    "data",
    "portfolio",
    "sources",
    "kis",
    `${source.portfolioKey}.json`,
  );
  const args = buildCommandArgs({
    scriptPath: context.openApi.script,
    source,
    rawPath,
    date: context.date,
  });
  const authRuntime = prepareSourceAuthRuntime(source, context);

  const result = spawnSync(context.openApi.python, args, {
    cwd: context.openApi.root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: authRuntime.runtimeHome,
    },
  });

  if (result.status !== 0) {
    const stderr = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `KIS 동기화 실패 (${source.portfolioKey}): ${stderr || `exit ${result.status}`}`,
    );
  }

  const orderableResult = spawnSync(
    context.openApi.python,
    [
      context.openApi.orderableScript,
      "--env",
      source.env ?? "real",
      "--json-path",
      rawPath,
    ],
    {
      cwd: context.openApi.root,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: authRuntime.runtimeHome,
      },
    },
  );

  if (orderableResult.status !== 0) {
    const stderr = [orderableResult.stdout, orderableResult.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `KIS 주문가능금액 조회 실패 (${source.portfolioKey}): ${stderr || `exit ${orderableResult.status}`}`,
    );
  }

  const raw = await readJson(rawPath, null);
  if (!raw) {
    throw new Error(`KIS raw snapshot 생성 실패: ${rawPath}`);
  }

  return {
    source,
    rawPath,
    raw,
    authRuntime,
    account: buildPortfolioAccount(raw, source),
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const configPath = path.join(ROOT_DIR, "config", "portfolio-sync.json");
  const syncConfig = (await readJson(configPath, DEFAULT_SYNC_CONFIG)) ?? DEFAULT_SYNC_CONFIG;
  const sources = (syncConfig.sources ?? []).filter(
    (source) => source?.enabled !== false && source?.type === "kis",
  );

  if (sources.length === 0) {
    console.log("No enabled KIS portfolio sources.");
    return;
  }

  const openApi = resolveOpenTradingApiPaths();
  const kisConfigRoot = resolveKisConfigRoot();
  const synced = [];

  for (const source of sources) {
    const portfolioKey = toText(source.portfolioKey);
    const label = toText(source.label);
    if (!portfolioKey || !label) {
      throw new Error("portfolio-sync.json의 각 source에는 portfolioKey와 label이 필요합니다.");
    }

    const normalizedSource = {
      ...source,
      portfolioKey,
      label,
      env: source.env ?? "real",
      account: normalizeAccountNumber(source.account),
      authProfile: toText(source.authProfile) ?? "",
      authConfigPath: toText(source.authConfigPath) ?? "",
      includeInLatest: source.includeInLatest !== false,
      skipRealized: source.skipRealized === true,
    };

    if (normalizedSource.account && !/^\d{10}$/.test(normalizedSource.account)) {
      throw new Error(
        `portfolio-sync.json의 ${portfolioKey} account는 10자리 숫자여야 합니다. 현재 값: ${source.account}`,
      );
    }

    const result = await runSourceSync(normalizedSource, {
      date: args.date,
      openApi,
      kisConfigRoot,
    });
    synced.push(result);
  }

  const latestPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const existing = (await readJson(latestPath, buildDefaultSnapshot(args.date))) ?? buildDefaultSnapshot(args.date);
  const activeLatestKeys = new Set(
    sources
      .filter((source) => source.includeInLatest !== false)
      .map((source) => toText(source.portfolioKey))
      .filter(Boolean),
  );
  let accounts = (Array.isArray(existing.accounts) ? [...existing.accounts] : []).filter(
    (account) => activeLatestKeys.has(toText(account?.key)),
  );

  for (const item of synced) {
    if (!item.source.includeInLatest) continue;
    accounts = upsertAccount(accounts, item.account);
  }

  const nextSnapshot = enrichPortfolioWithSecurityCodes({
    ...existing,
    date: args.date,
    updatedAt: new Date().toISOString(),
    source: {
      method: "broker_api_sync",
      reviewer: existing.source?.reviewer ?? "seo",
      note: `KIS sync: ${synced.map((item) => item.source.portfolioKey).join(", ")}`,
    },
    accounts,
  });

  await writeJson(latestPath, nextSnapshot);

  const manifestPath = path.join(
    ROOT_DIR,
    "data",
    "portfolio",
    "sources",
    "kis",
    "index.json",
  );
  await writeJson(manifestPath, {
    date: args.date,
    updatedAt: new Date().toISOString(),
    accounts: synced.map((item) => ({
      portfolioKey: item.source.portfolioKey,
      label: item.source.label,
      authProfile: item.source.authProfile || null,
      authConfigFile: item.authRuntime ? path.basename(item.authRuntime.authConfigPath) : null,
      rawPath: path.relative(ROOT_DIR, item.rawPath),
      accountNumber: item.account.accountNumber ?? null,
      holdings: item.account.holdings.length,
      evaluationAmount: item.account.evaluationAmount ?? null,
    })),
  });

  try {
    const tradingView = await buildTradingViewWatchlistArtifacts({
      date: args.date,
      portfolio: nextSnapshot,
    });
    console.log(
      `Updated TradingView watchlist (${tradingView.symbolCount} full, ${tradingView.basicSymbolCount} basic): ${path.relative(ROOT_DIR, tradingView.latestTxtPath)}`,
    );
    console.log(
      `Updated TradingView avg-price/buy-marker Pine script (${tradingView.averagePriceSymbolCount} holdings, ${tradingView.buyMarkerEventCount} buy markers): ${path.relative(ROOT_DIR, tradingView.latestAvgPricePinePath)}`,
    );
  } catch (error) {
    console.warn(`TradingView watchlist export skipped: ${error.message}`);
  }

  console.log(`Synced ${synced.length} KIS account(s) into data/portfolio/latest.json`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
