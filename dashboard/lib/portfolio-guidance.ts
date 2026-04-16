import fs from "fs";
import path from "path";
import {
  getAccountHoldingsProfitLoss,
  getAccountHoldingsProfitRate,
  getAccountHoldingsValue,
  type PortfolioAccount,
  type PortfolioSnapshot,
} from "@/lib/portfolio";
import {
  listRepoDirectories,
  listRepoFiles,
  readRepoJsonFile,
} from "@/lib/repo-artifacts";
import { resolveRepoRoot } from "@/lib/repo-root";
import {
  formatDateContextLine,
  normalizeArtifactDateContext,
  type ArtifactDateContext,
} from "@/lib/trading-calendar";

const REPO_ROOT = resolveRepoRoot();
const STRATEGY_FILE = path.join(REPO_ROOT, "config", "strategy.json");
const TECHNICAL_DIR = "data/technical";
const ANALYSIS_DIR = "data/analysis-state";

type StrategyAccountKey = string;

type StrategyAllocation = {
  name?: string;
  period?: { start: string; end: string };
  accounts?: Record<
    StrategyAccountKey,
    {
      cash?: number;
      target_allocation?: Record<string, number>;
    }
  >;
  dca_plan?: {
    total_tranches?: number;
    completed?: number;
    schedule?: Array<{
      tranche?: number;
      pct?: number;
      target_date?: string;
      status?: string;
    }>;
  };
};

type TechnicalScoreEntry = {
  score?: number;
  signal?: string | null;
  signal_reason?: string | null;
  rsi?: number | null;
  technical_analysis?: {
    execution_bias?: TechnicalBias | null;
    indicators?: {
      rsi?: TechnicalBias | null;
      macd?: TechnicalBias | null;
      bollinger?: TechnicalBias | null;
      movingAverage?: TechnicalBias | null;
    } | null;
    rsi_divergence?: {
      type?: "bullish" | "bearish" | "none";
      strength?: string | null;
      summary?: string | null;
    } | null;
  } | null;
};

type TechnicalSnapshot = {
  scores?: Record<string, TechnicalScoreEntry>;
};

type TechnicalBias = {
  side?: "buy_side" | "neutral" | "sell_side";
  label?: string | null;
  summary?: string | null;
  divergence?: "bullish" | "bearish" | "none";
  strength?: string | null;
};

type RiskPenaltyBreakdown = {
  dataQuality?: {
    total?: number;
    incompletePenalty?: number;
    unmappedExposurePct?: number;
  };
  concentration?: {
    total?: number;
  };
  covariance?: {
    total?: number;
    annualizedVolatility?: number | null;
  };
  tailRisk?: {
    total?: number;
  };
  regimeStress?: {
    total?: number;
  };
};

type Stage3Account = {
  baseScores?: {
    allocationScore?: number;
    factorScore?: number | null;
    techScore?: number;
    reportScore?: number | null;
    regimeFit?: number;
    stage2Score?: number;
  };
  allocationScore?: number;
  factorScore?: number | null;
  preTaxScore?: number | null;
  holdingsScore?: number;
  reportCoverageScore?: number | null;
  reportStatus?: "available" | "unavailable";
  reportUnavailableReason?: string | null;
  coverage?: {
    factorCoverage?: number;
    impactCoverage?: number;
    techCoverage?: number;
  };
  riskPenalty?: {
    total?: number;
    notes?: string[];
    breakdown?: RiskPenaltyBreakdown | null;
  };
  taxAdjustment?: {
    multiplier?: number | null;
    addedScore?: number | null;
  } | null;
  effectiveWeights?: Record<string, number> | null;
  totalScore?: number;
  note?: string | null;
  stage2Bias?: string | null;
};

type Stage3Holding = {
  positionKey?: string;
  code?: string;
  name?: string;
  accountKey?: string;
  accountLabel?: string;
  category?: string;
  marketValue?: number;
  incomeYield?: number | null;
  technicalSignal?: string | null;
  technicalBaseScore?: number | null;
  signal?: string | null;
  factor?: {
    score?: number | null;
    factorCoverage?: number | null;
  };
  scores?: {
    factorScore?: number | null;
    techScore?: number | null;
    reportScore?: number | null;
    actionScore?: number | null;
  };
  report?: {
    available?: boolean;
    unavailableReason?: string | null;
  };
  explain?: {
    topDrivers?: string[];
    warnings?: string[];
  };
};

type Stage3Analysis = {
  date?: string;
  runDate?: string | null;
  effectiveMarketDate?: string | null;
  generatedAt?: string | null;
  accounts?: Record<string, Stage3Account>;
  holdings?: Record<string, Stage3Holding>;
  positions?: Record<string, Stage3Holding>;
  reportInputs?: {
    reportCount?: number;
    available?: boolean;
  };
  portfolio?: {
    totalScore?: number;
    preTaxScore?: number | null;
  };
};

type Stage4AccountPlan = {
  key?: string;
  label?: string;
  deployBudget?: number;
  reserveCash?: number;
  candidateFromGap?: string | null;
  macroCommentary?: {
    summary?: string;
    drivers?: string[];
    assetFocus?: string[];
    actionLine?: string;
    reserveNote?: string;
  };
  stagedBuys?: Array<{
    code?: string;
    name?: string;
    score?: number | null;
    suggestedAmount?: number;
    reason?: string;
    source?: string;
    volatilityBucket?: string | null;
    entryCondition?: string | null;
    stopLossPct?: number | null;
    stopLossNote?: string | null;
    positionSizePctOfDeployBudget?: number | null;
    positionSizePctOfAccount?: number | null;
    positionSizeLabel?: string | null;
  }>;
  trims?: Array<{
    code?: string;
    name?: string;
    reason?: string;
    suggestedAmount?: number;
    source?: string;
  }>;
  holds?: Array<{
    code?: string;
    name?: string;
    reason?: string;
    suggestedAmount?: number;
    source?: string;
  }>;
  stage2Candidates?: Array<{
    name?: string;
    reason?: string;
  }>;
  stage1Drivers?: Array<{
    title?: string;
    thesis?: string;
  }>;
  validatorFlags?: string[];
  rejectedAlternatives?: Array<{
    code?: string;
    name?: string;
    rejectionReason?: string;
    confidence?: number | null;
  }>;
  noAction?: boolean;
  noActionReason?: string | null;
  confidence?: number | null;
  topEvidence?: Array<{
    code?: string | null;
    name?: string;
    source?: string | null;
    reason?: string | null;
  }>;
};

type Stage4Analysis = {
  date?: string;
  runDate?: string | null;
  effectiveMarketDate?: string | null;
  generatedAt?: string | null;
  accountPlans?: Stage4AccountPlan[];
};

export type CategoryGuide = {
  category: string;
  currentAmount: number;
  currentPct: number;
  targetPct: number;
  gapPct: number;
  gapAmount: number;
  action: "보강 필요" | "비중 축소" | "유지";
  preferredLabel?: string;
};

