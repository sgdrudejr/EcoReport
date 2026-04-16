#!/usr/bin/env node
// 네이버 증권 PDF 리포트 중 수동 LLM으로 먼저 읽을 우선순위 큐를 생성합니다.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_LIMIT = 10;
const MAX_TEXT_CHARS = 5000;

const TITLE_KEYWORDS = [
  ["목표가", 10],
  ["상향", 8],
  ["실적", 9],
  ["가이던스", 9],
  ["수주", 9],
  ["hbm", 10],
  ["dram", 8],
  ["낸드", 7],
  ["반도체", 9],
  ["전력", 8],
  ["변압기", 8],
  ["방산", 8],
  ["원자력", 8],
  ["smr", 8],
  ["금리", 8],
  ["환율", 8],
  ["유가", 8],
  ["이란", 8],
  ["관세", 7],
  ["fomc", 8],
];

const MACRO_KEYWORDS = [
  "금리",
  "유가",
  "환율",
  "관세",
  "연준",
  "fomc",
  "미국채",
  "국채",
  "달러",
  "이란",
  "호르무즈",
  "중동",
  "인플레",
  "물가",
];

function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    limit: DEFAULT_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--limit" && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        args.limit = value;
      }
      index += 1;
    }
  }

  return args;
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
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

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit = MAX_TEXT_CHARS) {
  if (!value) {
    return "";
  }

  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function containsKeyword(text, keyword) {
  return normalize(text).includes(normalize(keyword));
}

function scoreTitleKeywords(text) {
  let score = 0;
  const matches = [];

  for (const [keyword, weight] of TITLE_KEYWORDS) {
    if (containsKeyword(text, keyword)) {
      score += weight;
      matches.push(keyword);
    }
  }

  return { score, matches };
}

function buildCoverageMaps(watchlist, portfolio) {
  const watchCodes = new Map();
  const watchNames = new Map();
  const holdingCodes = new Map();
  const holdingNames = new Map();

  const watchBuckets = [
    ...(watchlist?.core_etf ?? []),
    ...(watchlist?.satellite_etf ?? []),
    ...(watchlist?.individual_stocks ?? []),
  ];

  for (const item of watchBuckets) {
    if (item.code) watchCodes.set(item.code, item);
    if (item.name) watchNames.set(normalize(item.name), item);
  }

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      const enriched = {
        ...holding,
        accountKey: account.key,
        accountLabel: account.label,
      };
      if (holding.code) holdingCodes.set(holding.code, enriched);
      if (holding.name) holdingNames.set(normalize(holding.name), enriched);
    }
  }

  return {
    watchCodes,
    watchNames,
    holdingCodes,
    holdingNames,
  };
}

function summarizePortfolioForPrompt(portfolio, relatedAccounts = []) {
  if (!portfolio?.accounts?.length) {
    return ["- 현재 저장된 포트폴리오 스냅샷이 없습니다."];
  }

  const relatedSet = new Set(relatedAccounts);
  const prioritized = [];
  const secondary = [];

  for (const account of portfolio.accounts) {
    const line = [
      `### ${account.label} (${account.key})`,
      ...((account.holdings ?? []).length > 0
        ? account.holdings.map((holding) => {
            const rate =
              typeof holding.profitRate === "number" && Number.isFinite(holding.profitRate)
                ? `, ${holding.profitRate.toFixed(2)}%`
                : "";
            return `- ${holding.name} (${holding.code ?? "N/A"}) / ${holding.quantity ?? "N/A"}주 / 손익 ${holding.profitLoss ?? "N/A"}${rate}`;
          })
        : ["- 보유 종목 없음"]),
    ].join("\n");

    if (relatedSet.size > 0 && (relatedSet.has(account.label) || relatedSet.has(account.key))) {
      prioritized.push(line);
    } else {
      secondary.push(line);
    }
  }

  return [...prioritized, ...secondary];
}

