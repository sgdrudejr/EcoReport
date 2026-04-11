#!/usr/bin/env node
// Stage 1.5: Stage 1 연구 노트에서 포트폴리오 확정 영향 레이어(impact-map.json)를 생성합니다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  STRICT_ALIASES_BY_CODE,
  THEME_CATEGORY_RULES,
  ROOT_DIR,
  buildRunMetadata,
  buildPortfolioMaps,
  clamp,
  containsKeyword,
  normalizeText,
  parseDateArgs,
  readText,
  truncate,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { cachedReadJson, loadAnalysisContext } from "./lib/analysis-context.js";

const CONFIDENCE_MAP = {
  HIGH: 0.86,
  MEDIUM: 0.68,
  LOW: 0.52,
};

const REPORT_TYPE_MULTIPLIERS = {
  stock: 1.05,
  industry: 0.92,
  theme: 0.88,
  strategy: 0.76,
  macro: 0.64,
};

// securities.json 기반 (STRICT_ALIASES_BY_CODE) — pipeline-utils.js에서 import
const STRICT_HOLDING_ALIASES = STRICT_ALIASES_BY_CODE;

// securities.json 기반 (THEME_CATEGORY_RULES) — pipeline-utils.js에서 import
// (재할당 없이 바로 THEME_CATEGORY_RULES 사용)

const MACRO_EVENT_RULES = [
  { label: "중동 지정학 리스크", pattern: /(이란|중동|호르무즈|지정학|전쟁)/i, regime: "HIGH_VOL", riskTag: "geopolitics" },
  { label: "유가 상승", pattern: /(유가|원유|WTI|브렌트)/i, regime: "HIGH_VOL", riskTag: "oil" },
  { label: "달러 강세", pattern: /(환율|원\/달러|달러 강세|달러화지수)/i, regime: "HIGH_VOL", riskTag: "fx" },
  { label: "금리 상방", pattern: /(금리 상승|매파|FOMC|연준|물가|CPI|인플레이션)/i, regime: "BEAR", riskTag: "rates" },
  { label: "AI 인프라 확대", pattern: /(AI 인프라|데이터센터|하이퍼스케일러|전력 수요|HBM)/i, regime: "BULL", riskTag: "ai" },
  { label: "방산 수요 확대", pattern: /(방산|국방|NATO|우주항공)/i, regime: "HIGH_VOL", riskTag: "defense" },
  { label: "원전 모멘텀", pattern: /(원자력|원전|SMR)/i, regime: "SIDEWAYS", riskTag: "nuclear" },
];

function normalizeConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 1);
  }
  if (typeof value === "string") {
    return CONFIDENCE_MAP[value.trim().toUpperCase()] ?? 0.58;
  }
  return 0.58;
}

function holdingCategory(accountKey, code) {
  const mapping = CATEGORY_BY_CODE[code];
  if (!mapping) return "기타";
  return mapping[accountKey] ?? mapping.default ?? "기타";
}

function explicitMentionStrength(text, holding) {
  const normalized = normalizeText(text);
  const exactNames = [holding.code, holding.name, holding.name?.replace(/\s+/g, "")]
    .filter(Boolean);
  const aliases = STRICT_HOLDING_ALIASES[holding.code] ?? [];

  let hits = 0;
  for (const token of exactNames) {
    if (containsKeyword(normalized, token)) {
      hits += 2;
    }
  }

  for (const alias of aliases) {
    if (containsKeyword(normalized, alias)) {
      hits += 1;
    }
  }

  return clamp(hits / 6, 0, 1);
}

function detectMacroEvents(text) {
  const detected = [];
  for (const rule of MACRO_EVENT_RULES) {
    if (rule.pattern.test(text)) {
      detected.push(rule);
    }
  }
  return detected;
}

function evidencePayload(extract) {
  const snippets = [
    ...(extract.key_points ?? []),
    ...(extract.what_changed ?? []),
    extract.key_thesis,
  ]
    .filter(Boolean)
    .map((item) => truncate(String(item).replace(/\s+/g, " ").trim(), 220))
    .slice(0, 3);

  const numbers = (extract.key_numbers ?? [])
    .map((item) => {
      if (typeof item === "string") return item;
      if (item?.label && item?.value) return `${item.label}: ${item.value}`;
      return item?.value ?? null;
    })
    .filter(Boolean)
    .slice(0, 4);

  return { snippets, numbers };
}

