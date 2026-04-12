#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  readText,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

function compact(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function singleLine(value, limit = 160) {
  const normalized = compact(value);
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function scoreExtract(item) {
  let score = 0;
  if (item?.report_type === "macro") score += 3;
  if ((item?.related_holdings_in_my_portfolio ?? []).length > 0) score += 4;
  if ((item?.portfolio_impacts_candidate ?? []).length > 0) score += 3;
  if ((item?.catalysts ?? []).length > 0) score += 2;
  if ((item?.what_changed ?? []).length > 0) score += 2;
  if ((item?.key_numbers ?? []).length > 0) score += 2;
  if (item?.primary_claim?.condition) score += 1;
  if (item?.primary_claim?.counterpoint) score += 1;
  return score;
}

function pickImportantExtracts(stage1, limit = 12) {
  return [...(stage1?.extracts ?? [])]
    .map((item) => ({ ...item, _score: scoreExtract(item) }))
    .sort((left, right) => right._score - left._score)
    .slice(0, limit);
}

function extractAnchorTokens(item) {
  const numbers = (item?.key_numbers ?? [])
    .map((entry) => String(entry?.value ?? "").trim())
    .filter((value) => value.length >= 2);
  const conditions = [item?.primary_claim?.condition, item?.primary_claim?.counterpoint]
    .map((value) => singleLine(value, 80))
    .filter((value) => value.length >= 8);

  return {
    numbers: numbers.slice(0, 3),
    conditions: conditions.slice(0, 2),
  };
}

function includesLoose(text, needle) {
  const normalizedText = compact(text).toLowerCase();
  const normalizedNeedle = compact(needle).toLowerCase();
  if (!normalizedNeedle) return false;
  return normalizedText.includes(normalizedNeedle);
}

function evaluateExtractCoverage(item, briefingText, promptText) {
  const anchors = extractAnchorTokens(item);
  const titlePresent =
    includesLoose(briefingText, item?.title) || includesLoose(promptText, item?.title) || false;
  const thesis = singleLine(item?.key_thesis ?? item?.primary_claim?.summary ?? "", 120);
  const thesisPresent =
    thesis.length >= 12 && (includesLoose(briefingText, thesis) || includesLoose(promptText, thesis));
  const numberMatches = anchors.numbers.filter(
    (value) => includesLoose(briefingText, value) || includesLoose(promptText, value),
  );
  const conditionMatches = anchors.conditions.filter(
    (value) => includesLoose(briefingText, value) || includesLoose(promptText, value),
  );

  return {
    id: item?.id ?? null,
    title: item?.title ?? null,
    titlePresent,
    thesisPresent,
    numberAnchorCount: anchors.numbers.length,
    numberAnchorMatched: numberMatches.length,
    conditionAnchorCount: anchors.conditions.length,
    conditionAnchorMatched: conditionMatches.length,
    sampleNumbers: anchors.numbers,
    sampleConditions: anchors.conditions,
  };
}

function buildMarkdown(summary, findings) {
  const lines = [
    `# Briefing Fidelity Validation (${summary.date})`,
    "",
    `- overallStatus: **${summary.overallStatus}**`,
    `- generatedAt: ${summary.generatedAt}`,
    `- stage1Extracts: ${summary.stage1Extracts}`,
    `- importantExtractsChecked: ${summary.importantExtractsChecked}`,
    `- briefingChars: ${summary.briefingChars}`,
    `- promptChars: ${summary.promptChars}`,
    `- titleCoveragePct: ${summary.titleCoveragePct}%`,
    `- numberAnchorCoveragePct: ${summary.numberAnchorCoveragePct}%`,
    `- conditionAnchorCoveragePct: ${summary.conditionAnchorCoveragePct}%`,
    "",
    "## Findings",
  ];

  if (findings.length === 0) {
    lines.push("- notable finding 없음");
  } else {
    for (const finding of findings) {
      lines.push(
        `- [${finding.id ?? "unknown"}] ${finding.title ?? "Untitled"} / title=${finding.titlePresent ? "Y" : "N"} / thesis=${finding.thesisPresent ? "Y" : "N"} / number=${finding.numberAnchorMatched}/${finding.numberAnchorCount} / condition=${finding.conditionAnchorMatched}/${finding.conditionAnchorCount}`,
      );
      if (finding.sampleNumbers.length > 0) {
        lines.push(`  sample_numbers: ${finding.sampleNumbers.join(" / ")}`);
      }
      if (finding.sampleConditions.length > 0) {
        lines.push(`  sample_conditions: ${finding.sampleConditions.join(" / ")}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const stage1Path = path.join(analysisDir, "stage1-report-extracts-v2.json");
  const richBriefingPath = path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-gemini-briefing-rich.md`);
  const stage2PromptPath = path.join(ROOT_DIR, "knowledge", "daily", "manual-kit", args.date, "08-stage2-strategy-prompt.md");

  const [stage1, richBriefing, stage2Prompt] = await Promise.all([
    readJson(stage1Path, null),
    readText(richBriefingPath, ""),
    readText(stage2PromptPath, ""),
  ]);

  if (!stage1?.extracts?.length) {
    throw new Error("stage1 extract가 없습니다.");
  }

  const important = pickImportantExtracts(stage1);
  const coverage = important.map((item) => evaluateExtractCoverage(item, richBriefing, stage2Prompt));

  const titleCovered = coverage.filter((item) => item.titlePresent).length;
  const numberTotal = coverage.reduce((sum, item) => sum + item.numberAnchorCount, 0);
  const numberCovered = coverage.reduce((sum, item) => sum + item.numberAnchorMatched, 0);
  const conditionTotal = coverage.reduce((sum, item) => sum + item.conditionAnchorCount, 0);
  const conditionCovered = coverage.reduce((sum, item) => sum + item.conditionAnchorMatched, 0);

  const titleCoveragePct = important.length > 0 ? Math.round((titleCovered / important.length) * 100) : 0;
  const numberAnchorCoveragePct = numberTotal > 0 ? Math.round((numberCovered / numberTotal) * 100) : 100;
  const conditionAnchorCoveragePct = conditionTotal > 0 ? Math.round((conditionCovered / conditionTotal) * 100) : 100;

  const findings = coverage.filter(
    (item) =>
      !item.titlePresent ||
      (item.numberAnchorCount > 0 && item.numberAnchorMatched === 0) ||
      (item.conditionAnchorCount > 0 && item.conditionAnchorMatched === 0),
  );

  const overallStatus =
    titleCoveragePct >= 70 && numberAnchorCoveragePct >= 45 && conditionAnchorCoveragePct >= 45
      ? "ok"
      : "warn";

  const summary = {
    date: args.date,
    generatedAt: new Date().toISOString(),
    overallStatus,
    stage1Extracts: stage1.extracts.length,
    importantExtractsChecked: important.length,
    briefingChars: richBriefing.length,
    promptChars: stage2Prompt.length,
    titleCoveragePct,
    numberAnchorCoveragePct,
    conditionAnchorCoveragePct,
    findings,
  };

  const outputJson = path.join(analysisDir, "briefing-fidelity-validation.json");
  const outputMarkdown = path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-briefing-fidelity.md`);
  await writeJson(outputJson, summary);
  await writeText(outputMarkdown, buildMarkdown(summary, findings));
  console.log(outputJson);
}

main().catch((error) => {
  console.error(`[briefing-fidelity] 실패: ${error.message}`);
  process.exit(1);
});
