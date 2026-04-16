#!/usr/bin/env node
// EcoReport 일일 자동화 러너.
// 기본 일일 시스템 + Gemini Deep Research 오버레이 + 실패 요약 기록까지 한 번에 수행합니다.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  ROOT_DIR,
  createGeneratedAt,
  readJson,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { allRefinementArtifactPaths } from "./lib/refinement-rounds.js";
import { isTradingDay, previousDate, resolveTradingDateContext } from "./lib/trading-calendar.js";

function parseArgs(argv) {
  const args = {
    date: "",
    runDate: "",
    runId: "",
    pollSec: 30,
    timeoutSec: 1800,
    skipPush: false,
    forceCollect: false,
    freshStart: false,
    reuseFrontDocument: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--run-date" && argv[index + 1]) {
      args.runDate = argv[index + 1];
      index += 1;
    } else if (token === "--run-id" && argv[index + 1]) {
      args.runId = argv[index + 1];
      index += 1;
    } else if (token === "--poll-sec" && argv[index + 1]) {
      args.pollSec = Number.parseInt(argv[index + 1], 10) || args.pollSec;
      index += 1;
    } else if (token === "--timeout-sec" && argv[index + 1]) {
      args.timeoutSec = Number.parseInt(argv[index + 1], 10) || args.timeoutSec;
      index += 1;
    } else if (token === "--skip-push") {
      args.skipPush = true;
    } else if (token === "--force-collect") {
      args.forceCollect = true;
    } else if (token === "--fresh-start") {
      args.freshStart = true;
    } else if (token === "--reuse-front-document") {
      args.reuseFrontDocument = true;
    }
  }

  return args;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function shellQuote(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function summarizeTail(lines, limit = 8) {
  return lines.slice(-limit).join("\n").trim();
}

function checklistMark(status) {
  if (status === "ok") return "x";
  return " ";
}

const PRIMARY_STRATEGY_STEP_IDS = [
  "strategy_refresh_round3_final",
  "strategy_refresh_final",
  "strategy_refresh",
];

function hasSuccessfulStrategyRefresh(steps) {
  return PRIMARY_STRATEGY_STEP_IDS.some((stepId) =>
    steps.some((item) => item.id === stepId && item.status === "ok"),
  );
}

function buildSameDayStatus(steps, artifacts) {
  const blockingStepIds = [
    "baseline_daily_system",
    "stage1_extracts",
    "rich_briefing_round3_final",
    "verify_outputs",
  ];
  const missingBlockingStep = blockingStepIds.some((stepId) => {
    const step = steps.find((item) => item.id === stepId);
    return !step || step.status !== "ok";
  });
  if (missingBlockingStep || !hasSuccessfulStrategyRefresh(steps)) {
    return "incomplete";
  }

  const requiredArtifactKeys = [
    "stage1",
    "chunkIndexStats",
    "stage1Shadow",
    "stage2Shadow",
    "stage3Shadow",
    "finalResearchBriefing",
    "stage2",
    "stage4",
    "dailyBriefing",
    "wikiDaily",
    "systemHealth",
  ];
  const missingArtifact = requiredArtifactKeys.some((key) => !artifacts?.[key]?.exists);
  return missingArtifact ? "incomplete" : "complete";
}

function computeOverallStatus(steps) {
  if (steps.some((step) => step.id === "baseline_daily_system" && step.status === "error")) {
    return "error";
  }

  if (steps.some((step) => step.status === "error")) {
    return "error";
  }

  const verifyStep = steps.find((step) => step.id === "verify_outputs");
  if (verifyStep && verifyStep.status !== "ok") {
    return "warn";
  }

  const stage1Step = steps.find((step) => step.id === "stage1_extracts");
  if (stage1Step && stage1Step.status !== "ok") {
    return "warn";
  }

  if (steps.some((step) => step.id.startsWith("rich_briefing") && step.status === "warn")) {
    return "warn";
  }

  return hasSuccessfulStrategyRefresh(steps) ? "ok" : "warn";
}

function buildFailureHint(stepId) {
  switch (stepId) {
    case "automation_readiness":
      return "Safari 자동화, 리포트 수집 네트워크(Naver/Shinhan), Gemini Python, Obsidian vault 쓰기 권한, GitHub 네트워크 상태를 readiness 리포트에서 먼저 확인하세요.";
    case "baseline_daily_system":
      return "수집, 시장 데이터, Stage 2 Python 의존성, 또는 기본 파이프라인 로그를 먼저 확인하세요.";
    case "stage1_extracts":
      return "리포트 인덱스, 전문 텍스트, 포트폴리오 스냅샷이 모두 생성됐는지와 Stage 1 추출 로그를 확인하세요.";
    case "stockeasy_capture":
      return "Safari 로그인 상태, StockEasy 세션 유지 여부, 그리고 시장분석/테마보드 화면이 실제로 열리는지 확인하세요.";
    case "deep_research_web":
      return "Safari가 잠겨 있지 않은지, Gemini 로그인 상태인지, Deep Research 도구가 노출되는지 확인하세요.";
    case "rich_briefing_overlay":
      return "09-stage1-5 결과 파일과 GEMINI_API_KEY, 그리고 Stage 1 추출물이 모두 있는지 확인하세요.";
    case "strategy_refresh":
      return "stage2 raw 응답과 종목 alias 매핑, Gemini JSON 응답 형식을 확인하세요.";
    case "followup_reindex":
      return "Stage 1 extract, Stage 4 plan, 리포트 전문 텍스트 경로가 모두 살아 있는지 확인하세요.";
    case "followup_prompt":
      return "stage1-followup-research-map.json과 wiki memory 파일이 정상 생성됐는지 확인하세요.";
    case "deep_research_follow_up_web":
      return "Safari/Gemini 로그인 상태와 follow-up prompt 파일 경로를 확인하세요.";
    case "wiki_rebuild_initial":
    case "wiki_rebuild_mid":
    case "wiki_rebuild_final":
      return "knowledge/wiki 생성 권한, refinement map 산출물, stage4 실행계획 파일을 함께 확인하세요.";
    case "round3_reindex":
      return "round 2 위키 메모리와 stage1-final-refinement-map 입력 파일이 정상인지 확인하세요.";
    case "round3_prompt":
      return "3차 refinement map과 wiki memory 파일이 정상 생성됐는지 확인하세요.";
    case "deep_research_round3_web":
      return "Safari/Gemini 로그인 상태와 3차 refinement prompt 경로를 확인하세요.";
    case "rich_briefing_round3_final":
      return "3차 refinement 응답과 rich briefing 입력 파일이 모두 최신인지 확인하세요.";
    case "strategy_refresh_round3_final":
      return "Stage 2 prompt에 3차 refinement 결과가 정상 주입됐는지 확인하세요.";
    case "rich_briefing_final":
      return "follow-up map, follow-up deep research 응답, GEMINI_API_KEY를 함께 확인하세요.";
    case "strategy_refresh_final":
      return "Stage 2 prompt에 follow-up map/response가 정상 주입됐는지와 Gemini JSON 응답 형식을 확인하세요.";
    case "wiki_publish":
      return "knowledge/wiki 생성 권한과 Obsidian vault 경로를 확인하세요.";
    case "verify_outputs":
      return "system-health 리포트의 warn/error 체크를 기준으로 빠진 산출물을 확인하세요.";
    case "push_data_branch":
      return "Git 인증과 origin/data 브랜치 push 권한을 확인하세요.";
    default:
      return "해당 단계 로그 tail과 직전 산출물을 먼저 확인하세요.";
  }
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!filePath || !(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath, null);
}

function parseRetryDelayMsFromText(message) {
  const retryInMatch = String(message ?? "").match(/Please retry in\s+([0-9.]+)s/i);
  if (retryInMatch) {
    const seconds = Number.parseFloat(retryInMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000) + 1000;
    }
  }

  const secondsMatch = String(message ?? "").match(/retry_delay\s*\{\s*seconds:\s*(\d+)/i);
  if (secondsMatch) {
    const seconds = Number.parseInt(secondsMatch[1], 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000 + 1000;
    }
  }

  return null;
}

async function readBriefingMeta(briefingPath) {
  return readJsonIfExists(`${briefingPath}.meta.json`);
}

async function promoteArchivedBriefing({ artifacts, logger }) {
  const archivePath = artifacts.finalResearchBriefingArchive;
  const outputPath = artifacts.finalResearchBriefing;
  if (!archivePath || !outputPath) return false;
  if (!(await fileExists(archivePath))) return false;

  const archiveContent = await fs.promises.readFile(archivePath, "utf8").catch(() => "");
  if (!archiveContent.trim()) return false;

  await fs.promises.writeFile(outputPath, `${archiveContent.trim()}\n`, "utf8");

  const archiveMeta = await readJsonIfExists(`${archivePath}.meta.json`);
  const currentMeta = await readJsonIfExists(`${outputPath}.meta.json`);
  const normalizedModel =
    archiveMeta?.source === "fallback" || archiveMeta?.model === "local-fallback"
      ? "manual-kit-archive"
      : (archiveMeta?.model ?? currentMeta?.model ?? "manual-kit-archive");
  await writeJson(`${outputPath}.meta.json`, {
    ...(currentMeta ?? {}),
    ...(archiveMeta ?? {}),
    // Archive promotion means the published briefing should no longer be
    // treated as a terminal fallback artifact by downstream consumers.
    source: "archive_promoted",
    model: normalizedModel,
    promoted_from_archive: archivePath,
    promoted_at: createGeneratedAt(),
  });

  logger.write(`♻️ archived rich briefing 승격: ${archivePath}`);
  return true;
}

function createLogger(logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: "a" });

  function write(line) {
    const text = `${line}\n`;
    process.stdout.write(text);
    stream.write(text);
  }

  function writeChunk(chunk, isError = false) {
    const text = chunk.toString();
    if (isError) {
      process.stderr.write(text);
    } else {
      process.stdout.write(text);
    }
    stream.write(text);
  }

  function close() {
    stream.end();
  }

  return { write, writeChunk, close };
}

