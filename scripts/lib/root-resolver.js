import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizeCandidate(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? path.resolve(text) : null;
}

function isEcoReportRoot(candidate) {
  if (!candidate) return false;
  return (
    fs.existsSync(path.join(candidate, "config", "strategy.json")) &&
    fs.existsSync(path.join(candidate, "config", "market-calendar.json")) &&
    fs.existsSync(path.join(candidate, "scripts")) &&
    fs.existsSync(path.join(candidate, "dashboard"))
  );
}

function readCanonicalRootFromLocalPaths(baseDir) {
  const searchDirs = [
    normalizeCandidate(baseDir),
    normalizeCandidate(path.resolve(baseDir, "..")),
    normalizeCandidate(path.resolve(baseDir, "../..")),
  ].filter(Boolean);

  for (const dir of searchDirs) {
    const filePath = path.join(dir, "config", "local-paths.local.json");
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const candidate = normalizeCandidate(payload?.ecoreportRoot);
      if (candidate && isEcoReportRoot(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore malformed local path overrides and continue with fallbacks.
    }
  }

  return null;
}

export function resolveEcoReportRoot({
  cwd = process.cwd(),
  moduleUrl = import.meta.url,
} = {}) {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const cwdDir = normalizeCandidate(cwd);
  const candidates = [
    normalizeCandidate(process.env.ECOREPORT_ROOT),
    readCanonicalRootFromLocalPaths(cwdDir),
    readCanonicalRootFromLocalPaths(moduleDir),
    cwdDir,
    normalizeCandidate(path.resolve(cwdDir ?? ".", "..")),
    normalizeCandidate(path.resolve(cwdDir ?? ".", "../..")),
    normalizeCandidate(path.resolve(moduleDir, "..", "..")),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isEcoReportRoot(candidate)) {
      return candidate;
    }
  }

  return normalizeCandidate(path.resolve(moduleDir, "..", ".."));
}

export function getEcoReportRootDiagnostics({
  cwd = process.cwd(),
  moduleUrl = import.meta.url,
} = {}) {
  const resolvedRoot = resolveEcoReportRoot({ cwd, moduleUrl });
  const cwdDir = normalizeCandidate(cwd);

  return {
    cwd: cwdDir,
    moduleDir: path.dirname(fileURLToPath(moduleUrl)),
    envRoot: normalizeCandidate(process.env.ECOREPORT_ROOT),
    localPathsRootFromCwd: readCanonicalRootFromLocalPaths(cwdDir),
    resolvedRoot,
  };
}
