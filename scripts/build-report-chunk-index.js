#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  readText,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

const TARGET_MIN_CHARS = 600;
const TARGET_MAX_CHARS = 1200;
const OVERLAP_CHARS = 150;
const MAX_STAGE1_CHUNKS_PER_REPORT = 6;
const TRAILING_DISCLAIMER_THRESHOLD = 0.6;

const STOCK_CODE_PATTERN = /\b\d{6}\b/g;
const STOCK_CODE_WITH_PREFIX_PATTERN = /\bA?\d{6}\b/g;
const NUMERIC_WITH_UNIT_PATTERN = /\d+(?:\.\d+)?\s?(?:조원|억원|만원|달러|원|bp|배|조|억|만|%)/g;
const CONDITION_PATTERNS = [
  /만약/,
  /경우/,
  /조건/,
  /달성/,
  /상회/,
  /하회/,
  /돌파/,
  /감안\s*시/,
  /상승\s*시/,
  /하락\s*시/,
  /확대\s*시/,
  /축소\s*시/,
  /유지\s*시/,
  /지연\s*시/,
  /발생\s*시/,
  /진행\s*시/,
  /도달\s*시/,
];
const COUNTERPOINT_PATTERN = /반면|그러나|다만|리스크|우려|부담|부정적|하락|감소|둔화/;
const TARGET_PRICE_PATTERN = /목표주가|TP\s*[:：]|목표\s*가격/;
const PAGE_MARKER_PATTERN = /^(?:---\s*Page\s+(\d+)\s*---|\[PAGE\s+(\d+)\])$/i;
const HOLDING_CONTEXT_PATTERN =
  /목표주가|투자의견|매수|중립|매도|실적|전망|가이던스|리스크|수혜|상향|하향|회복|성장|부진|개선|컨센|추정|저평가|선호|모멘텀|촉매|이익/;
const DISCLAIMER_PATTERNS = [
  /본\s*자료는\s*투자\s*권유를?\s*목적으로\s*하지\s*않/,
  /본\s*자료는\s*투자자(?:들)?의?\s*투자판단/,
  /이\s*자료에\s*수록된\s*내용은\s*당사가\s*신뢰할\s*만한/,
  /당사(?:의)?\s*리서치\s*센터가\s*신뢰할\s*수\s*있/,
  /정확성(?:이나)?\s*완전성을\s*보장할\s*수\s*없/,
  /투자자\s*(?:자신|본인)의\s*판단과\s*책임/,
  /의사결정은\s*전적으로\s*투자자\s*자신/,
  /투자\s*결과에\s*대한\s*법적\s*책임이?\s*없/,
  /Compliance\s*Notice/i,
  /analyst\s*certification/i,
];
const REFERENCE_SECTION_PATTERNS = [
  /목표(?:주가|가격)\s*괴리율/,
  /투자의견\s*변동\s*내역/,
  /투자의견\s*및\s*목표주가\s*(?:변동|변경)\s*내역/,
  /\[\s*종목\s*투자등급\s*\]/i,
  /투자등급\s*관련사항/,
  /투자의견\s*비율공시/,
  /투자의견\s*및\s*적용기준/,
  /목표주가\s*변동추이/,
  /Analyst\s*Certification/i,
  /Compliance\s*Notice/i,
  /\bAppendix\b/i,
];
const REFERENCE_TEXT_PATTERNS = [
  /목표(?:주가|가격)\s*괴리율/,
  /투자의견\s*변동\s*내역/,
  /투자의견\s*및\s*목표주가\s*(?:변동|변경)\s*내역/,
  /\[\s*종목\s*투자등급\s*\]/i,
  /투자의견\s*비율공시\s*및\s*투자등급\s*관련사항/,
  /투자의견\s*및\s*적용기준/,
  /기업\s*투자의견/,
  /산업\s*투자의견/,
  /제시일자\s*투자의견\s*목표주가/,
  /평균주가대비/,
  /최고\(최저\)주가대비/,
  /Adj\.?\s*Price/i,
  /Target\s*Price/i,
  /향후\s*(?:6|12)\s*개월간\s*(?:시장수익률|업종지수상승률)/,
  /Analyst\s*Certification/i,
  /Compliance\s*Notice/i,
  /\bAppendix\b/i,
];

