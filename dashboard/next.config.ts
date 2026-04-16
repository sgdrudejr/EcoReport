import path from "path";
import type { NextConfig } from "next";
import { resolveRepoRoot } from "./lib/repo-root";

const cwd = path.resolve(process.cwd());
const repoRoot = resolveRepoRoot();
const tracingRoot =
  repoRoot === cwd || repoRoot.startsWith(`${cwd}${path.sep}`) ? cwd : repoRoot;

function repoGlob(...parts: string[]) {
  return path.relative(cwd, path.join(repoRoot, ...parts)).split(path.sep).join("/");
}

const repoRuntimeIncludes = [
  repoGlob("config", "**/*"),
  repoGlob("data", "analysis-state", "**/*"),
  repoGlob("data", "backtest", "**/*"),
  repoGlob("data", "external", "**/*"),
  repoGlob("data", "feedback", "**/*"),
  repoGlob("data", "intraday", "**/*"),
  repoGlob("data", "market", "**/*"),
  repoGlob("data", "portfolio", "**/*"),
  repoGlob("data", "reference", "**/*"),
  repoGlob("data", "reports", "**", "manual-compressed.json"),
  repoGlob("data", "technical", "**/*"),
  repoGlob("knowledge", "daily", "**/*"),
  repoGlob("knowledge", "wiki", "**/*"),
  repoGlob("reports", "feedback-summary.md"),
  repoGlob("reports", "daily", "**/*"),
];

const nextConfig: NextConfig = {
  // Allow local-network device testing in development so client-side assets,
  // HMR, and interactive tabs keep working from phone or non-localhost hosts.
  allowedDevOrigins: [
    "127.0.0.1",
    "*.local",
    "*.home.arpa",
    "10.*.*.*",
    "172.*.*.*",
    "192.168.*.*",
  ],
  // The dashboard reads generated artifacts from the repo root, not only from
  // the dashboard directory, so production traces need to include them.
  outputFileTracingRoot: tracingRoot,
  outputFileTracingIncludes: {
    "/**": repoRuntimeIncludes,
  },
  turbopack: {
    root: cwd,
  },
};

export default nextConfig;
