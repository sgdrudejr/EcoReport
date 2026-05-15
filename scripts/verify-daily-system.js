#!/usr/bin/env node
// 일일 EcoReport 운영 산출물이 정상적으로 생성되었는지 검증하고 요약 리포트를 저장합니다.

import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  enrichPortfolioWithSecurityCodes,
  parseDateArgs,
  readJson,
  readText,
  resolveSecurityCode,
  resolveSecurityCodeFromCandidates,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { allRefinementArtifactPaths } from "./lib/refinement-rounds.js";

function statusFromCondition(condition, failLevel = "error") {
  if (condition) return "ok";
  return failLevel;
}

async function fileExists(filePath) {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFirstExistingJson(paths) {
  for (const filePath of paths) {
    const payload = await readJson(filePath, null);
    if (payload) return payload;
  }
  return null;
}

function relative(filePath) {
  if (!filePath) return "(missing)";
  return path.relative(ROOT_DIR, filePath);
}

function extractJsonMeta(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      runId: null,
      runDate: null,
      effectiveMarketDate: null,
      generatedAt: null,
    };
  }

  return {
    runId: payload.runId ?? null,
    runDate: payload.runDate ?? null,
    effectiveMarketDate: payload.effectiveMarketDate ?? null,
    generatedAt: payload.generatedAt ?? null,
  };
}

