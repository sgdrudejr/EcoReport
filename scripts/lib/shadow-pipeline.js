import path from "node:path";

import { writeJson, writeText } from "./pipeline-utils.js";

export function buildShadowPaths(rootDir, date) {
  const analysisDir = path.join(rootDir, "data", "analysis-state", date);
  const shadowDir = path.join(analysisDir, "shadow");

  return {
    analysisDir,
    shadowDir,
    chunkIndexDir: path.join(analysisDir, "chunk-index"),
    stage1Dir: path.join(shadowDir, "stage1"),
    stage2Dir: path.join(shadowDir, "stage2"),
    stage3Dir: path.join(shadowDir, "stage3"),
  };
}

export async function writeMirroredShadowJson({
  legacyPath,
  canonicalPath,
  payload,
}) {
  await writeJson(legacyPath, payload);
  if (canonicalPath && canonicalPath !== legacyPath) {
    await writeJson(canonicalPath, payload);
  }
}

export async function writeMirroredShadowText({
  legacyPath,
  canonicalPath,
  payload,
}) {
  await writeText(legacyPath, payload);
  if (canonicalPath && canonicalPath !== legacyPath) {
    await writeText(canonicalPath, payload);
  }
}

export function logShadowSummary(label, lines) {
  for (const line of lines) {
    console.log(`[${label}] ${line}`);
  }
}

