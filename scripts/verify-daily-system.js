#!/usr/bin/env node
// 일일 EcoReport 운영 산출물이 정상적으로 생성되었는지 검증하고 요약 리포트를 저장합니다.

import path from "node:path";

import { ROOT_DIR, parseDateArgs, readJson, writeJson, writeText } from "./lib/pipeline-utils.js";

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

function relative(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;
  const reportDir = path.join(ROOT_DIR, "data", "reports", date);
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);

  const paths = {
    portfolio: path.join(ROOT_DIR, "data", "portfolio", "latest.json"),
    reportIndex: path.join(reportDir, "index.json"),
    crawlManifest: path.join(reportDir, "crawl-manifest.json"),
    textManifest: path.join(reportDir, "text-manifest.json"),
    market: path.join(ROOT_DIR, "data", "market", `${date}.json`),
    technical: path.join(ROOT_DIR, "data", "technical", `${date}.json`),
    reportRag: path.join(reportDir, "rag", "chunk-manifest.json"),
    portfolioRag: path.join(ROOT_DIR, "data", "portfolio", "rag", date, "chunk-manifest.json"),
    parallelRag: path.join(ROOT_DIR, "knowledge", "rag", date, "parallel-manifest.json"),
    stage1: path.join(analysisDir, "stage1-report-extracts-v2.json"),
    stage2: path.join(analysisDir, "stage2-strategy-options.json"),
    stage2Mock: path.join(analysisDir, "stage2-strategy-options.mock.json"),
    stage3: path.join(analysisDir, "stage3-quant-scores.json"),
    stage4: path.join(analysisDir, "stage4-execution-plan.json"),
    briefing: path.join(ROOT_DIR, "reports", "daily", `${date}-briefing.md`),
    executionMd: path.join(ROOT_DIR, "reports", "daily", `${date}-stage4-execution-plan.md`),
    gemini: path.join(ROOT_DIR, "knowledge", "daily", `${date}-gemini-briefing.md`),
    geminiRich: path.join(ROOT_DIR, "knowledge", "daily", `${date}-gemini-briefing-rich.md`),
  };

  const [
    portfolio,
    reportIndex,
    crawlManifest,
    textManifest,
    market,
    technical,
    reportRag,
    portfolioRag,
    parallelRag,
    stage1,
    stage2,
    stage2Mock,
    stage3,
    stage4,
  ] = await Promise.all([
    readJson(paths.portfolio, null),
    readJson(paths.reportIndex, []),
    readJson(paths.crawlManifest, null),
    readJson(paths.textManifest, null),
    readJson(paths.market, null),
    readJson(paths.technical, null),
    readJson(paths.reportRag, null),
    readJson(paths.portfolioRag, null),
    readJson(paths.parallelRag, null),
    readJson(paths.stage1, null),
    readJson(paths.stage2, null),
    readJson(paths.stage2Mock, null),
    readJson(paths.stage3, null),
    readJson(paths.stage4, null),
  ]);

  const reportCount = Array.isArray(reportIndex) ? reportIndex.length : 0;
  const extractedCount = Number(textManifest?.total_reports ?? 0);
  const successCount = Number(textManifest?.success_count ?? 0);
  const ocrCount = Number(textManifest?.ocr_used_count ?? 0);
  const stage1Extracts = Number(stage1?.extracts?.length ?? 0);
  const accountCount = Number(portfolio?.accounts?.length ?? 0);
  const stage2Mode = stage2 ? "gemini" : stage2Mock ? "mock" : "missing";

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
      label: "Stage 1 연구 노트",
      status: statusFromCondition(stage1Extracts > 0, "warn"),
      detail: stage1Extracts > 0 ? `추출 ${stage1Extracts}건` : "stage1 산출물 누락",
      path: relative(paths.stage1),
    },
    {
      key: "stage2",
      label: "Stage 2 전략 탐색",
      status: statusFromCondition(stage2Mode !== "missing", "warn"),
      detail:
        stage2Mode === "gemini"
          ? `Gemini 실제 결과 (${stage2.model ?? "unknown"})`
          : stage2Mode === "mock"
            ? "mock 결과 사용"
            : "stage2 결과 없음",
      path: relative(stage2 ? paths.stage2 : paths.stage2Mock),
    },
    {
      key: "stage3",
      label: "Stage 3 퀀트 점수",
      status: statusFromCondition(Boolean(stage3?.portfolio)),
      detail: stage3?.portfolio ? `포트폴리오 ${stage3.portfolio.totalScore ?? "-"}점` : "stage3 누락",
      path: relative(paths.stage3),
    },
    {
      key: "stage4",
      label: "Stage 4 실행 계획",
      status: statusFromCondition(Boolean(stage4?.accountPlans?.length)),
      detail:
        stage4?.accountPlans?.length
          ? `계좌 계획 ${stage4.accountPlans.length}개`
          : "stage4 누락",
      path: relative(paths.stage4),
    },
    {
      key: "briefing",
      label: "일일 브리핑",
      status: statusFromCondition(await fileExists(paths.briefing)),
      detail: (await fileExists(paths.briefing)) ? "briefing.md 생성됨" : "briefing.md 누락",
      path: relative(paths.briefing),
    },
    {
      key: "gemini_briefing",
      label: "경제 리포트 브리핑",
      status: statusFromCondition((await fileExists(paths.geminiRich)) || (await fileExists(paths.gemini)), "warn"),
      detail:
        (await fileExists(paths.geminiRich))
          ? "rich Gemini 브리핑 생성됨"
          : (await fileExists(paths.gemini))
            ? "Gemini 브리핑 생성됨"
            : "Gemini 브리핑 없음",
      path: relative((await fileExists(paths.geminiRich)) ? paths.geminiRich : paths.gemini),
    },
  ];

  const summary = {
    date,
    generatedAt: new Date().toISOString(),
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
    },
    checks,
  };

  const outputJson = path.join(analysisDir, "system-health.json");
  const outputMarkdown = path.join(ROOT_DIR, "knowledge", "daily", `${date}-system-health.md`);

  const markdown = [
    `# EcoReport Daily Health (${date})`,
    "",
    `- overallStatus: **${summary.overallStatus}**`,
    `- generatedAt: ${summary.generatedAt}`,
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
