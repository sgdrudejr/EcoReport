#!/usr/bin/env node
// 4단계: Stage 1~3 데이터를 모두 활용해 계좌별 실행 계획을 생성합니다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  PREFERRED_LABEL_BY_CATEGORY,
  ROOT_DIR,
  parseDateArgs,
  readJson,
  won,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

function normalizeStrategyAccountKey(account) {
  if (account.key === "ISA") return "ISA";
  if (account.key === "PENSION") return "연금저축";
  if (account.key === "TOSS") return "토스증권";
  return null;
}

function buildCategoryGaps(account, strategy) {
  const strategyKey = normalizeStrategyAccountKey(account);
  const targetAllocation = strategy?.accounts?.[strategyKey]?.target_allocation ?? {};
  const holdingsValue = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const totalAssets = Math.max(account.evaluationAmount ?? 0, holdingsValue + (account.cashAvailable ?? 0));
  const amounts = new Map();
  for (const holding of account.holdings ?? []) {
    const category =
      CATEGORY_BY_CODE[holding.code]?.[account.key] ??
      CATEGORY_BY_CODE[holding.code]?.default ??
      "기타";
    amounts.set(category, (amounts.get(category) ?? 0) + (holding.marketValue ?? 0));
  }
  if (targetAllocation["현금파킹"] != null) {
    amounts.set("현금파킹", account.cashAvailable ?? 0);
  }
  return Object.entries(targetAllocation)
    .map(([category, pct]) => {
      const current = amounts.get(category) ?? 0;
      return {
        category,
        targetPct: pct,
        currentPct: totalAssets > 0 ? current / totalAssets : 0,
        gapAmount: Math.round(totalAssets * pct - current),
      };
    })
    .sort((left, right) => right.gapAmount - left.gapAmount);
}

function executionBuckets(account, quant, stage2Action, strategy) {
  const gaps = buildCategoryGaps(account, strategy);
  const nextTranchePct =
    strategy?.dca_plan?.schedule?.find((item) => item.status !== "done" && item.status !== "completed")?.pct ?? 0.25;
  const deployBudget = Math.round(
    Math.max(0, Math.min(account.cashAvailable ?? 0, (Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0)) * nextTranchePct)),
  );
  const buy = [];
  const trim = [];
  const hold = [];
  const watch = [];

  for (const holding of account.holdings ?? []) {
    const score = quant.holdings?.[holding.code]?.actionScore ?? 50;
    const entry = {
      code: holding.code,
      name: holding.name,
      score,
      reason: quant.holdings?.[holding.code]?.reportImpacts?.[0]?.reason ?? quant.holdings?.[holding.code]?.technicalSignal ?? "점수 기반 분류",
    };
    if (score >= 68) buy.push(entry);
    else if (score <= 38) trim.push(entry);
    else if (score >= 50) hold.push(entry);
    else watch.push(entry);
  }

  const topGap = gaps.find((item) => item.category !== "현금파킹" && item.gapAmount > 0);
  const candidateFromGap = topGap ? PREFERRED_LABEL_BY_CATEGORY[topGap.category] : null;

  return {
    deployBudget,
    reserveCash: Math.max((account.cashAvailable ?? 0) - deployBudget, 0),
    stage2Bias: stage2Action?.bias ?? "hold",
    topGap,
    gapSummary: gaps.slice(0, 4),
    buy,
    trim,
    hold,
    watch,
    candidateFromGap,
  };
}

function resolveStage2Candidates(account, stage2Data, bucket) {
  const allCandidates = stage2Data?.candidate_scores ?? [];
  const accountKeyHints = new Set([account.key, account.label]);
  const buyCodes = new Set(bucket.stage2Bias ? (stage2Data?.account_actions ?? [])
    .find((item) => item.account_key === account.key || item.account_key === account.label)?.buy_candidates ?? [] : []);

  const matched = allCandidates.filter((item) => {
    const targets = item.target_accounts ?? [];
    const matchesAccount = targets.some((target) => accountKeyHints.has(target));
    const matchesGapLabel =
      bucket.candidateFromGap &&
      (item.name === bucket.candidateFromGap ||
        item.code === bucket.candidateFromGap ||
        (item.thesis ?? "").includes(bucket.candidateFromGap));
    const matchesBuyCode = buyCodes.has(item.code);
    return matchesAccount || matchesGapLabel || matchesBuyCode;
  });

  return matched.slice(0, 3).map((item) => ({
    code: item.code,
    name: item.name,
    score: null,
    reason: item.thesis ?? "Stage 2 후보 논리",
    source: "stage2",
  }));
}

