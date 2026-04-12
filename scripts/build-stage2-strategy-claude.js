#!/usr/bin/env node
/**
 * Stage 2 전략 탐색을 Claude API로 실행해 JSON 결과를 저장한다.
 *
 * 예시:
 *   node scripts/build-stage2-strategy-claude.js --date 2026-04-10
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";

import {
  buildRunMetadata,
  parseDateArgs,
  ROOT_DIR,
  withContract,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { callClaudeJson } from "./lib/llm-call.js";

config({ path: path.join(ROOT_DIR, ".env") });

const REQUIRED_KEYS = [
  "macro_view",
  "strategy_changes",
  "account_actions",
  "candidate_scores",
  "portfolio_risks",
];

const SYSTEM_PROMPT = `당신은 EcoReport 시스템의 Stage 2 전략 탐색 모듈입니다.
사용자의 포트폴리오, 리서치 노트, 기술점수를 바탕으로 계좌별 전략 옵션을 JSON으로 생성합니다.
반드시 완전한 JSON object 한 개만 반환하세요. 코드펜스, 설명 문장은 절대 붙이지 마세요.
모든 필수 키(macro_view, strategy_changes, account_actions, candidate_scores, portfolio_risks)를 포함하세요.`;

function parseArgs(argv) {
  const args = parseDateArgs(argv);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--prompt" && argv[i + 1]) {
      args.promptPath = argv[++i];
    }
    if (argv[i] === "--output" && argv[i + 1]) {
      args.output = argv[++i];
    }
    if (argv[i] === "--model" && argv[i + 1]) {
      args.model = argv[++i];
    }
    if (argv[i] === "--temperature" && argv[i + 1]) {
      args.temperature = parseFloat(argv[++i]);
    }
  }

  return args;
}

function validatePayload(payload) {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Stage 2 응답은 JSON object여야 합니다.");
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in payload)) {
      throw new Error(`Stage 2 응답에 필수 키가 없습니다: ${key}`);
    }
  }
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date;

  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);
  const manualKitDir = path.join(ROOT_DIR, "knowledge", "daily", "manual-kit", date);

  const promptPath =
    args.promptPath ?? path.join(manualKitDir, "08-stage2-strategy-prompt.md");
  const outputPath =
    args.output ?? path.join(analysisDir, "stage2-strategy-options.json");
  const rawOutputPath = outputPath.replace(/\.json$/, ".raw.txt");

  const prompt = await fs.readFile(promptPath, "utf8");
  if (!prompt.trim()) {
    throw new Error(`프롬프트 파일이 비어 있습니다: ${promptPath}`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다. .env에 추가하세요.");
  }

  console.log(`[stage2-claude] 프롬프트: ${promptPath} (${prompt.length} chars)`);
  console.log(`[stage2-claude] 모델: ${args.model ?? "claude-sonnet-4-20250514"}`);

  const { payload, rawText, model } = await callClaudeJson({
    prompt,
    systemPrompt: SYSTEM_PROMPT,
    model: args.model,
    temperature: args.temperature,
    apiKey,
  });

  validatePayload(payload);

  const runMeta = buildRunMetadata(args);
  const finalPayload = {
    ...runMeta,
    ...payload,
    date,
    source: "claude",
    model,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(
    outputPath,
    withContract(finalPayload, {
      stage: "stage2",
      generatedAt: runMeta.generatedAt,
    }),
  );
  await writeText(rawOutputPath, rawText);

  console.log(`[stage2-claude] 완료: ${outputPath}`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage2 claude 생성 실패: ${error.message}`);
  process.exit(1);
});
