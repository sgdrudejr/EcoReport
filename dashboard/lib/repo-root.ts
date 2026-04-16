import fs from "fs";
import path from "path";

function normalizeCandidate(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function isRepoRoot(candidate: string) {
  const hasRuntimeDataShape =
    fs.existsSync(path.join(candidate, "config", "strategy.json")) &&
    fs.existsSync(path.join(candidate, "config", "market-calendar.json")) &&
    fs.existsSync(path.join(candidate, "data")) &&
    fs.existsSync(path.join(candidate, "knowledge")) &&
    fs.existsSync(path.join(candidate, "reports"));

  if (!hasRuntimeDataShape) {
    return false;
  }

  return true;
}

function readCanonicalRootFromLocalPaths(baseDir: string) {
  const searchDirs = [
    normalizeCandidate(baseDir),
    normalizeCandidate(path.resolve(baseDir, "..")),
    normalizeCandidate(path.resolve(baseDir, "../..")),
  ].filter(Boolean) as string[];

  for (const dir of searchDirs) {
    const filePath = path.join(dir, "config", "local-paths.local.json");
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const candidate = normalizeCandidate(payload?.ecoreportRoot);
      if (candidate && isRepoRoot(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore malformed overrides and continue with fallbacks.
    }
  }

  return null;
}

export function resolveRepoRoot() {
  const cwd = path.resolve(process.cwd());
  const candidates = [
    normalizeCandidate(process.env.ECOREPORT_ROOT),
    readCanonicalRootFromLocalPaths(cwd),
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../.."),
    path.join(cwd, "runtime-data"),
    path.resolve(cwd, "../runtime-data"),
    path.resolve(cwd, "../../runtime-data"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (isRepoRoot(candidate)) {
      return candidate;
    }
  }

  return path.resolve(cwd, "..");
}
