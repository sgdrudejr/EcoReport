import path from "path";
import {
  listRepoDirectories,
  readRepoJsonFile,
} from "@/lib/repo-artifacts";

const ANALYSIS_DIR = "data/analysis-state";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_ORDER = ["ISA", "PENSION", "TOSS"];

type Stage3Account = {
  key?: string;
  label?: string;
  totalScore?: number | null;
  stage2Bias?: string | null;
  reportCoverageScore?: number | null;
  coverage?: {
    impactCoverage?: number | null;
  };
  riskPenalty?: {
    total?: number | null;
  };
};

type Stage3Analysis = {
  portfolio?: {
    totalScore?: number | null;
  };
  accounts?: Record<string, Stage3Account>;
};

type Stage4AccountPlan = {
  key?: string;
  label?: string;
  candidateFromGap?: string | null;
  macroCommentary?: {
    actionLine?: string | null;
  };
};

type Stage4Analysis = {
  accountPlans?: Stage4AccountPlan[];
};

export type AccountCycleChange = {
  key: string;
  label: string;
  currentScore: number | null;
  previousScore: number | null;
  scoreDelta: number | null;
  currentBias: string | null;
  previousBias: string | null;
  currentRiskPenalty: number | null;
  previousRiskPenalty: number | null;
  riskPenaltyDelta: number | null;
  currentReportCoverage: number | null;
  previousReportCoverage: number | null;
  reportCoverageDelta: number | null;
  currentCandidate: string | null;
  previousCandidate: string | null;
  actionLine: string | null;
};

export type CycleChangeSummary = {
  currentDate: string;
  previousDate: string;
  currentPortfolioScore: number | null;
  previousPortfolioScore: number | null;
  portfolioScoreDelta: number | null;
  highlights: string[];
  accounts: AccountCycleChange[];
};

function toPercentScore(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.round(value * 100);
}

function scoreDelta(current: number | null | undefined, previous: number | null | undefined) {
  if (typeof current !== "number" || typeof previous !== "number") {
    return null;
  }
  return current - previous;
}

function buildHighlightLines(summary: Omit<CycleChangeSummary, "highlights">) {
  const lines: string[] = [];

  if (summary.portfolioScoreDelta !== null && summary.portfolioScoreDelta !== 0) {
    const sign = summary.portfolioScoreDelta > 0 ? "+" : "";
    lines.push(
      `포트폴리오 운용 점수 ${summary.previousPortfolioScore ?? "-"}점 → ${summary.currentPortfolioScore ?? "-"}점 (${sign}${summary.portfolioScoreDelta}점).`,
    );
  }

  const biggestMover = summary.accounts
    .filter((account) => account.scoreDelta !== null && account.scoreDelta !== 0)
    .sort((left, right) => Math.abs(right.scoreDelta ?? 0) - Math.abs(left.scoreDelta ?? 0))[0];

  if (biggestMover?.scoreDelta != null) {
    const sign = biggestMover.scoreDelta > 0 ? "+" : "";
    lines.push(
      `${biggestMover.label} 점수 변화가 가장 큽니다: ${biggestMover.previousScore ?? "-"}점 → ${biggestMover.currentScore ?? "-"}점 (${sign}${biggestMover.scoreDelta}점).`,
    );
  }

  for (const account of summary.accounts) {
    if (account.currentBias && account.previousBias && account.currentBias !== account.previousBias) {
      lines.push(
        `${account.label} bias가 ${account.previousBias}에서 ${account.currentBias}로 바뀌었습니다.`,
      );
    }
  }

  for (const account of summary.accounts) {
    if (
      account.currentCandidate &&
      account.previousCandidate &&
      account.currentCandidate !== account.previousCandidate
    ) {
      lines.push(
        `${account.label} 우선 후보가 ${account.previousCandidate}에서 ${account.currentCandidate}로 바뀌었습니다.`,
      );
    }
  }

  if (lines.length === 0) {
    lines.push("직전 cycle 대비 큰 점수/액션 변화는 아직 감지되지 않았습니다.");
  }

  return lines.slice(0, 4);
}

