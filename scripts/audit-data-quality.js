#!/usr/bin/env node
// Deterministic quality gate for EcoReport daily artifacts.
// It checks evidence, duplication, date/category consistency, and action visibility
// before the final HTML/report presents conclusions as executable.

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  readText,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

const RISKY_CLAIM_RE =
  /(확실|필연|무조건|반드시|최선|몰빵|급등|폭등|구조적|강력|대세|주도|보장|무위험|대박|고수익\s*보장|will|must|guarantee|guaranteed|can't lose)/i;

function compactText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit = 220) {
  const text = compactText(value);
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
  return rows;
}

function sourceFamily(value) {
  const text = compactText(value).toLowerCase();
  if (/^report[_-]\d+$/u.test(text)) return text;
  return text.replace(/[_-]?\d+$/u, "") || compactText(value);
}

function fingerprint(value) {
  const text = compactText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\d[\d,.\-%]*/gu, "#");
  return Array.from(text.matchAll(/[0-9a-zA-Z가-힣]+/gu))
    .map((match) => match[0])
    .slice(0, 24)
    .join(" ");
}

function checkStatus(checks) {
  if (checks.some((item) => item.status === "error")) return "error";
  if (checks.some((item) => item.status === "warn")) return "warn";
  return "ok";
}

function addCheck(checks, key, status, detail, metric = null) {
  checks.push({ key, status, detail, ...(metric ? { metric } : {}) });
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    if (Array.isArray(value.reports)) return value.reports.length;
    if (Array.isArray(value.items)) return value.items.length;
    if (Array.isArray(value.files)) return value.files.length;
    if (Array.isArray(value.manifest)) return value.manifest.length;
  }
  return 0;
}

function collectClaims(fullReport, atomPayload) {
  const qualityClaims = fullReport?.final_report?.claim_quality?.claims;
  if (Array.isArray(qualityClaims) && qualityClaims.length) {
    return qualityClaims.map((item, index) => ({
      id: item.id ?? `claim_${index + 1}`,
      section: item.section ?? "unknown",
      category: item.category ?? null,
      claim: compactText(item.claim),
      evidence: normalizeEvidence(item.evidence),
      status: item.status ?? "unknown",
      severity: item.severity ?? "low",
      flags: asArray(item.flags),
      fingerprint: item.fingerprint ?? fingerprint(item.claim),
      sourceDiversity: item.sourceDiversity ?? new Set(normalizeEvidence(item.evidence).map(sourceFamily)).size,
    }));
  }

  const rows = [];
  const finalReport = fullReport?.final_report ?? {};
  const sections = finalReport.presentation?.sections ?? {};
  for (const [sectionKey, section] of Object.entries(sections)) {
    if (Array.isArray(section?.items)) {
      for (const item of section.items) {
        if (!item || typeof item !== "object") continue;
        rows.push({
          id: item.atom_id ?? `claim_${rows.length + 1}`,
          section: sectionKey,
          category: item.category ?? null,
          claim: compactText(item.claim ?? item.summary ?? item.view ?? item.name),
          evidence: normalizeEvidence(item),
          flags: [],
        });
      }
    }
    if (Array.isArray(section?.groups)) {
      for (const group of section.groups) {
        for (const item of asArray(group.claims ?? group.items)) {
          if (!item || typeof item !== "object") continue;
          rows.push({
            id: `claim_${rows.length + 1}`,
            section: sectionKey,
            category: group.category ?? null,
            claim: compactText(item.claim ?? `${item.topic ?? ""} ${item.side_a ?? ""} ${item.side_b ?? ""}`),
            evidence: normalizeEvidence(item),
            flags: [],
          });
        }
      }
    }
  }
  for (const atom of asArray(atomPayload?.top_atoms).slice(0, 40)) {
    if (!atom || typeof atom !== "object") continue;
    rows.push({
      id: atom.atom_id ?? `atom_${rows.length + 1}`,
      section: "insight_atoms",
      category: atom.category ?? null,
      claim: compactText(atom.claim),
      evidence: normalizeEvidence(atom),
      flags: [],
    });
  }
  return rows
    .filter((item) => item.claim)
    .map((item, index) => ({
      ...item,
      id: item.id ?? `claim_${index + 1}`,
      fingerprint: item.fingerprint ?? fingerprint(item.claim),
      sourceDiversity: new Set(normalizeEvidence(item.evidence).map(sourceFamily)).size,
    }));
}

