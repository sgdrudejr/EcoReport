import fs from "fs";
import path from "path";
import { resolveRepoRoot } from "@/lib/repo-root";

const REPO_ROOT = resolveRepoRoot();
const PORTFOLIO_FILE = path.join(REPO_ROOT, "data", "portfolio", "latest.json");

export interface PortfolioHolding {
  id?: string;
  code?: string;
  name: string;
  quantity?: number | null;
  avgPrice?: number | null;
  currentPrice?: number | null;
  marketValue?: number | null;
  purchaseValue?: number | null;
  profitLoss?: number | null;
  profitRate?: number | null;
  note?: string | null;
}

export interface PortfolioAccount {
  key: string;
  label: string;
  accountNumber?: string | null;
  evaluationAmount?: number | null;
  cashAvailable?: number | null;
  settlementCash?: number | null;
  principal?: number | null;
  profitLoss?: number | null;
  profitRate?: number | null;
  screenshots?: string[];
  incomplete?: boolean;
  holdings: PortfolioHolding[];
}

export interface PortfolioSnapshot {
  date: string;
  updatedAt: string;
  source: {
    method: string;
    reviewer?: string | null;
    note?: string | null;
  };
  accounts: PortfolioAccount[];
}

export function getDefaultPortfolioSnapshot(): PortfolioSnapshot {
  return {
    date: new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
    source: {
      method: "screenshot_review",
      reviewer: null,
      note: "캡처 업로드 후 검토 저장",
    },
    accounts: [
      {
        key: "ISA",
        label: "ISA",
        accountNumber: "",
        evaluationAmount: null,
        cashAvailable: null,
        settlementCash: null,
        principal: null,
        profitLoss: null,
        profitRate: null,
        screenshots: [],
        incomplete: true,
        holdings: [],
      },
      {
        key: "PENSION",
        label: "연금저축",
        accountNumber: "",
        evaluationAmount: null,
        cashAvailable: null,
        settlementCash: null,
        principal: null,
        profitLoss: null,
        profitRate: null,
        screenshots: [],
        incomplete: true,
        holdings: [],
      },
      {
        key: "TOSS",
        label: "토스증권",
        accountNumber: "",
        evaluationAmount: null,
        cashAvailable: null,
        settlementCash: null,
        principal: null,
        profitLoss: null,
        profitRate: null,
        screenshots: [],
        incomplete: true,
        holdings: [],
      },
    ],
  };
}

export function loadLatestPortfolio(): PortfolioSnapshot | null {
  if (!fs.existsSync(PORTFOLIO_FILE)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(PORTFOLIO_FILE, "utf-8");
    return JSON.parse(raw) as PortfolioSnapshot;
  } catch {
    return null;
  }
}

export function getPortfolioFilePath() {
  return PORTFOLIO_FILE;
}

export function getHoldingProfitLoss(holding: PortfolioHolding) {
  if (holding.profitLoss != null) {
    return holding.profitLoss;
  }

  if (holding.marketValue != null && holding.purchaseValue != null) {
    return holding.marketValue - holding.purchaseValue;
  }

  return 0;
}

export function getHoldingProfitRate(holding: PortfolioHolding) {
  if (holding.profitRate != null) {
    return holding.profitRate;
  }

  const purchaseValue = holding.purchaseValue ?? null;
  const profitLoss = getHoldingProfitLoss(holding);
  if (!purchaseValue) {
    return null;
  }

  return (profitLoss / purchaseValue) * 100;
}

export function getAccountHoldingsValue(account: PortfolioAccount) {
  return account.holdings.reduce(
    (sum, holding) => sum + (holding.marketValue ?? 0),
    0,
  );
}

export function getAccountHoldingsPurchaseValue(account: PortfolioAccount) {
  return account.holdings.reduce(
    (sum, holding) => sum + (holding.purchaseValue ?? 0),
    0,
  );
}

export function getAccountHoldingsProfitLoss(account: PortfolioAccount) {
  return account.holdings.reduce((sum, holding) => sum + getHoldingProfitLoss(holding), 0);
}

export function getAccountHoldingsProfitRate(account: PortfolioAccount) {
  const purchaseValue = getAccountHoldingsPurchaseValue(account);
  if (!purchaseValue) {
    return null;
  }

  return (getAccountHoldingsProfitLoss(account) / purchaseValue) * 100;
}

export function getAccountHoldingCount(account: PortfolioAccount) {
  return account.holdings.length;
}

export function getPortfolioTotals(snapshot: PortfolioSnapshot) {
  const totalEvaluationAmount = snapshot.accounts.reduce(
    (sum, account) => sum + (account.evaluationAmount ?? 0),
    0,
  );
  const totalCashAvailable = snapshot.accounts.reduce(
    (sum, account) => sum + (account.cashAvailable ?? 0),
    0,
  );
  const totalHoldingsValue = snapshot.accounts.reduce(
    (sum, account) => sum + getAccountHoldingsValue(account),
    0,
  );
  const totalHoldingsProfitLoss = snapshot.accounts.reduce(
    (sum, account) => sum + getAccountHoldingsProfitLoss(account),
    0,
  );
  const totalHoldingsPurchaseValue = snapshot.accounts.reduce(
    (sum, account) => sum + getAccountHoldingsPurchaseValue(account),
    0,
  );
  const totalHoldingCount = snapshot.accounts.reduce(
    (sum, account) => sum + getAccountHoldingCount(account),
    0,
  );
  const totalHoldingsProfitRate =
    totalHoldingsPurchaseValue > 0
      ? (totalHoldingsProfitLoss / totalHoldingsPurchaseValue) * 100
      : null;

  return {
    totalEvaluationAmount,
    totalCashAvailable,
    totalHoldingsValue,
    totalHoldingsProfitLoss,
    totalHoldingsPurchaseValue,
    totalHoldingsProfitRate,
    totalHoldingCount,
  };
}
