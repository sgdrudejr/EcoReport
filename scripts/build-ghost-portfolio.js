#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_DIR, parseDateArgs, readJson } from "./lib/pipeline-utils.js";

const OUTPUT_PATH = path.join(ROOT_DIR, "data", "feedback", "ghost-portfolio.jsonl");

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const [stage4, portfolio] = await Promise.all([
    readJson(path.join(analysisDir, "stage4-execution-plan.json"), null),
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), null),
  ]);

  if (!stage4 || !portfolio) {
    throw new Error("stage4 또는 portfolio 데이터가 없습니다.");
  }

  const heldCodes = new Set(
    (portfolio.accounts ?? []).flatMap((account) =>
      (account.holdings ?? []).map((holding) => holding.code).filter(Boolean),
    ),
  );

  const entries = (stage4.accountPlans ?? []).flatMap((plan) =>
    (plan.stagedBuys ?? [])
      .filter((item) => item.code && !heldCodes.has(item.code))
      .map((item) => ({
        date: args.date,
        accountKey: plan.key,
        accountLabel: plan.label,
        code: item.code,
        name: item.name,
        suggestedAmount: item.suggestedAmount ?? null,
        suggestedScore: item.score ?? null,
        reason: item.reason ?? null,
        source: item.source ?? "stage4",
        createdAt: new Date().toISOString(),
      })),
  );

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  if (entries.length > 0) {
    await fs.appendFile(
      OUTPUT_PATH,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
  }
  console.log(OUTPUT_PATH);
}

main().catch((error) => {
  console.error(`[ghost-portfolio] 실패: ${error.message}`);
  process.exit(1);
});
