#!/usr/bin/env node
// 수동 LLM용 리포트 선별 프롬프트를 생성합니다.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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

function won(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function pct(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return `${value.toFixed(2)}%`;
}

function summarizePortfolio(portfolio) {
  if (!portfolio?.accounts?.length) {
    return "- 포트폴리오 스냅샷이 없습니다.";
  }

  const lines = [];
  for (const account of portfolio.accounts) {
    lines.push(
      `- ${account.label}: 총자산 ${won(account.evaluationAmount)} / 예수금 ${won(account.cashAvailable)} / 손익 ${won(account.profitLoss)} / 수익률 ${pct(account.profitRate)}`,
    );
    for (const holding of account.holdings ?? []) {
      lines.push(
        `  - ${holding.name} (${holding.code ?? "N/A"}): 평가금액 ${won(holding.marketValue)} / 손익 ${won(holding.profitLoss)} / 수익률 ${pct(holding.profitRate)}`,
      );
    }
  }
  return lines.join("\n");
}

function summarizeQueue(queue) {
  if (!queue?.items?.length) {
    return "- 오늘 생성된 PDF 큐가 없습니다.";
  }

  return queue.items
    .map((item) => {
      const accountPart =
        Array.isArray(item.relatedAccounts) && item.relatedAccounts.length > 0
          ? ` / 관련 계좌: ${item.relatedAccounts.join(", ")}`
          : "";
      const reasonPart =
        Array.isArray(item.reasons) && item.reasons.length > 0
          ? ` / 이유: ${item.reasons.join(" | ")}`
          : "";
      return `- #${item.rank} [${item.priorityLabel} ${item.priorityScore}점] ${item.title} / ${item.broker} / ${item.category}${accountPart}${reasonPart}`;
    })
    .join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const queuePath = path.join(cwd, "knowledge", "daily", `${args.date}-report-summary-queue.json`);
  const portfolioPath = path.join(cwd, "data", "portfolio", "latest.json");

  const [queue, portfolio] = await Promise.all([
    readJson(queuePath, null),
    readJson(portfolioPath, null),
  ]);

  const prompt = [
    "# EcoReport 수동 LLM 리포트 선별 프롬프트",
    "",
    `오늘 날짜는 ${args.date} 입니다.`,
    "당신은 내 포트폴리오를 위해 오늘 어떤 증권사 PDF를 먼저 깊게 읽을지 결정하는 buy-side research lead입니다.",
    "단순 점수 높은 순 정렬이 아니라, 내 실제 계좌 운용과 연결되는지 기준으로 선별하세요.",
    "",
    "## 현재 포트폴리오",
    summarizePortfolio(portfolio),
    "",
    "## 오늘 PDF 우선순위 큐",
    summarizeQueue(queue),
    "",
    "## 해야 할 일",
    "1. 오늘 반드시 깊게 요약할 리포트 1~3개를 고르세요.",
    "2. 굳이 오늘 안 읽어도 되는 리포트는 보류 목록으로 분리하세요.",
    "3. 각 선택 리포트마다 '이걸 읽고 나면 어떤 운용 판단이 좋아지는지'를 적으세요.",
    "4. 각 선택 리포트에 대해 다음 단계에서 GPT에게 다시 물을 핵심 질문을 2개씩 적으세요.",
    "5. 마지막에 '오늘 리포트 읽는 순서'를 한 줄로 정리하세요.",
    "",
    "## 출력 형식",
    "## 오늘 꼭 볼 리포트",
    "- 리포트명 / 이유 / 연결 계좌 / 얻고 싶은 판단",
    "",
    "## 보류 가능 리포트",
    "- 리포트명 / 왜 오늘은 우선순위가 낮은지",
    "",
    "## 다음 질문",
    "- report_XXX: 질문 1",
    "- report_XXX: 질문 2",
    "",
    "## 오늘 읽는 순서",
    "- 1 > 2 > 3",
    "",
    "일반론 말고, 내 계좌 운용 기준으로만 답하세요.",
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
    `❌ build-report-triage-prompt 실패: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
