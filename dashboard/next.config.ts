import fs from "fs";
import path from "path";
import type { NextConfig } from "next";

const cwd = path.resolve(process.cwd());

function hasSharedArtifacts(candidate: string) {
  return (
    fs.existsSync(path.join(candidate, "config")) &&
    fs.existsSync(path.join(candidate, "data"))
  );
}

const repoRoot =
  [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "../..")].find(hasSharedArtifacts) ??
  path.resolve(cwd, "..");

function repoGlob(...parts: string[]) {
  return path.relative(cwd, path.join(repoRoot, ...parts)).split(path.sep).join("/");
}

const repoRuntimeIncludes = [
  repoGlob("config", "**/*"),
  repoGlob("data", "analysis-state", "**/*"),
  repoGlob("data", "market", "**/*"),
  repoGlob("data", "portfolio", "**/*"),
  repoGlob("data", "reports", "**", "manual-compressed.json"),
  repoGlob("data", "technical", "**/*"),
  repoGlob("knowledge", "daily", "**/*"),
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
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/**": repoRuntimeIncludes,
  },
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
