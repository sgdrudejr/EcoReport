import fs from "fs";
import path from "path";
import { resolveRepoRoot } from "@/lib/repo-root";

const REPO_ROOT = resolveRepoRoot();
const KNOWLEDGE_DAILY_DIR = path.join(REPO_ROOT, "knowledge", "daily");
const MARKET_DIR = path.join(REPO_ROOT, "data", "market");
const TECHNICAL_DIR = path.join(REPO_ROOT, "data", "technical");

export interface ResearchBriefingMeta {
  model?: string | null;
  used_chunk_count?: number | null;
  covered_report_count?: number | null;
  summary_chunk_count?: number | null;
  candidate_chunk_count?: number | null;
  briefing_candidate_count?: number | null;
  merged_text_length?: number | null;
  selected_chunk_count?: number | null;
  selected_report_count?: number | null;
  merged_text_char_length?: number | null;
}

export interface ResearchBriefingDocument {
  filename: string;
  slug: string;
  date: string;
  content: string;
  variant: "rich" | "standard";
  meta: ResearchBriefingMeta | null;
}

export interface ResearchBriefingStats {
  model: string | null;
  usedChunkCount: number | null;
  coveredReportCount: number | null;
  mergedTextLength: number | null;
  summaryChunkCount: number | null;
  candidateChunkCount: number | null;
}

export interface MacroIndicator {
  key: string;
  label: string;
  close: number | null;
  changePct: number | null;
  signal?: string | null;
}

export interface ResearchSection {
  title: string;
  body: string;
}

export interface ResearchTag {
  label: string;
  tone: "rose" | "sky" | "emerald" | "amber" | "fuchsia" | "zinc";
  kind: "market" | "macro" | "sector" | "risk" | "action";
}

const RESEARCH_TAG_RULES: Array<{
  label: string;
  tone: ResearchTag["tone"];
  kind: ResearchTag["kind"];
  pattern: RegExp;
}> = [
  { label: "KOSPI", tone: "rose", kind: "market", pattern: /(KOSPI|코스피)/i },
  { label: "KOSDAQ", tone: "fuchsia", kind: "market", pattern: /(KOSDAQ|코스닥)/i },
  { label: "S&P500", tone: "sky", kind: "market", pattern: /(S&P ?500|SP500)/i },
  { label: "NASDAQ", tone: "sky", kind: "market", pattern: /(NASDAQ|나스닥)/i },
  { label: "원\/달러", tone: "amber", kind: "macro", pattern: /(원\/달러|USDKRW|환율)/i },
  { label: "WTI", tone: "amber", kind: "macro", pattern: /(WTI|유가|원유)/i },
  { label: "금", tone: "amber", kind: "macro", pattern: /(금\/원자재|골드|금 가격|금\b)/i },
  { label: "VIX", tone: "amber", kind: "risk", pattern: /\bVIX\b/i },
  { label: "금리/매크로", tone: "amber", kind: "macro", pattern: /(금리|매크로|CPI|FOMC|연준|한국은행)/i },
  { label: "HBM/메모리", tone: "sky", kind: "sector", pattern: /(HBM|메모리|반도체)/i },
  { label: "AI 인프라", tone: "sky", kind: "sector", pattern: /(AI 인프라|데이터센터|AI 모델|하이퍼스케일러)/i },
  { label: "전력 인프라", tone: "emerald", kind: "sector", pattern: /(전력 인프라|전력|전기요금|전력기기)/i },
  { label: "원자력", tone: "emerald", kind: "sector", pattern: /(원자력|SMR|원전)/i },
  { label: "방산", tone: "fuchsia", kind: "sector", pattern: /(방산|국방|NATO|우주항공)/i },
  { label: "리스크 경계", tone: "rose", kind: "risk", pattern: /(변동성|불확실성|경계|부담|급락|위험)/i },
];

const ACTION_CUE_PATTERN =
  /(주목|체크|보강|확대|축소|유지|관망|경계|점검|매수|매도|준비|유의|확인)/;

function parseJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function getResearchMeta(filePath: string) {
  const metaPath = `${filePath}.meta.json`;
  if (!fs.existsSync(metaPath)) return null;
  return parseJsonFile<ResearchBriefingMeta>(metaPath);
}

export function loadResearchBriefings(): ResearchBriefingDocument[] {
  if (!fs.existsSync(KNOWLEDGE_DAILY_DIR)) return [];

  return fs
    .readdirSync(KNOWLEDGE_DAILY_DIR)
    .filter((filename) =>
      /^\d{4}-\d{2}-\d{2}-gemini-briefing(?:-rich)?\.md$/.test(filename),
    )
    .map((filename) => {
      const filePath = path.join(KNOWLEDGE_DAILY_DIR, filename);
      return {
        filename,
        slug: filename.replace(/\.md$/, ""),
        date: filename.slice(0, 10),
        content: fs.readFileSync(filePath, "utf-8"),
        variant: filename.includes("-rich.") ? "rich" : "standard",
        meta: getResearchMeta(filePath),
      } satisfies ResearchBriefingDocument;
    })
    .sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }
      if (left.variant !== right.variant) {
        return left.variant === "rich" ? -1 : 1;
      }
      return right.filename.localeCompare(left.filename);
    });
}

