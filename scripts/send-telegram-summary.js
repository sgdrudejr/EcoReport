#!/usr/bin/env node

import path from "node:path";

import fetch from "node-fetch";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
} from "./lib/pipeline-utils.js";

function parseArgs(argv) {
  const args = parseDateArgs(argv);
  args.dryRun = false;
  args.event = "pipeline-summary";
  args.message = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--event" && argv[index + 1]) {
      args.event = argv[index + 1];
      index += 1;
    } else if (token === "--message" && argv[index + 1]) {
      args.message = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function resolveEnvReference(value) {
  if (typeof value !== "string") return value;
  const match = /^\$([A-Z0-9_]+)$/.exec(value.trim());
  return match ? process.env[match[1]] ?? "" : value;
}

function summarizeActions(stage4, stage3) {
  const candidates = [];
  const positionLookup = stage3?.positions ?? {};

  for (const plan of stage4?.accountPlans ?? []) {
    for (const buy of plan.stagedBuys ?? []) {
      const positionKey = buy.code ? `${plan.key}:${buy.code}` : null;
      candidates.push({
        accountLabel: plan.label,
        code: buy.code ?? null,
        name: buy.name,
        type: "BUY",
        amount: buy.suggestedAmount ?? null,
        score: positionLookup[positionKey]?.actionScore ?? null,
        reason: buy.reason ?? null,
      });
    }
    for (const trim of plan.trims ?? []) {
      candidates.push({
        accountLabel: plan.label,
        code: trim.code ?? null,
        name: trim.name,
        type: "TRIM",
        amount: null,
        score: trim.score ?? null,
        reason: trim.reason ?? null,
      });
    }
  }

  return candidates
    .sort((left, right) => {
      const leftPriority = left.type === "BUY" ? 1 : 0;
      const rightPriority = right.type === "BUY" ? 1 : 0;
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;
      return (right.score ?? 0) - (left.score ?? 0);
    })
    .slice(0, 3);
}

function buildPipelineSummaryMessage(date, stage3, stage4) {
  const regimeLine = stage4?.regime?.name ?? stage3?.regime?.name ?? "N/A";
  const portfolioScore = stage4?.portfolioScore ?? stage3?.portfolio?.totalScore ?? "N/A";
  const actions = summarizeActions(stage4, stage3);

  const lines = [
    `EcoReport ${date}`,
    `포트폴리오 점수: ${portfolioScore}`,
    `레짐: ${regimeLine}`,
    "Top 3 액션:",
  ];

  if (actions.length === 0) {
    lines.push("- 즉시 공유할 액션 없음");
  } else {
    for (const action of actions) {
      lines.push(
        `- [${action.type}] ${action.accountLabel} / ${action.name}${action.code ? `(${action.code})` : ""}` +
          `${action.amount ? ` / ${Math.round(action.amount).toLocaleString()}원` : ""}` +
          `${action.score != null ? ` / score ${action.score}` : ""}` +
          `${action.reason ? ` / ${String(action.reason).slice(0, 80)}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.join(ROOT_DIR, "config", "telegram.json");
  const telegramConfig = await readJson(configPath, null);

  if (!telegramConfig) {
    throw new Error(`telegram 설정이 없습니다: ${configPath}`);
  }

  const botToken = resolveEnvReference(telegramConfig.botToken);
  const chatId = resolveEnvReference(telegramConfig.chatId);
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);

  let message = args.message;
  if (!message) {
    const [stage3, stage4] = await Promise.all([
      readJson(path.join(analysisDir, "stage3-quant-scores.json"), null),
      readJson(path.join(analysisDir, "stage4-execution-plan.json"), null),
    ]);

    if (!stage3 || !stage4) {
      throw new Error(`stage3/stage4 요약 데이터를 찾을 수 없습니다: ${analysisDir}`);
    }

    message =
      args.event === "pipeline-summary"
        ? buildPipelineSummaryMessage(args.date, stage3, stage4)
        : `EcoReport ${args.date}\n${args.event}\n${args.message ?? "메시지 없음"}`;
  }

  if (args.dryRun) {
    process.stdout.write(`${message}\n`);
    return;
  }

  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 가 설정되지 않았습니다.");
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage 실패 (${response.status}): ${body}`);
  }

  process.stdout.write(`telegram:${args.event}\n`);
}

main().catch((error) => {
  console.error(`[telegram-summary] 실패: ${error.message}`);
  process.exit(1);
});