function distributeBudget(bucket, stage2Candidates = []) {
  const candidates = stage2Candidates.length > 0 ? stage2Candidates : bucket.buy.slice(0, 3);
  if (bucket.deployBudget <= 0 || candidates.length === 0) return [];
  const weights = candidates.length === 1 ? [1] : candidates.length === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
  return candidates.map((item, index) => ({
    ...item,
    suggestedAmount: Math.round(bucket.deployBudget * weights[index]),
  }));
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const [portfolio, strategy, stage1, stage2, quant] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(ROOT_DIR, "config", "strategy.json"), { accounts: {} }),
    readJson(path.join(stateDir, "stage1-report-extracts-v2.json"), { extracts: [] }),
    readJson(path.join(stateDir, "stage2-strategy-options.json"), null),
    readJson(path.join(stateDir, "stage3-quant-scores.json"), { holdings: {}, accounts: {}, portfolio: {} }),
  ]);
  const stage2Data = stage2 ?? (await readJson(path.join(stateDir, "stage2-strategy-options.mock.json"), { account_actions: [], strategy_changes: [] }));

  const accountPlans = (portfolio.accounts ?? []).map((account) => {
    const stage2Action =
      stage2Data.account_actions?.find((item) => item.account_key === account.key || item.account_key === normalizeStrategyAccountKey(account)) ??
      null;
    const bucket = executionBuckets(account, quant, stage2Action, strategy);
    const stage2Candidates = resolveStage2Candidates(account, stage2Data, bucket);
    const stagedBuys = distributeBudget(bucket, stage2Candidates);
    return {
      key: account.key,
      label: account.label,
      totalScore: quant.accounts?.[account.key]?.totalScore ?? 50,
      stage2Bias: bucket.stage2Bias,
      deployBudget: bucket.deployBudget,
      reserveCash: bucket.reserveCash,
      topGap: bucket.topGap,
      candidateFromGap: bucket.candidateFromGap,
      stage2Candidates,
      stagedBuys,
      trims: bucket.trim.slice(0, 3),
      holds: bucket.hold.slice(0, 3),
      watches: bucket.watch.slice(0, 3),
      stage1Drivers: stage1.extracts
        .filter((item) => item.related_accounts?.includes(account.key))
        .slice(0, 4)
        .map((item) => ({ id: item.id, title: item.title, thesis: item.key_thesis })),
    };
  });

  const outputJson = args.output ?? path.join(stateDir, "stage4-execution-plan.json");
  const outputMarkdown =
    args.markdown ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-stage4-execution-plan.md`);

  const payload = {
    date: args.date,
    generatedAt: new Date().toISOString(),
    portfolioScore: quant.portfolio?.totalScore ?? 50,
    regime: quant.regime ?? null,
    accountPlans,
  };

  const regimeConfidence =
    typeof quant.regime?.confidence === "number" ? quant.regime.confidence.toFixed(2) : "N/A";

  const markdown = [
    `# EcoReport Stage 4 Execution Plan (${args.date})`,
    "",
    `- 포트폴리오 총점: ${quant.portfolio?.totalScore ?? "N/A"}점`,
    `- 레짐: ${quant.regime?.name ?? "N/A"} (신뢰도 ${regimeConfidence})`,
    "",
    ...accountPlans.flatMap((account) => [
      `## ${account.label} (${account.key})`,
      `- 계좌 총점: ${account.totalScore}점`,
      `- Stage 2 bias: ${account.stage2Bias}`,
      `- 이번 단계 투입 가능 금액: ${won(account.deployBudget)}`,
      `- 남길 예수금: ${won(account.reserveCash)}`,
      `- 가장 부족한 자산군: ${account.topGap ? `${account.topGap.category} / ${won(Math.max(account.topGap.gapAmount, 0))}` : "없음"}`,
      `- 우선 보강 후보: ${account.candidateFromGap ?? "없음"}`,
      "",
      "### 1차 실행",
      ...(account.stagedBuys.length > 0
        ? account.stagedBuys.map((item) => `- ${item.name}(${item.code}) ${won(item.suggestedAmount)} / 이유: ${item.reason}`)
        : ["- 즉시 매수 후보 없음"]),
      "",
      "### 비중 축소/재점검",
      ...(account.trims.length > 0
        ? account.trims.map((item) => `- ${item.name}(${item.code}) / ${item.score}점 / ${item.reason}`)
        : ["- 즉시 축소 대상 없음"]),
      "",
      "### 유지/관찰",
      ...(account.holds.length > 0 ? account.holds.map((item) => `- 유지: ${item.name}(${item.code}) / ${item.score}점`) : ["- 유지 후보 없음"]),
      ...(account.watches.length > 0 ? account.watches.map((item) => `- 관찰: ${item.name}(${item.code}) / ${item.score}점`) : []),
      "",
      "### Stage 1 근거",
      ...(account.stage1Drivers.length > 0
        ? account.stage1Drivers.map((item) => `- ${item.id}: ${item.title} / ${item.thesis}`)
        : ["- 직접 관련 리포트 추출 없음"]),
      "",
    ]),
  ].join("\n");

  await writeJson(outputJson, payload);
  await writeText(outputMarkdown, `${markdown}\n`);
  console.log(outputJson);
}

main().catch((error) => {
  console.error(`stage4 execution plan 생성 실패: ${error.message}`);
  process.exit(1);
});
