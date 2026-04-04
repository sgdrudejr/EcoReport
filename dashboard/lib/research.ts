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
