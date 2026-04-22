#!/usr/bin/env node
// Stage 1.5: stage1-research-agenda 우선, 없으면 Stage 1 extracts 추론으로
// Gemini Deep Research 프롬프트를 3분할(매크로/섹터·종목/신규후보) 생성한다.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  truncate,
  writeText,
  won,
} from "./lib/pipeline-utils.js";
import { loadAnalysisContext } from "./lib/analysis-context.js";
import { formatMarketVoiceForPrompt } from "./lib/marketvoice-utils.js";
import { formatStockeasyForPrompt } from "./lib/stockeasy-utils.js";

const LEGACY_OUTPUT_NAME = "07-stage1-5-gemini-deep-research-prompt.md";
const OUTPUT_BY_PART = {
  macro: "07a-stage1-5-macro-prompt.md",
  sector: "07b-stage1-5-sector-prompt.md",
  newcandidate: "07c-stage1-5-newcandidate-prompt.md",
};

const PART_CONFIG = {
  macro: {
    title: "매크로",
    goal: "매크로 레짐과 포트폴리오 리스크/헤지 축을 집중 점검",
    topicTypes: new Set(["macro"]),
    maxChars: 4000,
    maxTopics: 4,
  },
  sector: {
    title: "섹터·종목",
    goal: "보유 종목과 연관 섹터의 업황/실적/밸류에이션을 집중 점검",
    topicTypes: new Set(["sector", "security"]),
    maxChars: 5000,
    maxTopics: 6,
  },
  newcandidate: {
    title: "신규후보",
    goal: "미보유 신규 후보와 대안 자산을 집중 발굴",
    topicTypes: new Set(["new_candidate"]),
    maxChars: 4000,
    maxTopics: 4,
  },
};

const PART_ORDER = ["macro", "sector", "newcandidate"];

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hardLimit(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function parseArgs(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    part: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--part" && argv[index + 1]) {
      args.part = String(argv[index + 1]).toLowerCase();
      index += 1;
    }
  }

  if (args.part && !PART_ORDER.includes(args.part)) {
    throw new Error(`지원하지 않는 --part 입니다: ${args.part} (macro|sector|newcandidate)`);
  }

  return args;
}

function resolveManualKitDir(date) {
  return path.join(ROOT_DIR, "knowledge", "daily", "manual-kit", date);
}

function resolveLegacyOutputPath(date) {
  return path.join(resolveManualKitDir(date), LEGACY_OUTPUT_NAME);
}

