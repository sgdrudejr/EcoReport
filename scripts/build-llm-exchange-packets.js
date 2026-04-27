#!/usr/bin/env node
// Build compact AI-to-AI exchange packets from the daily EcoReport artifacts.
// Human-readable HTML/Markdown stays separate from short, source-id based JSON packets.

import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

const MAX_CLAIM_CHARS = 180;
const MAX_SOURCE_TITLE_CHARS = 120;

function compactText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit = MAX_CLAIM_CHARS) {
  const text = compactText(value);
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function normalizeEvidence(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value =
      value.evidence_report_ids ??
      value.evidenceIds ??
      value.evidence_ids ??
      value.source_report_ids ??
      value.sourceReports ??
      value.report_ids ??
      value.evidence ??
      value.report_id ??
      [];
  }
  if (typeof value === "string") value = [value];
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  for (const item of value) {
    const text = compactText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    rows.push(text);
  }
  return rows.slice(0, 6);
}

function roundNumber(value, digits = 3) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function approxTokens(payload) {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

function relative(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

function sourceRows(reportIndex) {
  const rows = Array.isArray(reportIndex) ? reportIndex : reportIndex?.reports ?? [];
  return rows
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: compactText(item.id ?? item.report_id ?? `report_${String(index + 1).padStart(3, "0")}`),
      title: truncate(item.title ?? item.report_title ?? item.name, MAX_SOURCE_TITLE_CHARS),
      broker: compactText(item.broker ?? item.publisher ?? item.source),
      category: compactText(item.category ?? item.report_type ?? "기타"),
      ticker: item.ticker ?? null,
      tickerName: item.ticker_name ?? item.tickerName ?? null,
      opinion: item.opinion ?? null,
      targetPrice: item.target_price ?? item.targetPrice ?? null,
    }))
    .filter((item) => item.id);
}

function compactClaim(row, fallbackIndex = 0) {
  const quality = row.quality ?? {};
  const evidence = normalizeEvidence(row.evidence);
  return {
    id: row.id ?? `claim_${fallbackIndex + 1}`,
    section: row.section ?? "unknown",
    category: row.category ?? null,
    entity: row.entity ?? null,
    claim: truncate(row.claim),
    evidenceIds: evidence,
    quality: {
      status: quality.status ?? row.status ?? "unknown",
      severity: quality.severity ?? row.severity ?? "low",
      flags: quality.flags ?? row.flags ?? [],
      evidenceCount: quality.evidenceCount ?? row.evidenceCount ?? evidence.length,
      sourceDiversity: quality.sourceDiversity ?? row.sourceDiversity ?? new Set(evidence).size,
    },
  };
}

function collectClaims({ aiExchange, fullReport }) {
  if (Array.isArray(aiExchange?.claims) && aiExchange.claims.length) {
    return aiExchange.claims.map(compactClaim);
  }
  const rows = fullReport?.final_report?.claim_quality?.claims ?? [];
  return Array.isArray(rows) ? rows.map(compactClaim) : [];
}

function collectAtoms(aiExchange, atomPayload) {
  const rows = Array.isArray(aiExchange?.topAtoms) && aiExchange.topAtoms.length
    ? aiExchange.topAtoms
    : atomPayload?.top_atoms ?? [];
  return rows
    .filter((item) => item && typeof item === "object")
    .slice(0, 40)
    .map((item, index) => ({
      id: item.id ?? item.atom_id ?? `atom_${index + 1}`,
      type: item.type ?? item.atom_type ?? null,
      category: item.category ?? null,
      entity: truncate(item.entity ?? item.title, 70),
      claim: truncate(item.claim, 170),
      direction: item.direction ?? "neutral",
      score: roundNumber(item.score ?? ((item.novelty_score ?? 0) * 0.55 + (item.conviction_score ?? 0) * 0.45)),
      evidenceIds: normalizeEvidence(item),
    }));
}