export type AccountGuide = {
  key: string;
  label: string;
  score: number;
  allocationScore: number;
  technicalScore: number | null;
  reportScore: number | null;
  reportCoverageScore: number | null;
  reportStatus: "available" | "unavailable";
  reportUnavailableReason: string | null;
  regimeFitScore: number | null;
  stage2Score: number | null;
  stage2Bias: string | null;
  riskPenaltyTotal: number | null;
  riskPenaltyBreakdown: RiskPenaltyBreakdown | null;
  effectiveWeights: Record<string, number> | null;
  techCoverage: number | null;
  impactCoverage: number | null;
  status: "양호" | "보강 필요" | "조정 필요";
  totalAssets: number;
  holdingsValue: number;
  holdingsProfitLoss: number;
  holdingsProfitRate: number | null;
  cashValue: number;
  cashPct: number;
  targetCashPct: number;
  recommendedDeploy: number;
  reserveCash: number;
  note: string;
  macroSummary: string | null;
  macroDrivers: string[];
  assetFocus: string[];
  actionLine: string | null;
  executionReserveNote: string | null;
  candidates: string[];
  executionBuys: ExecutionGuideItem[];
  executionTrims: ExecutionGuideItem[];
  executionHolds: ExecutionGuideItem[];
  categories: CategoryGuide[];
  topSignals: string[];
  scoreDrivers: string[];
  improvementActions: string[];
  evidenceNotes: string[];
  actionPoints: string[];
  riskNotes: string[];
  holdingGuides: HoldingGuide[];
};

export type ExecutionGuideItem = {
  code: string | null;
  name: string;
  suggestedAmount: number | null;
  reason: string | null;
  source: string | null;
  score: number | null;
  volatilityBucket?: string | null;
  entryCondition?: string | null;
  stopLossPct?: number | null;
  stopLossNote?: string | null;
  positionSizePctOfDeployBudget?: number | null;
  positionSizePctOfAccount?: number | null;
  positionSizeLabel?: string | null;
  kind: "buy" | "trim" | "hold";
};

export type HoldingGuide = {
  code: string | null;
  name: string;
  category: string;
  marketValue: number;
  weightPct: number;
  score: number | null;
  accountFitScore: number | null;
  technicalScore: number | null;
  reportScore: number | null;
  reportStatus: "available" | "unavailable";
  reportUnavailableReason: string | null;
  actionScore: number | null;
  signal: string | null;
  technicalSignal: string | null;
  technicalReason: string | null;
  technicalExecutionBias: TechnicalBias | null;
  technicalIndicatorBiases: {
    rsi: TechnicalBias | null;
    macd: TechnicalBias | null;
    bollinger: TechnicalBias | null;
    movingAverage: TechnicalBias | null;
  };
  rsiValue: number | null;
  rsiDivergence: {
    type: "bullish" | "bearish" | "none";
    strength: string | null;
    summary: string | null;
  } | null;
  topDrivers: string[];
  warnings: string[];
};

export type PortfolioGuide = {
  score: number;
  analysisDateContext: ArtifactDateContext;
  analysisDateLabel: string | null;
  totalAssets: number;
  totalCash: number;
  totalCashPct: number;
  nextTranchePct: number;
  globalStatus: "양호" | "보강 필요" | "조정 필요";
  globalActions: string[];
  incompleteCount: number;
  accounts: AccountGuide[];
};

const TARGET_LABEL_BY_CODE: Record<
  string,
  { default: string; ISA?: string; PENSION?: string; TOSS?: string; KIS_MAIN?: string }
> = {
  "458760": { default: "배당/커버드콜", ISA: "배당/커버드콜" },
  "132030": { default: "금", ISA: "금", PENSION: "금" },
  "360750": { default: "미국인덱스", ISA: "미국인덱스", PENSION: "S&P500" },
  "133690": { default: "나스닥100", PENSION: "나스닥100" },
  "423160": { default: "현금파킹", ISA: "현금파킹", PENSION: "현금파킹", TOSS: "현금파킹", KIS_MAIN: "현금파킹" },
  "487240": { default: "전력기기", TOSS: "전력기기" },
  "449450": { default: "방산", TOSS: "방산", KIS_MAIN: "방산" },
  "434730": { default: "원자력", TOSS: "원자력", KIS_MAIN: "원자력" },
};

const PREFERRED_LABEL_BY_CATEGORY: Record<string, string> = {
  "배당/커버드콜": "TIGER 미국배당+7%프리미엄다우존스",
  금: "KODEX 골드선물(H)",
  미국인덱스: "TIGER 미국S&P500",
  "S&P500": "TIGER 미국S&P500",
  나스닥100: "TIGER 미국나스닥100",
  현금파킹: "KODEX KOFR금리액티브",
  전력기기: "KODEX AI전력핵심설비",
  방산: "PLUS K방산",
  원자력: "HANARO 원자력iSelect",
};

const HOLDING_CODE_HINTS: Array<{ code: string; patterns: string[] }> = [
  { code: "360750", patterns: ["미국s&p500", "미국sp500"] },
  { code: "133690", patterns: ["미국나스닥100"] },
  { code: "423160", patterns: ["kofr", "금리액티브"] },
  { code: "434730", patterns: ["원자력"] },
  { code: "449450", patterns: ["방산"] },
  { code: "487240", patterns: ["ai전력", "전력핵심", "전력기기"] },
  { code: "132030", patterns: ["골드", "금선물"] },
  { code: "458760", patterns: ["미국배당", "다우존스"] },
  { code: "2921050", patterns: ["코리아top10", "top10"] },
];

function clampScore(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHoldingName(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣&+]/gi, "");
}

function inferHoldingCode(name: string, explicitCode?: string | null) {
  if (explicitCode) {
    return explicitCode;
  }

  const normalized = normalizeHoldingName(name);
  if (!normalized) {
    return null;
  }

  for (const hint of HOLDING_CODE_HINTS) {
    if (hint.patterns.some((pattern) => normalized.includes(normalizeHoldingName(pattern)))) {
      return hint.code;
    }
  }

  return null;
}

