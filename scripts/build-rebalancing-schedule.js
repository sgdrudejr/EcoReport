#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

const SELL_PRIORITY = ["ISA", "KIS_MAIN", "TOSS", "PENSION"];

function prioritizePlans(plans) {
  return [...plans].sort(
    (left, right) => SELL_PRIORITY.indexOf(left.key) - SELL_PRIORITY.indexOf(right.key),
  );
}

function previousStage3Date(date) {
  const current = new Date(`${date}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() - 1);
  return current.toISOString().slice(0, 10);
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const previousDate = previousStage3Date(args.date);
  const [stage3, stage4, previousStage3] = await Promise.all([
    readJson(path.join(analysisDir, "stage3-quant-scores.json"), null),
    readJson(path.join(analysisDir, "stage4-execution-plan.json"), null),
    readJson(path.join(ROOT_DIR, "data", "analysis-state", previousDate, "stage3-quant-scores.json"), null),
  ]);

  if (!stage3 || !stage4) {
    throw new Error("stage3 또는 stage4 데이터가 없습니다.");
  }

  const currentRegime = stage3?.regime?.name ?? null;
  const previousRegime = previousStage3?.regime?.name ?? null;
  const regimeShift = currentRegime && previousRegime && currentRegime !== previousRegime;
  const dayOfMonth = Number(args.date.split("-")[2] ?? "0");
  const monthlyWindow = dayOfMonth <= 3;
  const shouldRebalance = Boolean(regimeShift || monthlyWindow);

  const prioritizedPlans = prioritizePlans(stage4.accountPlans ?? []);
  const trims = prioritizedPlans.flatMap((plan) =>
    (plan.trims ?? []).slice(0, 2).map((item) => ({
      accountKey: plan.key,
      accountLabel: plan.label,
      code: item.code ?? null,
      name: item.name,
      action: "trim",
      suggestedAmount: item.suggestedAmount ?? null,
      rationale: item.reason ?? "리스크 또는 중복 노출 완화",
      taxPriority: SELL_PRIORITY.indexOf(plan.key) + 1,
    })),
  );
  const buys = (stage4.accountPlans ?? []).flatMap((plan) =>
    (plan.stagedBuys ?? []).slice(0, 2).map((item) => ({
      accountKey: plan.key,
      accountLabel: plan.label,
      code: item.code ?? null,
      name: item.name,
      action: "buy",
      suggestedAmount: item.suggestedAmount ?? null,
      rationale: item.reason ?? "카테고리 갭 보강",
    })),
  );

  const payload = {
    ...buildRunMetadata(args),
    shouldRebalance,
    triggers: {
      monthlyWindow,
      regimeShift,
      currentRegime,
      previousRegime,
    },
    taxPolicy: {
      sellPriority: SELL_PRIORITY,
      note: "세금 효율을 위해 축소 제안은 ISA -> 일반 -> 전술 -> 연금 순서로 우선 검토",
    },
    trims,
    buys,
  };

  const outputPath = path.join(analysisDir, "rebalancing-schedule.json");
  await fs.mkdir(analysisDir, { recursive: true });
  await writeJson(outputPath, payload);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`[rebalancing-schedule] 실패: ${error.message}`);
  process.exit(1);
});