const MACRO_ENTITY_PATTERNS = [
  { label: "WTI", pattern: /\bWTI\b/i },
  { label: "Brent", pattern: /\bBrent\b/i },
  { label: "CPI", pattern: /\bCPI\b/i },
  { label: "PCE", pattern: /\bPCE\b/i },
  { label: "FOMC", pattern: /\bFOMC\b/i },
  { label: "Fed", pattern: /\bFed\b/i },
  { label: "DXY", pattern: /\bDXY\b/i },
  { label: "달러인덱스", pattern: /달러인덱스/ },
  { label: "원달러", pattern: /원달러/ },
  { label: "환율", pattern: /환율/ },
  { label: "유가", pattern: /유가/ },
  { label: "금리", pattern: /금리/ },
  { label: "관세", pattern: /관세/ },
  { label: "금", pattern: /(?:금\s*(?:가격|값|선물|시세)|\bGold\b)/i },
];

const KEYWORDS = [
  "목표주가",
  "투자의견",
  "수주잔고",
  "수주잔액",
  "매수",
  "중립",
  "매도",
  "전력기기",
  "방산",
  "반도체",
  "전기차",
  "배터리",
  "원자력",
  "데이터센터",
  "영업이익",
  "매출",
  "PER",
  "PBR",
  "EV/EBITDA",
  "YoY",
  "QoQ",
  "실적",
  "가이던스",
  "촉매",
  "이벤트",
];

const KEYWORD_PATTERNS = KEYWORDS.map((keyword) => ({
  keyword,
  pattern: new RegExp(escapeRegex(keyword), /[A-Za-z]/.test(keyword) ? "i" : ""),
}));

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeInputText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function materializeBlock(lines) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePageMarker(line) {
  const match = String(line ?? "").trim().match(PAGE_MARKER_PATTERN);
  if (!match) return null;
  return Number.parseInt(match[1] ?? match[2], 10);
}

function isHeading(block) {
  const text = String(block ?? "").trim();
  if (!text || text.length > 120) return false;
  if (/^\d{4}[./-]\s*\d{1,2}[./-]\s*\d{1,2}\.?$/.test(text)) return true;
  if (/^\(?[0-9]+[.）\)]\s+/.test(text)) {
    return (text.match(/\d[\d,./-]*/g) ?? []).length <= 3;
  }
  if (/^[■□▶◆●]\s*/.test(text)) return true;
  if (/^[가-힣A-Za-z]+\s*[:：]$/.test(text)) return true;
  if (text.length <= 30 && !/[조억원달러%]/.test(text)) {
    if (!/[가-힣A-Za-z]/.test(text)) return false;
    if (/^[\d\s.,+\-()/:]+$/.test(text)) return false;
    return true;
  }
  return false;
}

function countMatches(pattern, text) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  return Array.from(text.matchAll(regex)).length;
}

