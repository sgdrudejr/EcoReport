#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

import { callClaudeJson } from "./lib/llm-call.js";
import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

config({ path: path.join(ROOT_DIR, ".env") });

const SYSTEM_PROMPT = `당신은 EcoReport Stage 4 critic 입니다.
주어진 실행계획을 반대편 입장에서 검토하고, 과도한 집중·근거 부족·실행 우선순위 오류를 JSON으로만 반환하세요.
반드시 JSON object 하나만 반환하세요.`;

function parseArgs(argv) {
  const args = parseDateArgs(argv);
  args.output = null;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function buildCriticPrompt({ date, stage4, holdingClusters }) {
  const accountPlans = (stage4?.accountPlans ?? []).map((plan) => ({
    key: plan.key,
    label: plan.label,
    totalScore: plan.totalScore,
    stagedBuys: (plan.stagedBuys ?? []).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      suggestedAmount: item.suggestedAmount ?? null,
      reason: item.reason ?? null,
      clusterWarning: item.clusterWarning ?? null,
    })),
    trims: (plan.trims ?? []).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      score: item.score ?? null,
      reason: item.reason ?? null,
    })),
    validatorFlags: plan.validatorFlags ?? [],
    clusterWarnings: plan.clusterWarnings ?? [],
    noActionReason: plan.noActionReason ?? null,
  }));

  const promptPayload = {
    date,
    portfolioScore: stage4?.portfolioScore ?? null,
    regime: stage4?.regime ?? null,
    accountPlans,
    holdingClusters: holdingClusters?.clusters ?? [],
  };

  return [
    "다음 EcoReport Stage 4 실행계획을 비판적으로 리뷰하라.",
    "출력 형식:",
    "{",
    '  "summary": "한 문장 총평",',
    '  "globalRisks": ["리스크1", "리스크2"],',
    '  "accountReviews": [',
    '    {',
    '      "key": "계좌키",',
    '      "verdict": "pass|caution|fail",',
    '      "confidence": 0.0,',
    '      "concerns": ["우려1"],',
    '      "suggestion": "대안 한 줄"',
    "    }",
    "  ]",
    "}",
    "",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");
}

export async function buildCriticReview({
  date,
  stage4,
  holdingClusters,
  model,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다.");
  }

  const runMeta = buildRunMetadata({
    date,
    runDate: stage4?.runDate ?? date,
    effectiveMarketDate: stage4?.effectiveMarketDate ?? date,
    runId: stage4?.runId ?? null,
  });
  const prompt = buildCriticPrompt({ date, stage4, holdingClusters });
  const { payload, rawText, model: resolvedModel } = await callClaudeJson({
    prompt,
    systemPrompt: SYSTEM_PROMPT,
    model,
    temperature: 0.1,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  return {
    ...runMeta,
    source: "claude-critic",
    model: resolvedModel,
    summary: payload.summary ?? null,
    globalRisks: payload.globalRisks ?? [],
    accountReviews: payload.accountReviews ?? [],
    rawText,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const stage4 = await readJson(path.join(analysisDir, "stage4-execution-plan.json"), null);
  const holdingClusters = await readJson(path.join(analysisDir, "holding-clusters.json"), {
    clusters: [],
  });

  if (!stage4) {
    throw new Error(`stage4-execution-plan.json 이 없습니다: ${analysisDir}`);
  }

  const review = await buildCriticReview({
    date: args.date,
    stage4,
    holdingClusters,
  });
  const outputPath =
    args.output ?? path.join(analysisDir, "stage4-critic-review.json");
  await writeJson(outputPath, review);
  console.log(outputPath);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[stage4-critic] 실패: ${error.message}`);
    process.exit(1);
  });
}