async function runCommand({
  id,
  label,
  command,
  args,
  logger,
  cwd = ROOT_DIR,
  soft = false,
  skip = false,
  timeoutMs = 0,
}) {
  if (skip) {
    return {
      id,
      label,
      status: "skipped",
      soft,
      commandLine: `${command} ${args.map(shellQuote).join(" ")}`.trim(),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: null,
      errorMessage: null,
      outputTail: "",
    };
  }

  logger.write("");
  logger.write(`== ${label} ==`);
  logger.write(`$ ${command} ${args.map(shellQuote).join(" ")}`);

  const startedAt = new Date();
  const tailLines = [];

  const appendTail = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      tailLines.push(trimmed);
      if (tailLines.length > 40) {
        tailLines.shift();
      }
    }
  };

  return await new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            logger.write(`⏰ ${label} 타임아웃 (${Math.round(timeoutMs / 1000)}s) — SIGTERM 전송`);
            child.kill("SIGTERM");
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {
                // no-op
              }
            }, 5000);
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      appendTail(chunk);
      logger.writeChunk(chunk, false);
    });

    child.stderr.on("data", (chunk) => {
      appendTail(chunk);
      logger.writeChunk(chunk, true);
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      const endedAt = new Date();
      resolve({
        id,
        label,
        status: soft ? "warn" : "error",
        soft,
        commandLine: `${command} ${args.map(shellQuote).join(" ")}`.trim(),
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        exitCode: null,
        errorMessage: timedOut ? `${label} 타임아웃 (${Math.round(timeoutMs / 1000)}s)` : error.message,
        outputTail: summarizeTail(tailLines),
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const endedAt = new Date();
      const errorMessage = timedOut
        ? `${label} 타임아웃 (${Math.round(timeoutMs / 1000)}s)`
        : code === 0
          ? null
          : `${label} 실패 (exit ${code})`;
      resolve({
        id,
        label,
        status: code === 0 && !timedOut ? "ok" : soft ? "warn" : "error",
        soft,
        commandLine: `${command} ${args.map(shellQuote).join(" ")}`.trim(),
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        exitCode: code,
        errorMessage,
        outputTail: summarizeTail(tailLines),
      });
    });
  });
}

