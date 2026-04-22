#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, limit = 220) {
  const text = compact(value);
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function scoreExtractPriority(extract) {
  const explicitPriority = Number(extract?.priority_score);
  if (Number.isFinite(explicitPriority)) {
    return Math.round(explicitPriority);
  }

  let score = 0;
  score += (extract?.related_holdings_in_my_portfolio?.length ?? 0) * 12;
  score += (extract?.portfolio_impacts_candidate?.length ?? 0) * 10;
  score += (extract?.related_accounts?.length ?? 0) * 5;

  const reportType = String(extract?.report_type ?? "").toLowerCase();
  if (reportType === "macro" || reportType === "strategy") score += 20;
  else if (reportType === "industry") score += 12;
  else if (reportType === "theme") score += 10;

  const confidence = String(extract?.confidence ?? "").toUpperCase();
  if (confidence === "HIGH") score += 6;
  else if (confidence === "MEDIUM") score += 3;

  const sentiment = Number(extract?.sentiment_score ?? 0);
  if (Number.isFinite(sentiment)) {
    score += Math.round(Math.abs(sentiment) * 10);
  }

  return score;
}

function inferLabelFromExtract(extract) {
  const theme = Array.isArray(extract?.themes) ? compact(extract.themes[0]) : "";
  if (theme) return truncate(theme, 36);
  const sector = compact(extract?.sector);
  if (sector && sector !== "매크로") return truncate(sector, 36);
  return truncate(extract?.title ?? "리서치 토픽", 36);
}

function inferTopicType(extract) {
  const reportType = String(extract?.report_type ?? "").toLowerCase();
  if (reportType === "macro" || reportType === "strategy") return "macro";
  if ((extract?.related_holdings_in_my_portfolio?.length ?? 0) > 0 || (extract?.portfolio_impacts_candidate?.length ?? 0) > 0) {
    return "security";
  }
  if (reportType === "industry" || reportType === "theme") return "sector";
  return "new_candidate";
}

