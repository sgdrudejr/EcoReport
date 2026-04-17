import path from "node:path";

import { ROOT_DIR } from "./pipeline-utils.js";

const DIRECTION_MAP = {
  positive: "positive",
  bullish: "positive",
  pos: "positive",
  good: "positive",
  up: "positive",
  g: "positive",
  negative: "negative",
  bearish: "negative",
  neg: "negative",
  bad: "negative",
  down: "negative",
  r: "negative",
  neutral: "neutral",
  mixed: "mixed",
  n: "neutral",
  y: "neutral",
};

const CONFIDENCE_MAP = {
  high: 0.86,
  medium: 0.68,
  med: 0.68,
  low: 0.52,
  weak: 0.46,
  strong: 0.82,
};

const STRENGTH_MAP = {
  weak: 0.34,
  medium: 0.58,
  strong: 0.8,
};

export function normalizedOutputPath(date, source, rawPath = null) {
  if (rawPath) {
    return path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
  }
  return path.join(ROOT_DIR, "data", "normalized", date, `${source}.normalized.json`);
}

export function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

export function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeAccountKey(value) {
  const normalized = compactText(value).toUpperCase();
  if (!normalized) return null;
  if (normalized === "ISA") return "ISA";
  if (normalized === "PENSION" || value === "연금저축") return "PENSION";
  if (normalized === "TOSS" || value === "토스" || value === "토스증권") return "KIS_MAIN";
  if (
    normalized === "KIS_MAIN" ||
    value === "한투 일반" ||
    value === "한국투자" ||
    value === "한국투자증권"
  ) {
    return "KIS_MAIN";
  }
  return normalized;
}

export function toDirection(value, fallback = "neutral") {
  const key = compactText(value).toLowerCase();
  if (!key) return fallback;
  return DIRECTION_MAP[key] ?? fallback;
}

export function toConfidence(value, fallback = 0.58) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 1);
  }
  const normalized = compactText(value).toLowerCase();
  if (!normalized) return fallback;
  return CONFIDENCE_MAP[normalized] ?? fallback;
}

export function toStrength(value, fallback = 0.5) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 1);
  }
  const normalized = compactText(value).toLowerCase();
  if (!normalized) return fallback;
  return STRENGTH_MAP[normalized] ?? fallback;
}

export function numericSignalDirection(value, fallback = "neutral") {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 0) return "positive";
  if (number < 0) return "negative";
  return "neutral";
}

export function numericSignalStrength(value, scale = 10, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(Math.abs(number) / scale, 0, 1);
}

export function freshnessDays(referenceDate, sourceDate) {
  const ref = compactText(referenceDate);
  const source = compactText(sourceDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ref) || !/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return 0;
  }
  const refMs = Date.parse(`${ref}T00:00:00Z`);
  const sourceMs = Date.parse(`${source}T00:00:00Z`);
  if (!Number.isFinite(refMs) || !Number.isFinite(sourceMs)) return 0;
  return Math.max(0, Math.round((refMs - sourceMs) / 86400000));
}

export function buildEntityId(entityType, rawId) {
  const normalized = compactText(rawId)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${entityType}:${normalized || "unknown"}`;
}

export function buildObservationId(bundleId, parts) {
  const suffix = parts
    .map((item) =>
      compactText(item)
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    )
    .filter(Boolean)
    .join(":");
  return suffix ? `${bundleId}:${suffix}` : bundleId;
}

export function makeEvidence(kind, options = {}) {
  return {
    kind,
    title: options.title ?? null,
    text: options.text ?? null,
    value: options.value ?? null,
    refPath: options.refPath ?? null,
    url: options.url ?? null,
  };
}

export function uniqueFlags(flags) {
  return [...new Set((flags ?? []).filter(Boolean))];
}

export function createBundle({
  date,
  bundleId,
  source,
  sourceType,
  generatedAt,
  runId = null,
  qualitySummary = null,
  observations = [],
}) {
  return {
    date,
    bundleId,
    source,
    sourceType,
    generatedAt,
    runId,
    qualitySummary,
    observations,
  };
}
