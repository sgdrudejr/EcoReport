#!/usr/bin/env node
// Stage 1.6: Stage 1 리포트 추출물과 Gemini Deep Research 결과를 다시 합쳐
// 대시보드가 바로 읽을 수 있는 rich briefing을 생성합니다.

import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  readText,
  truncate,
  won,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { loadProjectEnv } from "./lib/env-loader.js";
import { allRefinementArtifactPaths } from "./lib/refinement-rounds.js";

const DEFAULT_PRIORITY_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const DEFAULT_MODEL = DEFAULT_PRIORITY_MODELS[0];
const DEFAULT_ARCHIVE_NAME = "10-stage1-6-final-research-briefing.md";
const DEFAULT_MAX_RETRIES = 5;

function parseArgs(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    model: null,
    deepResearch: null,
    output: base.output ?? null,
    archive: null,
    maxExtracts: 18,
    maxRetries: DEFAULT_MAX_RETRIES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--model" && argv[index + 1]) {
      args.model = argv[index + 1];
      index += 1;
    } else if (token === "--deep-research" && argv[index + 1]) {
      args.deepResearch = argv[index + 1];
      index += 1;
    } else if (token === "--archive" && argv[index + 1]) {
      args.archive = argv[index + 1];
      index += 1;
    } else if (token === "--max-extracts" && argv[index + 1]) {
      args.maxExtracts = Number.parseInt(argv[index + 1], 10) || args.maxExtracts;
      index += 1;
    } else if (token === "--max-retries" && argv[index + 1]) {
      args.maxRetries = Number.parseInt(argv[index + 1], 10) || args.maxRetries;
      index += 1;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(message) {
  const retryInMatch = String(message ?? "").match(/Please retry in\s+([0-9.]+)s/i);
  if (retryInMatch) {
    const seconds = Number.parseFloat(retryInMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000) + 1000;
    }
  }

  const secondsMatch = String(message ?? "").match(/retry_delay\s*\{\s*seconds:\s*(\d+)/i);
  if (secondsMatch) {
    const seconds = Number.parseInt(secondsMatch[1], 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000 + 1000;
    }
  }

  return null;
}

function isRetryableQuotaError(message) {
  return /(quota exceeded|resourceexhausted|retry in\s+[0-9.]+s|503|unavailable|high demand|temporarily unavailable|deadline exceeded|timed out)/i.test(
    String(message ?? ""),
  );
}

function isUnsupportedModelError(message) {
  return /(is not found|not supported for generateContent)/i.test(String(message ?? ""));
}

function resolveAbsolute(target) {
  if (!target) return null;
  return path.isAbsolute(target) ? target : path.join(ROOT_DIR, target);
}

function resolvePaths(args) {
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const refinementArtifacts = allRefinementArtifactPaths({ date: args.date });
  return {
    stage1: path.join(stateDir, "stage1-report-extracts-v2.json"),
    portfolio: path.join(ROOT_DIR, "data", "portfolio", "latest.json"),
    technical: path.join(ROOT_DIR, "data", "technical", `${args.date}.json`),
    priorBriefing: path.join(ROOT_DIR, "reports", "daily", `${args.date}-briefing.md`),
    deepResearch:
      resolveAbsolute(args.deepResearch) ??
      path.join(
        ROOT_DIR,
        "knowledge",
        "daily",
        "manual-kit",
        args.date,
        "09-stage1-5-gemini-deep-research-response.md",
      ),
    refinementArtifacts,
    output:
      resolveAbsolute(args.output) ??
      path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-gemini-briefing-rich.md`),
    archive:
      resolveAbsolute(args.archive) ??
      path.join(
        ROOT_DIR,
        "knowledge",
        "daily",
        "manual-kit",
        args.date,
        DEFAULT_ARCHIVE_NAME,
      ),
  };
}

function loadApiKey() {
  loadProjectEnv(ROOT_DIR);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  }
  return apiKey;
}

function compact(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function singleLine(value, limit = 220) {
  return truncate(compact(value).replace(/\n+/g, " "), limit);
}

function sentenceLines(value, indent = "") {
  const normalized = compact(value);
  if (!normalized) return "";

  const sentences = normalized
    .split(/(?<=[.!?。]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return normalized;
  }

  return sentences.map((sentence, index) => (index === 0 ? sentence : `${indent}${sentence}`)).join("\n");
}

function collectTextSnippets(text, limit = 6, lineLimit = 180) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-*#>\d.\s]+/, "").trim())
    .filter((line) => line.length >= 12)
    .map((line) => singleLine(line, lineLimit))
    .filter(Boolean)
    .slice(0, limit);
}

const LOW_SIGNAL_FALLBACK_PATTERNS = [
  /^report_\d+\s*\|/i,
  /관련 계좌:/,
  /관련 보유 종목:/,
  /(?:^| )메타:/,
  /^(run_date|effective_market_date|run_id|generated_at)\s*:/i,
  /^EcoReport 어드바이저 브리핑/i,
  /^TABLE OF CONTENTS$/i,
  /^Compliance Notice$/i,
  /(?:Korea|US) Sector Index Close D-\d/i,
  /기관순매수|외국인순매수/,
  /투자의견|목표주가|현재주가/,
];

function looksLikeDenseMarketTable(line) {
  const normalized = String(line ?? "").trim();
  const numberHits =
    normalized.match(
      /(?:\bD-\d+\b|\b\d+(?:,\d{3})+(?:\.\d+)?\b|[+-]?\d+\.\d+%?|\b\d+%\b)/g,
    )?.length ?? 0;
  const latinHits = normalized.match(/[A-Za-z]{2,}/g)?.length ?? 0;
  const koreanHits = normalized.match(/[가-힣]/g)?.length ?? 0;

  return (
    (numberHits >= 6 && koreanHits < 40) ||
    (latinHits >= 14 && koreanHits < 35) ||
    /^u\s+[A-Z]/.test(normalized)
  );
}

function isLowSignalFallbackLine(value) {
  const line = compact(value).replace(/^[-*#>\d.\s]+/, "").trim();
  if (!line || line.length < 14) return true;
  if (LOW_SIGNAL_FALLBACK_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }
  return looksLikeDenseMarketTable(line);
}

function normalizeFallbackLine(value, limit = 180) {
  let line = compact(value).replace(/^[-*#>\d.\s]+/, "").trim();
  line = line.replace(
    /^(핵심 코멘트|매크로 요약|액션 연결|핵심 내용|유의할 점|체크포인트|전개|대응)\s*:\s*/i,
    "",
  );
  line = singleLine(line, limit);
  return isLowSignalFallbackLine(line) ? "" : line;
}

function uniqueNonEmpty(items) {
  return items.filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
}

function collectMeaningfulTextSnippets(text, limit = 6, lineLimit = 180) {
  return uniqueNonEmpty(
    String(text ?? "")
      .split("\n")
      .map((line) => normalizeFallbackLine(line, lineLimit))
      .filter(Boolean),
  ).slice(0, limit);
}

function normalizeAccountKey(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (normalized === "ISA") return "ISA";
  if (normalized.includes("연금") || normalized === "PENSION") return "PENSION";
  if (normalized.includes("토스") || normalized === "TOSS") return "TOSS";
  if (normalized.includes("한투") || normalized.includes("KIS")) return "KIS_MAIN";
  return normalized || null;
}

function extractPriorBriefingSignals(priorBriefing) {
  const summaryLines = [];
  const strategyLines = [];
  const actionMap = new Map();
  let currentSection = null;

  for (const rawLine of String(priorBriefing ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^##\s+오늘의 우선 액션/.test(line)) {
      currentSection = "actions";
      continue;
    }
    if (/^##\s+계좌별 코멘트/.test(line)) {
      currentSection = "accounts";
      continue;
    }
    if (/^##\s+/.test(line)) {
      currentSection = null;
      continue;
    }

    const coreMatch = line.match(/^- 핵심 코멘트:\s*(.+)$/);
    if (coreMatch) {
      const cleaned = normalizeFallbackLine(coreMatch[1], 190);
      if (cleaned) summaryLines.push(cleaned);
      continue;
    }

    const macroMatch = line.match(/^- 매크로 요약:\s*(.+)$/);
    if (macroMatch) {
      const cleaned = normalizeFallbackLine(macroMatch[1], 190);
      if (cleaned) summaryLines.push(cleaned);
      continue;
    }

    const strategyMatch = line.match(/^- 액션 연결:\s*(.+)$/);
    if (strategyMatch) {
      const cleaned = normalizeFallbackLine(strategyMatch[1], 190);
      if (cleaned) strategyLines.push(cleaned);
      continue;
    }

    if (currentSection === "actions") {
      const actionMatch = line.match(/^- ([^:]+):\s*(.+)$/);
      if (!actionMatch) continue;
      const accountKey = normalizeAccountKey(actionMatch[1]);
      const cleaned = normalizeFallbackLine(actionMatch[2], 190);
      if (accountKey && cleaned) {
        actionMap.set(accountKey, cleaned);
      }
    }
  }

  return {
    summaryLines: uniqueNonEmpty(summaryLines),
    strategyLines: uniqueNonEmpty(strategyLines),
    actionMap,
  };
}

function firstReadableExtractLine(item, limit = 180) {
  return (
    [
      item?.key_thesis,
      ...(item?.key_points ?? []),
      ...(item?.what_changed ?? []),
      item?.title,
    ]
      .map((value) => normalizeFallbackLine(value, limit))
      .find(Boolean) ?? ""
  );
}

function containsAnyKeyword(text, keywords) {
  return keywords.some((keyword) => String(text ?? "").includes(keyword));
}

function deriveFallbackRiskScenario(summaryLines) {
  const corpus = summaryLines.join(" ");

  if (containsAnyKeyword(corpus, ["중동", "휴전", "이란", "호르무즈", "유가"])) {
    return "휴전 기대가 꺾이거나 유가가 다시 급등하면 방어 자산과 현금 비중 재정비가 다시 중요해질 수 있습니다.";
  }
  if (containsAnyKeyword(corpus, ["환율", "달러", "금리"])) {
    return "환율과 금리 부담이 다시 커지면 성장 자산 추격보다 현금과 방어 자산 관리가 우선이 될 수 있습니다.";
  }

  return "외부 변수 변동성이 재확대되면 방어 비중과 현금 운용이 다시 중요해질 수 있습니다.";
}

function deriveFallbackTimelineLines(priorSignals) {
  const corpus = priorSignals.summaryLines.join(" ");
  const lines = [];

  if (containsAnyKeyword(corpus, ["중동", "휴전", "이란", "호르무즈"])) {
    lines.push("중동 휴전 협상 지속 여부 / 지정학 리스크 재확대 시 방어 자산 비중 재점검");
  }
  if (containsAnyKeyword(corpus, ["유가", "원유", "WTI"])) {
    lines.push("WTI 재상승 여부 / 100달러 안팎 재돌파 시 금·방어 자산 대응 강도 점검");
  }

  const isaAction = priorSignals.actionMap.get("ISA");
  if (isaAction && containsAnyKeyword(isaAction, ["금", "골드"])) {
    lines.push("ISA 금 보강 집행 / 추가 분할 매수 전 현금 여력과 유가 흐름 확인");
  }

  const pensionAction = priorSignals.actionMap.get("PENSION");
  if (pensionAction && containsAnyKeyword(pensionAction, ["S&P500", "미국S&P500"])) {
    lines.push("연금저축 S&P500 분할 매수 진행 / 급등 추격보다 눌림 분할 여부 확인");
  }

  const kisAction = priorSignals.actionMap.get("KIS_MAIN");
  if (kisAction && containsAnyKeyword(kisAction, ["원자력", "방산", "구리"])) {
    lines.push("한투 일반 테마 비중 점검 / 원자력·방산·원자재 노출 중복 여부 재확인");
  }

  if (lines.length === 0) {
    lines.push("이번 주 실행 후보 집행 후 계좌별 현금 여력과 변동성 재확인");
  }

  return uniqueNonEmpty(lines).slice(0, 6);
}

function deriveFallbackMacroViewLines(priorSignals, macroLines) {
  const corpus = priorSignals.summaryLines.join(" ");
  const lines = [];

  lines.push(...priorSignals.summaryLines.slice(1, 3));

  if (containsAnyKeyword(corpus, ["중동", "휴전", "이란", "호르무즈", "유가"])) {
    lines.push("휴전과 유가 안정이 이어지면 위험자산 반등이 연장될 수 있지만, 뉴스가 흔들리면 변동성은 빠르게 되살아날 수 있습니다.");
  }
  if (containsAnyKeyword(corpus, ["환율", "달러", "금리"])) {
    lines.push("환율과 금리 부담이 완전히 해소되기 전까지는 지수 전체 추격보다 계좌 역할별 분할 대응이 더 적절합니다.");
  }

  lines.push(...macroLines);
  return uniqueNonEmpty(lines).slice(0, 3);
}

function deriveFallbackImplicationLines(priorSignals, portfolioLines) {
  const lines = [
    priorSignals.summaryLines[0]
      ? `${priorSignals.summaryLines[0]} 따라서 신규 매수는 한 번에 몰지 말고 계좌 역할에 맞춰 나눠서 집행하는 편이 좋습니다.`
      : "",
    priorSignals.actionMap.get("ISA")
      ? `ISA는 ${priorSignals.actionMap.get("ISA").replace(/\s*\/\s*\d+점.*$/, "")} 중심으로 방어와 인컴 균형을 맞추는 축으로 보는 편이 좋습니다.`
      : "",
    priorSignals.actionMap.get("PENSION")
      ? `연금저축은 ${priorSignals.actionMap.get("PENSION").replace(/\s*\/\s*\d+점.*$/, "")} 중심으로 장기 코어 자산을 천천히 누적하는 흐름이 더 자연스럽습니다.`
      : "",
  ];

  return uniqueNonEmpty([...lines, ...portfolioLines]).slice(0, 3);
}

function confidenceScore(value) {
  switch (String(value ?? "").toUpperCase()) {
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
      return 1;
    default:
      return 0;
  }
}

function scoreExtract(item) {
  let score = confidenceScore(item.confidence);
  if (item.report_type === "macro") score += 3;
  if ((item.related_holdings_in_my_portfolio ?? []).length > 0) score += 4;
  if ((item.portfolio_impacts_candidate ?? []).length > 0) score += 3;
  if ((item.catalysts ?? []).length > 0) score += 2;
  if ((item.risks ?? []).length > 0) score += 1;
  if ((item.what_changed ?? []).length > 0) score += 1;
  if (item.report_type === "stock" && (item.related_holdings_in_my_portfolio ?? []).length === 0) {
    score -= 3;
  }
  return score;
}

function pickTopExtracts(extracts, predicate, limit) {
  return extracts
    .filter(predicate)
    .map((item) => ({ ...item, _score: scoreExtract(item) }))
    .sort((left, right) => right._score - left._score)
    .slice(0, limit);
}

function claimDirection(item) {
  const explicit = String(item?.primary_claim?.direction ?? "").toLowerCase();
  if (["positive", "negative", "neutral", "mixed"].includes(explicit)) {
    return explicit;
  }

  const sentiment = Number(item?.sentiment_score ?? 0);
  if (sentiment >= 0.2) return "positive";
  if (sentiment <= -0.2) return "negative";
  return "neutral";
}

function tallyCount(map, key, seed = {}) {
  if (!key) return;
  const current = map.get(key) ?? { key, count: 0, ...seed };
  current.count += 1;
  map.set(key, current);
}

function summarizeCoverageReportLine(item, limit = 130) {
  const summary =
    item?.primary_claim?.summary ??
    firstReadableExtractLine(item, limit) ??
    singleLine(item?.title, limit);
  const tags = uniqueNonEmpty([
    item?.broker,
    item?.report_type,
    item?.sector && item.sector !== item.report_type ? item.sector : null,
    ...(item?.themes ?? []).slice(0, 2),
  ]);

  return `- [${item?.id ?? "report"}] ${tags.join(" / ")} / ${singleLine(summary, limit)}`;
}

function buildStage1CoverageSummary(stage1) {
  const extracts = stage1?.extracts ?? [];
  const reportTypeMap = new Map();
  const themeMap = new Map();
  const accountMap = new Map();
  const holdingMap = new Map();

  for (const item of extracts) {
    tallyCount(reportTypeMap, item?.report_type ?? item?.category ?? "unknown");

    const direction = claimDirection(item);
    for (const theme of uniqueNonEmpty(item?.themes ?? [])) {
      const current = themeMap.get(theme) ?? {
        key: theme,
        count: 0,
        positive: 0,
        negative: 0,
        neutral: 0,
        mixed: 0,
      };
      current.count += 1;
      current[direction] = (current[direction] ?? 0) + 1;
      themeMap.set(theme, current);
    }

    for (const holding of item?.related_holdings_in_my_portfolio ?? []) {
      tallyCount(accountMap, holding?.accountLabel ?? holding?.accountKey ?? null);
      tallyCount(holdingMap, holding?.name ?? holding?.code ?? null);
    }
  }

  const reportTypeLine = [...reportTypeMap.values()]
    .sort((left, right) => right.count - left.count)
    .map((entry) => `${entry.key} ${entry.count}건`)
    .join(" / ");

  const themeLines = [...themeMap.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 8)
    .map(
      (entry) =>
        `- ${entry.key}: ${entry.count}건 · 긍정 ${entry.positive} · 중립 ${entry.neutral} · 부정 ${entry.negative}`,
    );

  const accountLine = [...accountMap.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 4)
    .map((entry) => `${entry.key} ${entry.count}건`)
    .join(" / ");

  const holdingLine = [...holdingMap.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
    .map((entry) => `${entry.key} ${entry.count}건`)
    .join(" / ");

  const reportLines = extracts.map((item) => summarizeCoverageReportLine(item));

  return {
    reportCount: stage1?.reportCount ?? extracts.length,
    coverageSummaryCount: reportLines.length,
    themeSummaryCount: themeLines.length,
    reportTypeLine,
    accountLine,
    holdingLine,
    themeLines,
    reportLines,
  };
}

function formatCoverageSummary(coverage) {
  return [
    "### 전체 리포트 커버 요약",
    `- 전체 반영 리포트 수: ${coverage.reportCount}`,
    coverage.reportTypeLine ? `- 리포트 분포: ${coverage.reportTypeLine}` : "",
    coverage.accountLine ? `- 계좌 직접 연결 상위: ${coverage.accountLine}` : "",
    coverage.holdingLine ? `- 포트폴리오 연결 상위: ${coverage.holdingLine}` : "",
    "",
    "### 반복 테마/컨센서스",
    ...(coverage.themeLines.length > 0 ? coverage.themeLines : ["- 반복 테마 집계 없음"]),
    "",
    "### 리포트별 1줄 압축 요약",
    ...(coverage.reportLines.length > 0 ? coverage.reportLines : ["- 리포트 요약 없음"]),
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildStage1Selection(stage1, maxExtracts) {
  const extracts = stage1?.extracts ?? [];
  const coverage = buildStage1CoverageSummary(stage1);
  const macro = pickTopExtracts(
    extracts,
    (item) => item.report_type === "macro",
    Math.max(4, Math.floor(maxExtracts / 3)),
  );
  const portfolioLinked = pickTopExtracts(
    extracts,
    (item) =>
      (item.related_holdings_in_my_portfolio ?? []).length > 0 ||
      (item.portfolio_impacts_candidate ?? []).length > 0,
    Math.max(6, Math.floor(maxExtracts / 2)),
  );
  const catalystHeavy = pickTopExtracts(
    extracts,
    (item) => (item.catalysts ?? []).length > 0 || (item.what_changed ?? []).length > 0,
    Math.max(4, Math.floor(maxExtracts / 3)),
  );
  const selectedIds = new Set(
    [...macro, ...portfolioLinked, ...catalystHeavy]
      .map((item) => item.id || `${item.title || "untitled"}::${item.broker || "unknown"}`)
      .filter(Boolean),
  );

  return {
    coverage,
    macro,
    portfolioLinked,
    catalystHeavy,
    selectedExtractCount: selectedIds.size,
    selectedReportCount: selectedIds.size,
  };
}

function formatExtractList(label, extracts) {
  if (extracts.length === 0) {
    return [`### ${label}`, "- 관련 추출 없음", ""].join("\n");
  }

  const lines = [`### ${label}`];
  for (const item of extracts) {
    const relatedHoldings = (item.related_holdings_in_my_portfolio ?? []).join(", ");
    const catalysts = (item.catalysts ?? []).map((entry) => singleLine(entry, 120)).slice(0, 2);
    const risks = (item.risks ?? []).map((entry) => singleLine(entry, 100)).slice(0, 2);
    const impact = (item.portfolio_impacts_candidate ?? [])
      .map((entry) => {
        if (typeof entry === "string") return entry;
        return entry?.action || entry?.summary || entry?.name || "";
      })
      .filter(Boolean)
      .map((entry) => singleLine(entry, 100))
      .slice(0, 2);

    lines.push(
      `- [${item.id}] ${item.title} / ${item.broker} / ${item.report_type}`,
      `  - 핵심: ${singleLine(item.key_thesis || item.key_points?.[0] || item.new_info?.[0], 200) || "요약 없음"}`,
      ...(impact.length > 0 ? [`  - 포트폴리오 연결: ${impact.join(" / ")}`] : []),
      ...(relatedHoldings ? [`  - 관련 보유: ${relatedHoldings}`] : []),
      ...(catalysts.length > 0 ? [`  - 촉매: ${catalysts.join(" / ")}`] : []),
      ...(risks.length > 0 ? [`  - 리스크: ${risks.join(" / ")}`] : []),
    );
  }

  lines.push("");
  return lines.join("\n");
}

function formatCatalystGrid(extracts, limit = 10) {
  const rows = extracts
    .flatMap((item) =>
      (item.catalysts ?? []).map((entry) => ({
        id: item.id,
        title: item.title,
        reportType: item.report_type,
        sector: item.sector,
        catalyst: singleLine(entry, 140),
      })),
    )
    .filter((item) => item.catalyst)
    .slice(0, limit);

  if (rows.length === 0) {
    return "- 뚜렷한 촉매 추출 없음";
  }

  return rows
    .map(
      (item) =>
        `- [${item.id}] ${item.sector || item.reportType || "시장"} / ${item.catalyst} / 근거 리포트: ${singleLine(item.title, 80)}`,
    )
    .join("\n");
}

function summarizePortfolio(portfolio) {
  const accounts = portfolio?.accounts ?? [];
  const totalEvaluation = accounts.reduce(
    (sum, account) => sum + (Number(account.evaluationAmount) || 0),
    0,
  );
  const totalCash = accounts.reduce(
    (sum, account) => sum + (Number(account.cashAvailable) || 0),
    0,
  );

  const lines = [
    `- 포트폴리오 기준일: ${portfolio?.date ?? "N/A"}`,
    `- 총 평가금액: ${won(totalEvaluation)}`,
    `- 총 가용 현금: ${won(totalCash)}`,
    "",
  ];

  for (const account of accounts) {
    const holdings = (account.holdings ?? [])
      .map((holding) => `${holding.name}${holding.code ? `(${holding.code})` : ""} ${holding.quantity ?? "N/A"}주`)
      .join(", ");
    lines.push(
      `- ${account.label} (${account.key})`,
      `  - 평가금액: ${won(account.evaluationAmount)} / 예수금: ${won(account.cashAvailable)}`,
      `  - 보유: ${holdings || "없음"}`,
    );
  }

  return lines.join("\n");
}

function summarizeTechnicalSnapshot(portfolio, technical) {
  const accounts = portfolio?.accounts ?? [];
  const scores = technical?.scores ?? {};
  const lines = [];

  for (const account of accounts) {
    lines.push(`- ${account.label} (${account.key})`);

    const holdings = account?.holdings ?? [];
    if (holdings.length === 0) {
      lines.push("  - 보유 종목 없음");
      continue;
    }

    for (const holding of holdings) {
      const item = holding?.code ? scores?.[holding.code] : null;
      if (!item) {
        lines.push(`  - ${holding.name}${holding.code ? `(${holding.code})` : ""}: 기술 스냅샷 없음`);
        continue;
      }

      const parts = [
        `기술점수 ${typeof item.score === "number" ? Math.round(item.score) : "N/A"}점`,
        `시그널 ${item.signal ?? "N/A"}`,
      ];
      if (typeof item?.rsi === "number") {
        parts.push(`RSI ${item.rsi.toFixed(1)}`);
      }
      if (typeof item?.macd?.histogram === "number") {
        parts.push(`MACD hist ${item.macd.histogram.toFixed(2)}`);
      }
      if (item?.bollinger?.position) {
        parts.push(`볼린저 ${item.bollinger.position}`);
      }

      lines.push(`  - ${holding.name}${holding.code ? `(${holding.code})` : ""}: ${parts.join(" / ")}`);
    }
  }

  return lines.join("\n");
}

function buildStage1Digest(stage1, selection) {
  const { coverage, macro, portfolioLinked, catalystHeavy } = selection;

  return [
    `- Stage 1 리포트 수: ${stage1?.reportCount ?? (stage1?.extracts ?? []).length}`,
    `- 실행일: ${stage1?.runDate ?? "N/A"} / 기준 거래일: ${stage1?.effectiveMarketDate ?? stage1?.date ?? "N/A"}`,
    "",
    formatCoverageSummary(coverage),
    formatExtractList("강조 extract · 매크로/레짐 근거", macro),
    formatExtractList("강조 extract · 내 포트폴리오 직접 연결 리포트", portfolioLinked),
    "### 강조 extract · 촉매/변수 클러스터",
    formatCatalystGrid(catalystHeavy),
  ].join("\n");
}

function summarizeRefinementMaps(refinementMaps) {
  const lines = [];

  for (const entry of refinementMaps) {
    const topics = (entry?.map?.topics ?? []).slice(0, 4);
    if (topics.length === 0) continue;

    lines.push(`### Round ${entry.round} · ${entry.label}`);
    for (const topic of topics) {
      const evidence = (topic.evidence ?? [])
        .slice(0, 2)
        .map((item) => `${item.title}: ${item.excerpt}`)
        .join(" / ");
      lines.push(`- ${topic.label} [${topic.scope}]`);
      lines.push(`  - why_now: ${topic.reason}`);
      lines.push(`  - keywords: ${(topic.keywords ?? []).slice(0, 6).join(" / ")}`);
      if (evidence) {
        lines.push(`  - evidence: ${evidence}`);
      }
      if ((topic.gaps ?? []).length > 0) {
        lines.push(`  - gaps: ${(topic.gaps ?? []).join(" / ")}`);
      }
    }
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n").trim() : "- refinement map 없음";
}

function summarizeRefinementResponses(refinementResponses) {
  const sections = refinementResponses
    .filter((entry) => entry.text)
    .map(
      (entry) =>
        `## Round ${entry.round} · ${entry.label}\n${truncate(entry.text, entry.round >= 3 ? 3500 : 4500)}`,
    );

  return sections.length > 0 ? sections.join("\n\n") : "";
}

function buildPrompt({
  args,
  portfolioSummary,
  technicalSummary,
  stage1Digest,
  priorBriefing,
  deepResearch,
  refinementMapSummary,
}) {
  return [
    `당신은 EcoReport의 최종 편집장 겸 포트폴리오 전략가입니다.`,
    `기준 거래일은 ${args.effectiveMarketDate}, 실행일은 ${args.runDate} 입니다.`,
    "",
    "아래 다층 연구 재료를 충돌 없이 통합해, 대시보드가 바로 읽을 수 있는 최종 연구 브리핑 마크다운을 작성하세요.",
    "1. Stage 1 전체 커버 요약: 오늘 수집한 전체 증권사 리포트를 1~2문장 단위와 반복 테마 집계로 압축한 기본층",
    "2. 강조 extract: 예외적이거나 포트폴리오 직접 연결이 큰 핵심 근거만 별도 강조한 보강층",
    "3. 기존 어드바이저 브리핑: 현재 시스템이 만든 액션 초안",
    "4. 내 포트폴리오 상태: 계좌/현금/보유 종목",
    "5. 보유 종목 기술 스냅샷: RSI, MACD, 점수, 시그널",
    "6. Gemini Deep Research 1차 결과: 반박 시나리오, 대안 자산, 촉매, 과거 유사 국면 비교",
    "7. 다회 refinement map: 2차/3차 재인덱싱으로 다시 확인해야 할 토픽과 빈틈",
    "8. Gemini Deep Research 2차 결과: 1차 답변 이후 세부 보강과 정밀 체크포인트",
    "9. Gemini Deep Research 3차 결과(있다면): 마지막 실행 디테일, 무효화 조건, 대체재 정리",
    "",
    "[편집 원칙]",
    "- 전체 커버 요약을 오늘 리포트 분포와 반복 신호를 대표하는 기본 사실층으로 사용하세요.",
    "- 강조 extract는 전체를 대표하는 층이 아니라, 예외·직접 연결·강한 촉매를 보강하는 강조층으로 사용하세요.",
    "- 전체 커버 요약과 강조 extract, Deep Research가 충돌하면 컨센서스와 예외를 분리해 명시하세요.",
    "- Deep Research는 시나리오의 깊이, 반박 시나리오, 대안 자산, 촉매 일정, 과거 유사 국면 해석을 보강하는 용도로 사용하세요.",
    "- refinement map은 '무엇이 아직 얕은지'를 알려주는 재인덱싱 레이어입니다. 라운드가 올라갈수록 새 일반론보다 무효화 조건과 실행 디테일 보강에 더 큰 비중을 두세요.",
    "- 기술 스냅샷은 종목별 추세 상태와 진입/보류 해석을 보강하는 데 사용하세요.",
    "- 근거가 약한 숫자/정확 날짜/ETF 종목명은 새로 지어내지 마세요. 모호하면 '4월 말', '2분기 중', '몇 주 내'처럼 보수적으로 표현하세요.",
    "- 한국 투자자가 바로 실행할 수 있는 언어로 정리하세요. 필요하면 해외 자산 아이디어를 한국 상장 ETF/국내 계좌 실행 관점으로 번역하세요.",
    "- 문장은 짧게 쓰고, 섹션마다 실제 대응이 달라지도록 구체적으로 쓰세요.",
    "- 보유 종목 코멘트는 반드시 계좌 성격을 반영하세요. ISA는 절세형 방어·인컴, 연금은 장기 복리, 토스는 전술 알파, 한투 일반은 실전형 테마 계좌입니다.",
    "- 보유 종목별 `핵심 내용`과 `유의할 점`은 각각 최소 2문장 이상 작성하세요. 한 줄 요약으로 끝내지 마세요.",
    "- 보유 종목, 추천 실행, 계좌 메모처럼 한 항목 안에 문장이 2개 이상 들어가면 문장마다 줄바꿈하세요. 같은 항목 안에서만 줄을 나누고 빈 줄은 넣지 마세요.",
    "- 계좌별 투자 방향성은 반드시 '무엇을 왜 늘리고 줄이는지'가 드러나게 3~5문장으로 쓰세요. 제네럴한 문장만 반복하지 마세요.",
    "- 계좌별 투자 방향성에는 반드시 계좌 역할, 늘릴 자산, 줄일 자산, 이미 보유 중인 종목 중 유지/재점검 대상, 판단을 바꿀 체크포인트를 포함하세요.",
    "- 추천 실행 방향에서는 `stage2 근거`, `시스템상`, `모델상` 같은 메타 표현을 쓰지 마세요. 투자자에게 설명하듯 실제 이유만 써 주세요.",
    "- 기술적 타이밍은 언제나 말하지 말고, 골든크로스/20일선 이탈/MACD 상향 돌파/의미 있는 RSI 과열·과매도처럼 실제 판단 시점일 때만 언급하세요.",
    "- 가능하면 헤지 관계와 계좌 내 역할을 드러내세요. 예: 금은 주식 헤지, KOFR는 대기 자금, 방산은 지정학 헤지, 전력기기는 AI 인프라 직결 수혜.",
    "- 보유·관망 사유도 말줄임 없이 끝까지 쓰세요. 유지 이유와 재판단 조건이 둘 다 보여야 합니다.",
    "",
    "[출력 형식]",
    "반드시 아래 순서의 마크다운 섹션을 사용하세요.",
    "",
    "## 오늘 한 줄 진단",
    "- 시장을 한 문장으로 정의",
    "",
    "## 3-6개월 핵심 시나리오 트리",
    "- Main Scenario (확률 xx%)",
    "  - 전개: 향후 3~6개월 기본 경로",
    "  - 대응: 포트폴리오 대응",
    "  - 체크포인트: 확인할 지표/조건",
    "- Risk Scenario (확률 xx%)",
    "  - 전개: 예상이 틀릴 때의 리스크 경로",
    "  - 대응: Plan B 액션",
    "  - 체크포인트: 확인할 지표/조건",
    "",
    "## 6개월 촉매 일정",
    "- [섹터/종목] 예상 시기 / 이벤트 / 왜 중요한지",
    "- 최대 6개",
    "",
    "## Macro View",
    "- 현재 시장 레짐, 왜 그렇게 보는지, 무엇이 반박 근거인지",
    "",
    "## Strategy (이번 주 대응)",
    "- 현금 비중, 계좌별 목표, 이번 주 우선순위",
    "- ISA / PENSION / TOSS / KIS_MAIN 각각 왜 그렇게 운용하는지 1문단씩",
    "",
    "## Action (오늘 실행)",
    "- ISA: 오늘 실행 1~2개와 실제 이유",
    "- PENSION: 오늘 실행 1~2개와 실제 이유",
    "- TOSS: 오늘 실행 1~2개와 실제 이유",
    "- KIS_MAIN: 오늘 실행 1~2개와 실제 이유",
    "",
    "## 계좌별 보유 종목 심층 코멘트",
    "### ISA",
    "- [종목명] ([티커])",
    "  - 핵심 내용: 2~4문장 (문장마다 줄바꿈)",
    "  - 유의할 점: 2~4문장 (문장마다 줄바꿈)",
    "  - 체크포인트: 1~3개",
    "  - 대응: 추가매수 / 보유 / 축소 / 관망 중 하나",
    "### PENSION",
    "- 같은 형식 반복",
    "### TOSS",
    "- 같은 형식 반복",
    "### KIS_MAIN",
    "- 같은 형식 반복",
    "",
    "## 포트폴리오 관점 시사점",
    "- 지금 포트폴리오에서 좋은 점 / 취약점 / 보완 축",
    "",
    "## 체크포인트",
    "- 다음 며칠~몇 주 동안 확인할 지표와 이벤트",
    "",
    "시나리오는 반드시 2개만 제시하고 확률 합은 100이 되게 맞추세요.",
    "결론은 Deep Research의 장문 서술을 그대로 복붙하지 말고, Stage 1 사실 근거와 연결해 EcoReport용 실전 문서로 다시 써 주세요.",
    "",
    "## 내 포트폴리오 상태",
    portfolioSummary,
    "",
    "## 보유 종목 기술 스냅샷",
    technicalSummary || "- 기술 스냅샷 없음",
    "",
    "## 기존 어드바이저 브리핑 초안",
    priorBriefing || "- 기존 브리핑 없음",
    "",
    "## Stage 1 전체 커버 요약 + 강조 extract",
    stage1Digest,
    "",
    "## Multi-Round Refinement Maps",
    refinementMapSummary || "- refinement map 없음",
    "",
    "## Gemini Deep Research 결과",
    deepResearch,
  ].join("\n");
}

function buildFallbackHoldingCommentary(portfolio) {
  const lines = ["## 계좌별 보유 종목 심층 코멘트"];
  const accounts = portfolio?.accounts ?? [];

  if (accounts.length === 0) {
    lines.push("- 포트폴리오 계좌 데이터가 없습니다.");
    return lines.join("\n");
  }

  for (const account of accounts) {
    lines.push(`### ${account.key}`);

    const holdings = account?.holdings ?? [];
    if (holdings.length === 0) {
      lines.push("- 보유 종목 없음");
      lines.push("");
      continue;
    }

    for (const holding of holdings) {
      const profitRate =
        typeof holding?.profitRate === "number" ? `${holding.profitRate.toFixed(2)}%` : null;
      const coreComment = `${account.label} 안에서 ${holding.name}은 현재 보유 중인 핵심 노출입니다. ${
        profitRate ? `현재 수익률은 ${profitRate} 수준이며,` : ""
      } 계좌 성격과 상위 리포트 흐름을 함께 놓고 보유 논리를 점검해야 합니다.`;
      const cautionComment =
        "이번 fallback 브리핑은 저장된 Deep Research 구조화 결과가 충분하지 않아 세부 인과는 보수적으로 해석해야 합니다. 추가 비중 확대는 다음 리포트 업데이트와 기술 신호를 확인한 뒤 판단하는 편이 안전합니다.";
      lines.push(`- ${holding.name}${holding.code ? ` (${holding.code})` : ""}`);
      lines.push(`  - 핵심 내용: ${sentenceLines(coreComment, "    ")}`);
      lines.push(`  - 유의할 점: ${sentenceLines(cautionComment, "    ")}`);
      lines.push(
        "  - 체크포인트: 다음 실적/정책 이벤트, 관련 리포트 업데이트, 계좌 내 현금 여력.",
      );
      lines.push("  - 대응: 보유");
    }

    lines.push("");
  }

  return lines.join("\n");
}

function buildFallbackBriefing({ args, portfolio, priorBriefing, deepResearch, selection }) {
  const priorSignals = extractPriorBriefingSignals(priorBriefing);
  const macroLines = uniqueNonEmpty(
    selection.macro
      .map((item) => firstReadableExtractLine(item, 190))
      .filter(Boolean),
  );
  const portfolioLines = uniqueNonEmpty(
    selection.portfolioLinked
      .map((item) => firstReadableExtractLine(item, 190))
      .filter(Boolean),
  );
  const catalystLines = selection.catalystHeavy
    .flatMap((item) => [...(item.catalysts ?? []), ...(item.what_changed ?? [])])
    .map((item) => normalizeFallbackLine(item, 170))
    .filter(Boolean)
    .slice(0, 6);
  const researchLines = collectMeaningfulTextSnippets(deepResearch, 6, 190);
  const advisorLines = collectMeaningfulTextSnippets(priorBriefing, 6, 190);
  const accountByKey = new Map((portfolio?.accounts ?? []).map((account) => [account.key, account]));
  const actionLineFor = (key, fallbackLabel) => {
    const priorAction = priorSignals.actionMap.get(key);
    if (priorAction) {
      return `- ${key}: ${priorAction}`;
    }

    const account = accountByKey.get(key);
    const label = account?.label ?? fallbackLabel;
    const firstHolding = account?.holdings?.[0];
    if (!account) {
      return `- ${key}: ${fallbackLabel} 계좌 상태와 현금 여력을 먼저 점검하세요.`;
    }
    return `- ${key}: ${
      firstHolding
        ? `${firstHolding.name} 중심으로 비중과 현금 여력을 다시 확인하고 분할 대응하세요.`
        : `${label} 계좌는 현금 비중과 후보군 우선순위를 다시 점검하세요.`
    }`;
  };

  const mainScenario =
    priorSignals.summaryLines[0] ??
    macroLines[0] ??
    researchLines[0] ??
    "리포트 상 확인된 우위 테마를 중심으로 선별 대응이 유효한 구간입니다.";
  const riskScenario =
    deriveFallbackRiskScenario(priorSignals.summaryLines) ??
    priorSignals.summaryLines[1] ??
    macroLines[1] ??
    "외부 변수 변동성이 재확대되면 방어 비중과 현금 운용이 다시 중요해질 수 있습니다.";
  const strategyLines = uniqueNonEmpty([
    priorSignals.strategyLines[0],
    priorSignals.strategyLines[1],
    advisorLines[0],
    portfolioLines[0],
    "기존 우위 포지션은 유지하되 신규 대응은 분할 접근을 우선합니다.",
    "계좌별 현금 여력과 실행 우선순위를 먼저 맞춘 뒤 액션을 좁힙니다.",
  ])
    .filter(Boolean)
    .slice(0, 2);
  const implicationLines = portfolioLines.length
    ? deriveFallbackImplicationLines(priorSignals, portfolioLines)
    : ["포트폴리오 연결 근거는 Stage 1 상위 추출과 Deep Research 메모를 기준으로 재확인합니다."];
  const checkpointLines = deriveFallbackTimelineLines(priorSignals);
  const macroViewLines = deriveFallbackMacroViewLines(priorSignals, macroLines);
  const fallbackReason = deepResearch.trim()
    ? "Deep Research 결과 또는 Gemini 합성이 불안정해"
    : "Deep Research 결과가 아직 저장되지 않아";
  const holdingCommentary = buildFallbackHoldingCommentary(portfolio);

  return [
    `> ${fallbackReason} 같은 날짜 Stage 1/브리핑/포트폴리오 데이터를 바탕으로 로컬 fallback 브리핑을 생성했습니다.`,
    "",
    "## 오늘 한 줄 진단",
    `- ${mainScenario}`,
    "",
    "## 3-6개월 핵심 시나리오 트리",
    "- Main Scenario (확률 60%)",
    `  - 전개: ${mainScenario}`,
    `  - 대응: ${strategyLines[0]}`,
    `  - 체크포인트: ${checkpointLines[0] ?? "상위 리포트의 촉매와 레짐 변화를 재확인"}`,
    "- Risk Scenario (확률 40%)",
    `  - 전개: ${riskScenario}`,
    `  - 대응: ${strategyLines[1] ?? "현금 비중과 방어 포지션을 먼저 점검"}`,
    `  - 체크포인트: ${checkpointLines[1] ?? "변동성 확대 여부와 핵심 이벤트 일정 재확인"}`,
    "",
    "## 6-개월 촉매 일정",
    ...(checkpointLines.length > 0
      ? checkpointLines.map((line) => `- ${line}`)
      : ["- 상위 리포트와 Deep Research 메모에서 확인된 일정 변화 없음"]),
    "",
    "## Macro View",
    ...macroViewLines.map((line) => `- ${line}`),
    ...(macroViewLines.length === 0 ? ["- 상위 리포트 기준 시장 레짐과 매크로 변수 재확인 필요"] : []),
    "",
    "## Strategy (이번 주 대응)",
    ...strategyLines.map((line) => `- ${line}`),
    "",
    "## Action (오늘 실행)",
    actionLineFor("ISA", "ISA"),
    actionLineFor("PENSION", "연금저축"),
    actionLineFor("TOSS", "토스"),
    actionLineFor("KIS_MAIN", "한국투자 일반"),
    "",
    holdingCommentary,
    "",
    "## 포트폴리오 관점 시사점",
    ...implicationLines.map((line) => `- ${line}`),
    "",
    "## 체크포인트",
    ...(checkpointLines.length > 0
      ? checkpointLines.map((line) => `- ${line}`)
      : ["- 주요 촉매와 계좌별 현금 여력을 다시 점검하세요."]),
    "",
    `- run_id: ${args.runId ?? "N/A"}`,
    `- run_date: ${args.runDate}`,
    `- effective_market_date: ${args.effectiveMarketDate}`,
  ].join("\n");
}

function extractGeminiText(payload) {
  const texts = [];

  for (const candidate of payload?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text === "string" && part.text.trim()) {
        texts.push(part.text.trim());
      }
    }
  }

  return texts.join("\n\n").trim();
}

