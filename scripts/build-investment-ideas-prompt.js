#!/usr/bin/env node
// 리포트 청크 + 포트폴리오 + 기술점수를 묶어 종목/ETF 추천용 수동 LLM 프롬프트를 생성합니다.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

const MAX_CANDIDATES = 18;
const MAX_REPORT_CHUNKS_PER_CANDIDATE = 2;
const MAX_PORTFOLIO_CHUNKS_PER_CANDIDATE = 1;
const EXCERPT_LIMIT = 260;

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

function truncate(value, limit = EXCERPT_LIMIT) {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function sanitizeFtsQuery(query) {
  const tokens = String(query ?? "")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}_-]+/gu, " ").trim())
    .filter(Boolean)
    .flatMap((token) => token.split(/\s+/))
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `"${token}"`).join(" OR ");
}

function candidateTerms(code, name) {
  const terms = [];
  if (code) terms.push(String(code));
  if (name) {
    terms.push(String(name));
    terms.push(...String(name).split(/[\s/()+-]+/).filter(Boolean));
  }
  return Array.from(new Set(terms.filter(Boolean)));
}

function buildCandidateUniverse(portfolio, watchlist) {
  const map = new Map();

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      const code = holding.code ?? holding.name;
      if (!code) continue;
      const existing = map.get(code) ?? {
        code: holding.code ?? null,
        name: holding.name,
        type: "holding",
        accountHints: new Set(),
        currentlyHeld: true,
        holdingAccounts: new Set(),
      };
      existing.currentlyHeld = true;
      existing.accountHints.add(account.label);
      existing.holdingAccounts.add(account.label);
      map.set(code, existing);
    }
  }

  const pushWatchItems = (items, bucketLabel) => {
    for (const item of items ?? []) {
      const code = item.code ?? item.name;
      if (!code) continue;
      const existing = map.get(code) ?? {
        code: item.code ?? null,
        name: item.name,
        type: bucketLabel,
        accountHints: new Set(),
        currentlyHeld: false,
        holdingAccounts: new Set(),
      };
      if (!existing.name && item.name) existing.name = item.name;
      if (!existing.code && item.code) existing.code = item.code;
      if (!existing.type || existing.type === "holding") existing.type = bucketLabel;
      if (item.account) existing.accountHints.add(item.account);
      map.set(code, existing);
    }
  };

  pushWatchItems(watchlist?.core_etf, "core_etf");
  pushWatchItems(watchlist?.satellite_etf, "satellite_etf");
  pushWatchItems(watchlist?.individual_stocks, "stock");

  return [...map.values()]
    .map((item) => ({
      ...item,
      accountHints: [...item.accountHints],
      holdingAccounts: [...item.holdingAccounts],
    }))
    .slice(0, MAX_CANDIDATES);
}

function lookupTechnicalScore(technical, candidate) {
  const scores = technical?.scores ?? {};
  if (candidate.code && scores[candidate.code]) {
    return scores[candidate.code];
  }
  return Object.values(scores).find((item) => item.name === candidate.name) ?? null;
}

function queryChunks(db, candidate, sourceType, limit) {
  const terms = candidateTerms(candidate.code, candidate.name);
  const queries = terms.map((term) => sanitizeFtsQuery(term)).filter(Boolean);
  const seen = new Set();
  const rows = [];

  const stmt = db.prepare(`
    SELECT
      chunks.source_type,
      chunks.chunk_id,
      chunks.report_id,
      chunks.report_title,
      chunks.account_label,
      chunks.holding_name,
      chunks.section_title,
      chunks.chunk_type,
      chunks.text,
      bm25(chunks_fts) AS score
    FROM chunks_fts
    JOIN chunks ON chunks.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
      AND chunks.source_type = ?
    ORDER BY score
    LIMIT ?
  `);

  for (const query of queries) {
    const found = stmt.all(query, sourceType, limit);
    for (const row of found) {
      if (seen.has(row.chunk_id)) continue;
      seen.add(row.chunk_id);
      rows.push(row);
      if (rows.length >= limit) {
        return rows;
      }
    }
  }

  return rows;
}

function formatCandidate(candidate, technicalItem, reportChunks, portfolioChunks) {
  const kindLabel = candidate.currentlyHeld
    ? "현재 보유"
    : candidate.type === "stock"
      ? "신규 주식 후보"
      : "신규 ETF 후보";

  const accountHint = candidate.accountHints.length > 0 ? candidate.accountHints.join(", ") : "미지정";
  const heldAccounts = candidate.holdingAccounts.length > 0 ? candidate.holdingAccounts.join(", ") : "없음";
  const technicalSummary = technicalItem
    ? `기술점수 ${technicalItem.score ?? "N/A"} / 신호 ${technicalItem.signal ?? "N/A"} / RSI ${technicalItem.rsi ?? "N/A"} / 이유 ${technicalItem.signal_reason ?? "N/A"}`
    : "기술점수 없음";

  const reportSection =
    reportChunks.length > 0
      ? reportChunks
          .map((row) => `  - [리포트] ${row.report_title ?? row.report_id} / ${row.section_title ?? "N/A"} / ${truncate(row.text)}`)
          .join("\n")
      : "  - [리포트] 관련 청크 없음";

  const portfolioSection =
    portfolioChunks.length > 0
      ? portfolioChunks
          .map((row) => `  - [포트폴리오] ${row.account_label ?? "N/A"} / ${row.section_title ?? "N/A"} / ${truncate(row.text)}`)
          .join("\n")
      : "  - [포트폴리오] 관련 청크 없음";

  return [
    `### ${candidate.name}${candidate.code ? ` (${candidate.code})` : ""}`,
    `- 유형: ${kindLabel}`,
    `- 계좌 힌트: ${accountHint}`,
    `- 현재 보유 계좌: ${heldAccounts}`,
    `- ${technicalSummary}`,
    reportSection,
    portfolioSection,
  ].join("\n");
}

