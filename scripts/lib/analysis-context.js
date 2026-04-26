import path from "node:path";

import {
  ROOT_DIR,
  enrichPortfolioWithSecurityCodes,
  readJson,
  readText,
} from "./pipeline-utils.js";

const DEFAULT_STAGE2_FALLBACK = {
  account_actions: [],
  candidate_scores: [],
  strategy_changes: [],
};

function withCache(cache, key, loader) {
  if (cache.has(key)) {
    return cache.get(key);
  }

  const pending = loader();
  cache.set(key, pending);
  return pending;
}

export function createAnalysisCache() {
  return new Map();
}

export function buildAnalysisPaths(date) {
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);
  const manualKitDir = path.join(ROOT_DIR, "knowledge", "daily", "manual-kit", date);

  return {
    rootDir: ROOT_DIR,
    analysisDir,
    manualKitDir,
    portfolio: path.join(ROOT_DIR, "data", "portfolio", "latest.json"),
    strategy: path.join(ROOT_DIR, "config", "strategy.json"),
    technical: path.join(ROOT_DIR, "data", "technical", `${date}.json`),
    watchlist: path.join(ROOT_DIR, "config", "watchlist.json"),
    fred: path.join(ROOT_DIR, "data", "macro", `fred-${date}.json`),
    stage1: path.join(analysisDir, "stage1-report-extracts-v2.json"),
    stage14FullDailyReport: path.join(analysisDir, "stage1-4-full-daily-report.json"),
    stage14InsightAtoms: path.join(analysisDir, "stage1-4-insight-atoms.json"),
    stage2: path.join(analysisDir, "stage2-strategy-options.json"),
    impactMap: path.join(analysisDir, "impact-map.json"),
    marketVoice: path.join(analysisDir, "marketvoice-linked.json"),
    stage3: path.join(analysisDir, "stage3-quant-scores.json"),
    richBriefing: path.join(ROOT_DIR, "knowledge", "daily", `${date}-gemini-briefing-rich.md`),
    operatingRules: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "operating-rules.md"),
    decisionJournal: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "decision-journal.md"),
  };
}

export async function cachedReadJson(cache, filePath, fallback = null) {
  return withCache(cache, `json:${filePath}`, async () => readJson(filePath, fallback));
}

export async function cachedReadText(cache, filePath, fallback = "") {
  return withCache(cache, `text:${filePath}`, async () => readText(filePath, fallback));
}

export function resolveStage2Selection(stage2Actual, _stage2Mock, fallback = DEFAULT_STAGE2_FALLBACK) {
  if (stage2Actual) {
    return { stage2Data: stage2Actual, stage2Mode: "actual" };
  }

  return { stage2Data: fallback, stage2Mode: "missing" };
}

export async function loadAnalysisContext(args, options = {}) {
  const cache = options.cache ?? createAnalysisCache();
  const paths = buildAnalysisPaths(args.date);
  const data = {};
  const loaders = [];

  if (options.portfolio) {
    loaders.push(
      cachedReadJson(cache, paths.portfolio, { accounts: [] }).then((value) => {
        data.portfolio = value;
      }),
    );
  }

  if (options.strategy) {
    loaders.push(
      cachedReadJson(cache, paths.strategy, { accounts: {} }).then((value) => {
        data.strategy = value;
      }),
    );
  }

  if (options.technical) {
    loaders.push(
      cachedReadJson(cache, paths.technical, { scores: {}, market_context: {} }).then((value) => {
        data.technical = value;
      }),
    );
  }

  if (options.watchlist) {
    loaders.push(
      cachedReadJson(cache, paths.watchlist, {}).then((value) => {
        data.watchlist = value;
      }),
    );
  }

  if (options.fred) {
    loaders.push(
      cachedReadJson(cache, paths.fred, null).then((value) => {
        data.fred = value;
      }),
    );
  }

  if (options.stage1) {
    loaders.push(
      cachedReadJson(cache, paths.stage1, { extracts: [] }).then((value) => {
        data.stage1 = value;
      }),
    );
  }

  if (options.stage14FullDailyReport) {
    loaders.push(
      cachedReadJson(cache, paths.stage14FullDailyReport, null).then((value) => {
        data.stage14FullDailyReport = value;
      }),
    );
  }

  if (options.stage14InsightAtoms) {
    loaders.push(
      cachedReadJson(cache, paths.stage14InsightAtoms, { atoms: [] }).then((value) => {
        data.stage14InsightAtoms = value;
      }),
    );
  }

  if (options.stage2) {
    loaders.push(
      cachedReadJson(cache, paths.stage2, null).then((value) => {
        data.stage2 = value;
      }),
    );
  }

  if (options.impactMap) {
    loaders.push(
      cachedReadJson(cache, paths.impactMap, { reports: [] }).then((value) => {
        data.impactMap = value;
      }),
    );
  }

  if (options.marketVoice) {
    loaders.push(
      cachedReadJson(cache, paths.marketVoice, {
        summary: null,
        topics: [],
        accountDigests: [],
        deepResearchCandidates: [],
        impactReports: [],
      }).then((value) => {
        data.marketVoice = value;
      }),
    );
  }

  if (options.stage3) {
    loaders.push(
      cachedReadJson(cache, paths.stage3, { holdings: {}, accounts: {}, portfolio: {} }).then((value) => {
        data.stage3 = value;
      }),
    );
  }

  if (options.richBriefing) {
    loaders.push(
      cachedReadText(cache, paths.richBriefing, "").then((value) => {
        data.richBriefing = value;
      }),
    );
  }

  if (options.operatingRules) {
    loaders.push(
      cachedReadText(cache, paths.operatingRules, "").then((value) => {
        data.operatingRules = value;
      }),
    );
  }

  if (options.decisionJournal) {
    loaders.push(
      cachedReadText(cache, paths.decisionJournal, "").then((value) => {
        data.decisionJournal = value;
      }),
    );
  }

  await Promise.all(loaders);

  if (options.normalizedPortfolio && data.portfolio) {
    data.normalizedPortfolio = enrichPortfolioWithSecurityCodes(data.portfolio);
  }

  if (options.stage2Resolved) {
    const resolved = resolveStage2Selection(
      data.stage2 ?? null,
      null,
      options.stage2Fallback ?? DEFAULT_STAGE2_FALLBACK,
    );
    data.stage2Data = resolved.stage2Data;
    data.stage2Mode = resolved.stage2Mode;
  }

  return { args, cache, paths, data };
}
