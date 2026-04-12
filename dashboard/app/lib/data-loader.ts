import path from "path";

import {
  listRepoDirectories,
  readRepoJsonFile,
  readRepoTextFile,
} from "@/lib/repo-artifacts";

type Stage3Like = {
  positions?: Record<
    string,
    {
      code?: string | null;
      name?: string | null;
      actionScore?: number | null;
      scoreDecomposition?: {
        alphaScore?: number | null;
        riskGate?: number | null;
        executionConfidence?: number | null;
        taxAdvantage?: number | null;
        clusterPenalty?: number | null;
      } | null;
    }
  >;
};

export function loadPreviousStage3Snapshot(date: string | null | undefined) {
  const dates = listRepoDirectories("data/analysis-state").sort().reverse();
  const currentIndex = date ? dates.indexOf(date) : -1;
  const candidates = currentIndex >= 0 ? dates.slice(currentIndex + 1) : dates;

  for (const candidateDate of candidates) {
    const snapshot = readRepoJsonFile<Stage3Like>(
      path.posix.join("data/analysis-state", candidateDate, "stage3-quant-scores.json"),
    );
    if (snapshot?.positions) {
      return {
        date: candidateDate,
        data: snapshot,
      };
    }
  }

  return {
    date: null,
    data: null,
  };
}

export function loadGhostPortfolioEntries(limit = 20) {
  const raw = readRepoTextFile("data/feedback/ghost-portfolio.jsonl");
  if (!raw) return [];

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-limit)
    .reverse();
}

export function loadLatestIntradayState() {
  return readRepoJsonFile("data/intraday/latest.json");
}

export function loadLatestBacktestEngine() {
  return readRepoJsonFile("data/backtest/engine-latest.json");
}