function actionPlanRows(stage4) {
  return (stage4?.accountPlans ?? []).map((plan) => ({
    accountKey: plan.key,
    label: plan.label,
    totalScore: plan.totalScore ?? null,
    stage2Bias: plan.stage2Bias ?? null,
    deployBudget: plan.deployBudget ?? 0,
    topGap: plan.topGap
      ? {
          category: plan.topGap.category,
          targetPct: plan.topGap.targetPct,
          currentPct: plan.topGap.currentPct,
          gapAmount: plan.topGap.gapAmount,
        }
      : null,
    validationPolicy: plan.validationPolicy ?? { buyVisibility: "validated_only" },
    validatorFlags: plan.validatorFlags ?? [],
    validatedBuys: (plan.stagedBuys ?? []).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      suggestedAmount: item.suggestedAmount ?? 0,
      entryCondition: item.entryCondition ?? null,
      urgency: item.urgency ?? null,
      reason: truncate(item.reason, 180),
      confidence: item.confidence ?? null,
      validationStatus: item.validationStatus ?? "validated",
      gateFlags: item.actionEvidenceGate?.flags ?? [],
    })),
    rejectedCandidates: (plan.rejectedAlternatives ?? []).slice(0, 8).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      reason: truncate(item.rejectionReason ?? item.reason, 180),
      confidence: item.confidence ?? null,
    })),
    holds: (plan.holds ?? []).slice(0, 5).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      score: item.score ?? null,
      reason: truncate(item.reason, 160),
    })),
    watches: (plan.watches ?? []).slice(0, 5).map((item) => ({
      code: item.code ?? null,
      name: item.name,
      score: item.score ?? null,
      reason: truncate(item.reason, 160),
    })),
  }));
}

function allocationPolicy(strategy) {
  const policy = strategy?.allocationPolicy ?? strategy?.allocation_policy ?? {};
  return {
    safetyTargetPct: policy.safety?.targetPct ?? policy.safetyTargetPct ?? 0.2,
    coreTargetPct: policy.core?.targetPct ?? policy.coreTargetPct ?? 0.3,
    satelliteTargetPct: policy.satellite?.targetPct ?? policy.satelliteTargetPct ?? 0.5,
    satelliteSingleCapPct: policy.satellite?.singlePositionCapPct ?? policy.satelliteSingleCapPct ?? null,
    clusterCapPct: policy.satellite?.clusterCapPct ?? policy.clusterCapPct ?? null,
  };
}

function compactBenchmarkPatterns(benchmark) {
  return {
    schemaVersion: benchmark?.schemaVersion ?? null,
    sourceNames: (benchmark?.sources ?? []).map((item) => item.name).filter(Boolean),
    dailyResearchLenses: (benchmark?.dailyResearchLenses ?? []).map((item) => ({
      key: item.key,
      question: item.question,
      requiredArtifacts: item.requiredArtifacts ?? [],
    })),
    packetDirectives: benchmark?.packetDirectives ?? {},
    riskLanguage: benchmark?.riskLanguage ?? {},
  };
}