export function loadResearchBriefingBySlug(slug: string) {
  return loadResearchBriefings().find((doc) => doc.slug === slug) ?? null;
}

export function getResearchBriefingStats(
  briefing: ResearchBriefingDocument | null,
): ResearchBriefingStats {
  const meta = briefing?.meta ?? null;
  return {
    model: meta?.model ?? null,
    usedChunkCount:
      meta?.selected_chunk_count ??
      meta?.used_chunk_count ??
      meta?.summary_chunk_count ??
      null,
    coveredReportCount:
      meta?.selected_report_count ??
      meta?.covered_report_count ??
      null,
    mergedTextLength:
      meta?.merged_text_char_length ??
      meta?.merged_text_length ??
      null,
    summaryChunkCount: meta?.summary_chunk_count ?? null,
    candidateChunkCount:
      meta?.briefing_candidate_count ??
      meta?.candidate_chunk_count ??
      null,
  };
}

export function extractResearchSections(content: string): ResearchSection[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const headingMatches = [...normalized.matchAll(/^##\s+(.+)$/gm)];

  if (headingMatches.length === 0) {
    return [
      {
        title: "전체 브리핑",
        body: normalized,
      },
    ];
  }

  return headingMatches.map((match, index) => {
    const title = match[1].trim();
    const start = match.index! + match[0].length;
    const end =
      index + 1 < headingMatches.length
        ? headingMatches[index + 1].index!
        : normalized.length;

    return {
      title,
      body: normalized.slice(start, end).trim(),
    };
  });
}

function uniqueByLabel<T extends { label: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

function splitIntoSentences(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?。]|다\.)\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function extractResearchTags(content: string, limit = 10): ResearchTag[] {
  const tags = RESEARCH_TAG_RULES.filter((rule) => rule.pattern.test(content)).map((rule) => ({
    label: rule.label,
    tone: rule.tone,
    kind: rule.kind,
  }));

  return uniqueByLabel(tags).slice(0, limit);
}

export function extractResearchActionPoints(content: string, limit = 4): string[] {
  const sentences = splitIntoSentences(content);
  const matched = sentences.filter((sentence) => {
    if (sentence.length < 24 || sentence.length > 180) return false;
    return ACTION_CUE_PATTERN.test(sentence);
  });

  return [...new Set(matched)].slice(0, limit);
}

export function extractSectionTags(section: ResearchSection, limit = 6) {
  return extractResearchTags(`${section.title}\n${section.body}`, limit);
}

export function extractSectionActionPoints(section: ResearchSection, limit = 3) {
  return extractResearchActionPoints(section.body, limit);
}

export function loadLatestMacroIndicators(date?: string): MacroIndicator[] {
  if (!fs.existsSync(MARKET_DIR)) return [];

  const marketFile =
    date != null
      ? path.join(MARKET_DIR, `${date}.json`)
      : fs
          .readdirSync(MARKET_DIR)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse()
          .map((f) => path.join(MARKET_DIR, f))[0];

  if (!marketFile || !fs.existsSync(marketFile)) return [];

  const market = parseJsonFile<{
    indices?: Record<string, { close?: number | null; change_pct?: number | null }>;
    macro?: Record<string, { close?: number | null; change_pct?: number | null }>;
    date?: string;
  }>(marketFile);
  if (!market) return [];

  const marketDate = date ?? market.date ?? path.basename(marketFile, ".json");
  const technical = parseJsonFile<{ market_context?: { signal?: string | null } }>(
    path.join(TECHNICAL_DIR, `${marketDate}.json`),
  );

  const indicators: MacroIndicator[] = [
    {
      key: "KOSPI",
      label: "코스피",
      close: market.indices?.KOSPI?.close ?? null,
      changePct: market.indices?.KOSPI?.change_pct ?? null,
      signal: technical?.market_context?.signal ?? null,
    },
    {
      key: "SP500",
      label: "S&P500",
      close: market.indices?.SP500?.close ?? null,
      changePct: market.indices?.SP500?.change_pct ?? null,
    },
    {
      key: "NASDAQ",
      label: "나스닥",
      close: market.indices?.NASDAQ?.close ?? null,
      changePct: market.indices?.NASDAQ?.change_pct ?? null,
    },
    {
      key: "USDKRW",
      label: "원/달러",
      close: market.macro?.USDKRW?.close ?? null,
      changePct: market.macro?.USDKRW?.change_pct ?? null,
    },
    {
      key: "WTI",
      label: "WTI",
      close: market.macro?.WTI?.close ?? null,
      changePct: market.macro?.WTI?.change_pct ?? null,
    },
    {
      key: "GOLD",
      label: "금",
      close: market.macro?.GOLD?.close ?? null,
      changePct: market.macro?.GOLD?.change_pct ?? null,
    },
  ];

  return indicators.filter((item) => item.close != null);
}
