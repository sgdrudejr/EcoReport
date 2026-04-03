#!/usr/bin/env node
// 수동 LLM용 포트폴리오 코치 프롬프트를 생성합니다.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MAX_MANUAL_REPORTS = 8;
const MAX_TECHNICALS = 12;

function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (!token.startsWith("--")) {
      args.date = token;
    }
  }

  return args;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readText(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function won(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function pct(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(2)}%`;
}

function summarizeStrategy(strategy) {
  if (!strategy?.accounts) {
    return "- strategy.json 정보가 없습니다.";
  }

  const lines = [
    `- 전략명: ${strategy.name ?? "N/A"}`,
    `- 기간: ${strategy.period?.start ?? "N/A"} ~ ${strategy.period?.end ?? "N/A"}`,
  ];

  for (const [accountName, config] of Object.entries(strategy.accounts)) {
    const alloc = Object.entries(config.target_allocation ?? {})
      .map(([name, value]) => `${name} ${Math.round(Number(value) * 100)}%`)
      .join(", ");
    lines.push(`- ${accountName}: 현금 ${won(config.cash)} / 목표배분 ${alloc}`);
  }

  if (strategy.dca_plan?.schedule?.length) {
    lines.push("- 분할매수:");
    for (const item of strategy.dca_plan.schedule) {
      lines.push(
        `  - ${item.tranche}차 / ${(Number(item.pct) * 100).toFixed(0)}% / ${item.target_date} / ${item.status}`,
      );
    }
  }

  return lines.join("\n");
}

function summarizePortfolio(portfolio) {
  if (!portfolio?.accounts?.length) {
    return "- 최신 포트폴리오 스냅샷이 없습니다.";
  }

  const lines = [];
  for (const account of portfolio.accounts) {
    lines.push(
      `### ${account.label}\n- 총자산 ${won(account.evaluationAmount)} / 예수금 ${won(account.cashAvailable)} / 손익 ${won(account.profitLoss)} / 수익률 ${pct(account.profitRate)} / incomplete ${account.incomplete ? "YES" : "NO"}`,
    );
    for (const holding of account.holdings ?? []) {
      lines.push(
        `- ${holding.name} (${holding.code ?? "N/A"}): 평가금액 ${won(holding.marketValue)} / 손익 ${won(holding.profitLoss)} / 수익률 ${pct(holding.profitRate)} / 수량 ${holding.quantity ?? "N/A"}`,
      );
    }
  }
  return lines.join("\n");
}

function summarizeTechnicals(technical) {
  if (!technical?.scores) {
    return "- 오늘 기술적 점수가 없습니다.";
  }

  const rows = Object.values(technical.scores)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MAX_TECHNICALS)
    .map(
      (item) =>
        `- ${item.name} (${item.code}): ${item.signal} / 점수 ${item.score} / RSI ${item.rsi ?? "N/A"} / 이유 ${item.signal_reason ?? "N/A"}`,
    );

  const marketContext = technical.market_context
    ? `- 시장 레짐(임시): ${technical.market_context.signal} / KOSPI score ${technical.market_context.score ?? "N/A"} / RSI ${technical.market_context.rsi ?? "N/A"} / VIX ${technical.market_context.vix ?? "N/A"}`
    : "- 시장 컨텍스트 없음";

  return [marketContext, ...rows].join("\n");
}

function summarizeManualReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    return "- 아직 저장된 수동 PDF 요약이 없습니다.";
  }

  return reports.slice(0, MAX_MANUAL_REPORTS).map((item) => {
    const themes = Array.isArray(item.themes) ? item.themes.join(", ") : "";
    return `- [${item.broker}] ${item.title} / 섹터 ${item.sector ?? "N/A"} / 핵심 ${item.key_thesis ?? "N/A"} / 새 정보 ${item.new_info ?? "없음"}${themes ? ` / 테마 ${themes}` : ""}`;
  }).join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const strategyPath = path.join(cwd, "config", "strategy.json");
  const portfolioPath = path.join(cwd, "data", "portfolio", "latest.json");
  const technicalPath = path.join(cwd, "data", "technical", `${args.date}.json`);
  const manualReportsPath = path.join(cwd, "data", "reports", args.date, "manual-compressed.json");
  const synthesisPath = path.join(cwd, "knowledge", "daily", `${args.date}-synthesis.md`);

  const [strategy, portfolio, technical, manualReports, synthesis] = await Promise.all([
    readJson(strategyPath, null),
    readJson(portfolioPath, null),
    readJson(technicalPath, null),
    readJson(manualReportsPath, []),
    readText(synthesisPath, ""),
  ]);

  const prompt = [
    "# EcoReport 수동 LLM 포트폴리오 코치 프롬프트",
    "",
    `오늘 날짜는 ${args.date} 입니다.`,
    "당신은 내 계좌를 실제로 운용하는 포트폴리오 코치입니다.",
    "뉴스 요약, PDF 핵심 주장, 기술점수, 계좌 구조를 함께 보고 오늘 무엇을 해야 하는지 구체적으로 말하세요.",
    "",
    "## 점수화 원칙",
    "- 포트폴리오 총점은 100점 만점으로 계산합니다.",
    "- 기본 가중치: 배분 적합도 40, 기술 점수 40, 오늘 리포트/시황 확신도 20",
    "- 계좌별 점수도 같은 방식으로 계산하되, 계좌 목적(ISA/연금/토스)을 반영하세요.",
    "- 점수만 던지지 말고 왜 그런지 설명하세요.",
    "",
    "## 전략",
    summarizeStrategy(strategy),
    "",
    "## 현재 포트폴리오",
    summarizePortfolio(portfolio),
    "",
    "## 오늘 기술 점수",
    summarizeTechnicals(technical),
    "",
    "## 오늘 저장된 PDF 핵심 요약",
    summarizeManualReports(manualReports),
    "",
    "## 오늘 시황 종합",
    synthesis || "- 아직 저장된 시황 종합이 없습니다.",
    "",
    "## 해야 할 일",
    "1. 오늘 포트폴리오 총점을 0~100으로 매기세요.",
    "2. ISA / 연금저축 / 토스증권 각각 계좌별 점수를 매기세요.",
    "3. 각 계좌에서 지금 해야 할 행동을 BUY / HOLD / REDUCE / WAIT 중 하나로 정리하세요.",
    "4. 오늘 기준으로 가장 먼저 봐야 할 종목/ETF 3개를 순서대로 고르세요.",
    "5. 지금은 하지 말아야 할 행동도 분명히 적으세요.",
    "6. 실제 실행 금액이나 비중 조정 아이디어가 있으면 계좌별로 적으세요.",
    "",
    "## 출력 형식",
    "## 오늘 핵심 변화",
    "- 3개 이내",
    "",
    "## 포트폴리오 총점",
    "- 총점 / 이유",
    "",
    "## 계좌별 점수",
    "- ISA: 점수 / 행동 / 이유",
    "- 연금저축: 점수 / 행동 / 이유",
    "- 토스증권: 점수 / 행동 / 이유",
    "",
    "## 우선순위 종목·ETF",
    "- 1위 / 이유 / 계좌",
    "- 2위 / 이유 / 계좌",
    "- 3위 / 이유 / 계좌",
    "",
    "## 오늘 실행 가이드",
    "- 계좌별로 구체적으로",
    "",
    "## 하지 말 것",
    "- 지금 보류할 행동들",
    "",
    "일반론 말고, 오늘 바로 행동 가능한 문장으로만 답하세요.",
  ].join("\n");

  if (args.output) {
    const outputPath = path.isAbsolute(args.output)
      ? args.output
      : path.join(cwd, args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, prompt, "utf8");
  }

  process.stdout.write(prompt);
}

main().catch((error) => {
  console.error(
    `❌ build-portfolio-coach-prompt 실패: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
