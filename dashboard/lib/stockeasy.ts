import { listRepoDirectories, readRepoJsonFile } from "@/lib/repo-artifacts";

export type StockeasyMarketBlock = {
  market: string;
  statusLabel?: string | null;
  recommendedExposure?: string | null;
  distributionDays?: number | null;
  lastFollowThroughDay?: string | null;
};

export type StockeasySectorRs = {
  sector: string;
  score: number;
  rank: number;
};

export type StockeasyLeader = {
  sector?: string | null;
  rank?: number | null;
  name: string;
  code: string;
  price?: number | null;
  changePct?: number | null;
  rs?: number | null;
  rs1m?: number | null;
  rs3m?: number | null;
  rs6m?: number | null;
  mmt?: string | null;
  marketCapLabel?: string | null;
};

export type StockeasyStrategy = {
  key: string;
  name: string;
  style?: string | null;
  cumulativeReturnPct?: number | null;
  dayDeltaPct?: number | null;
  weekDeltaPct?: number | null;
  holdingCount?: number | null;
  todayBuyCount?: number | null;
  todayExitCount?: number | null;
  description?: string | null;
  bias?: "risk-on" | "selective" | "cooling" | null;
};

export type StockeasyThemeBoardLeader = {
  name: string;
  price?: number | null;
  changePct?: number | null;
  rs?: number | null;
  newHighGapPct?: number | null;
  vsPrevDayPct?: number | null;
};

export type StockeasyThemeBoardTheme = {
  rank?: number | null;
  name: string;
  leaders?: StockeasyThemeBoardLeader[];
};

export type StockeasyMarketSectorRow = {
  sector?: string | null;
  changePct?: number | null;
  position?: string | null;
  signal?: string | null;
  gapPct?: number | null;
  baseDateLabel?: string | null;
  leaderLabel?: string | null;
};

export type StockeasyLeadingSectorRow = {
  sector?: string | null;
  changePct?: number | null;
  holdDays?: number | null;
  signal?: string | null;
  gapPct?: number | null;
  returnPct?: number | null;
  leaderLabel?: string | null;
};

export type StockeasyCompanyReport = {
  date?: string | null;
  name?: string | null;
  broker?: string | null;
  opinion?: string | null;
  targetPrice?: number | null;
  currentPrice?: number | null;
  gapPct?: number | null;
  change?: string | null;
  title?: string | null;
  summary?: string | null;
  summaryBullets?: string[];
};

export type StockeasyIndustryReport = {
  date?: string | null;
  sector?: string | null;
  broker?: string | null;
  opinion?: string | null;
  change?: string | null;
  title?: string | null;
  summary?: string | null;
  summaryBullets?: string[];
};

