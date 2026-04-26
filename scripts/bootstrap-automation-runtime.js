#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_ROOT = path.resolve(SCRIPT_DIR, "..");

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: CURRENT_ROOT,
    encoding: "utf8",
    ...options,
  });

  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
    error: result.error?.message ?? null,
  };
}

function readLocalPaths(rootDir) {
  const filePath = path.join(rootDir, "config", "local-paths.local.json");
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveCanonicalRoot() {
  const candidates = [];
  const envRoot = process.env.ECOREPORT_CANONICAL_ROOT?.trim();
  if (envRoot) {
    candidates.push(path.resolve(envRoot));
  }

  const localPaths = readLocalPaths(CURRENT_ROOT);
  if (localPaths?.ecoreportRoot) {
    candidates.push(path.resolve(localPaths.ecoreportRoot));
  }

  const worktreeList = runProcess("git", ["worktree", "list", "--porcelain"]);
  if (worktreeList.ok) {
    const entries = worktreeList.stdout.split(/\n\n+/).filter(Boolean);
    for (const entry of entries) {
      const lines = entry.split(/\r?\n/);
      const worktreeLine = lines.find((line) => line.startsWith("worktree "));
      const branchLine = lines.find((line) => line.startsWith("branch "));
      if (!worktreeLine || !branchLine) {
        continue;
      }
      const worktreePath = worktreeLine.slice("worktree ".length).trim();
      const branchRef = branchLine.slice("branch ".length).trim();
      const normalized = path.resolve(worktreePath);
      const detached = lines.some((line) => line.trim() === "detached");
      if (detached) {
        continue;
      }
      if (normalized === CURRENT_ROOT) {
        candidates.push(normalized);
        continue;
      }
      if (branchRef.startsWith("refs/heads/")) {
        candidates.push(normalized);
      }
    }
  }

  candidates.push(CURRENT_ROOT);

  for (const candidate of candidates) {
    if (
      candidate &&
      fs.existsSync(path.join(candidate, "package.json")) &&
      fs.existsSync(path.join(candidate, "scripts")) &&
      fs.existsSync(path.join(candidate, "config", "strategy.json"))
    ) {
      return candidate;
    }
  }

  return CURRENT_ROOT;
}

async function ensureParent(targetPath, dryRun) {
  const parent = path.dirname(targetPath);
  if (dryRun) {
    return;
  }
  await fsp.mkdir(parent, { recursive: true });
}

async function linkFromCanonical({ label, relativePath, sourceRoot, dryRun }) {
  const sourcePath = path.join(sourceRoot, relativePath);
  const targetPath = path.join(CURRENT_ROOT, relativePath);
  const existing = fs.existsSync(targetPath);

  if (existing) {
    return {
      label,
      relativePath,
      status: "ok",
      detail: "already present",
      targetPath,
      sourcePath,
    };
  }

  if (!fs.existsSync(sourcePath)) {
    return {
      label,
      relativePath,
      status: "warn",
      detail: `missing in canonical root: ${sourcePath}`,
      targetPath,
      sourcePath,
    };
  }

  await ensureParent(targetPath, dryRun);
  if (!dryRun) {
    const stat = await fsp.lstat(sourcePath);
    const type = stat.isDirectory() ? "dir" : "file";
    await fsp.symlink(sourcePath, targetPath, type);
  }

  return {
    label,
    relativePath,
    status: "linked",
    detail: dryRun ? `would link ${sourcePath}` : `linked from ${sourcePath}`,
    targetPath,
    sourcePath,
  };
}

function getPythonBin(rootDir) {
  const venvPython = path.join(rootDir, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return "python3";
}

function pythonModuleMissing(pythonBin, moduleName) {
  const probe = runProcess(pythonBin, [
    "-c",
    [
      "import importlib.util, sys",
      `mod = importlib.util.find_spec(${JSON.stringify(moduleName)})`,
      "sys.exit(0 if mod else 1)",
    ].join("; "),
  ]);
  return !probe.ok;
}

function installPythonModules(pythonBin, modules) {
  return runProcess(pythonBin, ["-m", "pip", "install", ...modules], {
    env: process.env,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const canonicalRoot = resolveCanonicalRoot();
  const relativeAssets = [
    { label: "Project env", relativePath: ".env" },
    { label: "Python venv", relativePath: ".venv" },
    { label: "Node modules", relativePath: "node_modules" },
    { label: "KIS helper", relativePath: "open-trading-api" },
    { label: "Telegram secrets", relativePath: path.join("config", "telegram_notify.env") },
    { label: "Local paths", relativePath: path.join("config", "local-paths.local.json") },
  ];

  const assetResults = [];
  for (const asset of relativeAssets) {
    assetResults.push(
      await linkFromCanonical({
        ...asset,
        sourceRoot: canonicalRoot,
        dryRun: args.dryRun,
      }),
    );
  }

  const pythonBin = getPythonBin(CURRENT_ROOT);
  const missingModules = ["requests", "google.genai"].filter((moduleName) =>
    pythonModuleMissing(pythonBin, moduleName),
  );
  let pythonInstall = {
    status: "ok",
    detail: "python modules ready",
    missingModules: [],
    pythonBin,
  };

  if (missingModules.length > 0) {
    if (args.dryRun) {
      pythonInstall = {
        status: "warn",
        detail: `would install ${missingModules.join(", ")}`,
        missingModules,
        pythonBin,
      };
    } else {
      const installResult = installPythonModules(pythonBin, missingModules);
      pythonInstall = {
        status: installResult.ok ? "fixed" : "error",
        detail: installResult.ok
          ? `installed ${missingModules.join(", ")}`
          : installResult.stderr || installResult.stdout || installResult.error || "pip install failed",
        missingModules,
        pythonBin,
      };
    }
  }

  const payload = {
    currentRoot: CURRENT_ROOT,
    canonicalRoot,
    dryRun: args.dryRun,
    assets: assetResults,
    python: pythonInstall,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (pythonInstall.status === "error") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