function pickDominantDirection(extract, impacts) {
  const candidates = impacts
    .map((impact) => impact?.direction)
    .filter(Boolean);

  if (candidates.includes("negative")) return "negative";
  if (candidates.includes("positive")) return "positive";
  if (candidates.includes("mixed")) return "mixed";
  return extract.sentiment_score >= 0.2 ? "positive" : extract.sentiment_score <= -0.2 ? "negative" : "neutral";
}

function accountHasCategory(coverage, accountKey, category) {
  for (const holding of coverage.holdingsByCode.values()) {
    if (holding.accountKey !== accountKey) continue;
    if (holdingCategory(accountKey, holding.code) === category) return true;
  }
  return false;
}

function addImpact(targets, impact) {
  const dedupeKey = [
    impact.target.type,
    impact.target.accountKey ?? "",
    impact.target.code ?? "",
    impact.target.name ?? "",
    impact.direction,
    impact.horizon,
  ].join("|");

  const existing = targets.get(dedupeKey);
  if (!existing || existing.strength * existing.confidence < impact.strength * impact.confidence) {
    targets.set(dedupeKey, impact);
  }
}

function holdingImpactFromCandidate({
  extract,
  candidate,
  holding,
  fullText,
  evidence,
  events,
}) {
  const baseConfidence = normalizeConfidence(extract.confidence);
  const explicit = explicitMentionStrength(fullText, holding);
  const reportType = extract.report_type ?? "strategy";
  const reportMultiplier = REPORT_TYPE_MULTIPLIERS[reportType] ?? 0.8;
  const directTickerMatch = extract.ticker && String(extract.ticker) === String(holding.code);
  const directHoldingMention = directTickerMatch || explicit >= 0.5;

  let confidence =
    baseConfidence +
    explicit * 0.18 +
    (directTickerMatch ? 0.14 : 0) -
    (reportType === "macro" ? 0.14 : 0) -
    (reportType === "strategy" ? 0.06 : 0);

  let strength =
    clamp((candidate.strength ?? 0.3) * reportMultiplier * (0.78 + explicit * 0.45), 0.16, 0.9);

  if (!directHoldingMention) {
    return null;
  }

  if (confidence * strength < 0.26) {
    return null;
  }

  confidence = clamp(confidence, 0.25, 0.95);

  return {
    target: {
      type: "holding",
      code: holding.code,
      accountKey: holding.accountKey,
      name: holding.name,
    },
    direction: candidate.direction ?? "neutral",
    strength: Number.parseFloat(strength.toFixed(3)),
    confidence: Number.parseFloat(confidence.toFixed(3)),
    horizon: candidate.horizon ?? extract.time_horizon_summary?.primary ?? "1m",
    decayHalfLifeDays: candidate.horizon === "6m" ? 120 : candidate.horizon === "3m" ? 75 : 30,
    channels: [...new Set([...(extract.themes ?? []), extract.sector, reportType].filter(Boolean))],
    regimeAssumptions: [...new Set(events.map((event) => event.regime))],
    evidence,
    riskTags: [...new Set(events.map((event) => event.riskTag))],
  };
}