function firstMatch(patterns, text) {
  for (const pattern of patterns) {
    const match = String(text ?? "").match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

function isTextBoundaryCharacter(char) {
  return !char || !/[0-9A-Za-z가-힣]/.test(char);
}

function findBoundedMatches(text, needle) {
  const haystack = String(text ?? "");
  const target = String(needle ?? "").trim();
  const matches = [];
  if (!target) return matches;

  let index = haystack.indexOf(target);
  while (index !== -1) {
    const before = haystack[index - 1] ?? "";
    const after = haystack[index + target.length] ?? "";
    if (isTextBoundaryCharacter(before) && isTextBoundaryCharacter(after)) {
      matches.push({
        index,
        length: target.length,
      });
    }
    index = haystack.indexOf(target, index + target.length);
  }

  return matches;
}

function makeHoldingNameVariants(rawName) {
  const variants = new Set();
  const name = String(rawName ?? "").trim();
  if (!name || name.includes("...")) {
    return [];
  }

  variants.add(name);
  const withoutParen = name.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (withoutParen.length >= 2) {
    variants.add(withoutParen);
  }

  return Array.from(variants).filter((variant) => variant.length >= 2);
}

function pushUnique(target, value) {
  if (!value || target.includes(value)) return;
  target.push(value);
}

function extractEntities(coreText) {
  const entities = [];

  for (const match of coreText.matchAll(STOCK_CODE_PATTERN)) {
    pushUnique(entities, match[0]);
  }

  for (const match of coreText.matchAll(NUMERIC_WITH_UNIT_PATTERN)) {
    pushUnique(entities, match[0].trim());
  }

  for (const { label, pattern } of MACRO_ENTITY_PATTERNS) {
    if (pattern.test(coreText)) {
      pushUnique(entities, label);
    }
  }

  return entities;
}

function extractKeywords(coreText) {
  return KEYWORD_PATTERNS.filter(({ pattern }) => pattern.test(coreText)).map(({ keyword }) => keyword);
}

function looksTableLikeChunk(coreText, sectionTitle = null) {
  const combined = `${sectionTitle ?? ""}\n${coreText}`;
  const lines = String(coreText ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const shortLines = lines.filter((line) => line.length <= 40).length;
  const stockCodeCount = countMatches(STOCK_CODE_WITH_PREFIX_PATTERN, combined);
  const numericTokenCount = (combined.match(/\d+(?:[.,/%-]\d+)*/g) ?? []).length;
  const alphaCount = (combined.match(/[가-힣A-Za-z]/g) ?? []).length;

  if (/\bxlsx\b|status|ratio|company data|종목명|시가총액|초과수익률|상위\s*\d+개사|52주\s*최고가\/최저가|1D\b|1M\b|YTD\b/i.test(combined)) {
    return true;
  }
  if (stockCodeCount >= 4) return true;
  if (lines.length >= 8 && shortLines >= Math.ceil(lines.length * 0.5)) return true;
  if (numericTokenCount >= 35 && alphaCount <= numericTokenCount * 3) return true;

  return false;
}

function hasNarrativeParagraph(coreText) {
  return String(coreText ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .some((paragraph) => {
      const alphaCount = (paragraph.match(/[가-힣A-Za-z]/g) ?? []).length;
      const digitCount = (paragraph.match(/\d/g) ?? []).length;
      return paragraph.length >= 70 && alphaCount >= 25 && digitCount < alphaCount * 1.2;
    });
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(String(text ?? "")));
}

function isReferenceChunk(sectionTitle, coreText, text) {
  const section = String(sectionTitle ?? "");
  const combined = `${section}\n${String(coreText ?? "").slice(0, 1600)}\n${String(text ?? "").slice(0, 400)}`;

  return matchesAny(REFERENCE_SECTION_PATTERNS, section) || matchesAny(REFERENCE_TEXT_PATTERNS, combined);
}

function roundTo(value, digits = 1) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function normalizeIndexEntries(raw) {
  const entries = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw?.reports) ? raw.reports : null;
  if (!entries) return null;

  return entries
    .map((entry) => {
      const reportId = entry?.report_id ?? entry?.id ?? null;
      if (!reportId) return null;
      return {
        reportId,
        broker: entry?.broker ?? null,
        title: entry?.title ?? null,
        reportDate: entry?.date ?? null,
        textPath: entry?.full_text_path ?? entry?.text_path ?? null,
      };
    })
    .filter(Boolean);
}

function normalizeManifestEntries(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        const reportId = entry?.report_id ?? entry?.id ?? null;
        if (!reportId) return null;
        return {
          reportId,
          textPath: entry?.text_path ?? null,
          broker: entry?.broker ?? null,
          title: entry?.title ?? null,
          reportDate: entry?.date ?? null,
        };
      })
      .filter(Boolean);
  }

  if (Array.isArray(raw?.entries)) {
    return normalizeManifestEntries(raw.entries);
  }

  if (raw && typeof raw === "object") {
    const entries = [];
    for (const [key, value] of Object.entries(raw)) {
      if (key === "entries" || key === "reports") continue;
      if (typeof value === "string" && value.endsWith(".txt")) {
        entries.push({ reportId: key, textPath: value, broker: null, title: null, reportDate: null });
      } else if (value && typeof value === "object") {
        const reportId = value.report_id ?? value.id ?? key;
        const textPath = value.text_path ?? value.full_text_path ?? null;
        if (reportId && textPath) {
          entries.push({
            reportId,
            textPath,
            broker: value.broker ?? null,
            title: value.title ?? null,
            reportDate: value.date ?? null,
          });
        }
      }
    }
    return entries.length > 0 ? entries : null;
  }

  return null;
}

