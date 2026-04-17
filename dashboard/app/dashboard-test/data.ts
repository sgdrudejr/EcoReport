import { loadLatestFeedbackAnalysis, type FeedbackAnalysis } from "@/lib/feedback";
import {
  getPortfolioTotals,
  loadLatestPortfolio,
  type PortfolioSnapshot,
} from "@/lib/portfolio";
import {
  loadRecommendationBoard,
  type RecommendationBoard,
  type RecommendationIdea,
} from "@/lib/recommendations";
import { listRepoFiles, readRepoJsonFile, readRepoTextFile } from "@/lib/repo-artifacts";
import { loadShadowPreview } from "@/lib/shadow-preview";
import {
  loadLatestStockeasySnapshot,
  type StockeasySnapshot,
} from "@/lib/stockeasy";

type SourceSupport = {
  reports?: number;
  stockeasy?: number;
  marketvoice?: number;
  technical?: number;
  macro?: number;
  llm?: number;
};

export type AccountFeature = {
  accountKey: string;
  netScore: number;
  support: SourceSupport;
  topSupportingThemes?: string[];
  topRisks?: string[];
};

export type ThemeFeature = {
  theme: string;
  netScore: number;
  support: SourceSupport;
  sourceCount: number;
};

export type SecurityFeature = {
  code: string;
  name: string;
  netScore: number;
  support: SourceSupport;
  sourceCount: number;
  candidateAccounts?: string[];
};

export type DecisionFeaturesFile = {
  date: string;
  generatedAt?: string;
  accountFeatures?: AccountFeature[];
  themeFeatures?: ThemeFeature[];
  securityFeatures?: SecurityFeature[];
  consensus?: {
    topAlignedThemes?: string[];
    topAlignedSecurities?: string[];
  };
  divergence?: {
    sourceConflicts?: Array<{
      entityType?: string;
      entityId?: string;
      directions?: string[];
      sources?: string[];
    }>;
  };
  quality?: {
    overallStatus?: string;
    flags?: string[];
  };
};

export type CrossSourceConsensusFile = {
  date: string;
  generatedAt?: string;
  consensus?: {
    topAlignedThemes?: string[];
    topAlignedSecurities?: string[];
  };
};

export type SourceDivergenceFile = {
  date: string;
  generatedAt?: string;
  divergence?: {
    sourceConflicts?: Array<{
      entityType?: string;
      entityId?: string;
      directions?: string[];
      sources?: string[];
    }>;
  };
};

export type QualityMatrixFile = {
  date: string;
  generatedAt?: string;
  quality?: {
    overallStatus?: string;
    flags?: string[];
  };
};

export type Stage4ExecutionPlanFile = {
  date: string;
  generatedAt?: string;
  portfolioScore?: number | null;
  regime?: {
    name?: string | null;
    confidence?: number | null;
  } | null;
  accountPlans?: Array<{
    key: string;
    label?: string | null;
    totalScore?: number | null;
    stage2Bias?: string | null;
    deployBudget?: number | null;
    plannedDeployBudget?: number | null;
    reserveCash?: number | null;
    candidateFromGap?: string | null;
    topGap?: {
      category?: string | null;
      targetPct?: number | null;
      currentPct?: number | null;
      gapAmount?: number | null;
    } | null;
    stagedBuys?: Array<{
      code?: string | null;
      name?: string | null;
      suggestedAmount?: number | null;
      reason?: string | null;
      confidence?: number | null;
      source?: string | null;
      urgency?: string | null;
      stance?: string | null;
    }>;
    trims?: Array<{
      code?: string | null;
      name?: string | null;
      suggestedAmount?: number | null;
      reason?: string | null;
      confidence?: number | null;
      source?: string | null;
      urgency?: string | null;
      stance?: string | null;
    }>;
    holds?: Array<{
      code?: string | null;
      name?: string | null;
      score?: number | null;
      reason?: string | null;
      source?: string | null;
    }>;
    validatorFlags?: string[];
  }>;
};