function categoryImpactFromExtract({
  extract,
  fullText,
  evidence,
  events,
  accountKey,
  category,
  direction,
}) {
  const baseConfidence = normalizeConfidence(extract.confidence);
  const reportType = extract.report_type ?? "strategy";
  const themeMatchBonus =
    (extract.themes ?? []).some((theme) =>
      THEME_CATEGORY_RULES.some(
        (rule) => rule.theme === theme && rule.category === category && rule.accountKey === accountKey,
      ),
    )
      ? 0.08
      : 0;

  let confidence =
    baseConfidence +
    themeMatchBonus -
    (reportType === "macro" ? 0.08 : 0.02);

  let strength = clamp(
    (((extract.portfolio_impacts_candidate ?? [])[0]?.strength ?? 0.34) *
      (reportType === "macro" ? 0.78 : 0.9)),
    0.18,
    0.78,
  );

  if (confidence * strength < 0.22) {
    return null;
  }

  confidence = clamp(confidence, 0.28, 0.88);

  return {
    target: {
      type: "category",
      accountKey,
      name: category,
    },
    direction,
    strength: Number.parseFloat(strength.toFixed(3)),
    confidence: Number.parseFloat(confidence.toFixed(3)),
    horizon: extract.report_type === "macro" ? "1m" : "3m",
    decayHalfLifeDays: extract.report_type === "macro" ? 30 : 75,
    channels: [...new Set([...(extract.themes ?? []), extract.sector, reportType].filter(Boolean))],
    regimeAssumptions: [...new Set(events.map((event) => event.regime))],
    evidence,
    riskTags: [...new Set(events.map((event) => event.riskTag))],
  };
}

