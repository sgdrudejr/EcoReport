import { listRepoFiles, readRepoJsonFile, readRepoTextFile } from "@/lib/repo-artifacts";

export type FeedbackCorrelationStat = {
  correlation?: number | null;
  sampleCount?: number;
};

export type FeedbackSignalStat = {
  count?: number;
  avgReturnPct?: number | null;
  hitRate?: number | null;
  bestPct?: number | null;
  worstPct?: number | null;
};

export type FeedbackAnalysis = {
  analysisDate?: string | null;
  generatedAt?: string | null;
  snapshotCount?: number;
  positionCount?: number;
  horizons?: number[];
  scoreReturnCorrelation?: Record<string, FeedbackCorrelationStat>;
  signalAccuracy?: Record<string, Record<string, FeedbackSignalStat>>;
  factorPredictivePower?: Record<
    string,
    Record<string, FeedbackCorrelationStat>
  >;
  regimeAccuracy?: Record<
    string,
    Record<
      string,
      {
        sampleCount?: number;
        avgReturnPct?: number | null;
        scoreCorrelation?: number | null;
        buyHitRate?: number | null;
      }
    >
  >;
  worstMispredictions?: Array<{
    date?: string | null;
    code?: string | null;
    name?: string | null;
    accountKey?: string | null;
    signal?: string | null;
    actionScore?: number | null;
    regimeName?: string | null;
    returnPct?: number | null;
    factors?: {
      raw?: Record<string, number>;
      zScores?: Record<string, number>;
    };
    warnings?: string[];
  }>;
  alerts?: Array<{
    level?: string | null;
    factor?: string | null;
    message?: string | null;
    correlation?: number | null;
  }>;
  autoAdjustment?: {
    enabled?: boolean;
    primaryHorizonDays?: number;
    minSamples?: number;
    baseWeights?: Record<string, number>;
    suggestedWeights?: Record<string, number>;
    deltas?: Record<string, number>;
    reasoning?: Array<{
      factor?: string;
      baseWeight?: number | null;
      multiplier?: number | null;
      correlation?: number | null;
      sampleCount?: number;
    }>;
    readyFactors?: number;
    source?: string | null;
  };
};

export function loadLatestFeedbackAnalysis() {
  const direct = readRepoJsonFile<FeedbackAnalysis>("data/feedback/latest-feedback.json");
  if (direct) return direct;

  const candidates = listRepoFiles("data/feedback/analysis")
    .filter((file) => /^\d{4}-\d{2}-\d{2}-feedback\.json$/.test(file))
    .sort()
    .reverse();

  for (const file of candidates) {
    const analysis = readRepoJsonFile<FeedbackAnalysis>(`data/feedback/analysis/${file}`);
    if (analysis) return analysis;
  }

  return null;
}

export function loadFeedbackReportMarkdown() {
  return readRepoTextFile("reports/feedback-summary.md");
}
