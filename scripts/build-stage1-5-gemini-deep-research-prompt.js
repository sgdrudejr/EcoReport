#!/usr/bin/env node
// Stage 1.5: Stage 1 추출물과 최신 포트폴리오 스냅샷을 Gemini Deep Research용 프롬프트로 묶어 클립보드에 복사합니다.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ROOT_DIR, parseDateArgs, readJson, truncate, writeText, won } from "./lib/pipeline-utils.js";

const DEFAULT_OUTPUT_NAME = "07-stage1-5-gemini-deep-research-prompt.md";
const MAX_STAGE1_EXTRACTS = 12;

const PROMPT_TEMPLATE = `너는 최고의 글로벌 투자 트레이딩 전문가이자 나의 전담 어드바이저야.
첨부된 데이터는 오늘자 내 포트폴리오 현황과 증권사 리포트 핵심 요약본(Stage 1 Extracts)이야.

나의 목표는 이 데이터를 바탕으로 향후 3~6개월 기간 동안의 수익을 극대화할 수 있는 완벽한 계좌 포트폴리오 구성 전략을 짜는 거야.

[리서치 원칙 및 제약 조건]
- 한국과 미국의 굴지의 대형 증권사(IB)들이 발행한 주요 뉴스와 리포트, 그리고 현재 날짜의 시장 방향성을 반드시 참고해 줘.
- 정보의 최신성을 엄격하게 지켜줘: 가장 이상적인 데이터는 '1주일 내외'의 최신 정보야. 최대 '3개월 미만'의 정보까지만 참고하고, 3달 이상 된 낡은 정보는 절대 사용하지 마.

현재 데이터가 가리키는 전략 방향성에 기본적으로 동의하지만, 네가 **Deep Research** 도구를 활용해 아래 4가지를 중점적으로 리서치하고 전략을 업데이트해 줘:

1. **반박 시나리오 탐색**: 현재 시장의 가설이 깨지고 급격한 레짐 변화가 올 수 있는 숨겨진 매크로 리스크나 트리거가 있는지?
2. **대안 자산 탐색**: 한국 상장 ETF 외에 글로벌 관점에서 포트폴리오 안정성이나 알파 수익을 높일 수 있는 최고의 대안 자산이나 테마가 있는지?
3. **카탈리스트(Catalyst) 일정**: 향후 3~6개월 내에 내 종목이나 관련 섹터의 주가를 크게 움직일 주요 이벤트(실적 발표, 정책 발표 등)와 예상 시기.
4. **📊 과거 데이터 기반 백테스트(Backtest) 검증**: 제안된 전략과 네가 찾은 대안 전략을 비교해 줘. 과거 유사한 매크로 환경에서 두 전략을 적용했을 때의 가상 수익률과 최대 낙폭(MDD)을 검색을 통해 정량적으로 추산하고 비교해 줘.

[내 포트폴리오 상태]
{{PORTFOLIO_DATA}}

[오늘의 리포트 핵심 요약]
{{STAGE1_DATA}}
`;

function resolveOutputPath(rawPath, date) {
  if (rawPath) {
    return path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
  }

  return path.join(ROOT_DIR, "knowledge", "daily", "manual-kit", date, DEFAULT_OUTPUT_NAME);
}

