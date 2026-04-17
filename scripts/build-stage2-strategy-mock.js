#!/usr/bin/env node
// 2단계 목업: 실제 LLM 응답 대신 전략 옵션 JSON을 휴리스틱으로 생성합니다.

import path from "node:path";

import {
  buildRunMetadata,
  parseDateArgs,
  withContract,
  writeJson,
} from "./lib/pipeline-utils.js";
import { loadAnalysisContext } from "./lib/analysis-context.js";

const ACCOUNT_KEY_MAP = {
  ISA: "ISA",
  PENSION: "PENSION",
  KIS_MAIN: "KIS_MAIN",
};

function parseMockArgs(argv) {
  const args = parseDateArgs(argv);
  args.mockMode = "test";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mock-mode" && argv[index + 1]) {
      args.mockMode = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function resolveMockMode(rawMode, outputPath) {
  const normalized = String(rawMode ?? "test").trim().toLowerCase();
  if (normalized === "fallback") {
    return "fallback";
  }
  if (path.basename(outputPath) === "stage2-strategy-options.json") {
    return "fallback";
  }
  return "test";
}

function regimeFromTechnical(technical) {
  const market = technical?.market_context ?? {};
  if (typeof market.vix === "number" && market.vix >= 30) {
    return { regime: "HIGH_VOL", confidence: "MEDIUM", summary: "변동성 우위 장세" };
  }
  if (market.close > market.ma?.ma20 && market.ma?.ma20 > market.ma?.ma60 && market.score >= 55) {
    return { regime: "BULL", confidence: "MEDIUM", summary: "추세 우상향 장세" };
  }
  if (market.close < market.ma?.ma20 && market.ma?.ma20 < market.ma?.ma60 && market.score <= 40) {
    return { regime: "BEAR", confidence: "MEDIUM", summary: "추세 약세 장세" };
  }
  return { regime: "SIDEWAYS", confidence: "MEDIUM", summary: "방향성보다 선별이 중요한 횡보 장세" };
}

function aggregateThemes(stage1) {
  const themeMap = new Map();
  for (const extract of stage1.extracts ?? []) {
    for (const theme of extract.themes ?? []) {
      const current = themeMap.get(theme) ?? { positive: 0, negative: 0, reports: [] };
      const direction = (extract.portfolio_impacts_candidate ?? [])[0]?.direction ?? "neutral";
      if (direction === "positive") current.positive += 1;
      if (direction === "negative") current.negative += 1;
      current.reports.push(extract.id);
      themeMap.set(theme, current);
    }
  }
  return [...themeMap.entries()]
    .map(([theme, value]) => ({
      theme,
      direction:
        value.positive > value.negative ? "reinforce" : value.negative > value.positive ? "reduce" : "watch",
      why_now: `${value.reports.length}개 리포트에서 ${theme} 관련 논리가 확인됨`,
      source_reports: value.reports.slice(0, 5),
    }))
    .slice(0, 8);
}

function buildAccountActions(portfolio, technical, watchlist) {
  const actions = [];
  const scores = technical?.scores ?? {};
  for (const account of portfolio.accounts ?? []) {
    const key = ACCOUNT_KEY_MAP[account.key] ?? account.key;
    const holdingCodes = new Set((account.holdings ?? []).map((holding) => holding.code));
    const buyCandidates = [];
    const trimCandidates = [];
    const holdCandidates = [];

    for (const holding of account.holdings ?? []) {
      const score = scores[holding.code]?.score ?? 50;
      if (score >= 65) buyCandidates.push(holding.code);
      else if (score <= 35) trimCandidates.push(holding.code);
      else holdCandidates.push(holding.code);
    }

    for (const item of [...(watchlist.core_etf ?? []), ...(watchlist.satellite_etf ?? []), ...(watchlist.individual_stocks ?? [])]) {
      if (holdingCodes.has(item.code)) continue;
      if (!item.account || !normalizeAccountHint(item.account, account)) continue;
      const score = scores[item.code]?.score ?? 50;
      if (score >= 55) {
        buyCandidates.push(item.code);
      }
    }

    const bias =
      buyCandidates.length >= 2 ? "selective_add" : trimCandidates.length >= 2 ? "defensive" : "hold";

    actions.push({
      account_key: key,
      bias,
      rationale:
        bias === "selective_add"
          ? "기술점수 상위 보유/후보가 존재해 선별 보강이 가능한 상태"
          : bias === "defensive"
            ? "기술점수 하위 보유분이 있어 방어적 운용이 필요"
            : "배분 유지와 선택적 관찰이 적절한 상태",
      buy_candidates: [...new Set(buyCandidates)].slice(0, 4),
      trim_candidates: [...new Set(trimCandidates)].slice(0, 4),
      hold_candidates: [...new Set(holdCandidates)].slice(0, 4),
      reserve_cash_note: "다음 tranche 전까지 예수금 일부를 유지하며 분할 접근",
    });
  }
  return actions;
}

function normalizeAccountHint(itemAccount, account) {
  return (
    itemAccount === account.label ||
    itemAccount === account.key ||
    (itemAccount === "연금저축" && account.key === "PENSION") ||
    ((itemAccount === "토스" || itemAccount === "토스증권") && account.key === "KIS_MAIN") ||
    ((itemAccount === "한투" || itemAccount === "한투 일반" || itemAccount === "한국투자증권") && account.key === "KIS_MAIN")
  );
}

function buildCandidateScores(portfolio, watchlist, technical) {
  const scores = technical?.scores ?? {};
  const entries = [];
  const allItems = [
    ...(portfolio.accounts ?? []).flatMap((account) =>
      (account.holdings ?? []).map((holding) => ({
        code: holding.code,
        name: holding.name,
        target_accounts: [account.key],
      })),
    ),
    ...(watchlist.core_etf ?? []),
    ...(watchlist.satellite_etf ?? []),
    ...(watchlist.individual_stocks ?? []),
  ];

  const seen = new Set();
  for (const item of allItems) {
    if (!item.code || seen.has(item.code)) continue;
    seen.add(item.code);
    const tech = scores[item.code];
    const score = tech?.score ?? 50;
    entries.push({
      code: item.code,
      name: item.name,
      stance: score >= 65 ? "buy" : score <= 35 ? "trim" : score >= 45 ? "hold" : "watch",
      target_accounts: [
        ...(item.account ? [item.account] : []),
        ...new Set(item.target_accounts ?? []),
      ].filter(Boolean),
      horizon: score >= 65 ? "3m" : "1m",
      confidence: score >= 70 || score <= 30 ? "HIGH" : score >= 55 || score <= 40 ? "MEDIUM" : "LOW",
      thesis: tech?.signal_reason ?? "기술점수와 현재 배분 상태를 기준으로 분류",
      risks: tech?.alerts ?? [],
    });
  }

  return entries.slice(0, 24);
}

async function main() {
  const args = parseMockArgs(process.argv.slice(2));
  const context = await loadAnalysisContext(args, {
    stage1: true,
    portfolio: true,
    technical: true,
    watchlist: true,
  });
  const { paths, data } = context;
  const { stage1, portfolio, technical, watchlist } = data;

  const outputPath =
    args.output ?? path.join(paths.analysisDir, "stage2-strategy-options.mock.json");
  const mockMode = resolveMockMode(args.mockMode, outputPath);
  const runMeta = buildRunMetadata(args);

  const payload = {
    ...runMeta,
    source: "mock",
    mockMode,
    purpose:
      mockMode === "fallback"
        ? "gemini_unavailable_fallback"
        : "deterministic_test_fixture",
    safeForProduction: false,
    macro_view: regimeFromTechnical(technical),
    strategy_changes: aggregateThemes(stage1),
    account_actions: buildAccountActions(portfolio, technical, watchlist),
    candidate_scores: buildCandidateScores(portfolio, watchlist, technical),
    portfolio_risks: [
      "리포트 기반 영향도는 휴리스틱 추출이므로 과신 금지",
      "기술점수는 일간 스냅샷 기반이라 추세 반전 초입은 놓칠 수 있음",
    ],
  };

  await writeJson(
    outputPath,
    withContract(payload, {
      stage: "stage2",
      generatedAt: runMeta.generatedAt,
    }),
  );
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage2 mock 생성 실패: ${error.message}`);
  process.exit(1);
});
