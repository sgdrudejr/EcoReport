import path from "path";

import SimulatorClient from "./simulator-client";
import { listRepoDirectories, readRepoJsonFile } from "@/lib/repo-artifacts";

type Stage3Payload = {
  positions?: Record<
    string,
    {
      code?: string | null;
      name?: string | null;
      category?: string | null;
      actionScore?: number | null;
      scores?: {
        factorScore?: number | null;
        techScore?: number | null;
        reportScore?: number | null;
      } | null;
      scoreDecomposition?: {
        executionConfidence?: number | null;
        clusterPenalty?: number | null;
      } | null;
    }
  >;
};

function loadLatestStage3() {
  const dates = listRepoDirectories("data/analysis-state").sort().reverse();
  for (const date of dates) {
    const payload = readRepoJsonFile<Stage3Payload>(
      path.posix.join("data/analysis-state", date, "stage3-quant-scores.json"),
    );
    if (payload?.positions) {
      return {
        date,
        payload,
      };
    }
  }
  return null;
}

export default function SimulatorPage() {
  const stage3 = loadLatestStage3();
  const positions = Object.values(stage3?.payload?.positions ?? {})
    .filter((item) => item.code && item.name && typeof item.actionScore === "number")
    .map((item) => ({
      code: item.code as string,
      name: item.name as string,
      category: item.category ?? null,
      actionScore: item.actionScore as number,
      factorScore: item.scores?.factorScore ?? null,
      technicalScore: item.scores?.techScore ?? null,
      reportScore: item.scores?.reportScore ?? null,
      executionConfidence: item.scoreDecomposition?.executionConfidence ?? null,
      clusterPenalty: item.scoreDecomposition?.clusterPenalty ?? null,
    }));

  return <SimulatorClient date={stage3?.date ?? null} positions={positions} />;
}
