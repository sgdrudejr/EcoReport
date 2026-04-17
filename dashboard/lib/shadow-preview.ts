import { listRepoDirectories, readRepoJsonFile } from "@/lib/repo-artifacts";

export type ShadowTopic = {
  bucket_id: string;
  bucket_label: string;
  description?: string;
  stance?: string;
  report_count?: number;
  card_count?: number;
  bucket_score?: number;
  thesis?: string;
  keep_watch?: string;
  risk_watch?: string;
  decision_note?: string;
  evidence_note?: string;
  related_holdings?: Array<{
    code: string;
    name: string;
    category?: string;
    signal?: string;
    actionScore?: number | null;
    conviction?: string;
    accounts?: Array<{
      accountKey?: string;
      accountLabel?: string;
    }>;
  }>;
  summary_lines?: string[];
  source_reports?: string[];
};

export type ShadowAccountImplication = {
  accountKey: string;
  label: string;
  totalScore?: number | null;
  bias?: string;
  note?: string;
  riskNotes?: string[];
};

export type ShadowPriorityAction = {
  scope: string;
  action_type?: string;
  action: string;
  why_now: string;
  evidence_bucket?: string;
};

export type ShadowDashboardPreview = {
  headline?: string;
  subhead?: string;
  bullets?: string[];
};

export type Stage2ShadowPayload = {
  date: string;
  reportCount: number;
  cardCount: number;
  bucketCount: number;
  topBuckets: string[];
  buckets: Array<{
    bucket_id: string;
    bucket_label: string;
    description?: string;
    reportCount: number;
    cardCount: number;
    matchedHoldings?: string[];
    insightLines?: string[];
  }>;
};

export type Stage3ShadowPayload = {
  date: string;
  market_regime?: {
    name?: string;
    confidencePct?: number | null;
    marketScore?: number | null;
    close?: string | null;
    summary?: string | null;
    signals?: string[];
  };
  portfolio_summary?: {
    totalScore?: number | null;
    note?: string | null;
    accountCount?: number;
    holdingCount?: number;
  };
  executive_summary?: string[];
  top_topics?: ShadowTopic[];
  secondary_topics?: Array<{
    bucket_id: string;
    bucket_label: string;
    card_count: number;
    report_count: number;
  }>;
  portfolio_implications?: ShadowAccountImplication[];
  priority_actions?: ShadowPriorityAction[];
  watchpoints?: string[];
  dashboard_preview?: ShadowDashboardPreview;
};

export type ShadowPreviewBundle = {
  date: string;
  availableDates: string[];
  stage2: Stage2ShadowPayload;
  stage3: Stage3ShadowPayload;
};

function sortDatesDesc(values: string[]) {
  return [...values].sort((left, right) => right.localeCompare(left));
}

function buildStage2Path(date: string) {
  return `data/analysis-state/${date}/stage2-shadow-topic-buckets.json`;
}

function buildStage3Path(date: string) {
  return `data/analysis-state/${date}/stage3-shadow-final-insights.json`;
}

function hasShadowPayload(date: string) {
  const stage3 = readRepoJsonFile<Stage3ShadowPayload>(buildStage3Path(date));
  return Boolean(stage3?.date);
}

export function listShadowPreviewDates() {
  const dates = listRepoDirectories("data/analysis-state").filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
  return sortDatesDesc(dates.filter((date) => hasShadowPayload(date)));
}

export function loadShadowPreview(date?: string | null): ShadowPreviewBundle | null {
  const availableDates = listShadowPreviewDates();
  const resolvedDate = date && availableDates.includes(date) ? date : availableDates[0];

  if (!resolvedDate) {
    return null;
  }

  const stage2 = readRepoJsonFile<Stage2ShadowPayload>(buildStage2Path(resolvedDate));
  const stage3 = readRepoJsonFile<Stage3ShadowPayload>(buildStage3Path(resolvedDate));

  if (!stage2 || !stage3) {
    return null;
  }

  return {
    date: resolvedDate,
    availableDates,
    stage2,
    stage3,
  };
}