export type StockeasySnapshot = {
  source: "stockeasy";
  capturedAt: string;
  captureDate: string;
  sourceTradingDate?: string | null;
  sourceTradingDateLabel?: string | null;
  collector?: {
    mode?: string | null;
    urls?: Record<string, string>;
  } | null;
  home?: {
    title?: string | null;
    topTimeline?: Array<{
      time?: string | null;
      headline?: string | null;
    }>;
    rawLines?: string[];
  } | null;
  marketAnalysis?: {
    marketSignal?: {
      title?: string | null;
      href?: string | null;
      shortSignal?: string | null;
      longSignal?: string | null;
      kospi?: StockeasyMarketBlock | null;
      kosdaq?: StockeasyMarketBlock | null;
      updatedAtLabel?: string | null;
      rawLines?: string[];
      rawTables?: Array<{ headers?: string[]; rows?: string[][] }>;
    } | null;
    sectors?: {
      title?: string | null;
      href?: string | null;
      actionResult?: { needle?: string | null; clicked?: boolean | null; matchedText?: string | null } | null;
      rows?: StockeasyMarketSectorRow[];
      rawLines?: string[];
      rawTables?: Array<{ headers?: string[]; rows?: string[][] }>;
    } | null;
    leadingSectors?: {
      title?: string | null;
      href?: string | null;
      actionResult?: { needle?: string | null; clicked?: boolean | null; matchedText?: string | null } | null;
      rows?: StockeasyLeadingSectorRow[];
      rawLines?: string[];
      rawTables?: Array<{ headers?: string[]; rows?: string[][] }>;
    } | null;
    themeBoard?: {
      title?: string | null;
      href?: string | null;
      actionResult?: { needle?: string | null; clicked?: boolean | null; matchedText?: string | null } | null;
      mode?: string | null;
      updatedAtLabel?: string | null;
      refreshLabel?: string | null;
      themes?: StockeasyThemeBoardTheme[];
      rawLines?: string[];
      rawTables?: Array<{ headers?: string[]; rows?: string[][] }>;
    } | null;
  } | null;
  marketSignal?: {
    title?: string | null;
    shortSignal?: string | null;
    longSignal?: string | null;
    kospi?: StockeasyMarketBlock | null;
    kosdaq?: StockeasyMarketBlock | null;
    updatedAtLabel?: string | null;
  } | null;
  marketThemes?: {
    title?: string | null;
    mode?: string | null;
    updatedAtLabel?: string | null;
    refreshLabel?: string | null;
    themes?: StockeasyThemeBoardTheme[];
  } | null;
  stockAnalysis?: {
    title?: string | null;
    sectorRs?: StockeasySectorRs[];
    stockLeaders?: StockeasyLeader[];
    promisingSectors?: {
      requested?: string[];
      matched?: string[];
      top100Count?: number | null;
      sectorMix?: Array<{ sector?: string | null; count?: number | null }>;
    } | null;
    promisingSectorTop100?: StockeasyLeader[];
    overallRsMeta?: {
      pageStats?: Array<{ pageLabel?: string | null; matchingCount?: number | null; accumulatedCount?: number | null }>;
      totalCollected?: number | null;
      targetCount?: number | null;
    } | null;
    reports?: {
      companyOverview?: {
        rows?: StockeasyCompanyReport[];
        rawLines?: string[];
        rawTables?: Array<{ headers?: string[]; rows?: string[][] }>;
      } | null;
      industry?: {
        targetDateLabel?: string | null;
        rows?: StockeasyIndustryReport[];
        pageStats?: Array<{ pageLabel?: string | null; matchingCount?: number | null; accumulatedCount?: number | null }>;
        detailMode?: string | null;
      } | null;
    } | null;
    rawLines?: string[];
    rawTables?: Array<{ headers?: string[]; rows?: string[][] }>;
  } | null;
  strategyRoom?: {
    title?: string | null;
    strategies?: StockeasyStrategy[];
    summary?: {
      overallBias?: "risk-on" | "selective" | "cooling" | null;
      strongestName?: string | null;
      strongestWeekDeltaPct?: number | null;
      riskOnCount?: number | null;
      selectiveCount?: number | null;
      coolingCount?: number | null;
    } | null;
  } | null;
};

function sortDatesDesc(values: string[]) {
  return [...values].sort((left, right) => right.localeCompare(left));
}

function buildSnapshotPath(date: string) {
  return `data/external/stockeasy/${date}/snapshot.json`;
}

function hasSnapshot(date: string) {
  const payload = readRepoJsonFile<StockeasySnapshot>(buildSnapshotPath(date));
  return payload?.source === "stockeasy";
}

export function listStockeasySnapshotDates() {
  const dates = listRepoDirectories("data/external/stockeasy").filter((entry) =>
    /^\d{4}-\d{2}-\d{2}$/.test(entry),
  );
  return sortDatesDesc(dates.filter((date) => hasSnapshot(date)));
}

export function loadLatestStockeasySnapshot(date?: string | null) {
  const availableDates = listStockeasySnapshotDates();
  const resolvedDate = date && availableDates.includes(date) ? date : availableDates[0];
  if (!resolvedDate) return null;

  const snapshot = readRepoJsonFile<StockeasySnapshot>(buildSnapshotPath(resolvedDate));
  if (!snapshot) return null;

  return {
    ...snapshot,
    availableDates,
    resolvedDate,
  };
}