function resolveRepoPath(value) {
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  return path.join(ROOT_DIR, value);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadReportSources(date) {
  const warnings = [];
  const reportsDir = path.join(ROOT_DIR, "data", "reports", date);
  const textDir = path.join(reportsDir, "text");
  const indexPath = path.join(reportsDir, "index.json");
  const manifestPath = path.join(reportsDir, "text-manifest.json");

  const indexEntries = normalizeIndexEntries(await readJson(indexPath, null));
  const manifestEntries = normalizeManifestEntries(await readJson(manifestPath, null));

  if (indexEntries && manifestEntries) {
    const indexByReportId = new Map(indexEntries.map((entry) => [entry.reportId, entry]));
    const reports = manifestEntries
      .map((entry) => {
        const meta = indexByReportId.get(entry.reportId) ?? null;
        const textPath =
          resolveRepoPath(entry.textPath) ??
          resolveRepoPath(meta?.textPath) ??
          path.join(textDir, `${entry.reportId}.txt`);
        return {
          reportId: entry.reportId,
          broker: meta?.broker ?? entry.broker ?? null,
          title: meta?.title ?? entry.title ?? null,
          reportDate: meta?.reportDate ?? entry.reportDate ?? date,
          textPath,
        };
      })
      .filter((entry) => entry.reportId && entry.textPath);

    const brokerNullCount = reports.filter((entry) => !entry.broker).length;
    const titleNullCount = reports.filter((entry) => !entry.title).length;
    if (brokerNullCount > 0) {
      warnings.push(`broker 누락 report 수: ${brokerNullCount}`);
    }
    if (titleNullCount > 0) {
      warnings.push(`title 누락 report 수: ${titleNullCount}`);
    }

    return {
      reports,
      indexFallbackUsed: false,
      warnings,
    };
  }

  const fallbackReasons = [];
  if (!indexEntries) fallbackReasons.push("index.json missing or invalid");
  if (!manifestEntries) fallbackReasons.push("text-manifest.json missing or invalid");
  warnings.push(`fallback text scan used: ${fallbackReasons.join(", ")}`);

  const dirEntries = await fs.readdir(textDir, { withFileTypes: true });
  const reports = dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => ({
      reportId: path.basename(entry.name, ".txt"),
      broker: null,
      title: null,
      reportDate: date,
      textPath: path.join(textDir, entry.name),
    }))
    .sort((left, right) => left.reportId.localeCompare(right.reportId));

  warnings.push(`fallback metadata unavailable for ${reports.length} reports (broker/title set to null)`);

  return {
    reports,
    indexFallbackUsed: true,
    warnings,
  };
}

async function loadHoldings() {
  const portfolioPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const portfolio = await readJson(portfolioPath, {});
  const byTicker = new Map();

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account?.holdings ?? []) {
      const ticker = String(holding?.ticker ?? holding?.code ?? "").trim();
      if (!/^\d{6}$/.test(ticker)) {
        continue;
      }

      const entry = byTicker.get(ticker) ?? { ticker, nameVariants: new Set() };
      const rawName = String(holding?.name ?? "").trim();
      for (const variant of makeHoldingNameVariants(rawName)) {
        entry.nameVariants.add(variant);
      }
      byTicker.set(ticker, entry);
    }
  }

  return Array.from(byTicker.values())
    .map((entry) => ({
      ticker: entry.ticker,
      nameVariants: Array.from(entry.nameVariants),
    }))
    .sort((left, right) => left.ticker.localeCompare(right.ticker));
}

function splitBlocks(rawText) {
  const normalizedText = normalizeInputText(rawText);
  const lines = normalizedText ? normalizedText.split("\n") : [];
  const blocks = [];
  let currentLines = [];
  let currentPage = null;
  let offset = 0;

  const flushBlock = () => {
    if (currentLines.length === 0) return;
    const text = materializeBlock(currentLines);
    currentLines = [];
    if (!text) return;
    const start = offset;
    const end = start + text.length;
    blocks.push({
      text,
      page: currentPage,
      start,
      end,
    });
    offset = end + 2;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBlock();
      continue;
    }

    const page = parsePageMarker(trimmed);
    if (page !== null) {
      flushBlock();
      currentPage = page;
      continue;
    }

    currentLines.push(trimmed);
  }

  flushBlock();

  return {
    normalizedText,
    blocks,
    totalChars: Math.max(normalizedText.length, blocks.at(-1)?.end ?? 0),
  };
}