function resolvePartOutputPath(date, part, explicitOutput = null) {
  if (explicitOutput) {
    return path.isAbsolute(explicitOutput) ? explicitOutput : path.join(ROOT_DIR, explicitOutput);
  }
  return path.join(resolveManualKitDir(date), OUTPUT_BY_PART[part]);
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

function copyToClipboard(text) {
  const result = spawnSync("pbcopy", { input: text, encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "pbcopy 실행 실패");
  }
}

function sumAccountField(accounts, key) {
  return accounts.reduce((total, account) => {
    const value = account?.[key];
    return typeof value === "number" && Number.isFinite(value) ? total + value : total;
  }, 0);
}

function buildPortfolioContext(portfolio, limit = 500) {
  const accounts = portfolio?.accounts ?? [];
  if (accounts.length === 0) {
    return "계좌 데이터가 비어 있어 포트폴리오 컨텍스트를 축약 제공합니다.";
  }

  const totalEval = sumAccountField(accounts, "evaluationAmount");
  const totalCash = sumAccountField(accounts, "cashAvailable");

  const lines = [
    `총 평가 ${won(totalEval)}, 총 현금 ${won(totalCash)}, 계좌 ${accounts.length}개`,
  ];

  for (const account of accounts) {
    const accountLabel = account?.label ?? account?.key ?? "계좌";
    const accountKey = account?.key ?? "N/A";
    const holdings = (account?.holdings ?? []).slice(0, 3).map((item) => item?.name).filter(Boolean);

    lines.push(
      `${accountLabel}(${accountKey}): 보유 ${account?.holdings?.length ?? 0}개, 현금 ${won(account?.cashAvailable)}${
        holdings.length > 0 ? `, 핵심 ${holdings.join("/")}` : ""
      }`,
    );
  }

  return hardLimit(lines.join(" | "), limit);
}

function buildCurrentHoldingsContext(portfolio, limit = 600) {
  const accounts = portfolio?.accounts ?? [];
  const lines = [];

  for (const account of accounts) {
    const accountLabel = account?.label ?? account?.key ?? "계좌";
    const holdings = (account?.holdings ?? [])
      .slice(0, 5)
      .map((item) => item?.name)
      .filter(Boolean);

    const cash = won(account?.cashAvailable);
    if (holdings.length > 0) {
      lines.push(`${accountLabel}: 보유 ${holdings.join(", ")} / 현금 ${cash}`);
    } else {
      lines.push(`${accountLabel}: 보유 없음 / 현금 ${cash}`);
    }
  }

  return hardLimit(lines.join(" | "), limit);
}

function buildPersonalizedRiskContext(portfolio, topics = [], limit = 600) {
  const accounts = portfolio?.accounts ?? [];
  const holdings = accounts.flatMap((account) => account?.holdings ?? []);
  const holdingNames = holdings.map((item) => compact(item?.name)).filter(Boolean);
  const totalEval = sumAccountField(accounts, "evaluationAmount");
  const totalCash = sumAccountField(accounts, "cashAvailable");
  const cashRatio = totalEval > 0 ? `${Math.round((totalCash / totalEval) * 100)}%` : "N/A";

  const overlappingTopics = [];
  for (const topic of topics) {
    const topicSignal = compact([topic?.label, topic?.summary, ...(topic?.keywords ?? [])].join(" ")).toLowerCase();
    const matchedHolding = holdingNames.find((name) => topicSignal.includes(name.toLowerCase()));
    if (matchedHolding) {
      overlappingTopics.push(`${topic.label} ↔ ${matchedHolding}`);
    }
    if (overlappingTopics.length >= 4) break;
  }

  const lines = [
    `총 현금 비중 ${cashRatio} 수준으로 대기 자금 활용 여부를 같이 판단할 것`,
    holdingNames.length > 0
      ? `현재 보유와 직접 겹치는 이슈는 기존 보유 유지/축소/교체 관점까지 평가할 것`
      : "현재 보유가 거의 없으면 신규 편입 우선순위를 더 명확히 제시할 것",
  ];

  if (overlappingTopics.length > 0) {
    lines.push(`직접 겹침 후보: ${overlappingTopics.join(" / ")}`);
  }

  return hardLimit(lines.join(" | "), limit);
}

function selectStockeasyContextByPart(stockeasyMarkdown, marketVoiceMarkdown, part, limit = 500) {
  const lines = String(stockeasyMarkdown ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const marketVoiceLine = compact(
    String(marketVoiceMarkdown ?? "")
      .split("\n")
      .find((line) => /시장신호|핵심|요약|리스크|섹터/i.test(line)) ?? "",
  );

  const keepIf = (line) => {
    if (part === "macro") {
      return /(시장|신호|노출|타임라인|리스크|금리|유가|환율|섹터 RS)/i.test(line);
    }
    if (part === "sector") {
      return /(섹터|테마|리더|강세|후보|ETF|전략실|보고서)/i.test(line);
    }
    return /(후보|ETF|강세|테마|전략실|교집합|번역)/i.test(line);
  };

  const selected = lines.filter(keepIf).slice(0, 8);
  const merged = [
    ...selected,
    ...(marketVoiceLine ? [`MarketVoice: ${marketVoiceLine}`] : []),
  ].join(" | ");

  if (compact(merged)) {
    return hardLimit(compact(merged), limit);
  }

  return hardLimit(compact(lines.slice(0, 6).join(" | ")), limit);
}

function scoreExtractPriority(extract) {
  let score = 0;
  score += (extract?.related_holdings_in_my_portfolio?.length ?? 0) * 12;
  score += (extract?.portfolio_impacts_candidate?.length ?? 0) * 10;
  score += (extract?.related_accounts?.length ?? 0) * 5;

  const reportType = String(extract?.report_type ?? "").toLowerCase();
  if (reportType === "macro" || reportType === "strategy") score += 20;
  else if (reportType === "industry") score += 12;
  else if (reportType === "theme") score += 10;

  const confidence = String(extract?.confidence ?? "").toUpperCase();
  if (confidence === "HIGH") score += 6;
  else if (confidence === "MEDIUM") score += 3;

  const sentiment = Number(extract?.sentiment_score ?? 0);
  if (Number.isFinite(sentiment)) {
    score += Math.round(Math.abs(sentiment) * 10);
  }

  const explicitPriority = Number(extract?.priority_score);
  if (Number.isFinite(explicitPriority)) {
    score = Math.round(explicitPriority);
  }

  return score;
}

function normalizeTopicType(value, fallback = "sector") {
  const token = compact(value).toLowerCase().replace(/[-\s]+/g, "_");
  if (["macro", "sector", "security", "new_candidate"].includes(token)) return token;
  if (["newcandidate", "candidate", "new"].includes(token)) return "new_candidate";
  if (["stock", "equity"].includes(token)) return "security";
  return fallback;
}

function buildDefaultQuestions(label, topicType) {
  if (topicType === "macro") {
    return [
      `${label} 관련 2026년 최신 매크로 지표 업데이트는?`,
      `${label} 가정이 깨지는 반박 시나리오와 임계 신호는?`,
      `ISA/연금/일반 계좌에서 방어-공격 비중을 어떻게 조정해야 하나?`,
    ];
  }
  if (topicType === "new_candidate") {
    return [
      `${label}를 신규 후보로 볼 핵심 근거와 촉매는?`,
      `기존 보유 대비 ${label}의 상대 우위와 대체 관계는?`,
      `${label}의 No-Go 조건과 재진입 체크포인트는?`,
    ];
  }
  return [
    `${label}의 업황/실적/밸류에이션 최신 변화는?`,
    `${label} 관련 핵심 이벤트 일정과 체크포인트는?`,
    `계좌별(ISA/연금/일반) 실행 번역 시 우선순위는?`,
  ];
}

function normalizeQuestions(questions, label, topicType) {
  const result = [];
  const seen = new Set();

  for (const raw of Array.isArray(questions) ? questions : []) {
    const q = truncate(compact(raw), 120);
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    result.push(q);
    if (result.length >= 3) break;
  }

  for (const fallback of buildDefaultQuestions(label, topicType)) {
    if (result.length >= 3) break;
    const key = fallback.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fallback);
  }

  return result.slice(0, 3);
}

function normalizeKeywords(keywords, fallbackValues = []) {
  const result = [];
  const seen = new Set();

  const feed = [...(Array.isArray(keywords) ? keywords : []), ...fallbackValues];
  for (const raw of feed) {
    const keyword = truncate(compact(raw), 24);
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
    if (result.length >= 5) break;
  }

  while (result.length < 5) {
    result.push(`키워드${result.length + 1}`);
  }

  return result.slice(0, 5);
}

function inferTopicTypeFromExtract(extract) {
  const reportType = String(extract?.report_type ?? "").toLowerCase();
  if (reportType === "macro" || reportType === "strategy") return "macro";

  if ((extract?.related_holdings_in_my_portfolio?.length ?? 0) > 0 || (extract?.portfolio_impacts_candidate?.length ?? 0) > 0) {
    return "security";
  }

  if (reportType === "industry" || reportType === "theme") return "sector";
  return "new_candidate";
}

function inferLabelFromExtract(extract) {
  const theme = Array.isArray(extract?.themes) ? extract.themes[0] : "";
  if (compact(theme)) return truncate(theme, 36);

  const sector = compact(extract?.sector);
  if (sector && sector !== "매크로") return truncate(sector, 36);

  return truncate(extract?.title ?? "리서치 토픽", 36);
}

function inferTopicFromExtract(extract) {
  const label = inferLabelFromExtract(extract);
  const type = inferTopicTypeFromExtract(extract);

  const summarySource =
    compact(extract?.key_thesis) ||
    compact(Array.isArray(extract?.key_points) ? extract.key_points[0] : "") ||
    compact(extract?.new_info) ||
    compact(extract?.primary_claim?.summary);

  const fallbackKeywords = [
    ...(Array.isArray(extract?.themes) ? extract.themes : []),
    extract?.sector,
    ...(Array.isArray(extract?.related_holdings_in_my_portfolio)
      ? extract.related_holdings_in_my_portfolio.map((item) => item?.name)
      : []),
    label,
  ].filter(Boolean);

  const accountKeys = (Array.isArray(extract?.related_accounts) ? extract.related_accounts : [])
    .map((item) => compact(item).toUpperCase())
    .filter(Boolean)
    .slice(0, 3);

  return {
    label,
    type,
    summary: truncate(summarySource || `${label} 관련 핵심 변수를 점검하세요.`, 200),
    questions: normalizeQuestions([], label, type),
    keywords: normalizeKeywords([], fallbackKeywords),
    priority: Math.max(1, Math.min(100, scoreExtractPriority(extract))),
    accountKeys,
  };
}

function inferTopicFromEnrichedItem(item) {
  const label = truncate(item?.label_hint || item?.title || item?.sector || "리서치 토픽", 36);
  const type = normalizeTopicType(item?.inferred_type || item?.report_type, "sector");
  const relatedAccounts = item?.portfolio_relevance?.relatedAccounts ?? item?.related_accounts ?? [];
  const relatedHoldings = item?.portfolio_relevance?.relatedHoldings ?? [];

  return {
    label,
    type,
    summary: truncate(
      item?.summary_for_agenda ||
        item?.summary_stage3_selected ||
        item?.summary_local_compact ||
        item?.summary_stage1 ||
        `${label} 관련 핵심 변수를 점검하세요.`,
      200,
    ),
    questions: normalizeQuestions([], label, type),
    keywords: normalizeKeywords([], [
      ...(Array.isArray(item?.themes) ? item.themes : []),
      item?.sector,
      ...relatedHoldings.map((holding) => holding?.name),
      label,
    ]),
    priority: Math.max(1, Math.min(100, Math.round(Number(item?.priority_score ?? 60) || 60))),
    accountKeys: (Array.isArray(relatedAccounts) ? relatedAccounts : [])
      .map((value) => compact(value).toUpperCase())
      .filter(Boolean)
      .slice(0, 3),
  };
}

function normalizeAgendaTopic(topic, knownAccountKeys = []) {
  const label = truncate(topic?.label ?? "리서치 토픽", 36);
  const fallbackType = normalizeTopicType(topic?.type, "sector");
  const type = normalizeTopicType(topic?.type, fallbackType);
  const accountKeys = (Array.isArray(topic?.accountKeys) ? topic.accountKeys : [])
    .map((value) => compact(value).toUpperCase())
    .filter((value) => value && (knownAccountKeys.length === 0 || knownAccountKeys.includes(value)))
    .slice(0, 3);

  return {
    label,
    type,
    summary: truncate(topic?.summary ?? `${label} 관련 핵심 포인트를 점검`, 200),
    questions: normalizeQuestions(topic?.questions, label, type),
    keywords: normalizeKeywords(topic?.keywords, [label]),
    priority: Math.max(1, Math.min(100, Math.round(Number(topic?.priority ?? 60) || 60))),
    accountKeys,
  };
}

function dedupeTopics(topics, maxCount = 24) {
  const result = [];
  const seen = new Set();

  for (const topic of topics.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
    const key = `${topic.type}|${String(topic.label).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(topic);
    if (result.length >= maxCount) break;
  }

  return result;
}

function buildTopics(stage1, agenda, enrichedIndex, knownAccountKeys) {
  if (Array.isArray(agenda?.topics) && agenda.topics.length > 0) {
    const normalized = agenda.topics
      .filter((topic) => topic && typeof topic === "object")
      .map((topic) => normalizeAgendaTopic(topic, knownAccountKeys));
    return {
      source: "agenda",
      topics: dedupeTopics(normalized, 30),
    };
  }

  if (Array.isArray(enrichedIndex?.items) && enrichedIndex.items.length > 0) {
    const inferred = enrichedIndex.items
      .sort((a, b) => Number(b?.priority_score ?? 0) - Number(a?.priority_score ?? 0))
      .slice(0, 40)
      .map((item) => inferTopicFromEnrichedItem(item));

    return {
      source: "enriched_report_index",
      topics: dedupeTopics(inferred, 24),
    };
  }

  const extracts = Array.isArray(stage1?.extracts) ? stage1.extracts : [];
  const inferred = extracts
    .sort((a, b) => scoreExtractPriority(b) - scoreExtractPriority(a))
    .slice(0, 40)
    .map((extract) => inferTopicFromExtract(extract));

  return {
    source: "extract_inference",
    topics: dedupeTopics(inferred, 24),
  };
}

function selectTopicsForPart(allTopics, part) {
  const config = PART_CONFIG[part];
  const primary = allTopics.filter((topic) => config.topicTypes.has(topic.type));

  if (primary.length > 0) {
    return primary.sort((a, b) => b.priority - a.priority);
  }

  return [...allTopics].sort((a, b) => b.priority - a.priority);
}

function renderTopicSection(topic) {
  const questionLines = normalizeQuestions(topic.questions, topic.label, topic.type)
    .map((question, index) => `질문${index + 1}: ${question}`)
    .join("\n");

  const keywordText = normalizeKeywords(topic.keywords, [topic.label]).join(", ");
  const accountText =
    Array.isArray(topic.accountKeys) && topic.accountKeys.length > 0
      ? topic.accountKeys.join(", ")
      : "ISA, PENSION, KIS_MAIN";

  return [
    `### ${topic.label}`,
    `배경: ${truncate(topic.summary, 220)}`,
    questionLines,
    `핵심 키워드: ${keywordText}`,
    `연관 계좌: ${accountText}`,
  ].join("\n");
}

function renderPrompt({ date, part, portfolioContext, holdingsContext, riskContext, stockeasyContext, topics }) {
  const config = PART_CONFIG[part];
  const topicBlocks = topics.map((topic) => renderTopicSection(topic));

  const lines = [
    "[역할] 너는 EcoReport의 딥리서치 파트너다.",
    `[날짜] ${date}`,
    `[목적] ${config.goal}`,
    `[포트폴리오 컨텍스트] ${portfolioContext}`,
    `[현재 보유 핵심] ${holdingsContext}`,
    `[개인화 리스크 포인트] ${riskContext}`,
    `[StockEasy 시그널] ${stockeasyContext}`,
    "",
    "## 조사 요청 토픽",
    ...(topicBlocks.length > 0 ? topicBlocks : ["### 토픽 준비 중", "배경: 유효 토픽이 없어 기본 점검 질문으로 대체합니다.", "질문1: 오늘 시장 레짐 핵심 변수는?", "질문2: 계좌별 대응 우선순위는?", "질문3: No-Go 조건은?", "핵심 키워드: 레짐, 리스크, 계좌", "연관 계좌: ISA, PENSION, KIS_MAIN"]),
    "",
    "[출력 형식]",
    "- 각 토픽마다 반드시 4개 섹션으로 작성: 현황 / 계좌 번역 / No-Go 조건 / 체크포인트",
    "- 계좌 번역에는 ISA, PENSION, KIS_MAIN 각각의 실행 관점을 분리해 작성",
    "- 반드시 현재 보유 종목/ETF와의 중복, 대체, 추가매수 위험을 함께 평가",
    "- No-Go 조건은 정량 신호 또는 이벤트 조건을 명확히 적고, 체크포인트는 모니터링 빈도까지 포함",
  ];

  return lines.join("\n");
}

function buildPromptWithBudget({ date, part, portfolioContext, holdingsContext, riskContext, stockeasyContext, topics }) {
  const config = PART_CONFIG[part];
  const sortedTopics = [...topics].sort((a, b) => b.priority - a.priority);
  const maxCount = Math.min(config.maxTopics, sortedTopics.length || 1);

  for (let count = maxCount; count >= 1; count -= 1) {
    const prompt = renderPrompt({
      date,
      part,
      portfolioContext,
      holdingsContext,
      riskContext,
      stockeasyContext,
      topics: sortedTopics.slice(0, count),
    });
    if (prompt.length <= config.maxChars) {
      return {
        prompt,
        usedTopicCount: count,
        maxChars: config.maxChars,
      };
    }
  }

  const shrunkPrompt = renderPrompt({
    date,
    part,
    portfolioContext: hardLimit(portfolioContext, 320),
    holdingsContext: hardLimit(holdingsContext, 320),
    riskContext: hardLimit(riskContext, 320),
    stockeasyContext: hardLimit(stockeasyContext, 320),
    topics: sortedTopics.slice(0, 1).map((topic) => ({
      ...topic,
      summary: hardLimit(topic.summary, 120),
      questions: normalizeQuestions(topic.questions, topic.label, topic.type).map((q) => hardLimit(q, 80)),
      keywords: normalizeKeywords(topic.keywords, [topic.label]).slice(0, 5),
    })),
  });

  return {
    prompt: hardLimit(shrunkPrompt, config.maxChars),
    usedTopicCount: 1,
    maxChars: config.maxChars,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await loadAnalysisContext(args, {
    stage1: true,
    portfolio: true,
    marketVoice: true,
    watchlist: true,
  });

  const { paths, data } = context;
  const stage1Path = paths.stage1;
  const stage1 = data.stage1;

  if (!fs.existsSync(stage1Path)) {
    const latest = findLatestAvailableStage1Date();
    const hint = latest
      ? ` 가장 최근 Stage 1 데이터는 ${latest} 입니다.`
      : " 아직 생성된 Stage 1 데이터가 없습니다.";
    throw new Error(`Stage 1 파일을 찾을 수 없습니다: ${stage1Path}.${hint}`);
  }

  if (!stage1 || !Array.isArray(stage1.extracts)) {
    throw new Error(`Stage 1 JSON 파싱에 실패했습니다: ${stage1Path}`);
  }

  const portfolio = data.portfolio ?? { accounts: [] };
  const knownAccountKeys = (portfolio.accounts ?? [])
    .map((account) => compact(account?.key).toUpperCase())
    .filter(Boolean);

  const agendaPath = path.join(paths.analysisDir, "stage1-research-agenda.json");
  const agenda = await readJson(agendaPath, null);
  const enrichedIndexPath = path.join(paths.analysisDir, "stage2-enriched-report-index.json");
  const enrichedIndex = await readJson(enrichedIndexPath, null);

  const topicBundle = buildTopics(stage1, agenda, enrichedIndex, knownAccountKeys);
  if (!topicBundle.topics.length) {
    throw new Error("프롬프트 생성에 사용할 토픽이 없습니다. stage1 extracts 또는 agenda를 확인하세요.");
  }

  const marketVoiceMarkdown = formatMarketVoiceForPrompt(data.marketVoice, {
    maxTopics: 5,
    maxResearch: 2,
  });
  const stockeasyMarkdown = await formatStockeasyForPrompt({
    date: args.date,
    portfolio,
    watchlist: data.watchlist,
    maxSectors: 8,
    maxThemes: 4,
    maxLeaders: 20,
    maxTimeline: 4,
    maxStrategies: 8,
  });

  const portfolioContext = buildPortfolioContext(portfolio, 500);
  const holdingsContext = buildCurrentHoldingsContext(portfolio, 560);
  const manualKitDir = resolveManualKitDir(args.date);

  const generatePart = async (part, explicitOutput = null) => {
    const partTopics = selectTopicsForPart(topicBundle.topics, part);
    const stockeasyContext = selectStockeasyContextByPart(stockeasyMarkdown, marketVoiceMarkdown, part, 500);
    const riskContext = buildPersonalizedRiskContext(portfolio, partTopics, 560);
    const built = buildPromptWithBudget({
      date: args.date,
      part,
      portfolioContext,
      holdingsContext,
      riskContext,
      stockeasyContext,
      topics: partTopics,
    });

    const outputPath = resolvePartOutputPath(args.date, part, explicitOutput);
    await writeText(outputPath, `${built.prompt}\n`);

    return {
      part,
      path: outputPath,
      prompt: built.prompt,
      chars: built.prompt.length,
      usedTopicCount: built.usedTopicCount,
      maxChars: built.maxChars,
    };
  };

  const results = [];

  if (args.part) {
    const single = await generatePart(args.part, args.output);
    results.push(single);

    if (!args.output && args.part === "macro") {
      await writeText(resolveLegacyOutputPath(args.date), `${single.prompt}\n`);
    }

    try {
      copyToClipboard(single.prompt);
    } catch (error) {
      console.warn(`clipboard-warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    for (const part of PART_ORDER) {
      const result = await generatePart(part);
      results.push(result);
    }

    const macroPrompt = results.find((item) => item.part === "macro")?.prompt ?? "";
    await writeText(resolveLegacyOutputPath(args.date), `${macroPrompt}\n`);

    if (args.output) {
      const customOutput = path.isAbsolute(args.output) ? args.output : path.join(ROOT_DIR, args.output);
      await writeText(customOutput, `${macroPrompt}\n`);
    }

    try {
      copyToClipboard(macroPrompt);
    } catch (error) {
      console.warn(`clipboard-warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`topic_source: ${topicBundle.source}`);
  console.log(`agenda_path: ${fs.existsSync(agendaPath) ? agendaPath : "missing"}`);
  for (const result of results) {
    console.log(
      `saved: ${result.path} (part=${result.part}, chars=${result.chars}, topics=${result.usedTopicCount}, limit=${result.maxChars})`,
    );
  }
  console.log(`legacy_saved: ${resolveLegacyOutputPath(args.date)}`);
}

main().catch((error) => {
  console.error(`stage1.5 deep research prompt 생성 실패: ${error.message}`);
  process.exit(1);
});