function findLatestAvailableStage1Date() {
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state");
  if (!fs.existsSync(analysisDir)) return null;

  const candidateDates = fs
    .readdirSync(analysisDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .filter((date) => fs.existsSync(path.join(analysisDir, date, "stage1-report-extracts-v2.json")))
    .sort();

  return candidateDates.at(-1) ?? null;
}

function formatMoneyLine(label, value) {
  if (typeof value !== "number" || Number.isNaN(value)) return `- ${label}: N/A`;
  return `- ${label}: ${won(value)}`;
}

function formatPercentLine(label, value) {
  if (typeof value !== "number" || Number.isNaN(value)) return `- ${label}: N/A`;
  return `- ${label}: ${value.toFixed(2)}%`;
}

function sumAccountField(accounts, key) {
  return accounts.reduce((total, account) => {
    const value = account?.[key];
    return typeof value === "number" && Number.isFinite(value) ? total + value : total;
  }, 0);
}

function formatHoldingLine(holding) {
  const parts = [];
  const quantity = holding?.quantity;
  parts.push(`수량 ${quantity ?? "N/A"}주`);

  if (typeof holding?.currentPrice === "number") {
    parts.push(`현재가 ${won(holding.currentPrice)}`);
  }
  if (typeof holding?.marketValue === "number") {
    parts.push(`평가액 ${won(holding.marketValue)}`);
  }
  if (typeof holding?.avgPrice === "number") {
    parts.push(`평단 ${won(holding.avgPrice)}`);
  }
  if (typeof holding?.profitRate === "number") {
    parts.push(`수익률 ${holding.profitRate.toFixed(2)}%`);
  }
  if (typeof holding?.profitLoss === "number") {
    parts.push(`손익 ${won(holding.profitLoss)}`);
  }

  const codeSuffix = holding?.code ? ` (${holding.code})` : "";
  return `- ${holding?.name ?? "이름 없음"}${codeSuffix}: ${parts.join(" | ")}`;
}

function formatPortfolioMarkdown(portfolio) {
  const accounts = portfolio?.accounts ?? [];
  const totalEvaluation = sumAccountField(accounts, "evaluationAmount");
  const totalCash = sumAccountField(accounts, "cashAvailable");
  const totalPrincipal = sumAccountField(accounts, "principal");
  const totalProfitLoss = sumAccountField(accounts, "profitLoss");
  const totalHoldings = accounts.reduce((count, account) => count + (account?.holdings?.length ?? 0), 0);

  const lines = [
    "## 스냅샷 메타",
    `- 스냅샷 날짜: ${portfolio?.date ?? "N/A"}`,
    `- 업데이트 시각: ${portfolio?.updatedAt ?? "N/A"}`,
    `- 계좌 수: ${accounts.length}`,
    `- 보유 라인 수: ${totalHoldings}`,
    formatMoneyLine("총 평가금액", totalEvaluation),
    formatMoneyLine("총 가용 현금", totalCash),
    formatMoneyLine("총 원금", totalPrincipal),
    formatMoneyLine("총 손익", totalProfitLoss),
    "",
    "## 계좌별 현황",
  ];

  if (accounts.length === 0) {
    lines.push("- 계좌 데이터가 없습니다.");
    return lines.join("\n");
  }

  for (const account of accounts) {
    lines.push("");
    lines.push(`### ${account.label ?? account.key ?? "계좌"} (${account.key ?? "N/A"})`);
    lines.push(formatMoneyLine("평가금액", account.evaluationAmount));
    lines.push(formatMoneyLine("가용 현금", account.cashAvailable));
    lines.push(formatMoneyLine("결제 예정 현금", account.settlementCash));
    lines.push(formatMoneyLine("원금", account.principal));
    lines.push(formatMoneyLine("손익", account.profitLoss));
    lines.push(formatPercentLine("수익률", account.profitRate));
    lines.push(`- 스냅샷 불완전 여부: ${account.incomplete ? "예" : "아니오"}`);

    const holdings = account?.holdings ?? [];
    if (holdings.length === 0) {
      lines.push("- 보유 종목: 없음");
      continue;
    }

    lines.push("- 보유 종목");
    for (const holding of holdings) {
      lines.push(`  ${formatHoldingLine(holding)}`);
    }
  }

  return lines.join("\n");
}

function scoreExtractPriority(extract) {
  let score = 0;
  score += (extract?.related_holdings_in_my_portfolio?.length ?? 0) * 12;
  score += (extract?.portfolio_impacts_candidate?.length ?? 0) * 10;
  score += (extract?.related_accounts?.length ?? 0) * 5;

  if (extract?.report_type === "macro") score += 20;
  if (extract?.report_type === "industry") score += 12;
  if (extract?.report_type === "theme") score += 10;
  if (extract?.confidence === "HIGH") score += 6;
  if (extract?.confidence === "MEDIUM") score += 3;

  return score + Math.round(Math.abs(extract?.sentiment_score ?? 0) * 10);
}

function formatImpactLine(impact) {
  const target = impact?.target_code ? `${impact.target_name} (${impact.target_code})` : impact?.target_name ?? "N/A";
  const account = impact?.account_key ? ` / 계좌 ${impact.account_key}` : "";
  const horizon = impact?.horizon ? ` / 기간 ${impact.horizon}` : "";
  const strength = typeof impact?.strength === "number" ? ` / 강도 ${impact.strength}` : "";
  return `- ${target}${account}${horizon}${strength}: ${impact?.direction ?? "N/A"} / ${impact?.action_hint ?? "관찰"} / 근거 ${truncate(impact?.reason ?? "", 120)}`;
}

function formatStage1ExtractMarkdown(stage1) {
  const extracts = Array.isArray(stage1?.extracts) ? stage1.extracts : [];
  const prioritized = [...extracts]
    .sort((left, right) => scoreExtractPriority(right) - scoreExtractPriority(left))
    .slice(0, MAX_STAGE1_EXTRACTS);

  const lines = [
    "## Stage 1 메타",
    `- 기준 날짜: ${stage1?.date ?? "N/A"}`,
    `- 실행일: ${stage1?.runDate ?? "N/A"}`,
    `- 기준 거래일: ${stage1?.effectiveMarketDate ?? "N/A"}`,
    `- Stage 1 파일상 총 리포트 수: ${stage1?.reportCount ?? extracts.length}`,
    `- 추출 레코드 수: ${extracts.length}`,
    `- 직접 포트폴리오 관련 리포트 수: ${extracts.filter((item) => (item.related_holdings_in_my_portfolio?.length ?? 0) > 0).length}`,
    `- 계좌/보유 영향 후보 포함 리포트 수: ${extracts.filter((item) => (item.portfolio_impacts_candidate?.length ?? 0) > 0).length}`,
  ];

  if (extracts.length > prioritized.length) {
    lines.push(`- 아래에는 우선순위 상위 ${prioritized.length}건만 정리함`);
  }

  lines.push("");
  lines.push("## 핵심 리포트 요약");

  if (prioritized.length === 0) {
    lines.push("- 해당 날짜 Stage 1 파일은 존재하지만 추출된 핵심 리포트가 비어 있습니다.");
    return lines.join("\n");
  }

  for (const item of prioritized) {
    const relatedHoldings =
      item?.related_holdings_in_my_portfolio?.map((holding) => `${holding.name} (${holding.accountKey})`).join(", ") || "없음";
    const keyNumbers = item?.key_numbers?.slice(0, 5).map((entry) => entry.value).join(", ") || "없음";
    const catalysts = item?.catalysts?.slice(0, 3) ?? [];
    const risks = item?.risks?.slice(0, 3) ?? [];
    const impacts = item?.portfolio_impacts_candidate?.slice(0, 3) ?? [];

    lines.push("");
    lines.push(`### ${item.id ?? "report"} | ${item.title ?? "제목 없음"}`);
    lines.push(`- 메타: ${item.date ?? "N/A"} / ${item.broker ?? "N/A"} / ${item.report_type ?? "N/A"} / 섹터 ${item.sector ?? "N/A"}`);
    lines.push(`- 관련 계좌: ${item?.related_accounts?.join(", ") || "없음"}`);
    lines.push(`- 관련 보유 종목: ${relatedHoldings}`);
    lines.push(`- 핵심 논지: ${truncate(item?.key_thesis ?? "", 220) || "없음"}`);
    lines.push(`- 핵심 수치: ${keyNumbers}`);

    const keyPoints = item?.key_points?.slice(0, 3) ?? [];
    if (keyPoints.length > 0) {
      lines.push("- 주요 포인트");
      for (const point of keyPoints) {
        lines.push(`  - ${truncate(point, 180)}`);
      }
    }

    if (catalysts.length > 0) {
      lines.push("- 촉매 후보");
      for (const catalyst of catalysts) {
        lines.push(`  - ${truncate(catalyst, 160)}`);
      }
    }

    if (risks.length > 0) {
      lines.push("- 리스크 후보");
      for (const risk of risks) {
        lines.push(`  - ${truncate(risk, 160)}`);
      }
    }

    if (impacts.length > 0) {
      lines.push("- 포트폴리오 영향 후보");
      for (const impact of impacts) {
        lines.push(`  ${formatImpactLine(impact)}`);
      }
    }
  }

  return lines.join("\n");
}

function copyToClipboard(text) {
  const result = spawnSync("pbcopy", { input: text, encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "pbcopy 실행에 실패했습니다.");
  }
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stage1Path = path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage1-report-extracts-v2.json");
  const portfolioPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const outputPath = resolveOutputPath(args.output, args.date);

  if (!fs.existsSync(stage1Path)) {
    const latestStage1Date = findLatestAvailableStage1Date();
    const suffix = latestStage1Date
      ? ` 가장 최근 Stage 1 데이터는 ${latestStage1Date} 입니다.`
      : " 아직 생성된 Stage 1 데이터가 없습니다.";
    throw new Error(`Stage 1 파일을 찾을 수 없습니다: ${stage1Path}.${suffix}`);
  }

  if (!fs.existsSync(portfolioPath)) {
    throw new Error(`포트폴리오 스냅샷을 찾을 수 없습니다: ${portfolioPath}`);
  }

  const [stage1, portfolio] = await Promise.all([
    readJson(stage1Path, null),
    readJson(portfolioPath, null),
  ]);

  if (!stage1) {
    throw new Error(`Stage 1 JSON 파싱에 실패했습니다: ${stage1Path}`);
  }
  if (!portfolio) {
    throw new Error(`포트폴리오 JSON 파싱에 실패했습니다: ${portfolioPath}`);
  }

  const portfolioMarkdown = formatPortfolioMarkdown(portfolio);
  const stage1Markdown = formatStage1ExtractMarkdown(stage1);
  const prompt = PROMPT_TEMPLATE
    .replace("{{PORTFOLIO_DATA}}", portfolioMarkdown)
    .replace("{{STAGE1_DATA}}", stage1Markdown);

  await writeText(outputPath, `${prompt}\n`);
  let clipboardCopied = false;
  try {
    copyToClipboard(prompt);
    clipboardCopied = true;
  } catch (error) {
    console.warn(
      `clipboard-warning: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log(`saved: ${outputPath}`);
  console.log(`stage1: ${stage1Path}`);
  console.log(`portfolio: ${portfolioPath}`);
  console.log(`clipboard_chars: ${prompt.length}`);
  console.log(`clipboard_copied: ${clipboardCopied}`);
}

main().catch((error) => {
  console.error(`stage1.5 deep research prompt 생성 실패: ${error.message}`);
  process.exit(1);
});