function findRiskyClaims(claims) {
  return claims
    .map((item) => {
      const evidence = normalizeEvidence(item.evidence);
      const flags = new Set(asArray(item.flags));
      if (!evidence.length) flags.add("missing_evidence");
      if (evidence.length > 0 && evidence.length < 2) flags.add("thin_evidence");
      if (RISKY_CLAIM_RE.test(item.claim)) flags.add("risky_language");
      if (item.status === "hold") flags.add("hold");
      if (item.status === "weak_evidence") flags.add("weak_evidence");
      const sourceDiversity = new Set(evidence.map(sourceFamily)).size;
      if (sourceDiversity <= 1 && evidence.length > 1) flags.add("single_source_family");
      const reasons = Array.from(flags);
      const risky =
        reasons.includes("risky_language") ||
        reasons.includes("hold") ||
        reasons.includes("weak_evidence") ||
        (reasons.includes("missing_evidence") && item.claim.length > 120);
      if (!risky) return null;
      const severity =
        reasons.includes("hold") || (reasons.includes("risky_language") && evidence.length < 2)
          ? "high"
          : reasons.includes("missing_evidence") || reasons.includes("weak_evidence")
          ? "medium"
          : "low";
      return {
        id: item.id,
        section: item.section,
        category: item.category ?? null,
        claim: truncate(item.claim, 260),
        severity,
        reasons,
        evidenceCount: evidence.length,
        sourceDiversity,
        reviewPrompt: "근거 ID를 다시 확인하고, 과한 표현을 보류/약화/삭제 중 하나로 판정",
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function renderReviewPrompt({ date, runMeta, riskyClaims }) {
  const rows = riskyClaims.length
    ? riskyClaims
        .map(
          (item, index) =>
            `${index + 1}. id=${item.id} / severity=${item.severity} / reasons=${item.reasons.join(", ")}\n` +
            `claim: ${item.claim}\n` +
            `task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.\n`,
        )
        .join("\n")
    : "위험 claim 없음. 빈 배열을 반환.";
  return `# ${date} Risky Claim Mini Review Prompt

너는 EcoReport 품질 검수자다. 전체 리포트를 다시 요약하지 말고, 아래에 자동으로 표시된 위험 claim만 재검토한다.

- run_date: ${runMeta.runDate}
- effective_market_date: ${runMeta.effectiveMarketDate}
- run_id: ${runMeta.runId ?? "N/A"}

반환 형식은 JSON만 허용한다.

\`\`\`json
{
  "date": "${date}",
  "reviews": [
    {
      "id": "claim id",
      "decision": "retain|soften|hold|remove",
      "reason": "짧은 한국어 이유",
      "safer_claim": "soften인 경우만 더 보수적인 표현"
    }
  ]
}
\`\`\`

## Claims

${rows}
`;
}

function renderAuditMarkdown(payload) {
  const riskyRows = payload.riskyClaims.length
    ? payload.riskyClaims
        .slice(0, 10)
        .map((item) => `- [${item.severity}] ${item.id}: ${item.claim} (${item.reasons.join(", ")})`)
        .join("\n")
    : "- 위험 claim 없음";
  const checkRows = payload.checks
    .map((item) => `- [${item.status}] ${item.key}: ${item.detail}`)
    .join("\n");
  return `# ${payload.date} Data Quality Audit

- overall_status: ${payload.overallStatus}
- run_date: ${payload.runDate}
- effective_market_date: ${payload.effectiveMarketDate}
- run_id: ${payload.runId ?? "N/A"}
- execution_buy_policy: ${payload.guardrails.executionBuyPolicy}

## Checks

${checkRows}

## Risky Claims

${riskyRows}

## Mini Review Prompt

- ${payload.aiReviewPromptPath}
`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const runMeta = buildRunMetadata(args);
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const manualKitDir = path.join(ROOT_DIR, "knowledge", "daily", "manual-kit", args.date);
  const outputPath = args.output ?? path.join(stateDir, "data-quality-audit.json");
  const markdownPath = args.markdown ?? path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-data-quality-audit.md`);
  const reviewPromptPath = path.join(manualKitDir, "17-risky-claim-review-prompt.md");

  const paths = {
    fullReport: path.join(stateDir, "stage1-4-full-daily-report.json"),
    aiExchange: path.join(stateDir, "stage1-4-ai-exchange.json"),
    atoms: path.join(stateDir, "stage1-4-insight-atoms.json"),
    stage2: path.join(stateDir, "stage2-strategy-options.json"),
    stage4: path.join(stateDir, "stage4-execution-plan.json"),
    llmExchangeManifest: path.join(stateDir, "llm-exchange", "manifest.json"),
    llmResearchContext: path.join(stateDir, "llm-exchange", "research-context.v1.json"),
    llmActionContext: path.join(stateDir, "llm-exchange", "portfolio-action-context.v1.json"),
    llmClaimReviewContext: path.join(stateDir, "llm-exchange", "claim-review-context.v1.json"),
    reportIndex: path.join(ROOT_DIR, "data", "reports", args.date, "index.json"),
    textManifest: path.join(ROOT_DIR, "data", "reports", args.date, "text-manifest.json"),
    humanMarkdown: path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-full-daily-report.md`),
    finalHtml: path.join(ROOT_DIR, "reports", "daily", `${args.date}-final.html`),
    benchmarkPatterns: path.join(ROOT_DIR, "config", "ai-research-benchmark-patterns.json"),
  };

  const [
    fullReport,
    aiExchange,
    atomPayload,
    stage2,
    stage4,
    llmExchangeManifest,
    reportIndex,
    textManifest,
    humanMarkdown,
    benchmarkPatterns,
  ] = await Promise.all([
    readJson(paths.fullReport, null),
    readJson(paths.aiExchange, null),
    readJson(paths.atoms, null),
    readJson(paths.stage2, null),
    readJson(paths.stage4, null),
    readJson(paths.llmExchangeManifest, null),
    readJson(paths.reportIndex, null),
    readJson(paths.textManifest, null),
    readText(paths.humanMarkdown, ""),
    readJson(paths.benchmarkPatterns, null),
  ]);

  const checks = [];
  const artifactExistence = {};
  for (const [key, filePath] of Object.entries(paths)) {
    artifactExistence[key] = await fileExists(filePath);
  }

  const requiredMissing = ["fullReport", "atoms", "stage2", "stage4", "humanMarkdown"].filter(
    (key) => !artifactExistence[key],
  );
  addCheck(
    checks,
    "required_artifacts",
    requiredMissing.length ? "error" : "ok",
    requiredMissing.length ? `필수 산출물 누락: ${requiredMissing.join(", ")}` : "필수 산출물 존재",
    { missing: requiredMissing },
  );

  addCheck(
    checks,
    "human_ai_split",
    artifactExistence.aiExchange && artifactExistence.llmExchangeManifest && humanMarkdown.trim().length > 0 ? "ok" : "warn",
    artifactExistence.aiExchange && artifactExistence.llmExchangeManifest
      ? "사람용 Markdown, stage1-4-ai-exchange, llm-exchange 패킷이 분리됨"
      : "AI 교환용 stage1-4-ai-exchange.json 또는 llm-exchange/manifest.json이 아직 없음",
  );

  const packetWarnings = (llmExchangeManifest?.packets ?? []).filter((item) => {
    if (typeof item.approxTokens !== "number" || typeof item.maxApproxTokens !== "number") return false;
    return item.approxTokens > item.maxApproxTokens;
  });
  addCheck(
    checks,
    "llm_packet_budget",
    packetWarnings.length ? "warn" : artifactExistence.llmExchangeManifest ? "ok" : "warn",
    artifactExistence.llmExchangeManifest
      ? packetWarnings.length
        ? `토큰 예산 초과 패킷: ${packetWarnings.map((item) => item.key).join(", ")}`
        : `LLM 교환 패킷 ${llmExchangeManifest?.packets?.length ?? 0}개가 예산 내 생성됨`
      : "LLM 교환 패킷 manifest 누락",
    { packetWarnings },
  );

  const benchmarkPatternNames = new Set((llmExchangeManifest?.benchmarkPatterns?.sourceNames ?? []).filter(Boolean));
  const requiredBenchmarkLenses = ["source_attribution", "repeatable_grid", "portfolio_monitoring", "red_flags_and_objections", "validated_actions"];
  const packetLensKeys = new Set(
    [
      ...(llmExchangeManifest?.benchmarkPatterns?.dailyResearchLenses ?? []),
      ...(benchmarkPatterns?.dailyResearchLenses ?? []),
    ]
      .map((item) => item?.key)
      .filter(Boolean),
  );
  const missingBenchmarkLenses = requiredBenchmarkLenses.filter((key) => !packetLensKeys.has(key));
  addCheck(
    checks,
    "benchmark_pattern_alignment",
    benchmarkPatterns && missingBenchmarkLenses.length === 0 ? "ok" : "warn",
    benchmarkPatterns
      ? missingBenchmarkLenses.length
        ? `벤치마크 리서치 렌즈 누락: ${missingBenchmarkLenses.join(", ")}`
        : `AI 리서치 벤치마크 렌즈 ${packetLensKeys.size}개 반영, source learning ${benchmarkPatternNames.size || (benchmarkPatterns.sources ?? []).length}개`
      : "AI 리서치 벤치마크 설정 누락",
    {
      missingBenchmarkLenses,
      benchmarkSourceCount: benchmarkPatternNames.size || (benchmarkPatterns?.sources ?? []).length || 0,
    },
  );

  const metadataRows = [fullReport, aiExchange, stage4, llmExchangeManifest].filter(Boolean);
  const dateSet = new Set(metadataRows.map((item) => item.date).filter(Boolean));
  const runDateSet = new Set(metadataRows.map((item) => item.runDate).filter(Boolean));
  const effectiveSet = new Set(metadataRows.map((item) => item.effectiveMarketDate).filter(Boolean));
  addCheck(
    checks,
    "metadata_consistency",
    dateSet.size <= 1 && runDateSet.size <= 1 && effectiveSet.size <= 1 ? "ok" : "warn",
    `date=${Array.from(dateSet).join("|") || "N/A"}, runDate=${Array.from(runDateSet).join("|") || "N/A"}, effective=${Array.from(effectiveSet).join("|") || "N/A"}`,
  );

  const reportIndexCount = countRows(reportIndex);
  const textManifestCount = countRows(textManifest);
  const sourceReportCount = fullReport?.source_report_count ?? atomPayload?.source_report_count ?? 0;
  const coverageStatus = sourceReportCount >= 50 && (!reportIndexCount || sourceReportCount <= reportIndexCount + 5) ? "ok" : "warn";
  addCheck(
    checks,
    "report_coverage",
    coverageStatus,
    `source_report_count=${sourceReportCount}, report_index=${reportIndexCount || "N/A"}, text_manifest=${textManifestCount || "N/A"}`,
    { sourceReportCount, reportIndexCount, textManifestCount },
  );

  const claims = collectClaims(fullReport, atomPayload);
  const duplicateFingerprints = claims
    .map((item) => item.fingerprint ?? fingerprint(item.claim))
    .filter(Boolean)
    .reduce((counter, key) => counter.set(key, (counter.get(key) ?? 0) + 1), new Map());
  const duplicateCount = Array.from(duplicateFingerprints.values()).filter((count) => count > 1).length;
  addCheck(
    checks,
    "duplicate_claims",
    duplicateCount > Math.max(3, Math.round(claims.length * 0.08)) ? "warn" : "ok",
    `중복 claim fingerprint ${duplicateCount}개 / 총 claim ${claims.length}개`,
    { duplicateCount, claimCount: claims.length },
  );

  const noEvidenceCount = claims.filter((item) => normalizeEvidence(item.evidence).length === 0).length;
  const weakEvidenceCount = claims.filter((item) => normalizeEvidence(item.evidence).length < 2).length;
  const evidenceStatus = claims.length && noEvidenceCount / claims.length > 0.25 ? "warn" : "ok";
  addCheck(
    checks,
    "evidence_coverage",
    evidenceStatus,
    `근거 없음 ${noEvidenceCount}개, 근거 2개 미만 ${weakEvidenceCount}개`,
    { noEvidenceCount, weakEvidenceCount },
  );

  const categories = new Set([
    ...Object.keys(fullReport?.category_views ?? {}),
    ...claims.map((item) => item.category).filter(Boolean),
  ]);
  const miscCount = claims.filter((item) => item.category === "기타").length;
  addCheck(
    checks,
    "category_coverage",
    categories.size >= 5 && miscCount / Math.max(1, claims.length) < 0.35 ? "ok" : "warn",
    `카테고리 ${categories.size}개, 기타 비중 ${Math.round((miscCount / Math.max(1, claims.length)) * 100)}%`,
    { categoryCount: categories.size, miscCount },
  );

  const accountPlans = asArray(stage4?.accountPlans);
  const exposedBuys = accountPlans.flatMap((plan) => asArray(plan.stagedBuys));
  const invalidVisibleBuys = exposedBuys.filter((item) => item.validationStatus && item.validationStatus !== "validated");
  const validationPolicyOk = accountPlans.every(
    (plan) => plan.validationPolicy?.buyVisibility === "validated_only" || exposedBuys.length === 0,
  );

  const riskyClaims = findRiskyClaims(claims);
  const highRiskClaimCount = riskyClaims.filter((item) => item.severity === "high").length;
  const riskyClaimsQuarantined = invalidVisibleBuys.length === 0 && validationPolicyOk;
  addCheck(
    checks,
    "risky_claims",
    highRiskClaimCount > 0 && !riskyClaimsQuarantined ? "warn" : "ok",
    riskyClaims.length
      ? riskyClaimsQuarantined
        ? `위험/근거 약한 claim ${riskyClaims.length}개 격리 완료, 실행 전략 노출 차단`
        : `위험/근거 약한 claim ${riskyClaims.length}개를 mini prompt로 격리`
      : "위험 claim 없음",
    { riskyClaimCount: riskyClaims.length, highRiskClaimCount, quarantined: riskyClaimsQuarantined },
  );

  addCheck(
    checks,
    "execution_visibility",
    invalidVisibleBuys.length === 0 && validationPolicyOk ? "ok" : "warn",
    invalidVisibleBuys.length
      ? `검증 미통과 후보 ${invalidVisibleBuys.length}개가 BUY에 노출됨`
      : "실행 전략은 검증 통과 BUY만 노출",
    { exposedBuyCount: exposedBuys.length, invalidVisibleBuyCount: invalidVisibleBuys.length },
  );

  const prompt = renderReviewPrompt({ date: args.date, runMeta, riskyClaims });
  await writeText(reviewPromptPath, prompt);

  const payload = {
    schemaVersion: 1,
    date: args.date,
    runDate: runMeta.runDate,
    effectiveMarketDate: runMeta.effectiveMarketDate,
    runId: runMeta.runId,
    generatedAt: runMeta.generatedAt,
    overallStatus: checkStatus(checks),
    counts: {
      reportIndexCount,
      textManifestCount,
      sourceReportCount,
      claimCount: claims.length,
      riskyClaimCount: riskyClaims.length,
      exposedBuyCount: exposedBuys.length,
    },
    checks,
    riskyClaims,
    aiReviewPromptPath: path.relative(ROOT_DIR, reviewPromptPath),
    guardrails: {
      executionBuyPolicy: "validated_only",
      riskyClaimPolicy: "small_prompt_review_only",
      weakEvidencePolicy: "mark_in_report_and_block_direct_action",
      duplicatePolicy: "fingerprint_dedupe_before_presentation",
      benchmarkPatternPolicy: "source_attribution_repeatable_grid_portfolio_monitoring_red_flags_validated_actions",
    },
    artifacts: Object.fromEntries(
      Object.entries(paths).map(([key, filePath]) => [
        key,
        { path: path.relative(ROOT_DIR, filePath), exists: Boolean(artifactExistence[key]) },
      ]),
    ),
  };

  await writeJson(outputPath, payload);
  await writeText(markdownPath, renderAuditMarkdown(payload));
  process.stdout.write(`${outputPath}\n${reviewPromptPath}\n`);
}

main().catch((error) => {
  console.error(`[audit-data-quality] 실패: ${error.message}`);
  process.exit(1);
});