async function callGemini({ apiKey, model, prompt }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          topP: 0.9,
          maxOutputTokens: 8192,
        },
      }),
    },
  );

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini 호출 실패 (${response.status})`;
    throw new Error(message);
  }

  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error("Gemini 응답에서 텍스트를 추출하지 못했습니다.");
  }

  return { text, payload };
}

async function callGeminiWithRetry({ apiKey, modelCandidates, prompt, maxRetries }) {
  let lastError = null;
  let delayMs = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    for (const model of modelCandidates) {
      try {
        const response = await callGemini({ apiKey, model, prompt });
        return { ...response, model };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (isUnsupportedModelError(message)) {
          continue;
        }
        if (!isRetryableQuotaError(message)) {
          throw error;
        }
        delayMs = Math.max(
          delayMs,
          parseRetryDelayMs(message) ?? Math.min(180_000, 45_000 * attempt),
        );
      }
    }

    if (attempt < maxRetries) {
      console.warn(
        `stage1.6 Gemini 외부 오류 감지: ${Math.ceil(delayMs / 1000)}초 후 재시도 (${attempt}/${maxRetries})`,
      );
      await sleep(delayMs);
      delayMs = 0;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("stage1.6 Gemini 호출에 실패했습니다.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(args);

  const [stage1, portfolio, technical, priorBriefing, deepResearch, refinementMapsRaw, refinementResponsesRaw] = await Promise.all([
    readJson(paths.stage1, null),
    readJson(paths.portfolio, { accounts: [] }),
    readJson(paths.technical, null),
    readText(paths.priorBriefing, ""),
    readText(paths.deepResearch, ""),
    Promise.all(paths.refinementArtifacts.map(async (artifact) => ({
      round: artifact.spec.round,
      label: artifact.spec.label,
      map: await readJson(artifact.mapJson, null),
    }))),
    Promise.all(paths.refinementArtifacts.map(async (artifact) => ({
      round: artifact.spec.round,
      label: artifact.spec.label,
      text: compact(await readText(artifact.response, "")),
    }))),
  ]);

  if (!stage1) {
    throw new Error(`Stage 1 추출 파일이 없습니다: ${paths.stage1}`);
  }

  const portfolioSummary = summarizePortfolio(portfolio);
  const technicalSummary = summarizeTechnicalSnapshot(portfolio, technical);
  const stage1Selection = buildStage1Selection(stage1, args.maxExtracts);
  const stage1Digest = buildStage1Digest(stage1, stage1Selection);
  const deepResearchInput = compact(deepResearch);
  const refinementMaps = refinementMapsRaw.filter((entry) => entry.map);
  const refinementResponses = refinementResponsesRaw.filter((entry) => entry.text);
  const refinementMapSummary = summarizeRefinementMaps(refinementMaps);
  const refinementResponseSummary = summarizeRefinementResponses(refinementResponses);
  const combinedDeepResearchInput = [
    deepResearchInput,
    refinementMapSummary ? `## Refinement Maps\n${refinementMapSummary}` : "",
    refinementResponseSummary ? `## Refinement Deep Research\n${refinementResponseSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const promptDeepResearch =
    combinedDeepResearchInput ||
    [
      "Deep Research 결과 파일이 아직 생성되지 않았습니다.",
      "같은 날짜의 Stage 1 추출물, 포트폴리오 스냅샷, 기존 어드바이저 브리핑만으로 보수적인 fallback 연구 브리핑을 작성하세요.",
      "과거 날짜 자료로 보강하지 말고, 오늘 실행 기준 문맥만 유지하세요.",
    ].join("\n");
  const prompt = buildPrompt({
    args,
    portfolioSummary,
    technicalSummary,
    stage1Digest,
    priorBriefing: compact(priorBriefing),
    deepResearch: promptDeepResearch,
    refinementMapSummary,
  });

  const runMeta = buildRunMetadata(args);
  const modelCandidates = args.model ? [args.model] : DEFAULT_PRIORITY_MODELS;

  let text;
  let source = "gemini";
  let usedModel = args.model ?? DEFAULT_MODEL;

  try {
    const apiKey = loadApiKey();
    const response = await callGeminiWithRetry({
      apiKey,
      modelCandidates,
      prompt,
      maxRetries: args.maxRetries,
    });
    text = response.text;
    usedModel = response.model;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`stage1.6 Gemini fallback 활성화: ${message}`);
    text = buildFallbackBriefing({
      args,
      portfolio,
      priorBriefing,
      deepResearch,
      selection: stage1Selection,
    });
    source = "fallback";
    usedModel = "local-fallback";
  }

  const meta = {
    generated_at: runMeta.generatedAt,
    generatedAt: runMeta.generatedAt,
    run_id: runMeta.runId,
    runId: runMeta.runId,
    run_date: runMeta.runDate,
    runDate: runMeta.runDate,
    effective_market_date: runMeta.effectiveMarketDate,
    effectiveMarketDate: runMeta.effectiveMarketDate,
    date: runMeta.date,
    model: usedModel,
    requested_model: args.model ?? DEFAULT_MODEL,
    source,
    deep_research_available: Boolean(deepResearchInput || refinementResponses.length > 0),
    workflow: "stage1 + primary deep research + multi-round refinement -> rich briefing",
    stage1_report_count: stage1.reportCount ?? (stage1.extracts ?? []).length,
    selected_extract_budget: args.maxExtracts,
    coverage_summary_report_count: stage1Selection.coverage.reportCount,
    coverage_summary_entry_count: stage1Selection.coverage.coverageSummaryCount,
    coverage_theme_count: stage1Selection.coverage.themeSummaryCount,
    highlight_extract_count: stage1Selection.selectedExtractCount,
    highlight_report_count: stage1Selection.selectedReportCount,
    selected_extract_count: stage1Selection.selectedExtractCount,
    selected_chunk_count: stage1Selection.selectedExtractCount,
    used_chunk_count: stage1Selection.selectedExtractCount,
    selected_report_count: stage1Selection.selectedReportCount,
    covered_report_count: stage1Selection.coverage.reportCount,
    briefing_candidate_count: stage1.reportCount ?? (stage1.extracts ?? []).length,
    merged_text_char_length: prompt.length,
    source_paths: {
      stage1: paths.stage1,
      portfolio: paths.portfolio,
      technical: paths.technical,
      prior_briefing: paths.priorBriefing,
      deep_research: paths.deepResearch,
      refinement_maps: paths.refinementArtifacts.map((artifact) => artifact.mapJson),
      refinement_responses: paths.refinementArtifacts.map((artifact) => artifact.response),
      archive_output: paths.archive,
    },
    prompt_char_length: prompt.length,
    deep_research_char_length: combinedDeepResearchInput.length,
    prior_briefing_char_length: priorBriefing.length,
  };

  await writeText(paths.output, `${text.trim()}\n`);
  await writeJson(`${paths.output}.meta.json`, meta);

  if (paths.archive !== paths.output) {
    await writeText(paths.archive, `${text.trim()}\n`);
  }

  console.log(paths.output);
}

main().catch((error) => {
  console.error(`stage1.6 rich briefing 생성 실패: ${error.message}`);
  process.exit(1);
});
