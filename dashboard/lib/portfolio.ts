import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(process.cwd(), "..");
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