function scoreReport(report, coverage) {
  let score = 10;
  const reasons = [];
  const relatedAccounts = new Set();
  const matchedTickers = new Set();
  const matchedNames = new Set();
  const title = report.title ?? "";
  const text = report.extracted_text ?? "";
  const combinedText = `${title}\n${text}`;

  if (report.category === "종목분석") {
    score += 14;
    reasons.push("종목분석 리포트라 직접 매매 연결도가 높음");
  } else if (report.category === "경제분석") {
    score += 10;
    relatedAccounts.add("ISA");
    relatedAccounts.add("연금저축");
    relatedAccounts.add("한투 일반");
    reasons.push("매크로 리포트라 전체 포트폴리오 자산배분 판단에 영향");
  } else if (report.category === "산업분석") {
    score += 8;
    reasons.push("산업분석 리포트라 섹터/테마 방향성 판단에 도움");
  }

  if (report.ticker && coverage.holdingCodes.has(report.ticker)) {
    const holding = coverage.holdingCodes.get(report.ticker);
    score += 40;
    relatedAccounts.add(holding.accountLabel);
    matchedTickers.add(report.ticker);
    reasons.push(`현재 보유 종목(${holding.name}) 직접 관련`);
  } else if (report.ticker && coverage.watchCodes.has(report.ticker)) {
    const watch = coverage.watchCodes.get(report.ticker);
    score += 28;
    matchedTickers.add(report.ticker);
    if (watch.account) {
      relatedAccounts.add(watch.account);
    }
    reasons.push(`관심 종목/ETF(${watch.name}) 직접 관련`);
  }

  for (const [name, holding] of coverage.holdingNames.entries()) {
    if (containsKeyword(combinedText, name)) {
      score += 16;
      relatedAccounts.add(holding.accountLabel);
      matchedNames.add(holding.name);
      reasons.push(`보유 종목명(${holding.name})이 본문/제목에 언급됨`);
    }
  }

  for (const [name, watch] of coverage.watchNames.entries()) {
    if (matchedNames.has(watch.name)) {
      continue;
    }
    if (containsKeyword(combinedText, name)) {
      score += 10;
      matchedNames.add(watch.name);
      if (watch.account) {
        relatedAccounts.add(watch.account);
      }
      reasons.push(`관심 종목/ETF명(${watch.name})이 본문/제목에 언급됨`);
    }
  }

  const titleSignals = scoreTitleKeywords(title);
  if (titleSignals.score > 0) {
    score += titleSignals.score;
    reasons.push(`제목 핵심 키워드 감지: ${titleSignals.matches.join(", ")}`);
  }

  const macroMatches = MACRO_KEYWORDS.filter((keyword) =>
    containsKeyword(combinedText, keyword),
  );
  if (report.category === "경제분석" && macroMatches.length > 0) {
    score += Math.min(18, macroMatches.length * 4);
    reasons.push(`매크로 핵심 변수 언급: ${macroMatches.slice(0, 4).join(", ")}`);
  }

  if (report.opinion) {
    score += 6;
    reasons.push(`투자의견 정보 포함 (${report.opinion})`);
  }

  if (report.target_price) {
    score += 6;
    reasons.push("목표가 정보 포함");
  }

  if ((report.text_length ?? 0) >= 2500) {
    score += 4;
    reasons.push("본문 길이가 충분해 요약 가치가 높음");
  }

  const priorityScore = Math.max(0, Math.min(100, score));
  const priorityLabel =
    priorityScore >= 75 ? "HIGH" : priorityScore >= 55 ? "MEDIUM" : "LOW";

  return {
    priorityScore,
    priorityLabel,
    reasons: [...new Set(reasons)].slice(0, 6),
    relatedAccounts: [...relatedAccounts],
    matchedTickers: [...matchedTickers],
    matchedNames: [...matchedNames],
  };
}

