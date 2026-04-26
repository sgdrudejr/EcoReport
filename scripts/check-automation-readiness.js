#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";

import { ROOT_DIR, buildRunMetadata, parseDateArgs, readJson, writeJson } from "./lib/pipeline-utils.js";
import { loadProjectEnv } from "./lib/env-loader.js";
import { isTradingDay, previousDate } from "./lib/trading-calendar.js";

const DEFAULT_VAULT_DIR = "/Users/seo/my-wiki";
const REPORT_COLLECTION_TARGETS = [
  {
    key: "naver_research_network",
    label: "Naver Research Network",
    url: "https://finance.naver.com/research/company_list.naver?page=1",
  },
  {
    key: "shinhan_research_network",
    label: "Shinhan Research Network",
    url: "https://www.shinhansec.com/siw/etc/browse/search05/data.do",
  },
];

function parseArgs(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function resolveOutputPath(args) {
  if (args.output) {
    return path.isAbsolute(args.output) ? args.output : path.join(ROOT_DIR, args.output);
  }
  return path.join(ROOT_DIR, "data", "analysis-state", args.date, "automation-readiness.json");
}

function getPythonBin() {
  const venvPython = path.join(ROOT_DIR, ".venv", "bin", "python");
  return fsSync.existsSync(venvPython) ? venvPython : "python3";
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: ROOT_DIR,
    env: process.env,
    ...options,
  });

  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();

  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    error: result.error ? result.error.message : combined,
    stdout,
    stderr,
  };
}

async function runProcessWithRetries(command, args, options = {}, attempts = 2, delayMs = 1500) {
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = runProcess(command, args, options);
    if (lastResult.ok) {
      return lastResult;
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return lastResult;
}

function nearestExistingParent(targetPath) {
  let cursor = path.resolve(targetPath);
  while (!fsSync.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return cursor;
    }
    cursor = parent;
  }
  return cursor;
}

async function canWriteDirectory(targetPath) {
  const existingParent = nearestExistingParent(targetPath);
  await fs.access(existingParent, fsConstants.W_OK);
  const probeDir = await fs.mkdtemp(path.join(existingParent, ".ecoreport-write-check-"));
  await fs.rm(probeDir, { recursive: true, force: true });
  return existingParent;
}

function buildCheck(key, label, status, detail, extras = {}) {
  return {
    key,
    label,
    status,
    detail,
    ...extras,
  };
}

async function readReportArtifacts(dateText) {
  const reportDir = path.join(ROOT_DIR, "data", "reports", dateText);
  const [indexEntries, textManifest] = await Promise.all([
    readJson(path.join(reportDir, "index.json"), []),
    readJson(path.join(reportDir, "text-manifest.json"), null),
  ]);

  return {
    indexEntries,
    textManifest,
  };
}

function hasUsableReportArtifacts(indexEntries, textManifest) {
  return Array.isArray(indexEntries) && indexEntries.length > 0 && Number(textManifest?.success_count ?? 0) > 0;
}

async function findLatestFallbackReportDate(dateText, lookbackDays = 14) {
  let cursor = previousDate(dateText);

  for (let index = 0; index < lookbackDays; index += 1) {
    if (!isTradingDay(cursor)) {
      cursor = previousDate(cursor);
      continue;
    }

    const { indexEntries, textManifest } = await readReportArtifacts(cursor);
    if (hasUsableReportArtifacts(indexEntries, textManifest)) {
      return {
        sourceDate: cursor,
        reportCount: indexEntries.length,
        textSuccessCount: Number(textManifest?.success_count ?? 0),
      };
    }

    cursor = previousDate(cursor);
  }

  return null;
}