function summarizePortfolio(portfolio) {
  if (!portfolio?.accounts?.length) {
    return "- 포트폴리오 정보 없음";
  }

  return portfolio.accounts
    .map(
      (account) =>
        `- ${account.label}: 평가금액 ${won(account.evaluationAmount)} / 예수금 ${won(account.cashAvailable)} / 손익 ${won(account.profitLoss)} / 수익률 ${pct(account.profitRate)} / 보유 ${account.holdings?.map((holding) => holding.name).join(", ") || "없음"}`,
    )
    .join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const portfolioPath = path.join(cwd, "data", "portfolio", "latest.json");
  const watchlistPath = path.join(cwd, "config", "watchlist.json");
  const technicalPath = path.join(cwd, "data", "technical", `${args.date}.json`);
  const briefingPath = path.join(cwd, "knowledge", "daily", `${args.date}-gemini-briefing-rich.md`);
  const fallbackBriefingPath = path.join(cwd, "knowledge", "daily", `${args.date}-gemini-briefing.md`);
  const synthesisPath = path.join(cwd, "knowledge", "daily", `${args.date}-synthesis.md`);
  const dbPath = path.join(cwd, "knowledge", "rag", args.date, "parallel-rag.db");

  const [portfolio, watchlist, technical, richBriefing, fallbackBriefing, synthesis] = await Promise.all([
    readJson(portfolioPath, null),
    readJson(watchlistPath, null),
    readJson(technicalPath, null),
    readText(briefingPath, ""),
    readText(fallbackBriefingPath, ""),
    readText(synthesisPath, ""),
  ]);

  const macroBriefing = richBriefing || fallbackBriefing || synthesis || "- 브리핑 없음";
  const candidates = buildCandidateUniverse(portfolio, watchlist);
  const db = new Database(dbPath, { readonly: true });

  const candidateSections = candidates.map((candidate) => {
    const technicalItem = lookupTechnicalScore(technical, candidate);
    const reportChunks = queryChunks(db, candidate, "report", MAX_REPORT_CHUNKS_PER_CANDIDATE);
    const portfolioChunks = queryChunks(db, candidate, "portfolio", MAX_PORTFOLIO_CHUNKS_PER_CANDIDATE);
    return formatCandidate(candidate, technicalItem, reportChunks, portfolioChunks);
  });

  db.close();

  const prompt = [
    "# EcoReport 수동 LLM 추천 종목·ETF 프롬프트",
    "",
    `오늘 날짜는 ${args.date} 입니다.`,
    "당신은 내 포트폴리오를 실제로 운용하는 추천 엔진입니다.",
    "현재 보유 상태, 기술점수, 리포트 청크, 포트폴리오 청크를 함께 보고 오늘 다시 추천할 종목·ETF를 뽑으세요.",
    "무조건 많이 추천하지 말고, 실제로 오늘 의미 있는 후보만 선별하세요.",
    "",
    "## 오늘 거시/섹터 브리핑",
    truncate(macroBriefing, 6000),
    "",
    "## 현재 포트폴리오",
    summarizePortfolio(portfolio),
    "",
    "## 후보 유니버스",
    candidateSections.join("\n\n"),
    "",
    "## 해야 할 일",
    "1. 오늘 기준 추천 종목·ETF 상위 5개를 순위대로 뽑으세요.",
    "2. 각 후보에 대해 BUY / HOLD / WAIT / REDUCE 중 하나를 주고, 계좌를 지정하세요.",
    "3. 현재 보유 종목 중 추가 보강할 것과, 신규로 볼 만한 것의 비중을 구분하세요.",
    "4. 추천 근거는 반드시 리포트/기술점수/포트폴리오 상태를 함께 연결해서 설명하세요.",
    "5. 추천하지 않는 후보 3개도 따로 적고, 왜 지금은 아닌지 설명하세요.",
    "",
    "## 출력 형식",
    "## 오늘 추천 Top 5",
    "- 1위 / 종목명(코드) / 계좌 / 행동 / 이유 / 어떤 조건이면 무효인지",
    "- 2위 ...",
    "",
    "## 보유 종목 중 보강 후보",
    "- 항목별",
    "",
    "## 신규 편입 후보",
    "- 항목별",
    "",
    "## 지금은 아닌 후보",
    "- 항목별",
    "",
    "## 실행 메모",
    "- 오늘 바로 할 수 있는 행동만 적기",
  ].join("\n");

  const outputPath = args.output
    ? path.isAbsolute(args.output)
      ? args.output
      : path.join(cwd, args.output)
    : path.join(cwd, "reports", "daily", `${args.date}-investment-ideas-prompt.md`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, prompt, "utf8");

  process.stdout.write(prompt);
}

main().catch((error) => {
  console.error(
    `❌ build-investment-ideas-prompt 실패: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
