#!/usr/bin/env node
// EcoReport 파일/경로/자동화 설정이 현재 운영 기준과 어긋나지 않는지 점검합니다.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

import { ROOT_DIR, readJson } from "./lib/pipeline-utils.js";

const REQUIRED_DIRS = [
  "config",
  "dashboard",
  "data",
  "docs",
  "knowledge",
  "reports",
  "scripts",
  "scripts/lib",
];

const REQUIRED_FILES = [
  "README.md",
  "package.json",
  "config/strategy.json",
  "config/securities.json",
  "config/local-paths.example.json",
  "docs/REPO_STRUCTURE.md",
  "docs/ECOREPORT_DAILY_AUTOMATION.md",
  "scripts/run-daily-automation-cycle.js",
  "scripts/run-final-output-cycle.sh",
  "scripts/verify-daily-system.js",
];

const IGNORED_EMPTY_DIR_PATTERNS = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)dashboard\/node_modules(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /(^|\/)data\/\.stockeasy_session(\/|$)/,
  /(^|\/)data\/reports(\/|$)/,
];

const LEGACY_PATH_PATTERNS = [
  {
    label: "old stock-pilot root",
    regex: /\/Users\/seo\/stock-pilot(?!-archive)/,
  },
  {
    label: "capitalized EcoReport root",
    regex: /\/Users\/seo\/Documents\/Playground\/EcoReport/,
  },
];

function isAllowedLegacyReference(line) {
  return /stock-pilot-archive|레거시|legacy|옛|오래된|old/i.test(line);
}

function rel(filePath) {
  return path.relative(ROOT_DIR, filePath) || ".";
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT_DIR, relativePath));
}

function push(checks, status, label, detail = "") {
  checks.push({ status, label, detail });
}

function git(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    return "";
  }
}

function listTrackedFiles() {
  return git(["ls-files"])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePackageScriptRefs(command) {
  const refs = [];
  const pattern = /(?:node|bash|python3?|\.venv\/bin\/python)\s+([^\s;&|]+)/g;
  for (const match of command.matchAll(pattern)) {
    refs.push(match[1]);
  }
  return refs;
}

async function checkRequiredPaths(checks) {
  for (const dir of REQUIRED_DIRS) {
    push(
      checks,
      exists(dir) && fs.statSync(path.join(ROOT_DIR, dir)).isDirectory() ? "ok" : "error",
      `required directory: ${dir}`,
    );
  }
  for (const file of REQUIRED_FILES) {
    push(
      checks,
      exists(file) && fs.statSync(path.join(ROOT_DIR, file)).isFile() ? "ok" : "error",
      `required file: ${file}`,
    );
  }
}

async function checkPackageScriptRefs(checks) {
  const packageJson = await readJson(path.join(ROOT_DIR, "package.json"), {});
  const missing = [];
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    for (const ref of parsePackageScriptRefs(String(command))) {
      if (ref.startsWith("scripts/") && !exists(ref)) {
        missing.push(`${name} -> ${ref}`);
      }
    }
  }
  push(
    checks,
    missing.length === 0 ? "ok" : "error",
    "package scripts reference existing files",
    missing.join("; "),
  );
}

function checkLegacyPaths(checks) {
  const findings = [];
  for (const file of listTrackedFiles()) {
    if (!/\.(?:js|mjs|cjs|ts|tsx|json|md|sh|py|yaml|yml|toml|txt)$/.test(file)) {
      continue;
    }
    const absolutePath = path.join(ROOT_DIR, file);
    let text = "";
    try {
      text = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isAllowedLegacyReference(line)) return;
      for (const pattern of LEGACY_PATH_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push(`${file}:${index + 1} ${pattern.label}`);
        }
      }
    });
  }
  push(
    checks,
    findings.length === 0 ? "ok" : "warn",
    "no active legacy absolute paths",
    findings.slice(0, 12).join("; "),
  );
}

