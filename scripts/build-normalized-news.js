#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  THEMATIC_TRIGGERS_BY_CODE,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  resolveSecurityCodeFromCandidates,
  writeJson,
} from "./lib/pipeline-utils.js";
import {
  buildEntityId,
  buildObservationId,
  clamp,
  compactText,
  createBundle,
  freshnessDays,
  makeEvidence,
  normalizedOutputPath,
  uniqueFlags,
} from "./lib/normalized-observations.js";

const POSITIVE_PATTERN =
  /(급증|확대|증가|호조|회복|재개|강화|승인|수주|공급 계약|투자 확대|가속|수혜|상향|최대|흑자)/i;
const NEGATIVE_PATTERN =
  /(둔화|감소|부진|위축|하락|리스크|우려|불안|중단|지연|압박|악화|제재|동결|급락|하향|적자)/i;

function publishedDate(entry) {
  return String(entry?.publishedAt ?? entry?.pubDate ?? entry?.isoDate ?? entry?.date ?? "").slice(0, 10);
}

function inferDirection(text) {
  if (NEGATIVE_PATTERN.test(text) && !POSITIVE_PATTERN.test(text)) return "negative";
  if (POSITIVE_PATTERN.test(text) && !NEGATIVE_PATTERN.test(text)) return "positive";
  if (POSITIVE_PATTERN.test(text) && NEGATIVE_PATTERN.test(text)) return "mixed";
  return "neutral";
}

function inferThemes(entry) {
  const haystack = `${entry?.title ?? ""} ${entry?.summary ?? ""} ${entry?.category ?? ""}`.toLowerCase();
  const themes = new Set([entry?.category].map(compactText).filter(Boolean));
  for (const [code, triggers] of Object.entries(THEMATIC_TRIGGERS_BY_CODE ?? {})) {
    const matched = Object.values(triggers ?? {})
      .flat()
      .some((keyword) => keyword && haystack.includes(String(keyword).toLowerCase()));
    if (matched) {
      themes.add(code);
    }
  }
  return [...themes].slice(0, 8);
}

function buildNewsObservation(bundleId, args, entry, index) {
  const title = compactText(entry?.title);
  const summary = compactText(entry?.summary ?? entry?.contentSnippet ?? entry?.description);
  const haystack = `${title} ${summary}`;
  const code = resolveSecurityCodeFromCandidates(title, summary);
  const direction = inferDirection(haystack);
  const score = Number(entry?.relevanceScore ?? entry?.score ?? 0);
  return {
    observationId: buildObservationId(bundleId, ["article", entry?.id ?? entry?.link ?? title, index + 1]),
    entityType: code ? "security" : "macro_event",
    entityId: buildEntityId(code ? "security" : "macro_event", code ?? title),
    entityName: code ?? title,
    accountKey: null,
    securityCode: code,
    category: entry?.category ?? null,
    themes: inferThemes(entry),
    direction,
    strength: clamp((Math.max(score, 2) + Math.min(haystack.length / 160, 3)) / 8, 0.24, 0.82),
    confidence: code ? 0.62 : 0.54,
    freshnessDays: freshnessDays(args.date, publishedDate(entry)),
    horizon: "1w",
    qualityFlags: uniqueFlags([
      "derived",
      code ? null : "macro_only",
      direction === "neutral" ? "unclear_direction" : null,
    ]),
    evidence: [
      makeEvidence("snippet", {
        title,
        text: summary,
        url: entry?.url ?? entry?.link ?? null,
        refPath: `data/news/${args.date}.json`,
      }),
    ],
    derivedFrom: [entry?.url ?? entry?.link ?? title],
    metadata: {
      source: entry?.source ?? null,
      category: entry?.category ?? null,
      publishedAt: entry?.publishedAt ?? entry?.pubDate ?? entry?.isoDate ?? null,
      relevanceScore: entry?.relevanceScore ?? entry?.score ?? null,
    },
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const inputPath = path.join(ROOT_DIR, "data", "news", `${args.date}.json`);
  const outputPath = normalizedOutputPath(args.date, "news", args.output);
  const payload = await readJson(inputPath, null);
  const entries = Array.isArray(payload) ? payload : payload?.entries ?? payload?.items ?? [];

  if (!entries.length) {
    throw new Error(`news artifact가 없습니다: ${inputPath}`);
  }

  const bundleId = `normalized:news:${args.date}`;
  const observations = entries
    .slice(0, 160)
    .map((entry, index) => buildNewsObservation(bundleId, args, entry, index));

  const bundle = createBundle({
    date: args.date,
    bundleId,
    source: "news",
    sourceType: "rss_news",
    generatedAt: metadata.generatedAt,
    runId: metadata.runId,
    qualitySummary: {
      status: observations.length > 0 ? "ok" : "warn",
      flags: uniqueFlags([
        observations.some((item) => item.qualityFlags.includes("macro_only")) ? "macro_only" : null,
        observations.some((item) => item.qualityFlags.includes("unclear_direction")) ? "unclear_direction" : null,
      ]),
    },
    observations,
  });

  await writeJson(outputPath, bundle);
  console.log(`Wrote ${observations.length} normalized News observations to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