function unique(values, limit = 8) {
  const out = [];
  const seen = new Set();
  for (const raw of values ?? []) {
    const text = compact(raw);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function buildCompanyNames(report) {
  return unique(
    (report?.company_mentions ?? []).map((item) => item?.name),
    5,
  );
}

function compactReportSummary(reportPayload) {
  const report = reportPayload?.report ?? {};
  const parts = [];

  const core = truncate(report?.core_summary ?? "", 220);
  if (core) parts.push(core);

  const macro = unique(report?.macro_view ?? [], 2).map((item) => truncate(item, 90));
  if (macro.length) parts.push(`매크로: ${macro.join(" / ")}`);

  const sector = unique(report?.sector_view ?? [], 2).map((item) => truncate(item, 90));
  if (sector.length) parts.push(`섹터: ${sector.join(" / ")}`);

  const companies = buildCompanyNames(report);
  if (companies.length) parts.push(`관련 종목: ${companies.join(", ")}`);

  return truncate(parts.join(" "), 420);
}

function buildStage1Summary(extract) {
  return truncate(
    compact(extract?.key_thesis) ||
      compact(Array.isArray(extract?.key_points) ? extract.key_points[0] : "") ||
      compact(extract?.new_info) ||
      compact(extract?.primary_claim?.summary),
    240,
  );
}

function buildPortfolioRelevance(extract) {
  const holdings = Array.isArray(extract?.related_holdings_in_my_portfolio)
    ? extract.related_holdings_in_my_portfolio
        .map((item) => ({
          name: compact(item?.name),
          code: compact(item?.code),
          category: compact(item?.category),
        }))
        .filter((item) => item.name || item.code)
    : [];

  return {
    score: scoreExtractPriority(extract),
    relatedAccounts: unique(extract?.related_accounts ?? [], 5),
    relatedHoldings: holdings,
    impactCandidates: unique(extract?.portfolio_impacts_candidate ?? [], 5),
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const extractsPath = path.join(analysisDir, "stage1-report-extracts-v2.json");
  const selectedSummariesPath = path.join(analysisDir, "stage1-chunk-summaries.json");
  const reportSummariesDir = path.join(ROOT_DIR, "reports", "report_summaries", args.date);
  const outputPath =
    args.output
      ? path.isAbsolute(args.output)
        ? args.output
        : path.join(ROOT_DIR, args.output)
      : path.join(analysisDir, "stage2-enriched-report-index.json");

  const stage1 = await readJson(extractsPath, null);
  if (!stage1 || !Array.isArray(stage1.extracts)) {
    throw new Error(`Stage 1 extracts를 읽을 수 없습니다: ${extractsPath}`);
  }

  const selectedSummaries = await readJson(selectedSummariesPath, { summaries: [] });
  const selectedSummaryByReport = new Map(
    (selectedSummaries?.summaries ?? [])
      .filter((item) => item?.report_id)
      .map((item) => [String(item.report_id), item]),
  );

  const items = [];
  let reportSummaryCount = 0;
  let selectedSummaryCount = 0;

  for (const extract of stage1.extracts) {
    const reportId = String(extract?.id ?? "").trim();
    if (!reportId) continue;

    const reportSummaryPath = path.join(reportSummariesDir, `${reportId}.json`);
    const reportSummaryPayload = fs.existsSync(reportSummaryPath)
      ? await readJson(reportSummaryPath, null)
      : null;
    const report = reportSummaryPayload?.report ?? {};
    const selectedSummary = selectedSummaryByReport.get(reportId) ?? null;

    if (reportSummaryPayload) reportSummaryCount += 1;
    if (selectedSummary) selectedSummaryCount += 1;

    const stage1Summary = buildStage1Summary(extract);
    const localCompact = compactReportSummary(reportSummaryPayload);
    const agendaSummary =
      truncate(selectedSummary?.summary ?? "", 260) ||
      truncate(localCompact, 260) ||
      truncate(stage1Summary, 260);

    const companyMentions = (report?.company_mentions ?? [])
      .map((item) => ({
        name: compact(item?.name),
        ticker: compact(item?.ticker),
        rating: compact(item?.rating),
      }))
      .filter((item) => item.name)
      .slice(0, 6);

    const portfolioRelevance = buildPortfolioRelevance(extract);

    items.push({
      report_id: reportId,
      title: extract?.title ?? report?.report_title ?? reportSummaryPayload?.meta?.report_title ?? "",
      broker: extract?.broker ?? report?.publisher ?? "",
      source: extract?.source ?? "",
      date: extract?.date ?? args.date,
      category: extract?.category ?? "",
      report_type: extract?.report_type ?? "",
      sector: extract?.sector ?? "",
      themes: unique(extract?.themes ?? [], 8),
      label_hint: inferLabelFromExtract(extract),
      inferred_type: inferTopicType(extract),
      priority_score: scoreExtractPriority(extract),
      confidence: extract?.confidence ?? "",
      sentiment_score: extract?.sentiment_score ?? null,
      portfolio_relevance: portfolioRelevance,
      key_thesis: truncate(extract?.key_thesis ?? "", 220),
      key_points: unique(extract?.key_points ?? [], 4).map((item) => truncate(item, 120)),
      catalysts: unique(extract?.catalysts ?? [], 4).map((item) => truncate(item, 120)),
      risks: unique(extract?.risks ?? [], 4).map((item) => truncate(item, 120)),
      summary_stage1: stage1Summary,
      summary_stage3_selected: truncate(selectedSummary?.summary ?? "", 260),
      summary_local_core: truncate(report?.core_summary ?? "", 240),
      summary_local_compact: truncate(localCompact, 320),
      summary_for_agenda: agendaSummary,
      report_summary_exists: Boolean(reportSummaryPayload),
      selected_for_stage3: Boolean(selectedSummary),
      local_summary_meta: reportSummaryPayload
        ? {
            model: compact(reportSummaryPayload?.meta?.model),
            detail_level: compact(reportSummaryPayload?.meta?.detail_level),
            overall_sentiment: compact(report?.overall_sentiment),
            time_horizon: compact(report?.time_horizon),
            macro_view: unique(report?.macro_view ?? [], 5),
            sector_view: unique(report?.sector_view ?? [], 5),
            key_signals: unique(report?.key_signals ?? [], 5),
            actionable_points: unique(report?.actionable_points ?? [], 5),
            company_mentions: companyMentions,
          }
        : null,
    });
  }

  items.sort((left, right) => right.priority_score - left.priority_score);

  await writeJson(outputPath, {
    date: args.date,
    source: "stage1_extracts+report_summaries",
    stats: {
      extractCount: stage1.extracts.length,
      reportSummaryCount,
      selectedSummaryCount,
      enrichedCount: items.length,
    },
    items,
  });

  console.log(`saved: ${outputPath}`);
  console.log(`enriched_count: ${items.length}`);
  console.log(`report_summaries: ${reportSummaryCount}`);
  console.log(`selected_summaries: ${selectedSummaryCount}`);
}

main().catch((error) => {
  console.error(`stage2 enriched report index 생성 실패: ${error.message}`);
  process.exit(1);
});
