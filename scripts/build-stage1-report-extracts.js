#!/usr/bin/env node
// 1단계: PDF/텍스트 원문을 연구 노트형 추출물로 변환하고 포트폴리오 관련성을 함께 태깅합니다.

import path from "node:path";

import {
  HOLDING_TOPIC_HINTS,
  MACRO_KEYWORDS_BY_CODE,
  STRICT_ALIASES_BY_CODE,
  THEMATIC_TRIGGERS_BY_CODE,
  ROOT_DIR,
  buildRunMetadata,
  buildPortfolioMaps,
  withContract,
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
const CLAIM_KEYWORDS = ["전망", "예상", "긍정", "부정", "개선", "둔화", "회복", "부담", "유효", "모멘텀", "수혜", "압박"];
const CONDITION_MARKERS = ["다만", "단,", "단 ", "단기적으로", "경우", "if", "unless"];
const COUNTERPOINT_MARKERS = ["반면", "리스크", "우려", "부담", "다만", "그러나"];

function classifyParagraph(paragraph) {
  const normalized = normalizeText(paragraph);
  const percentCount = (paragraph.match(/%/g) ?? []).length;
  const numericChunkCount = (paragraph.match(/\b\d[\d,./-]*\b/g) ?? []).length;
  const alphaTokenCount = (paragraph.match(/[A-Za-z]{2,}/g) ?? []).length;

  if (/compliance notice|고지사항|면책|무단 복제|법적 책임|당사는/i.test(paragraph)) {
    return { kind: "disclaimer", confidence: 0.98 };
  }

  if (
    /table of contents|contents|목차|chart|figure|표\s*\d+|table\s*\d+/i.test(paragraph) ||
    /close d-1|d-5 d-20|수급\(외국인\/기관|sector index|기관순매수|외국인순매수/i.test(paragraph)
  ) {
    return { kind: "table_caption", confidence: 0.95 };
  }

  if (
    paragraph.length < 80 &&
    /morning letter|daily|check point|체크포인트|요약|summary|outlook/i.test(paragraph)
  ) {
    return { kind: "heading", confidence: 0.82 };
  }

  if (
    paragraph.length < 70 &&
    /증권|리서치|analyst|date|발간|배포|update/i.test(paragraph)
  ) {
    return { kind: "metadata", confidence: 0.78 };
  }

  if (
    percentCount >= 8 ||
    numericChunkCount >= 18 ||
    (alphaTokenCount >= 25 && (paragraph.match(/[가-힣]/g) ?? []).length < 30)
  ) {
    return { kind: "table_caption", confidence: 0.75 };
  }

  const claimHits = CLAIM_KEYWORDS.reduce(
    (count, keyword) => count + (normalized.includes(normalizeText(keyword)) ? 1 : 0),
    0,
  );
  if (claimHits >= 2 && paragraph.length >= 70) {
    return { kind: "investment_claim", confidence: clamp(0.62 + claimHits * 0.08, 0, 0.95) };
  }

  if (claimHits >= 1 || paragraph.length >= 120) {
    return { kind: "weak_claim", confidence: 0.48 };
  }

  return { kind: "metadata", confidence: 0.35 };
}

function holdingMatchesContext(holding, report, text, sector, themes) {
  const normalized = normalizeText(`${report.title}\n${text}`);
  const holdingName = normalizeText(holding.name);
  const hints = HOLDING_TOPIC_HINTS[holding.code] ?? [];
  const strictAliases = STRICT_ALIASES_BY_CODE[holding.code] ?? [];
  const reportType = reportTypeFromMeta(report, normalized);

  if (
    containsKeyword(normalized, holding.code) ||
    containsKeyword(normalized, holdingName) ||
    containsKeyword(normalized, holdingName.replace(/\s+/g, "")) ||
    strictAliases.some((alias) => containsKeyword(normalized, alias))
  ) {
    return true;
  }

  if (reportType === "stock") {
    // 개별 종목 리포트는 테마 유사성만으로 포트 전체에 연결하지 않습니다.
    return false;
  }

  if (reportType === "macro") {
    // securities.json의 keywords.macro 기반 (MACRO_KEYWORDS_BY_CODE)
    return (MACRO_KEYWORDS_BY_CODE[holding.code] ?? []).some((hint) => containsKeyword(normalized, hint));
  }

  if (hints.some((hint) => containsKeyword(normalized, hint))) {
    return true;
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
  const classification = classifyParagraph(paragraph);

  if (isBoilerplateParagraph(paragraph)) return -999;
  if (classification.kind === "disclaimer") return -999;
  if (classification.kind === "table_caption") return -120;
  if (classification.kind === "heading") return -90;
  if (classification.kind === "metadata") return -40;
  if (classification.kind === "weak_claim") score -= 6;
  if (classification.kind === "investment_claim") score += 12;

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

function inferHorizonFromText(text, reportType) {
  const normalized = normalizeText(text);
  if (normalized.includes("장기")) return "long";
  if (normalized.includes("중기") || normalized.includes("중장기")) return "medium";
  if (normalized.includes("단기")) return "short";
  if (reportType === "macro") return "short";
  if (reportType === "stock") return "medium";
  return "medium";
}

function inferStrength(sentiment, classification) {
  const magnitude = Math.abs(sentiment);
  if (classification.kind === "investment_claim" && magnitude >= 0.45) return "strong";
  if (classification.kind === "investment_claim" && magnitude >= 0.2) return "medium";
  if (classification.kind === "weak_claim") return "weak";
  return "medium";
}

function inferEntityFromContext(report, paragraph, sector, themes) {
  if (report.ticker_name) return report.ticker_name;
  if (report.ticker) return String(report.ticker);
  if (sector && sector !== "기타") return sector;
  if (themes.length > 0) return themes[0];
  const match = String(report.title ?? paragraph).match(/[가-힣A-Za-z0-9&+ ]{2,}/);
  return match?.[0]?.trim() ?? report.title;
}

function collectMarkedSnippets(text, markers, maxLength = 220) {
  const source = String(text ?? "");
  const snippets = [];

  for (const marker of markers) {
    let startPos = 0;
    while (startPos < source.length) {
      const index = source.indexOf(marker, startPos);
      if (index < 0) break;

      const window = source.slice(index, index + maxLength);
      const delimiters = [...window.matchAll(/[.!?。\n]/g)];
      const boundary = delimiters.find((entry) => (entry.index ?? 0) >= 20);
      const snippet = window
        .slice(0, boundary ? (boundary.index ?? 0) + 1 : window.length)
        .replace(/\s+/g, " ")
        .trim();

      if (snippet.length >= 12) {
        const normalizedSnippet = normalizeText(snippet);
        const overlaps = snippets.some((existing) => {
          const normalizedExisting = normalizeText(existing);
          return (
            normalizedExisting.includes(normalizedSnippet) ||
            normalizedSnippet.includes(normalizedExisting)
          );
        });

        if (!overlaps) {
          snippets.push(snippet);
        }
      }

      startPos = index + Math.max(marker.length, snippet.length, 1);
    }
  }

  return snippets.slice(0, 3);
}

function extractCondition(text) {
  const snippets = collectMarkedSnippets(text, CONDITION_MARKERS, 220);
  return snippets.length > 0 ? snippets.join(" | ") : null;
}

function extractCounterpoint(text, evidenceParagraphs = []) {
  const collected = [];

  for (const source of [text, ...evidenceParagraphs]) {
    for (const snippet of collectMarkedSnippets(source, COUNTERPOINT_MARKERS, 220)) {
      const normalizedSnippet = normalizeText(snippet);
      const overlaps = collected.some((existing) => {
        const normalizedExisting = normalizeText(existing);
        return (
          normalizedExisting.includes(normalizedSnippet) ||
          normalizedSnippet.includes(normalizedExisting)
        );
      });
      if (!overlaps) {
        collected.push(snippet);
      }
    }
  }

  return collected.length > 0 ? collected.slice(0, 3).join(" | ") : null;
}

function categorizeNumericPhrase(phrase, keyThesis, catalysts) {
  const normalized = normalizeText(phrase);
  const thesisNormalized = normalizeText(keyThesis);
  const catalystNormalized = (catalysts ?? []).map((entry) => normalizeText(entry));

  if (thesisNormalized && thesisNormalized.includes(normalized.slice(0, 8))) {
    return "thesis_anchor";
  }

  if (catalystNormalized.some((entry) => entry.includes(normalized.slice(0, 8)))) {
    return "catalyst_number";
  }

  if (CHANGE_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))) {
    return "change_signal";
  }

  if (/목표|target|밸류|per|pbr|eps/i.test(phrase)) {
    return "valuation";
  }

  return "supporting";
}

function buildClaimObject({ report, paragraph, paragraphIndex, classification, sector, themes, reportType, evidenceParagraphs }) {
  const sentiment = inferSentiment(`${report.title}\n${paragraph}`);
  const entity = inferEntityFromContext(report, paragraph, sector, themes);
  const direction = inferDirection(sentiment);
  const reason = truncate(paragraph.split(/(?:다만|그러나|반면)/)[0] ?? paragraph, 160);
  const condition = extractCondition(paragraph);
  const counterpoint = extractCounterpoint(paragraph, evidenceParagraphs);
  const horizon = inferHorizonFromText(paragraph, reportType);
  const strength = inferStrength(sentiment, classification);

  return {
    entity,
    direction,
    strength,
    horizon,
    reason,
    condition,
    counterpoint,
    source_span: `paragraph_${paragraphIndex + 1}`,
    classification: classification.kind,
    classification_confidence: Number.parseFloat(classification.confidence.toFixed(2)),
    summary: truncate(
      `${entity}는 ${direction === "positive" ? "긍정" : direction === "negative" ? "부정" : direction === "mixed" ? "혼합" : "중립"} 시각이며 핵심 근거는 ${reason}${condition ? ` / 조건: ${condition}` : ""}`,
      220,
    ),
  };
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
  const reportType = reportTypeFromMeta(report, combined);
  const horizon = defaultHorizon(reportType);
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
    for (const account of ["ISA", "PENSION", "KIS_MAIN"]) {
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

  if (impacts.length === 0 && reportType !== "stock" && themes.length > 0) {
    for (const theme of themes.slice(0, 2)) {
      impacts.push({
        target_type: "theme",
        target_code: null,
        target_name: theme,
        account_key: sector === "원자력" || sector === "전력기기" || sector === "방산" ? "KIS_MAIN" : null,
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
  const globalQuality = {
    contaminationEvidenceCount: 0,
    totalEvidenceCount: 0,
    weakClaimCount: 0,
    totalClaims: 0,
  };

  for (const report of index) {
    const fullTextPath = report.full_text_path
      ? path.join(ROOT_DIR, report.full_text_path)
      : report.pdf_path
        ? path.join(ROOT_DIR, report.pdf_path.replace(/\.pdf$/i, ".txt"))
        : null;
    const text = fullTextPath ? await readText(fullTextPath, report.extracted_text ?? "") : report.extracted_text ?? "";
    const paragraphs = splitParagraphs(text);
    const sector = sectorFromText(report.title, text);
    const themes = themesFromText(report.title, text);
    const reportType = reportTypeFromMeta(report, text);
    const scoredParagraphs = paragraphs
      .map((paragraph, index) => ({
        paragraph,
        index,
        classification: classifyParagraph(paragraph),
        score: paragraphScore(paragraph, index, report, coverage),
      }))
      .sort((left, right) => right.score - left.score);

    const claimPool = scoredParagraphs.filter(
      (item) => item.classification.kind === "investment_claim" || item.classification.kind === "weak_claim",
    );
    const evidencePool = (claimPool.length > 0 ? claimPool : scoredParagraphs.filter((item) => item.score > 0)).slice(0, 8);
    const evidenceParagraphs = evidencePool.map((item) => item.paragraph);
    const claimCandidates = evidencePool.slice(0, 4).map((item) =>
      buildClaimObject({
        report,
        paragraph: item.paragraph,
        paragraphIndex: item.index,
        classification: item.classification,
        sector,
        themes,
        reportType,
        evidenceParagraphs,
      }),
    );
    const primaryClaim =
      claimCandidates.find((item) => item.classification === "investment_claim") ??
      claimCandidates[0] ??
      null;
    const keyPoints = claimCandidates.map((item) => item.summary);
    const changeParagraphs = pickChangeParagraphs(paragraphs);
    const keyThesis = primaryClaim?.summary ?? truncate(report.title, 160);
    const catalysts = evidenceParagraphs
      .filter((paragraph) => /실적|수주|가이던스|정책|금리|가격|출하|CAPEX|IPO/i.test(paragraph))
      .slice(0, 3)
      .map((paragraph) => truncate(paragraph, 180));
    const keyNumbers = extractNumericPhrases(evidenceParagraphs.join("\n"), 14)
      .map((value) => {
        const label = categorizeNumericPhrase(value, keyThesis, catalysts);
        return {
          label,
          value,
          why_it_matters:
            {
              thesis_anchor: "핵심 투자 논리를 직접 뒷받침하는 수치",
              catalyst_number: "변화 촉매의 구체적 근거",
              change_signal: "추세 변화나 전환을 시사하는 수치",
              valuation: "밸류에이션/목표가 해석에 필요한 수치",
              supporting: "보조 참고 수치",
            }[label] ?? "보조 참고 수치",
        };
      })
      .sort((left, right) => {
        const priority = {
          thesis_anchor: 0,
          catalyst_number: 1,
          change_signal: 2,
          valuation: 3,
          supporting: 4,
        };
        return (priority[left.label] ?? 5) - (priority[right.label] ?? 5);
      });
    const sentiment = inferSentiment([report.title, ...evidenceParagraphs].join("\n"));
    const relatedHoldings = [];
    const relatedAccounts = new Set();
    const quality = {
      contaminationEvidenceCount: evidencePool.filter((item) =>
        ["heading", "table_caption", "metadata", "disclaimer"].includes(item.classification.kind),
      ).length,
      totalEvidenceCount: evidencePool.length,
      weakClaimCount: claimCandidates.filter((item) => item.classification === "weak_claim").length,
      totalClaims: claimCandidates.length,
    };

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
      report_type: reportType,
      sector,
      themes,
      text_path: report.full_text_path ?? null,
      text_length: report.full_text_length ?? report.text_length ?? null,
      related_holdings_in_my_portfolio: relatedHoldings,
      related_accounts: [...relatedAccounts],
      key_thesis: keyThesis,
      key_points: keyPoints,
      primary_claim: primaryClaim,
      claim_candidates: claimCandidates,
      key_numbers: keyNumbers,
      what_changed: changeParagraphs,
      bull_case: evidenceParagraphs
        .filter((paragraph) => inferSentiment(paragraph) > 0.15)
        .slice(0, 2)
        .map((paragraph) => truncate(paragraph, 220)),
      bear_case: evidenceParagraphs
        .filter((paragraph) => inferSentiment(paragraph) < -0.15)
        .slice(0, 2)
        .map((paragraph) => truncate(paragraph, 220)),
      catalysts,
      risks: evidenceParagraphs
        .filter((paragraph) => /리스크|우려|둔화|부담|불확실성|압박|약세/i.test(paragraph))
        .slice(0, 3)
        .map((paragraph) => truncate(paragraph, 180)),
      new_info: changeParagraphs[0] ?? null,
      thesis_novelty: inferNovelty([report.title, ...evidenceParagraphs].join("\n")),
      sentiment_score: Number.parseFloat(sentiment.toFixed(2)),
      portfolio_impacts_candidate: impacts,
      confidence:
        primaryClaim?.classification === "investment_claim"
          ? "HIGH"
          : (report.full_text_length ?? report.text_length ?? 0) >= 5000
            ? "MEDIUM"
            : "LOW",
      quality,
      evidence_notes: scoredParagraphs.slice(0, 8).map((item) => ({
        score: item.score,
        classification: item.classification.kind,
        excerpt: truncate(item.paragraph, 260),
      })),
    });

    globalQuality.contaminationEvidenceCount += quality.contaminationEvidenceCount;
    globalQuality.totalEvidenceCount += quality.totalEvidenceCount;
    globalQuality.weakClaimCount += quality.weakClaimCount;
    globalQuality.totalClaims += quality.totalClaims;
  }

  const outputPath =
    args.output ?? path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage1-report-extracts-v2.json");
  const markdownPath =
    args.markdown ?? path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-stage1-report-extracts-v2.md`);
  const runMeta = buildRunMetadata(args);

  const summary = [
    `# Stage 1 Report Extracts v2 (${args.date})`,
    "",
    `- 실행일: ${runMeta.runDate}`,
    `- 기준 거래일: ${runMeta.effectiveMarketDate}`,
    `- run_id: ${runMeta.runId ?? "N/A"}`,
    `- 총 리포트 수: ${extracts.length}`,
    `- 포트폴리오 직접 관련 리포트: ${extracts.filter((item) => item.related_holdings_in_my_portfolio.length > 0).length}`,
    `- 계좌 영향 후보 포함 리포트: ${extracts.filter((item) => item.portfolio_impacts_candidate.length > 0).length}`,
    `- contamination rate: ${globalQuality.totalEvidenceCount > 0 ? (globalQuality.contaminationEvidenceCount / globalQuality.totalEvidenceCount).toFixed(2) : "0.00"}`,
    `- weak claim ratio: ${globalQuality.totalClaims > 0 ? (globalQuality.weakClaimCount / globalQuality.totalClaims).toFixed(2) : "0.00"}`,
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

  await writeJson(
    outputPath,
    withContract(
      {
        ...runMeta,
        reportCount: extracts.length,
        quality: {
          contaminationEvidenceCount: globalQuality.contaminationEvidenceCount,
          totalEvidenceCount: globalQuality.totalEvidenceCount,
          contaminationRate:
            globalQuality.totalEvidenceCount > 0
              ? Number.parseFloat((globalQuality.contaminationEvidenceCount / globalQuality.totalEvidenceCount).toFixed(4))
              : 0,
          weakClaimCount: globalQuality.weakClaimCount,
          totalClaims: globalQuality.totalClaims,
          weakClaimRatio:
            globalQuality.totalClaims > 0
              ? Number.parseFloat((globalQuality.weakClaimCount / globalQuality.totalClaims).toFixed(4))
              : 0,
        },
        extracts,
      },
      {
        stage: "stage1",
        generatedAt: runMeta.generatedAt,
      },
    ),
  );
  await writeText(markdownPath, summary);

  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage1 report extracts 생성 실패: ${error.message}`);
  process.exit(1);
});
