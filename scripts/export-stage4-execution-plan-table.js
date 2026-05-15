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

const DECISION_LABELS = {
  BUY_NOW: "즉시매수",
  CONDITIONAL_BUY: "조건매수",
  BLOCKED_BUY: "매수제외",
  HOLD_KEEP: "보유유지",
  HOLD_PROTECT: "수익보호",
  TRIM_REVIEW: "감량검토",
  WATCH_ADD: "추가관찰",
  WATCH_OFF_REPORT: "리포트밖",
  WATCH_TRIM: "감량관찰",
  WATCH_RISK: "위험관찰",
  WATCH_DATA: "자료보강",
  BUY: "매수후보",
  TRIM: "감량검토",
  HOLD: "보유",
  WATCH: "관찰",
  NO_ACTION: "실행없음",
};

const STATUS_LABELS = {
  buy: "매수",
  trim: "감량",
  hold: "보유",
  watch: "관찰",
  blocked: "제외",
};

function decisionLabel(card, fallback) {
  if (card?.decisionBucket === "WATCH_OFF_REPORT" && card?.externalCoverage?.available) {
    return card.decisionLabel ?? "외부관찰";
  }
  return DECISION_LABELS[card?.decisionBucket] ?? DECISION_LABELS[fallback] ?? card?.decisionLabel ?? fallback ?? "-";
}

function statusLabel(value) {
  return STATUS_LABELS[value] ?? value ?? "-";
}

function cardLookupKey(accountKey, item, sourceAction = null) {
  const id = item?.code ?? item?.name ?? "-";
  return `${accountKey}:${id}${sourceAction ? `:${sourceAction}` : ""}`;
}

function buildCardIndex(holdingCards) {
  const index = new Map();
  for (const card of holdingCards?.cards ?? []) {
    const item = { code: card.code, name: card.name };
    index.set(cardLookupKey(card.accountKey, item, card.sourceAction), card);
    if (!index.has(cardLookupKey(card.accountKey, item))) {
      index.set(cardLookupKey(card.accountKey, item), card);
    }
  }
  return index;
}

function findCard(cardIndex, plan, item, sourceAction) {
  return (
    cardIndex.get(cardLookupKey(plan.key, item, sourceAction)) ??
    cardIndex.get(cardLookupKey(plan.key, item)) ??
    null
  );
}

function cardNote(card, fallback) {
  if (card?.decisionBucket === "HOLD_KEEP") {
    return card.thesis ?? card?.holdingRole?.keepRule ?? fallback ?? "-";
  }
  return (
    card?.addConditions?.[0] ??
    card?.trimConditions?.[0] ??
    card?.holdingRole?.keepRule ??
    card?.blockedBuyReason ??
    fallback ??
    "-"
  );
}

function collectRows(plan, cardIndex = new Map()) {
  const rows = [];

  for (const item of plan.stagedBuys ?? []) {
    const card = findCard(cardIndex, plan, item, "BUY");
    rows.push({
      action: decisionLabel(card, "BUY"),
      name: item.name ?? item.code ?? "-",
      amount: formatAmount(item.suggestedAmount),
      urgency: card?.reportCoverage?.statusLabel ?? item.urgency ?? item.entryCondition ?? "-",
      note: truncate(cardNote(card, item.reason ?? item.entryTriggers?.join(", ")), 64),
    });
  }

  for (const item of plan.trims ?? []) {
    const card = findCard(cardIndex, plan, item, "TRIM");
    rows.push({
      action: decisionLabel(card, "TRIM"),
      name: item.name ?? item.code ?? "-",
      amount: "-",
      urgency: card?.reportCoverage?.statusLabel ?? "감량",
      note: truncate(cardNote(card, item.reason), 64),
    });
  }

  for (const item of plan.holds ?? []) {
    const card = findCard(cardIndex, plan, item, "HOLD");
    rows.push({
      action: decisionLabel(card, "HOLD"),
      name: item.name ?? item.code ?? "-",
      amount: "-",
      urgency: card?.reportCoverage?.statusLabel ?? "보유",
      note: truncate(cardNote(card, item.reason), 64),
    });
  }

  for (const item of plan.watches ?? []) {
    const card = findCard(cardIndex, plan, item, "WATCH");
    rows.push({
      action: decisionLabel(card, "WATCH"),
      name: item.name ?? item.code ?? "-",
      amount: "-",
      urgency: card?.reportCoverage?.statusLabel ?? "관찰",
      note: truncate(cardNote(card, item.reason), 64),
    });
  }

  for (const item of plan.rejectedAlternatives ?? []) {
    const card = findCard(cardIndex, plan, item, "REJECTED");
    rows.push({
      action: decisionLabel(card, "BLOCKED_BUY"),
      name: item.name ?? item.code ?? "-",
      amount: "-",
      urgency: card?.reportCoverage?.statusLabel ?? "제외",
      note: truncate(cardNote(card, item.rejectionReason), 64),
    });
  }

  if (rows.length === 0) {
    rows.push({
      action: DECISION_LABELS.NO_ACTION,
      name: "-",
      amount: "-",
      urgency: "-",
      note: truncate(plan.noActionReason ?? "실행 계획 없음", 56),
    });
  }

  return rows;
}

function buildMarkdown(stage4, holdingCards = null) {
  const cardIndex = buildCardIndex(holdingCards);
  const lines = [
    `# 11. 실행 전략 표 (${stage4.date})`,
    "",
    `- 포트폴리오 점수: ${stage4.portfolioScore ?? "-"}`,
    `- 시장 국면: ${stage4.regime?.name ?? "-"}`,
    "",
  ];

  for (const plan of stage4.accountPlans ?? []) {
    const rows = collectRows(plan, cardIndex);
    lines.push(`## ${plan.label} (${plan.key})`);
    lines.push("");
    lines.push(`- 계좌 점수: ${plan.totalScore ?? "-"}`);
    lines.push(`- 투입 예산: ${formatAmount(plan.plannedDeployBudget ?? plan.deployBudget)}`);
    lines.push(`- 남길 예수금: ${formatAmount(plan.reserveCash)}`);
    lines.push("");
    lines.push("| 판정 | 종목 | 금액 | 상태 | 핵심 근거 |");
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

function buildTelegramTable(stage4, holdingCards = null) {
  const cardIndex = buildCardIndex(holdingCards);
  const lines = [
    `EcoReport ${stage4.date} 실행계획 표`,
    `레짐: ${stage4.regime?.name ?? "-"} | 점수: ${stage4.portfolioScore ?? "-"}`,
    "",
  ];

  for (const plan of stage4.accountPlans ?? []) {
    const rows = collectRows(plan, cardIndex);
    lines.push(`[${plan.label}]`);
    lines.push("판정 | 종목 | 금액 | 상태");
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
  const holdingCardsPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "holding-decision-cards.json");
  const stage4 = await readJson(analysisPath, null);
  const holdingCards = await readJson(holdingCardsPath, null);
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

  await writeText(markdownPath, buildMarkdown(stage4, holdingCards));
  await writeText(telegramPath, buildTelegramTable(stage4, holdingCards));

  process.stdout.write(`${markdownPath}\n`);
  process.stdout.write(`${telegramPath}\n`);
}

main().catch((error) => {
  console.error(`stage4 execution plan table export 실패: ${error.message}`);
  process.exit(1);
});