function buildPrompt(template, report, queueItem, portfolio) {
  const portfolioContext = summarizePortfolioForPrompt(portfolio, queueItem.relatedAccounts);
  return [
    "# EcoReport 수동 PDF 깊은 리포트 추출 프롬프트",
    "",
    "아래 리포트를 읽고 지정된 JSON만 출력하세요.",
    "이번 작업은 단순 압축이 아니라 research extract v2를 만드는 단계입니다.",
    "현재 포트폴리오와 직접 연결되는 내용, 새 정보, 기존 논리 대비 바뀐 점, 실제 운용 시사점을 우선 정리하세요.",
    "",
    "## 이 리포트를 먼저 보는 이유",
    `- 우선순위 점수: ${queueItem.priorityScore} (${queueItem.priorityLabel})`,
    ...(queueItem.reasons.length > 0
      ? queueItem.reasons.map((reason) => `- ${reason}`)
      : ["- 일반 우선순위 큐"]),
    ...(queueItem.relatedAccounts.length > 0
      ? [`- 관련 계좌: ${queueItem.relatedAccounts.join(", ")}`]
      : []),
    "",
    "## 내 현재 포트폴리오 컨텍스트",
    ...portfolioContext,
    "",
    "## 출력 원칙",
    "- 사실과 해석을 섞지 말고 evidence_notes와 key_numbers에 근거를 남기세요.",
    "- what_changed에는 기존 컨센서스 대비 실제로 달라진 점만 적으세요.",
    "- portfolio_impacts에는 내 보유 종목/계좌와 연결되는 영향만 넣으세요. 없으면 빈 배열로 두세요.",
    "- scenario_branches에는 반드시 Main Scenario / Risk Scenario 2개를 넣고, 확률 합은 100으로 맞추세요.",
    "- scenario_branches의 portfolio_response에는 실제로 달라질 내 대응을 적으세요.",
    "- catalyst_timeline에는 향후 6개월 내 주가 상승/하락을 크게 움직일 이벤트와 예상 시기를 넣으세요.",
    "- time_horizon_summary는 1주/1개월/3개월/6개월 관점에서 각각 한 줄씩 요약하세요.",
    "- confidence는 리포트 자체의 신뢰도와 명확성을 기준으로 평가하세요.",
    "",
    template.trim(),
    "",
    "## 메타데이터",
    `- ID: ${report.id}`,
    `- 제목: ${report.title ?? ""}`,
    `- 증권사: ${report.broker ?? ""}`,
    `- 날짜: ${report.date ?? ""}`,
    `- 카테고리: ${report.category ?? ""}`,
    `- 종목코드: ${report.ticker ?? ""}`,
    `- 종목명: ${report.ticker_name ?? ""}`,
    `- 투자의견: ${report.opinion ?? ""}`,
    `- 목표가: ${report.target_price ?? ""}`,
    `- PDF 경로: ${report.pdf_path ?? ""}`,
    "",
    "## 리포트 본문",
    truncate(report.extracted_text ?? "", MAX_TEXT_CHARS) || "(본문 없음)",
    "",
  ].join("\n");
}

