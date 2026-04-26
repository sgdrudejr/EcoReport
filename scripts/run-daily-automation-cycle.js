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
    tailOnly: false,
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
    } else if (token === "--tail-only") {
      args.tailOnly = true;
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
    case "windows_local_summary":
      return "Windows 로컬 LLM 서버(5070Ti) 상태, Wake-on-LAN, local-report-orchestrator 설정(base_url/model), run_stats 로그를 확인하세요. 이 단계는 권장 경로이며, 실패해도 Stage 3/4 fallback 경로는 계속 진행될 수 있습니다.";
    case "stage1_extracts":
      return "리포트 인덱스, 전문 텍스트, 포트폴리오 스냅샷이 모두 생성됐는지와 Stage 1 추출 로그를 확인하세요.";
    case "stage1_4_summarize":
      return "reports/report_summaries/<date> 산출물, Stage 1 extracts 우선순위 계산, report_id 매칭, stage1-chunk-summaries.json 저장 경로를 확인하세요.";
    case "stage2_enriched_report_index":
      return "stage1-report-extracts-v2.json, reports/report_summaries/<date>, stage1-chunk-summaries.json 조인 상태와 report_id 일치 여부를 확인하세요.";
    case "stage1_4_agenda":
      return "DASHSCOPE_API_KEY(QWEN_API_KEY), stage1-chunk-summaries.json 또는 stage1 extracts 폴백 입력, Qwen JSON 응답 형식을 확인하세요.";
    case "stage1_5_prompt_split":
      return "stage1-research-agenda.json 존재 여부와 07a/07b/07c 파일 생성 권한(knowledge/daily/manual-kit/<date>)을 확인하세요.";
    case "stockeasy_capture":
      return "Safari 로그인 상태, StockEasy 세션 유지 여부, 그리고 시장분석/테마보드 화면이 실제로 열리는지 확인하세요.";
    case "deep_research_web":
      return "Safari가 잠겨 있지 않은지, Gemini 로그인 상태인지, Deep Research 도구가 노출되는지, 그리고 07a/07b/07c(또는 legacy 07) 프롬프트 파일이 준비됐는지 확인하세요.";
    case "rich_briefing_overlay":
      return "09-stage1-5 결과 파일과 GEMINI_API_KEY, 그리고 Stage 1 추출물이 모두 있는지 확인하세요.";
    case "strategy_refresh":
      return "stage2 raw 응답과 종목 alias 매핑, Qwen JSON 응답 형식을 확인하세요.";
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
      return "Stage 2 prompt에 follow-up map/response가 정상 주입됐는지와 Qwen JSON 응답 형식을 확인하세요.";
    case "wiki_publish":
      return "knowledge/wiki 생성 권한과 Obsidian vault 경로를 확인하세요.";
    case "daily_briefing_html":
      return "reports/daily/<date>-briefing.md 파일 존재 여부와 HTML 변환 스크립트 로그를 확인하세요.";
    case "execution_plan_table":
      return "stage4 실행계획 파일 존재 여부와 텔레그램용 표 export 스크립트 로그를 확인하세요.";
    case "stage6_briefing_delta":
      return "knowledge/daily/<date>-gemini-briefing-rich.md 와 직전 거래일 rich briefing 존재 여부를 확인하세요.";
    case "telegram_completion":
      return "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 설정과 Telegram Bot 권한(채팅 참여/전송 권한)을 확인하세요.";
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

function sanitizeCheckpointSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildStepExecutionPolicy(stepId, soft = false) {
  const defaultPolicy = {
    failurePolicy: soft ? "degrade" : "block",
    failureCategory: "generic",
  };

  switch (stepId) {
    case "windows_local_summary":
      return { failurePolicy: "degrade", failureCategory: "windows_local_llm" };
    case "stage1_4_agenda":
      return { failurePolicy: "degrade", failureCategory: "qwen_api" };
    case "rich_briefing_overlay":
    case "rich_briefing_final":
    case "rich_briefing_round3_final":
      return { failurePolicy: "degrade", failureCategory: "qwen_api" };
    case "deep_research_web":
    case "deep_research_follow_up_web":
    case "deep_research_round3_web":
      return { failurePolicy: "degrade", failureCategory: "gemini_web" };
    default:
      return defaultPolicy;
  }
}

function getStepArtifactPaths(stepId, artifacts) {
  switch (stepId) {
    case "automation_readiness":
      return [artifacts.automationReadiness];
    case "stockeasy_capture":
      return [artifacts.stockeasySnapshot];
    case "baseline_daily_system":
      return [artifacts.dailyBriefing, artifacts.systemHealth];
    case "windows_local_summary":
      return [
        artifacts.localSummaryChunkDir,
        artifacts.localSummaryReportDir,
        artifacts.localSummaryRunStats,
        artifacts.localSummaryFinalView,
      ];
    case "stage1_extracts":
      return [artifacts.stage1];
    case "stage1_4_summarize":
      return [artifacts.stage1ChunkSummaries];
    case "stage2_enriched_report_index":
      return [artifacts.stage2EnrichedReportIndex];
    case "stage1_4_agenda":
      return [artifacts.stage1ResearchAgenda];
    case "stage1_5_prompt_split":
      return [
        artifacts.deepResearchPrompt,
        artifacts.deepResearchPromptMacro,
        artifacts.deepResearchPromptSector,
        artifacts.deepResearchPromptNewCandidate,
      ];
    case "deep_research_web":
      return [artifacts.deepResearchResponse];
    case "rich_briefing_overlay":
    case "rich_briefing_final":
    case "rich_briefing_round3_final":
      return [artifacts.finalResearchBriefing, artifacts.finalResearchBriefingArchive];
    case "strategy_refresh":
    case "strategy_refresh_final":
    case "strategy_refresh_round3_final":
      return [artifacts.stage2, artifacts.stage4];
    case "wiki_rebuild_initial":
    case "wiki_rebuild_mid":
    case "wiki_rebuild_final":
    case "wiki_publish":
      return [artifacts.wikiDaily];
    case "followup_reindex":
      return [artifacts.followUpMap, artifacts.followUpMapMarkdown];
    case "followup_prompt":
      return [artifacts.deepResearchFollowUpPrompt];
    case "deep_research_follow_up_web":
      return [artifacts.deepResearchFollowUpResponse];
    case "round3_reindex":
      return [artifacts.round3Map, artifacts.round3MapMarkdown];
    case "round3_prompt":
      return [artifacts.round3Prompt];
    case "deep_research_round3_web":
      return [artifacts.round3Response];
    case "stage6_briefing_delta":
      return [artifacts.briefingDeltaMarkdown, artifacts.briefingDeltaJson];
    case "verify_outputs":
      return [artifacts.systemHealth];
    case "push_data_branch":
      return [artifacts.automationJson];
    case "daily_briefing_html":
      return [artifacts.dailyBriefingHtml];
    case "execution_plan_table":
      return [artifacts.executionPlanTable, artifacts.executionPlanTelegram];
    case "telegram_completion":
      return [artifacts.executionPlanTelegram];
    default:
      return [];
  }
}

function estimateRowCountFromPayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload.length;

  const candidateKeys = [
    "summaries",
    "topics",
    "reports",
    "items",
    "entries",
    "generated_candidates",
    "candidates",
    "accountPlans",
    "plans",
    "checks",
  ];
  for (const key of candidateKeys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key].length;
    }
  }

  if (payload?.stats) {
    const statsKeys = [
      "generatedCount",
      "mergedCandidateCount",
      "selectedReports",
      "selected_reports",
      "reportCount",
      "report_count",
      "topicCount",
      "topic_count",
    ];
    for (const key of statsKeys) {
      const value = payload.stats[key];
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
}

async function estimateRowCountFromArtifact(artifactPath) {
  if (!artifactPath || !(await fileExists(artifactPath))) return null;

  const stats = await fs.promises.stat(artifactPath).catch(() => null);
  if (!stats) return null;

  if (stats.isDirectory()) {
    const entries = await fs.promises.readdir(artifactPath).catch(() => []);
    return entries.length;
  }

  if (artifactPath.endsWith(".json")) {
    const payload = await readJsonIfExists(artifactPath);
    return estimateRowCountFromPayload(payload);
  }

  if (artifactPath.endsWith(".jsonl")) {
    const content = await fs.promises.readFile(artifactPath, "utf8").catch(() => "");
    if (!content.trim()) return 0;
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length;
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
  failurePolicy,
  failureCategory,
}) {
  const executionPolicy = buildStepExecutionPolicy(id, soft);
  const resolvedFailurePolicy = failurePolicy ?? executionPolicy.failurePolicy;
  const resolvedFailureCategory = failureCategory ?? executionPolicy.failureCategory;

  if (skip) {
    return {
      id,
      label,
      status: "skipped",
      soft,
      degraded: false,
      failurePolicy: resolvedFailurePolicy,
      failureCategory: resolvedFailureCategory,
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
        degraded: soft,
        failurePolicy: resolvedFailurePolicy,
        failureCategory: resolvedFailureCategory,
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
        degraded: code === 0 && !timedOut ? false : soft,
        failurePolicy: resolvedFailurePolicy,
        failureCategory: resolvedFailureCategory,
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
      const parsedDelay = parseRetryDelayMsFromText(result.outputTail || result.errorMessage);
      const delay = parsedDelay ?? backoffMs * Math.pow(2, attempt - 1);
      options.logger.write(
        `⏳ ${options.label} 재시도 ${attempt}/${retries} (${Math.round(delay / 1000)}s 후, policy=${result.failurePolicy ?? "unknown"}, category=${result.failureCategory ?? "generic"})`,
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
    localSummaryChunkDir: path.join(ROOT_DIR, "reports", "chunk_summaries", date),
    localSummaryReportDir: path.join(ROOT_DIR, "reports", "report_summaries", date),
    localSummaryRunStats: path.join(ROOT_DIR, "reports", "logs", "run_stats.json"),
    localSummaryFinalView: path.join(ROOT_DIR, "reports", "merged", "final_market_view.json"),
    chunkIndexStats: path.join(ROOT_DIR, "data", "analysis-state", date, "chunk-index", "stats.json"),
    stage1: path.join(ROOT_DIR, "data", "analysis-state", date, "stage1-report-extracts-v2.json"),
    stage1ChunkSummaries: path.join(
      ROOT_DIR,
      "data",
      "analysis-state",
      date,
      "stage1-chunk-summaries.json",
    ),
    stage2EnrichedReportIndex: path.join(
      ROOT_DIR,
      "data",
      "analysis-state",
      date,
      "stage2-enriched-report-index.json",
    ),
    stage1ResearchAgenda: path.join(
      ROOT_DIR,
      "data",
      "analysis-state",
      date,
      "stage1-research-agenda.json",
    ),
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
    deepResearchPromptMacro: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "07a-stage1-5-macro-prompt.md",
    ),
    deepResearchPromptSector: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "07b-stage1-5-sector-prompt.md",
    ),
    deepResearchPromptNewCandidate: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "07c-stage1-5-newcandidate-prompt.md",
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
    briefingDeltaMarkdown: path.join(ROOT_DIR, "knowledge", "daily", `${date}-briefing-delta.md`),
    briefingDeltaJson: path.join(ROOT_DIR, "data", "analysis-state", date, "briefing-delta.json"),
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
    dailyBriefingHtml: path.join(ROOT_DIR, "reports", "daily", `${date}-briefing.html`),
    executionPlanTable: path.join(ROOT_DIR, "reports", "daily", `${date}-stage4-execution-plan-table.md`),
    executionPlanTelegram: path.join(ROOT_DIR, "reports", "daily", `${date}-stage4-execution-plan-telegram.txt`),
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

function buildTelegramCompletionMessage(summary) {
  const degradedCount = summary.steps.filter((step) => step.degraded).length;
  const lines = [
    `EcoReport ${summary.date} 자동화 완료`,
    `- overallStatus: ${summary.overallStatus}`,
    summary.sameDayStatus ? `- sameDayStatus: ${summary.sameDayStatus}` : null,
    summary.systemHealthOverall ? `- systemHealth: ${summary.systemHealthOverall}` : null,
    summary.changeSummary ? `- changeSummary: ${summary.changeSummary}` : null,
    degradedCount > 0 ? `- degradedSteps: ${degradedCount}` : null,
  ].filter(Boolean);

  const failedOrWarned = summary.steps.filter(
    (step) => step.status === "error" || step.status === "warn",
  );

  const checklist = summary.steps
    .map((step) => `- [${step.status.toUpperCase()}] ${step.label}`)
    .slice(0, 20);
  lines.push("- completionChecklist:");
  lines.push(...checklist);

  const failureLines =
    failedOrWarned.length > 0
      ? failedOrWarned
          .slice(0, 6)
          .map((step) => `- ${step.label}: ${step.errorMessage ?? "로그 확인 필요"}`)
      : ["- 없음"];
  lines.push("- failedOrWarned:");
  lines.push(...failureLines);

  const artifact = summary.artifacts ?? {};
  const finalBriefingMdPath = artifact.finalResearchBriefing?.exists
    ? artifact.finalResearchBriefing.path
    : (artifact.dailyBriefing?.path ?? "N/A");
  lines.push("- paths:");
  lines.push(`- finalBriefingMd: ${finalBriefingMdPath}`);
  lines.push(`- finalBriefingHtml: ${artifact.dailyBriefingHtml?.path ?? "N/A"}`);
  lines.push(`- briefingDelta: ${artifact.briefingDeltaMarkdown?.path ?? "N/A"}`);
  lines.push(`- executionPlanTable: ${artifact.executionPlanTable?.path ?? "N/A"}`);
  lines.push(`- wikiDaily: ${artifact.wikiDaily?.path ?? "N/A"}`);
  lines.push(`- automationMd: ${artifact.automationMarkdown?.path ?? "N/A"}`);

  return lines.join("\n");
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
      `  - policy: ${step.failurePolicy ?? (step.soft ? "degrade" : "block")} / category: ${step.failureCategory ?? "generic"}`,
    ];
    if (step.errorMessage) {
      lines.push(`  - reason: ${step.errorMessage}`);
    }
    if (step.degraded) {
      lines.push("  - degraded: true");
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

  await runCommand({
    id: "preflight_bootstrap_runtime",
    label: "Preflight bootstrap runtime",
    command: "node",
    args: ["scripts/bootstrap-automation-runtime.js"],
    logger,
    soft: false,
    timeoutMs: 120_000,
  });

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
  const checkpointDir = path.join(ROOT_DIR, "data", "analysis-state", date, "checkpoints");
  if (cli.freshStart) {
    await fs.promises.rm(checkpointPath, { force: true });
    await fs.promises.rm(checkpointDir, { recursive: true, force: true });
    logger.write("🧹 fresh-start 요청 감지 — 기존 체크포인트를 무시하고 처음부터 실행");
  }
  const legacyCheckpoint = cli.freshStart
    ? { completedSteps: [], steps: {} }
    : await readJson(checkpointPath, { completedSteps: [], steps: {} });
  fs.mkdirSync(checkpointDir, { recursive: true });
  const completedSteps = new Set(legacyCheckpoint?.completedSteps ?? []);
  const checkpointMetaByStep = new Map(Object.entries(legacyCheckpoint?.steps ?? {}));

  if (!cli.freshStart) {
    const checkpointFiles = await fs.promises.readdir(checkpointDir).catch(() => []);
    for (const fileName of checkpointFiles) {
      if (!fileName.endsWith("-complete.json")) continue;
      const filePath = path.join(checkpointDir, fileName);
      const payload = await readJson(filePath, null);
      const stepId = payload?.stepId;
      if (!stepId) continue;
      checkpointMetaByStep.set(stepId, payload);
      if (payload.status && payload.status !== "error") {
        completedSteps.add(stepId);
      }
    }
  }
  if (completedSteps.size > 0) {
    logger.write(`♻️ 체크포인트 감지 — ${completedSteps.size}개 스텝 완료 상태에서 재개`);
  }

  function isCheckpointed(stepId) {
    return completedSteps.has(stepId);
  }

  function checkpointFilePath(stepId) {
    return path.join(checkpointDir, `${sanitizeCheckpointSegment(stepId)}-complete.json`);
  }

  async function inferRowCountForStep(stepId, artifactPaths) {
    const uniquePaths = [...new Set((artifactPaths ?? []).filter(Boolean))];

    if (stepId === "windows_local_summary" && uniquePaths.includes(artifacts.localSummaryRunStats)) {
      const payload = await readJsonIfExists(artifacts.localSummaryRunStats);
      const directCount =
        payload?.report_summary_count ??
        payload?.reportSummaryCount ??
        payload?.stats?.report_summary_count ??
        payload?.stats?.reportSummaryCount ??
        payload?.processed_reports ??
        payload?.processedReportCount;
      if (Number.isFinite(directCount)) {
        return directCount;
      }
    }

    for (const artifactPath of uniquePaths) {
      const count = await estimateRowCountFromArtifact(artifactPath);
      if (count != null) return count;
    }

    return null;
  }

  async function saveCheckpoint(step) {
    const stepId = step.id;
    const artifactPaths = getStepArtifactPaths(stepId, artifacts);
    const existing = checkpointMetaByStep.get(stepId) ?? {};
    const payload = {
      stepId,
      label: step.label,
      status: step.status,
      degraded: step.degraded ?? step.status === "warn",
      failurePolicy: step.failurePolicy ?? (step.soft ? "degrade" : "block"),
      failureCategory: step.failureCategory ?? buildStepExecutionPolicy(stepId, step.soft).failureCategory,
      startedAt: step.startedAt,
      endedAt: step.endedAt,
      durationMs: step.durationMs,
      runId,
      runDate,
      effectiveMarketDate: date,
      completedAt: new Date().toISOString(),
      rowCount: await inferRowCountForStep(stepId, artifactPaths),
      artifacts: artifactPaths.filter(Boolean),
      commandLine: step.commandLine,
      exitCode: step.exitCode,
      errorMessage: step.errorMessage,
      outputTail: step.outputTail,
      debugHint: step.debugHint ?? null,
      previousCheckpoint: existing.completedAt ?? null,
    };
    await writeJson(checkpointFilePath(stepId), payload);
    checkpointMetaByStep.set(stepId, payload);
    if (step.status !== "error") {
      completedSteps.add(stepId);
    }
    await writeJson(checkpointPath, {
      completedSteps: [...completedSteps],
      steps: Object.fromEntries(checkpointMetaByStep.entries()),
      lastUpdated: new Date().toISOString(),
    });
  }

  async function reuseOrWarnStep({
    id,
    label,
    artifactPath,
    successNote,
    warnReason,
    warnNote,
  }) {
    if (artifactPath && (await fileExists(artifactPath))) {
      return {
        ...reuseArtifactStep({
          id,
          label,
          artifactPath,
          note: successNote,
        }),
        debugHint: null,
      };
    }

    return {
      ...preflightWarnStep({
        id,
        label,
        reason: warnReason,
        note: warnNote,
      }),
      debugHint: buildFailureHint(id),
    };
  }

  async function appendStep(step) {
    const executionPolicy = buildStepExecutionPolicy(step.id, step.soft);
    const finalStep = {
      ...step,
      degraded: step.degraded ?? step.status === "warn",
      failurePolicy: step.failurePolicy ?? executionPolicy.failurePolicy,
      failureCategory: step.failureCategory ?? executionPolicy.failureCategory,
      debugHint:
        step.debugHint ??
        (step.status === "ok" || step.status === "skipped" ? null : buildFailureHint(step.id)),
    };
    steps.push(finalStep);
    if (finalStep.status === "ok" || finalStep.status === "warn") {
      await saveCheckpoint(finalStep);
    }
    return finalStep;
  }

  function checkpointResumeStep({
    id,
    label,
    artifactPath,
  }) {
    const checkpointMeta = checkpointMetaByStep.get(id) ?? {};
    const executionPolicy = buildStepExecutionPolicy(id, checkpointMeta.failurePolicy === "degrade");
    const timestamp = new Date().toISOString();
    return {
      id,
      label,
      status: checkpointMeta.status ?? "ok",
      soft: checkpointMeta.failurePolicy === "degrade",
      degraded: checkpointMeta.degraded ?? checkpointMeta.status === "warn",
      failurePolicy: checkpointMeta.failurePolicy ?? executionPolicy.failurePolicy,
      failureCategory: checkpointMeta.failureCategory ?? executionPolicy.failureCategory,
      commandLine: `resume-checkpoint ${artifactPath ?? id}`,
      startedAt: checkpointMeta.startedAt ?? timestamp,
      endedAt: timestamp,
      durationMs: 0,
      exitCode: checkpointMeta.exitCode ?? 0,
      errorMessage: checkpointMeta.errorMessage ?? null,
      outputTail: checkpointMeta.outputTail
        ? `${checkpointMeta.outputTail} | 체크포인트에서 재개`
        : "체크포인트에서 재개",
    };
  }

  async function finalizeFromExistingArtifacts() {
    await appendStep(
      await reuseOrWarnStep({
        id: "baseline_daily_system",
        label: "Baseline Daily System",
        artifactPath: artifacts.dailyBriefing,
        successNote: `기존 산출물 재사용: ${artifacts.dailyBriefing}`,
        warnReason: "기존 baseline briefing 산출물을 찾지 못했습니다.",
        warnNote: artifacts.dailyBriefing,
      }),
    );
    await appendStep(
      await reuseOrWarnStep({
        id: "windows_local_summary",
        label: "Windows Local Report Summary (Preferred)",
        artifactPath: artifacts.localSummaryFinalView,
        successNote: `기존 Windows 로컬 요약 재사용: ${artifacts.localSummaryFinalView}`,
        warnReason: "Windows 로컬 요약 산출물이 없어 tail-only 요약에는 경고로 기록합니다.",
        warnNote: artifacts.localSummaryFinalView,
      }),
    );
    await appendStep(
      await reuseOrWarnStep({
        id: "stage1_extracts",
        label: "Stage 2 Report Extracts",
        artifactPath: artifacts.stage1,
        successNote: `기존 Stage 1 extracts 재사용: ${artifacts.stage1}`,
        warnReason: "Stage 1 extracts 산출물을 찾지 못했습니다.",
        warnNote: artifacts.stage1,
      }),
    );
    await appendStep(
      await reuseOrWarnStep({
        id: "deep_research_follow_up_web",
        label: "Stage 11 Gemini Follow-up Web",
        artifactPath: artifacts.deepResearchFollowUpResponse,
        successNote: `기존 2차 Gemini 응답 재사용: ${artifacts.deepResearchFollowUpResponse}`,
        warnReason: "2차 Gemini follow-up 응답이 없습니다.",
        warnNote: artifacts.deepResearchFollowUpResponse,
      }),
    );
    await appendStep(
      await reuseOrWarnStep({
        id: "deep_research_round3_web",
        label: "Stage 16 Gemini Final Refinement Web",
        artifactPath: artifacts.round3Response,
        successNote: `기존 3차 Gemini 응답 재사용: ${artifacts.round3Response}`,
        warnReason: "3차 Gemini refinement 응답이 없습니다.",
        warnNote: artifacts.round3Response,
      }),
    );
    await appendStep(
      await reuseOrWarnStep({
        id: "rich_briefing_round3_final",
        label: "Stage 17 Rich Briefing Final",
        artifactPath: artifacts.finalResearchBriefing,
        successNote: `기존 최종 rich briefing 재사용: ${artifacts.finalResearchBriefing}`,
        warnReason: "최종 rich briefing 산출물이 없습니다.",
        warnNote: artifacts.finalResearchBriefing,
      }),
    );
    const briefingDelta = await runCommand({
      id: "stage6_briefing_delta",
      label: "Stage 6 Briefing Delta",
      command: "node",
      args: [
        "scripts/build-briefing-delta.js",
        "--date",
        date,
      ],
      logger,
      soft: true,
      skip: !(await fileExists(artifacts.finalResearchBriefing)),
    });
    await appendStep(briefingDelta);
    await appendStep(
      await reuseOrWarnStep({
        id: "strategy_refresh_round3_final",
        label: "Stage 18 Strategy Refresh Final",
        artifactPath: artifacts.stage4,
        successNote: `기존 Stage 4 실행계획 재사용: ${artifacts.stage4}`,
        warnReason: "최종 전략/실행계획 산출물이 없습니다.",
        warnNote: artifacts.stage4,
      }),
    );
    await appendStep(
      await reuseOrWarnStep({
        id: "wiki_rebuild_final",
        label: "LLM Wiki Rebuild Final",
        artifactPath: artifacts.wikiDaily,
        successNote: `기존 일일 위키 재사용: ${artifacts.wikiDaily}`,
        warnReason: "일일 위키 산출물이 없습니다.",
        warnNote: artifacts.wikiDaily,
      }),
    );

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
    await appendStep(verify);

    let systemHealth = await readJson(artifacts.systemHealth, null);
    let artifactStatus = await buildArtifactStatus(artifacts);
    const changeSummary = await buildPreviousDayChangeSummary(date);

    const buildSummary = () => ({
      date,
      runDate,
      effectiveMarketDate: date,
      runId,
      resolutionReason: `${resolved.reason} / tail-only`,
      generatedAt: new Date().toISOString(),
      overallStatus: computeOverallStatus(steps),
      sameDayStatus: buildSameDayStatus(steps, artifactStatus),
      logFile,
      checkpointDir,
      systemHealthOverall: systemHealth?.overallStatus ?? null,
      previousTradingDate: changeSummary.previousTradingDate,
      changeSummary: changeSummary.line,
      steps,
      artifacts: artifactStatus,
    });

    let summary = buildSummary();
    await writeSummary({
      summaryPathJson: artifacts.automationJson,
      summaryPathMarkdown: artifacts.automationMarkdown,
      summary,
    });

    if (!cli.skipPush) {
      const push = await runCommand({
        id: "push_data_branch",
        label: "Push Data Branch",
        command: "bash",
        args: ["scripts/push-to-github.sh", date],
        logger,
        soft: true,
        skip: false,
      });
      await appendStep(push);
    }

    const briefingSource = (await fileExists(artifacts.finalResearchBriefing))
      ? artifacts.finalResearchBriefing
      : artifacts.dailyBriefing;
    const dailyBriefingHtml = await runCommand({
      id: "daily_briefing_html",
      label: "Export Daily Briefing HTML",
      command: "node",
      args: [
        "scripts/export-daily-briefing-html.js",
        "--date",
        date,
        "--briefing",
        briefingSource,
        "--output",
        artifacts.dailyBriefingHtml,
      ],
      logger,
      soft: true,
      skip: !(await fileExists(briefingSource)),
    });
    await appendStep(dailyBriefingHtml);

    const executionPlanTable = await runCommand({
      id: "execution_plan_table",
      label: "Stage 19 Execution Plan Table",
      command: "node",
      args: [
        "scripts/export-stage4-execution-plan-table.js",
        "--date",
        date,
        "--output",
        artifacts.executionPlanTable,
        "--telegram-output",
        artifacts.executionPlanTelegram,
      ],
      logger,
      soft: true,
      skip: !(await fileExists(artifacts.stage4)),
    });
    await appendStep(executionPlanTable);

    systemHealth = await readJson(artifacts.systemHealth, null);
    artifactStatus = await buildArtifactStatus(artifacts);
    summary = buildSummary();
    await writeSummary({
      summaryPathJson: artifacts.automationJson,
      summaryPathMarkdown: artifacts.automationMarkdown,
      summary,
    });

    const telegramArgs = [
      "scripts/send-telegram-summary.js",
      "--date",
      date,
      "--event",
      "automation-cycle-complete",
      "--message",
      buildTelegramCompletionMessage(summary),
    ];
    if (summary.artifacts.dailyBriefingHtml?.exists) {
      telegramArgs.push("--document", artifacts.dailyBriefingHtml);
      telegramArgs.push("--caption", `EcoReport ${date} briefing.html`);
    }
    if (summary.artifacts.executionPlanTelegram?.exists) {
      telegramArgs.push("--followup-message-file", artifacts.executionPlanTelegram);
      telegramArgs.push("--followup-preformatted");
    }

    const telegramCompletion = await runCommand({
      id: "telegram_completion",
      label: "Telegram Completion Notification",
      command: "node",
      args: telegramArgs,
      logger,
      soft: true,
      skip: false,
    });
    await appendStep(telegramCompletion);

    artifactStatus = await buildArtifactStatus(artifacts);
    summary = buildSummary();
    await writeSummary({
      summaryPathJson: artifacts.automationJson,
      summaryPathMarkdown: artifacts.automationMarkdown,
      summary,
    });

    logger.write("==================================================");
    logger.write(`🏁 EcoReport Automation Tail 종료 (${summary.overallStatus.toUpperCase()})`);
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

  if (cli.tailOnly) {
    await finalizeFromExistingArtifacts();
    return;
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
    "--qwen-stage2",
    "--strict-qwen-stage2",
    "--baseline-only",
    "--skip-telegram",
  ];
  if (cli.forceCollect) {
    baselineArgs.push("--force-collect");
  }

  const steps = [];

  const readinessStep = isCheckpointed("automation_readiness")
    ? checkpointResumeStep({
        id: "automation_readiness",
        label: "Automation Environment Readiness",
        artifactPath: artifacts.automationReadiness,
      })
    : await runCommand({
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
      });
  const readinessReport = await readJson(artifacts.automationReadiness, null);
  const readinessWarnings = readinessReport?.checks?.filter((item) => item.status !== "ok") ?? [];
  const readinessSummary = readinessWarnings.map((item) => `${item.label}: ${item.detail}`).join(" | ");
  if (!isCheckpointed("automation_readiness") && readinessStep.status === "ok" && readinessWarnings.length > 0) {
    readinessStep.status = "warn";
    readinessStep.errorMessage = `자동화 환경 경고 ${readinessWarnings.length}건`;
    readinessStep.outputTail = readinessSummary || readinessStep.outputTail;
  }
  await appendStep(readinessStep);

  const stockeasyCapture =
    isCheckpointed("stockeasy_capture")
      ? checkpointResumeStep({
          id: "stockeasy_capture",
          label: "StockEasy Market Capture",
          artifactPath: artifacts.stockeasySnapshot,
        })
      : readinessReport?.blockers?.stockeasyCaptureReady === false
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
  await appendStep(stockeasyCapture);

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
    ? checkpointResumeStep({
        id: "baseline_daily_system",
        label: "Baseline Daily System",
        artifactPath: "checkpoint",
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
  await appendStep(baseline);

  const windowsLocalSummary = isCheckpointed("windows_local_summary")
    ? checkpointResumeStep({
        id: "windows_local_summary",
        label: "Windows Local Report Summary (Preferred)",
        artifactPath: artifacts.localSummaryFinalView,
      })
    : await runCommandWithRetry({
        id: "windows_local_summary",
        label: "Windows Local Report Summary (Preferred)",
        command: "bash",
        args: ["scripts/run-local-report-orchestrator.sh", "--date", date],
        logger,
        soft: true,
        skip: baseline.status !== "ok",
        timeoutMs: 2_700_000,
        retries: 1,
        backoffMs: 30_000,
      });
  await appendStep(windowsLocalSummary);

  const stage1Extracts = isCheckpointed("stage1_extracts")
    ? checkpointResumeStep({
        id: "stage1_extracts",
        label: "Stage 2 Report Extracts",
        artifactPath: artifacts.stage1,
      })
    : await runCommandWithRetry({
        id: "stage1_extracts",
        label: "Stage 2 Report Extracts",
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
  await appendStep(stage1Extracts);

  const stage1_4Summarize = isCheckpointed("stage1_4_summarize")
    ? checkpointResumeStep({
        id: "stage1_4_summarize",
        label: "Stage 3 Top Report Summary Selection",
        artifactPath: artifacts.stage1ChunkSummaries,
      })
    : await runCommandWithRetry({
        id: "stage1_4_summarize",
        label: "Stage 3 Top Report Summary Selection",
        command: "npm",
        args: [
          "run",
          "stage3:top-report-selection",
          "--",
          "--date",
          date,
          "--run-date",
          runDate,
          "--effective-market-date",
          date,
          "--run-id",
          runId,
          "--top-n",
          "30",
          "--concurrency",
          "6",
        ],
        logger,
        soft: true,
        skip: stage1Extracts.status !== "ok",
        timeoutMs: 600_000,
        retries: 1,
        backoffMs: 5_000,
      });
  await appendStep(stage1_4Summarize);

  const stage2EnrichedReportIndex = isCheckpointed("stage2_enriched_report_index")
    ? checkpointResumeStep({
        id: "stage2_enriched_report_index",
        label: "Stage 2 Enriched Report Index",
        artifactPath: artifacts.stage2EnrichedReportIndex,
      })
    : await runCommandWithRetry({
        id: "stage2_enriched_report_index",
        label: "Stage 2 Enriched Report Index",
        command: "npm",
        args: [
          "run",
          "stage2:enriched-report-index",
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
        soft: true,
        skip: stage1Extracts.status !== "ok",
        timeoutMs: 300_000,
        retries: 1,
        backoffMs: 5_000,
      });
  await appendStep(stage2EnrichedReportIndex);

  const stage1_4Agenda = isCheckpointed("stage1_4_agenda")
    ? checkpointResumeStep({
        id: "stage1_4_agenda",
        label: "Stage 4 Research Agenda",
        artifactPath: artifacts.stage1ResearchAgenda,
      })
    : await runCommandWithRetry({
        id: "stage1_4_agenda",
        label: "Stage 4 Research Agenda",
        command: "npm",
        args: [
          "run",
          "stage4:research-agenda",
          "--",
          "--date",
          date,
          "--run-date",
          runDate,
          "--effective-market-date",
          date,
          "--run-id",
          runId,
          "--max-input-summaries",
          "30",
        ],
        logger,
        soft: true,
        skip: stage1Extracts.status !== "ok",
        timeoutMs: 300_000,
        retries: 1,
        backoffMs: 5_000,
      });
  await appendStep(stage1_4Agenda);

  const stage1_5PromptSplit = isCheckpointed("stage1_5_prompt_split")
    ? checkpointResumeStep({
        id: "stage1_5_prompt_split",
        label: "Stage 5 Deep Research Prompt Split",
        artifactPath: artifacts.deepResearchPrompt,
      })
    : await runCommandWithRetry({
        id: "stage1_5_prompt_split",
        label: "Stage 5 Deep Research Prompt Split",
        command: "npm",
        args: [
          "run",
          "stage5:deep-research-prompt",
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
        soft: true,
        skip: stage1Extracts.status !== "ok",
        timeoutMs: 240_000,
        retries: 1,
        backoffMs: 5_000,
      });
  await appendStep(stage1_5PromptSplit);

  const existingDeepResearch = !cli.freshStart && await fileExists(artifacts.deepResearchResponse);
  const deepResearch =
    isCheckpointed("deep_research_web")
      ? checkpointResumeStep({
          id: "deep_research_web",
          label: "Stage 6 Gemini Deep Research Web",
          artifactPath: artifacts.deepResearchResponse,
        })
      : baseline.status === "ok" &&
        stage1Extracts.status === "ok" &&
        stage1_5PromptSplit.status === "ok" &&
        existingDeepResearch
      ? reuseArtifactStep({
          id: "deep_research_web",
          label: "Stage 6 Gemini Deep Research Web",
          artifactPath: artifacts.deepResearchResponse,
          note: `same-day Deep Research 응답 재사용: ${artifacts.deepResearchResponse}`,
        })
      : readinessReport?.blockers?.safariAutomationAvailable === false
        ? preflightWarnStep({
            id: "deep_research_web",
            label: "Stage 6 Gemini Deep Research Web",
            reason: "Gemini Deep Research Web 사전 차단 (Safari 자동화 unavailable)",
            note: readinessReport.checks.find((item) => item.key === "safari_automation")?.detail,
          })
      : await runCommand({
          id: "deep_research_web",
          label: "Stage 6 Gemini Deep Research Web",
          command: "npm",
          args: [
            "run",
            "stage5:gemini:run",
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
          skip:
            baseline.status !== "ok" ||
            windowsLocalSummary.status !== "ok" ||
            stage1Extracts.status !== "ok" ||
            stage1_5PromptSplit.status !== "ok",
        });
  await appendStep(deepResearch);

  const richBriefing = isCheckpointed("rich_briefing_overlay")
    ? checkpointResumeStep({
        id: "rich_briefing_overlay",
        label: "Stage 7 Rich Briefing Round 1",
        artifactPath: artifacts.finalResearchBriefing,
      })
    : await runRichBriefingStep({
        id: "rich_briefing_overlay",
        label: "Stage 7 Rich Briefing Round 1",
        command: "npm",
        args: [
          "run",
          "stage6:rich-briefing",
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
  await appendStep(richBriefing);

  const strategyRefresh = isCheckpointed("strategy_refresh")
    ? checkpointResumeStep({
        id: "strategy_refresh",
        label: "Stage 8 Strategy Refresh Round 1",
        artifactPath: artifacts.stage4,
      })
    : await runCommandWithRetry({
        id: "strategy_refresh",
        label: "Stage 8 Strategy Refresh Round 1",
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
          "--qwen-stage2",
          "--strict-qwen-stage2",
        ],
        logger,
        soft: true,
        skip: stage1Extracts.status !== "ok",
        timeoutMs: 300_000,
        retries: 1,
        backoffMs: 10_000,
      });
  await appendStep(strategyRefresh);

  const wikiRebuildInitial = isCheckpointed("wiki_rebuild_initial")
    ? checkpointResumeStep({
        id: "wiki_rebuild_initial",
        label: "LLM Wiki Rebuild After First Synthesis",
        artifactPath: artifacts.wikiDaily,
      })
    : await runCommandWithRetry({
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
  await appendStep(wikiRebuildInitial);

  const followUpReindex = isCheckpointed("followup_reindex")
    ? checkpointResumeStep({
        id: "followup_reindex",
        label: "Stage 9 Follow-up Research Map",
        artifactPath: artifacts.followUpMap,
      })
    : await runCommand({
        id: "followup_reindex",
        label: "Stage 9 Follow-up Research Map",
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
  await appendStep(followUpReindex);

  const followUpPrompt = isCheckpointed("followup_prompt")
    ? checkpointResumeStep({
        id: "followup_prompt",
        label: "Stage 10 Gemini Follow-up Prompt",
        artifactPath: artifacts.deepResearchFollowUpPrompt,
      })
    : await runCommand({
        id: "followup_prompt",
        label: "Stage 10 Gemini Follow-up Prompt",
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
  await appendStep(followUpPrompt);

  const existingFollowUpDeepResearch = await fileExists(artifacts.deepResearchFollowUpResponse);
  const deepResearchFollowUp =
    isCheckpointed("deep_research_follow_up_web")
      ? checkpointResumeStep({
          id: "deep_research_follow_up_web",
          label: "Stage 11 Gemini Follow-up Web",
          artifactPath: artifacts.deepResearchFollowUpResponse,
        })
      : followUpPrompt.status === "ok" &&
        existingFollowUpDeepResearch
      ? reuseArtifactStep({
          id: "deep_research_follow_up_web",
          label: "Stage 11 Gemini Follow-up Web",
          artifactPath: artifacts.deepResearchFollowUpResponse,
          note: `same-day Deep Research follow-up 응답 재사용: ${artifacts.deepResearchFollowUpResponse}`,
        })
      : readinessReport?.blockers?.safariAutomationAvailable === false
        ? preflightWarnStep({
            id: "deep_research_follow_up_web",
            label: "Stage 11 Gemini Follow-up Web",
            reason: "Gemini Deep Research Follow-up Web 사전 차단 (Safari 자동화 unavailable)",
            note: readinessReport.checks.find((item) => item.key === "safari_automation")?.detail,
          })
      : await runCommand({
          id: "deep_research_follow_up_web",
          label: "Stage 11 Gemini Follow-up Web",
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
  await appendStep(deepResearchFollowUp);

  const richBriefingFinal = isCheckpointed("rich_briefing_final")
    ? checkpointResumeStep({
        id: "rich_briefing_final",
        label: "Stage 12 Rich Briefing Round 2",
        artifactPath: artifacts.finalResearchBriefing,
      })
    : await runRichBriefingStep({
        id: "rich_briefing_final",
        label: "Stage 12 Rich Briefing Round 2",
        command: "npm",
        args: [
          "run",
          "stage6:rich-briefing",
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
  await appendStep(richBriefingFinal);

  const strategyRefreshFinal = isCheckpointed("strategy_refresh_final")
    ? checkpointResumeStep({
        id: "strategy_refresh_final",
        label: "Stage 13 Strategy Refresh Round 2",
        artifactPath: artifacts.stage4,
      })
    : await runCommandWithRetry({
        id: "strategy_refresh_final",
        label: "Stage 13 Strategy Refresh Round 2",
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
          "--qwen-stage2",
          "--strict-qwen-stage2",
        ],
        logger,
        soft: true,
        skip: followUpReindex.status !== "ok",
        timeoutMs: 300_000,
        retries: 1,
        backoffMs: 10_000,
      });
  await appendStep(strategyRefreshFinal);

  const wikiRebuildMid = isCheckpointed("wiki_rebuild_mid")
    ? checkpointResumeStep({
        id: "wiki_rebuild_mid",
        label: "LLM Wiki Rebuild After Round 2",
        artifactPath: artifacts.wikiDaily,
      })
    : await runCommandWithRetry({
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
  await appendStep(wikiRebuildMid);

  const round3Reindex = isCheckpointed("round3_reindex")
    ? checkpointResumeStep({
        id: "round3_reindex",
        label: "Stage 14 Final Refinement Map",
        artifactPath: artifacts.round3Map,
      })
    : await runCommand({
        id: "round3_reindex",
        label: "Stage 14 Final Refinement Map",
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
  await appendStep(round3Reindex);

  const round3Prompt = isCheckpointed("round3_prompt")
    ? checkpointResumeStep({
        id: "round3_prompt",
        label: "Stage 15 Gemini Final Refinement Prompt",
        artifactPath: artifacts.round3Prompt,
      })
    : await runCommand({
        id: "round3_prompt",
        label: "Stage 15 Gemini Final Refinement Prompt",
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
  await appendStep(round3Prompt);

  const existingRound3DeepResearch = artifacts.round3Response
    ? await fileExists(artifacts.round3Response)
    : false;
  const deepResearchRound3 =
    isCheckpointed("deep_research_round3_web")
      ? checkpointResumeStep({
          id: "deep_research_round3_web",
          label: "Stage 16 Gemini Final Refinement Web",
          artifactPath: artifacts.round3Response,
        })
      : round3Prompt.status === "ok" &&
        existingRound3DeepResearch
      ? reuseArtifactStep({
          id: "deep_research_round3_web",
          label: "Stage 16 Gemini Final Refinement Web",
          artifactPath: artifacts.round3Response,
          note: `same-day Deep Research round3 응답 재사용: ${artifacts.round3Response}`,
        })
      : readinessReport?.blockers?.safariAutomationAvailable === false
        ? preflightWarnStep({
            id: "deep_research_round3_web",
            label: "Stage 16 Gemini Final Refinement Web",
            reason: "Gemini Deep Research Round 3 Web 사전 차단 (Safari 자동화 unavailable)",
            note: readinessReport.checks.find((item) => item.key === "safari_automation")?.detail,
          })
      : await runCommand({
          id: "deep_research_round3_web",
          label: "Stage 16 Gemini Final Refinement Web",
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
  await appendStep(deepResearchRound3);

  const richBriefingRound3Final = isCheckpointed("rich_briefing_round3_final")
    ? checkpointResumeStep({
        id: "rich_briefing_round3_final",
        label: "Stage 17 Rich Briefing Final",
        artifactPath: artifacts.finalResearchBriefing,
      })
    : await runRichBriefingStep({
        id: "rich_briefing_round3_final",
        label: "Stage 17 Rich Briefing Final",
        command: "npm",
        args: [
          "run",
          "stage6:rich-briefing",
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
  await appendStep(richBriefingRound3Final);

  const briefingDelta = isCheckpointed("stage6_briefing_delta")
    ? checkpointResumeStep({
        id: "stage6_briefing_delta",
        label: "Stage 6 Briefing Delta",
        artifactPath: artifacts.briefingDeltaMarkdown,
      })
    : await runCommand({
        id: "stage6_briefing_delta",
        label: "Stage 6 Briefing Delta",
        command: "node",
        args: [
          "scripts/build-briefing-delta.js",
          "--date",
          date,
        ],
        logger,
        soft: true,
        skip: richBriefingRound3Final.status !== "ok",
      });
  await appendStep(briefingDelta);

  const strategyRefreshRound3Final = isCheckpointed("strategy_refresh_round3_final")
    ? checkpointResumeStep({
        id: "strategy_refresh_round3_final",
        label: "Stage 18 Strategy Refresh Final",
        artifactPath: artifacts.stage4,
      })
    : await runCommand({
        id: "strategy_refresh_round3_final",
        label: "Stage 18 Strategy Refresh Final",
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
          "--qwen-stage2",
          "--strict-qwen-stage2",
        ],
        logger,
        soft: true,
        skip: round3Reindex.status !== "ok",
      });
  await appendStep(strategyRefreshRound3Final);

  const strategyReadyForFinalWiki =
    strategyRefreshRound3Final.status === "ok" ||
    strategyRefreshFinal.status === "ok" ||
    strategyRefresh.status === "ok";

  const wikiRebuildFinal = isCheckpointed("wiki_rebuild_final")
    ? checkpointResumeStep({
        id: "wiki_rebuild_final",
        label: "LLM Wiki Rebuild Final",
        artifactPath: artifacts.wikiDaily,
      })
    : await runCommand({
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
  await appendStep(wikiRebuildFinal);

  const wikiPublish =
    isCheckpointed("wiki_publish")
      ? checkpointResumeStep({
          id: "wiki_publish",
          label: "LLM Wiki Publish",
          artifactPath: artifacts.wikiDaily,
        })
      : readinessReport?.blockers?.obsidianPublishReady === false
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
  await appendStep(wikiPublish);

  const verify = isCheckpointed("verify_outputs")
    ? checkpointResumeStep({
        id: "verify_outputs",
        label: "Verify Outputs",
        artifactPath: artifacts.systemHealth,
      })
    : await runCommand({
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
  await appendStep(verify);

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
    checkpointDir,
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
        isCheckpointed("push_data_branch")
          ? checkpointResumeStep({
              id: "push_data_branch",
              label: "Push Data Branch",
              artifactPath: artifacts.automationJson,
            })
          : readinessReport?.blockers?.githubPushReady === false
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
    await appendStep(push);
  }

  const dailyBriefingHtml = isCheckpointed("daily_briefing_html")
    ? checkpointResumeStep({
        id: "daily_briefing_html",
        label: "Export Daily Briefing HTML",
        artifactPath: artifacts.dailyBriefingHtml,
      })
    : await runCommand({
        id: "daily_briefing_html",
        label: "Export Daily Briefing HTML",
        command: "node",
        args: [
          "scripts/export-daily-briefing-html.js",
          "--date",
          date,
          "--briefing",
          (await fileExists(artifacts.finalResearchBriefing))
            ? artifacts.finalResearchBriefing
            : artifacts.dailyBriefing,
          "--output",
          artifacts.dailyBriefingHtml,
        ],
        logger,
        soft: true,
        skip: !(await fileExists(artifacts.dailyBriefing)),
      });
  await appendStep(dailyBriefingHtml);

  const executionPlanTable = isCheckpointed("execution_plan_table")
    ? checkpointResumeStep({
        id: "execution_plan_table",
        label: "Stage 19 Execution Plan Table",
        artifactPath: artifacts.executionPlanTable,
      })
    : await runCommand({
        id: "execution_plan_table",
        label: "Stage 19 Execution Plan Table",
        command: "node",
        args: [
          "scripts/export-stage4-execution-plan-table.js",
          "--date",
          date,
          "--output",
          artifacts.executionPlanTable,
          "--telegram-output",
          artifacts.executionPlanTelegram,
        ],
        logger,
        soft: true,
        skip: !(await fileExists(artifacts.stage4)),
      });
  await appendStep(executionPlanTable);

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

  const telegramArgs = [
    "scripts/send-telegram-summary.js",
    "--date",
    date,
    "--event",
    "automation-cycle-complete",
    "--message",
    buildTelegramCompletionMessage(summary),
  ];
  if (summary.artifacts.dailyBriefingHtml?.exists) {
    telegramArgs.push("--document", artifacts.dailyBriefingHtml);
    telegramArgs.push("--caption", `EcoReport ${date} briefing.html`);
  }
  if (summary.artifacts.executionPlanTelegram?.exists) {
    telegramArgs.push("--followup-message-file", artifacts.executionPlanTelegram);
    telegramArgs.push("--followup-preformatted");
  }

  const telegramCompletion = isCheckpointed("telegram_completion")
    ? checkpointResumeStep({
        id: "telegram_completion",
        label: "Telegram Completion Notification",
        artifactPath: artifacts.automationJson,
      })
    : await runCommand({
        id: "telegram_completion",
        label: "Telegram Completion Notification",
        command: "node",
        args: telegramArgs,
        logger,
        soft: true,
        skip: false,
      });
  await appendStep(telegramCompletion);

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
