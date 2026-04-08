#!/usr/bin/env node
// 2단계: Stage 1 추출물과 포트폴리오/기술점수를 바탕으로 LLM 전략 탐색 프롬프트를 생성합니다.

import path from "node:path";

import {
  ROOT_DIR,
  buildPortfolioMaps,
  parseDateArgs,
  readJson,
  readText,
  truncate,
  writeText,
  won,
} from "./lib/pipeline-utils.js";

function summarizeAccounts(portfolio) {
  return (portfolio?.accounts ?? [])
    .map((account) => {
      const holdings = (account.holdings ?? [])
        .map((holding) => `${holding.name}(${holding.code ?? "N/A"}) ${holding.quantity ?? "N/A"}주`)
        .join(", ");
      return `- ${account.label}(${account.key}): 평가 ${won(account.evaluationAmount)} / 예수금 ${won(account.cashAvailable)} / 보유 ${holdings || "없음"}`;
    })
    .join("\n");
}

function listAccountKeys(portfolio) {
  return (portfolio?.accounts ?? [])
    .map((account) => account.key)
    .filter(Boolean);
}

function buildTechnicalSubset(portfolio, technical, watchlist) {
  const portfolioMaps = buildPortfolioMaps(portfolio);
  const codes = new Set([
    ...portfolioMaps.holdingsByCode.keys(),
    ...(watchlist?.core_etf ?? []).map((item) => item.code),
    ...(watchlist?.satellite_etf ?? []).map((item) => item.code),
  ]);

  const scores = technical?.scores ?? {};
  return [...codes]
    .map((code) => {
      const item = scores[code];
      if (!item) return null;
      return {
        code,
        name: item.name,
        score: item.score,
        signal: item.signal,
        signal_reason: truncate(item.signal_reason ?? "", 180),
        rsi: item.rsi,
        bollinger_position: item?.bollinger?.position ?? null,
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const stage1Path = path.join(stateDir, "stage1-report-extracts-v2.json");
  const portfolioPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const technicalPath = path.join(ROOT_DIR, "data", "technical", `${args.date}.json`);
  const richBriefingPath = path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-gemini-briefing-rich.md`);
  const outputPath =
    args.output ??
    path.join(ROOT_DIR, "knowledge", "daily", "manual-kit", args.date, "08-stage2-strategy-prompt.md");

  const [stage1, portfolio, technical, briefing, watchlist] = await Promise.all([
    readJson(stage1Path, { extracts: [] }),
    readJson(portfolioPath, { accounts: [] }),
    readJson(technicalPath, { market_context: {}, scores: {} }),
    readText(richBriefingPath, ""),
    readJson(path.join(ROOT_DIR, "config", "watchlist.json"), {}),
  ]);

  const directExtracts = stage1.extracts
    .filter((item) => item.related_holdings_in_my_portfolio.length > 0 || item.portfolio_impacts_candidate.length > 0)
    .slice(0, 12);
  const macroExtracts = stage1.extracts.filter((item) => item.report_type === "macro").slice(0, 5);
  const technicalSubset = buildTechnicalSubset(portfolio, technical, watchlist);
  const briefingSummary = truncate(briefing, 5000);
  const accountKeys = listAccountKeys(portfolio);
  const accountKeyHint = accountKeys.length > 0 ? accountKeys.join("|") : "ACCOUNT_KEY";

  const prompt = [
    "# EcoReport Stage 2 Strategy Exploration",
    "",
    `실행일은 ${args.runDate}, 기준 거래일은 ${args.effectiveMarketDate} 입니다.`,
    `오늘 날짜는 ${args.date} 입니다.`,
    "당신은 내 포트폴리오를 실제로 운용하는 전략 탐색 LLM입니다.",
    "아래 Stage 1 연구 노트, 계좌 상태, 기술점수를 바탕으로 새로운 투자 전략 옵션을 설계하세요.",
    "일반론보다 실제 운용 가능한 계좌별 대안을 제시하세요.",
    "",
    "## 내 현재 계좌",
    summarizeAccounts(portfolio),
    "",
    "## 시장/섹터 브리핑",
    briefingSummary || "- rich briefing 없음",
    "",
    "## 직접 관련 리포트 연구 노트",
    JSON.stringify(directExtracts, null, 2),
    "",
    "## 매크로/전략 리포트 연구 노트",
    JSON.stringify(macroExtracts, null, 2),
    "",
    "## 기술점수 스냅샷",
    JSON.stringify(
      {
        market_context: technical?.market_context ?? {},
        relevant_scores: technicalSubset,
      },
      null,
      2,
    ),
    "",
    "## 출력 요구사항",
    "반드시 유효한 JSON으로만 답하세요.",
    "문장은 짧게, 각 문자열은 1~2문장 이내로 유지하세요.",
    "strategy_changes는 최대 4개, candidate_scores는 최대 8개까지만 반환하세요.",
    "buy_candidates / trim_candidates / hold_candidates는 각 계좌당 최대 3개까지만 반환하세요.",
    "",
    JSON.stringify(
      {
        date: args.date,
        macro_view: {
          regime: "BULL|SIDEWAYS|BEAR|HIGH_VOL",
          confidence: "HIGH|MEDIUM|LOW",
          summary: "시장 레짐 요약",
        },
        strategy_changes: [
          {
            theme: "예: AI 인프라",
            direction: "reinforce|reduce|watch",
            why_now: "왜 지금 중요한지",
            source_reports: ["report_012"],
          },
        ],
        account_actions: [
          {
            account_key: accountKeyHint,
            bias: "aggressive_add|selective_add|hold|defensive",
            rationale: "계좌 운용 핵심 논리",
            buy_candidates: ["360750"],
            trim_candidates: ["132030"],
            hold_candidates: ["458760"],
            reserve_cash_note: "현금 운영 원칙",
          },
        ],
        candidate_scores: [
          {
            code: "360750",
            name: "TIGER 미국S&P500",
            stance: "buy|hold|trim|watch",
            target_accounts: [accountKeys[0] ?? "ACCOUNT_KEY"],
            horizon: "1m|3m|6m",
            confidence: "HIGH|MEDIUM|LOW",
            thesis: "핵심 투자 논리",
            risks: ["위험요인"],
          },
        ],
        portfolio_risks: ["핵심 위험 1", "핵심 위험 2"],
      },
      null,
      2,
    ),
  ].join("\n");

  await writeText(outputPath, `${prompt}\n`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage2 strategy prompt 생성 실패: ${error.message}`);
  process.exit(1);
});
