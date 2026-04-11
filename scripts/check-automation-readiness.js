#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";

import { ROOT_DIR, buildRunMetadata, parseDateArgs, writeJson } from "./lib/pipeline-utils.js";
import { loadProjectEnv } from "./lib/env-loader.js";

const DEFAULT_VAULT_DIR = "/Users/seo/my-wiki";

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

async function checkGithubNetwork() {
  try {
    const lookup = await dns.lookup("github.com");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("https://github.com", {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });
      return buildCheck(
        "github_network",
        "GitHub Network",
        response.status < 500 ? "ok" : "warn",
        response.status < 500
          ? `github.com reachable (${lookup.address}, http ${response.status})`
          : `github.com responded with http ${response.status}`,
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return buildCheck(
      "github_network",
      "GitHub Network",
      "warn",
      `github.com 연결 불가: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolveOutputPath(args);
  loadProjectEnv(ROOT_DIR);

  const safariCheck = classifySafariAutomation(
    runProcess("osascript", ["-e", 'tell application "Safari" to return name']),
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

  const githubCheck = await checkGithubNetwork();

  const checks = [geminiApiCheck, safariCheck, pythonStage2Check, vaultCheck, githubCheck];
  const overallStatus = checks.some((item) => item.status !== "ok") ? "warn" : "ok";
  const runMeta = buildRunMetadata(args);
  const payload = {
    ...runMeta,
    outputPath,
    overallStatus,
    blockers: {
      safariAutomationAvailable: safariCheck.status === "ok",
      stage2GeminiReady: pythonStage2Check.status === "ok",
      obsidianPublishReady: vaultCheck.status === "ok",
      githubPushReady: githubCheck.status === "ok",
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
