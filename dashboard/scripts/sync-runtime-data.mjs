import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const repoRoot = path.resolve(cwd, "..");
const runtimeRoot = path.join(cwd, "runtime-data");

const copySpecs = [
  { from: "config/market-calendar.json", to: "config/market-calendar.json" },
  { from: "config/strategy.json", to: "config/strategy.json" },
  { from: "data/analysis-state", to: "data/analysis-state" },
  { from: "data/backtest", to: "data/backtest" },
  { from: "data/dashboard", to: "data/dashboard" },
  { from: "data/external", to: "data/external" },
  { from: "data/feedback", to: "data/feedback" },
  { from: "data/fundamentals", to: "data/fundamentals" },
  { from: "data/intraday", to: "data/intraday" },
  { from: "data/market", to: "data/market" },
  { from: "data/normalized", to: "data/normalized" },
  { from: "data/portfolio", to: "data/portfolio" },
  { from: "data/reference", to: "data/reference" },
  { from: "data/stock-pulse", to: "data/stock-pulse" },
  { from: "data/technical", to: "data/technical" },
  { from: "knowledge/daily", to: "knowledge/daily" },
  { from: "knowledge/wiki", to: "knowledge/wiki" },
  { from: "reports/daily", to: "reports/daily" },
  { from: "reports/feedback-summary.md", to: "reports/feedback-summary.md" },
];

function looksLikeRepoRoot(candidate) {
  return (
    fs.existsSync(path.join(candidate, "config", "strategy.json")) &&
    fs.existsSync(path.join(candidate, "config", "market-calendar.json")) &&
    fs.existsSync(path.join(candidate, "data")) &&
    fs.existsSync(path.join(candidate, "knowledge")) &&
    fs.existsSync(path.join(candidate, "reports"))
  );
}

function copyEntry(sourcePath, targetPath) {
  const stats = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (stats.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
    });
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}

if (!looksLikeRepoRoot(repoRoot)) {
  if (fs.existsSync(runtimeRoot)) {
    console.log(`[runtime-data] existing bundle preserved at ${runtimeRoot}`);
    process.exit(0);
  }

  console.log("[runtime-data] source repo root not found, skipping bundle sync");
  process.exit(0);
}

fs.rmSync(runtimeRoot, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
});
fs.mkdirSync(runtimeRoot, { recursive: true });

let copiedCount = 0;

for (const spec of copySpecs) {
  const sourcePath = path.join(repoRoot, spec.from);
  if (!fs.existsSync(sourcePath)) {
    console.log(`[runtime-data] skip missing ${spec.from}`);
    continue;
  }

  const targetPath = path.join(runtimeRoot, spec.to);
  copyEntry(sourcePath, targetPath);
  copiedCount += 1;
  console.log(`[runtime-data] copied ${spec.from}`);
}

console.log(`[runtime-data] synced ${copiedCount} entries to ${runtimeRoot}`);