async function runCommandWithRetry({ retries = 1, backoffMs = 5000, ...options }) {
  let result = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    result = await runCommand(options);
    if (result.status === "ok" || result.status === "skipped") {
      return result;
    }

    if (attempt <= retries) {
      const delay = backoffMs * Math.pow(2, attempt - 1);
      options.logger.write(
        `⏳ ${options.label} 재시도 ${attempt}/${retries} (${Math.round(delay / 1000)}s 후)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return result;
}

async function runRichBriefingStep({
  fallbackRetries = 4,
  fallbackBackoffMs = 30_000,
  artifacts,
  logger,
  ...options
}) {
  let result = null;

  for (let attempt = 1; attempt <= fallbackRetries + 1; attempt += 1) {
    result = await runCommand({ ...options, logger });

    if (result.status !== "ok" && result.status !== "skipped") {
      if (attempt <= fallbackRetries) {
        const delay =
          parseRetryDelayMsFromText(result.outputTail || result.errorMessage) ??
          fallbackBackoffMs * Math.pow(2, attempt - 1);
        logger.write(
          `⏳ ${options.label} 실행 실패 — ${Math.ceil(delay / 1000)}초 후 재시도 (${attempt}/${fallbackRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      return result;
    }

    if (result.status === "skipped") {
      return result;
    }

    const meta = await readBriefingMeta(artifacts.finalResearchBriefing);
    if (meta?.source && meta.source !== "fallback") {
      return {
        ...result,
        outputTail: [result.outputTail, `briefing source=${meta.source} / model=${meta.model ?? "-"}`]
          .filter(Boolean)
          .join(" | "),
      };
    }

    if (await promoteArchivedBriefing({ artifacts, logger })) {
      return {
        ...result,
        outputTail: [result.outputTail, `briefing source=archive_promoted`]
          .filter(Boolean)
          .join(" | "),
      };
    }

    if (attempt <= fallbackRetries) {
      const delay =
        parseRetryDelayMsFromText(result.outputTail || result.errorMessage) ??
        fallbackBackoffMs * Math.pow(2, attempt - 1);
      logger.write(
        `⏳ ${options.label} fallback 감지 — ${Math.ceil(delay / 1000)}초 후 재시도 (${attempt}/${fallbackRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    return {
      ...result,
      status: "warn",
      errorMessage: "rich briefing이 fallback으로만 생성되었습니다.",
      outputTail: [result.outputTail, "briefing source=fallback (manual review needed)"]
        .filter(Boolean)
        .join(" | "),
    };
  }

  return result;
}

function reuseArtifactStep({
  id,
  label,
  artifactPath,
  note,
}) {
  const timestamp = new Date().toISOString();
  return {
    id,
    label,
    status: "ok",
    soft: false,
    commandLine: `reuse-existing-artifact ${artifactPath}`,
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    exitCode: 0,
    errorMessage: null,
    outputTail: note ?? `existing artifact reused: ${artifactPath}`,
  };
}

function preflightWarnStep({
  id,
  label,
  reason,
  note,
}) {
  const timestamp = new Date().toISOString();
  return {
    id,
    label,
    status: "warn",
    soft: true,
    commandLine: `preflight-skip ${label}`,
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    exitCode: 1,
    errorMessage: reason,
    outputTail: note ?? "",
  };
}

function buildArtifactMap(date, logFile) {
  const refinementArtifacts = allRefinementArtifactPaths({ date });
  const round2 = refinementArtifacts.find((item) => item.spec.round === 2);
  const round3 = refinementArtifacts.find((item) => item.spec.round === 3);

  return {
    logFile,
    automationReadiness: path.join(ROOT_DIR, "data", "analysis-state", date, "automation-readiness.json"),
    stockeasySnapshot: path.join(ROOT_DIR, "data", "external", "stockeasy", date, "snapshot.json"),
    chunkIndexStats: path.join(ROOT_DIR, "data", "analysis-state", date, "chunk-index", "stats.json"),
    stage1: path.join(ROOT_DIR, "data", "analysis-state", date, "stage1-report-extracts-v2.json"),
    stage1Shadow: path.join(
      ROOT_DIR,
      "data",
      "analysis-state",
      date,
      "stage1-shadow",
      "stage1-shadow-extracts.json",
    ),
    stage2Shadow: path.join(ROOT_DIR, "data", "analysis-state", date, "stage2-shadow-topic-buckets.json"),
    stage3Shadow: path.join(ROOT_DIR, "data", "analysis-state", date, "stage3-shadow-final-insights.json"),
    followUpMap: round2?.mapJson,
    followUpMapMarkdown: round2?.mapMarkdown,
    deepResearchPrompt: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "07-stage1-5-gemini-deep-research-prompt.md",
    ),
    deepResearchResponse: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "09-stage1-5-gemini-deep-research-response.md",
    ),
    deepResearchFollowUpPrompt: round2?.prompt,
    deepResearchFollowUpResponse: round2?.response,
    round3Map: round3?.mapJson,
    round3MapMarkdown: round3?.mapMarkdown,
    round3Prompt: round3?.prompt,
    round3Response: round3?.response,
    finalResearchBriefing: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      `${date}-gemini-briefing-rich.md`,
    ),
    finalResearchBriefingArchive: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "10-stage1-6-final-research-briefing.md",
    ),
    stage2: path.join(ROOT_DIR, "data", "analysis-state", date, "stage2-strategy-options.json"),
    stage4: path.join(ROOT_DIR, "data", "analysis-state", date, "stage4-execution-plan.json"),
    dailyBriefing: path.join(ROOT_DIR, "reports", "daily", `${date}-briefing.md`),
    wikiDaily: path.join(ROOT_DIR, "knowledge", "wiki", "daily", `${date}.md`),
    wikiOperatingRules: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "operating-rules.md"),
    wikiResearchBacklog: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "research-backlog.md"),
    wikiDecisionJournal: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "decision-journal.md"),
    systemHealth: path.join(ROOT_DIR, "data", "analysis-state", date, "system-health.json"),
    automationJson: path.join(ROOT_DIR, "data", "analysis-state", date, "automation-cycle.json"),
    automationMarkdown: path.join(ROOT_DIR, "knowledge", "daily", `${date}-automation-cycle.md`),
  };
}

async function buildArtifactStatus(artifacts) {
  const entries = await Promise.all(
    Object.entries(artifacts).map(async ([key, filePath]) => ({
      key,
      path: filePath,
      exists: filePath ? await fileExists(filePath) : false,
    })),
  );

  return Object.fromEntries(
    entries.map((entry) => [entry.key, { path: entry.path, exists: entry.exists }]),
  );
}

function formatPctChange(value) {
  if (value == null || Number.isNaN(value)) return null;
  const signed = value >= 0 ? "+" : "";
  return `${signed}${(value * 100).toFixed(2)}%`;
}

function formatArrowChange(previous, current, formatter = (value) => String(value)) {
  if (previous == null || current == null) return null;
  return `${formatter(previous)}→${formatter(current)}`;
}

function flattenUniqueStagedBuys(stage4) {
  const totals = new Map();

  for (const accountPlan of stage4?.accountPlans ?? []) {
    for (const buy of accountPlan?.stagedBuys ?? []) {
      const name = buy?.name?.trim() || buy?.code?.trim();
      if (!name) continue;
      const amount = Number(buy?.suggestedAmount ?? 0) || 0;
      totals.set(name, (totals.get(name) ?? 0) + amount);
    }
  }

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))
    .map(([name, amount]) => ({ name, amount }));
}

function formatFocusList(items, limit = 2) {
  return items
    .slice(0, limit)
    .map((item) => item.name)
    .join("·");
}

async function readReportCount(indexPath) {
  const payload = await readJson(indexPath, null);
  return Array.isArray(payload) ? payload.length : null;
}

async function findPreviousSummaryDate(date, maxLookbackDays = 14) {
  let cursor = previousDate(date);

  for (let index = 0; index < maxLookbackDays; index += 1) {
    if (!isTradingDay(cursor)) {
      cursor = previousDate(cursor);
      continue;
    }

    const stage4Path = path.join(ROOT_DIR, "data", "analysis-state", cursor, "stage4-execution-plan.json");
    const marketPath = path.join(ROOT_DIR, "data", "market", `${cursor}.json`);
    const reportsPath = path.join(ROOT_DIR, "data", "reports", cursor, "index.json");
    if (await fileExists(stage4Path) || await fileExists(marketPath) || await fileExists(reportsPath)) {
      return cursor;
    }

    cursor = previousDate(cursor);
  }

  return null;
}

async function buildPreviousDayChangeSummary(date) {
  const previousTradingDate = await findPreviousSummaryDate(date);
  if (!previousTradingDate) {
    return {
      previousTradingDate: null,
      line: null,
    };
  }

  const [
    currentStage4,
    previousStage4,
    currentMarket,
    previousMarket,
    currentReportCount,
    previousReportCount,
  ] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage4-execution-plan.json"), null),
    readJson(path.join(ROOT_DIR, "data", "analysis-state", previousTradingDate, "stage4-execution-plan.json"), null),
    readJson(path.join(ROOT_DIR, "data", "market", `${date}.json`), null),
    readJson(path.join(ROOT_DIR, "data", "market", `${previousTradingDate}.json`), null),
    readReportCount(path.join(ROOT_DIR, "data", "reports", date, "index.json")),
    readReportCount(path.join(ROOT_DIR, "data", "reports", previousTradingDate, "index.json")),
  ]);

  const parts = [`전일(${previousTradingDate}) 대비`];

  const currentKospi = currentMarket?.indices?.KOSPI ?? null;
  const previousKospi = previousMarket?.indices?.KOSPI ?? null;
  if (currentKospi?.close != null && previousKospi?.close != null && previousKospi.close !== 0) {
    const delta = (currentKospi.close - previousKospi.close) / previousKospi.close;
    parts.push(`KOSPI ${formatPctChange(delta)}`);
  }

  const scoreChange = formatArrowChange(previousStage4?.portfolioScore, currentStage4?.portfolioScore);
  if (scoreChange) {
    parts.push(`포트폴리오 점수 ${scoreChange}`);
  }

  const previousRegime = previousStage4?.regime?.name ?? null;
  const currentRegime = currentStage4?.regime?.name ?? null;
  if (previousRegime && currentRegime && previousRegime !== currentRegime) {
    parts.push(`레짐 ${previousRegime}→${currentRegime}`);
  } else if (currentRegime) {
    parts.push(`레짐 ${currentRegime} 유지`);
  }

  const reportCountChange = formatArrowChange(previousReportCount, currentReportCount);
  if (reportCountChange) {
    parts.push(`리포트 ${reportCountChange}건`);
  }

  const currentFocus = flattenUniqueStagedBuys(currentStage4);
  const previousFocus = flattenUniqueStagedBuys(previousStage4);
  const previousNames = new Set(previousFocus.map((item) => item.name));
  const currentNames = new Set(currentFocus.map((item) => item.name));
  const addedFocus = currentFocus.filter((item) => !previousNames.has(item.name));
  const removedFocus = previousFocus.filter((item) => !currentNames.has(item.name));

  if (addedFocus.length > 0) {
    parts.push(`신규 포커스 ${formatFocusList(addedFocus)}`);
  }
  if (removedFocus.length > 0) {
    parts.push(`제외 ${formatFocusList(removedFocus)}`);
  }

  return {
    previousTradingDate,
    line: parts.length > 1 ? parts.join(", ") : null,
  };
}

async function writeSummary({
  summaryPathJson,
  summaryPathMarkdown,
  summary,
}) {
  await writeJson(summaryPathJson, summary);

  const failedSteps = summary.steps.filter((step) => step.status === "error" || step.status === "warn");
  const artifactLines = Object.values(summary.artifacts).map(
    (artifact) => `- [${artifact.exists ? "OK" : "MISS"}] ${artifact.path}`,
  );
  const stepLines = summary.steps.map((step) => {
    const lines = [
      `- [${step.status.toUpperCase()}] ${step.label} (${formatDuration(step.durationMs)})`,
      `  - command: ${step.commandLine}`,
    ];
    if (step.errorMessage) {
      lines.push(`  - reason: ${step.errorMessage}`);
    }
    if (step.outputTail) {
      lines.push(`  - tail: ${step.outputTail.replace(/\n/g, " | ")}`);
    }
    if (step.debugHint) {
      lines.push(`  - debug: ${step.debugHint}`);
    }
    return lines.join("\n");
  });

  const markdown = [
    `# EcoReport Automation Cycle (${summary.date})`,
    "",
    `- overallStatus: **${summary.overallStatus}**`,
    summary.sameDayStatus ? `- sameDayStatus: **${summary.sameDayStatus}**` : null,
    `- runDate: ${summary.runDate}`,
    `- effectiveMarketDate: ${summary.effectiveMarketDate}`,
    summary.previousTradingDate ? `- previousTradingDate: ${summary.previousTradingDate}` : null,
    `- runId: ${summary.runId ?? "N/A"}`,
    `- resolutionReason: ${summary.resolutionReason}`,
    `- generatedAt: ${summary.generatedAt}`,
    `- logFile: ${summary.logFile}`,
    summary.systemHealthOverall ? `- systemHealth: ${summary.systemHealthOverall}` : null,
    summary.changeSummary ? `- changeSummary: ${summary.changeSummary}` : null,
    "",
    "## Completion Checklist",
    ...summary.steps.map(
      (step) =>
        `- [${checklistMark(step.status)}] ${step.label}${step.status !== "ok" ? ` (${step.status})` : ""}`,
    ),
    "",
    "## Step Results",
    ...stepLines,
    "",
    "## Failed Or Warned Steps",
    ...(failedSteps.length > 0
      ? failedSteps.map((step) => `- ${step.label}: ${step.errorMessage ?? "추가 로그 확인"}`)
      : ["- 없음"]),
    "",
    "## Artifacts",
    ...artifactLines,
  ]
    .filter(Boolean)
    .join("\n");

  await writeText(summaryPathMarkdown, `${markdown}\n`);
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const resolved = resolveTradingDateContext({
    requestedDate: cli.date,
    runDate: cli.runDate,
  });

  const date = resolved.effectiveMarketDate;
  const runDate = resolved.runDate;
  const runId =
    cli.runId ||
    process.env.ECOREPORT_RUN_ID ||
    `${runDate}-${createGeneratedAt().slice(11, 19).replace(/:/g, "")}`;
  process.env.ECOREPORT_RUN_ID = runId;
  const timeLabel = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const logFile = path.join(ROOT_DIR, "logs", `${date}-${timeLabel}-automation-cycle.log`);
  const logger = createLogger(logFile);
  const artifacts = buildArtifactMap(date, logFile);

  logger.write("==================================================");
  logger.write(`🤖 EcoReport Automation Cycle 시작 (run: ${runDate} / effective: ${date})`);
  logger.write(`🧬 run-id: ${runId}`);
  logger.write(`🗓️ 날짜 해석 사유: ${resolved.reason}`);
  logger.write(`📁 로그: ${logFile}`);
  logger.write("==================================================");

  const nodeModulesOk = await fileExists(path.join(ROOT_DIR, "node_modules", ".package-lock.json"));
  if (!nodeModulesOk) {
    logger.write("⚠️ node_modules 없음 — npm install 실행");
    await runCommand({
      id: "preflight_npm_install",
      label: "Preflight npm install",
      command: "npm",
      args: ["install", "--prefer-offline"],
      logger,
      soft: false,
      timeoutMs: 120_000,
    });
  }

  const venvOk = await fileExists(path.join(ROOT_DIR, ".venv", "bin", "python"));
  if (!venvOk) {
    logger.write("⚠️ .venv 없음 — 자동 생성");
    await runCommand({
      id: "preflight_venv",
      label: "Preflight venv create",
      command: "bash",
      args: [
        "-c",
        `python3 -m venv "${path.join(ROOT_DIR, ".venv")}" && "${path.join(ROOT_DIR, ".venv", "bin", "pip")}" install -q -r requirements.txt 2>/dev/null || true`,
      ],
      logger,
      soft: true,
      timeoutMs: 60_000,
    });
  }

  for (const dir of [`data/analysis-state/${date}`, `data/reports/${date}`, "data/market", "logs"]) {
    fs.mkdirSync(path.join(ROOT_DIR, dir), { recursive: true });
  }

  const checkpointPath = path.join(ROOT_DIR, "data", "analysis-state", date, "automation-checkpoint.json");
  if (cli.freshStart) {
    await fs.promises.rm(checkpointPath, { force: true });
    logger.write("🧹 fresh-start 요청 감지 — 기존 체크포인트를 무시하고 처음부터 실행");
  }
  const checkpoint = cli.freshStart
    ? { completedSteps: [] }
    : await readJson(checkpointPath, { completedSteps: [] });
  const completedSteps = new Set(checkpoint?.completedSteps ?? []);
  if (completedSteps.size > 0) {
    logger.write(`♻️ 체크포인트 감지 — ${completedSteps.size}개 스텝 완료 상태에서 재개`);
  }

  function isCheckpointed(stepId) {
    return completedSteps.has(stepId);
  }

  async function saveCheckpoint(stepId) {
    completedSteps.add(stepId);
    await writeJson(checkpointPath, {
      completedSteps: [...completedSteps],
      lastUpdated: new Date().toISOString(),
    });
  }

  const baselineArgs = [
    "scripts/run-daily-system.sh",
    "--date",
    date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
      "--gemini-stage2",
      "--skip-push",
      "--skip-verify",
    "--skip-strategy",
    "--skip-wiki",
    "--no-gemini-briefing",
  ];
  if (cli.forceCollect) {
    baselineArgs.push("--force-collect");
  }

  const steps = [];

  const readinessStep = await runCommand({
    id: "automation_readiness",
    label: "Automation Environment Readiness",
    command: "node",
    args: [
      "scripts/check-automation-readiness.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    soft: true,
    timeoutMs: 60_000,
    skip: isCheckpointed("automation_readiness"),
  });
  const readinessReport = await readJson(artifacts.automationReadiness, null);
  const readinessWarnings = readinessReport?.checks?.filter((item) => item.status !== "ok") ?? [];
  const readinessSummary = readinessWarnings.map((item) => `${item.label}: ${item.detail}`).join(" | ");
  if (readinessStep.status === "ok" && readinessWarnings.length > 0) {
    readinessStep.status = "warn";
    readinessStep.errorMessage = `자동화 환경 경고 ${readinessWarnings.length}건`;
    readinessStep.outputTail = readinessSummary || readinessStep.outputTail;
  }
  if (readinessStep.status === "ok") {
    await saveCheckpoint("automation_readiness");
  }
  steps.push({
    ...readinessStep,
    debugHint:
      readinessStep.status === "ok" || readinessStep.status === "skipped"
        ? null
        : buildFailureHint(readinessStep.id),
  });

  const stockeasyCapture =
    readinessReport?.blockers?.stockeasyCaptureReady === false
      ? preflightWarnStep({
          id: "stockeasy_capture",
          label: "StockEasy Market Capture",
          reason: "StockEasy capture 사전 차단 (StockEasy smoke test failed)",
          note: readinessReport.checks.find((item) => item.key === "stockeasy_capture_smoke")?.detail,
        })
      : await runCommand({
          id: "stockeasy_capture",
          label: "StockEasy Market Capture",
          command: "npm",
          args: ["run", "external:stockeasy:capture", "--", "--date", date],
          logger,
          soft: true,
          timeoutMs: 90_000,
        });
  steps.push({
    ...stockeasyCapture,
    debugHint:
      stockeasyCapture.status === "ok" || stockeasyCapture.status === "skipped"
        ? null
        : buildFailureHint(stockeasyCapture.id),
  });

  const baseline = readinessReport?.blockers?.reportCollectionReady === false
    ? {
        ...preflightWarnStep({
          id: "baseline_daily_system",
          label: "Baseline Daily System",
          reason: "리포트 수집 네트워크와 이전 거래일 fallback이 모두 unavailable 상태라 baseline 실행을 중단합니다.",
          note: readinessReport.checks
            .filter((item) =>
              item.key === "naver_research_network" ||
              item.key === "shinhan_research_network" ||
              item.key === "report_fallback_assets",
            )
            .map((item) => `${item.label}: ${item.detail}`)
            .join(" | "),
        }),
        status: "error",
        soft: false,
      }
    : isCheckpointed("baseline_daily_system")
    ? reuseArtifactStep({
        id: "baseline_daily_system",
        label: "Baseline Daily System",
        artifactPath: "checkpoint",
        note: "체크포인트에서 재개 — 이전 실행에서 완료됨",
      })
    : await runCommandWithRetry({
        id: "baseline_daily_system",
        label: "Baseline Daily System",
        command: "bash",
        args: baselineArgs,
        logger,
        soft: false,
        timeoutMs: 600_000,
        retries: 1,
        backoffMs: 10_000,
      });
  if (baseline.status === "ok") {
    await saveCheckpoint("baseline_daily_system");
  }
  steps.push({ ...baseline, debugHint: baseline.status === "ok" ? null : buildFailureHint(baseline.id) });

  const stage1Extracts = isCheckpointed("stage1_extracts")
    ? reuseArtifactStep({
        id: "stage1_extracts",
        label: "Stage 1 Extracts",
        artifactPath: artifacts.stage1,
        note: "체크포인트에서 재개",
      })
    : await runCommandWithRetry({
        id: "stage1_extracts",
        label: "Stage 1 Extracts",
        command: "node",
        args: [
          "scripts/build-stage1-report-extracts.js",
          "--date",
          date,
          "--run-date",
          runDate,
          "--effective-market-date",
          date,
          "--run-id",
          runId,
        ],
        logger,
        soft: false,
        skip: baseline.status !== "ok",
        timeoutMs: 300_000,
        retries: 1,
        backoffMs: 5_000,
      });
  if (stage1Extracts.status === "ok") {
    await saveCheckpoint("stage1_extracts");
  }
  steps.push({
    ...stage1Extracts,
    debugHint:
      stage1Extracts.status === "ok" || stage1Extracts.status === "skipped"
        ? null
        : buildFailureHint(stage1Extracts.id),
  });

  const existingDeepResearch = !cli.freshStart && await fileExists(artifacts.deepResearchResponse);
  const deepResearch =
    baseline.status === "ok" &&
    stage1Extracts.status === "ok" &&
    existingDeepResearch
      ? reuseArtifactStep({
          id: "deep_research_web",
          label: "Gemini Deep Research Web",
          artifactPath: artifacts.deepResearchResponse,
          note: `same-day Deep Research 응답 재사용: ${artifacts.deepResearchResponse}`,
        })
      : readinessReport?.blockers?.safariAutomationAvailable === false
        ? preflightWarnStep({
            id: "deep_research_web",
            label: "Gemini Deep Research Web",
            reason: "Gemini Deep Research Web 사전 차단 (Safari 자동화 unavailable)",
            note: readinessReport.checks.find((item) => item.key === "safari_automation")?.detail,
          })
      : await runCommand({
          id: "deep_research_web",
          label: "Gemini Deep Research Web",
          command: "npm",
          args: [
            "run",
            "stage1.5:gemini:run",
            "--",
            "--date",
            date,
            "--poll-sec",
            String(cli.pollSec),
            "--timeout-sec",
            String(cli.timeoutSec),
            ...(cli.reuseFrontDocument ? ["--reuse-front-document"] : []),
          ],
          logger,
          soft: true,
          skip: baseline.status !== "ok" || stage1Extracts.status !== "ok",
        });
  steps.push({ ...deepResearch, debugHint: deepResearch.status === "ok" ? null : deepResearch.status === "skipped" ? null : buildFailureHint(deepResearch.id) });

  const richBriefing = await runRichBriefingStep({
    id: "rich_briefing_overlay",
    label: "Stage 1.6 Rich Briefing Overlay",
    command: "npm",
    args: [
      "run",
      "stage1.6:briefing",
      "--",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    artifacts,
    soft: true,
    skip: stage1Extracts.status !== "ok",
    timeoutMs: 600_000,
    fallbackRetries: 4,
    fallbackBackoffMs: 30_000,
  });
  steps.push({ ...richBriefing, debugHint: richBriefing.status === "ok" ? null : richBriefing.status === "skipped" ? null : buildFailureHint(richBriefing.id) });

  const strategyRefresh = await runCommandWithRetry({
    id: "strategy_refresh",
    label: "Strategy Refresh After Deep Research",
    command: "bash",
    args: [
      "scripts/run-strategy-pipeline.sh",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
      "--gemini-stage2",
    ],
    logger,
    soft: true,
    skip: stage1Extracts.status !== "ok",
    timeoutMs: 300_000,
    retries: 1,
    backoffMs: 10_000,
  });
  steps.push({ ...strategyRefresh, debugHint: strategyRefresh.status === "ok" ? null : strategyRefresh.status === "skipped" ? null : buildFailureHint(strategyRefresh.id) });

  const wikiRebuildInitial = await runCommandWithRetry({
    id: "wiki_rebuild_initial",
    label: "LLM Wiki Rebuild After First Synthesis",
    command: "node",
    args: [
      "scripts/build-llm-wiki.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    soft: true,
    skip: strategyRefresh.status !== "ok",
    timeoutMs: 120_000,
    retries: 1,
    backoffMs: 5_000,
  });
  steps.push({ ...wikiRebuildInitial, debugHint: wikiRebuildInitial.status === "ok" ? null : wikiRebuildInitial.status === "skipped" ? null : buildFailureHint(wikiRebuildInitial.id) });

  const followUpReindex = await runCommand({
    id: "followup_reindex",
    label: "Stage 1.7 Follow-up Research Map",
    command: "node",
    args: [
      "scripts/build-stage1-7-followup-research-map.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    soft: true,
    skip: strategyRefresh.status !== "ok",
  });
  steps.push({ ...followUpReindex, debugHint: followUpReindex.status === "ok" ? null : followUpReindex.status === "skipped" ? null : buildFailureHint(followUpReindex.id) });

  const followUpPrompt = await runCommand({
    id: "followup_prompt",
    label: "Stage 1.7 Gemini Follow-up Prompt",
    command: "node",
    args: [
      "scripts/build-stage1-7-gemini-follow-up-prompt.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    soft: true,
    skip: followUpReindex.status !== "ok",
  });
  steps.push({ ...followUpPrompt, debugHint: followUpPrompt.status === "ok" ? null : followUpPrompt.status === "skipped" ? null : buildFailureHint(followUpPrompt.id) });

  const existingFollowUpDeepResearch = await fileExists(artifacts.deepResearchFollowUpResponse);
  const deepResearchFollowUp =
    followUpPrompt.status === "ok" &&
    existingFollowUpDeepResearch
      ? reuseArtifactStep({
          id: "deep_research_follow_up_web",
          label: "Gemini Deep Research Follow-up Web",
          artifactPath: artifacts.deepResearchFollowUpResponse,
          note: `same-day Deep Research follow-up 응답 재사용: ${artifacts.deepResearchFollowUpResponse}`,
        })
      : readinessReport?.blockers?.safariAutomationAvailable === false
        ? preflightWarnStep({
            id: "deep_research_follow_up_web",
            label: "Gemini Deep Research Follow-up Web",
            reason: "Gemini Deep Research Follow-up Web 사전 차단 (Safari 자동화 unavailable)",
            note: readinessReport.checks.find((item) => item.key === "safari_automation")?.detail,
          })
      : await runCommand({
          id: "deep_research_follow_up_web",
          label: "Gemini Deep Research Follow-up Web",
          command: "node",
          args: [
            "scripts/run-gemini-deep-research-web.js",
            "--date",
            date,
            "--prompt",
            artifacts.deepResearchFollowUpPrompt,
            "--output",
            artifacts.deepResearchFollowUpResponse,
            "--poll-sec",
            String(cli.pollSec),
            "--timeout-sec",
            String(cli.timeoutSec),
            ...(cli.reuseFrontDocument ? ["--reuse-front-document"] : []),
          ],
          logger,
          soft: true,
          skip: followUpPrompt.status !== "ok",
        });
  steps.push({ ...deepResearchFollowUp, debugHint: deepResearchFollowUp.status === "ok" ? null : deepResearchFollowUp.status === "skipped" ? null : buildFailureHint(deepResearchFollowUp.id) });

  const richBriefingFinal = await runRichBriefingStep({
    id: "rich_briefing_final",
    label: "Stage 1.6 Rich Briefing Final",
    command: "npm",
    args: [
      "run",
      "stage1.6:briefing",
      "--",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    artifacts,
    soft: true,
    skip: followUpReindex.status !== "ok",
    timeoutMs: 600_000,
    fallbackRetries: 4,
    fallbackBackoffMs: 30_000,
  });
  steps.push({ ...richBriefingFinal, debugHint: richBriefingFinal.status === "ok" ? null : richBriefingFinal.status === "skipped" ? null : buildFailureHint(richBriefingFinal.id) });

  const strategyRefreshFinal = await runCommandWithRetry({
    id: "strategy_refresh_final",
    label: "Strategy Refresh After Follow-up Research",
    command: "bash",
    args: [
      "scripts/run-strategy-pipeline.sh",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
      "--gemini-stage2",
    ],
    logger,
    soft: true,
    skip: followUpReindex.status !== "ok",
    timeoutMs: 300_000,
    retries: 1,
    backoffMs: 10_000,
  });
  steps.push({ ...strategyRefreshFinal, debugHint: strategyRefreshFinal.status === "ok" ? null : strategyRefreshFinal.status === "skipped" ? null : buildFailureHint(strategyRefreshFinal.id) });

  const wikiRebuildMid = await runCommandWithRetry({
    id: "wiki_rebuild_mid",
    label: "LLM Wiki Rebuild After Round 2",
    command: "node",
    args: [
      "scripts/build-llm-wiki.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    soft: true,
    skip: strategyRefreshFinal.status !== "ok",
    timeoutMs: 120_000,
    retries: 1,
    backoffMs: 5_000,
  });
  steps.push({ ...wikiRebuildMid, debugHint: wikiRebuildMid.status === "ok" ? null : wikiRebuildMid.status === "skipped" ? null : buildFailureHint(wikiRebuildMid.id) });

  const round3Reindex = await runCommand({
    id: "round3_reindex",
    label: "Stage 1.8 Final Refinement Map",
    command: "node",
    args: [
      "scripts/build-stage1-7-followup-research-map.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
      "--round",
      "3",
    ],
    logger,
    soft: true,
    skip: strategyRefreshFinal.status !== "ok",
  });
  steps.push({ ...round3Reindex, debugHint: round3Reindex.status === "ok" ? null : round3Reindex.status === "skipped" ? null : buildFailureHint(round3Reindex.id) });

  const round3Prompt = await runCommand({
    id: "round3_prompt",
    label: "Stage 1.8 Gemini Final Refinement Prompt",
    command: "node",
    args: [
      "scripts/build-stage1-7-gemini-follow-up-prompt.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
      "--round",
      "3",
    ],
    logger,
    soft: true,
    skip: round3Reindex.status !== "ok",
  });
  steps.push({ ...round3Prompt, debugHint: round3Prompt.status === "ok" ? null : round3Prompt.status === "skipped" ? null : buildFailureHint(round3Prompt.id) });

  const existingRound3DeepResearch = artifacts.round3Response
    ? await fileExists(artifacts.round3Response)
    : false;
  const deepResearchRound3 =
    round3Prompt.status === "ok" &&
    existingRound3DeepResearch
      ? reuseArtifactStep({
          id: "deep_research_round3_web",
          label: "Gemini Deep Research Round 3 Web",
          artifactPath: artifacts.round3Response,
          note: `same-day Deep Research round3 응답 재사용: ${artifacts.round3Response}`,
        })
      : readinessReport?.blockers?.safariAutomationAvailable === false
        ? preflightWarnStep({
            id: "deep_research_round3_web",
            label: "Gemini Deep Research Round 3 Web",
            reason: "Gemini Deep Research Round 3 Web 사전 차단 (Safari 자동화 unavailable)",
            note: readinessReport.checks.find((item) => item.key === "safari_automation")?.detail,
          })
      : await runCommand({
          id: "deep_research_round3_web",
          label: "Gemini Deep Research Round 3 Web",
          command: "node",
          args: [
            "scripts/run-gemini-deep-research-web.js",
            "--date",
            date,
            "--prompt",
            artifacts.round3Prompt,
            "--output",
            artifacts.round3Response,
            "--poll-sec",
            String(cli.pollSec),
            "--timeout-sec",
            String(cli.timeoutSec),
            ...(cli.reuseFrontDocument ? ["--reuse-front-document"] : []),
          ],
          logger,
          soft: true,
          skip: round3Prompt.status !== "ok" || !artifacts.round3Prompt || !artifacts.round3Response,
        });
  steps.push({ ...deepResearchRound3, debugHint: deepResearchRound3.status === "ok" ? null : deepResearchRound3.status === "skipped" ? null : buildFailureHint(deepResearchRound3.id) });

  const richBriefingRound3Final = await runRichBriefingStep({
    id: "rich_briefing_round3_final",
    label: "Stage 1.6 Rich Briefing Final After Round 3",
    command: "npm",
    args: [
      "run",
      "stage1.6:briefing",
      "--",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    artifacts,
    soft: true,
    skip: round3Reindex.status !== "ok",
    timeoutMs: 600_000,
    fallbackRetries: 4,
    fallbackBackoffMs: 30_000,
  });
  steps.push({ ...richBriefingRound3Final, debugHint: richBriefingRound3Final.status === "ok" ? null : richBriefingRound3Final.status === "skipped" ? null : buildFailureHint(richBriefingRound3Final.id) });

  const strategyRefreshRound3Final = await runCommand({
    id: "strategy_refresh_round3_final",
    label: "Strategy Refresh After Round 3",
    command: "bash",
    args: [
      "scripts/run-strategy-pipeline.sh",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
      "--gemini-stage2",
    ],
    logger,
    soft: true,
    skip: round3Reindex.status !== "ok",
  });
  steps.push({ ...strategyRefreshRound3Final, debugHint: strategyRefreshRound3Final.status === "ok" ? null : strategyRefreshRound3Final.status === "skipped" ? null : buildFailureHint(strategyRefreshRound3Final.id) });

  const strategyReadyForFinalWiki =
    strategyRefreshRound3Final.status === "ok" ||
    strategyRefreshFinal.status === "ok" ||
    strategyRefresh.status === "ok";

  const wikiRebuildFinal = await runCommand({
    id: "wiki_rebuild_final",
    label: "LLM Wiki Rebuild Final",
    command: "node",
    args: [
      "scripts/build-llm-wiki.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    soft: true,
    skip: !strategyReadyForFinalWiki,
  });
  steps.push({ ...wikiRebuildFinal, debugHint: wikiRebuildFinal.status === "ok" ? null : wikiRebuildFinal.status === "skipped" ? null : buildFailureHint(wikiRebuildFinal.id) });

  const wikiPublish =
    readinessReport?.blockers?.obsidianPublishReady === false
      ? preflightWarnStep({
          id: "wiki_publish",
          label: "LLM Wiki Publish",
          reason: "LLM Wiki Publish 사전 차단 (vault write unavailable)",
          note: readinessReport.checks.find((item) => item.key === "obsidian_publish")?.detail,
        })
      : await runCommand({
          id: "wiki_publish",
          label: "LLM Wiki Publish",
          command: "node",
          args: ["scripts/publish-llm-wiki-to-vault.js"],
          logger,
          soft: true,
          skip: wikiRebuildFinal.status !== "ok",
        });
  steps.push({ ...wikiPublish, debugHint: wikiPublish.status === "ok" ? null : wikiPublish.status === "skipped" ? null : buildFailureHint(wikiPublish.id) });

  const verify = await runCommand({
    id: "verify_outputs",
    label: "Verify Outputs",
    command: "node",
    args: [
      "scripts/verify-daily-system.js",
      "--date",
      date,
      "--run-date",
      runDate,
      "--effective-market-date",
      date,
      "--run-id",
      runId,
    ],
    logger,
    soft: true,
    skip: false,
  });
  steps.push({ ...verify, debugHint: verify.status === "ok" ? null : buildFailureHint(verify.id) });

  const systemHealth = await readJson(artifacts.systemHealth, null);
  const artifactStatus = await buildArtifactStatus(artifacts);
  const changeSummary = await buildPreviousDayChangeSummary(date);

  const overallStatus = computeOverallStatus(steps);

  const summary = {
    date,
    runDate,
    effectiveMarketDate: date,
    runId,
    resolutionReason: resolved.reason,
    generatedAt: new Date().toISOString(),
    overallStatus,
    sameDayStatus: buildSameDayStatus(steps, artifactStatus),
    logFile,
    systemHealthOverall: systemHealth?.overallStatus ?? null,
    previousTradingDate: changeSummary.previousTradingDate,
    changeSummary: changeSummary.line,
    steps,
    artifacts: artifactStatus,
  };

  await writeSummary({
    summaryPathJson: artifacts.automationJson,
    summaryPathMarkdown: artifacts.automationMarkdown,
    summary,
  });
  summary.artifacts = await buildArtifactStatus(artifacts);
  await writeSummary({
    summaryPathJson: artifacts.automationJson,
    summaryPathMarkdown: artifacts.automationMarkdown,
    summary,
  });

  if (!cli.skipPush) {
    const push =
      readinessReport?.blockers?.githubPushReady === false
        ? preflightWarnStep({
            id: "push_data_branch",
            label: "Push Data Branch",
            reason: "Push Data Branch 사전 차단 (GitHub network unavailable)",
            note: readinessReport.checks.find((item) => item.key === "github_network")?.detail,
          })
        : await runCommand({
            id: "push_data_branch",
            label: "Push Data Branch",
            command: "bash",
            args: ["scripts/push-to-github.sh", date],
            logger,
            soft: true,
            skip: false,
          });
    steps.push({ ...push, debugHint: push.status === "ok" ? null : buildFailureHint(push.id) });
    summary.generatedAt = new Date().toISOString();
    summary.overallStatus = computeOverallStatus(steps);
    summary.steps = steps;
    summary.artifacts = await buildArtifactStatus(artifacts);
    summary.sameDayStatus = buildSameDayStatus(summary.steps, summary.artifacts);
    await writeSummary({
      summaryPathJson: artifacts.automationJson,
      summaryPathMarkdown: artifacts.automationMarkdown,
      summary,
    });
  }

  logger.write("==================================================");
  logger.write(`🏁 EcoReport Automation Cycle 종료 (${summary.overallStatus.toUpperCase()})`);
  if (summary.changeSummary) {
    logger.write(`↔ 전일 대비: ${summary.changeSummary}`);
  }
  logger.write(`🧾 요약 JSON: ${artifacts.automationJson}`);
  logger.write(`🧾 요약 MD: ${artifacts.automationMarkdown}`);
  logger.write("==================================================");
  logger.close();

  if (summary.overallStatus === "error") {
    process.exit(1);
  }
}

main().catch(async (error) => {
  const fallbackDate = resolveTradingDateContext({}).effectiveMarketDate;
  const fallbackJson = path.join(ROOT_DIR, "data", "analysis-state", fallbackDate, "automation-cycle.json");
  const fallbackMd = path.join(ROOT_DIR, "knowledge", "daily", `${fallbackDate}-automation-cycle.md`);
  const summary = {
    date: fallbackDate,
    runDate: resolveTradingDateContext({}).runDate,
    effectiveMarketDate: fallbackDate,
    resolutionReason: "exception",
    generatedAt: new Date().toISOString(),
    overallStatus: "error",
    logFile: null,
    systemHealthOverall: null,
    steps: [],
    artifacts: {},
    fatalError: error.message,
  };
  await writeJson(fallbackJson, summary);
  await writeText(
    fallbackMd,
    `# EcoReport Automation Cycle (${fallbackDate})\n\n- overallStatus: **error**\n- fatalError: ${error.message}\n`,
  );
  console.error(`run-daily-automation-cycle 실패: ${error.message}`);
  process.exit(1);
});
