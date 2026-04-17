import fs from "node:fs";
import path from "node:path";

import { ROOT_DIR } from "./pipeline-utils.js";

const LOCAL_PATHS_FILE = path.join(ROOT_DIR, "config", "local-paths.local.json");

function normalizeValue(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? path.resolve(text) : null;
}

export function loadLocalPaths() {
  if (!fs.existsSync(LOCAL_PATHS_FILE)) {
    return {};
  }

  try {
    const payload = JSON.parse(fs.readFileSync(LOCAL_PATHS_FILE, "utf8"));
    return {
      ecoreportRoot: normalizeValue(payload.ecoreportRoot),
      openTradingApiRoot: normalizeValue(payload.openTradingApiRoot),
      obsidianVaultDir: normalizeValue(payload.obsidianVaultDir),
      kisConfigRoot: normalizeValue(payload.kisConfigRoot),
    };
  } catch {
    return {};
  }
}

export function resolveLocalPath(...values) {
  for (const value of values) {
    const normalized = normalizeValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function getLocalPathsFile() {
  return LOCAL_PATHS_FILE;
}