function humanOutputManifest({ args, runMeta, dataQuality }) {
  const date = args.date;
  return {
    schemaVersion: 1,
    contract: "ecoreport.llm.exchange_manifest.v1",
    audience: "human_manifest",
    date,
    runDate: runMeta.runDate,
    effectiveMarketDate: runMeta.effectiveMarketDate,
    runId: runMeta.runId,
    tokenPolicy: {
      fullTextExcluded: true,
      maxClaimChars: MAX_CLAIM_CHARS,
      sourceIdsOnly: true,
      approxTokenBudget: 2000,
    },
    outputs: [
      {
        kind: "readable_report",
        path: `reports/daily/${date}-final.html`,
        purpose: "사람이 읽는 경제 리포트와 실행 전략 통합 화면",
      },
      {
        kind: "readable_report_markdown",
        path: `knowledge/daily/${date}-full-daily-report.md`,
        purpose: "사람이 읽는 경제 리포트 원문",
      },
      {
        kind: "execution_strategy",
        path: `reports/daily/${date}-stage4-execution-plan-table.md`,
        purpose: "계좌별 실행 전략 표",
      },
      {
        kind: "quality_audit",
        path: `data/analysis-state/${date}/data-quality-audit.json`,
        purpose: "정합성, 근거, 중복, 날짜, 카테고리, 위험 claim 검사",
        overallStatus: dataQuality?.overallStatus ?? null,
      },
    ],
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const runMeta = buildRunMetadata(args);
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const exchangeDir = path.join(stateDir, "llm-exchange");
  const packetPaths = {
    research: path.join(exchangeDir, "research-context.v1.json"),
    action: path.join(exchangeDir, "portfolio-action-context.v1.json"),
    claimReview: path.join(exchangeDir, "claim-review-context.v1.json"),
    sourceAudit: path.join(exchangeDir, "source-audit-map.v1.json"),
    humanManifest: path.join(exchangeDir, "human-output-manifest.v1.json"),
    manifest: path.join(exchangeDir, "manifest.json"),
  };

  const [
    contracts,
    strategy,
    fullReport,
    aiExchange,
    atomPayload,
    stage4,
    quant,
    dataQuality,
    reportIndex,
    benchmark,
  ] = await Promise.all([
    readJson(path.join(ROOT_DIR, "config", "llm-exchange-contracts.json"), {}),
    readJson(path.join(ROOT_DIR, "config", "strategy.json"), {}),
    readJson(path.join(stateDir, "stage1-4-full-daily-report.json"), null),
    readJson(path.join(stateDir, "stage1-4-ai-exchange.json"), null),
    readJson(path.join(stateDir, "stage1-4-insight-atoms.json"), null),
    readJson(path.join(stateDir, "stage4-execution-plan.json"), null),
    readJson(path.join(stateDir, "stage3-quant-scores.json"), null),
    readJson(path.join(stateDir, "data-quality-audit.json"), null),
    readJson(path.join(ROOT_DIR, "data", "reports", args.date, "index.json"), []),
    readJson(path.join(ROOT_DIR, "config", "ai-research-benchmark-patterns.json"), {}),
  ]);

  const claims = collectClaims({ aiExchange, fullReport });
  const atoms = collectAtoms(aiExchange, atomPayload);
  const sources = sourceRows(reportIndex);
  const riskyClaims = (dataQuality?.riskyClaims ?? []).map((item, index) =>
    compactClaim(
      {
        ...item,
        id: item.id ?? `risky_${index + 1}`,
        quality: {
          status: item.severity === "high" ? "hold" : "warn",
          severity: item.severity,
          flags: item.reasons ?? [],
          evidenceCount: item.evidenceCount ?? 0,
          sourceDiversity: item.sourceDiversity ?? 0,
        },
      },
      index,
    ),
  );

  const baseMeta = {
    schemaVersion: 1,
    date: args.date,
    runDate: runMeta.runDate,
    effectiveMarketDate: runMeta.effectiveMarketDate,
    runId: runMeta.runId,
  };
  const benchmarkPatterns = compactBenchmarkPatterns(benchmark);

  const researchContext = {
    ...baseMeta,
    contract: "ecoreport.llm.research_context.v1",
    audience: "ai_to_ai",
    tokenPolicy: {
      fullTextExcluded: true,
      maxClaimChars: MAX_CLAIM_CHARS,
      sourceIdsOnly: true,
      approxTokenBudget: 18000,
    },
    sourceSummary: {
      sourceReportCount: fullReport?.source_report_count ?? atomPayload?.source_report_count ?? sources.length,
      categoryCount: fullReport?.category_count ?? Object.keys(fullReport?.category_views ?? {}).length,
      sourceIndexPath: `data/reports/${args.date}/index.json`,
    },
    marketSummary: {
      overallSentiment: fullReport?.final_report?.overall_sentiment ?? null,
      oneLine: truncate(fullReport?.final_report?.one_line, 260),
      regime: stage4?.regime ?? quant?.regime ?? null,
    },
    claims: claims.slice(0, 80),
    topAtoms: atoms,
    riskyClaimIds: riskyClaims.map((item) => item.id),
    benchmarkLenses: benchmarkPatterns.dailyResearchLenses.filter((item) =>
      ["source_attribution", "repeatable_grid", "red_flags_and_objections"].includes(item.key),
    ),
    directives: benchmarkPatterns.packetDirectives.researchContext ?? [],
    nextQuestions:
      fullReport?.final_report?.presentation?.sections?.insight_radar?.questions?.slice(0, 8) ?? [],
  };

  const portfolioActionContext = {
    ...baseMeta,
    contract: "ecoreport.llm.portfolio_action_context.v1",
    audience: "ai_to_ai",
    tokenPolicy: {
      fullTextExcluded: true,
      maxClaimChars: MAX_CLAIM_CHARS,
      sourceIdsOnly: true,
      approxTokenBudget: 12000,
    },
    guardrails: {
      buyVisibility: "validated_only",
      noGuaranteedReturns: true,
      rejectIfActionEvidenceWeak: true,
      noRawPersonalAccountDataInExternalPrompts: true,
    },
    benchmarkLenses: benchmarkPatterns.dailyResearchLenses.filter((item) =>
      ["portfolio_monitoring", "validated_actions"].includes(item.key),
    ),
    directives: benchmarkPatterns.packetDirectives.portfolioActionContext ?? [],
    allocationPolicy: allocationPolicy(strategy),
    portfolioState: {
      portfolioScore: stage4?.portfolioScore ?? quant?.portfolio?.totalScore ?? null,
      regime: stage4?.regime?.name ?? quant?.regime?.name ?? null,
      emergencyDefense: stage4?.emergencyDefense ?? null,
    },
    accounts: actionPlanRows(stage4),
  };

  const claimReviewContext = {
    ...baseMeta,
    contract: "ecoreport.llm.claim_review_context.v1",
    audience: "small_prompt_review",
    tokenPolicy: {
      fullTextExcluded: true,
      maxClaimChars: MAX_CLAIM_CHARS,
      sourceIdsOnly: true,
      approxTokenBudget: 6000,
    },
    allowedDecisions: ["retain", "soften", "hold", "remove"],
    instruction: "전체 리포트를 다시 요약하지 말고 riskyClaims만 근거 ID 기준으로 판정한다.",
    benchmarkLenses: benchmarkPatterns.dailyResearchLenses.filter((item) =>
      ["red_flags_and_objections", "validated_actions"].includes(item.key),
    ),
    directives: benchmarkPatterns.packetDirectives.claimReviewContext ?? [],
    riskLanguage: benchmarkPatterns.riskLanguage,
    riskyClaims,
  };

  const sourceAuditMap = {
    ...baseMeta,
    contract: "ecoreport.llm.source_audit_map.v1",
    audience: "ai_to_ai",
    tokenPolicy: {
      fullTextExcluded: true,
      maxClaimChars: MAX_CLAIM_CHARS,
      sourceIdsOnly: true,
      approxTokenBudget: 12000,
    },
    directives: benchmarkPatterns.packetDirectives.sourceAuditMap ?? [],
    sources,
    claimEvidenceLinks: claims.slice(0, 120).map((item) => ({
      id: item.id,
      section: item.section,
      evidenceIds: item.evidenceIds,
      qualityStatus: item.quality?.status ?? "unknown",
      flags: item.quality?.flags ?? [],
    })),
  };

  const humanManifest = humanOutputManifest({ args, runMeta, dataQuality });
  const packets = [
    { key: "research_context", path: packetPaths.research, payload: researchContext },
    { key: "portfolio_action_context", path: packetPaths.action, payload: portfolioActionContext },
    { key: "claim_review_context", path: packetPaths.claimReview, payload: claimReviewContext },
    { key: "source_audit_map", path: packetPaths.sourceAudit, payload: sourceAuditMap },
    { key: "human_output_manifest", path: packetPaths.humanManifest, payload: humanManifest },
  ];

  for (const packet of packets) {
    await writeJson(packet.path, packet.payload);
  }

  const manifest = {
    ...baseMeta,
    contract: "ecoreport.llm.exchange_manifest.v1",
    audience: "human_manifest",
    generatedAt: runMeta.generatedAt,
    tokenPolicy: {
      fullTextExcluded: true,
      maxClaimChars: MAX_CLAIM_CHARS,
      sourceIdsOnly: true,
      approxTokenBudget: 5000,
    },
    schemaPath: "docs/schemas/llm-exchange.v1.schema.json",
    contractConfigPath: "config/llm-exchange-contracts.json",
    benchmarkPatternConfigPath: "config/ai-research-benchmark-patterns.json",
    guardrails: contracts.guardrails ?? {},
    packets: packets.map((packet) => ({
      key: packet.key,
      path: relative(packet.path),
      contract: packet.payload.contract,
      audience: packet.payload.audience,
      approxTokens: approxTokens(packet.payload),
      maxApproxTokens:
        contracts.aiPackets?.find((item) => relative(packet.path).endsWith(item.path?.replace("{{date}}", args.date)))?.maxApproxTokens ??
        packet.payload.tokenPolicy?.approxTokenBudget ??
        null,
    })),
    sourceLearnings: contracts.sourceLearnings ?? [],
    benchmarkPatterns,
  };
  await writeJson(packetPaths.manifest, manifest);
  process.stdout.write(`${packetPaths.manifest}\n`);
}

main().catch((error) => {
  console.error(`[build-llm-exchange-packets] 실패: ${error.message}`);
  process.exit(1);
});
