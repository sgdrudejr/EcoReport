#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

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
  args.document = null;
  args.caption = null;
  args.followupMessageFile = null;
  args.followupPreformatted = false;

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
    } else if (token === "--document" && argv[index + 1]) {
      args.document = argv[index + 1];
      index += 1;
    } else if (token === "--caption" && argv[index + 1]) {
      args.caption = argv[index + 1];
      index += 1;
    } else if (token === "--followup-message-file" && argv[index + 1]) {
      args.followupMessageFile = argv[index + 1];
      index += 1;
    } else if (token === "--followup-preformatted") {
      args.followupPreformatted = true;
    }
  }

  return args;
}

function resolveEnvReference(value) {
  if (typeof value !== "string") return value;
  const match = /^\$([A-Z0-9_]+)$/.exec(value.trim());
  return match ? process.env[match[1]] ?? "" : value;
}

function resolvePath(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitMessageLines(text, maxChars = 3800) {
  const lines = String(text ?? "").split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    current = line;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [""];
}

async function loadTelegramSecretsFromEnvFile() {
  const candidates = [
    path.join(ROOT_DIR, "config", "telegram_notify.env"),
    path.join(ROOT_DIR, "telegram_notify.env"),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = {};
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const normalized = trimmed.startsWith("export ")
          ? trimmed.slice("export ".length).trim()
          : trimmed;
        const index = normalized.indexOf("=");
        if (index <= 0) continue;
        const key = normalized.slice(0, index).trim();
        let value = normalized.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        parsed[key] = value;
      }
      if (parsed.TELEGRAM_BOT_TOKEN || parsed.TELEGRAM_CHAT_ID) {
        return parsed;
      }
      if (parsed.BOT_TOKEN || parsed.CHAT_ID) {
        return {
          TELEGRAM_BOT_TOKEN: parsed.BOT_TOKEN,
          TELEGRAM_CHAT_ID: parsed.CHAT_ID,
        };
      }
    } catch {
      // ignore missing env files
    }
  }

  return {};
}

async function sendTelegramMessage({ botToken, chatId, text, parseMode = null }) {
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage 실패 (${response.status}): ${body}`);
  }
}

async function sendChunkedTelegramText({ botToken, chatId, text, preformatted = false }) {
  const chunks = splitMessageLines(text, preformatted ? 3400 : 3800);
  for (const chunk of chunks) {
    const payloadText = preformatted ? `<pre>${escapeHtml(chunk)}</pre>` : chunk;
    await sendTelegramMessage({
      botToken,
      chatId,
      text: payloadText,
      parseMode: preformatted ? "HTML" : null,
    });
  }
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

  let botToken = resolveEnvReference(telegramConfig.botToken);
  let chatId = resolveEnvReference(telegramConfig.chatId);
  if (!botToken || !chatId) {
    const fileSecrets = await loadTelegramSecretsFromEnvFile();
    botToken = botToken || fileSecrets.TELEGRAM_BOT_TOKEN || "";
    chatId = chatId || fileSecrets.TELEGRAM_CHAT_ID || "";
  }
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
    if (args.document) {
      process.stdout.write(`document: ${resolvePath(args.document)}\n`);
    }
    if (args.followupMessageFile) {
      process.stdout.write(`followup: ${resolvePath(args.followupMessageFile)}\n`);
    }
    return;
  }

  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 가 설정되지 않았습니다.");
  }

  await sendChunkedTelegramText({ botToken, chatId, text: message, preformatted: false });

  const resolvedDocumentPath = resolvePath(args.document);
  if (resolvedDocumentPath) {
    const documentBuffer = await fs.readFile(resolvedDocumentPath);
    const form = new FormData();
    form.append("chat_id", chatId);
    const caption = String(args.caption ?? "").trim() || `EcoReport ${args.date}`;
    form.append("caption", caption.slice(0, 1024));
    form.append(
      "document",
      new Blob([documentBuffer]),
      path.basename(resolvedDocumentPath),
    );

    const docResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: "POST",
      body: form,
    });

    if (!docResponse.ok) {
      const body = await docResponse.text();
      throw new Error(`Telegram sendDocument 실패 (${docResponse.status}): ${body}`);
    }
  }

  const followupPath = resolvePath(args.followupMessageFile);
  if (followupPath) {
    const followupText = await fs.readFile(followupPath, "utf8");
    await sendChunkedTelegramText({
      botToken,
      chatId,
      text: followupText,
      preformatted: args.followupPreformatted,
    });
  }

  process.stdout.write(`telegram:${args.event}\n`);
}

main().catch((error) => {
  console.error(`[telegram-summary] 실패: ${error.message}`);
  process.exit(1);
});