function extractMarkdownMeta(text) {
  const content = String(text ?? "");
  const pick = (patterns) => {
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        const value = match[1].trim();
        if (!value || /^n\/a$/i.test(value)) return null;
        return value;
      }
    }
    return null;
  };

  return {
    runId: pick([/^run_id:\s+(.+)$/m, /^- run_id:\s+(.+)$/m, /^runId:\s+(.+)$/m]),
    runDate: pick([/^run_date:\s+(.+)$/m, /^- run_date:\s+(.+)$/m, /^runDate:\s+(.+)$/m]),
    effectiveMarketDate: pick([
      /^effective_market_date:\s+(.+)$/m,
      /^- effective_market_date:\s+(.+)$/m,
      /^effectiveMarketDate:\s+(.+)$/m,
    ]),
    generatedAt: pick([
      /^generated_at:\s+(.+)$/m,
      /^- generated_at:\s+(.+)$/m,
      /^generatedAt:\s+(.+)$/m,
      /^- generatedAt:\s+(.+)$/m,
    ]),
  };
}

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function summarizeItems(values, limit = 4) {
  if (!values.length) return "";
  const head = values.slice(0, limit).join(", ");
  return values.length > limit ? `${head} 외 ${values.length - limit}건` : head;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;
  const reportDir = path.join(ROOT_DIR, "data", "reports", date);
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);
  const refinementArtifacts = allRefinementArtifactPaths({ date });
  const round2 = refinementArtifacts.find((item) => item.spec.round === 2);
  const round3 = refinementArtifacts.find((item) => item.spec.round === 3);

  const paths = {
    portfolio: path.join(ROOT_DIR, "data", "portfolio", "latest.json"),
    reportIndex: path.join(reportDir, "index.json"),
    crawlManifest: path.join(reportDir, "crawl-manifest.json"),
    textManifest: path.join(reportDir, "text-manifest.json"),
    market: path.join(ROOT_DIR, "data", "market", `${date}.json`),
    technical: path.join(ROOT_DIR, "data", "technical", `${date}.json`),
    normalizedReports: path.join(ROOT_DIR, "data", "normalized", date, "reports.normalized.json"),
    normalizedStockeasy: path.join(ROOT_DIR, "data", "normalized", date, "stockeasy.normalized.json"),
    normalizedMarketVoice: path.join(ROOT_DIR, "data", "normalized", date, "marketvoice.normalized.json"),
    normalizedTechnical: path.join(ROOT_DIR, "data", "normalized", date, "technical.normalized.json"),
    normalizedKisEtf: path.join(ROOT_DIR, "data", "normalized", date, "kis_etf.normalized.json"),
    normalizedNews: path.join(ROOT_DIR, "data", "normalized", date, "news.normalized.json"),
    decisionFeatures: path.join(ROOT_DIR, "data", "features", date, "decision-features.json"),
    sourceConsensus: path.join(ROOT_DIR, "data", "features", date, "cross-source-consensus.json"),
    sourceConsensusSupplement: path.join(ROOT_DIR, "reports", "daily", `${date}-source-consensus-supplement.md`),
    sourceDivergence: path.join(ROOT_DIR, "data", "features", date, "source-divergence.json"),
    reportRag: path.join(reportDir, "rag", "chunk-manifest.json"),
    portfolioRag: path.join(ROOT_DIR, "data", "portfolio", "rag", date, "chunk-manifest.json"),
    parallelRag: path.join(ROOT_DIR, "knowledge", "rag", date, "parallel-manifest.json"),
    stage1: path.join(analysisDir, "stage1-report-extracts-v2.json"),
    stage2: path.join(analysisDir, "stage2-strategy-options.json"),
    impactMap: path.join(analysisDir, "impact-map.json"),
    marketVoice: path.join(analysisDir, "marketvoice-linked.json"),
    stage3: path.join(analysisDir, "stage3-quant-scores.json"),
    stage4: path.join(analysisDir, "stage4-execution-plan.json"),
    holdingCards: path.join(analysisDir, "holding-decision-cards.json"),
    dashboardView: path.join(ROOT_DIR, "data", "dashboard", `${date}-dashboard-view.json`),
    qwenAccountStrategy: path.join(analysisDir, "qwen-account-strategy.json"),
    qwenAccountStrategyTest: path.join(analysisDir, "qwen-account-strategy-test.json"),
    stockPulse: path.join(ROOT_DIR, "data", "stock-pulse", date, "stock-pulse.json"),
    rotationWatch: path.join(analysisDir, "rotation-watch.json"),
    dailyQuality: path.join(analysisDir, "daily-quality.json"),
    briefing: path.join(ROOT_DIR, "reports", "daily", `${date}-briefing.md`),
    executionMd: path.join(ROOT_DIR, "reports", "daily", `${date}-stage4-execution-plan.md`),
    wikiDaily: path.join(ROOT_DIR, "knowledge", "wiki", "daily", `${date}.md`),
    gemini: path.join(ROOT_DIR, "knowledge", "daily", `${date}-gemini-briefing.md`),
    geminiRich: path.join(ROOT_DIR, "knowledge", "daily", `${date}-gemini-briefing-rich.md`),
    geminiRichMeta: path.join(ROOT_DIR, "knowledge", "daily", `${date}-gemini-briefing-rich.md.meta.json`),
    deepResearchPrompt: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "07-stage1-5-gemini-deep-research-prompt.md",
    ),
    deepResearchResponse: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "09-stage1-5-gemini-deep-research-response.md",
    ),
    followUpMap: round2?.mapJson,
    followUpMapMarkdown: round2?.mapMarkdown,
    deepResearchFollowUpPrompt: round2?.prompt,
    deepResearchFollowUpResponse: round2?.response,
    round3Map: round3?.mapJson,
    round3MapMarkdown: round3?.mapMarkdown,
    round3Prompt: round3?.prompt,
    round3Response: round3?.response,
    deepResearchFinal: path.join(
      ROOT_DIR,
      "knowledge",
      "daily",
      "manual-kit",
      date,
      "10-stage1-6-final-research-briefing.md",
    ),
    wikiOperatingRules: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "operating-rules.md"),
    wikiResearchBacklog: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "research-backlog.md"),
    wikiDecisionJournal: path.join(ROOT_DIR, "knowledge", "wiki", "memory", "decision-journal.md"),
    dataQuality: path.join(analysisDir, "data-quality-audit.json"),
    fallbackSummary: path.join(analysisDir, "fallback-summary.json"),
    fallbackChecklist: path.join(ROOT_DIR, "docs", "FAILURE_FALLBACK_CHECKLIST.md"),
  };

  const [
    portfolio,
    reportIndex,
    crawlManifest,
    textManifest,
    market,
    technical,
    normalizedReports,
    normalizedStockeasy,
    normalizedMarketVoice,
    normalizedTechnical,
    normalizedKisEtf,
    normalizedNews,
    decisionFeatures,
    sourceConsensus,
    sourceConsensusSupplementText,
    sourceDivergence,
    reportRag,
    portfolioRag,
    parallelRag,
    stage1,
    stage2,
    impactMap,
    marketVoice,
    stage3,
    stage4,
    holdingCards,
    dashboardView,
    qwenAccountStrategy,
    stockPulse,
    rotationWatch,
    briefingText,
    wikiDailyText,
    dataQuality,
    fallbackSummary,
    geminiRichMeta,
  ] = await Promise.all([
    readJson(paths.portfolio, null),
    readJson(paths.reportIndex, []),
    readJson(paths.crawlManifest, null),
    readJson(paths.textManifest, null),
    readJson(paths.market, null),
    readJson(paths.technical, null),
    readJson(paths.normalizedReports, null),
    readJson(paths.normalizedStockeasy, null),
    readJson(paths.normalizedMarketVoice, null),
    readJson(paths.normalizedTechnical, null),
    readJson(paths.normalizedKisEtf, null),
    readJson(paths.normalizedNews, null),
    readJson(paths.decisionFeatures, null),
    readJson(paths.sourceConsensus, null),
    readText(paths.sourceConsensusSupplement, ""),
    readJson(paths.sourceDivergence, null),
    readJson(paths.reportRag, null),
    readJson(paths.portfolioRag, null),
    readJson(paths.parallelRag, null),
    readJson(paths.stage1, null),
    readJson(paths.stage2, null),
    readJson(paths.impactMap, null),
    readJson(paths.marketVoice, null),
    readJson(paths.stage3, null),
    readJson(paths.stage4, null),
    readJson(paths.holdingCards, null),
    readJson(paths.dashboardView, null),
    readFirstExistingJson([paths.qwenAccountStrategy, paths.qwenAccountStrategyTest]),
    readJson(paths.stockPulse, null),
    readJson(paths.rotationWatch, null),
    readText(paths.briefing, ""),
    readText(paths.wikiDaily, ""),
    readJson(paths.dataQuality, null),
    readJson(paths.fallbackSummary, null),
    readJson(paths.geminiRichMeta, null),
  ]);

  const reportCount = Array.isArray(reportIndex) ? reportIndex.length : 0;
  const extractedCount = Number(textManifest?.total_reports ?? 0);
  const successCount = Number(textManifest?.success_count ?? 0);
  const ocrCount = Number(textManifest?.ocr_used_count ?? 0);
  const stage1Extracts = Number(stage1?.extracts?.length ?? 0);
  const accountCount = Number(portfolio?.accounts?.length ?? 0);
  const stage2Mode = stage2 ? (stage2.provider ?? stage2.source ?? "real_llm") : "missing";
  const normalizedPortfolio = enrichPortfolioWithSecurityCodes(portfolio);
  const unresolvedPortfolioHoldings = (normalizedPortfolio?.accounts ?? []).flatMap((account) =>
    (account.holdings ?? [])
      .filter((holding) => !holding.code)
      .map((holding) => `${account.label ?? account.key}:${holding.name ?? "Unknown"}`),
  );
  const unresolvedStage4Mentions = (stage4?.accountPlans ?? []).flatMap((plan) =>
    ["stage2Candidates", "stagedBuys", "trims", "holds", "watches"].flatMap((bucket) =>
      (plan?.[bucket] ?? [])
        .filter((item) => !resolveSecurityCodeFromCandidates(item.code, item.name))
        .map((item) => `${plan.label ?? plan.key}:${bucket}:${item.name ?? item.code ?? "Unknown"}`),
    ),
  );
  const stage1ContaminationRate =
    stage1?.quality?.contaminationRate ??
    (stage1?.extracts?.length
      ? (stage1.extracts.reduce(
          (sum, item) => sum + Number(item?.quality?.contaminationEvidenceCount ?? 0),
          0,
        ) /
          Math.max(
            stage1.extracts.reduce(
              (sum, item) => sum + Number(item?.quality?.totalEvidenceCount ?? 0),
              0,
            ),
            1,
          ))
      : 0);
  const stage1WeakClaimRatio = stage1?.quality?.weakClaimRatio ?? 0;
  const stage3UnrelatedEvidenceRatio = stage3?.quality?.unrelatedEvidenceRatio ?? 0;
  const stage3BlockedEvidenceCount = stage3?.quality?.blockedEvidenceCount ?? 0;
  const stage4ActionConflictCount = (stage4?.accountPlans ?? []).reduce(
    (sum, plan) =>
      sum + (plan?.validatorFlags ?? []).filter((flag) => String(flag).includes("conflict")).length,
    0,
  );
  const stage4NoActionCount = (stage4?.accountPlans ?? []).filter((plan) => plan?.noAction).length;
  const lowConfidenceActionRejectionCount = (stage4?.accountPlans ?? []).reduce(
    (sum, plan) =>
      sum +
      (plan?.rejectedAlternatives ?? []).filter(
        (item) => typeof item?.confidence === "number" && item.confidence < 0.5,
      ).length,
    0,
  );
  const technicalCoverageFallback = technical?.coverage?.fallback ?? [];
  const technicalCoverageFailed = technical?.coverage?.failed ?? [];
  const technicalCoverageWarnCount = technicalCoverageFallback.length + technicalCoverageFailed.length;
  const normalizedBundles = [
    { key: "reports", payload: normalizedReports },
    { key: "stockeasy", payload: normalizedStockeasy },
    { key: "marketvoice", payload: normalizedMarketVoice },
    { key: "technical", payload: normalizedTechnical },
    { key: "kis_etf", payload: normalizedKisEtf },
    { key: "news", payload: normalizedNews },
  ].filter((item) => (item.payload?.observations?.length ?? 0) > 0);
  const alignedThemeCount = sourceConsensus?.consensus?.topAlignedThemes?.length ?? 0;
  const alignedSecurityCount = sourceConsensus?.consensus?.topAlignedSecurities?.length ?? 0;
  const sourceConflictCount = sourceDivergence?.divergence?.sourceConflicts?.length ?? 0;
  const holdingDataNeeds = (holdingCards?.cards ?? []).filter((card) => card?.decisionBucket === "WATCH_DATA");
  const offReportCards = (holdingCards?.cards ?? []).filter((card) => card?.decisionBucket === "WATCH_OFF_REPORT");
  const offReportWithoutExternal = offReportCards.filter((card) => !card?.externalCoverage?.available);
  const qwenAccountStrategyStatus = qwenAccountStrategy?.status ?? "missing";
  const qwenAccountStrategyOk = qwenAccountStrategyStatus === "ok";
  const qwenAccountStrategyUsedWeb = Boolean(qwenAccountStrategy?.webSearch);
  const stockPulseStatus = stockPulse?.status ?? "missing";
  const stockPulseItems = stockPulse?.counts?.activeHoldings ?? stockPulse?.items?.length ?? 0;
  const stockPulseMissingSourceKeys = Object.entries(stockPulse?.sourceStatus ?? {})
    .filter(([, status]) => status !== "ok" && status !== "not_configured")
    .map(([key]) => key);
  const rotationWatchStatus = rotationWatch?.status ?? "missing";
  const rotationWatchDates = rotationWatch?.includedDates?.length ?? 0;
  const rotationWatchMode = rotationWatch?.marketTrend?.mode ?? rotationWatch?.summary?.mode ?? "unknown";
  const rotationWatchDeliberations = rotationWatch?.sectorDeliberations?.length ?? 0;
  const rotationWatchTargets = rotationWatch?.rotationTargets?.watch?.length ?? 0;
  const rotationTransitionTriggers = rotationWatch?.transitionTriggerBoard?.rows?.length ?? 0;
  const dashboardHasAccountStrategy = Boolean(dashboardView?.accountStrategy);
  const dashboardHasStockPulse = Boolean(dashboardView?.stockPulse);
  const dashboardHasRotationWatch = Boolean(dashboardView?.rotationWatch);

  const artifactMetas = [
    { key: "stage1", label: "03. Report Extraction", path: relative(paths.stage1), meta: extractJsonMeta(stage1) },
    {
      key: "stage2",
      label: "07. Strategy Options",
      path: relative(paths.stage2),
      meta: extractJsonMeta(stage2),
    },
    { key: "impact_map", label: "09. Impact Mapping", path: relative(paths.impactMap), meta: extractJsonMeta(impactMap) },
    { key: "stage3", label: "10. Quant Scoring", path: relative(paths.stage3), meta: extractJsonMeta(stage3) },
    { key: "stage4", label: "11. Execution Plan", path: relative(paths.stage4), meta: extractJsonMeta(stage4) },
    { key: "dashboard_view", label: "12.2 Dashboard View", path: relative(paths.dashboardView), meta: extractJsonMeta(dashboardView) },
    {
      key: "qwen_account_strategy",
      label: "12.5 Qwen Account Strategy",
      path: relative(paths.qwenAccountStrategy),
      meta: extractJsonMeta(qwenAccountStrategy),
    },
    { key: "stock_pulse", label: "12.6 Stock Pulse", path: relative(paths.stockPulse), meta: extractJsonMeta(stockPulse) },
    { key: "rotation_watch", label: "12.7 Rotation Watch", path: relative(paths.rotationWatch), meta: extractJsonMeta(rotationWatch) },
    { key: "data_quality", label: "13. Quality Gates", path: relative(paths.dataQuality), meta: extractJsonMeta(dataQuality) },
    {
      key: "refinement_round2",
      label: "Refinement Round 2",
      path: relative(paths.followUpMap),
      meta: extractJsonMeta(await readJson(paths.followUpMap, null)),
    },
    {
      key: "refinement_round3",
      label: "Refinement Round 3",
      path: relative(paths.round3Map),
      meta: extractJsonMeta(await readJson(paths.round3Map, null)),
    },
    { key: "briefing", label: "Briefing", path: relative(paths.briefing), meta: extractMarkdownMeta(briefingText) },
    { key: "wiki_daily", label: "LLM Wiki Daily", path: relative(paths.wikiDaily), meta: extractMarkdownMeta(wikiDailyText) },
  ];
  const existingArtifactMetas = artifactMetas.filter((item) => item.meta.runDate || item.meta.generatedAt || item.meta.runId);
  const distinctRunIds = [...new Set(existingArtifactMetas.map((item) => item.meta.runId).filter(Boolean))];
  const coreArtifactKeys = new Set(["stage1", "stage2", "impact_map", "stage3", "stage4", "briefing"]);
  const coreDistinctRunIds = [
    ...new Set(
      existingArtifactMetas
        .filter((item) => coreArtifactKeys.has(item.key))
        .map((item) => item.meta.runId)
        .filter(Boolean),
    ),
  ];
  const missingRunIdLabels = existingArtifactMetas
    .filter((item) => !item.meta.runId)
    .map((item) => item.label);

  const stage4GeneratedAt = parseTimestamp(stage4?.generatedAt ?? null);
  const staleDownstreams = [
    { label: "Briefing", meta: extractMarkdownMeta(briefingText) },
    { label: "LLM Wiki Daily", meta: extractMarkdownMeta(wikiDailyText) },
  ].filter((item) => {
    const generatedAt = parseTimestamp(item.meta.generatedAt);
    return stage4GeneratedAt != null && generatedAt != null && generatedAt + 1000 < stage4GeneratedAt;
  });

  let freshnessStatus = "ok";
  let freshnessDetail = distinctRunIds.length > 0 ? `run-id ${distinctRunIds[0]} 일치` : "run-id 메타데이터 미검출";
  if (coreDistinctRunIds.length > 1) {
    freshnessStatus = "error";
    freshnessDetail = `core run-id 혼재: ${coreDistinctRunIds.join(", ")}`;
  } else if (distinctRunIds.length > 1) {
    freshnessStatus = "warn";
    freshnessDetail = `optional run-id 혼재: ${distinctRunIds.join(", ")}`;
  } else if (missingRunIdLabels.length > 0 || staleDownstreams.length > 0 || existingArtifactMetas.length === 0) {
    freshnessStatus = "warn";
    const details = [];
    if (existingArtifactMetas.length === 0) details.push("핵심 산출물 메타데이터 없음");
    if (missingRunIdLabels.length > 0) details.push(`run-id 누락: ${missingRunIdLabels.join(", ")}`);
    if (staleDownstreams.length > 0) {
      details.push(`stage4보다 오래된 downstream: ${staleDownstreams.map((item) => item.label).join(", ")}`);
    }
    freshnessDetail = details.join(" / ");
  }

  const deepResearchResponseExists = await fileExists(paths.deepResearchResponse);
  const followUpResponseExists = await fileExists(paths.deepResearchFollowUpResponse);
  const round3ResponseExists = await fileExists(paths.round3Response);
  const anyDeepResearchResponseExists = deepResearchResponseExists || followUpResponseExists || round3ResponseExists;
  const availableDeepResearchResponsePath = deepResearchResponseExists
    ? paths.deepResearchResponse
    : followUpResponseExists
      ? paths.deepResearchFollowUpResponse
      : round3ResponseExists
        ? paths.round3Response
        : paths.deepResearchResponse;
  const portfolioHoldingKeys = (normalizedPortfolio.accounts ?? []).flatMap((account) =>
    (account.holdings ?? []).map((holding) => ({
      key: `${account.key}:${holding.code ?? holding.name ?? "UNKNOWN"}`,
      label: `${account.label ?? account.key}:${holding.name ?? holding.code ?? "UNKNOWN"}`,
    })),
  );
  const stage4ReviewedKeys = new Set(
    (stage4?.accountPlans ?? []).flatMap((plan) =>
      ["stagedBuys", "trims", "holds", "watches"].flatMap((bucket) =>
        (plan?.[bucket] ?? []).map((item) => {
          const code = resolveSecurityCodeFromCandidates(item.code, item.name) ?? item.code ?? item.name ?? "UNKNOWN";
          return `${plan.key}:${code}`;
        }),
      ),
    ),
  );
  const missingStage4ReviewedHoldings = portfolioHoldingKeys.filter(
    (holding) => !stage4ReviewedKeys.has(holding.key),
  );

  const checks = [
    {
      key: "portfolio_snapshot",
      label: "포트폴리오 스냅샷",
      status: statusFromCondition(accountCount > 0),
      detail: accountCount > 0 ? `계좌 ${accountCount}개` : "latest.json 없음 또는 계좌 0개",
      path: relative(paths.portfolio),
    },
    {
      key: "report_index",
      label: "리포트 인덱스",
      status: statusFromCondition(reportCount > 0, "warn"),
      detail: reportCount > 0 ? `리포트 ${reportCount}건` : "수집 리포트 0건",
      path: relative(paths.reportIndex),
    },
    {
      key: "textification",
      label: "전문 텍스트화",
      status: statusFromCondition(successCount > 0 && successCount === extractedCount, "warn"),
      detail:
        textManifest != null
          ? `성공 ${successCount}/${extractedCount} · OCR ${ocrCount}건`
          : "text-manifest 없음",
      path: relative(paths.textManifest),
    },
    {
      key: "market_snapshot",
      label: "시장 데이터",
      status: statusFromCondition(Boolean(market)),
      detail: market ? "market 스냅샷 생성됨" : "market 스냅샷 누락",
      path: relative(paths.market),
    },
    {
      key: "technical_snapshot",
      label: "기술 점수",
      status: statusFromCondition(Boolean(technical?.scores)),
      detail: technical?.scores ? `종목 ${Object.keys(technical.scores).length}개` : "technical 스냅샷 누락",
      path: relative(paths.technical),
    },
    {
      key: "technical_data_repair",
      label: "기술지표 자료보강",
      status: statusFromCondition(technicalCoverageWarnCount === 0, "warn"),
      detail:
        technicalCoverageWarnCount === 0
          ? `자동 보강 성공 ${technical?.coverage?.refreshed?.length ?? Object.keys(technical?.scores ?? {}).length}개`
          : `fallback ${technicalCoverageFallback.length}개 / failed ${technicalCoverageFailed.length}개: ${summarizeItems(
              [...technicalCoverageFailed, ...technicalCoverageFallback].map((item) => item.name ?? item.code ?? "UNKNOWN"),
            )}`,
      path: relative(paths.technical),
    },
    {
      key: "rag_pipeline",
      label: "RAG 코퍼스",
      status: statusFromCondition(Boolean(reportRag && portfolioRag && parallelRag), "warn"),
      detail:
        reportRag && portfolioRag && parallelRag
          ? `리포트 ${reportRag.total_chunks ?? "-"} / 포트폴리오 ${portfolioRag.total_chunks ?? "-"} / 병렬 ${parallelRag.total_chunks ?? "-"}`
          : "일부 코퍼스 누락",
      path: relative(paths.parallelRag),
    },
    {
      key: "stage1",
      label: "03. Report Indexing 연구 노트",
      status: statusFromCondition(stage1Extracts > 0, "warn"),
      detail: stage1Extracts > 0 ? `추출 ${stage1Extracts}건` : "stage1 산출물 누락",
      path: relative(paths.stage1),
    },
    {
      key: "stage1_quality",
      label: "03. Report Indexing 품질",
      status:
        stage1ContaminationRate > 0.35
          ? "error"
          : stage1ContaminationRate > 0.2 || stage1WeakClaimRatio > 0.55
            ? "warn"
            : "ok",
      detail: `contamination ${stage1ContaminationRate.toFixed(2)} / weak_claim ${stage1WeakClaimRatio.toFixed(2)}`,
      path: relative(paths.stage1),
    },
    {
      key: "stage2",
      label: "07. Strategy Options",
      status: statusFromCondition(stage2Mode !== "missing", "warn"),
      detail: stage2 ? `실제 LLM 결과 (${stage2.model ?? stage2Mode ?? "unknown"})` : "stage2 결과 없음",
      path: relative(paths.stage2),
    },
    {
      key: "impact_map",
      label: "Impact Map",
      status: statusFromCondition(Boolean(impactMap?.reports?.length), "warn"),
      detail: impactMap?.reports?.length ? `리포트 ${impactMap.reports.length}건` : "impact-map 누락",
      path: relative(paths.impactMap),
    },
    {
      key: "marketvoice_external_feed",
      label: "외부 시황 수집",
      status: statusFromCondition((marketVoice?.topics?.length ?? 0) > 0, "warn"),
      detail:
        (marketVoice?.topics?.length ?? 0) > 0
          ? `외부 이슈 ${marketVoice.topics.length}건 / impact ${marketVoice.impactReports?.length ?? 0}건`
          : "marketvoice-linked 외부 이슈 없음",
      path: relative(paths.marketVoice),
    },
    {
      key: "cross_source_consensus",
      label: "교차소스 합의도",
      status: statusFromCondition(normalizedBundles.length >= 2 && Boolean(decisionFeatures), "warn"),
      detail:
        normalizedBundles.length >= 2 && decisionFeatures
          ? `소스 ${normalizedBundles.map((item) => item.key).join("+")} / 테마합의 ${alignedThemeCount}건 / 종목합의 ${alignedSecurityCount}건 / 충돌 ${sourceConflictCount}건`
          : `정규화 소스 ${normalizedBundles.length}개 / decision-features ${decisionFeatures ? "있음" : "누락"}`,
      path: relative(paths.decisionFeatures),
    },
    {
      key: "source_consensus_supplement",
      label: "새 보강 소스 리포트",
      status: statusFromCondition(sourceConsensusSupplementText.trim().length > 0, "warn"),
      detail: sourceConsensusSupplementText.trim().length > 0 ? "보완 리포트 생성됨" : "보완 리포트 누락",
      path: relative(paths.sourceConsensusSupplement),
    },
    {
      key: "stage3",
      label: "10. Quant Scoring",
      status: statusFromCondition(Boolean(stage3?.portfolio)),
      detail: stage3?.portfolio ? `포트폴리오 ${stage3.portfolio.totalScore ?? "-"}점` : "stage3 누락",
      path: relative(paths.stage3),
    },
    {
      key: "stage3_quality",
      label: "10. Quant Scoring 관계 품질",
      status: statusFromCondition(stage3UnrelatedEvidenceRatio <= 0.35, stage3UnrelatedEvidenceRatio > 0.5 ? "error" : "warn"),
      detail: `unrelated ${stage3UnrelatedEvidenceRatio.toFixed(2)} / blocked ${stage3BlockedEvidenceCount}건`,
      path: relative(paths.stage3),
    },
    {
      key: "stage4",
      label: "11. Execution Plan",
      status: statusFromCondition(Boolean(stage4?.accountPlans?.length)),
      detail:
        stage4?.accountPlans?.length
          ? `계좌 계획 ${stage4.accountPlans.length}개`
          : "stage4 누락",
      path: relative(paths.stage4),
    },
    {
      key: "stage4_holding_coverage",
      label: "11. Execution Plan 전 보유종목 커버리지",
      status: statusFromCondition(missingStage4ReviewedHoldings.length === 0, "error"),
      detail:
        missingStage4ReviewedHoldings.length === 0
          ? `보유 ${portfolioHoldingKeys.length}개 전부 검수 표기`
          : `누락 ${missingStage4ReviewedHoldings.length}개: ${missingStage4ReviewedHoldings.map((item) => item.label).join(", ")}`,
      path: relative(paths.stage4),
    },
    {
      key: "holding_decision_data_needs",
      label: "보유종목 자료보강 잔여",
      status: statusFromCondition(holdingDataNeeds.length === 0, "warn"),
      detail:
        holdingDataNeeds.length === 0
          ? "자료보강 판정 0건"
          : `자료보강 ${holdingDataNeeds.length}건: ${summarizeItems(
              holdingDataNeeds.map((card) => `${card.accountKey ?? "-"}:${card.name ?? card.code ?? "UNKNOWN"}`),
            )}`,
      path: relative(paths.holdingCards),
    },
    {
      key: "off_report_external_enrichment",
      label: "리포트밖 외부보강",
      status: statusFromCondition(offReportWithoutExternal.length === 0, "warn"),
      detail:
        offReportCards.length === 0
          ? "리포트밖 판정 0건"
          : offReportWithoutExternal.length === 0
            ? `리포트밖 ${offReportCards.length}건 모두 외부근거 연결`
            : `외부근거 미연결 ${offReportWithoutExternal.length}/${offReportCards.length}건: ${summarizeItems(
                offReportWithoutExternal.map((card) => `${card.accountKey ?? "-"}:${card.name ?? card.code ?? "UNKNOWN"}`),
              )}`,
      path: relative(paths.holdingCards),
    },
    {
      key: "dashboard_view",
      label: "판단 Cockpit JSON",
      status: statusFromCondition(Boolean(dashboardView?.meta?.date), "warn"),
      detail: dashboardView?.meta?.date
        ? `dashboard 생성 / accountStrategy ${dashboardHasAccountStrategy ? "연결" : "누락"} / stockPulse ${dashboardHasStockPulse ? "연결" : "누락"} / rotationWatch ${dashboardHasRotationWatch ? "연결" : "누락"}`
        : "dashboard-view 누락",
      path: relative(paths.dashboardView),
    },
    {
      key: "qwen_account_strategy",
      label: "Qwen 계좌 피드백",
      status: statusFromCondition(qwenAccountStrategyOk && qwenAccountStrategyUsedWeb, "warn"),
      detail:
        qwenAccountStrategyStatus === "missing"
          ? "qwen-account-strategy.json 누락"
          : `status ${qwenAccountStrategyStatus} / webSearch ${qwenAccountStrategyUsedWeb ? "on" : "off"} / model ${qwenAccountStrategy?.model ?? qwenAccountStrategy?.requestedModel ?? "-"}`,
      path: relative(paths.qwenAccountStrategy),
    },
    {
      key: "stock_pulse",
      label: "개별주 속보판",
      status: statusFromCondition(stockPulseStatus === "ok" && stockPulseItems > 0, "warn"),
      detail:
        stockPulseStatus === "missing"
          ? "stock-pulse.json 누락"
          : `status ${stockPulseStatus} / 보유 ${stockPulseItems}개 / 고긴급 ${stockPulse?.counts?.highUrgency ?? 0}개 / 소스누락 ${stockPulseMissingSourceKeys.join(", ") || "없음"}`,
      path: relative(paths.stockPulse),
    },
    {
      key: "rotation_watch",
      label: "3주 로테이션 감지판",
      status: statusFromCondition(rotationWatchStatus === "ok" && rotationWatchDates >= 2, "warn"),
      detail:
        rotationWatchStatus === "missing"
          ? "rotation-watch.json 누락"
          : `status ${rotationWatchStatus} / ${rotationWatchDates}일 관측 / 모드 ${rotationWatchMode} / 섹터질문 ${rotationWatchDeliberations}개 / 전환후보 ${rotationWatchTargets}개 / 전환트리거 ${rotationTransitionTriggers}개`,
      path: relative(paths.rotationWatch),
    },
    {
      key: "stage4_quality",
      label: "11. Execution Plan 논리 품질",
      status: statusFromCondition(stage4ActionConflictCount === 0, "error"),
      detail: `conflict ${stage4ActionConflictCount}건 / no_action ${stage4NoActionCount}건 / low_conf_reject ${lowConfidenceActionRejectionCount}건`,
      path: relative(paths.stage4),
    },
    {
      key: "data_quality",
      label: "13. Quality Gates",
      status: dataQuality
        ? dataQuality.overallStatus === "error"
          ? "error"
          : dataQuality.overallStatus === "warn"
          ? "warn"
          : "ok"
        : "warn",
      detail: dataQuality
        ? `overall ${dataQuality.overallStatus} / risky ${dataQuality.counts?.riskyClaimCount ?? 0}건`
        : "data-quality-audit.json 누락",
      path: relative(paths.dataQuality),
    },
    {
      key: "briefing",
      label: "일일 브리핑",
      status: statusFromCondition(await fileExists(paths.briefing)),
      detail: (await fileExists(paths.briefing)) ? "briefing.md 생성됨" : "briefing.md 누락",
      path: relative(paths.briefing),
    },
    {
      key: "llm_wiki_daily",
      label: "LLM Wiki Daily",
      status: statusFromCondition(await fileExists(paths.wikiDaily), "warn"),
      detail: (await fileExists(paths.wikiDaily)) ? "daily wiki 생성됨" : "daily wiki 누락",
      path: relative(paths.wikiDaily),
    },
    {
      key: "gemini_briefing",
      label: "경제 리포트 브리핑",
      status: statusFromCondition((await fileExists(paths.geminiRich)) || (await fileExists(paths.gemini)), "warn"),
      detail:
        (await fileExists(paths.geminiRich))
          ? geminiRichMeta?.source === "fallback"
            ? "rich briefing fallback 생성됨"
            : "rich Gemini 브리핑 생성됨"
          : (await fileExists(paths.gemini))
            ? "Gemini 브리핑 생성됨"
            : "Gemini 브리핑 없음",
      path: relative((await fileExists(paths.geminiRich)) ? paths.geminiRich : paths.gemini),
    },
    {
      key: "deep_research_prompt",
      label: "Deep Research 프롬프트",
      status: statusFromCondition(await fileExists(paths.deepResearchPrompt), "warn"),
      detail: (await fileExists(paths.deepResearchPrompt))
        ? "05. Deep Research 프롬프트 생성됨"
        : "Deep Research 프롬프트 없음",
      path: relative(paths.deepResearchPrompt),
    },
    {
      key: "deep_research_response",
      label: "Deep Research 결과",
      status: statusFromCondition(anyDeepResearchResponseExists, "warn"),
      detail: anyDeepResearchResponseExists
        ? deepResearchResponseExists
          ? "Gemini Deep Research 결과 저장됨"
          : followUpResponseExists
            ? "2차 Deep Research 결과를 대표 응답으로 사용"
            : "3차 Deep Research 결과를 대표 응답으로 사용"
        : "Deep Research 결과 없음",
      path: relative(availableDeepResearchResponsePath),
    },
    {
      key: "deep_research_final",
      label: "Deep Research 최종 브리핑",
      status: statusFromCondition(await fileExists(paths.deepResearchFinal), "warn"),
      detail: (await fileExists(paths.deepResearchFinal))
        ? "06. Briefing Synthesis 최종 브리핑 저장됨"
        : "06. Briefing Synthesis 최종 브리핑 없음",
      path: relative(paths.deepResearchFinal),
    },
    {
      key: "followup_research_map",
      label: "Follow-up Research Map",
      status: statusFromCondition(await fileExists(paths.followUpMap), "warn"),
      detail: (await fileExists(paths.followUpMap))
        ? "05. Deep Research follow-up reindex map 생성됨"
        : "follow-up reindex map 없음",
      path: relative(paths.followUpMap),
    },
    {
      key: "followup_deep_research_prompt",
      label: "Follow-up Deep Research 프롬프트",
      status: statusFromCondition(await fileExists(paths.deepResearchFollowUpPrompt), "warn"),
      detail: (await fileExists(paths.deepResearchFollowUpPrompt))
        ? "2차 Deep Research 프롬프트 생성됨"
        : "2차 Deep Research 프롬프트 없음",
      path: relative(paths.deepResearchFollowUpPrompt),
    },
    {
      key: "followup_deep_research_response",
      label: "Follow-up Deep Research 결과",
      status: statusFromCondition(await fileExists(paths.deepResearchFollowUpResponse), "warn"),
      detail: (await fileExists(paths.deepResearchFollowUpResponse))
        ? "2차 Deep Research 결과 저장됨"
        : "2차 Deep Research 결과 없음",
      path: relative(paths.deepResearchFollowUpResponse),
    },
    {
      key: "round3_research_map",
      label: "Round 3 Refinement Map",
      status: statusFromCondition(await fileExists(paths.round3Map), "warn"),
      detail: (await fileExists(paths.round3Map))
        ? "3차 refinement map 생성됨"
        : "3차 refinement map 없음",
      path: relative(paths.round3Map),
    },
    {
      key: "round3_deep_research_prompt",
      label: "Round 3 Deep Research 프롬프트",
      status: statusFromCondition(await fileExists(paths.round3Prompt), "warn"),
      detail: (await fileExists(paths.round3Prompt))
        ? "3차 Deep Research 프롬프트 생성됨"
        : "3차 Deep Research 프롬프트 없음",
      path: relative(paths.round3Prompt),
    },
    {
      key: "round3_deep_research_response",
      label: "Round 3 Deep Research 결과",
      status: statusFromCondition(await fileExists(paths.round3Response), "warn"),
      detail: (await fileExists(paths.round3Response))
        ? "3차 Deep Research 결과 저장됨"
        : "3차 Deep Research 결과 없음",
      path: relative(paths.round3Response),
    },
    {
      key: "freshness_run_id",
      label: "Freshness / Run ID",
      status: freshnessStatus,
      detail: freshnessDetail,
      path: relative(paths.stage4),
    },
    {
      key: "security_normalization",
      label: "종목 코드 정규화",
      status: statusFromCondition(
        unresolvedPortfolioHoldings.length === 0 && unresolvedStage4Mentions.length === 0,
        "warn",
      ),
      detail:
        unresolvedPortfolioHoldings.length === 0 && unresolvedStage4Mentions.length === 0
          ? "포트폴리오/실행계획 종목 코드 해석 완료"
          : `portfolio ${unresolvedPortfolioHoldings.length}건 / stage4 ${unresolvedStage4Mentions.length}건 미해결 (${summarizeItems([
              ...unresolvedPortfolioHoldings,
              ...unresolvedStage4Mentions,
            ])})`,
      path: relative(paths.portfolio),
    },
    {
      key: "fallback_recovery",
      label: "Fallback Recovery",
      status: statusFromCondition((fallbackSummary?.entries?.length ?? 0) === 0, "warn"),
      detail:
        (fallbackSummary?.entries?.length ?? 0) === 0
          ? "추가 복구 fallback 없음"
          : fallbackSummary.entries
              .map((entry) =>
                entry.sourceDate
                  ? `${entry.kind}:${entry.sourceDate} 기준 복구`
                  : `${entry.kind}:placeholder 복구`,
              )
              .join(" / "),
      path: relative(paths.fallbackSummary),
    },
    {
      key: "fallback_checklist",
      label: "Fallback Checklist",
      status: statusFromCondition(await fileExists(paths.fallbackChecklist), "warn"),
      detail: (await fileExists(paths.fallbackChecklist)) ? "실패 폴백 체크리스트 준비됨" : "폴백 체크리스트 없음",
      path: relative(paths.fallbackChecklist),
    },
    {
      key: "wiki_memory",
      label: "LLM Wiki Memory",
      status: statusFromCondition(
        (await fileExists(paths.wikiOperatingRules)) &&
          (await fileExists(paths.wikiResearchBacklog)) &&
          (await fileExists(paths.wikiDecisionJournal)),
        "warn",
      ),
      detail:
        (await fileExists(paths.wikiOperatingRules)) &&
        (await fileExists(paths.wikiResearchBacklog)) &&
        (await fileExists(paths.wikiDecisionJournal))
          ? "operating rules / research backlog / decision journal 생성됨"
          : "wiki memory 일부 누락",
      path: relative(paths.wikiDecisionJournal),
    },
  ];

  const canonicalRunId = distinctRunIds.length === 1 ? distinctRunIds[0] : args.runId ?? null;
  const summaryMeta = buildRunMetadata(args, { runId: canonicalRunId, date });
  const summary = {
    ...summaryMeta,
    overallStatus: checks.some((item) => item.status === "error")
      ? "error"
      : checks.some((item) => item.status === "warn")
        ? "warn"
        : "ok",
    counts: {
      accounts: accountCount,
      reports: reportCount,
      extractedReports: successCount,
      ocrUsedReports: ocrCount,
      stage1Extracts,
      unresolvedPortfolioHoldings: unresolvedPortfolioHoldings.length,
      unresolvedStage4Mentions: unresolvedStage4Mentions.length,
      stockPulseItems,
      stockPulseHighUrgency: stockPulse?.counts?.highUrgency ?? 0,
      rotationWatchDates,
      rotationWatchDeliberations,
      rotationWatchTargets,
      rotationTransitionTriggers,
    },
    artifacts: artifactMetas,
    checks,
  };

  const dailyQuality = {
    ...summaryMeta,
    stage1: {
      contaminationRate: Number.parseFloat(stage1ContaminationRate.toFixed(4)),
      weakClaimRatio: Number.parseFloat(stage1WeakClaimRatio.toFixed(4)),
    },
    stage3: {
      unrelatedEvidenceRatio: Number.parseFloat(stage3UnrelatedEvidenceRatio.toFixed(4)),
      blockedEvidenceCount: stage3BlockedEvidenceCount,
    },
    stage4: {
      actionConflictCount: stage4ActionConflictCount,
      noActionCount: stage4NoActionCount,
      lowConfidenceActionRejectionCount,
    },
  };

  const outputJson = path.join(analysisDir, "system-health.json");
  const outputMarkdown = path.join(ROOT_DIR, "knowledge", "daily", `${date}-system-health.md`);

  const markdown = [
    `# EcoReport Daily Health (${date})`,
    "",
    `- overallStatus: **${summary.overallStatus}**`,
    `- generatedAt: ${summary.generatedAt}`,
    `- runId: ${summary.runId ?? "N/A"}`,
    `- runDate: ${summary.runDate}`,
    `- effectiveMarketDate: ${summary.effectiveMarketDate}`,
    `- reports: ${reportCount}건 / textified ${successCount}건 / OCR ${ocrCount}건`,
    `- stage1 extracts: ${stage1Extracts}건`,
    "",
    "## Checks",
    ...checks.map(
      (item) =>
        `- [${item.status.toUpperCase()}] ${item.label}: ${item.detail} (${item.path})`,
    ),
  ].join("\n");

  await writeJson(outputJson, summary);
  await writeJson(paths.dailyQuality, dailyQuality);
  await writeText(outputMarkdown, `${markdown}\n`);

  console.log(outputJson);

  if (summary.overallStatus === "error") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`verify-daily-system 실패: ${error.message}`);
  process.exit(1);
});