function readStrategy(): StrategyAllocation | null {
  if (!fs.existsSync(STRATEGY_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8")) as StrategyAllocation;
  } catch {
    return null;
  }
}

function readLatestTechnical(dateHint?: string) {
  const preferredPath = dateHint ? path.posix.join(TECHNICAL_DIR, `${dateHint}.json`) : null;
  if (preferredPath) {
    const preferred = readRepoJsonFile<TechnicalSnapshot>(preferredPath);
    if (preferred) return preferred;
  }

  const files = listRepoFiles(TECHNICAL_DIR)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  return readRepoJsonFile<TechnicalSnapshot>(path.posix.join(TECHNICAL_DIR, files[0]));
}

function readStage3Analysis(dateHint?: string) {
  const preferredPath = dateHint
    ? path.posix.join(ANALYSIS_DIR, dateHint, "stage3-quant-scores.json")
    : null;
  if (preferredPath) {
    const preferred = readRepoJsonFile<Stage3Analysis>(preferredPath);
    if (preferred) return preferred;
  }

  const datedDirs = listRepoDirectories(ANALYSIS_DIR).sort().reverse();

  for (const datedDir of datedDirs) {
    const candidate = path.posix.join(ANALYSIS_DIR, datedDir, "stage3-quant-scores.json");
    const result = readRepoJsonFile<Stage3Analysis>(candidate);
    if (result) {
      return result;
    }
  }

  return null;
}

function readStage4Analysis(dateHint?: string) {
  const preferredPath = dateHint
    ? path.posix.join(ANALYSIS_DIR, dateHint, "stage4-execution-plan.json")
    : null;
  if (preferredPath) {
    const preferred = readRepoJsonFile<Stage4Analysis>(preferredPath);
    if (preferred) return preferred;
  }

  const datedDirs = listRepoDirectories(ANALYSIS_DIR).sort().reverse();

  for (const datedDir of datedDirs) {
    const candidate = path.posix.join(ANALYSIS_DIR, datedDir, "stage4-execution-plan.json");
    const result = readRepoJsonFile<Stage4Analysis>(candidate);
    if (result) {
      return result;
    }
  }

  return null;
}

function normalizeStrategyAccountKey(
  account: PortfolioAccount,
  strategy: StrategyAllocation | null,
): StrategyAccountKey | null {
  const candidates = [
    account.key,
    account.label,
    account.key === "PENSION" ? "연금저축" : null,
    account.key === "TOSS" ? "토스증권" : null,
    account.key === "KIS_MAIN" ? "한투 일반" : null,
    account.key === "ISA" ? "ISA" : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (strategy?.accounts?.[candidate]) {
      return candidate;
    }
  }

  return null;
}

function getCategoryForHolding(account: PortfolioAccount, code?: string | null) {
  if (!code) return "기타";
  const mapping = TARGET_LABEL_BY_CODE[code];
  if (!mapping) return "기타";
  if (account.key === "ISA" && mapping.ISA) return mapping.ISA;
  if (account.key === "PENSION" && mapping.PENSION) return mapping.PENSION;
  if (account.key === "TOSS" && mapping.TOSS) return mapping.TOSS;
  if (account.key === "KIS_MAIN" && mapping.KIS_MAIN) return mapping.KIS_MAIN;
  return mapping.default;
}

function getNextTranchePct(strategy: StrategyAllocation | null) {
  const pending =
    strategy?.dca_plan?.schedule?.find((item) => item.status !== "done" && item.status !== "completed") ??
    null;
  return pending?.pct ?? 0.25;
}

function getAccountTotalAssets(account: PortfolioAccount) {
  const holdingsValue = getAccountHoldingsValue(account);
  const cashValue = account.cashAvailable ?? 0;
  return Math.max(account.evaluationAmount ?? 0, holdingsValue + cashValue);
}

function categorizeAccount(
  account: PortfolioAccount,
  targetAllocation: Record<string, number>,
) {
  const holdingsByCategory = new Map<string, number>();

  for (const holding of account.holdings) {
    const category = getCategoryForHolding(account, holding.code);
    const current = holdingsByCategory.get(category) ?? 0;
    holdingsByCategory.set(category, current + (holding.marketValue ?? 0));
  }

  const totalAssets = getAccountTotalAssets(account);
  const holdingsValue = getAccountHoldingsValue(account);
  const inferredCash = Math.max(totalAssets - holdingsValue, 0);
  const cashValue = Math.max(account.cashAvailable ?? inferredCash, inferredCash);

  if (targetAllocation["현금파킹"] != null) {
    holdingsByCategory.set("현금파킹", cashValue);
  }

  const categories = new Set([
    ...Object.keys(targetAllocation),
    ...holdingsByCategory.keys(),
  ]);

  return {
    totalAssets,
    holdingsValue,
    cashValue,
    categories: [...categories].map((category) => {
      const currentAmount = holdingsByCategory.get(category) ?? 0;
      const currentPct = totalAssets > 0 ? currentAmount / totalAssets : 0;
      const targetPct = targetAllocation[category] ?? 0;
      const gapPct = targetPct - currentPct;
      const gapAmount = gapPct * totalAssets;

      return {
        category,
        currentAmount,
        currentPct,
        targetPct,
        gapPct,
        gapAmount,
        action:
          gapPct > 0.03 ? "보강 필요" : gapPct < -0.03 ? "비중 축소" : "유지",
        preferredLabel: PREFERRED_LABEL_BY_CATEGORY[category],
      } satisfies CategoryGuide;
    }),
  };
}

function getAccountScore(categoryGuides: CategoryGuide[], incomplete?: boolean) {
  const diff = categoryGuides.reduce(
    (sum, category) => sum + Math.abs(category.currentPct - category.targetPct),
    0,
  );
  let score = Math.round((1 - diff / 2) * 100);
  score = Math.max(0, Math.min(100, score));

  if (incomplete) {
    score = Math.max(0, score - 8);
  }

  return score;
}

function getTechnicalScoreForAccount(
  account: PortfolioAccount,
  technicalMap: Record<string, TechnicalScoreEntry> | null,
) {
  if (!technicalMap) {
    return {
      technicalScore: null,
      topSignals: [],
    };
  }

  const scoredHoldings = account.holdings
    .map((holding) => {
      const technical = holding.code ? technicalMap[holding.code] : null;
      if (!technical || typeof technical.score !== "number") {
        return null;
      }

      return {
        name: holding.name,
        weight: holding.marketValue ?? 0,
        score: technical.score,
        signal: technical.signal,
        signalReason: technical.signal_reason,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (scoredHoldings.length === 0) {
    return {
      technicalScore: null,
      topSignals: [],
    };
  }

  const totalWeight = scoredHoldings.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
  const weightedScore =
    totalWeight > 0
      ? scoredHoldings.reduce((sum, item) => sum + item.score * Math.max(item.weight, 0), 0) / totalWeight
      : scoredHoldings.reduce((sum, item) => sum + item.score, 0) / scoredHoldings.length;

  const topSignals = scoredHoldings
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => `${item.name} ${item.score}점 (${item.signal})`);

  return {
    technicalScore: Math.round(weightedScore),
    topSignals,
  };
}

function mergeScores(allocationScore: number, technicalScore: number | null, incomplete?: boolean) {
  let score =
    technicalScore == null
      ? allocationScore
      : Math.round(allocationScore * 0.6 + technicalScore * 0.4);

  if (incomplete) {
    score = Math.max(0, score - 5);
  }

  return Math.max(0, Math.min(100, score));
}

function blendHoldingScore(parts: Array<{ value: number | null; weight: number }>) {
  const valid = parts.filter(
    (part): part is { value: number; weight: number } =>
      typeof part.value === "number" && Number.isFinite(part.value) && part.weight > 0,
  );

  if (valid.length === 0) {
    return null;
  }

  const totalWeight = valid.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  return Math.round(
    valid.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight,
  );
}

function getHoldingAccountFitScore(
  categoryGuide: CategoryGuide | undefined,
  incomplete?: boolean,
) {
  if (!categoryGuide) {
    return incomplete ? 42 : 50;
  }

  let score = 55 + categoryGuide.gapPct * 120;

  if (categoryGuide.category === "기타") {
    score -= 8;
  }

  if (incomplete) {
    score -= 4;
  }

  return Math.round(clampScore(score, 20, 90));
}

function buildHoldingGuides(
  account: PortfolioAccount,
  categories: CategoryGuide[],
  stage3: Stage3Analysis | null,
  technicalMap: Record<string, TechnicalScoreEntry> | null,
) {
  const totalHoldingsValue = Math.max(getAccountHoldingsValue(account), 0);
  const accountStage3Holdings = Object.values(stage3?.holdings ?? {}).filter(
    (item): item is Stage3Holding & { accountKey: string } =>
      Boolean(item) && typeof item.accountKey === "string" && item.accountKey === account.key,
  );
  const usedAccountStage3Codes = new Set<string>();

  const holdingGuides = account.holdings.map((holding) => {
    const inferredCode = inferHoldingCode(holding.name, holding.code);
    const technicalEntry =
      (inferredCode ? technicalMap?.[inferredCode] : null) ??
      (holding.code ? technicalMap?.[holding.code] : null) ??
      null;
    let stage3Holding = inferredCode
      ? stage3?.positions?.[`${account.key}:${inferredCode}`] ??
        stage3?.holdings?.[inferredCode] ??
        null
      : null;

    if (!stage3Holding) {
      const normalizedName = normalizeHoldingName(holding.name);
      const exactMatch = accountStage3Holdings.find((item) => {
        const candidateCode = item.code ?? "";
        if (usedAccountStage3Codes.has(candidateCode)) {
          return false;
        }

        const candidateName = normalizeHoldingName(item.name);
        return Boolean(candidateName) && (
          candidateName === normalizedName ||
          candidateName.includes(normalizedName) ||
          normalizedName.includes(candidateName)
        );
      });

      if (exactMatch?.code) {
        stage3Holding = exactMatch;
      }
    }

    if (!stage3Holding) {
      const targetValue = holding.marketValue ?? 0;
      const closestByValue = accountStage3Holdings
        .filter((item) => !usedAccountStage3Codes.has(item.code ?? ""))
        .map((item) => ({
          item,
          diff: Math.abs((item.marketValue ?? 0) - targetValue),
        }))
        .sort((left, right) => left.diff - right.diff)[0];

      const tolerance = Math.max(targetValue * 0.15, 25000);
      if (closestByValue && closestByValue.diff <= tolerance) {
        stage3Holding = closestByValue.item;
      }
    }

    if (stage3Holding?.accountKey === account.key && stage3Holding.code) {
      usedAccountStage3Codes.add(stage3Holding.code);
    }

    const category =
      stage3Holding?.category ??
      getCategoryForHolding(account, inferredCode ?? holding.code);
    const categoryGuide = categories.find((item) => item.category === category);

    const technicalScore =
      stage3Holding?.scores?.techScore ??
      stage3Holding?.technicalBaseScore ??
      null;
    const reportScore = stage3Holding?.scores?.reportScore ?? null;
    const reportStatus =
      stage3Holding?.report?.available === false || reportScore == null
        ? "unavailable"
        : "available";
    const reportUnavailableReason =
      reportStatus === "unavailable"
        ? stage3Holding?.report?.unavailableReason ?? "no_report_signal"
        : null;
    const actionScore = stage3Holding?.scores?.actionScore ?? null;
    const accountFitScore = getHoldingAccountFitScore(categoryGuide, account.incomplete);
    const score = blendHoldingScore([
      { value: accountFitScore, weight: 0.35 },
      { value: technicalScore, weight: 0.4 },
      { value: reportScore, weight: 0.25 },
    ]);

    return {
      code: inferredCode ?? stage3Holding?.code ?? holding.code ?? null,
      name: holding.name,
      category,
      marketValue: holding.marketValue ?? 0,
      weightPct:
        totalHoldingsValue > 0 ? ((holding.marketValue ?? 0) / totalHoldingsValue) * 100 : 0,
      score,
      accountFitScore,
      technicalScore,
      reportScore,
      reportStatus,
      reportUnavailableReason,
      actionScore,
      signal: stage3Holding?.signal ?? null,
      technicalSignal: stage3Holding?.technicalSignal ?? null,
      technicalReason: technicalEntry?.signal_reason ?? null,
      technicalExecutionBias: technicalEntry?.technical_analysis?.execution_bias ?? null,
      technicalIndicatorBiases: {
        rsi: technicalEntry?.technical_analysis?.indicators?.rsi ?? null,
        macd: technicalEntry?.technical_analysis?.indicators?.macd ?? null,
        bollinger: technicalEntry?.technical_analysis?.indicators?.bollinger ?? null,
        movingAverage: technicalEntry?.technical_analysis?.indicators?.movingAverage ?? null,
      },
      rsiValue: technicalEntry?.rsi ?? null,
      rsiDivergence: technicalEntry?.technical_analysis?.rsi_divergence
        ? {
            type: technicalEntry.technical_analysis.rsi_divergence.type ?? "none",
            strength: technicalEntry.technical_analysis.rsi_divergence.strength ?? null,
            summary: technicalEntry.technical_analysis.rsi_divergence.summary ?? null,
          }
        : null,
      topDrivers: stage3Holding?.explain?.topDrivers ?? [],
      warnings:
        (stage3Holding?.explain?.warnings ?? []).filter(
          (warning) => warning !== "직접 연결된 리포트 영향이 아직 없습니다.",
        ),
    } satisfies HoldingGuide;
  });

  return holdingGuides.sort((left, right) => {
    if ((left.score ?? 999) !== (right.score ?? 999)) {
      return (left.score ?? 999) - (right.score ?? 999);
    }
    return right.marketValue - left.marketValue;
  });
}

function getStatusFromScore(score: number): AccountGuide["status"] {
  if (score >= 75) return "양호";
  if (score >= 55) return "보강 필요";
  return "조정 필요";
}

function buildAccountNote(
  account: PortfolioAccount,
  score: number,
  technicalScore: number | null,
  recommendedDeploy: number,
  topShortfalls: CategoryGuide[],
  cashPct: number,
  targetCashPct: number,
) {
  if (account.incomplete) {
    return "부분 캡처 기준이라 가이드는 참고용입니다. 보유 누락분 확인 후 저장하면 정밀도가 올라갑니다.";
  }

  if (recommendedDeploy > 0 && topShortfalls.length > 0) {
    const top = topShortfalls[0];
    if (technicalScore != null && technicalScore < 45) {
      return `현금 여유는 충분하지만 기술 점수(${technicalScore}점)가 낮습니다. ${top.category} 보강은 가능하되, 추격보다는 분할 접근이 적절합니다.`;
    }

    return `현금 여유가 있는 상태입니다. 이번 단계에서는 ${top.category} 중심으로 ${recommendedDeploy.toLocaleString()}원까지 나눠서 배치하는 편이 적절합니다.`;
  }

  if (cashPct < targetCashPct - 0.05) {
    return "현금 여유가 목표보다 낮습니다. 추가 진입보다 현재 보유분 유지와 대기 자금 복원이 우선입니다.";
  }

  if (technicalScore != null && technicalScore < 40) {
    return `배분은 크게 나쁘지 않지만 보유 기술 점수(${technicalScore}점)가 약합니다. 신규 확대보다 현재 보유분 점검이 우선입니다.`;
  }

  if (score >= 75) {
    return "현재 배분이 목표 범위에 비교적 근접합니다. 급하게 늘리기보다 기존 포지션 관리가 우선입니다.";
  }

  return "목표 배분과의 괴리가 남아 있습니다. 가장 부족한 자산부터 순서대로 보강하는 방식이 안정적입니다.";
}

function buildScoreDrivers(
  account: PortfolioAccount,
  factorScore: number | null,
  technicalScore: number | null,
  reportScore: number | null,
  reportCoverageScore: number | null,
  reportStatus: "available" | "unavailable",
  reportUnavailableReason: string | null,
  regimeFitScore: number | null,
  preTaxScore: number | null,
  taxMultiplier: number | null,
  riskPenaltyBreakdown: RiskPenaltyBreakdown | null,
  factorCoverage: number | null,
  techCoverage: number | null,
  cashPct: number,
  targetCashPct: number,
  categories: CategoryGuide[],
) {
  const drivers: string[] = [];
  const cashCategory = categories.find((category) => category.category === "현금파킹");

  if (account.incomplete) {
    drivers.push("부분 캡처 계좌라 보유 누락 가능성이 있어 데이터 품질 패널티가 적용됐습니다.");
  }

  if (factorScore != null) {
    const coverageText =
      factorCoverage != null ? ` (커버리지 ${formatPercent(factorCoverage * 100)})` : "";
    drivers.push(`팩터 점수 ${factorScore}점: 모멘텀, 리서치 강도, 인컴 수익률, 레짐 적합도를 교차단면 정규화해 합성합니다${coverageText}.`);
  }

  if (technicalScore != null) {
    const coverageText =
      techCoverage != null ? ` (커버리지 ${formatPercent(techCoverage * 100)})` : "";
    drivers.push(`기술 점수 ${technicalScore}점: RSI, MACD, 이평선, 변동성 신호를 합산한 보유 종목 가중 평균입니다${coverageText}.`);
  } else {
    drivers.push("기술 점수 데이터가 아직 부족해 배분 점수 비중이 더 크게 반영됐습니다.");
  }

  if (reportStatus === "unavailable") {
    if (reportUnavailableReason === "no_report_input") {
      drivers.push("이번 실행은 기준 거래일 리포트 입력이 0건이라 리포트 점수가 총점에 반영되지 않았습니다.");
    } else {
      drivers.push("직접 연결된 리포트 영향이 부족해 리포트 점수는 이번 계좌 총점에서 사실상 미반영 상태입니다.");
    }
  } else if (reportScore != null || reportCoverageScore != null) {
    const reportText = reportScore != null ? `${reportScore}점` : "미산출";
    const coverageText = reportCoverageScore != null ? ` / 커버리지 ${reportCoverageScore}%` : "";
    drivers.push(`리포트 점수 ${reportText}${coverageText}: 보유 종목과 직접 연결된 리포트의 방향과 강도를 반영합니다.`);
  }

  if (regimeFitScore != null) {
    drivers.push(`레짐 적합도 ${regimeFitScore}점: 현재 시장 레짐에 맞는 배분인지 평가합니다.`);
  }

  const dataQualityPenalty = riskPenaltyBreakdown?.dataQuality?.total ?? 0;
  if (dataQualityPenalty > 0) {
    drivers.push(`데이터 품질 패널티 ${dataQualityPenalty}점: 부분 캡처 또는 미분류 노출 때문에 감점됐습니다.`);
  }

  const concentrationPenalty = riskPenaltyBreakdown?.concentration?.total ?? 0;
  if (concentrationPenalty > 0) {
    drivers.push(`집중도 패널티 ${concentrationPenalty}점: 특정 종목/테마 쏠림이 점수를 눌렀습니다.`);
  }

  const covariancePenalty = riskPenaltyBreakdown?.covariance?.total ?? 0;
  if (covariancePenalty > 0) {
    const volText = riskPenaltyBreakdown?.covariance?.annualizedVolatility;
    drivers.push(
      `공분산 패널티 ${covariancePenalty}점: 자산 간 상관구조를 반영한 연율 변동성${volText != null ? ` ${volText.toFixed(1)}%` : ""} 기준 감점입니다.`,
    );
  }

  const regimeStressPenalty = riskPenaltyBreakdown?.regimeStress?.total ?? 0;
  if (regimeStressPenalty > 0) {
    drivers.push(`레짐 스트레스 패널티 ${regimeStressPenalty}점: 현재 레짐 대비 위험자산 비중이 높습니다.`);
  }

  if (preTaxScore != null && taxMultiplier != null && taxMultiplier > 1) {
    drivers.push(
      `세후 승수 ${taxMultiplier.toFixed(3)}x가 적용돼 세전 ${preTaxScore.toFixed(1)}점이 세후 기준으로 보정됐습니다.`,
    );
  }

  if (cashPct > targetCashPct + 0.05) {
    drivers.push(
      `현금 비중이 목표보다 ${formatPctPoint((cashPct - targetCashPct) * 100)}p 높지만, 방어 포지션 자체를 과도하게 불리하게 보지 않도록 점수에는 완만한 기회비용만 반영합니다.`,
    );
  }

  if (cashCategory) {
    const gapPct = (cashCategory.currentPct - cashCategory.targetPct) * 100;
    if (cashCategory.currentPct > cashCategory.targetPct + 0.05) {
      drivers.push(
        `현금파킹 자산은 일반 위험자산처럼 단순 기술점수로 처리하지 않고, 현재 레짐과 목표 현금 비중을 반영한 정책 보정 점수를 사용합니다. 현재는 목표보다 ${formatPctPoint(gapPct)}p 높지만, 방어자산 자체를 감점하기보다 향후 배치 여지를 반영하는 수준으로만 계산합니다.`,
      );
    } else {
      drivers.push(
        "현금파킹 자산은 일반 위험자산처럼 RSI만으로 평가하지 않고, 현재 레짐과 목표 현금 비중을 반영한 정책 보정 점수를 사용합니다.",
      );
    }
  }

  const biggestGap = categories
    .filter((category) => category.category !== "현금파킹")
    .sort((left, right) => Math.abs(right.gapPct) - Math.abs(left.gapPct))[0];

  if (biggestGap && biggestGap.gapPct > 0.03) {
    drivers.push(
      `${biggestGap.category} 비중이 목표보다 ${formatPctPoint(biggestGap.gapPct * 100)}p 부족합니다.`,
    );
  }

  return drivers.slice(0, 7);
}

function buildImprovementActions(
  account: PortfolioAccount,
  categories: CategoryGuide[],
  technicalScore: number | null,
  reportCoverageScore: number | null,
  reportStatus: "available" | "unavailable",
  reportUnavailableReason: string | null,
  regimeFitScore: number | null,
  riskPenaltyBreakdown: RiskPenaltyBreakdown | null,
  techCoverage: number | null,
  cashPct: number,
  targetCashPct: number,
) {
  const actions: string[] = [];

  const shortfalls = categories
    .filter((category) => category.category !== "현금파킹" && category.gapPct > 0.03)
    .sort((left, right) => right.gapAmount - left.gapAmount)
    .slice(0, 3);

  for (const category of shortfalls) {
    actions.push(
      `${category.category}을 ${Math.max(category.gapAmount, 0).toLocaleString()}원 보강하면 배분 점수가 개선됩니다.`,
    );
  }

  if (cashPct > targetCashPct + 0.05 && shortfalls.length > 0) {
    actions.push(
      `여유 현금 ${formatPctPoint((cashPct - targetCashPct) * 100)}p 범위 안에서 가장 부족한 자산군부터 분할 배치할 수 있습니다.`,
    );
  }

  const incompletePenalty = riskPenaltyBreakdown?.dataQuality?.incompletePenalty ?? 0;
  if (incompletePenalty > 0) {
    actions.push("누락된 보유 종목을 모두 입력하면 데이터 품질 패널티가 바로 줄어듭니다.");
  }

  const unmappedExposurePct = riskPenaltyBreakdown?.dataQuality?.unmappedExposurePct;
  if (typeof unmappedExposurePct === "number" && unmappedExposurePct > 5) {
    actions.push(`'기타' 비중 ${unmappedExposurePct.toFixed(1)}%를 적절한 자산군으로 분류하면 점수 신뢰도와 총점이 함께 개선됩니다.`);
  }

  if (typeof techCoverage === "number" && techCoverage < 0.8) {
    actions.push(`기술 신호가 없는 보유 종목이 있어 커버리지가 ${formatPercent(techCoverage * 100)} 수준입니다. 누락 종목 보완 또는 점검이 필요합니다.`);
  }

  if (technicalScore != null && technicalScore < 50) {
    actions.push("기술 점수가 약한 종목은 추가 매수보다 보유 점검 또는 교체 검토가 유리합니다.");
  }

  if (reportStatus === "unavailable" && reportUnavailableReason === "no_report_input") {
    actions.push("기준 거래일 리포트 수집이 비어 있어 리포트 점수가 빠졌습니다. 다음 실행에서 거래일 기준 산출물을 먼저 확보해야 합니다.");
  } else if (reportStatus === "unavailable") {
    actions.push("보유 종목과 직접 연결된 리포트가 적어 리포트 점수가 미반영 상태입니다. 매핑 근거가 약한 종목은 보수적으로 접근하는 편이 좋습니다.");
  } else if (reportCoverageScore != null && reportCoverageScore < 40) {
    actions.push("최근 리포트와 직접 연결된 보유 종목이 적습니다. 관련 근거가 약한 종목은 보수적으로 접근하는 편이 좋습니다.");
  }

  if (regimeFitScore != null && regimeFitScore < 50) {
    actions.push("현재 시장 레짐에 맞게 위험자산을 줄이거나 방어 자산/현금 비중을 조정하면 레짐 적합도가 올라갑니다.");
  }

  return actions.slice(0, 5);
}

function buildEvidenceNotes(stage4Account: Stage4AccountPlan | null) {
  const notes: string[] = [];

  if (stage4Account?.macroCommentary?.summary) {
    notes.push(
      `매크로 요약: ${String(stage4Account.macroCommentary.summary).replace(/\s+/g, " ").trim()}`,
    );
  }

  for (const stagedBuy of stage4Account?.stagedBuys ?? []) {
    if (!stagedBuy?.name || !stagedBuy?.reason) continue;
    const reason = String(stagedBuy.reason).replace(/\s+/g, " ").trim();
    notes.push(`${stagedBuy.name}: ${reason.slice(0, 150)}${reason.length > 150 ? "..." : ""}`);
  }

  for (const candidate of stage4Account?.stage2Candidates ?? []) {
    if (!candidate?.name || !candidate?.reason) continue;
    const reason = String(candidate.reason).replace(/\s+/g, " ").trim();
    notes.push(`${candidate.name}: ${reason.slice(0, 150)}${reason.length > 150 ? "..." : ""}`);
  }

  for (const driver of stage4Account?.stage1Drivers ?? []) {
    if (!driver?.title || !driver?.thesis) continue;
    const sentence = String(driver.thesis).replace(/\s+/g, " ").trim();
    notes.push(`${driver.title}: ${sentence.slice(0, 140)}${sentence.length > 140 ? "..." : ""}`);
  }

  for (const evidence of stage4Account?.topEvidence ?? []) {
    if (!evidence?.name || !evidence?.reason) continue;
    const reason = String(evidence.reason).replace(/\s+/g, " ").trim();
    notes.push(`${evidence.name}: ${reason.slice(0, 140)}${reason.length > 140 ? "..." : ""}`);
  }

  for (const rejected of stage4Account?.rejectedAlternatives ?? []) {
    if (!rejected?.name || !rejected?.rejectionReason) continue;
    notes.push(`${rejected.name} 제외: ${rejected.rejectionReason}`);
  }

  if ((stage4Account?.validatorFlags ?? []).length > 0) {
    notes.push(`검증 플래그: ${(stage4Account?.validatorFlags ?? []).join(", ")}`);
  }

  return notes.filter((value, index, array) => array.indexOf(value) === index).slice(0, 4);
}

function buildActionPoints(stage4Account: Stage4AccountPlan | null) {
  const points: string[] = [];

  if (stage4Account?.macroCommentary?.actionLine) {
    points.push(
      String(stage4Account.macroCommentary.actionLine).replace(/\s+/g, " ").trim(),
    );
  }

  if (stage4Account?.noAction && stage4Account?.noActionReason) {
    points.push(`오늘은 no_action: ${String(stage4Account.noActionReason).replace(/\s+/g, " ").trim()}`);
  }

  for (const stagedBuy of stage4Account?.stagedBuys ?? []) {
    if (!stagedBuy?.name || !stagedBuy?.suggestedAmount) continue;
    const reason = stagedBuy?.reason
      ? ` · ${String(stagedBuy.reason).replace(/\s+/g, " ").trim().slice(0, 72)}`
      : "";
    points.push(`${stagedBuy.name} ${stagedBuy.suggestedAmount.toLocaleString()}원 분할매수 검토${reason}`);
    if (stagedBuy.positionSizeLabel || stagedBuy.positionSizePctOfDeployBudget != null) {
      points.push(
        `${stagedBuy.name} 사이징: ${stagedBuy.positionSizeLabel ?? "기본"}${stagedBuy.positionSizePctOfDeployBudget != null ? ` / 집행 예산의 ${stagedBuy.positionSizePctOfDeployBudget}%` : ""}`,
      );
    }
    if (stagedBuy.entryCondition) {
      points.push(`${stagedBuy.name} 진입 조건: ${String(stagedBuy.entryCondition).replace(/\s+/g, " ").trim()}`);
    }
    if (stagedBuy.stopLossNote) {
      points.push(`${stagedBuy.name} 무효화/손절: ${String(stagedBuy.stopLossNote).replace(/\s+/g, " ").trim()}`);
    }
  }

  for (const trim of stage4Account?.trims ?? []) {
    if (!trim?.name) continue;
    const reason = trim?.reason
      ? ` · ${String(trim.reason).replace(/\s+/g, " ").trim().slice(0, 72)}`
      : "";
    points.push(`${trim.name} 비중 축소 또는 재점검${reason}`);
  }

  for (const hold of stage4Account?.holds ?? []) {
    if (!hold?.name) continue;
    const reason = hold?.reason
      ? ` · ${String(hold.reason).replace(/\s+/g, " ").trim().slice(0, 72)}`
      : "";
    points.push(`${hold.name}은 유지하되 추가 진입은 보류${reason}`);
  }

  for (const rejected of stage4Account?.rejectedAlternatives ?? []) {
    if (!rejected?.name || !rejected?.rejectionReason) continue;
    points.push(`${rejected.name} 제외 · ${String(rejected.rejectionReason).replace(/\s+/g, " ").trim().slice(0, 72)}`);
  }

  return points.slice(0, 4);
}

function buildExecutionItems(
  entries:
    | Array<{
        code?: string;
        name?: string;
        suggestedAmount?: number;
        reason?: string;
        source?: string;
        score?: number | null;
        volatilityBucket?: string | null;
        entryCondition?: string | null;
        stopLossPct?: number | null;
        stopLossNote?: string | null;
        positionSizePctOfDeployBudget?: number | null;
        positionSizePctOfAccount?: number | null;
        positionSizeLabel?: string | null;
      }>
    | undefined,
  kind: ExecutionGuideItem["kind"],
) {
  return (entries ?? [])
    .filter((entry): entry is NonNullable<typeof entry> & { name: string } => Boolean(entry?.name))
    .map((entry) => ({
      code: entry.code ?? null,
      name: entry.name,
      suggestedAmount:
        typeof entry.suggestedAmount === "number" ? entry.suggestedAmount : null,
      reason: entry.reason ?? null,
      source: entry.source ?? null,
      score: typeof entry.score === "number" ? entry.score : null,
      volatilityBucket: entry.volatilityBucket ?? null,
      entryCondition: entry.entryCondition ?? null,
      stopLossPct: typeof entry.stopLossPct === "number" ? entry.stopLossPct : null,
      stopLossNote: entry.stopLossNote ?? null,
      positionSizePctOfDeployBudget:
        typeof entry.positionSizePctOfDeployBudget === "number"
          ? entry.positionSizePctOfDeployBudget
          : null,
      positionSizePctOfAccount:
        typeof entry.positionSizePctOfAccount === "number"
          ? entry.positionSizePctOfAccount
          : null,
      positionSizeLabel: entry.positionSizeLabel ?? null,
      kind,
    }) satisfies ExecutionGuideItem);
}

function formatPctPoint(value: number) {
  const rounded = Number.parseFloat(value.toFixed(1));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(digits)}%`;
}

export function buildPortfolioGuide(snapshot: PortfolioSnapshot): PortfolioGuide | null {
  const strategy = readStrategy();
  if (!strategy?.accounts) {
    return null;
  }

  const technical = readLatestTechnical(snapshot.date);
  const technicalMap = technical?.scores ?? null;
  const stage3 = readStage3Analysis(snapshot.date);
  const stage4 = readStage4Analysis(snapshot.date);
  const analysisDateContext = normalizeArtifactDateContext({
    date: stage4?.date ?? stage3?.date ?? null,
    runDate: stage4?.runDate ?? stage3?.runDate ?? null,
    effectiveMarketDate:
      stage4?.effectiveMarketDate ?? stage3?.effectiveMarketDate ?? null,
    generatedAt: stage4?.generatedAt ?? stage3?.generatedAt ?? null,
  });
  const analysisDateLabel = formatDateContextLine(analysisDateContext);

  const nextTranchePct = getNextTranchePct(strategy);

  const accounts = snapshot.accounts
    .map((account): AccountGuide | null => {
      const strategyKey = normalizeStrategyAccountKey(account, strategy);
      if (!strategyKey) return null;

      const targetAllocation =
        strategy.accounts?.[strategyKey]?.target_allocation ?? {};
      const { totalAssets, holdingsValue, cashValue, categories } = categorizeAccount(
        account,
        targetAllocation,
      );
      const fallbackAllocationScore = getAccountScore(categories, false);
      const { technicalScore: fallbackTechnicalScore, topSignals } = getTechnicalScoreForAccount(account, technicalMap);
      const stage3Account = stage3?.accounts?.[account.key] ?? null;
      const stage4Account =
        stage4?.accountPlans?.find((plan) => plan.key === account.key) ?? null;
      const allocationScore =
        stage3Account?.baseScores?.allocationScore ??
        stage3Account?.allocationScore ??
        fallbackAllocationScore;
      const factorScore =
        stage3Account?.baseScores?.factorScore ??
        stage3Account?.factorScore ??
        null;
      const technicalScore =
        stage3Account?.baseScores?.techScore ??
        stage3Account?.holdingsScore ??
        fallbackTechnicalScore;
      const rawReportScore = stage3Account?.baseScores?.reportScore ?? null;
      const rawReportCoverageScore =
        typeof stage3Account?.coverage?.impactCoverage === "number"
          ? Math.round(stage3Account.coverage.impactCoverage * 100)
          : stage3Account?.reportCoverageScore ?? null;
      const reportStatus =
        stage3Account?.reportStatus ??
        ((typeof stage3Account?.coverage?.impactCoverage === "number" &&
          stage3Account.coverage.impactCoverage > 0) ||
        rawReportScore != null
          ? "available"
          : "unavailable");
      const reportUnavailableReason =
        stage3Account?.reportUnavailableReason ??
        (reportStatus === "available" ? null : "no_report_signal");
      const reportScore = reportStatus === "available" ? rawReportScore : null;
      const reportCoverageScore =
        reportStatus === "available" ? rawReportCoverageScore : null;
      const regimeFitScore = stage3Account?.baseScores?.regimeFit ?? null;
      const stage2Score = stage3Account?.baseScores?.stage2Score ?? null;
      const preTaxScore = stage3Account?.preTaxScore ?? null;
      const taxMultiplier = stage3Account?.taxAdjustment?.multiplier ?? null;
      const riskPenaltyTotal = stage3Account?.riskPenalty?.total ?? null;
      const riskPenaltyBreakdown = stage3Account?.riskPenalty?.breakdown ?? null;
      const effectiveWeights = stage3Account?.effectiveWeights ?? null;
      const factorCoverage =
        typeof stage3Account?.coverage?.factorCoverage === "number"
          ? stage3Account.coverage.factorCoverage
          : null;
      const techCoverage =
        typeof stage3Account?.coverage?.techCoverage === "number"
          ? stage3Account.coverage.techCoverage
          : null;
      const impactCoverage =
        typeof stage3Account?.coverage?.impactCoverage === "number"
          ? stage3Account.coverage.impactCoverage
          : null;
      const score =
        stage3Account?.totalScore ??
        mergeScores(allocationScore, technicalScore, account.incomplete);
      const targetCashPct = targetAllocation["현금파킹"] ?? 0;
      const cashPct = totalAssets > 0 ? cashValue / totalAssets : 0;
      const topShortfalls = categories
        .filter((category) => category.gapAmount > totalAssets * 0.03)
        .sort((left, right) => right.gapAmount - left.gapAmount)
        .slice(0, 3);
      const deployCeiling = Math.max(
        Math.min(cashValue, totalAssets * nextTranchePct),
        0,
      );
      const recommendedDeploy =
        cashPct > targetCashPct + 0.05
          ? Math.round(
              Math.min(
                deployCeiling,
                topShortfalls
                  .filter((category) => category.category !== "현금파킹")
                  .reduce((sum, category) => sum + Math.max(category.gapAmount, 0), 0),
              ),
            )
          : 0;
      const reserveCash = Math.max(cashValue - recommendedDeploy, 0);
      const candidates = topShortfalls
        .filter((category) => category.category !== "현금파킹")
        .map((category) => category.preferredLabel ?? category.category)
        .slice(0, 3);
      const evidenceNotes = buildEvidenceNotes(stage4Account);
      const actionPoints = buildActionPoints(stage4Account);
      const stage4ExecutionBuys = buildExecutionItems(stage4Account?.stagedBuys, "buy");
      const executionBuys =
        stage4ExecutionBuys.length > 0
          ? stage4ExecutionBuys
          : recommendedDeploy > 0 && candidates.length > 0
            ? [
                {
                  code: null,
                  name: candidates[0],
                  suggestedAmount: recommendedDeploy,
                  reason: stage4Account?.macroCommentary?.actionLine ?? null,
                  source: "fallback",
                  score: null,
                  kind: "buy" as const,
                },
              ]
            : [];
      const executionTrims = buildExecutionItems(stage4Account?.trims, "trim");
      const executionHolds = buildExecutionItems(stage4Account?.holds, "hold");
      const holdingGuides = buildHoldingGuides(account, categories, stage3, technicalMap);

      return {
        key: account.key,
        label: account.label,
        score,
        allocationScore,
        technicalScore,
        reportScore,
        regimeFitScore,
        stage2Score,
        reportStatus,
        reportUnavailableReason,
        riskPenaltyTotal,
        riskPenaltyBreakdown,
        effectiveWeights,
        techCoverage,
        impactCoverage,
        status: getStatusFromScore(score),
        totalAssets,
        holdingsValue,
        holdingsProfitLoss: getAccountHoldingsProfitLoss(account),
        holdingsProfitRate: getAccountHoldingsProfitRate(account),
        cashValue,
        cashPct,
        targetCashPct,
        recommendedDeploy,
        reserveCash,
        note:
          stage4Account?.macroCommentary?.summary ??
          stage3Account?.note ??
          buildAccountNote(
            account,
            score,
            technicalScore,
            recommendedDeploy,
            topShortfalls,
            cashPct,
            targetCashPct,
          ),
        candidates,
        macroSummary: stage4Account?.macroCommentary?.summary ?? null,
        macroDrivers: stage4Account?.macroCommentary?.drivers ?? [],
        assetFocus: stage4Account?.macroCommentary?.assetFocus ?? [],
        actionLine: stage4Account?.macroCommentary?.actionLine ?? null,
        executionReserveNote: stage4Account?.macroCommentary?.reserveNote ?? null,
        categories: categories.sort((left, right) => right.targetPct - left.targetPct),
        executionBuys,
        executionTrims,
        executionHolds,
        topSignals,
        reportCoverageScore,
        stage2Bias: stage3Account?.stage2Bias ?? null,
        scoreDrivers: buildScoreDrivers(
          account,
          factorScore,
          technicalScore,
          reportScore,
          reportCoverageScore,
          reportStatus,
          reportUnavailableReason,
          regimeFitScore,
          preTaxScore,
          taxMultiplier,
          riskPenaltyBreakdown,
          factorCoverage,
          techCoverage,
          cashPct,
          targetCashPct,
          categories,
        ),
        improvementActions: buildImprovementActions(
          account,
          categories,
          technicalScore,
          reportCoverageScore,
          reportStatus,
          reportUnavailableReason,
          regimeFitScore,
          riskPenaltyBreakdown,
          techCoverage,
          cashPct,
          targetCashPct,
        ),
        evidenceNotes,
        actionPoints,
        riskNotes: stage3Account?.riskPenalty?.notes ?? [],
        holdingGuides,
      };
    })
    .filter((account): account is AccountGuide => account !== null);

  const totalAssets = accounts.reduce((sum, account) => sum + account.totalAssets, 0);
  const totalCash = accounts.reduce((sum, account) => sum + account.cashValue, 0);
  const weightedScore =
    totalAssets > 0
      ? accounts.reduce((sum, account) => sum + account.score * account.totalAssets, 0) / totalAssets
      : 0;
  const globalActions = accounts
    .flatMap((account) =>
      account.categories
        .filter((category) => category.action === "보강 필요" && category.category !== "현금파킹")
        .sort((left, right) => right.gapAmount - left.gapAmount)
        .slice(0, 1)
        .map(
          (category) =>
            `${account.label}: ${category.category} ${Math.max(category.gapAmount, 0).toLocaleString()}원 보강`,
        ),
    )
    .slice(0, 4);
  const score = Math.round(weightedScore);

  return {
    score: stage3?.portfolio?.totalScore ?? score,
    analysisDateContext,
    analysisDateLabel,
    totalAssets,
    totalCash,
    totalCashPct: totalAssets > 0 ? totalCash / totalAssets : 0,
    nextTranchePct,
    globalStatus: getStatusFromScore(stage3?.portfolio?.totalScore ?? score),
    globalActions,
    incompleteCount: snapshot.accounts.filter((account) => account.incomplete).length,
    accounts,
  };
}
