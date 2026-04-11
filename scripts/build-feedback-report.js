#!/usr/bin/env node
// F1: feedback 분석 JSON을 사람이 빠르게 읽을 수 있는 요약 리포트로 변환합니다.

import path from "node:path";

import { ROOT_DIR, parseDateArgs, readJson, writeText } from "./lib/pipeline-utils.js";

function fmtSignedPercent(value, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fmtSignedNumber(value, digits = 3) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function fmtPercent(value, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const inputPath =
    args.input ??
    path.join(ROOT_DIR, "data", "feedback", "analysis", `${args.date}-feedback.json`);
  const outputPath =
    args.output ?? path.join(ROOT_DIR, "reports", "feedback-summary.md");

  const analysis = await readJson(inputPath, null);
  if (!analysis) {
    throw new Error("feedback analysis 파일이 없어 리포트를 만들 수 없습니다.");
  }

  const lines = [
    "# EcoReport Feedback Summary",
    "",
    `- 분석 기준일: ${analysis.analysisDate ?? "N/A"}`,
    `- 생성 시각: ${analysis.generatedAt ?? "N/A"}`,
    `- 누적 스냅샷: ${analysis.snapshotCount ?? 0}일`,
    `- 평가 포지션: ${analysis.positionCount ?? 0}건`,
    "",
    "## 점수-수익률 상관관계",
    "",
    "| Horizon | Correlation | Samples |",
    "|---|---:|---:|",
    ...Object.entries(analysis.scoreReturnCorrelation ?? {}).map(
      ([horizonKey, stat]) =>
        `| ${horizonKey} | ${fmtSignedNumber(stat?.correlation)} | ${stat?.sampleCount ?? 0} |`,
    ),
    "",
    "## 팩터 예측력",
    "",
    "| Factor | Primary Corr | Samples | Suggested Weight | Delta |",
    "|---|---:|---:|---:|---:|",
    ...Object.entries(analysis.autoAdjustment?.suggestedWeights ?? {}).map(
      ([factor, suggestedWeight]) => {
        const primaryKey = `ret_${analysis.autoAdjustment?.primaryHorizonDays ?? 10}d`;
        const metric = analysis.factorPredictivePower?.[factor]?.[primaryKey] ?? {};
        const delta = analysis.autoAdjustment?.deltas?.[factor] ?? null;
        return `| ${factor} | ${fmtSignedNumber(metric?.correlation)} | ${
          metric?.sampleCount ?? 0
        } | ${fmtPercent(suggestedWeight)} | ${
          delta != null ? fmtSignedPercent(delta * 100) : "N/A"
        } |`;
      },
    ),
    "",
    "## 시그널 적중률",
    "",
  ];

  for (const [horizonKey, signals] of Object.entries(analysis.signalAccuracy ?? {})) {
    lines.push(`### ${horizonKey}`);
    lines.push("");
    lines.push("| Signal | Avg Return | Hit Rate | Samples |");
    lines.push("|---|---:|---:|---:|");
    for (const [signal, stat] of Object.entries(signals ?? {})) {
      lines.push(
        `| ${signal} | ${fmtSignedPercent(stat?.avgReturnPct)} | ${fmtPercent(
          stat?.hitRate,
        )} | ${stat?.count ?? 0} |`,
      );
    }
    lines.push("");
  }

  if ((analysis.alerts ?? []).length > 0) {
    lines.push("## 경고/관찰");
    lines.push("");
    for (const item of analysis.alerts) {
      lines.push(`- ${item.message} (corr ${fmtSignedNumber(item.correlation)})`);
    }
    lines.push("");
  }

  if ((analysis.worstMispredictions ?? []).length > 0) {
    lines.push("## 최악 오판 사례");
    lines.push("");
    for (const item of analysis.worstMispredictions.slice(0, 8)) {
      lines.push(
        `- ${item.date} ${item.name}(${item.code}) / ${item.signal} ${item.actionScore}점 / 실제 ${
          analysis.autoAdjustment?.primaryHorizonDays ?? 10
        }일 수익률 ${fmtSignedPercent(item.returnPct)}`,
      );
    }
    lines.push("");
  }

  lines.push(
    `*Auto-adjust: ${
      analysis.autoAdjustment?.enabled ? "enabled" : "disabled"
    } / primary horizon ${analysis.autoAdjustment?.primaryHorizonDays ?? "N/A"}d*`,
  );

  await writeText(outputPath, `${lines.join("\n")}\n`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`feedback report 생성 실패: ${error.message}`);
  process.exit(1);
});
