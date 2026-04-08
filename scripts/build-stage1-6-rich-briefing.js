#!/usr/bin/env node
// Stage 1.6: Stage 1 리포트 추출물과 Gemini Deep Research 결과를 다시 합쳐
// 대시보드가 바로 읽을 수 있는 rich briefing을 생성합니다.

import path from "node:path";

import dotenv from "dotenv";

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
  return {
    stage1: path.join(stateDir, "stage1-report-extracts-v2.json"),
    portfolio: path.join(ROOT_DIR, "data", "portfolio", "latest.json"),
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
  dotenv.config({ path: path.join(ROOT_DIR, ".env") });
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

function collectTextSnippets(text, limit = 6, lineLimit = 180) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-*#>\d.\s]+/, "").trim())
    .filter((line) => line.length >= 12)
    .map((line) => singleLine(line, lineLimit))
    .filter(Boolean)
    .slice(0, limit);
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
  return score;
}

function pickTopExtracts(extracts, predicate, limit) {
  return extracts
    .filter(predicate)
    .map((item) => ({ ...item, _score: scoreExtract(item) }))
    .sort((left, right) => right._score - left._score)
    .slice(0, limit);
}

function buildStage1Selection(stage1, maxExtracts) {
  const extracts = stage1?.extracts ?? [];
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

function buildStage1Digest(stage1, selection) {
  const { macro, portfolioLinked, catalystHeavy } = selection;

  return [
    `- Stage 1 리포트 수: ${stage1?.reportCount ?? (stage1?.extracts ?? []).length}`,
    `- 실행일: ${stage1?.runDate ?? "N/A"} / 기준 거래일: ${stage1?.effectiveMarketDate ?? stage1?.date ?? "N/A"}`,
    "",
    formatExtractList("매크로/레짐 근거", macro),
    formatExtractList("내 포트폴리오 직접 연결 리포트", portfolioLinked),
    "### 촉매/변수 클러스터",
    formatCatalystGrid(catalystHeavy),
  ].join("\n");
}

function buildPrompt({ args, portfolioSummary, stage1Digest, priorBriefing, deepResearch }) {
  return [
    `당신은 EcoReport의 최종 편집장 겸 포트폴리오 전략가입니다.`,
    `기준 거래일은 ${args.effectiveMarketDate}, 실행일은 ${args.runDate} 입니다.`,
    "",
    "아래 4개 재료를 충돌 없이 통합해, 대시보드가 바로 읽을 수 있는 최종 연구 브리핑 마크다운을 작성하세요.",
    "1. Stage 1 구조화 리포트 추출물: 오늘 수집한 증권사 리포트의 핵심 사실 앵커",
    "2. 기존 어드바이저 브리핑: 현재 시스템이 만든 액션 초안",
    "3. 내 포트폴리오 상태: 계좌/현금/보유 종목",
    "4. Gemini Deep Research 결과: 반박 시나리오, 대안 자산, 촉매, 과거 유사 국면 비교",
    "",
    "[편집 원칙]",
    "- Stage 1 추출물을 사실 기반의 1차 근거로 사용하세요.",
    "- Deep Research는 시나리오의 깊이, 반박 시나리오, 대안 자산, 촉매 일정, 과거 유사 국면 해석을 보강하는 용도로 사용하세요.",
    "- 근거가 약한 숫자/정확 날짜/ETF 종목명은 새로 지어내지 마세요. 모호하면 '4월 말', '2분기 중', '몇 주 내'처럼 보수적으로 표현하세요.",
    "- 한국 투자자가 바로 실행할 수 있는 언어로 정리하세요. 필요하면 해외 자산 아이디어를 한국 상장 ETF/국내 계좌 실행 관점으로 번역하세요.",
    "- 문장은 짧게 쓰고, 섹션마다 실제 대응이 달라지도록 구체적으로 쓰세요.",
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
    "",
    "## Action (오늘 실행)",
    "- ISA: 오늘 실행 1~2개",
    "- PENSION: 오늘 실행 1~2개",
    "- TOSS: 오늘 실행 1~2개",
    "- KIS_MAIN: 오늘 실행 1~2개",
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
    "## 기존 어드바이저 브리핑 초안",
    priorBriefing || "- 기존 브리핑 없음",
    "",
    "## Stage 1 구조화 리포트 추출물 요약",
    stage1Digest,
    "",
    "## Gemini Deep Research 결과",
    deepResearch,
  ].join("\n");
}

function buildFallbackBriefing({ args, portfolio, priorBriefing, deepResearch, selection }) {
  const macroLines = selection.macro
    .map((item) => singleLine(item.key_thesis || item.key_points?.[0] || item.title, 180))
    .filter(Boolean);
  const portfolioLines = selection.portfolioLinked
    .map((item) => singleLine(item.key_thesis || item.portfolio_impacts_candidate?.[0]?.summary || item.title, 180))
    .filter(Boolean);
  const catalystLines = selection.catalystHeavy
    .flatMap((item) => [...(item.catalysts ?? []), ...(item.what_changed ?? [])])
    .map((item) => singleLine(item, 160))
    .filter(Boolean)
    .slice(0, 6);
  const researchLines = collectTextSnippets(deepResearch, 6, 180);
  const advisorLines = collectTextSnippets(priorBriefing, 4, 180);
  const accountByKey = new Map((portfolio?.accounts ?? []).map((account) => [account.key, account]));
  const actionLineFor = (key, fallbackLabel) => {
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
    researchLines[0] ??
    macroLines[0] ??
    "리포트 상 확인된 우위 테마를 중심으로 선별 대응이 유효한 구간입니다.";
  const riskScenario =
    researchLines[1] ??
    macroLines[1] ??
    "외부 변수 변동성이 재확대되면 방어 비중과 현금 운용이 다시 중요해질 수 있습니다.";
  const strategyLines = [
    advisorLines[0] ?? portfolioLines[0] ?? "기존 우위 포지션은 유지하되 신규 대응은 분할 접근을 우선합니다.",
    advisorLines[1] ?? "계좌별 현금 여력과 실행 우선순위를 먼저 맞춘 뒤 액션을 좁힙니다.",
  ].filter(Boolean);
  const implicationLines = portfolioLines.length
    ? portfolioLines.slice(0, 3)
    : ["포트폴리오 연결 근거는 Stage 1 상위 추출과 Deep Research 메모를 기준으로 재확인합니다."];
  const checkpointLines = [...catalystLines, ...researchLines.slice(2, 4), ...macroLines.slice(1, 3)].slice(
    0,
    6,
  );

  return [
    "> Gemini API 과부하로 LLM 합성이 지연되어 Stage 1, 기존 브리핑, Deep Research 메모를 바탕으로 로컬 fallback 브리핑을 생성했습니다.",
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
    ...macroLines.slice(0, 3).map((line) => `- ${line}`),
    ...(macroLines.length === 0 ? ["- 상위 리포트 기준 시장 레짐과 매크로 변수 재확인 필요"] : []),
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
  const apiKey = loadApiKey();

  const [stage1, portfolio, priorBriefing, deepResearch] = await Promise.all([
    readJson(paths.stage1, null),
    readJson(paths.portfolio, { accounts: [] }),
    readText(paths.priorBriefing, ""),
    readText(paths.deepResearch, ""),
  ]);

  if (!stage1) {
    throw new Error(`Stage 1 추출 파일이 없습니다: ${paths.stage1}`);
  }
  if (!deepResearch.trim()) {
    throw new Error(`Deep Research 결과 파일이 없습니다: ${paths.deepResearch}`);
  }

  const portfolioSummary = summarizePortfolio(portfolio);
  const stage1Selection = buildStage1Selection(stage1, args.maxExtracts);
  const stage1Digest = buildStage1Digest(stage1, stage1Selection);
  const prompt = buildPrompt({
    args,
    portfolioSummary,
    stage1Digest,
    priorBriefing: compact(priorBriefing),
    deepResearch: compact(deepResearch),
  });

  const runMeta = buildRunMetadata(args);
  const modelCandidates = args.model ? [args.model] : DEFAULT_PRIORITY_MODELS;

  let text;
  let source = "gemini";
  let usedModel = args.model ?? DEFAULT_MODEL;

  try {
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
    workflow: "stage1 + manual deep research -> rich briefing",
    stage1_report_count: stage1.reportCount ?? (stage1.extracts ?? []).length,
    selected_extract_budget: args.maxExtracts,
    selected_extract_count: stage1Selection.selectedExtractCount,
    selected_chunk_count: stage1Selection.selectedExtractCount,
    used_chunk_count: stage1Selection.selectedExtractCount,
    selected_report_count: stage1Selection.selectedReportCount,
    covered_report_count: stage1Selection.selectedReportCount,
    briefing_candidate_count: stage1.reportCount ?? (stage1.extracts ?? []).length,
    merged_text_char_length: prompt.length,
    source_paths: {
      stage1: paths.stage1,
      portfolio: paths.portfolio,
      prior_briefing: paths.priorBriefing,
      deep_research: paths.deepResearch,
      archive_output: paths.archive,
    },
    prompt_char_length: prompt.length,
    deep_research_char_length: deepResearch.length,
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
