import fs from "node:fs";
import path from "node:path";

function normalizeValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  const commentIndex = value.indexOf(" #");
  if (commentIndex >= 0) {
    return value.slice(0, commentIndex).trim();
  }

  return value;
}

export function parseDotEnv(text) {
  const entries = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key) continue;

    const value = normalizeValue(normalized.slice(separatorIndex + 1));
    entries[key] = value;
  }

  return entries;
}

export function loadEnvFileIntoProcess(envPath, { override = false } = {}) {
  if (!envPath || !fs.existsSync(envPath)) {
    return {
      envPath,
      loaded: false,
      count: 0,
      keys: [],
    };
  }

  const payload = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  const keys = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!override && process.env[key] != null) continue;
    process.env[key] = value;
    keys.push(key);
  }

  return {
    envPath,
    loaded: true,
    count: keys.length,
    keys,
  };
}

export function loadProjectEnv(rootDir, options = {}) {
  return loadEnvFileIntoProcess(path.join(rootDir, ".env"), options);
}
