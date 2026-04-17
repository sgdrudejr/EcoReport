import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
const extraArgs = process.argv.slice(3);
const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(dashboardDir, "node_modules", "next", "dist", "bin", "next");

function normalizeCandidate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function looksLikeRepoRoot(candidate) {
  return (
    candidate &&
    fs.existsSync(path.join(candidate, "config", "strategy.json")) &&
    fs.existsSync(path.join(candidate, "config", "market-calendar.json")) &&
    fs.existsSync(path.join(candidate, "data")) &&
    fs.existsSync(path.join(candidate, "knowledge")) &&
    fs.existsSync(path.join(candidate, "reports"))
  );
}

function resolveRuntimeRoot() {
  const candidates = [
    normalizeCandidate(process.env.ECOREPORT_ROOT),
    normalizeCandidate(path.resolve(dashboardDir, "..")),
    normalizeCandidate(path.resolve(dashboardDir, "../..")),
    normalizeCandidate(path.join(dashboardDir, "runtime-data")),
    normalizeCandidate(path.join(dashboardDir, ".vercel-build", "runtime-data")),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (looksLikeRepoRoot(candidate)) {
      return candidate;
    }
  }

  return dashboardDir;
}

const repoRoot = resolveRuntimeRoot();

if (!mode) {
  console.error("[dashboard-run-next] missing next mode");
  process.exit(1);
}

const child = spawn(process.execPath, [nextBin, mode, ...extraArgs], {
  cwd: dashboardDir,
  stdio: "inherit",
  env: {
    ...process.env,
    ECOREPORT_ROOT: repoRoot,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
