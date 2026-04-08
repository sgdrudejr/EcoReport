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

function buildFailureHint(stepId) {
  switch (stepId) {
    case "baseline_daily_system":
      return "수집, 시장 데이터, Stage 2 Python 의존성, 또는 기본 파이프라인 로그를 먼저 확인하세요.";
    case "stage1_extracts":
      return "리포트 인덱스, 전문 텍스트, 포트폴리오 스냅샷이 모두 생성됐는지와 Stage 1 추출 로그를 확인하세요.";
    case "deep_research_web":
      return "Safari가 잠겨 있지 않은지, Gemini 로그인 상태인지, Deep Research 도구가 노출되는지 확인하세요.";
    case "rich_briefing_overlay":
      return "09-stage1-5 결과 파일과 GEMINI_API_KEY, 그리고 Stage 1 추출물이 모두 있는지 확인하세요.";
    case "strategy_refresh":
      return "stage2 raw 응답과 종목 alias 매핑, Gemini JSON 응답 형식을 확인하세요.";
    case "wiki_rebuild":
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
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      appendTail(chunk);
      logger.writeChunk(chunk, false);
    });

    child.stderr.on("data", (chunk) => {
      appendTail(chunk);
      logger.writeChunk(chunk, true);
    });

    child.on("error", (error) => {
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
        errorMessage: error.message,
        outputTail: summarizeTail(tailLines),
      });
    });

    child.on("close", (code) => {
      const endedAt = new Date();
      resolve({
        id,
        label,
        status: code === 0 ? "ok" : soft ? "warn" : "error",
        soft,
        commandLine: `${command} ${args.map(shellQuote).join(" ")}`.trim(),
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        exitCode: code,
        errorMessage: code === 0 ? null : `${label} 실패 (exit ${code})`,
        outputTail: summarizeTail(tailLines),
      });
    });
  });
}

function buildArtifactMap(date, logFile) {
  return {
    logFile,
    stage1: path.join(ROOT_DIR, "data", "analysis-state", date, "stage1-report-extracts-v2.json"),
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
    finalResearchBriefing: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      `${date}-gemini-briefing-rich.md`,
    ),
    stage2: path.join(ROOT_DIR, "data", "analysis-state", date, "stage2-strategy-options.json"),
    stage4: path.join(ROOT_DIR, "data", "analysis-state", date, "stage4-execution-plan.json"),
    dailyBriefing: path.join(ROOT_DIR, "reports", "daily", `${date}-briefing.md`),
    wikiDaily: path.join(ROOT_DIR, "knowledge", "wiki", "daily", `${date}.md`),
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
      exists: await fileExists(filePath),
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

  const baseline = await runCommand({
    id: "baseline_daily_system",
    label: "Baseline Daily System",
    command: "bash",
    args: baselineArgs,
    logger,
    soft: false,
  });
  steps.push({ ...baseline, debugHint: baseline.status === "ok" ? null : buildFailureHint(baseline.id) });

  const stage1Extracts = await runCommand({
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
  });
  steps.push({
    ...stage1Extracts,
    debugHint:
      stage1Extracts.status === "ok" || stage1Extracts.status === "skipped"
        ? null
        : buildFailureHint(stage1Extracts.id),
  });

  const deepResearch = await runCommand({
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

  const richBriefing = await runCommand({
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
    ],
    logger,
    soft: true,
    skip: deepResearch.status !== "ok",
  });
  steps.push({ ...richBriefing, debugHint: richBriefing.status === "ok" ? null : richBriefing.status === "skipped" ? null : buildFailureHint(richBriefing.id) });

  const strategyRefresh = await runCommand({
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
  });
  steps.push({ ...strategyRefresh, debugHint: strategyRefresh.status === "ok" ? null : strategyRefresh.status === "skipped" ? null : buildFailureHint(strategyRefresh.id) });

  const wikiRebuild = await runCommand({
    id: "wiki_rebuild",
    label: "LLM Wiki Rebuild",
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
  });
  steps.push({ ...wikiRebuild, debugHint: wikiRebuild.status === "ok" ? null : wikiRebuild.status === "skipped" ? null : buildFailureHint(wikiRebuild.id) });

  const wikiPublish = await runCommand({
    id: "wiki_publish",
    label: "LLM Wiki Publish",
    command: "node",
    args: ["scripts/publish-llm-wiki-to-vault.js"],
    logger,
    soft: true,
    skip: wikiRebuild.status !== "ok",
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

  const overallStatus = steps.some((step) => step.id === "baseline_daily_system" && step.status === "error")
    ? "error"
    : steps.some((step) => step.status === "error")
      ? "error"
      : steps.some((step) => step.status === "warn")
        ? "warn"
        : "ok";

  const summary = {
    date,
    runDate,
    effectiveMarketDate: date,
    runId,
    resolutionReason: resolved.reason,
    generatedAt: new Date().toISOString(),
    overallStatus,
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
    const push = await runCommand({
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
    summary.overallStatus =
      summary.overallStatus === "error" || push.status === "ok"
        ? summary.overallStatus
        : "warn";
    summary.steps = steps;
    summary.artifacts = await buildArtifactStatus(artifacts);
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