function buildQueueMarkdown(date, items) {
  const summaryLines = items.map((item) => {
    const tickerPart =
      item.ticker || item.ticker_name
        ? ` / ${item.ticker_name ?? ""}${item.ticker ? ` (${item.ticker})` : ""}`
        : "";
    const accountPart =
      item.relatedAccounts.length > 0
        ? ` / 관련 계좌: ${item.relatedAccounts.join(", ")}`
        : "";
    const promptPart = item.promptPath
      ? ` / 프롬프트: ${item.promptPath}`
      : "";

    return [
      `## ${item.rank}. ${item.title}`,
      `- 우선순위: ${item.priorityScore}점 (${item.priorityLabel})`,
      `- 메타: [${item.category}] ${item.broker}${tickerPart}${accountPart}`,
      ...(item.reasons.length > 0
        ? item.reasons.map((reason) => `- 이유: ${reason}`)
        : []),
      `- 발췌: ${truncate(item.excerpt, 220)}`,
      promptPart ? `- 프롬프트: ${item.promptPath}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `# ${date} PDF 수동 요약 큐`,
    "",
    "오늘 수집된 네이버 증권 리포트 중, 내 포트폴리오/관심 종목/핵심 매크로와 연결도가 높은 문서만 우선순위 큐로 정리했습니다.",
    "",
    "## 사용 방법",
    "- 아래 우선순위 순서대로 개별 프롬프트 파일을 Claude Code 또는 Codex에 넣어 JSON 요약을 받습니다.",
    "- 요약 결과는 나중에 compressed.json 또는 수동 요약 저장 파일로 옮기면 됩니다.",
    "- 점수가 낮은 문서는 시간이 남을 때만 읽어도 됩니다.",
    "",
    ...summaryLines,
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const reportsPath = path.join(cwd, "data", "reports", args.date, "index.json");
  const queueJsonPath = path.join(cwd, "knowledge", "daily", `${args.date}-report-summary-queue.json`);
  const queueMarkdownPath = path.join(cwd, "knowledge", "daily", `${args.date}-report-summary-queue.md`);
  const promptDir = path.join(cwd, "knowledge", "daily", "report-prompts", args.date);
  const templatePath = path.join(cwd, "prompts", "compress-report.md");
  const watchlistPath = path.join(cwd, "config", "watchlist.json");
  const portfolioPath = path.join(cwd, "data", "portfolio", "latest.json");

  const [reports, watchlist, portfolio, template] = await Promise.all([
    readJson(reportsPath, []),
    readJson(watchlistPath, {}),
    readJson(portfolioPath, null),
    readText(templatePath, ""),
  ]);

  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error(`우선순위를 만들 리포트가 없습니다: ${reportsPath}`);
  }

  const coverage = buildCoverageMaps(watchlist, portfolio);
  const ranked = reports
    .map((report) => {
      const scored = scoreReport(report, coverage);
      return {
        ...report,
        ...scored,
        excerpt: report.extracted_text ?? "",
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, args.limit)
    .map((item, index) => ({
      rank: index + 1,
      id: item.id,
      title: item.title,
      broker: item.broker,
      date: item.date,
      category: item.category,
      ticker: item.ticker ?? null,
      ticker_name: item.ticker_name ?? null,
      opinion: item.opinion ?? null,
      target_price: item.target_price ?? null,
      pdf_path: item.pdf_path,
      text_length: item.text_length ?? null,
      priorityScore: item.priorityScore,
      priorityLabel: item.priorityLabel,
      reasons: item.reasons,
      relatedAccounts: item.relatedAccounts,
      matchedTickers: item.matchedTickers,
      matchedNames: item.matchedNames,
      excerpt: truncate(item.excerpt, 500),
      promptPath: path.relative(cwd, path.join(promptDir, `${item.id}.md`)),
      raw: item,
    }));

  await fs.mkdir(promptDir, { recursive: true });
  for (const item of ranked) {
    const prompt = buildPrompt(template, item.raw, item, portfolio);
    await fs.writeFile(path.join(promptDir, `${item.id}.md`), prompt, "utf8");
  }

  const jsonPayload = {
    date: args.date,
    generatedAt: new Date().toISOString(),
    totalReports: reports.length,
    selectedReports: ranked.length,
    items: ranked.map(({ raw, ...item }) => item),
  };

  await fs.mkdir(path.dirname(queueJsonPath), { recursive: true });
  await fs.writeFile(queueJsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(queueMarkdownPath, buildQueueMarkdown(args.date, ranked), "utf8");

  console.log(`✅ PDF 수동 요약 큐 생성 완료`);
  console.log(`- JSON: ${path.relative(cwd, queueJsonPath)}`);
  console.log(`- Markdown: ${path.relative(cwd, queueMarkdownPath)}`);
  console.log(`- Prompt dir: ${path.relative(cwd, promptDir)}`);
  console.log(`- 선택 리포트: ${ranked.length}/${reports.length}`);
}

main().catch((error) => {
  console.error(
    `❌ build-report-summary-queue 실패: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
