#!/usr/bin/env node
// 현재 EcoReport 컨텍스트를 묶어 GPT 웹에 던질 자유 질문 프롬프트를 생성합니다.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MAX_TEXT = 4000;

function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    question: "",
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--question" && argv[index + 1]) {
      args.question = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
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

function truncate(value, limit = MAX_TEXT) {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}\n...(truncated)` : value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.question.trim()) {
    throw new Error("--question 값이 필요합니다.");
  }

  const cwd = process.cwd();
  const portfolioPath = path.join(cwd, "data", "portfolio", "latest.json");
  const technicalPath = path.join(cwd, "data", "technical", `${args.date}.json`);
  const strategyPath = path.join(cwd, "config", "strategy.json");
  const synthesisPath = path.join(cwd, "knowledge", "daily", `${args.date}-synthesis.md`);
  const queuePath = path.join(cwd, "knowledge", "daily", `${args.date}-report-summary-queue.md`);
  const manualReportsPath = path.join(cwd, "data", "reports", args.date, "manual-compressed.json");

  const [portfolio, technical, strategy, synthesis, queue, manualReports] = await Promise.all([
    readJson(portfolioPath, null),
    readJson(technicalPath, null),
    readJson(strategyPath, null),
    readText(synthesisPath, ""),
    readText(queuePath, ""),
    readJson(manualReportsPath, []),
  ]);

  const prompt = [
    "# EcoReport 자유 질문 프롬프트",
    "",
    `오늘 날짜는 ${args.date} 입니다.`,
    "아래 컨텍스트를 바탕으로 내 질문에 답하세요. 필요하다면 최신 웹 정보도 함께 참조하되, 답변에서는 오늘 맥락과 내 포트폴리오를 최우선으로 보세요.",
    "",
    `## 내 질문\n${args.question.trim()}`,
    "",
    "## 전략",
    truncate(JSON.stringify(strategy, null, 2), 2500) || "- 없음",
    "",
    "## 포트폴리오",
    truncate(JSON.stringify(portfolio, null, 2), 2500) || "- 없음",
    "",
    "## 기술 점수",
    truncate(JSON.stringify(technical, null, 2), 3500) || "- 없음",
    "",
    "## 시황 종합",
    truncate(synthesis, 2500) || "- 없음",
    "",
    "## PDF 우선순위 큐",
    truncate(queue, 2500) || "- 없음",
    "",
    "## 저장된 PDF 요약",
    truncate(JSON.stringify(manualReports, null, 2), 2500) || "- 없음",
    "",
    "## 응답 원칙",
    "- 내 질문에 바로 답하세요.",
    "- 내 계좌와 실제 행동에 연결하세요.",
    "- 일반론은 최소화하세요.",
    "- 숫자, 비중, 우선순위를 줄 수 있으면 주세요.",
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
    `❌ build-manual-question-prompt 실패: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