export type Stage2StrategyOptionsFile = {
  date: string;
  source?: string | null;
  mockMode?: string | null;
  macro_view?: {
    regime?: string | null;
    confidence?: string | null;
    summary?: string | null;
  } | null;
  strategy_changes?: Array<{
    theme?: string | null;
    direction?: string | null;
    why_now?: string | null;
    source_reports?: string[];
  }>;
  account_actions?: Array<{
    account_key?: string | null;
    bias?: string | null;
    rationale?: string | null;
    buy_candidates?: string[];
    trim_candidates?: string[];
    hold_candidates?: string[];
    reserve_cash_note?: string | null;
  }>;
};

export type SystemHealthFile = {
  date: string;
  generatedAt?: string;
  overallStatus?: string | null;
  counts?: {
    accounts?: number | null;
    reports?: number | null;
    extractedReports?: number | null;
    stage1Extracts?: number | null;
  } | null;
  checks?: Array<{
    key?: string | null;
    label?: string | null;
    status?: string | null;
    detail?: string | null;
    path?: string | null;
  }>;
};

export type DashboardTestReportTab = {
  key: string;
  label: string;
  subtitle: string;
  badge: string;
  lines: string[];
};

export type ExtendedFeedbackAnalysis = FeedbackAnalysis & {
  sampleSize?: number;
  signalHitRates?: {
    buy_hit_5d?: number | null;
    hold_hit_5d?: number | null;
    trim_negative_5d?: number | null;
  };
  weightSuggestions?: Array<{
    factor?: string | null;
    correlation_5d?: number | null;
    suggestion?: string | null;
  }>;
};

export type FeedbackHistoryEntry = {
  date: string;
  available: boolean;
  snapshotCount: number | null;
  sampleSize: number | null;
  buyHitRate: number | null;
  holdHitRate: number | null;
  trimHitRate: number | null;
  ret5Correlation: number | null;
  ret10Correlation: number | null;
  notes: string[];
};

export type DashboardTestData = {
  portfolio: PortfolioSnapshot;
  totals: ReturnType<typeof getPortfolioTotals>;
  recommendationBoard: RecommendationBoard | null;
  stockeasySnapshot: (StockeasySnapshot & {
    availableDates?: string[];
    resolvedDate?: string;
  }) | null;
  shadowPreview: ReturnType<typeof loadShadowPreview>;
  feedbackAnalysis: ExtendedFeedbackAnalysis | null;
  decisionFeatures: DecisionFeaturesFile | null;
  crossSourceConsensus: CrossSourceConsensusFile | null;
  sourceDivergence: SourceDivergenceFile | null;
  qualityMatrix: QualityMatrixFile | null;
  stage4ExecutionPlan: Stage4ExecutionPlanFile | null;
  stage2Strategy: Stage2StrategyOptionsFile | null;
  systemHealth: SystemHealthFile | null;
  reportTabs: DashboardTestReportTab[];
  feedbackHistory: FeedbackHistoryEntry[];
  feedbackReportLines: string[];
};

function toIsoDateParts(value: string) {
  return value.slice(0, 10);
}