export function loadCycleChangeSummary() {
  const datedDirs = listRepoDirectories(ANALYSIS_DIR)
    .filter((dir) => DATE_PATTERN.test(dir))
    .sort()
    .reverse();

  if (datedDirs.length < 2) {
    return null;
  }

  const [currentDate, previousDate] = datedDirs;
  const currentStage3 = readRepoJsonFile<Stage3Analysis>(
    path.posix.join(ANALYSIS_DIR, currentDate, "stage3-quant-scores.json"),
  );
  const previousStage3 = readRepoJsonFile<Stage3Analysis>(
    path.posix.join(ANALYSIS_DIR, previousDate, "stage3-quant-scores.json"),
  );
  const currentStage4 = readRepoJsonFile<Stage4Analysis>(
    path.posix.join(ANALYSIS_DIR, currentDate, "stage4-execution-plan.json"),
  );
  const previousStage4 = readRepoJsonFile<Stage4Analysis>(
    path.posix.join(ANALYSIS_DIR, previousDate, "stage4-execution-plan.json"),
  );

  if (!currentStage3 || !previousStage3) {
    return null;
  }

  const currentPlans = new Map(
    (currentStage4?.accountPlans ?? [])
      .filter((plan): plan is Stage4AccountPlan & { key: string } => typeof plan.key === "string")
      .map((plan) => [plan.key, plan]),
  );
  const previousPlans = new Map(
    (previousStage4?.accountPlans ?? [])
      .filter((plan): plan is Stage4AccountPlan & { key: string } => typeof plan.key === "string")
      .map((plan) => [plan.key, plan]),
  );

  const accountKeys = new Set([
    ...Object.keys(currentStage3.accounts ?? {}),
    ...Object.keys(previousStage3.accounts ?? {}),
    ...currentPlans.keys(),
    ...previousPlans.keys(),
  ]);

  const accounts = [...accountKeys]
    .sort((left, right) => {
      const leftIndex = ACCOUNT_ORDER.indexOf(left);
      const rightIndex = ACCOUNT_ORDER.indexOf(right);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    })
    .map((key) => {
      const current = currentStage3.accounts?.[key] ?? null;
      const previous = previousStage3.accounts?.[key] ?? null;
      const currentPlan = currentPlans.get(key) ?? null;
      const previousPlan = previousPlans.get(key) ?? null;
      const currentCoverage =
        toPercentScore(current?.coverage?.impactCoverage) ?? current?.reportCoverageScore ?? null;
      const previousCoverage =
        toPercentScore(previous?.coverage?.impactCoverage) ?? previous?.reportCoverageScore ?? null;

      return {
        key,
        label: current?.label ?? previous?.label ?? currentPlan?.label ?? previousPlan?.label ?? key,
        currentScore: current?.totalScore ?? null,
        previousScore: previous?.totalScore ?? null,
        scoreDelta: scoreDelta(current?.totalScore, previous?.totalScore),
        currentBias: current?.stage2Bias ?? currentPlan?.key ? current?.stage2Bias ?? null : null,
        previousBias: previous?.stage2Bias ?? previousPlan?.key ? previous?.stage2Bias ?? null : null,
        currentRiskPenalty: current?.riskPenalty?.total ?? null,
        previousRiskPenalty: previous?.riskPenalty?.total ?? null,
        riskPenaltyDelta: scoreDelta(current?.riskPenalty?.total, previous?.riskPenalty?.total),
        currentReportCoverage: currentCoverage,
        previousReportCoverage: previousCoverage,
        reportCoverageDelta: scoreDelta(currentCoverage, previousCoverage),
        currentCandidate: currentPlan?.candidateFromGap ?? null,
        previousCandidate: previousPlan?.candidateFromGap ?? null,
        actionLine: currentPlan?.macroCommentary?.actionLine ?? null,
      } satisfies AccountCycleChange;
    });

  const summary = {
    currentDate,
    previousDate,
    currentPortfolioScore: currentStage3.portfolio?.totalScore ?? null,
    previousPortfolioScore: previousStage3.portfolio?.totalScore ?? null,
    portfolioScoreDelta: scoreDelta(
      currentStage3.portfolio?.totalScore,
      previousStage3.portfolio?.totalScore,
    ),
    accounts,
  };

  return {
    ...summary,
    highlights: buildHighlightLines(summary),
  } satisfies CycleChangeSummary;
}