function findHoldingMatch({ coreText, sectionTitle, reportTitle, holdings, isExcludedReference }) {
  if (isExcludedReference) return false;

  const combined = `${reportTitle ?? ""}\n${sectionTitle ?? ""}\n${coreText}`;
  const narrativeParagraph = hasNarrativeParagraph(coreText);
  const tableLike = looksTableLikeChunk(coreText, sectionTitle);
  const headingText = `${reportTitle ?? ""}\n${sectionTitle ?? ""}`;
  const hasChunkLevelAnalysisContext = HOLDING_CONTEXT_PATTERN.test(combined);

  if (tableLike || !narrativeParagraph) {
    return false;
  }

  for (const holding of holdings) {
    const titleMatchesName = holding.nameVariants.some(
      (variant) => findBoundedMatches(headingText, variant).length > 0,
    );
    const titleMatchesTicker =
      findBoundedMatches(headingText, holding.ticker).length > 0 ||
      findBoundedMatches(headingText, `A${holding.ticker}`).length > 0;

    if ((titleMatchesName || titleMatchesTicker) && hasChunkLevelAnalysisContext) {
      return true;
    }
  }

  return false;
}

function buildChunkFlags({ coreText, text, sectionTitle, reportTitle, coreStart, coreEnd, totalChars, holdings }) {
  const trailingThreshold = totalChars * TRAILING_DISCLAIMER_THRESHOLD;
  const isInTrailingZone = totalChars > 0 && coreEnd >= trailingThreshold;
  const isExcludedReference = isReferenceChunk(sectionTitle, coreText, text);
  const isDisclaimerSection = /compliance\s*notice|고지사항/i.test(sectionTitle ?? "");
  const isDisclaimer =
    (isInTrailingZone || isDisclaimerSection) &&
    (isDisclaimerSection ||
      DISCLAIMER_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
      }));
  const hasCondition = !isExcludedReference && Boolean(firstMatch(CONDITION_PATTERNS, coreText));
  const hasCounterpoint = !isExcludedReference && COUNTERPOINT_PATTERN.test(coreText);
  const hasTargetPrice = !isExcludedReference && TARGET_PRICE_PATTERN.test(coreText);
  const hasHoldingMatch = findHoldingMatch({
    coreText,
    sectionTitle,
    reportTitle,
    holdings,
    isExcludedReference,
  });

  return {
    has_condition: hasCondition,
    has_counterpoint: hasCounterpoint,
    has_target_price: hasTargetPrice,
    has_holding_match: hasHoldingMatch,
    is_disclaimer: isDisclaimer,
    _meta: {
      coreStart,
      coreEnd,
      is_excluded_reference: isExcludedReference,
    },
  };
}

function computePriorityScore(flags, coreText) {
  if (flags.is_disclaimer || flags._meta?.is_excluded_reference) return 0;

  let score = 0;
  if (flags.has_target_price) score += 5;
  if (flags.has_holding_match) score += 4;
  if (flags.has_condition) score += 3;
  if (flags.has_counterpoint) score += 2;
  score += Math.min(countMatches(NUMERIC_WITH_UNIT_PATTERN, coreText), 5);

  return score;
}

function stripInternalMeta(flags) {
  return {
    has_condition: flags.has_condition,
    has_counterpoint: flags.has_counterpoint,
    has_target_price: flags.has_target_price,
    has_holding_match: flags.has_holding_match,
    is_disclaimer: flags.is_disclaimer,
  };
}