function accountImpactFromExtract({
  extract,
  accountKey,
  direction,
  evidence,
  events,
}) {
  const baseConfidence = normalizeConfidence(extract.confidence);
  const reportType = extract.report_type ?? "strategy";
  const eventBonus = events.length > 0 ? 0.06 : 0;
  let confidence = clamp(baseConfidence - 0.08 + eventBonus, 0.24, 0.82);
  let strength = clamp(
    (((extract.portfolio_impacts_candidate ?? [])[0]?.strength ?? 0.28) *
      (reportType === "macro" ? 0.68 : 0.56)),
    0.16,
    0.58,
  );

  if (confidence * strength < 0.18) {
    return null;
  }

  return {
    target: {
      type: "account",
      accountKey,
      name: accountKey,
    },
    direction,
    strength: Number.parseFloat(strength.toFixed(3)),
    confidence: Number.parseFloat(confidence.toFixed(3)),
    horizon: reportType === "macro" ? "1m" : "3m",
    decayHalfLifeDays: reportType === "macro" ? 21 : 45,
    channels: [...new Set([...(extract.themes ?? []), extract.sector, reportType].filter(Boolean))],
    regimeAssumptions: [...new Set(events.map((event) => event.regime))],
    evidence,
    riskTags: [...new Set(events.map((event) => event.riskTag))],
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const context = await loadAnalysisContext(args, {
    stage1: true,
    portfolio: true,
    stage2: true,
    marketVoice: true,
  });
  const { paths, cache, data } = context;
  const stateDir = paths.analysisDir;
  const stage1 = data.stage1;
  const portfolio = data.portfolio;
  const stage2 = data.stage2;
  const marketVoice = data.marketVoice;
  const reportsIndex = await cachedReadJson(
    cache,
    path.join(ROOT_DIR, "data", "reports", args.date, "index.json"),
    [],
  );

  const coverage = buildPortfolioMaps(portfolio, {});
  const indexById = new Map(reportsIndex.map((item) => [item.id, item]));
  const reports = [];

  for (const extract of stage1.extracts ?? []) {
    const reportMeta = indexById.get(extract.id);
    const fullTextPath = reportMeta?.full_text_path
      ? path.join(ROOT_DIR, reportMeta.full_text_path)
      : null;
    const fullText = fullTextPath ? await readText(fullTextPath, "") : "";
    const analysisText = [
      extract.title,
      extract.key_thesis,
      ...(extract.key_points ?? []),
      ...(extract.what_changed ?? []),
      fullText.slice(0, 12000),
    ]
      .filter(Boolean)
      .join("\n");
    const evidence = evidencePayload(extract);
    const events = detectMacroEvents(analysisText);
    const direction = pickDominantDirection(extract, extract.portfolio_impacts_candidate ?? []);
    const impactsByKey = new Map();

    for (const candidate of extract.portfolio_impacts_candidate ?? []) {
      if (candidate.target_type !== "holding" || !candidate.target_code) continue;
      const holding = coverage.holdingsByCode.get(String(candidate.target_code));
      if (!holding) continue;
      const confirmed = holdingImpactFromCandidate({
        extract,
        candidate,
        holding,
        fullText: analysisText,
        evidence,
        events,
      });
      if (confirmed) {
        addImpact(impactsByKey, confirmed);
      }
    }

    if (extract.report_type !== "stock") {
      for (const rule of THEME_CATEGORY_RULES) {
        const themeMatched =
          (extract.themes ?? []).includes(rule.theme) ||
          extract.sector === rule.theme ||
          containsKeyword(analysisText, rule.theme);
        if (!themeMatched) continue;
        if (!accountHasCategory(coverage, rule.accountKey, rule.category)) continue;
        const categoryImpact = categoryImpactFromExtract({
          extract,
          fullText: analysisText,
          evidence,
          events,
          accountKey: rule.accountKey,
          category: rule.category,
          direction,
        });
        if (categoryImpact) {
          addImpact(impactsByKey, categoryImpact);
        }
      }

      const relatedAccounts = new Set(extract.related_accounts ?? []);
      for (const accountKey of relatedAccounts) {
        const existingForAccount = [...impactsByKey.values()].some(
          (impact) => impact.target.accountKey === accountKey,
        );
        if (existingForAccount && extract.report_type !== "macro") continue;
        const accountImpact = accountImpactFromExtract({
          extract,
          accountKey,
          direction,
          evidence,
          events,
        });
        if (accountImpact) {
          addImpact(impactsByKey, accountImpact);
        }
      }
    }

    reports.push({
      reportId: extract.id,
      title: extract.title,
      broker: extract.broker ?? reportMeta?.broker ?? null,
      source: reportMeta?.source ?? "stage1",
      publishedDate: extract.date ?? reportMeta?.date ?? args.date,
      reportMeta: {
        report_type: extract.report_type ?? null,
        sector: extract.sector ?? null,
        themes: extract.themes ?? [],
        key_numbers: evidence.numbers,
      },
      impacts: [...impactsByKey.values()],
    });
  }

  const marketVoiceReports = Array.isArray(marketVoice?.impactReports)
    ? marketVoice.impactReports
    : [];
  reports.push(...marketVoiceReports);

  const runMeta = buildRunMetadata(args);
  const payload = {
    schemaVersion: 1,
    ...runMeta,
    provenance: {
      source: stage2 ? "hybrid" : "manual",
      stage1_input: "stage1-report-extracts-v2.json",
      marketvoice_input: marketVoiceReports.length > 0 ? "marketvoice-linked.json" : null,
      notes: "Stage 1 후보 영향과 머니토링 실시간 이벤트를 직접성·신뢰도·시계 기준으로 좁힌 확정 영향 레이어",
    },
    stage2MacroView: stage2?.macro_view ?? null,
    reports,
  };

  const markdown = [
    `# Impact Map (${args.date})`,
    "",
    `- 실행일: ${runMeta.runDate}`,
    `- 기준 거래일: ${runMeta.effectiveMarketDate}`,
    `- run_id: ${runMeta.runId ?? "N/A"}`,
    `- 리포트 수: ${reports.length}`,
    `- 영향 이벤트 수: ${reports.reduce((sum, report) => sum + report.impacts.length, 0)}`,
    "",
    ...reports
      .filter((report) => report.impacts.length > 0)
      .slice(0, 20)
      .flatMap((report) => [
        `## ${report.reportId} · ${report.title}`,
        ...report.impacts.map(
          (impact) =>
            `- ${impact.target.type}:${impact.target.accountKey ?? "-"}:${impact.target.name ?? impact.target.code ?? "-"} / ${impact.direction} / 강도 ${impact.strength} / 신뢰 ${impact.confidence}`,
        ),
        "",
      ]),
  ].join("\n");

  const jsonPath = args.output ?? path.join(stateDir, "impact-map.json");
  const mdPath = args.markdown ?? path.join(stateDir, "impact-map.md");
  await writeJson(jsonPath, payload);
  await writeText(mdPath, `${markdown}\n`);
  console.log(jsonPath);
}

main().catch((error) => {
  console.error(`impact-map 생성 실패: ${error.message}`);
  process.exit(1);
});
