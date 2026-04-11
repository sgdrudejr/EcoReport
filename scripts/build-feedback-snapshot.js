#!/usr/bin/env node
/**
 * Performance Feedback Loop — Step 1: 일일 스냅샷 저장
 *
 * Stage 3 + Stage 4 + technical 데이터에서 핵심 시그널을 추출해
 * data/feedback/snapshots/{DATE}.json 에 기록한다.
 *
 * 이후 build-feedback-analysis.js가 N일 후 실제 수익률과 비교한다.
 *
 * 사용:
 *   node scripts/build-feedback-snapshot.js --date 2026-04-10
 */

import path from "node:path";
import fs from "node:fs/promises";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;

  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);
  const stage3Path = path.join(analysisDir, "stage3-quant-scores.json");
  const stage4Path = path.join(analysisDir, "stage4-execution-plan.json");
  const techPath = path.join(ROOT_DIR, "data", "technical", `${date}.json`);

  const [stage3, stage4, technical] = await Promise.all([
    readJson(stage3Path),
    readJson(stage4Path),
    readJson(techPath),
  ]);

  if (!stage3 || !stage4) {
    console.error(`[feedback-snapshot] stage3 또는 stage4 데이터 없음: ${date}`);
    process.exit(1);
  }

  const techScores = technical?.scores ?? {};
  const positionsMap =
    Object.keys(stage3?.positions ?? {}).length > 0
      ? stage3.positions
      : stage3.holdings ?? {};
  const uniqueStrings = (items) => [...new Set((items ?? []).filter(Boolean))];

  // 포지션별 스냅샷 추출
  const positions = Object.values(positionsMap).map((h) => {
    const tech = techScores[h.code] ?? {};
    const reportSources = uniqueStrings(
      (h.reportImpacts ?? []).flatMap((impact) => [
        impact?.broker ?? null,
        impact?.reportType ? `${impact.reportType}:${impact.broker ?? "unknown"}` : null,
      ]),
    );
    return {
      code: h.code,
      name: h.name,
      accountKey: h.accountKey,
      category: h.category,
      marketValue: h.marketValue,
      actionScore: h.actionScore,
      signal: h.signal,
      conviction: h.conviction,
      factorScore: h.scores?.factorScore ?? null,
      techScore: h.scores?.techScore ?? null,
      reportScore: h.scores?.reportScore ?? null,
      reportImpactCount: h.report?.impactCount ?? (h.reportImpacts ?? []).length ?? 0,
      reportSources,
      factors: h.factor?.zScores ?? h.factor?.raw ?? null,
      closePrice: tech.close ?? null,
      rsi: tech.rsi ?? null,
    };
  });

  // Stage 4 요약
  const accountSummaries = (stage4.accountPlans ?? []).map((plan) => ({
    key: plan.key,
    totalScore: plan.totalScore,
    stage2Bias: plan.stage2Bias,
    deployBudget: plan.deployBudget,
    buysCount: (plan.stagedBuys ?? []).length,
    holdsCount: (plan.holds ?? []).length,
    trimsCount: (plan.trims ?? []).length,
    watchesCount: (plan.watches ?? []).length,
  }));

  const snapshot = {
    ...buildRunMetadata(args),
    regime: stage3.regime?.name ?? null,
    regimeConfidence: stage3.regime?.confidence ?? null,
    portfolioScore: stage4.portfolioScore ?? null,
    marketClose: technical?.market_context?.close ?? null,
    positions,
    accountSummaries,
    stage2Source: stage3.stage2Source ?? null,
  };

  const outDir = path.join(ROOT_DIR, "data", "feedback", "snapshots");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${date}.json`);
  await writeJson(outPath, snapshot);
  console.log(outPath);
}

main().catch((err) => {
  console.error(`[feedback-snapshot] 실패: ${err.message}`);
  process.exit(1);
});
