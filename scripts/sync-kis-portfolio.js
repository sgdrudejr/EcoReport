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

const DEFAULT_SYNC_CONFIG = {
  sources: [
    {
      type: "kis",
      enabled: true,
      portfolioKey: "KIS_MAIN",
      label: "한투 일반",
      env: "real",
      account: "",
      includeInLatest: true,
      skipRealized: false,
    },
  ],
};

function compactDate(date) {
  return String(date ?? "").replace(/-/g, "");
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

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function firstRecord(records) {
  return Array.isArray(records) && records.length > 0 ? records[0] : {};
}

function resolveOpenTradingApiPaths() {
  const root = path.join(ROOT_DIR, "open-trading-api");
  const python = path.join(root, ".venv", "bin", "python");
  const script = path.join(
    root,
    "examples_user",
    "domestic_stock",
    "readonly_account_snapshot.py",
  );

  if (!fs.existsSync(root)) {
    throw new Error(`open-trading-api 경로를 찾을 수 없습니다: ${root}`);
  }
  if (!fs.existsSync(script)) {
    throw new Error(`KIS 조회 스크립트를 찾을 수 없습니다: ${script}`);
  }
  if (!fs.existsSync(python)) {
    throw new Error(`open-trading-api Python 환경을 찾을 수 없습니다: ${python}`);
  }

  return { root, python, script };
}

function buildCommandArgs({ scriptPath, source, rawPath, date }) {
  const args = [
    scriptPath,
    "--env",
    source.env ?? "real",
    "--start",
    compactDate(date),
    "--end",
    compactDate(date),
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

  const cashAvailable =
    toNumber(summary.dnca_tot_amt) ??
    toNumber(realizedSummary.dnca_tot_amt) ??
    0;
  const settlementCash =
    toNumber(realizedSummary.nxdy_excc_amt) ??
    toNumber(summary.nass_amt) ??
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
    settlementCash,
    principal,
    profitLoss,
    profitRate,
    screenshots: [],
    incomplete: false,
    holdings,
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

function ensureKisAuthWritable(date) {
  const homeDir = process.env.HOME || os.homedir();
  const configRoot = path.join(homeDir, "KIS", "config");
  const tokenPath = path.join(configRoot, `KIS${compactDate(date)}`);
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(tokenPath, "", { flag: "a" });
  fs.accessSync(configRoot, fs.constants.W_OK);
  fs.accessSync(tokenPath, fs.constants.W_OK);
  return { configRoot, tokenPath };
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

  const result = spawnSync(context.openApi.python, args, {
    cwd: context.openApi.root,
    encoding: "utf8",
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

  const raw = await readJson(rawPath, null);
  if (!raw) {
    throw new Error(`KIS raw snapshot 생성 실패: ${rawPath}`);
  }

  return {
    source,
    rawPath,
    raw,
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
  ensureKisAuthWritable(args.date);
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
      account: toText(source.account) ?? "",
      includeInLatest: source.includeInLatest !== false,
      skipRealized: source.skipRealized === true,
    };

    const result = await runSourceSync(normalizedSource, {
      date: args.date,
      openApi,
    });
    synced.push(result);
  }

  const latestPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const existing = (await readJson(latestPath, buildDefaultSnapshot(args.date))) ?? buildDefaultSnapshot(args.date);
  let accounts = Array.isArray(existing.accounts) ? [...existing.accounts] : [];

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
      rawPath: path.relative(ROOT_DIR, item.rawPath),
      accountNumber: item.account.accountNumber ?? null,
      holdings: item.account.holdings.length,
      evaluationAmount: item.account.evaluationAmount ?? null,
    })),
  });

  console.log(`Synced ${synced.length} KIS account(s) into data/portfolio/latest.json`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