async function checkNetworkTarget({ key, label, url }) {
  try {
    const host = new URL(url).hostname;
    const lookup = await dns.lookup(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });
      return buildCheck(
        key,
        label,
        response.status < 500 ? "ok" : "warn",
        response.status < 500
          ? `${host} reachable (${lookup.address}, http ${response.status})`
          : `${host} responded with http ${response.status}`,
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return buildCheck(
      key,
      label,
      "warn",
      `${new URL(url).hostname} 연결 불가: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function checkGithubNetwork() {
  return checkNetworkTarget({
    key: "github_network",
    label: "GitHub Network",
    url: "https://github.com",
  });
}

function classifySafariAutomation(result) {
  if (result.ok) {
    return buildCheck("safari_automation", "Safari Automation", "ok", "Safari AppleScript 제어 가능");
  }

  const message = result.error || "알 수 없는 Safari 자동화 오류";
  if (/connection invalid/i.test(message)) {
    return buildCheck(
      "safari_automation",
      "Safari Automation",
      "warn",
      "Safari GUI 세션 또는 AppleScript 연결이 유효하지 않습니다.",
    );
  }
  if (/not authorized|not permitted/i.test(message)) {
    return buildCheck(
      "safari_automation",
      "Safari Automation",
      "warn",
      "Safari 자동화 권한이 없어 Gemini Web 단계를 실행할 수 없습니다.",
    );
  }
  return buildCheck(
    "safari_automation",
    "Safari Automation",
    "warn",
    `Safari 자동화 실패: ${message.split("\n").at(-1)}`,
  );
}

function classifyStockeasySmoke(result) {
  if (result.ok) {
    return buildCheck(
      "stockeasy_capture_smoke",
      "StockEasy Capture Smoke",
      "ok",
      "StockEasy capture smoke test 통과",
    );
  }

  const message = result.error || "알 수 없는 StockEasy smoke test 오류";
  return buildCheck(
    "stockeasy_capture_smoke",
    "StockEasy Capture Smoke",
    "warn",
    `StockEasy smoke test 실패: ${message.split("\n").at(-1)}`,
  );
}

function checkPathExists(targetPath) {
  try {
    fsSync.accessSync(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildRuntimeAssetCheck() {
  const assets = [
    path.join(ROOT_DIR, ".env"),
    path.join(ROOT_DIR, ".venv", "bin", "python"),
    path.join(ROOT_DIR, "node_modules"),
    path.join(ROOT_DIR, "open-trading-api"),
    path.join(ROOT_DIR, "config", "telegram_notify.env"),
  ];
  const missing = assets.filter((targetPath) => !checkPathExists(targetPath));
  return buildCheck(
    "runtime_assets",
    "Automation Runtime Assets",
    missing.length === 0 ? "ok" : "warn",
    missing.length === 0
      ? "env / venv / node_modules / open-trading-api / telegram secrets ready"
      : `missing: ${missing.map((item) => path.relative(ROOT_DIR, item)).join(", ")}`,
    {
      missing: missing.map((item) => path.relative(ROOT_DIR, item)),
    },
  );
}

function buildPythonModuleCheck({ key, label, moduleName, successDetail, failureDetail }) {
  const result = runProcess(getPythonBin(), [
    "-c",
    [
      "import importlib.util, sys",
      `mod = importlib.util.find_spec(${JSON.stringify(moduleName)})`,
      "sys.exit(0 if mod else 1)",
    ].join("; "),
  ]);
  return buildCheck(
    key,
    label,
    result.ok ? "ok" : "warn",
    result.ok ? successDetail : failureDetail,
  );
}

function buildTelegramConfigCheck() {
  const configPath = path.join(ROOT_DIR, "config", "telegram.json");
  const envFilePath = path.join(ROOT_DIR, "config", "telegram_notify.env");
  if (!checkPathExists(configPath)) {
    return buildCheck("telegram_delivery", "Telegram Delivery Config", "warn", "config/telegram.json 누락");
  }
  if (!checkPathExists(envFilePath)) {
    return buildCheck(
      "telegram_delivery",
      "Telegram Delivery Config",
      "warn",
      "config/telegram_notify.env 누락",
    );
  }

  const raw = fsSync.readFileSync(envFilePath, "utf8");
  const flags = {
    BOT_TOKEN: false,
    CHAT_ID: false,
    TELEGRAM_BOT_TOKEN: false,
    TELEGRAM_CHAT_ID: false,
  };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, value] = trimmed.replace(/^export\s+/, "").split("=", 2);
    if (key in flags && value.trim()) {
      flags[key] = true;
    }
  }

  const ready =
    (flags.BOT_TOKEN && flags.CHAT_ID) ||
    (flags.TELEGRAM_BOT_TOKEN && flags.TELEGRAM_CHAT_ID);
  return buildCheck(
    "telegram_delivery",
    "Telegram Delivery Config",
    ready ? "ok" : "warn",
    ready
      ? "telegram secrets configured"
      : "telegram bot token/chat id 누락",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolveOutputPath(args);
  loadProjectEnv(ROOT_DIR);

  const safariCheck = classifySafariAutomation(
    runProcess("osascript", ["-e", 'tell application "Safari" to return name']),
  );
  const stockeasySmokeCheck = classifyStockeasySmoke(
    await runProcessWithRetries("node", [
      "scripts/capture-stockeasy-snapshot.js",
      "--date",
      args.date,
      "--smoke-test",
    ]),
  );

  const apiKeyPresent = Boolean(process.env.GEMINI_API_KEY?.trim());
  const geminiApiCheck = buildCheck(
    "gemini_api_key",
    "Gemini API Key",
    apiKeyPresent ? "ok" : "warn",
    apiKeyPresent ? "GEMINI_API_KEY configured" : "GEMINI_API_KEY가 없어 API 기반 Stage 1.6은 local fallback으로 동작합니다.",
  );

  const pythonCheckResult = runProcess(getPythonBin(), [
    "-c",
    [
      "import importlib.util, sys",
      "mod = importlib.util.find_spec('google.genai')",
      "print('ready' if mod else 'missing:google.genai')",
      "sys.exit(0 if mod else 1)",
    ].join("; "),
  ]);
  const pythonStage2Check = buildCheck(
    "python_stage2_gemini",
    "Stage 2 Gemini Python",
    pythonCheckResult.ok && apiKeyPresent ? "ok" : "warn",
    pythonCheckResult.ok
      ? apiKeyPresent
        ? "google.genai available"
        : "google.genai는 있지만 API 키가 없어 mock fallback 예정"
      : "google.genai 패키지가 없어 Stage 2 Gemini는 mock fallback 예정",
  );
  const fredRequestsCheck = buildPythonModuleCheck({
    key: "python_fred_requests",
    label: "FRED Python requests",
    moduleName: "requests",
    successDetail: "requests available",
    failureDetail: "requests 패키지가 없어 FRED 수집이 실패할 수 있습니다.",
  });
  const runtimeAssetCheck = buildRuntimeAssetCheck();
  const telegramConfigCheck = buildTelegramConfigCheck();

  const vaultDir = path.resolve(process.env.OBSIDIAN_VAULT_DIR || DEFAULT_VAULT_DIR);
  let vaultCheck;
  try {
    const writableParent = await canWriteDirectory(path.join(vaultDir, "wiki", "ecoreport"));
    vaultCheck = buildCheck(
      "obsidian_publish",
      "Obsidian Publish Target",
      "ok",
      `vault writable via ${writableParent}`,
      { path: vaultDir },
    );
  } catch (error) {
    vaultCheck = buildCheck(
      "obsidian_publish",
      "Obsidian Publish Target",
      "warn",
      `vault write unavailable: ${error instanceof Error ? error.message : String(error)}`,
      { path: vaultDir },
    );
  }

  const reportNetworkChecks = await Promise.all(
    REPORT_COLLECTION_TARGETS.map((target) => checkNetworkTarget(target)),
  );
  const fallbackReport = await findLatestFallbackReportDate(args.date);
  const reportFallbackCheck = fallbackReport
    ? buildCheck(
        "report_fallback_assets",
        "Report Fallback Assets",
        "ok",
        `${fallbackReport.sourceDate} 리포트 fallback 사용 가능 (${fallbackReport.reportCount}건 / 전문 ${fallbackReport.textSuccessCount}건)`,
        {
          sourceDate: fallbackReport.sourceDate,
          reportCount: fallbackReport.reportCount,
          textSuccessCount: fallbackReport.textSuccessCount,
        },
      )
    : buildCheck(
        "report_fallback_assets",
        "Report Fallback Assets",
        "warn",
        "사용 가능한 이전 거래일 리포트 fallback을 찾지 못했습니다.",
      );
  const githubCheck = await checkGithubNetwork();

  const checks = [
    runtimeAssetCheck,
    geminiApiCheck,
    fredRequestsCheck,
    safariCheck,
    stockeasySmokeCheck,
    pythonStage2Check,
    telegramConfigCheck,
    ...reportNetworkChecks,
    reportFallbackCheck,
    vaultCheck,
    githubCheck,
  ];
  const reportNetworkReady = reportNetworkChecks.some((item) => item.status === "ok");
  const reportFallbackReady = reportFallbackCheck.status === "ok";
  const reportCollectionReady = reportNetworkReady || reportFallbackReady;
  const overallStatus = checks.some((item) => item.status !== "ok") ? "warn" : "ok";
  const runMeta = buildRunMetadata(args);
  const payload = {
    ...runMeta,
    outputPath,
    overallStatus,
    blockers: {
      safariAutomationAvailable: safariCheck.status === "ok",
      stockeasyCaptureReady: stockeasySmokeCheck.status === "ok",
      stage2GeminiReady: pythonStage2Check.status === "ok",
      fredPythonReady: fredRequestsCheck.status === "ok",
      runtimeAssetsReady: runtimeAssetCheck.status === "ok",
      reportNetworkReady,
      reportFallbackReady,
      reportCollectionReady,
      obsidianPublishReady: vaultCheck.status === "ok",
      githubPushReady: githubCheck.status === "ok",
      telegramDeliveryReady: telegramConfigCheck.status === "ok",
    },
    checks,
  };

  await writeJson(outputPath, payload);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
