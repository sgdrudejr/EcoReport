#!/usr/bin/env node
// 1단계: PDF/텍스트 원문을 연구 노트형 추출물로 변환하고 포트폴리오 관련성을 함께 태깅합니다.

import path from "node:path";

import {
  HOLDING_TOPIC_HINTS,
  MACRO_KEYWORDS_BY_CODE,
  THEMATIC_TRIGGERS_BY_CODE,
  ROOT_DIR,
  buildPortfolioMaps,
  clamp,
  containsKeyword,
  extractNumericPhrases,
  headingScore,
  isBoilerplateParagraph,
  normalizeText,
  parseDateArgs,
  readJson,
  readText,
  reportTypeFromMeta,
  sectorFromText,
  splitParagraphs,
  themesFromText,
  truncate,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

const POSITIVE_KEYWORDS = [
  "상향",
  "개선",
  "성장",
  "확대",
  "호조",
  "수혜",
  "강세",
  "증가",
  "모멘텀",
  "유리",
  "매력",
  "반등",
  "본격화",
  "신규",
];

const NEGATIVE_KEYWORDS = [
  "하향",
  "둔화",
  "부담",
  "약세",
  "감소",
  "리스크",
  "불확실성",
  "우려",
  "압박",
  "약화",
  "부진",
  "하락",
];

const CHANGE_KEYWORDS = ["상향", "하향", "유지", "신규", "재개", "가속", "둔화", "확대", "축소", "변경"];

function holdingMatchesContext(holding, report, text, sector, themes) {
  const normalized = normalizeText(`${report.title}\n${text}`);
  const holdingName = normalizeText(holding.name);
  const hints = HOLDING_TOPIC_HINTS[holding.code] ?? [];
  const reportType = reportTypeFromMeta(report, normalized);

  if (
    containsKeyword(normalized, holding.code) ||
    containsKeyword(normalized, holdingName) ||
    containsKeyword(normalized, holdingName.replace(/\s+/g, "")) ||
    hints.some((hint) => containsKeyword(normalized, hint))
  ) {
    return true;
  }

  if (reportType === "macro") {
    // securities.json의 keywords.macro 기반 (MACRO_KEYWORDS_BY_CODE)
    return (MACRO_KEYWORDS_BY_CODE[holding.code] ?? []).some((hint) => containsKeyword(normalized, hint));
  }

  // securities.json의 thematic_triggers 기반 (THEMATIC_TRIGGERS_BY_CODE)
  const triggers = THEMATIC_TRIGGERS_BY_CODE[holding.code];
  if (!triggers) return false;
  const sectorMatch = (triggers.sectors ?? []).some((s) => sector === s);
  const themeMatch = (triggers.themes ?? []).some((t) => themes.includes(t));
  return sectorMatch || themeMatch;
}

function paragraphScore(paragraph, index, report, coverage) {
  let score = 0;
  const normalized = normalizeText(paragraph);
  const numbers = extractNumericPhrases(paragraph, 8);

  if (isBoilerplateParagraph(paragraph)) return -999;

  score += headingScore(paragraph);
  score += Math.min(numbers.length, 5) * 2;

  if (index <= 2) score += 5;
  if (paragraph.length >= 80 && paragraph.length <= 900) score += 6;
  if (paragraph.length > 900) score -= 2;

  for (const keyword of ["시사점", "전망", "전략", "핵심", "결론", "투자", "리스크", "모멘텀"]) {
    if (normalized.includes(keyword)) {
      score += 5;
    }
  }

  if (/close d-1|d-5 d-20|수급\(외국인\/기관|sector index|기관순매수|외국인순매수/i.test(paragraph)) {
    score -= 18;
  }
  if ((paragraph.match(/%/g) ?? []).length >= 8 && paragraph.length < 500) {
    score -= 14;
  }
  if ((paragraph.match(/[A-Za-z]{2,}/g) ?? []).length >= 25 && (paragraph.match(/[가-힣]/g) ?? []).length < 30) {
    score -= 10;
  }

  if (report.ticker && coverage.holdingsByCode.has(String(report.ticker))) {
    score += 12;
  }

  for (const [name] of coverage.holdingsByName) {
    if (normalized.includes(name)) {
      score += 14;
    }
  }

  for (const [name] of coverage.watchByName) {
    if (normalized.includes(name)) {
      score += 6;
    }
  }

  return score;
}

function inferSentiment(text) {
  const normalized = normalizeText(text);
  const pos = POSITIVE_KEYWORDS.reduce((count, keyword) => count + (normalized.includes(keyword) ? 1 : 0), 0);
  const neg = NEGATIVE_KEYWORDS.reduce((count, keyword) => count + (normalized.includes(keyword) ? 1 : 0), 0);
  const raw = pos - neg;
  return clamp(raw / 4, -1, 1);
}

function inferNovelty(text) {
  const normalized = normalizeText(text);
  const noveltyHits = ["신규", "첫", "처음", "본격화", "가속", "급증", "예상 상회", "상향"].reduce(
    (count, keyword) => count + (normalized.includes(keyword) ? 1 : 0),
    0,
  );
  return noveltyHits >= 3 ? "HIGH" : noveltyHits >= 1 ? "MED" : "LOW";
}

function pickChangeParagraphs(paragraphs) {
  return paragraphs
    .filter((paragraph) => CHANGE_KEYWORDS.some((keyword) => containsKeyword(paragraph, keyword)))
    .slice(0, 3)
    .map((paragraph) => truncate(paragraph, 240));
}

function inferDirection(sentiment) {
  if (sentiment >= 0.25) return "positive";
  if (sentiment <= -0.25) return "negative";
  if (Math.abs(sentiment) < 0.1) return "neutral";
  return "mixed";
}

function defaultHorizon(reportType) {
  if (reportType === "macro") return "1m";
  if (reportType === "stock") return "3m";
  if (reportType === "industry") return "3m";
  if (reportType === "theme") return "3m";
  return "1m";
}

function inferPortfolioImpacts(report, topParagraphs, coverage, sector, themes, sentiment) {
  const impacts = [];
  const combined = normalizeText([report.title, ...topParagraphs].join("\n"));
  const direction = inferDirection(sentiment);
  const horizon = defaultHorizon(reportTypeFromMeta(report, combined));
  const reportType = reportTypeFromMeta(report, combined);
  const strengthBase = clamp(0.28 + Math.abs(sentiment) * 0.35, 0.18, 0.78);

  for (const [code, holding] of coverage.holdingsByCode) {
    const matched = holdingMatchesContext(holding, report, combined, sector, themes);

    if (!matched) continue;

    impacts.push({
      target_type: "holding",
      target_code: code,
      target_name: holding.name,
      account_key: holding.accountKey,
      direction,
      horizon,
      strength: Number.parseFloat((reportType === "macro" ? Math.min(strengthBase, 0.36) : strengthBase).toFixed(2)),
      reason: truncate(topParagraphs[0] ?? report.title, 180),
      action_hint: direction === "positive" ? "보강" : direction === "negative" ? "감축" : "관찰",
    });
  }

  if (impacts.length === 0 && report.category === "경제분석") {
    for (const account of ["ISA", "PENSION", "TOSS"]) {
      impacts.push({
        target_type: "account",
        target_code: null,
        target_name: account,
        account_key: account,
        direction,
        horizon: "1m",
        strength: Number.parseFloat(Math.max(0.16, strengthBase - 0.15).toFixed(2)),
        reason: truncate(topParagraphs[0] ?? report.title, 180),
        action_hint: direction === "negative" ? "보류" : "관찰",
      });
    }
  }

  if (impacts.length === 0 && themes.length > 0) {
    for (const theme of themes.slice(0, 2)) {
      impacts.push({
        target_type: "theme",
        target_code: null,
        target_name: theme,
        account_key: sector === "원자력" || sector === "전력기기" || sector === "방산" ? "TOSS" : null,
        direction,
        horizon,
        strength: Number.parseFloat((strengthBase - 0.05).toFixed(2)),
        reason: truncate(topParagraphs[0] ?? report.title, 180),
        action_hint: direction === "positive" ? "관찰" : "주의",
      });
    }
  }

  return impacts;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const indexPath = path.join(ROOT_DIR, "data", "reports", args.date, "index.json");
  const portfolioPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const watchlistPath = path.join(ROOT_DIR, "config", "watchlist.json");

  const [index, portfolio, watchlist] = await Promise.all([
    readJson(indexPath, []),
    readJson(portfolioPath, { accounts: [] }),
    readJson(watchlistPath, {}),
  ]);

  const coverage = buildPortfolioMaps(portfolio, watchlist);
  const extracts = [];

  for (const report of index) {
    const fullTextPath = report.full_text_path
      ? path.join(ROOT_DIR, report.full_text_path)
      : report.pdf_path
        ? path.join(ROOT_DIR, report.pdf_path.replace(/\.pdf$/i, ".txt"))
        : null;
    const text = fullTextPath ? await readText(fullTextPath, report.extracted_text ?? "") : report.extracted_text ?? "";
    const paragraphs = splitParagraphs(text);
    const scoredParagraphs = paragraphs
      .map((paragraph, index) => ({
        paragraph,
        score: paragraphScore(paragraph, index, report, coverage),
      }))
      .sort((left, right) => right.score - left.score);

    const evidenceParagraphs = scoredParagraphs.slice(0, 8).map((item) => item.paragraph);
    const keyPoints = evidenceParagraphs.slice(0, 4).map((item) => truncate(item, 240));
    const keyNumbers = extractNumericPhrases(evidenceParagraphs.join("\n"), 14).map((value) => ({
      label: "핵심 수치",
      value,
      why_it_matters: "리포트 핵심 논리나 변화 강도를 판단하는 데 사용",
    }));
    const sentiment = inferSentiment([report.title, ...evidenceParagraphs].join("\n"));
    const sector = sectorFromText(report.title, text);
    const themes = themesFromText(report.title, text);
    const relatedHoldings = [];
    const relatedAccounts = new Set();

    for (const [code, holding] of coverage.holdingsByCode) {
      const matched = holdingMatchesContext(holding, report, text, sector, themes);
      if (!matched) continue;
      relatedHoldings.push({
        code,
        name: holding.name,
        accountKey: holding.accountKey,
        accountLabel: holding.accountLabel,
      });
      relatedAccounts.add(holding.accountKey);
    }

    const impacts = inferPortfolioImpacts(report, evidenceParagraphs, coverage, sector, themes, sentiment);
    for (const impact of impacts) {
      if (impact.account_key) relatedAccounts.add(impact.account_key);
    }

    extracts.push({
      id: report.id,
      schemaVersion: 2,
      title: report.title,
      broker: report.broker,
      source: report.source,
      date: report.date,
      category: report.category,
      report_type: reportTypeFromMeta(report, text),
      sector,
      themes,
      text_path: report.full_text_path ?? null,
      text_length: report.full_text_length ?? report.text_length ?? null,
      related_holdings_in_my_portfolio: relatedHoldings,
      related_accounts: [...relatedAccounts],
      key_thesis: keyPoints[0] ?? truncate(report.title, 160),
      key_points: keyPoints,
      key_numbers: keyNumbers,
      what_changed: pickChangeParagraphs(paragraphs),
      bull_case: evidenceParagraphs
        .filter((paragraph) => inferSentiment(paragraph) > 0.15)
        .slice(0, 2)
        .map((paragraph) => truncate(paragraph, 220)),
      bear_case: evidenceParagraphs
        .filter((paragraph) => inferSentiment(paragraph) < -0.15)
        .slice(0, 2)
        .map((paragraph) => truncate(paragraph, 220)),
      catalysts: evidenceParagraphs
        .filter((paragraph) => /실적|수주|가이던스|정책|금리|가격|출하|CAPEX|IPO/i.test(paragraph))
        .slice(0, 3)
        .map((paragraph) => truncate(paragraph, 180)),
      risks: evidenceParagraphs
        .filter((paragraph) => /리스크|우려|둔화|부담|불확실성|압박|약세/i.test(paragraph))
        .slice(0, 3)
        .map((paragraph) => truncate(paragraph, 180)),
      new_info: pickChangeParagraphs(paragraphs)[0] ?? null,
      thesis_novelty: inferNovelty([report.title, ...evidenceParagraphs].join("\n")),
      sentiment_score: Number.parseFloat(sentiment.toFixed(2)),
      portfolio_impacts_candidate: impacts,
      confidence:
        (report.full_text_length ?? report.text_length ?? 0) >= 12000
          ? "HIGH"
          : (report.full_text_length ?? report.text_length ?? 0) >= 5000
            ? "MEDIUM"
            : "LOW",
      evidence_notes: scoredParagraphs.slice(0, 8).map((item) => ({
        score: item.score,
        excerpt: truncate(item.paragraph, 260),
      })),
    });
  }

  const outputPath =
    args.output ?? path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage1-report-extracts-v2.json");
  const markdownPath =
    args.markdown ?? path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-stage1-report-extracts-v2.md`);

  const summary = [
    `# Stage 1 Report Extracts v2 (${args.date})`,
    "",
    `- 총 리포트 수: ${extracts.length}`,
    `- 포트폴리오 직접 관련 리포트: ${extracts.filter((item) => item.related_holdings_in_my_portfolio.length > 0).length}`,
    `- 계좌 영향 후보 포함 리포트: ${extracts.filter((item) => item.portfolio_impacts_candidate.length > 0).length}`,
    "",
    ...extracts.slice(0, 12).flatMap((item) => [
      `## ${item.id} · ${item.title}`,
      `- 유형: ${item.report_type} / 섹터: ${item.sector} / 증권사: ${item.broker}`,
      `- 관련 계좌: ${item.related_accounts.join(", ") || "없음"}`,
      `- 핵심 주장: ${item.key_thesis}`,
      `- 주요 숫자: ${item.key_numbers.slice(0, 4).map((entry) => entry.value).join(", ") || "없음"}`,
      "",
    ]),
  ].join("\n");

  await writeJson(outputPath, {
    date: args.date,
    generatedAt: new Date().toISOString(),
    reportCount: extracts.length,
    extracts,
  });
  await writeText(markdownPath, summary);

  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage1 report extracts 생성 실패: ${error.message}`);
  process.exit(1);
});