function checkGitWorktrees(checks) {
  const output = git(["worktree", "list", "--porcelain"]);
  const worktrees = [];
  let current = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.replace(/^worktree\s+/, ""), branch: "", head: "" };
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.replace(/^branch\s+refs\/heads\//, "");
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.replace(/^HEAD\s+/, "");
    }
  }
  if (current) worktrees.push(current);

  const hasRuntimeRoot = worktrees.some((item) => item.path === "/Users/seo/Documents/Playground/economy-report");
  const hasMainWorktree = worktrees.some((item) => item.branch === "main");
  push(
    checks,
    hasRuntimeRoot ? "ok" : "warn",
    "runtime worktree registered",
    hasRuntimeRoot ? "" : "expected /Users/seo/Documents/Playground/economy-report",
  );
  push(
    checks,
    hasMainWorktree ? "ok" : "warn",
    "main worktree registered",
    hasMainWorktree ? "" : "main branch should stay in one explicit worktree",
  );
}

function parseAutomationToml(text) {
  const pick = (key) => {
    const match = text.match(new RegExp(`^${key}\\s*=\\s*\"([^\"]*)\"`, "m"));
    return match?.[1] ?? "";
  };
  const cwdsMatch = text.match(/^cwds\s*=\s*\[([^\]]*)\]/m);
  const cwds = cwdsMatch
    ? [...cwdsMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : [];
  return {
    id: pick("id"),
    name: pick("name"),
    status: pick("status"),
    prompt: pick("prompt").replace(/\\n/g, "\n"),
    cwds,
  };
}

function checkCodexAutomations(checks) {
  const automationRoot = path.join(os.homedir(), ".codex", "automations");
  if (!fs.existsSync(automationRoot)) {
    push(checks, "warn", "codex automations directory", `${automationRoot} missing`);
    return;
  }
  const files = fs
    .readdirSync(automationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(automationRoot, entry.name, "automation.toml"))
    .filter((file) => fs.existsSync(file));

  const findings = [];
  let activeDaily = false;
  for (const file of files) {
    const parsed = parseAutomationToml(fs.readFileSync(file, "utf8"));
    if (parsed.status === "ACTIVE" && parsed.name.includes("EcoReport Daily Automation")) {
      activeDaily = true;
    }
    for (const cwd of parsed.cwds) {
      if (!fs.existsSync(cwd)) {
        findings.push(`${parsed.id}: cwd missing ${cwd}`);
      }
      if (/\/Users\/seo\/Documents\/Playground\/EcoReport/.test(cwd)) {
        findings.push(`${parsed.id}: legacy capitalized cwd ${cwd}`);
      }
    }
  }
  push(checks, activeDaily ? "ok" : "warn", "active EcoReport daily automation");
  push(
    checks,
    findings.length === 0 ? "ok" : "warn",
    "codex automation paths",
    findings.join("; "),
  );
}

function walkDirs(startDir, output = []) {
  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    const absolutePath = path.join(startDir, entry.name);
    const relativePath = rel(absolutePath);
    if (IGNORED_EMPTY_DIR_PATTERNS.some((pattern) => pattern.test(relativePath))) {
      continue;
    }
    if (entry.isDirectory()) {
      output.push(absolutePath);
      walkDirs(absolutePath, output);
    }
  }
  return output;
}

function checkEmptyDirs(checks) {
  const emptyDirs = walkDirs(ROOT_DIR).filter((dir) => {
    try {
      return fs.readdirSync(dir).length === 0;
    } catch {
      return false;
    }
  });
  push(
    checks,
    emptyDirs.length === 0 ? "ok" : "warn",
    "empty non-cache directories",
    emptyDirs.slice(0, 12).map(rel).join("; "),
  );
}

function summarize(checks) {
  const errorCount = checks.filter((item) => item.status === "error").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;
  if (errorCount > 0) return "error";
  if (warnCount > 0) return "warn";
  return "ok";
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checks = [];

  await checkRequiredPaths(checks);
  await checkPackageScriptRefs(checks);
  checkLegacyPaths(checks);
  checkGitWorktrees(checks);
  checkCodexAutomations(checks);
  checkEmptyDirs(checks);

  const payload = {
    generatedAt: new Date().toISOString(),
    rootDir: ROOT_DIR,
    overallStatus: summarize(checks),
    checks,
  };

  if (args.has("--json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# EcoReport filing audit: ${payload.overallStatus}`);
    for (const check of checks) {
      const detail = check.detail ? ` - ${check.detail}` : "";
      console.log(`- ${check.status}: ${check.label}${detail}`);
    }
  }

  if (payload.overallStatus === "error") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[audit-repo-filing] ${error.message}`);
  process.exit(1);
});