function buildChunksForReport(report, rawText, holdings) {
  const { blocks, totalChars } = splitBlocks(rawText);
  const chunks = [];
  const contentBlocks = [];
  let currentSectionTitle = null;
  let buffer = [];
  let bufferChars = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;

    const coreText = buffer.map((block) => block.text).join("\n\n").trim();
    buffer = [];
    bufferChars = 0;

    if (!coreText) return;

    const previousCoreText = chunks.at(-1)?.core_text ?? "";
    const overlapText = previousCoreText ? previousCoreText.slice(-OVERLAP_CHARS) : "";
    const text = overlapText ? `${overlapText}\n\n${coreText}` : coreText;
    const pages = bufferPages;
    const flags = buildChunkFlags({
      coreText,
      text,
      sectionTitle: currentSectionTitle,
      reportTitle: report.title,
      coreStart: bufferStart,
      coreEnd: bufferEnd,
      totalChars,
      holdings,
    });
    const chunkSeq = chunks.length;
    const isExcludedReference = flags._meta?.is_excluded_reference;

    chunks.push({
      chunk_id: `${report.reportId}__c${String(chunkSeq).padStart(4, "0")}`,
      report_id: report.reportId,
      broker: report.broker ?? null,
      title: report.title ?? null,
      report_date: report.reportDate ?? null,
      chunk_seq: chunkSeq,
      page_start: pages.length > 0 ? Math.min(...pages) : null,
      page_end: pages.length > 0 ? Math.max(...pages) : null,
      section_title: currentSectionTitle ?? null,
      text,
      core_text: coreText,
      entities: isExcludedReference ? [] : extractEntities(coreText),
      keywords: isExcludedReference ? [] : extractKeywords(coreText),
      priority_score: computePriorityScore(flags, coreText),
      chunk_flags: stripInternalMeta(flags),
      _meta: flags._meta,
    });
  };

  let bufferStart = 0;
  let bufferEnd = 0;
  let bufferPages = [];

  const resetBufferMetadata = () => {
    bufferStart = 0;
    bufferEnd = 0;
    bufferPages = [];
  };

  resetBufferMetadata();

  for (const block of blocks) {
    if (isHeading(block.text)) {
      flushBuffer();
      resetBufferMetadata();
      currentSectionTitle = block.text;
      continue;
    }

    contentBlocks.push(block);

    if (buffer.length === 0) {
      bufferStart = block.start;
      bufferPages = [];
    }

    buffer.push(block);
    bufferEnd = block.end;
    if (Number.isInteger(block.page)) {
      bufferPages.push(block.page);
    }
    bufferChars += block.text.length + (buffer.length > 1 ? 2 : 0);

    if (bufferChars > TARGET_MAX_CHARS && bufferChars >= TARGET_MIN_CHARS) {
      flushBuffer();
      resetBufferMetadata();
    }
  }

  flushBuffer();

  if (chunks.length > 0 || contentBlocks.length === 0) {
    return chunks;
  }

  const fallbackCoreText = contentBlocks.map((block) => block.text).join("\n\n").trim();
  if (!fallbackCoreText) {
    return chunks;
  }

  const pages = contentBlocks.map((block) => block.page).filter((page) => Number.isInteger(page));
  const flags = buildChunkFlags({
    coreText: fallbackCoreText,
    text: fallbackCoreText,
    sectionTitle: currentSectionTitle,
    reportTitle: report.title,
    coreStart: contentBlocks[0].start,
    coreEnd: contentBlocks.at(-1).end,
    totalChars,
    holdings,
  });
  const isExcludedReference = flags._meta?.is_excluded_reference;

  return [
    {
      chunk_id: `${report.reportId}__c0000`,
      report_id: report.reportId,
      broker: report.broker ?? null,
      title: report.title ?? null,
      report_date: report.reportDate ?? null,
      chunk_seq: 0,
      page_start: pages.length > 0 ? Math.min(...pages) : null,
      page_end: pages.length > 0 ? Math.max(...pages) : null,
      section_title: currentSectionTitle ?? null,
      text: fallbackCoreText,
      core_text: fallbackCoreText,
      entities: isExcludedReference ? [] : extractEntities(fallbackCoreText),
      keywords: isExcludedReference ? [] : extractKeywords(fallbackCoreText),
      priority_score: computePriorityScore(flags, fallbackCoreText),
      chunk_flags: stripInternalMeta(flags),
      _meta: flags._meta,
    },
  ];
}

function compareChunks(left, right) {
  return (
    right.priority_score - left.priority_score ||
    Number(right.chunk_flags.has_holding_match) - Number(left.chunk_flags.has_holding_match) ||
    left.chunk_seq - right.chunk_seq
  );
}