function addDays(date: string, offset: number) {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

function listDateRange(startDate: string, endDate: string) {
  const result: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

function extractReadableLines(raw: string | null, limit = 12) {
  if (!raw) return [];

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^---+$/.test(line))
    .filter((line) => !line.startsWith("> "))
    .filter((line) => !/^#/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
    .filter((line) => line.length >= 6)
    .slice(0, limit);
}

function buildDashboardReportTabs(date: string): DashboardTestReportTab[] {
  const tabs: DashboardTestReportTab[] = [
    {
      key: "briefing",
      label: "실행 브리핑",
      subtitle: "daily briefing",
      badge: "briefing",
      lines: extractReadableLines(readRepoTextFile(`reports/daily/${date}-briefing.md`), 12),
    },
    {
      key: "stage4",
      label: "실행 계획",
      subtitle: "stage4 plan",
      badge: "stage4",
      lines: extractReadableLines(
        readRepoTextFile(`reports/daily/${date}-stage4-execution-plan.md`),
        14,
      ),
    },
    {
      key: "research",
      label: "심화 브리핑",
      subtitle: "rich research briefing",
      badge: "research",
      lines: extractReadableLines(
        readRepoTextFile(`knowledge/daily/${date}-gemini-briefing-rich.md`),
        14,
      ),
    },
    {
      key: "shadow",
      label: "Shadow 메모",
      subtitle: "shadow final insights",
      badge: "shadow",
      lines: extractReadableLines(
        readRepoTextFile(`data/analysis-state/${date}/stage3-shadow-final-insights.md`),
        14,
      ),
    },
  ];

  return tabs.filter((tab) => tab.lines.length > 0);
}

function loadFeedbackHistory(startDate: string, endDate: string) {
  const files = listRepoFiles("data/feedback/analysis")
    .filter((file) => /^\d{4}-\d{2}-\d{2}-feedback\.json$/.test(file))
    .sort();

  const fileMap = new Map(
    files.map((file) => [file.replace(/-feedback\.json$/, ""), file]),
  );

  return listDateRange(startDate, endDate).map((date) => {
    const fileName = fileMap.get(date);
    const analysis = fileName
      ? readRepoJsonFile<ExtendedFeedbackAnalysis>(`data/feedback/analysis/${fileName}`)
      : null;

    if (!analysis) {
      return {
        date,
        available: false,
        snapshotCount: null,
        sampleSize: null,
        buyHitRate: null,
        holdHitRate: null,
        trimHitRate: null,
        ret5Correlation: null,
        ret10Correlation: null,
        notes: ["피드백 분석 파일 미생성"],
      } satisfies FeedbackHistoryEntry;
    }

    const extractCorrelationValue = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (
        value &&
        typeof value === "object" &&
        "correlation" in value &&
        typeof (value as { correlation?: unknown }).correlation === "number"
      ) {
        return (value as { correlation: number }).correlation;
      }
      return null;
    };

    const notes: string[] = [];
    if ((analysis.snapshotCount ?? 0) <= 1) {
      notes.push("초기 표본");
    }
    if ((analysis.scoreReturnCorrelation?.ret_5d?.sampleCount ?? 0) === 0) {
      notes.push("수익률 상관 표본 부족");
    }
    if (analysis.generatedAt) {
      notes.push(`생성 ${toIsoDateParts(analysis.generatedAt)}`);
    }

    return {
      date,
      available: true,
      snapshotCount: analysis.snapshotCount ?? null,
      sampleSize: analysis.sampleSize ?? analysis.positionCount ?? null,
      buyHitRate: analysis.signalHitRates?.buy_hit_5d ?? null,
      holdHitRate: analysis.signalHitRates?.hold_hit_5d ?? null,
      trimHitRate: analysis.signalHitRates?.trim_negative_5d ?? null,
      ret5Correlation: extractCorrelationValue(
        analysis.scoreReturnCorrelation?.ret_5d ??
          analysis.scoreReturnCorrelation?.actionScore_vs_ret5d ??
          null,
      ),
      ret10Correlation: extractCorrelationValue(
        analysis.scoreReturnCorrelation?.ret_10d ??
          analysis.scoreReturnCorrelation?.actionScore_vs_ret10d ??
          null,
      ),
      notes,
    } satisfies FeedbackHistoryEntry;
  });
}

export function loadDashboardTestData(): DashboardTestData | null {
  const portfolio = loadLatestPortfolio();
  if (!portfolio) {
    return null;
  }

  const date = portfolio.date;

  return {
    portfolio,
    totals: getPortfolioTotals(portfolio),
    recommendationBoard: loadRecommendationBoard(date),
    stockeasySnapshot: loadLatestStockeasySnapshot(date),
    shadowPreview: loadShadowPreview(date),
    feedbackAnalysis: loadLatestFeedbackAnalysis() as ExtendedFeedbackAnalysis | null,
    decisionFeatures: readRepoJsonFile<DecisionFeaturesFile>(
      `data/features/${date}/decision-features.json`,
    ),
    crossSourceConsensus: readRepoJsonFile<CrossSourceConsensusFile>(
      `data/features/${date}/cross-source-consensus.json`,
    ),
    sourceDivergence: readRepoJsonFile<SourceDivergenceFile>(
      `data/features/${date}/source-divergence.json`,
    ),
    qualityMatrix: readRepoJsonFile<QualityMatrixFile>(
      `data/features/${date}/quality-matrix.json`,
    ),
    stage4ExecutionPlan: readRepoJsonFile<Stage4ExecutionPlanFile>(
      `data/analysis-state/${date}/stage4-execution-plan.json`,
    ),
    stage2Strategy: readRepoJsonFile<Stage2StrategyOptionsFile>(
      `data/analysis-state/${date}/stage2-strategy-options.json`,
    ),
    systemHealth: readRepoJsonFile<SystemHealthFile>(
      `data/analysis-state/${date}/system-health.json`,
    ),
    reportTabs: buildDashboardReportTabs(date),
    feedbackHistory: loadFeedbackHistory("2026-04-06", date),
    feedbackReportLines: extractReadableLines(readRepoTextFile("reports/feedback-summary.md"), 24),
  };
}

export function sortSourceSupportEntries(support?: SourceSupport | null) {
  return Object.entries(support ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort((left, right) => right[1] - left[1]);
}

export function getTopRecommendationIdeas(board: RecommendationBoard | null) {
  return (board?.lanes ?? [])
    .flatMap((lane) =>
      lane.items.map((item) => ({
        ...item,
        laneTitle: lane.title,
      })),
    )
    .sort((left, right) => right.score - left.score);
}

export function getTopThemeFeatures(decisionFeatures: DecisionFeaturesFile | null) {
  return [...(decisionFeatures?.themeFeatures ?? [])].sort((left, right) => {
    if (right.sourceCount !== left.sourceCount) {
      return right.sourceCount - left.sourceCount;
    }
    return right.netScore - left.netScore;
  });
}

export function getTopSecurityFeatures(decisionFeatures: DecisionFeaturesFile | null) {
  return [...(decisionFeatures?.securityFeatures ?? [])].sort((left, right) => {
    if (right.sourceCount !== left.sourceCount) {
      return right.sourceCount - left.sourceCount;
    }
    return right.netScore - left.netScore;
  });
}

export function getAccountFeatureMap(decisionFeatures: DecisionFeaturesFile | null) {
  return new Map(
    (decisionFeatures?.accountFeatures ?? []).map((item) => [item.accountKey, item]),
  );
}

export function getConsensusThemes(
  decisionFeatures: DecisionFeaturesFile | null,
  crossSourceConsensus: CrossSourceConsensusFile | null,
) {
  const explicit = crossSourceConsensus?.consensus?.topAlignedThemes ?? [];
  if (explicit.length > 0) {
    return explicit;
  }

  return getTopThemeFeatures(decisionFeatures)
    .filter((item) => item.sourceCount >= 2)
    .map((item) => item.theme);
}

export function getConsensusSecurities(
  decisionFeatures: DecisionFeaturesFile | null,
  crossSourceConsensus: CrossSourceConsensusFile | null,
) {
  const explicit = crossSourceConsensus?.consensus?.topAlignedSecurities ?? [];
  if (explicit.length > 0) {
    return explicit;
  }

  return getTopSecurityFeatures(decisionFeatures)
    .filter((item) => item.sourceCount >= 2)
    .map((item) => item.name);
}

export function getQualityStatus(
  qualityMatrix: QualityMatrixFile | null,
  decisionFeatures: DecisionFeaturesFile | null,
) {
  return qualityMatrix?.quality?.overallStatus ?? decisionFeatures?.quality?.overallStatus ?? "info";
}

export function getQualityFlags(
  qualityMatrix: QualityMatrixFile | null,
  decisionFeatures: DecisionFeaturesFile | null,
) {
  return qualityMatrix?.quality?.flags ?? decisionFeatures?.quality?.flags ?? [];
}

export function pickAccountIdeas(
  ideas: Array<RecommendationIdea & { laneTitle: string }>,
  accountKey: string,
) {
  return ideas.filter(
    (idea) =>
      idea.targetAccounts.includes(accountKey) ||
      idea.executionTargets.some((target) => target.accountKey === accountKey),
  );
}
