#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  writeText,
} from "./lib/pipeline-utils.js";

function parseArgs(argv) {
  const args = parseDateArgs(argv);
  args.output = null;
  args.telegramOutput = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (token === "--telegram-output" && argv[index + 1]) {
      args.telegramOutput = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function resolvePath(target, fallback) {
  if (!target) return fallback;
  return path.isAbsolute(target) ? target : path.join(ROOT_DIR, target);
}

function compact(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit = 40) {
  const text = compact(value);
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, limit - 3)}...`;
}

function formatAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function escapeCell(value) {
  return String(value ?? "-").replace(/\|/g, "\\|");
}

function collectRows(plan) {
  const rows = [];

  for (const item of plan.stagedBuys ?? []) {
    rows.push({
      action: "BUY",
      name: item.name ?? item.code ?? "-",
      amount: formatAmount(item.suggestedAmount),
      urgency: item.urgency ?? item.entryCondition ?? "-",
      note: truncate(item.reason ?? item.entryTriggers?.join(", ") ?? "-", 56),
    });
  }

  for (const item of plan.trims ?? []) {
    rows.push({
      action: "TRIM",
      name: item.name ?? item.code ?? "-",
      amount: "-",
      urgency: "trim",
      note: truncate(item.reason ?? "-", 56),
    });
  }

  for (const item of plan.holds ?? []) {
    rows.push({
      action: "HOLD",
      name: item.name ?? item.code ?? "-",
      amount: "-",
      urgency: "hold",
      note: truncate(item.reason ?? "-", 56),
    });
  }

  for (const item of plan.watches ?? []) {
    rows.push({
      action: "WATCH",
      name: item.name ?? item.code ?? "-",
      amount: "-",
      urgency: "watch",
      note: truncate(item.reason ?? "-", 56),
    });
  }

  if (rows.length === 0) {
    rows.push({
      action: "NO_ACTION",
      name: "-",
      amount: "-",
      urgency: "-",
      note: truncate(plan.noActionReason ?? "실행 계획 없음", 56),
    });
  }

  return rows;
}

function buildMarkdown(stage4) {
  const lines = [
    `# 11. Execution Plan Table (${stage4.date})`,
    "",
    `- portfolioScore: ${stage4.portfolioScore ?? "-"}`,
    `- regime: ${stage4.regime?.name ?? "-"}`,
    "",
  ];

  for (const plan of stage4.accountPlans ?? []) {
    const rows = collectRows(plan);
    lines.push(`## ${plan.label} (${plan.key})`);
    lines.push("");
    lines.push(`- totalScore: ${plan.totalScore ?? "-"}`);
    lines.push(`- deployBudget: ${formatAmount(plan.plannedDeployBudget ?? plan.deployBudget)}`);
    lines.push(`- reserveCash: ${formatAmount(plan.reserveCash)}`);
    lines.push("");
    lines.push("| 액션 | 종목 | 금액 | 긴급도 | 핵심 근거 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(
        `| ${escapeCell(row.action)} | ${escapeCell(row.name)} | ${escapeCell(row.amount)} | ${escapeCell(row.urgency)} | ${escapeCell(row.note)} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildTelegramTable(stage4) {
  const lines = [
    `EcoReport ${stage4.date} 실행계획 표`,
    `레짐: ${stage4.regime?.name ?? "-"} | 점수: ${stage4.portfolioScore ?? "-"}`,
    "",
  ];

  for (const plan of stage4.accountPlans ?? []) {
    const rows = collectRows(plan);
    lines.push(`[${plan.label}]`);
    lines.push("액션 | 종목 | 금액 | 긴급도");
    for (const row of rows) {
      lines.push(
        `${row.action} | ${truncate(row.name, 18)} | ${row.amount} | ${truncate(row.urgency, 14)}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const analysisPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage4-execution-plan.json");
  const stage4 = await readJson(analysisPath, null);
  if (!stage4) {
    throw new Error(`stage4 실행계획 파일이 없습니다: ${analysisPath}`);
  }

  const markdownPath = resolvePath(
    args.output,
    path.join(ROOT_DIR, "reports", "daily", `${args.date}-stage4-execution-plan-table.md`),
  );
  const telegramPath = resolvePath(
    args.telegramOutput,
    path.join(ROOT_DIR, "reports", "daily", `${args.date}-stage4-execution-plan-telegram.txt`),
  );

  await writeText(markdownPath, buildMarkdown(stage4));
  await writeText(telegramPath, buildTelegramTable(stage4));

  process.stdout.write(`${markdownPath}\n`);
  process.stdout.write(`${telegramPath}\n`);
}

main().catch((error) => {
  console.error(`stage4 execution plan table export 실패: ${error.message}`);
  process.exit(1);
});