function pickStage1Chunks(reportChunks) {
  const available = reportChunks.filter(
    (chunk) => !chunk.chunk_flags.is_disclaimer && !chunk._meta?.is_excluded_reference,
  );
  if (available.length === 0) return [];

  const eligible = available
    .filter((chunk) => chunk.priority_score >= 5 || chunk.chunk_flags.has_holding_match)
    .sort(compareChunks);

  if (eligible.length === 0) {
    return [...available].sort(compareChunks).slice(0, 1);
  }

  return eligible.slice(0, MAX_STAGE1_CHUNKS_PER_REPORT);
}

function toOutputChunk(chunk) {
  const { _meta, ...rest } = chunk;
  return rest;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;
  if (!isValidDate(date)) {
    throw new Error(`--date 형식이 잘못되었습니다: ${date}`);
  }

  const { reports, indexFallbackUsed, warnings } = await loadReportSources(date);
  if (reports.length === 0) {
    throw new Error(`리포트 텍스트를 찾지 못했습니다: data/reports/${date}/text`);
  }

  const holdings = await loadHoldings();
  const chunks = [];
  const chunksByReport = new Map();

  for (const report of reports) {
    if (!(await fileExists(report.textPath))) {
      warnings.push(`missing text file: ${path.relative(ROOT_DIR, report.textPath)}`);
      chunksByReport.set(report.reportId, []);
      continue;
    }

    const rawText = await readText(report.textPath, "");
    if (!rawText.trim()) {
      warnings.push(`empty text file: ${path.relative(ROOT_DIR, report.textPath)}`);
      chunksByReport.set(report.reportId, []);
      continue;
    }

    const reportChunks = buildChunksForReport(report, rawText, holdings);
    chunks.push(...reportChunks);
    chunksByReport.set(report.reportId, reportChunks);
  }

  const chunkLines = chunks.map((chunk) => JSON.stringify(toOutputChunk(chunk))).join("\n");
  const outputDir = path.join(ROOT_DIR, "data", "analysis-state", date, "chunk-index");
  const chunksPath = path.join(outputDir, "chunks.jsonl");
  const statsPath = path.join(outputDir, "stats.json");

  await writeText(chunksPath, chunkLines ? `${chunkLines}\n` : "");

  const disclaimerRemovedCount = chunks.filter((chunk) => chunk.chunk_flags.is_disclaimer).length;
  const stage1EligibleChunkCount = chunks.filter(
    (chunk) =>
      !chunk.chunk_flags.is_disclaimer &&
      !chunk._meta?.is_excluded_reference &&
      (chunk.priority_score >= 5 || chunk.chunk_flags.has_holding_match),
  ).length;
  const avgChunkChars =
    chunks.length > 0 ? roundTo(chunks.reduce((sum, chunk) => sum + chunk.core_text.length, 0) / chunks.length, 1) : 0;
  const selectedCounts = reports.map((report) => pickStage1Chunks(chunksByReport.get(report.reportId) ?? []).length);
  const avgTopChunksPerReport =
    selectedCounts.length > 0 ? roundTo(selectedCounts.reduce((sum, count) => sum + count, 0) / selectedCounts.length, 1) : 0;

  const stats = {
    date,
    report_count: reports.length,
    chunk_count: chunks.length,
    disclaimer_removed_count: disclaimerRemovedCount,
    avg_chunk_chars: avgChunkChars,
    stage1_eligible_chunk_count: stage1EligibleChunkCount,
    avg_top_chunks_per_report: avgTopChunksPerReport,
    index_fallback_used: indexFallbackUsed,
    warnings,
  };

  await writeJson(statsPath, stats);

  console.log(
    `[chunk-index] reports=${stats.report_count} chunks=${stats.chunk_count} eligible=${stats.stage1_eligible_chunk_count} disclaimers_removed=${stats.disclaimer_removed_count}`,
  );
  console.log(
    `[chunk-index] avg_chunk_chars=${Math.round(stats.avg_chunk_chars)} avg_top_chunks_per_report=${stats.avg_top_chunks_per_report}`,
  );
  console.log(`[chunk-index] output=${path.relative(ROOT_DIR, outputDir)}/`);
}

main().catch((error) => {
  console.error(`[chunk-index] ${error.message}`);
  process.exitCode = 1;
});
