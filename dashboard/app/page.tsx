import path from "path";
import type { ReactNode } from "react";
import {
  BadgeCheck,
  CircleDashed,
  ExternalLink,
  LayoutGrid,
  LineChart,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import AccountTabs from "@/components/AccountTabs";
import AllocationHeatmap from "@/components/AllocationHeatmap";
import ClusterMap, { type HoldingCluster } from "@/components/ClusterMap";
import CompactContentTabs from "@/components/CompactContentTabs";
import ExperimentalVisibility from "@/components/ExperimentalVisibility";
import ExecutionListTable from "@/components/ExecutionListTable";
import ExecutionNarrativeCard from "@/components/ExecutionNarrativeCard";
import FeedbackPanel, { type FeedbackAnalysis } from "@/components/FeedbackPanel";
import FloatingSectionIndex from "@/components/FloatingSectionIndex";
import HoldingTabs from "@/components/HoldingTabs";
import RecommendationTabs from "@/components/RecommendationTabs";
import {
  buildPortfolioGuide,
  type AccountGuide,
  type ExecutionGuideItem,
  type HoldingGuide,
  type PortfolioGuide,
} from "@/lib/portfolio-guidance";
import {
  getHoldingProfitLoss,
  getHoldingProfitRate,
  getPortfolioTotals,
  loadLatestPortfolio,
  type PortfolioAccount,
  type PortfolioHolding,
} from "@/lib/portfolio";
import {
  extractResearchActionGroups,
  extractResearchCheckpoints,
  extractResearchDiagnosis,
  extractResearchPortfolioInsights,
  extractResearchScenarioBranches,
  extractResearchStrategyGuide,
  extractResearchTags,
  getResearchBriefingOverview,
  loadLatestMacroIndicators,
  loadResearchBriefings,
  type MacroIndicator,
} from "@/lib/research";
import { loadRecommendationBoard, type RecommendationIdea } from "@/lib/recommendations";
import { listRepoDirectories, listRepoFiles, readRepoJsonFile } from "@/lib/repo-artifacts";
import { formatDateContextLine } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR");
const MARKET_VALUE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const MARKETVOICE_DATETIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});
const BODY_COPY_CLASS =
  "text-[15px] leading-[1.78] [word-break:keep-all] [text-wrap:pretty]";
const BODY_COPY_LEAD_CLASS =
  "text-[16px] leading-[1.84] font-medium [word-break:keep-all] [text-wrap:pretty]";
const BODY_NOTE_CLASS =
  "text-[14px] leading-[1.66] [word-break:keep-all] [text-wrap:pretty]";
const BODY_NOTE_MUTED_CLASS =
  "text-[13.5px] leading-[1.6] [word-break:keep-all] [text-wrap:pretty]";
const RESEARCH_METRIC_TONES = ["info", "brand", "caution", "neutral"] as const;

type Stage2Strategy = {
  date?: string;
  macro_view?: {
    regime?: string | null;
    confidence?: string | null;
    summary?: string | null;
  };
  strategy_changes?: Array<{
    theme?: string | null;
    direction?: string | null;
    why_now?: string | null;
    source_reports?: string[];
  }>;
  account_actions?: Array<{
    account_key?: string | null;
    bias?: string | null;
    rationale?: string | null;
    reserve_cash_note?: string | null;
  }>;
  candidate_scores?: Array<{
    code?: string | null;
    name?: string | null;
    stance?: string | null;
    target_accounts?: string[];
    horizon?: string | null;
    confidence?: string | null;
    thesis?: string | null;
    risks?: string[];
  }>;
};

type ImpactMap = {
  date?: string;
  reports?: Array<{
    reportId?: string;
    title?: string;
    broker?: string | null;
    reportMeta?: {
      report_type?: string | null;
      themes?: string[];
      key_numbers?: string[];
    } | null;
    impacts?: Array<{
      target?: {
        type?: string | null;
        accountKey?: string | null;
        code?: string | null;
        name?: string | null;
      } | null;
      direction?: string | null;
      strength?: number | null;
      confidence?: number | null;
      horizon?: string | null;
      evidence?: {
        snippets?: string[];
        numbers?: string[];
      } | null;
      riskTags?: string[];
    }>;
  }>;
};

type Stage3Analysis = {
  holdings?: Record<
    string,
    {
      code?: string | null;
      name?: string | null;
      accountKey?: string | null;
      category?: string | null;
      signal?: string | null;
      technicalSignal?: string | null;
      reportImpacts?: Array<{
        title?: string | null;
        direction?: string | null;
        strength?: number | null;
        reason?: string | null;
      }>;
      explain?: {
        topDrivers?: string[];
        warnings?: string[];
      } | null;
    }
  >;
  positions?: Record<
    string,
    {
      code?: string | null;
      name?: string | null;
      accountKey?: string | null;
      category?: string | null;
      signal?: string | null;
      technicalSignal?: string | null;
      reportImpacts?: Array<{
        title?: string | null;
        direction?: string | null;
        strength?: number | null;
        reason?: string | null;
      }>;
      explain?: {
        topDrivers?: string[];
        warnings?: string[];
      } | null;
    }
  >;
};

type TechnicalSnapshot = {
  date?: string;
  scores?: Record<
    string,
    {
      score?: number | null;
      signal?: string | null;
      signal_reason?: string | null;
      rsi?: number | null;
      change_pct?: number | null;
      macd?: {
        histogram?: number | null;
      } | null;
      bollinger?: {
        position?: string | null;
      } | null;
      technical_analysis?: {
        execution_bias?: {
          side?: "buy_side" | "neutral" | "sell_side";
          label?: string | null;
          summary?: string | null;
        } | null;
        indicators?: {
          rsi?: {
            side?: "buy_side" | "neutral" | "sell_side";
            summary?: string | null;
          } | null;
          macd?: {
            side?: "buy_side" | "neutral" | "sell_side";
            summary?: string | null;
          } | null;
          bollinger?: {
            side?: "buy_side" | "neutral" | "sell_side";
            summary?: string | null;
          } | null;
          movingAverage?: {
            side?: "buy_side" | "neutral" | "sell_side";
            summary?: string | null;
          } | null;
        } | null;
      } | null;
      alerts?: string[];
    }
  >;
};

type MarketVoiceArtifact = {
  summary?: {
    overview?: string | null;
    directHoldingTopics?: number | null;
    thematicAccountTopics?: number | null;
    watchlistTopics?: number | null;
    highPriorityTopics?: number | null;
  } | null;
  topics?: Array<{
    topicId?: string | null;
    title?: string | null;
    portfolioLinkage?: string | null;
    summary?: string | null;
    signalLabels?: string[];
  }>;
  accountDigests?: Array<{
    accountKey?: string | null;
    accountLabel?: string | null;
    topTopics?: Array<{
      topicId?: string | null;
      title?: string | null;
      topicUrl?: string | null;
      relevanceScore?: number | null;
      signalDirection?: string | null;
      portfolioLinkage?: string | null;
      matchedNames?: string[];
      matchedCategories?: string[];
      sourceCount?: number | null;
      updatedAt?: string | null;
    }>;
  }>;
  deepResearchCandidates?: Array<{
    topicId?: string | null;
    title?: string | null;
    topicUrl?: string | null;
    relevanceScore?: number | null;
    reason?: string | null;
    question?: string | null;
  }>;
};

type HoldingClustersArtifact = {
  clusters?: HoldingCluster[];
  threshold?: number | null;
};

type HighlightSpec = {
  token: string;
  tone: "negative" | "neutral" | "positive" | "defensive" | "other";
};

type AccountStoryCard = {
  title: string;
  body: string;
  tone: HighlightSpec["tone"];
};

type AccountStory = {
  paragraphs: string[];
  cards: AccountStoryCard[];
  highlights: HighlightSpec[];
};

type HoldingSummary = {
  insights: string[];
  cautions: string[];
  chips: string[];
  reportCount: number;
  positiveCount: number;
  negativeCount: number;
};

type ExecutionListRow = {
  key: string;
  kind: ExecutionGuideItem["kind"];
  accountKeys: string[];
  accounts: string[];
  name: string;
  code: string | null;
  amountLabel: string;
  reason: string;
  hitRateBadge?: string | null;
  confidenceLevel?: "high" | "medium" | "low" | null;
};

const INLINE_HIGHLIGHT_LIBRARY = [
  "유가 상승",
  "원유가격",
  "유가",
  "원/달러",
  "달러 강세",
  "달러",
  "환율",
  "장기금리",
  "금리",
  "지정학 리스크",
  "지정학",
  "휴전 실패",
  "휴전",
  "리스크",
  "변동성",
  "하락",
  "매도",
  "축소",
  "금",
  "안전자산",
  "현금",
  "현금 비중",
  "대기 자금",
  "방어 자산",
  "방어 쿠션",
  "헤지",
  "KOFR",
  "관망",
  "보유",
  "배당/커버드콜",
  "방산",
  "S&P500",
  "나스닥100",
  "나스닥",
  "AI 인프라",
  "AI",
  "전력 인프라",
  "전력",
  "인프라",
  "코어 자산",
  "코어",
  "장기 복리",
  "원자력",
  "전력기기",
  "구리",
  "실물 자산",
  "에너지 안보",
  "실적",
  "수급",
  "정책",
  "정책 가시성",
  "정책 드라이브",
  "수주",
  "분할 매수",
  "전술 알파",
  "테마",
  "점검",
  "균형",
  "중립",
  "횡보 레짐",
  "레짐",
  "뉴스 흐름",
  "내러티브",
  "골든크로스",
  "MACD",
  "RSI",
  "볼린저",
];

function loadLatestDatedJson<T>(fileName: string, dateHint?: string | null) {
  if (dateHint) {
    const preferred = readRepoJsonFile<T>(
      path.posix.join("data/analysis-state", dateHint, fileName),
    );
    if (preferred) {
      return {
        date: dateHint,
        data: preferred,
      };
    }
  }

  const dates = listRepoDirectories("data/analysis-state").sort().reverse();
  for (const date of dates) {
    const candidate = readRepoJsonFile<T>(
      path.posix.join("data/analysis-state", date, fileName),
    );
    if (candidate) {
      return {
        date,
        data: candidate,
      };
    }
  }

  return {
    date: null,
    data: null,
  };
}

function loadLatestTechnicalSnapshot(dateHint?: string | null) {
  if (dateHint) {
    const preferred = readRepoJsonFile<TechnicalSnapshot>(
      path.posix.join("data/technical", `${dateHint}.json`),
    );
    if (preferred) return preferred;
  }

  const latestFile = listRepoFiles("data/technical")
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .reverse()[0];

  if (!latestFile) return null;
  return readRepoJsonFile<TechnicalSnapshot>(path.posix.join("data/technical", latestFile));
}

function loadLatestFeedbackAnalysis(dateHint?: string | null) {
  const candidateFiles = listRepoFiles("data/feedback/analysis")
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse();

  const preferredFiles = dateHint ? [`${dateHint}-feedback.json`, `${dateHint}.json`] : [];
  const filesToTry = [...new Set([...preferredFiles, ...candidateFiles])];

  for (const fileName of filesToTry) {
    const data = readRepoJsonFile<FeedbackAnalysis>(
      path.posix.join("data/feedback/analysis", fileName),
    );
    if (data) {
      return {
        fileName,
        data,
      };
    }
  }

  return {
    fileName: null,
    data: null,
  };
}

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\-*]\s*/, "")
    .trim();
}

function normalizeMultilineText(value: string | null | undefined) {
  const raw = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^[\-*]\s*/, "")
    .trim();

  if (!raw) return "";

  const cleaned = raw
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (cleaned.includes("\n")) {
    return cleaned;
  }

  const sentences = splitIntoSentences(cleaned);
  if (sentences.length <= 1) {
    return cleaned.replace(/\s+/g, " ").trim();
  }

  return sentences.join("\n");
}

function normalizeName(value: string | null | undefined) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣]/gi, "");
}

function uniqueStrings(items: Array<string | null | undefined>) {
  return [...new Set(items.map((item) => normalizeText(item)).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightClassName(tone: HighlightSpec["tone"]) {
  if (tone === "negative") {
    return "bg-rose-50/70 text-rose-700 decoration-rose-300/90";
  }
  if (tone === "neutral") {
    return "bg-amber-50/80 text-amber-800 decoration-amber-300/90";
  }
  if (tone === "positive") {
    return "bg-sky-50/80 text-sky-700 decoration-sky-300/90";
  }
  if (tone === "defensive") {
    return "bg-emerald-50/80 text-emerald-700 decoration-emerald-300/90";
  }
  return "bg-slate-100/80 text-slate-700 decoration-slate-300";
}

function highlightToneForToken(token: string): HighlightSpec["tone"] {
  const normalized = normalizeText(token);
  if (
    /유가|원유|달러|환율|금리|변동성|지정학|리스크|하락|매도|축소|과열|되돌림/.test(normalized)
  ) {
    return "negative";
  }
  if (
    /금|안전자산|현금|방어 자산|방어 쿠션|헤지|KOFR|관망|보유|배당\/커버드콜|방산/.test(
      normalized,
    )
  ) {
    return "defensive";
  }
  if (
    /S&P500|나스닥|AI|전력|인프라|코어|장기 복리|원자력|전력기기|구리|실적|수급|정책|수주|공격적/.test(
      normalized,
    )
  ) {
    return "positive";
  }
  if (
    /분할 매수|전술 알파|테마|점검|균형|중립|현금 비중|대기 자금|뉴스 흐름|내러티브|레짐/.test(
      normalized,
    )
  ) {
    return "neutral";
  }
  return "other";
}

function dedupeHighlightSpecs(items: HighlightSpec[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const token = normalizeText(item.token);
    if (!token || token.length < 2 || seen.has(token)) {
      return false;
    }
    seen.add(token);
    return true;
  });
}

function buildInlineHighlightSpecs(
  texts: Array<string | null | undefined>,
  seeds: Array<string | null | undefined> = [],
) {
  const haystack = uniqueStrings(texts).join(" ");
  const matched = INLINE_HIGHLIGHT_LIBRARY.filter((token) => haystack.includes(token));

  return dedupeHighlightSpecs(
    uniqueStrings([...seeds, ...matched]).map((token) => ({
      token,
      tone: highlightToneForToken(token),
    })),
  );
}

function mergeHighlightSpecs(...groups: Array<HighlightSpec[] | null | undefined>) {
  return dedupeHighlightSpecs(
    groups.flatMap((group) => group ?? []),
  );
}

function compactMetaItems(items: Array<string | null | undefined>, limit = 5) {
  return uniqueStrings(items).slice(0, limit);
}

function renderMetaLine(
  items: Array<string | null | undefined>,
  options?: {
    limit?: number;
    tone?: "default" | "subtle";
  },
): ReactNode {
  const tokens = compactMetaItems(items, options?.limit ?? 5);
  if (tokens.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {tokens.map((token, index) => (
        <div key={`${token}-${index}`} className="flex items-center gap-x-2">
          {index > 0 ? <span className="text-slate-300">·</span> : null}
          <span
            className={joinClasses(
              "text-[12.5px] leading-5",
              options?.tone === "subtle" ? "text-slate-500" : "text-slate-600",
            )}
          >
            {token}
          </span>
        </div>
      ))}
    </div>
  );
}

function buildAccountHighlightSpecs(
  account: PortfolioAccount,
  accountGuide: AccountGuide | null,
) {
  const tokens = uniqueStrings([
    "유가 상승",
    "원/달러",
    "지정학 리스크",
    "현금 비중",
    "방어 자산",
    "분할 매수",
    account.key === "ISA" ? "국내 ETF" : null,
    account.key === "ISA" ? "배당/커버드콜" : null,
    account.key === "PENSION" ? "장기 복리" : null,
    account.key === "PENSION" ? "S&P500" : null,
    account.key === "PENSION" ? "나스닥100" : null,
    account.key === "TOSS" ? "전술 알파" : null,
    account.key === "TOSS" ? "전력기기" : null,
    account.key === "KIS_MAIN" ? "방산" : null,
    account.key === "KIS_MAIN" ? "구리" : null,
    ...accountGuide?.assetFocus ?? [],
    ...accountGuide?.candidates ?? [],
  ]);

  return tokens.map((token) => ({
    token,
    tone: highlightToneForToken(token),
  }));
}

function renderHighlightedText(
  text: string | null | undefined,
  highlights: HighlightSpec[],
  options?: {
    multiline?: boolean;
  },
): ReactNode {
  const normalized = options?.multiline
    ? normalizeMultilineText(text)
    : normalizeText(text);
  if (!normalized) return null;

  const tokens = highlights
    .filter((item) => item.token && item.token.length >= 2)
    .sort((left, right) => right.token.length - left.token.length);

  const lines = normalized.split("\n");
  const pattern =
    tokens.length > 0
      ? new RegExp(`(${tokens.map((item) => escapeRegExp(item.token)).join("|")})`, "g")
      : null;
  const tokenMap = new Map(tokens.map((item) => [item.token, item]));

  return lines.flatMap((line, lineIndex) => {
    const parts =
      !pattern || tokens.length === 0
        ? [line]
        : line.split(pattern).map((part, index) => {
            const highlight = tokenMap.get(part);
            if (!highlight) {
              return part;
            }

            return (
              <span
                key={`${lineIndex}-${highlight.token}-${index}`}
                className={joinClasses(
                  "mx-[1px] inline rounded-[0.35rem] px-[0.18em] py-[0.02em] align-baseline text-[0.98em] font-medium underline decoration-2 underline-offset-[0.18em] [box-decoration-break:clone]",
                  highlightClassName(highlight.tone),
                )}
              >
                {highlight.token}
              </span>
            );
          });

    if (lineIndex === 0) {
      return parts;
    }

    return [<br key={`line-break-${lineIndex}`} />, ...parts];
  });
}

function formatMetricCount(value: number | null | undefined, unit: string) {
  if (typeof value !== "number" || Number.isNaN(value)) return "미집계";
  return `${NUMBER_FORMATTER.format(Math.round(value))}${unit}`;
}

function formatMarketVoiceDateTime(value: string | null | undefined) {
  if (!value) return "업데이트 미상";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return MARKETVOICE_DATETIME_FORMATTER.format(parsed);
}

function marketVoiceDirectionLabel(direction: string | null | undefined) {
  if (direction === "positive") return "호재";
  if (direction === "negative") return "경계";
  if (direction === "mixed") return "혼합";
  return "중립";
}

function marketVoiceDirectionClasses(direction: string | null | undefined) {
  if (direction === "positive") {
    return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  if (direction === "negative") {
    return "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
  }
  if (direction === "mixed") {
    return "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20";
  }
  return "bg-slate-900/5 text-slate-600 ring-1 ring-inset ring-slate-200";
}

function briefingMetricToneClasses(
  tone: "brand" | "caution" | "info" | "neutral",
) {
  if (tone === "brand") {
    return "border-sky-200 bg-sky-50/90";
  }
  if (tone === "caution") {
    return "border-amber-200 bg-amber-50/90";
  }
  if (tone === "info") {
    return "border-indigo-200 bg-indigo-50/90";
  }
  return "border-slate-200 bg-white/90";
}

function BriefingMetricCard({
  kicker,
  value,
  detail,
  tone = "neutral",
}: {
  kicker: string;
  value: string;
  detail: string;
  tone?: "brand" | "caution" | "info" | "neutral";
}) {
  return (
    <div
      className={joinClasses(
        "rounded-[1.2rem] border px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]",
        briefingMetricToneClasses(tone),
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {kicker}
      </p>
      <p className="mt-2 text-[1.45rem] font-semibold tracking-tight text-slate-950">{value}</p>
      <p className={joinClasses("mt-2", BODY_NOTE_MUTED_CLASS, "text-slate-500")}>{detail}</p>
    </div>
  );
}

function insightCardToneClasses(tone: "focus" | "risk" | "action") {
  if (tone === "focus") {
    return "border-slate-200 bg-white/95";
  }
  if (tone === "risk") {
    return "border-amber-200 bg-amber-50/85";
  }
  return "border-emerald-200 bg-emerald-50/80";
}

function InsightDigestCard({
  kicker,
  title,
  detail,
  highlights,
  tone,
}: {
  kicker: string;
  title: string;
  detail: string;
  highlights: HighlightSpec[];
  tone: "focus" | "risk" | "action";
}) {
  return (
    <div
      className={joinClasses(
        "rounded-[1.2rem] border px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]",
        insightCardToneClasses(tone),
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {kicker}
      </p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-950">
        {renderHighlightedText(title, highlights)}
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {renderHighlightedText(detail, highlights)}
      </p>
    </div>
  );
}

function splitIntoSentences(content: string | null | undefined) {
  return normalizeText(content)
    .split(/(?<=[.!?。]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function takeSentences(content: string | null | undefined, limit: number) {
  return splitIntoSentences(content).slice(0, limit);
}

function truncateText(value: string | null | undefined, limit = 180) {
  const normalized = normalizeText(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function formatCurrency(value: number | null | undefined) {
  return `${NUMBER_FORMATTER.format(value ?? 0)}원`;
}

function formatSignedCurrency(value: number | null | undefined) {
  const safe = value ?? 0;
  return `${safe > 0 ? "+" : ""}${NUMBER_FORMATTER.format(safe)}원`;
}

function formatPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

function formatSignedPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "미집계";
  return `${Math.round(value)}점`;
}

function formatIndicatorValue(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return MARKET_VALUE_FORMATTER.format(value);
}

function formatDirection(direction: string | null | undefined) {
  if (direction === "positive") return "긍정";
  if (direction === "negative") return "부정";
  if (direction === "mixed") return "혼합";
  if (direction === "buy") return "매수";
  if (direction === "trim") return "축소";
  if (direction === "sell") return "매도";
  if (direction === "hold") return "보유";
  return "관찰";
}

function signalTone(signal: string | null | undefined) {
  const normalized = String(signal ?? "").toUpperCase();
  if (normalized.includes("SELL") || normalized.includes("REDUCE")) {
    return {
      badge: "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20",
      label: signal ?? "SELL",
    };
  }
  if (normalized.includes("BUY")) {
    return {
      badge: "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20",
      label: signal ?? "BUY",
    };
  }
  return {
    badge: "bg-slate-900/5 text-slate-600 ring-1 ring-inset ring-slate-200",
    label: signal ?? "HOLD",
  };
}

function scoreTone(score: number | null | undefined) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "text-slate-500";
  }
  if (score >= 75) return "text-emerald-700";
  if (score >= 55) return "text-amber-700";
  return "text-rose-700";
}

function signedMetricTone(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || value === 0) {
    return "text-slate-950";
  }
  return value > 0 ? "text-rose-700" : "text-sky-700";
}

function buySellBiasTone(bias: "buy" | "sell" | "neutral") {
  if (bias === "buy") return "text-rose-700";
  if (bias === "sell") return "text-sky-700";
  return "text-slate-600";
}

function rsiBias(rsi: number | null | undefined) {
  if (typeof rsi !== "number" || Number.isNaN(rsi)) return "neutral" as const;
  if (rsi >= 55) return "buy" as const;
  if (rsi <= 45) return "sell" as const;
  return "neutral" as const;
}

function macdBias(histogram: number | null | undefined) {
  if (typeof histogram !== "number" || Number.isNaN(histogram)) return "neutral" as const;
  if (histogram > 0) return "buy" as const;
  if (histogram < 0) return "sell" as const;
  return "neutral" as const;
}

function bollingerBias(position: string | null | undefined) {
  if (position === "above_upper" || position === "upper_half") return "buy" as const;
  if (position === "below_lower" || position === "lower_half") return "sell" as const;
  return "neutral" as const;
}

function holdingKind(name: string, category: string | null | undefined) {
  const normalizedName = normalizeText(name);
  if (/^(TIGER|KODEX|HANARO|PLUS)\b/i.test(normalizedName)) {
    if (["S&P500", "나스닥100", "미국인덱스", "배당/커버드콜", "현금파킹"].includes(category ?? "")) {
      return "코어 ETF";
    }
    return "섹터 ETF";
  }
  return "개별주";
}

function findAccountGuide(guide: PortfolioGuide | null, accountKey: string) {
  return guide?.accounts.find((item) => item.key === accountKey) ?? null;
}

function findHoldingGuide(
  accountGuide: AccountGuide | null,
  holding: PortfolioHolding,
) {
  const normalizedName = normalizeName(holding.name);

  return (
    accountGuide?.holdingGuides.find((item) => item.code && item.code === holding.code) ??
    accountGuide?.holdingGuides.find((item) => normalizeName(item.name) === normalizedName) ??
    null
  );
}

function findAccountHoldingByCodeOrName(
  account: PortfolioAccount,
  code: string | null | undefined,
  name: string | null | undefined,
) {
  const normalizedName = normalizeName(name);

  return (
    account.holdings.find((holding) => code && holding.code === code) ??
    account.holdings.find((holding) => normalizeName(holding.name) === normalizedName) ??
    null
  );
}

function findStage3Holding(
  stage3: Stage3Analysis | null,
  accountKey: string,
  holding: PortfolioHolding,
) {
  if (holding.code) {
    const byPosition = stage3?.positions?.[`${accountKey}:${holding.code}`];
    if (byPosition) return byPosition;

    const byHolding = stage3?.holdings?.[holding.code];
    if (byHolding) return byHolding;
  }

  const normalizedName = normalizeName(holding.name);
  const candidates = [
    ...Object.values(stage3?.positions ?? {}),
    ...Object.values(stage3?.holdings ?? {}),
  ].filter((item) => item && item.accountKey === accountKey);

  return (
    candidates.find((item) => normalizeName(item.name) === normalizedName) ??
    null
  );
}

function findCandidateByCodeOrName(
  stage2: Stage2Strategy | null,
  holding: PortfolioHolding,
) {
  const normalizedName = normalizeName(holding.name);
  return (
    stage2?.candidate_scores?.find((item) => item.code && item.code === holding.code) ??
    stage2?.candidate_scores?.find((item) => normalizeName(item.name) === normalizedName) ??
    null
  );
}

function describeBollingerPosition(position: string | null | undefined) {
  if (position === "upper_half") return "볼린저 상단권";
  if (position === "lower_half") return "볼린저 하단권";
  if (position === "above_upper") return "볼린저 상단 돌파 구간";
  if (position === "below_lower") return "볼린저 하단 이탈 구간";
  return "볼린저 중립 구간";
}

function strategicHoldingRole(
  account: PortfolioAccount,
  holding: PortfolioHolding,
  holdingGuide: HoldingGuide | null,
) {
  const categoryLabel = holdingGuide?.category ?? holdingKind(holding.name, holdingGuide?.category);
  const themeKey = executionThemeKey(holding.name, holding.code);

  if (account.key === "ISA") {
    if (themeKey === "gold") return "포트폴리오 흔들림을 완충하는 방어·헤지 포지션";
    if (themeKey === "cash") return "다음 조정 구간을 기다리는 대기 자금 포지션";
    if (themeKey === "sp500" || themeKey === "nasdaq") {
      return "절세 계좌 안에서 장기 베타를 누적하는 코어 성장 포지션";
    }
    if (categoryLabel === "배당/커버드콜") {
      return "세후 현금흐름과 하방 완충을 함께 노리는 인컴 포지션";
    }
    return "절세 계좌 전체 균형을 맞추는 보완 포지션";
  }

  if (account.key === "PENSION") {
    if (themeKey === "cash") return "다음 하락 구간 매수를 위한 대기 자금 겸 완충 포지션";
    if (themeKey === "gold") return "장기 복리 포트폴리오의 변동성을 낮추는 방어 포지션";
    if (themeKey === "sp500" || themeKey === "nasdaq") {
      return "장기 복리의 중심축을 맡는 코어 성장 포지션";
    }
    return "복리 훼손을 줄이면서 누적 매수를 이어 가는 장기 보완 포지션";
  }

  if (account.key === "TOSS") {
    if (themeKey === "gold" || themeKey === "cash") {
      return "테마 실패 구간의 손실을 줄이기 위한 완충 포지션";
    }
    if (themeKey === "power") return "실적 가속 구간을 노리는 공격적 전술 알파 포지션";
    if (themeKey === "nuclear") return "정책·수주 모멘텀에 베팅하는 공격적 테마 포지션";
    if (themeKey === "broad") return "아이디어 공백 구간의 변동성을 낮추는 분산 포지션";
    return "짧은 주기로 설명력 있는 서사에 올라타는 전술 포지션";
  }

  if (themeKey === "defense") {
    return "지정학과 수주 사이클을 실적으로 연결하려는 공격적 실전 포지션";
  }
  if (themeKey === "nuclear") {
    return "전력 부족과 에너지 안보 재평가에 베팅하는 공격적 테마 포지션";
  }
  if (themeKey === "copper") {
    return "AI 인프라와 전력 투자 확대를 실물 가격으로 받는 경기 민감 포지션";
  }
  if (themeKey === "power") {
    return "전력 증설과 설비 투자 확대로 수익을 노리는 공격 성장 포지션";
  }
  if (themeKey === "gold") {
    return "주식 변동성 확대 때 전체 계좌를 완충하는 헤지 포지션";
  }
  if (themeKey === "broad") {
    return "테마 쏠림을 누그러뜨리는 분산 포지션";
  }
  return "현금 기동성과 테마 대응 사이에서 알파를 노리는 실전 포지션";
}

function strategicHoldingWatchline(
  holding: PortfolioHolding,
) {
  const themeKey = executionThemeKey(holding.name, holding.code);

  if (themeKey === "gold") {
    return "금리 경로와 지정학 리스크가 다시 흔들릴 때 방어력이 살아나므로, 공격 포지션의 반대축으로 해석하는 편이 맞습니다.";
  }
  if (themeKey === "cash") {
    return "이 자산은 지금 수익률보다 언제 어떤 종목으로 재배치할지의 판단 기준이 더 중요합니다.";
  }
  if (themeKey === "sp500" || themeKey === "nasdaq") {
    return "하루 뉴스보다 누적 매수와 비중 관리가 성과를 가르므로, 역할이 훼손되지 않았다면 단기 흔들림에 과민할 필요는 없습니다.";
  }
  if (themeKey === "power") {
    return "수주와 CAPEX, 실적 가시성이 확인될 때 가장 강하고 단순 테마 순환만으로 오를 때는 추격보다 검증이 먼저입니다.";
  }
  if (themeKey === "defense") {
    return "헤드라인보다 수주 공시와 납품 일정이 더 중요해서, 이벤트성 급등 구간에서는 추격보다 분할 대응이 유리합니다.";
  }
  if (themeKey === "nuclear") {
    return "정책 발표보다 실제 프로젝트 진척과 수급 결합이 중요해, 기대만 앞설 때는 변동성이 빠르게 커질 수 있습니다.";
  }
  if (themeKey === "copper") {
    return "원자재 가격과 달러 방향을 같이 봐야 하며, 매크로 기대가 꺾이면 탄력도 빠르게 둔화할 수 있습니다.";
  }
  if (themeKey === "broad") {
    return "강한 확신이 없는 구간의 분산 수단으로는 유효하지만, 선명한 아이디어 종목을 대신할 만큼 공격적인 역할은 기대하기 어렵습니다.";
  }
  return "뉴스 흐름만 강한지, 실적·수급·정책 중 무엇이 실제로 따라붙는지를 같이 봐야 포지션의 설명력을 놓치지 않습니다.";
}

function describeHoldingRole(
  account: PortfolioAccount,
  holding: PortfolioHolding,
  holdingGuide: HoldingGuide | null,
) {
  return `${holding.name}은 ${account.label} 안에서 ${strategicHoldingRole(account, holding, holdingGuide)}입니다. ${strategicHoldingWatchline(holding)}`;
}

function buildTechnicalNarrative(
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null,
) {
  if (!technicalItem) {
    return "기술 스냅샷이 충분하지 않아 지금은 가격 구조보다 리포트와 계좌 역할을 더 우선해서 해석해야 합니다.";
  }

  const score = technicalItem.score ?? null;
  const signal = String(technicalItem.signal ?? "").toUpperCase();
  const rsi = technicalItem.rsi ?? null;
  const macdHistogram = technicalItem.macd?.histogram ?? null;
  const bollingerPosition = technicalItem.bollinger?.position ?? null;

  const rsiLabel =
    typeof rsi === "number"
      ? rsi >= 68
        ? `RSI ${rsi.toFixed(1)}로 단기 과열권에 가까워 신규 추격 매수보다는 비중 조절이나 눌림 대기가 더 적절합니다.`
        : rsi >= 58
          ? `RSI ${rsi.toFixed(1)}는 이미 단기 상승이 꽤 진행됐다는 뜻이라, 신규 매수라면 지금 바로 추격하기보다 눌림에서 분할 진입하는 편이 좋습니다.`
          : rsi <= 38
            ? `RSI ${rsi.toFixed(1)}는 과매도에 가까워 반등 시도 구간으로 볼 수 있지만, 실제 반전 확인 전에는 한 번에 크게 들어가기보다 시험 매수에 그치는 편이 안전합니다.`
            : `RSI ${rsi.toFixed(1)}는 중립권이라, RSI만으로 강한 매수·매도 결론을 내리기보다는 다른 지표와 함께 봐야 합니다.`
      : null;
  const macdLabel =
    typeof macdHistogram === "number"
      ? macdHistogram >= 0
        ? "MACD가 플러스라는 뜻은 상승 추세가 아직 완전히 꺾이지 않았다는 의미입니다. 다만 이것만으로 지금 당장 추격 매수하라는 뜻은 아니고, 기존 보유자는 보유 우위, 신규 진입자는 눌림 확인 후 접근 쪽에 가깝습니다."
        : "MACD가 마이너스라는 뜻은 반등이 나와도 아직 하락 추세 안의 되돌림일 수 있다는 의미라, 성급한 신규 매수보다는 추세 복구 확인이 먼저입니다."
      : null;
  const bandLabel =
    bollingerPosition === "above_upper"
      ? "볼린저 상단 돌파는 강한 추세라는 뜻이지만 동시에 단기 과열 구간일 가능성도 큽니다. 이미 보유 중이면 추세를 따라가되, 신규 매수는 시가 추격보다 1~3일 눌림이나 재안착 확인 후 분할 접근이 더 낫습니다."
      : bollingerPosition === "upper_half"
        ? "볼린저 상단권은 힘이 위쪽에 있다는 뜻이지만, 상단에 가까울수록 기대수익보다 단기 흔들림 위험도 함께 커집니다."
        : bollingerPosition === "below_lower"
          ? "볼린저 하단 이탈은 과매도 반등 후보일 수 있지만, 하락 추세가 끝났다는 확인은 아니라서 반등 확인 없는 선매수는 보수적으로 접근해야 합니다."
          : bollingerPosition === "lower_half"
            ? "볼린저 하단권은 아직 매도 압력이 남아 있을 수 있어, 기술 반등만 보고 성급히 비중을 키우는 건 조심하는 편이 좋습니다."
            : null;

  const posture =
    typeof score === "number" && score >= 75
      ? "기술적으로는 추세가 아직 살아 있어 기존 보유자는 우선 보유 쪽이 맞습니다."
      : typeof score === "number" && score >= 55
        ? "기술적으로는 완전한 추세 붕괴는 아니지만, 공격적으로 추격 매수할 정도로 싼 자리는 아닙니다."
        : typeof score === "number"
          ? "기술적으로는 아직 확신보다 확인이 더 필요한 자리라, 신규 진입은 보수적으로 접근하는 편이 좋습니다."
          : "기술 신호는 중립적으로 해석하는 편이 좋습니다.";

  const signalLine =
    signal.includes("SELL") || signal.includes("REDUCE")
      ? "현재 시그널은 반등이 와도 비중 확대보다 방어와 재점검을 우선하라는 쪽에 가깝습니다."
      : signal.includes("BUY")
        ? "현재 시그널은 매수 우위라는 뜻이지만, 이는 '보유 유지 또는 눌림 분할매수 우위'에 가깝고 '지금 가격에서 바로 세게 추격 매수'를 뜻하진 않습니다."
        : "현재 시그널은 보유 또는 관찰 쪽에 더 가깝고, 강한 방향성은 추가 확인이 필요합니다.";

  return uniqueStrings([posture, signalLine, rsiLabel, macdLabel, bandLabel]).join(" ");
}

function buildTechnicalCaution(
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null,
) {
  if (!technicalItem) {
    return "기술 데이터가 비어 있는 종목은 서사만으로 비중을 늘리기보다 실제 가격 반응과 거래 강도를 먼저 확인하는 편이 안전합니다.";
  }

  const rsi = technicalItem.rsi ?? null;
  const macdHistogram = technicalItem.macd?.histogram ?? null;
  const score = technicalItem.score ?? null;

  if (typeof score === "number" && score >= 75) {
    return "기술 점수가 높아도 이미 좋은 흐름이 가격에 반영됐을 수 있습니다. 그래서 신규 자금은 장대 양봉 당일 추격보다, 눌림이 나오거나 상단 돌파 뒤 재안착이 확인될 때 나눠 들어가는 편이 더 낫습니다.";
  }
  if (typeof score === "number" && score <= 45) {
    return "기술 점수가 아직 낮은 편이라 테마 서사가 좋아 보여도 가격 구조가 따라오지 않으면 비중 확대는 성급할 수 있습니다.";
  }
  if (typeof rsi === "number" && rsi >= 62) {
    return "RSI가 60대 이상이면 이미 단기 매수세가 꽤 붙은 상태라, 지금 진입은 기대수익보다 흔들림을 먼저 감수할 수 있습니다. 신규 매수라면 지금 한 번에 사기보다 눌림 때 분할하는 편이 더 합리적입니다.";
  }
  if (typeof rsi === "number" && rsi <= 42) {
    return "RSI가 약한 구간에 머물면 좋은 논리도 실제 매수세가 붙기 전까지는 시간이 더 필요할 수 있습니다.";
  }
  if (typeof macdHistogram === "number" && macdHistogram < 0) {
    return "MACD 히스토그램이 아직 음수면 단기 반등이 나와도 추세 전환으로 단정하지 말고 확인 파동을 한 번 더 보는 편이 좋습니다.";
  }

  return "기술적으로는 중립권이어서, 실적·정책·유가 같은 외부 촉매가 들어올 때 방향성이 더 빠르게 정해질 수 있습니다.";
}

function summarizeImpactReason(reason: string | null | undefined) {
  return truncateText(takeSentences(reason, 1)[0] ?? reason, 145);
}

function buildHoldingChips(params: {
  holdingGuide: HoldingGuide | null;
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null;
  candidate: NonNullable<Stage2Strategy["candidate_scores"]>[number] | null;
  reportCount: number;
  positiveCount: number;
  negativeCount: number;
}) {
  const { holdingGuide, technicalItem, candidate, reportCount, positiveCount, negativeCount } = params;

  return uniqueStrings([
    holdingGuide?.category,
    technicalItem?.signal ? `기술 ${technicalItem.signal}` : null,
    typeof technicalItem?.score === "number"
      ? `기술 ${Math.round(technicalItem.score)}점`
      : null,
    reportCount > 0 ? `리포트 ${reportCount}건` : null,
    positiveCount > 0 ? `긍정 ${positiveCount}건` : null,
    negativeCount > 0 ? `주의 ${negativeCount}건` : null,
    candidate?.stance ? formatDirection(candidate.stance) : null,
  ]).slice(0, 6);
}

function getHoldingActionKind(
  holding: PortfolioHolding,
  accountGuide: AccountGuide | null,
  candidate: NonNullable<Stage2Strategy["candidate_scores"]>[number] | null,
) {
  const inBuys = accountGuide?.executionBuys.some((item) => item.code === holding.code);
  const inTrims = accountGuide?.executionTrims.some((item) => item.code === holding.code);
  const inHolds = accountGuide?.executionHolds.some((item) => item.code === holding.code);

  if (inTrims || candidate?.stance === "trim" || candidate?.stance === "sell") return "매도";
  if (inBuys || candidate?.stance === "buy") return "매수";
  if (inHolds || candidate?.stance === "hold") return "보유";
  return "관망";
}

function getActionHeadline(accountGuide: AccountGuide | null) {
  const buyCount = accountGuide?.executionBuys.length ?? 0;
  const trimCount = accountGuide?.executionTrims.length ?? 0;

  if (buyCount > 0 && trimCount > 0) return "매수 · 매도";
  if (buyCount > 0) return "매수";
  if (trimCount > 0) return "매도";
  if ((accountGuide?.executionHolds.length ?? 0) > 0) return "보유";
  return "관망";
}

function getHoldingImpactContext(
  impactMap: ImpactMap | null,
  accountKey: string,
  holdingGuide: HoldingGuide | null,
) {
  const category = holdingGuide?.category;
  if (!category) return [];

  return (impactMap?.reports ?? [])
    .flatMap((report) =>
      (report.impacts ?? [])
        .filter(
          (impact) =>
            impact.target?.accountKey === accountKey &&
            impact.target?.type === "category" &&
            normalizeText(impact.target?.name) === normalizeText(category),
        )
        .map((impact) => ({
          title: report.title ?? report.reportId ?? "관련 리포트",
          broker: report.broker ?? null,
          direction: impact.direction ?? null,
          strength: impact.strength ?? null,
          horizon: impact.horizon ?? null,
          numbers: impact.evidence?.numbers ?? report.reportMeta?.key_numbers ?? [],
          summary:
            impact.evidence?.snippets?.[0] ??
            null,
        })),
    )
    .slice(0, 3);
}

function buildHoldingSummary(params: {
  account: PortfolioAccount;
  holding: PortfolioHolding;
  holdingGuide: HoldingGuide | null;
  stage3Holding: ReturnType<typeof findStage3Holding>;
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null;
  impactContext: ReturnType<typeof getHoldingImpactContext>;
  candidate: NonNullable<Stage2Strategy["candidate_scores"]>[number] | null;
}): HoldingSummary {
  const { account, holding, holdingGuide, stage3Holding, technicalItem, impactContext, candidate } = params;

  const rawImpacts = [
    ...(stage3Holding?.reportImpacts ?? []).map((item) => ({
      title: item.title ?? "관련 리포트",
      direction: item.direction ?? null,
      strength: item.strength ?? null,
      horizon: null as string | null,
      summary: item.reason ?? null,
    })),
    ...impactContext.map((item) => ({
      title: item.title,
      direction: item.direction,
      strength: item.strength,
      horizon: item.horizon,
      summary: item.summary,
    })),
  ];

  const seenImpactKeys = new Set<string>();
  const impacts = rawImpacts
    .filter((item) => {
      const key = `${normalizeText(item.title)}::${normalizeText(item.direction)}::${normalizeText(item.summary)}`;
      if (seenImpactKeys.has(key)) return false;
      seenImpactKeys.add(key);
      return true;
    })
    .sort((left, right) => (right.strength ?? 0) - (left.strength ?? 0));

  const positiveImpacts = impacts.filter((item) => item.direction === "positive" || item.direction === "buy");
  const negativeImpacts = impacts.filter(
    (item) => item.direction === "negative" || item.direction === "sell" || item.direction === "trim",
  );
  const topPositive = positiveImpacts[0] ?? null;
  const topNegative = negativeImpacts[0] ?? null;
  const roleSentence = describeHoldingRole(account, holding, holdingGuide);
  const categoryLabel = holdingGuide?.category ?? holdingKind(holding.name, holdingGuide?.category);

  const reportSentence =
    impacts.length === 0
      ? `${categoryLabel} 관련 리포트 근거가 아직 두껍지 않아, 이 종목은 포지션 역할과 기술 신호를 더 우선해서 해석해야 합니다.`
      : positiveImpacts.length > negativeImpacts.length && topPositive
        ? `연결된 리포트 ${impacts.length}건 중 긍정 해석이 ${positiveImpacts.length}건으로 더 우세합니다. 특히 ${topPositive.title}에서는 ${summarizeImpactReason(topPositive.summary)}로 읽혀 현재 서사가 아직 살아 있다는 쪽에 무게가 실립니다.`
        : negativeImpacts.length > positiveImpacts.length && topNegative
          ? `연결된 리포트 ${impacts.length}건 중 부정 해석이 ${negativeImpacts.length}건으로 더 많습니다. 특히 ${topNegative.title}는 ${summarizeImpactReason(topNegative.summary)}를 지적해, 지금은 비중 확대보다 방어적 해석이 더 맞는 구간으로 보입니다.`
          : `리포트는 ${impacts.length}건 연결되어 있지만 긍정 ${positiveImpacts.length}건과 부정 ${negativeImpacts.length}건이 같이 존재합니다. 즉 이 종목은 테마 자체보다 실제 실적·정책 가시성이 어디까지 확인되는지가 더 중요해진 상태입니다.`;

  const technicalSentence = buildTechnicalNarrative(technicalItem);
  const candidateSentence = candidate?.thesis
    ? `현재 전략 초안에서는 ${truncateText(candidate.thesis, 150)}${
        candidate.horizon ? ` 바라보는 시계는 ${candidate.horizon}입니다.` : ""
      }`
    : null;

  const cautionReason =
    topNegative != null
      ? `${topNegative.title} 쪽에서는 ${summarizeImpactReason(topNegative.summary)}가 경고 포인트로 남아 있습니다. 휴전이나 정책 뉴스만으로 낙관이 과도하게 반영되면 되돌림이 나올 수 있습니다.`
      : uniqueStrings([
            ...(holdingGuide?.warnings ?? []),
            ...(stage3Holding?.explain?.warnings ?? []),
            ...(candidate?.risks ?? []),
          ])
          .map((item) => truncateText(item, 165))
          .find(Boolean) ?? null;

  const accountDiscipline =
    account.key === "ISA"
      ? "ISA에서는 절세 계좌의 완충 역할이 더 중요하므로, 단일 테마가 계좌 균형을 흔들 정도로 비중이 커지지 않게 관리해야 합니다."
      : account.key === "PENSION"
        ? "연금저축은 회전보다 누적이 핵심이라, 단기 노이즈만으로 잦은 매매를 늘리기보다 코어 자산으로서의 역할이 유지되는지부터 확인하는 편이 좋습니다."
        : "전술 계좌 성격이 강한 포지션이라 설명력이 약해지는 순간 빠르게 축소 또는 교체 판단으로 넘어갈 준비가 필요합니다.";

  const insights = uniqueStrings([
    roleSentence,
    reportSentence,
    technicalSentence,
    candidateSentence,
  ]).slice(0, 3);

  const cautions = uniqueStrings([
    cautionReason,
    buildTechnicalCaution(technicalItem),
    impacts.length === 0
      ? "직접 연결된 리포트가 적은 종목은 같은 테마 내 강한 대안이 생기면 우선순위가 빠르게 밀릴 수 있습니다."
      : null,
    accountDiscipline,
  ]).slice(0, 3);

  return {
    insights,
    cautions,
    chips: buildHoldingChips({
      holdingGuide,
      technicalItem,
      candidate,
      reportCount: impacts.length,
      positiveCount: positiveImpacts.length,
      negativeCount: negativeImpacts.length,
    }),
    reportCount: impacts.length,
    positiveCount: positiveImpacts.length,
    negativeCount: negativeImpacts.length,
  };
}

function buildTechnicalHighlightSeeds(
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null,
) {
  const alerts = technicalItem?.alerts ?? [];
  return uniqueStrings([
    alerts.some((alert) => alert.includes("골든크로스")) ? "골든크로스" : null,
    alerts.some((alert) => alert.includes("MACD")) ? "MACD" : null,
    alerts.some((alert) => alert.includes("RSI")) ? "RSI" : null,
    alerts.some((alert) => alert.includes("볼린저")) ? "볼린저" : null,
  ]);
}

function buildHoldingHighlightSpecs(params: {
  accountHighlights: HighlightSpec[];
  holding: PortfolioHolding;
  holdingGuide: HoldingGuide | null;
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null;
  summary: HoldingSummary;
}) {
  const { accountHighlights, holding, holdingGuide, technicalItem, summary } = params;

  return mergeHighlightSpecs(
    accountHighlights,
    buildInlineHighlightSpecs(
      [...summary.insights, ...summary.cautions, technicalItem?.signal_reason],
      [
        holding.name,
        holding.code,
        holdingGuide?.category,
        holdingKind(holding.name, holdingGuide?.category),
        ...summary.chips,
        ...buildTechnicalHighlightSeeds(technicalItem),
      ],
    ),
  );
}

function buildAccountInsightLines(
  account: PortfolioAccount,
  accountGuide: AccountGuide | null,
  stage2: Stage2Strategy | null,
  strategySentences: string[],
) {
  const accountAction = stage2?.account_actions?.find((item) => item.account_key === account.key);
  const accountRationale = takeSentences(accountAction?.rationale, 1)[0] ?? null;
  const cashPct =
    typeof accountGuide?.cashPct === "number"
      ? formatPercent(accountGuide.cashPct * 100, 1)
      : null;
  const topGap = (accountGuide?.categories ?? [])
    .filter((item) => item.category !== "현금파킹" && item.gapPct > 0.03)
    .sort((left, right) => right.gapAmount - left.gapAmount)[0];
  const topOverweight = (accountGuide?.categories ?? [])
    .filter((item) => item.category !== "현금파킹" && item.gapPct < -0.03)
    .sort((left, right) => left.gapPct - right.gapPct)[0];
  const firstBuy = accountGuide?.executionBuys[0] ?? null;
  const firstTrim = accountGuide?.executionTrims[0] ?? null;
  const riskNotes = uniqueStrings(accountGuide?.riskNotes ?? []).slice(0, 2);
  const actionPoints = uniqueStrings(accountGuide?.actionPoints ?? []).slice(0, 2);

  if (account.key === "ISA") {
    return uniqueStrings([
      `ISA는 이번 구간에서 수익 추격 계좌가 아니라 절세형 완충 계좌로 봐야 합니다. ${cashPct ? `현재 현금 비중 ${cashPct}를 활용해` : "지금은"} 미국 지수 추가 베팅보다 금·배당·현금 쿠션의 균형을 먼저 맞추는 편이 적절합니다.`,
      topGap
        ? `지금 가장 비어 있는 축은 ${topGap.category}이며, ${formatCurrency(Math.max(topGap.gapAmount, 0))} 정도의 보강 여지가 남아 있습니다. 그래서 ${firstBuy?.name ?? topGap.preferredLabel ?? topGap.category} 매수는 공격 포지션이 아니라 휴전 실패, 유가 재상승, 달러 강세에 대비하는 헤지 성격이 더 강합니다.`
        : accountGuide?.actionLine,
      topOverweight
        ? `${topOverweight.category} 쪽 비중은 이미 계좌 내 존재감이 크므로, 지금은 그 축을 더 늘리기보다 방어 자산을 채워 변동성을 상쇄하는 구조가 좋습니다.`
        : "배당/커버드콜과 미국 지수 노출은 유지하되, 새 자금은 같은 성격의 자산을 더 사는 것보다 반대 성격의 쿠션을 만드는 쪽이 효율적입니다.",
      accountRationale,
      ...riskNotes,
      ...actionPoints,
      accountAction?.reserve_cash_note,
    ]).slice(0, 4);
  }

  if (account.key === "PENSION") {
    return uniqueStrings([
      `연금저축은 이번 달의 수익률보다 3~6개월 누적 매수 속도를 설계하는 계좌입니다. 그래서 단기 위험 선호가 회복돼도 전술 테마보다 S&P500과 나스닥100 같은 코어 자산 복원이 우선입니다.`,
      topGap
        ? `배분상 가장 부족한 축은 ${topGap.category}이며, ${firstBuy?.name ?? topGap.preferredLabel ?? topGap.category}을 ${formatCurrency(Math.max(topGap.gapAmount, 0))} 범위 안에서 여러 번 나눠 담는 접근이 연금 계좌 성격에 더 잘 맞습니다.`
        : accountGuide?.actionLine,
      `KOFR 같은 현금성 자산은 수익 극대화용이 아니라 변동성 완충 장치입니다.${cashPct ? ` 현재 현금 비중 ${cashPct}` : ""}를 한 번에 다 쓰기보다, 유가·달러 재상승 시 코어 지수 매수 속도를 조절하는 밸브로 남겨 두는 편이 좋습니다.`,
      accountRationale,
      riskNotes[0] ?? "리스크 패널티가 과도하지 않아 무리한 교체보다 코어 자산을 꾸준히 누적하는 쪽이 더 중요합니다.",
    ]).slice(0, 4);
  }

  if (account.key === "TOSS") {
    return uniqueStrings([
      "토스증권은 지금 '무엇을 더 많이 살까'보다 '설명력이 약한 포지션을 줄이고 전력·원자력처럼 서사가 선명한 축으로 얼마나 압축할까'가 핵심입니다.",
      topGap
        ? `현재 가장 비어 있는 축은 ${topGap.category}이고, ${firstBuy?.name ?? topGap.preferredLabel ?? topGap.category} 쪽이 AI 인프라와 물리적 설비 투자 흐름을 직접 받는 후보입니다. 다만 전술 계좌라서 후보 수를 늘리는 것보다 확신 높은 축에만 예산을 몰아주는 편이 낫습니다.`
        : accountGuide?.actionLine,
      firstTrim
        ? `${firstTrim.name}처럼 현재 레짐에서 우위 서사가 약한 노출은 줄이고, 그 자금을 실물 인프라 테마로 돌리는 리밸런싱이 더 생산적입니다.`
        : "현재 레짐에서는 broad한 분산 노출보다 물리 인프라와 에너지 안보처럼 주도 서사가 분명한 테마만 남기는 편이 효율적입니다.",
      accountRationale,
      riskNotes[0] ??
        "고변동 계좌 특성상 맞는 테마를 잡아도 변동폭이 커서, 신규 매수는 반드시 분할로 접근하고 근거가 약해지면 빠르게 정리할 준비가 필요합니다.",
    ]).slice(0, 4);
  }

  return uniqueStrings([
    "한투 일반은 현금 기동성과 테마 대응을 동시에 쓰는 실전 계좌라, 지금은 어떤 테마를 살 것인지보다 어떤 테마에만 집중할 것인지가 더 중요합니다.",
    topGap
      ? `배분상 가장 비어 있는 축은 ${topGap.category}이고, ${firstBuy?.name ?? topGap.preferredLabel ?? topGap.category} 같은 후보는 지정학 헤지와 실적 모멘텀을 같이 기대할 수 있어 우선순위가 높습니다.`
      : accountGuide?.actionLine,
    topOverweight
      ? `${topOverweight.category}처럼 이미 비중이 커진 축은 추가 확대보다 관리 구간으로 보고, 남은 현금은 다음 이벤트에 반응할 수 있게 남겨 두는 편이 낫습니다.`
      : "방산·원자력·구리 같은 실물 자산 노출은 유지할 수 있지만, 뉴스만 강하고 가격 구조가 약한 종목까지 같이 들고 가는 것은 비효율적일 수 있습니다.",
    accountRationale,
    riskNotes[0] ??
      "이 계좌는 수익 기회도 크지만 쏠림과 변동성 패널티도 빨리 쌓이므로, 신규 자금은 이벤트와 내러티브가 같이 있는 종목에만 집중하는 쪽이 좋습니다.",
    ...strategySentences.slice(0, 1),
  ]).slice(0, 4);
}

function executionThemeKey(name: string | null | undefined, code: string | null | undefined) {
  const normalized = `${normalizeText(name)} ${code ?? ""}`.toLowerCase();
  if (/골드|금선물|132030/.test(normalized)) return "gold";
  if (/s&p500|sp500|360750/.test(normalized)) return "sp500";
  if (/나스닥|133690/.test(normalized)) return "nasdaq";
  if (/kofr|금리액티브|423160/.test(normalized)) return "cash";
  if (/효성중공업|ai전력|전력기기|487240|298040/.test(normalized)) return "power";
  if (/항공우주|방산|449450|047810/.test(normalized)) return "defense";
  if (/원자력|434730/.test(normalized)) return "nuclear";
  if (/구리|138910/.test(normalized)) return "copper";
  if (/esg|선진국|251350/.test(normalized)) return "broad";
  return "other";
}

function executionThemeHighlightTokens(theme: ReturnType<typeof executionThemeKey>) {
  switch (theme) {
    case "gold":
      return ["금", "헤지", "방어 자산"];
    case "sp500":
      return ["S&P500", "코어 자산", "분할 매수"];
    case "nasdaq":
      return ["나스닥", "AI", "코어 자산"];
    case "cash":
      return ["KOFR", "현금", "대기 자금"];
    case "power":
      return ["AI 인프라", "전력 인프라", "전력", "수주"];
    case "defense":
      return ["방산", "헤지", "지정학 리스크"];
    case "nuclear":
      return ["원자력", "에너지 안보", "전력"];
    case "copper":
      return ["구리", "실물 자산"];
    case "broad":
      return ["균형", "코어 자산"];
    default:
      return [];
  }
}

function buildExecutionHighlightSpecs(params: {
  account: PortfolioAccount;
  item: ExecutionGuideItem;
  narrative: string;
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null;
  holdingSummary?: HoldingSummary | null;
}) {
  const { account, item, narrative, technicalItem, holdingSummary } = params;
  const theme = executionThemeKey(item.name, item.code);

  return buildInlineHighlightSpecs(
    [narrative, item.reason, technicalItem?.signal_reason],
    [
      account.label,
      item.name,
      item.code,
      ...executionThemeHighlightTokens(theme),
      ...(holdingSummary?.chips ?? []),
      ...buildTechnicalHighlightSeeds(technicalItem),
    ],
  );
}

function buildExecutionTechnicalCue(
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null,
) {
  if (!technicalItem) return null;

  const signal = String(technicalItem.signal ?? "").toUpperCase();
  const score = technicalItem.score ?? null;
  const alerts = technicalItem.alerts ?? [];
  const rsi = technicalItem.rsi ?? null;
  const bollingerPosition = technicalItem.bollinger?.position ?? null;
  const macdHistogram = technicalItem.macd?.histogram ?? null;

  if (alerts.includes("골든크로스(5일/20일) 발생")) {
    return "기술적으로는 5일선과 20일선 골든크로스가 확인돼, 눌림 이후 다시 방향을 잡는 초기 구간으로 해석할 여지가 있습니다.";
  }
  if (alerts.includes("MACD 시그널 상향 돌파")) {
    return "기술적으로는 MACD 시그널 상향 돌파가 확인돼, 모멘텀이 다시 살아나는 초입인지 볼 타이밍입니다.";
  }
  if (
    typeof rsi === "number" &&
    rsi >= 58 &&
    typeof macdHistogram === "number" &&
    macdHistogram >= 0 &&
    (bollingerPosition === "upper_half" || bollingerPosition === "above_upper")
  ) {
    return "지금은 '상승 추세는 살아 있지만 이미 위쪽에서 달리는 자리'에 가깝습니다. 기존 보유자는 보유 우위지만, 신규 매수는 바로 추격하기보다 눌림이 나올 때 1차만 나눠 담고 나머지는 재돌파 확인 후 접근하는 편이 좋습니다.";
  }
  if (signal.includes("SELL") || (typeof score === "number" && score <= 25)) {
    return "기술적으로는 20일선 아래이거나 모멘텀이 약해, 서사만 좋다고 바로 비중을 늘릴 구간은 아닙니다.";
  }
  if (signal.includes("STRONG_BUY") && typeof score === "number" && score >= 85) {
    return "기술 점수가 높은 편이라 추세 자체는 아직 살아 있습니다. 다만 강한 종목일수록 추격보다 분할 접근이 더 안전합니다.";
  }
  return null;
}

function buildExecutionNarrative(params: {
  account: PortfolioAccount;
  item: ExecutionGuideItem;
  kind: ExecutionGuideItem["kind"];
  technicalItem: NonNullable<TechnicalSnapshot["scores"]>[string] | null;
  holdingSummary?: HoldingSummary | null;
}) {
  const { account, item, kind, technicalItem, holdingSummary } = params;
  const theme = executionThemeKey(item.name, item.code);
  const holdingNames = account.holdings.map((holding) => holding.name);
  const companionCore =
    holdingNames.find((name) => /S&P500|나스닥/.test(name)) ?? "미국 지수";

  let thesisLine: string | null = null;
  let monitorLine: string | null = null;
  if (kind === "buy") {
    if (theme === "gold") {
      thesisLine = `${item.name} 매수는 중동 휴전 실패나 호르무즈 리스크 재확대 시 주식시장 하락을 완충하기 위한 헤지 성격입니다. 특히 이 계좌의 ${companionCore} 노출과 반대 성격의 방어 쿠션을 만드는 목적이 더 큽니다.`;
      monitorLine =
        "확인할 변수는 휴전 유지 여부, 원유가격 재상승, 달러 강세 지속입니다. 이 셋이 다시 살아나면 금 비중 확대 논리가 더 강해지고, 반대로 긴장이 빠르게 진정되면 매수 속도는 조금 늦춰도 됩니다.";
    } else if (theme === "sp500") {
      thesisLine = `${item.name}은 휴전 연장과 위험 선호 회복이 이어질 때 가장 먼저 받는 코어 자산입니다. ${account.label}에서는 단기 승부보다 장기 누적 복리용 매수로 접근하는 편이 맞습니다.`;
      monitorLine =
        "다만 유가 급등과 장기금리 재상승이 같이 나오면 지수 반등 탄력이 약해질 수 있어, 한 번에 크게 사기보다 며칠 간 분할로 접근하는 편이 좋습니다.";
    } else if (theme === "nasdaq") {
      thesisLine = `${item.name}은 AI 사이클 수혜를 직접 받는 성장 축이지만 변동성도 큽니다. 따라서 코어 계좌에서는 비중 확대 자체보다 매수 속도 조절이 더 중요합니다.`;
      monitorLine =
        "나스닥은 장기금리와 위험 선호에 민감하므로, 금리 재상승이나 대형 기술주 과열 신호가 강해지면 추격 매수는 늦추는 편이 맞습니다.";
    } else if (theme === "cash") {
      thesisLine = `${item.name}은 공격 자산이 아니라 대기 자금과 방어 완충을 위한 포지션입니다. 시장 방향이 아직 덜 명확할 때 현금을 그냥 두는 것보다 다음 매수 타이밍을 준비하는 용도로 의미가 있습니다.`;
      monitorLine =
        "다음 코어 매수 후보가 선명해질 때까지 이 자금은 속도 조절 밸브 역할을 맡고, 변동성이 다시 커지면 현금성 포지션의 가치가 더 높아집니다.";
    } else if (theme === "power") {
      thesisLine = `${item.name}은 AI 데이터센터와 전력 인프라 투자 확대를 직접 받는 축이라, 지금 레짐에서 가장 설명력이 선명한 후보 중 하나입니다. 단순 테마성 기대보다 실제 설비 투자와 수주 흐름에 연결되는 점이 강점입니다.`;
      monitorLine =
        "체크포인트는 실제 수주, 전력 설비 발주, 정책 드라이브입니다. 뉴스 헤드라인만 강하고 실적 연결이 약해지면 추격 강도는 낮추는 편이 좋습니다.";
    } else if (theme === "defense") {
      thesisLine = `${item.name} 매수는 지정학 리스크가 장기화될 때 포트폴리오를 헷지하는 의미와, 방산 수주 모멘텀을 동시에 노리는 대응입니다. 뉴스가 나쁠수록 상대적으로 방어력이 생기는 자산군이라는 점이 핵심입니다.`;
      monitorLine =
        "휴전이 안정적으로 자리잡아 지정학 프리미엄이 빠질 때는 속도를 늦추고, 수주·정책 이벤트가 이어질 때만 비중 확대를 이어가는 편이 좋습니다.";
    } else if (theme === "nuclear") {
      thesisLine = `${item.name}은 에너지 안보와 전력 수요 증가를 동시에 반영하는 테마입니다. 특히 AI 전력 수요가 커질수록 원자력 서사가 다시 강화될 수 있어 중기 후보로 볼 만합니다.`;
      monitorLine =
        "정책 가시성, 전력 수요 뉴스, 원전 관련 프로젝트 일정이 이어지는지 확인해야 하고, 그 연결고리가 약해지면 기대만으로 오래 끌고 가지 않는 편이 좋습니다.";
    } else {
      thesisLine =
        item.reason ??
        `${item.name}은 현재 계좌 전략에서 우선순위가 올라온 후보입니다. 다만 매수는 서사보다 실제 가격 반응과 자금 배분 순서를 함께 확인하면서 접근하는 편이 좋습니다.`;
      monitorLine =
        "추가 진입 전에는 서사가 실제 실적·수급·정책으로 이어지는지 한 번 더 확인하는 편이 안전합니다.";
    }
  } else if (kind === "trim") {
    if (theme === "broad") {
      thesisLine = `${item.name}은 broad한 선진국 분산 노출이라는 장점은 있지만, 지금처럼 물리 인프라와 지정학 헤지 테마가 우위인 장에서는 상대적으로 존재감이 약합니다. 따라서 이 자금은 더 선명한 테마로 재배치하는 쪽이 효율적입니다.`;
      monitorLine =
        "지금 줄이는 이유는 자산 자체가 나빠서라기보다 우선순위가 밀렸기 때문입니다. 이후 다시 광범위한 지수 장세가 열리면 재편입 여지는 남겨 두는 편이 좋습니다.";
    } else {
      thesisLine =
        holdingSummary?.cautions[0] ??
        `${item.name}은 현재 레짐 대비 우위 논리가 약해져 비중 축소 후보로 보는 편이 맞습니다. 좋은 자산이라도 지금 장세에서 후순위면 먼저 줄이는 판단이 필요합니다.`;
      monitorLine =
        holdingSummary?.cautions[1] ??
        "핵심 논리가 약해질 때는 미련 없이 비중을 낮추고, 줄인 자금은 더 설명력 높은 테마나 방어 자산으로 돌리는 편이 효율적입니다.";
    }
  } else {
    thesisLine =
      holdingSummary?.insights[0] ??
      `${item.name}은 당장 사고파는 대상이라기보다 현재 논리가 유지되는지 확인하면서 들고 가는 포지션입니다. 서사가 살아 있는 동안은 유지하되, 추가 매수까지 바로 연결할 필요는 없습니다.`;
    monitorLine =
      holdingSummary?.cautions[1] ??
      "지금은 보유 논리가 살아 있지만, 다음 실적·정책 이벤트나 추세 훼손 신호가 나오면 그때 매수 확대 대신 재판단으로 넘어가는 편이 좋습니다.";
  }

  const technicalCue = buildExecutionTechnicalCue(technicalItem);
  const disciplineLine =
    kind === "buy"
      ? `${account.label}에서는 ${item.suggestedAmount ? `${formatCurrency(item.suggestedAmount)} 한도를 한 번에 다 쓰기보다` : "한 번에 다 넣기보다"} 분할 접근으로 진입 가격을 나누는 편이 좋습니다.`
      : kind === "trim"
        ? "비중 축소는 손절 개념보다는 우선순위 교체에 가깝게 접근하고, 줄인 자금은 더 선명한 테마나 방어 자산으로 재배치하는 편이 낫습니다."
        : holdingSummary?.cautions[0] ??
          "보유는 유지하되, 기술적으로 과열 신호가 강해지거나 반대로 서사가 약해질 때만 추가 판단으로 넘어가는 편이 좋습니다.";

  return uniqueStrings([thesisLine, technicalCue, monitorLine, disciplineLine]).join(" ");
}

function buildAccountKeywords(
  accountGuide: AccountGuide | null,
  allTags: string[],
) {
  return uniqueStrings([
    ...accountGuide?.assetFocus ?? [],
    ...accountGuide?.candidates ?? [],
    ...allTags,
  ]).slice(0, 8);
}

function buildAccountStory(
  account: PortfolioAccount,
  accountGuide: AccountGuide | null,
): AccountStory {
  const highlights = buildAccountHighlightSpecs(account, accountGuide);
  const cashPct =
    typeof accountGuide?.cashPct === "number"
      ? formatPercent(accountGuide.cashPct * 100, 1)
      : null;
  const focusList = uniqueStrings(accountGuide?.assetFocus ?? []).slice(0, 3);
  const focusText = focusList.length > 0 ? joinNaturalList(focusList) : "핵심 자산군";
  const macroDrivers = uniqueStrings(accountGuide?.macroDrivers ?? []).slice(0, 2);
  const improvement = accountGuide?.improvementActions?.[0] ?? null;
  const reserveNote = accountGuide?.executionReserveNote ?? null;
  const actionLine = accountGuide?.actionLine ?? null;
  const candidate = accountGuide?.executionBuys?.[0]?.name ?? accountGuide?.candidates?.[0] ?? null;

  if (account.key === "ISA") {
    return {
      highlights,
      paragraphs: [
        "ISA는 지금 지정학 리스크와 유가 상승이 다시 가격 변수로 작동할 수 있는 구간이라, 단기 반등을 추격하기보다 방어 자산과 원자재 헤지를 먼저 점검해야 하는 계좌입니다.",
        `이 계좌의 본래 역할은 절세 혜택을 활용해 국내 ETF 중심으로 금, 배당/커버드콜, 현금 비중을 유연하게 조절하며 전체 포트폴리오의 완충재가 되는 것입니다.${cashPct ? ` 현재 현금 비중 ${cashPct}는 그 완충 역할을 수행할 여지를 남겨둔 상태입니다.` : ""}`,
        `${actionLine ?? "이번 레짐에서는 방어 자산을 먼저 채우고 이후 인컴 자산을 점검하는 순서가 더 적절합니다."}${reserveNote ? ` ${reserveNote}` : ""}`,
      ],
      cards: [
        {
          title: "계좌 역할",
          body: "세제 효율을 살리면서 국내 ETF 중심의 방어·인컴·원자재 헤지를 유연하게 배치하는 완충 계좌입니다.",
          tone: "defensive",
        },
        {
          title: "지금 중요 변수",
          body:
            macroDrivers[0] ??
            `현재는 ${focusText}의 비중 조정이 우선이며, 유가와 원/달러의 잔존 압력을 함께 봐야 합니다.`,
          tone: "negative",
        },
        {
          title: "운용 원칙",
          body:
            improvement ??
            `추격 매수보다 ${candidate ?? "방어 자산"}을 먼저 채우고, 이후 배당/인컴 노출을 세제 관점에서 다시 맞추는 편이 좋습니다.`,
          tone: "defensive",
        },
      ],
    };
  }

  if (account.key === "PENSION") {
    return {
      highlights,
      paragraphs: [
        "연금저축은 단기 뉴스 대응보다 장기 복리를 우선하는 코어 계좌라, 현재 횡보 레짐에서는 미국 핵심 지수를 꾸준히 쌓되 방어 자산과의 균형을 함께 유지하는 것이 중요합니다.",
        `이 계좌는 S&P500과 나스닥100을 중심으로 장기 복리의 기반을 만드는 곳이므로, 전술 테마보다 코어 자산의 비중 복원이 먼저입니다.${cashPct ? ` 현금 비중 ${cashPct}는 분할 매수 속도를 조절할 수 있는 여유 자금으로 해석하는 편이 맞습니다.` : ""}`,
        `${actionLine ?? "급한 회전보다 미국 코어 자산을 분할로 보강하고, 금리·달러 부담이 커질 때만 방어 비중을 미세 조정하는 편이 좋습니다."}${reserveNote ? ` ${reserveNote}` : ""}`,
      ],
      cards: [
        {
          title: "계좌 역할",
          body: "미국 코어 인덱스를 중심으로 장기 복리를 축적하는 핵심 축입니다. 전술 알파보다 유지력과 누적이 더 중요합니다.",
          tone: "positive",
        },
        {
          title: "지금 중요 변수",
          body:
            macroDrivers[0] ??
            "S&P500, 나스닥100, 금리/달러 부담의 균형이 핵심입니다. 코어 자산을 늘리되 방어 쿠션이 사라지지 않게 봐야 합니다.",
          tone: "neutral",
        },
        {
          title: "운용 원칙",
          body:
            improvement ??
            `이번 구간에서는 ${candidate ?? "S&P500"}처럼 코어 성격이 강한 자산부터 분할로 누적하고, 현금은 완충 장치로 일부 남겨두는 접근이 적절합니다.`,
          tone: "positive",
        },
      ],
    };
  }

  if (account.key === "TOSS") {
    return {
      highlights,
      paragraphs: [
        "토스증권은 전체 포트폴리오 안에서 전술 알파를 노리는 계좌라, 지금처럼 횡보 레짐과 지정학 변수가 섞인 장세에서는 무엇을 넓게 담을지보다 어떤 테마에만 집중할지가 더 중요합니다.",
        `이 계좌는 전력기기, 원자력, 테마 ETF 같은 고베타 노출을 담당하므로, 설명력이 약한 보유를 늘리는 것보다 실물 수요가 보이는 축에 자금을 집중하는 쪽이 효율적입니다.${cashPct ? ` 현금 비중 ${cashPct}는 다음 전술 진입을 위한 기동 자금으로 볼 수 있습니다.` : ""}`,
        `${actionLine ?? "따라서 TOSS에서는 AI 인프라와 전력 인프라처럼 실물 수요가 확인되는 축을 우선 보고, 근거가 약한 보유는 빠르게 재점검해야 합니다."}${reserveNote ? ` ${reserveNote}` : ""}`,
      ],
      cards: [
        {
          title: "계좌 역할",
          body: "전술 알파를 추구하는 실험 계좌입니다. 확신 높은 테마만 빠르게 반영하고, 약한 테마는 오래 끌지 않는 편이 맞습니다.",
          tone: "positive",
        },
        {
          title: "지금 중요 변수",
          body:
            macroDrivers[0] ??
            `현재는 ${focusText}처럼 실물 인프라 성격이 있는 테마의 지속성을 먼저 확인해야 합니다.`,
          tone: "positive",
        },
        {
          title: "운용 원칙",
          body:
            improvement ??
            `신규 자금은 ${candidate ?? "전력기기"}처럼 설명력이 강한 축에 우선 배치하고, 성격이 애매한 보유는 비중을 더 키우지 않는 편이 좋습니다.`,
          tone: "neutral",
        },
      ],
    };
  }

  return {
    highlights,
    paragraphs: [
      "한투 일반은 현금 기동성과 테마 대응을 동시에 가져가는 실전 계좌라, 지금은 방산, 원자력, 구리 같은 실물 자산 축을 어떤 비율로 배합할지가 중요합니다.",
      `이 계좌는 이벤트에 민감한 자산으로 추가 수익을 노릴 수 있지만, 그만큼 뉴스 흐름에 흔들리기 쉬워 강한 내러티브와 실제 수급·실적 근거가 같이 있는 종목만 남기는 편이 좋습니다.${cashPct ? ` 현재 현금 비중 ${cashPct}는 다음 기회를 위한 대기 자금으로도 의미가 있습니다.` : ""}`,
      `${actionLine ?? "따라서 방산과 원자재 노출은 유지하되, 매수는 이벤트와 레짐이 맞는 축에만 집중하고 현금은 일부 남겨두는 구조가 적절합니다."}${reserveNote ? ` ${reserveNote}` : ""}`,
    ],
    cards: [
      {
        title: "계좌 역할",
        body: "현금 기동성과 테마 대응을 동시에 가져가는 공격적 실전 계좌입니다. 빠른 실행력은 장점이지만 선별 기준이 더 엄격해야 합니다.",
        tone: "positive",
      },
      {
        title: "지금 중요 변수",
        body:
          macroDrivers[0] ??
          `현재는 ${focusText}의 상대 강도와 뉴스 흐름의 지속성을 함께 보면서 대응해야 합니다.`,
        tone: "neutral",
      },
      {
        title: "운용 원칙",
        body:
          improvement ??
          `신규 자금은 ${candidate ?? "방산"}처럼 이벤트와 내러티브가 같이 있는 축에만 집중하고, 나머지 현금은 다음 기회를 위해 남겨 두는 편이 좋습니다.`,
        tone: "positive",
      },
    ],
  };
}

function buildScoreItems(accountGuide: AccountGuide | null) {
  return [
    { label: "총점", value: formatScore(accountGuide?.score) },
    { label: "배분", value: formatScore(accountGuide?.allocationScore) },
    { label: "기술", value: formatScore(accountGuide?.technicalScore) },
    { label: "리포트", value: formatScore(accountGuide?.reportScore) },
    { label: "리포트 커버리지", value: formatScore(accountGuide?.reportCoverageScore) },
    { label: "레짐 적합", value: formatScore(accountGuide?.regimeFitScore) },
    {
      label: "리스크 패널티",
      value:
        typeof accountGuide?.riskPenaltyTotal === "number"
          ? `${accountGuide.riskPenaltyTotal.toFixed(1)}점`
          : "미집계",
    },
  ];
}

function marketSummaryLines(
  diagnosis: string | null,
  macroSummary: string | null | undefined,
  strategySectionLines: string[],
  scenarioNarratives: string[],
  portfolioInsights: string[],
) {
  return uniqueStrings([
    diagnosis,
    ...takeSentences(macroSummary, 3),
    ...strategySectionLines,
    ...scenarioNarratives,
    ...portfolioInsights,
  ]).slice(0, 7);
}

function buildRecommendationKind(item: RecommendationIdea) {
  if (item.lane === "core") return "코어 ETF";
  if (item.lane === "sector") return "섹터 ETF";
  return "개별주";
}

function recommendationLaneSubtitle(key: RecommendationIdea["lane"]) {
  if (key === "core") return "포트의 중심 축";
  if (key === "sector") return "테마 대응 위성 축";
  return "집중형 알파 후보";
}

function buildRecommendationRoleNarrative(item: RecommendationIdea) {
  const targetText =
    item.targetAccounts.length > 0
      ? `${joinNaturalList(item.targetAccounts)} 계좌 안에서`
      : "현재 포트폴리오 안에서";

  if (item.code === "132030") {
    return `${item.name}은 ${targetText} 주식시장 급락과 유가 재상승에 대비하는 헤지 축으로 보는 편이 맞습니다. 수익 추격용이라기보다 ${item.held ? "기존 위험자산을 완충하는 방어 포지션" : "방어 자산을 보강하는 쿠션 포지션"}에 가깝습니다.`;
  }
  if (item.code === "423160") {
    return `${item.name}은 ${targetText} 바로 수익을 내기 위한 종목이 아니라 다음 매수 타이밍을 준비하는 대기 자금 축입니다. 레짐이 흔들릴 때 공격 자산 매수 속도를 조절하는 밸브 역할이 더 중요합니다.`;
  }
  if (item.lane === "core") {
    return `${item.name}은 ${targetText} 단기 이벤트를 추격하기보다 중심 비중을 쌓는 코어 포지션입니다. 따라서 방향이 맞더라도 한 번에 강하게 베팅하기보다 장기 복리와 방어 균형을 같이 보면서 누적하는 자산으로 보는 편이 맞습니다.`;
  }
  if (item.lane === "sector") {
    return `${item.name}은 ${targetText} ${item.dominantTheme} 흐름을 ETF 한 장으로 반영하는 전술 포지션입니다. 코어 자산보다 변동성은 크지만, 리포트 강도와 수급이 동시에 붙을 때 성과가 빠르게 나타나는 영역입니다.`;
  }
  return `${item.name}은 ${targetText} ${item.dominantTheme} 축에서 ETF보다 실적과 수주 반응이 더 크게 나타나는 집중형 포지션입니다. 맞을 때 수익 탄성은 크지만, 뉴스나 실적이 어긋나면 변동성도 훨씬 빠르게 커질 수 있습니다.`;
}

function buildRecommendationReportNarrative(item: RecommendationIdea) {
  if (item.xai.reportBasis === "mixed" && item.xai.directImpactCount > 0) {
    return `최근 리포트에서는 ${item.dominantTheme} 테마 강도와 함께 ${item.xai.directImpactTitles[0] ?? "직접 연결된 리포트"} 같은 구체 근거가 같이 확인됩니다. 단순 테마 기대보다 실제 정책, 실적, 산업 수요로 이어질 가능성이 검증된 편이라 설명력이 더 선명합니다.`;
  }
  if (item.xai.reportBasis === "direct" && item.xai.directImpactCount > 0) {
    return `이 후보는 테마 일반론보다 직접 연결된 리포트 ${item.xai.directImpactCount}건이 핵심 근거입니다. 즉 ${item.xai.directImpactTitles[0] ?? "관련 리포트"}에서 다룬 산업 흐름이 실제 종목 논리로 이어지고 있다는 해석이 가능합니다.`;
  }
  return `현재 추천의 중심은 ${item.dominantTheme}입니다. 최근 리포트에서 이 테마가 반복적으로 언급되며 점수가 밀리고 있어, 같은 레인 안에서도 ${item.name}이 우선 후보로 올라온 상태입니다.`;
}

function buildRecommendationTechnicalNarrative(item: RecommendationIdea) {
  if (item.xai.signalReason) {
    return truncateText(
      `기술적으로는 ${item.xai.signalReason}`,
      180,
    );
  }
  if (item.signal === "BUY") {
    return "기술 흐름도 우호적이라 추세가 살아 있는 쪽으로 읽힙니다. 다만 강한 종목일수록 추격보다 눌림을 나눠 받는 편이 더 안정적입니다.";
  }
  if (item.signal === "HOLD") {
    return "기술적으로는 방향성이 완전히 꺾이지는 않았지만, 지금 구간에서는 추격보다 확인 매수가 더 잘 맞는 상태입니다.";
  }
  if (item.signal === "REDUCE" || item.signal === "SELL") {
    return "기술 추세는 아직 보수적이라 서사만으로 바로 비중을 늘리기엔 이른 상태입니다. 반드시 분할 접근과 확인 매수 전제가 필요합니다.";
  }
  if (typeof item.technicalScore === "number") {
    return `기술 점수 ${item.technicalScore}점 기준으로 보면 완전히 무너진 후보는 아니지만, 리포트 근거와 함께 봐야 확신도가 올라가는 유형입니다.`;
  }
  return "기술 데이터 커버리지는 충분하지 않지만, 현재는 리포트 강도와 계좌 적합도가 추천 우선순위를 밀고 있습니다.";
}

function buildRecommendationExecutionNarrative(item: RecommendationIdea) {
  const primaryTarget = item.executionTargets[0] ?? null;
  if (primaryTarget) {
    return `${primaryTarget.accountLabel}에서 ${formatCurrency(primaryTarget.suggestedAmount)} 범위로 연결된 실행 후보입니다. ${truncateText(primaryTarget.reason ?? item.xai.accountRationale, 150)}`;
  }
  if (item.targetAccounts.length > 0) {
    return `${joinNaturalList(item.targetAccounts)} 계좌와의 적합도가 높게 잡혀 있습니다. 아직 금액까지 열린 실행 후보는 아니므로, 먼저 레짐과 가격 구조가 함께 맞는지 확인한 뒤 진입 강도를 정하는 편이 좋습니다.`;
  }
  return "직접 연결된 실행 금액은 아직 열리지 않았습니다. 현재는 강한 관찰 후보로 두고, 다음 리포트와 가격 반응이 더 쌓이는지 먼저 확인하는 편이 좋습니다.";
}

function buildRecommendationCautions(item: RecommendationIdea) {
  const baseRisk =
    item.risks[0] ??
    (item.xai.reportBasis === "theme" && item.xai.directImpactCount === 0
      ? "직접 연결된 종목 리포트는 아직 얕아, 테마 강도만으로 과도하게 확신을 키우지 않는 편이 좋습니다."
      : item.lane === "stock"
        ? "개별주는 ETF보다 실적과 수주, 수급 변화에 더 민감하므로 같은 테마라도 변동성이 훨씬 크게 나올 수 있습니다."
        : "강한 후보라도 이벤트 한 번으로 흔들릴 수 있으니, 추격보다 분할 접근을 기본으로 두는 편이 좋습니다.");

  const secondaryRisk =
    item.signal === "REDUCE" || item.signal === "SELL"
      ? "기술 신호가 완전히 돌지 않은 상태라, 뉴스가 좋아도 가격이 바로 따라오지 않으면 진입 속도를 늦추는 편이 맞습니다."
      : item.changePct != null && item.changePct >= 6
        ? "단기 급등 구간이라면 좋은 논리도 가격에 선반영됐을 수 있어, 눌림 없이 추격하는 방식은 피하는 편이 안전합니다."
        : item.lane === "sector"
          ? "섹터 ETF는 테마가 식는 순간 수급이 빠르게 빠질 수 있어, 핵심 뉴스와 실제 자금 유입이 함께 유지되는지 봐야 합니다."
          : null;

  return uniqueStrings([baseRisk, secondaryRisk]).slice(0, 2);
}

function buildRecommendationNarrative(item: RecommendationIdea) {
  return {
    insights: uniqueStrings([
      buildRecommendationRoleNarrative(item),
      buildRecommendationReportNarrative(item),
      buildRecommendationTechnicalNarrative(item),
    ]).slice(0, 3),
    cautions: buildRecommendationCautions(item),
    executionLine: buildRecommendationExecutionNarrative(item),
  };
}

function findRecommendationIdeaByCodeOrName(
  recommendationBoard: ReturnType<typeof loadRecommendationBoard>,
  code: string | null | undefined,
  name: string | null | undefined,
) {
  const normalizedName = normalizeName(name);
  const items = (recommendationBoard?.lanes ?? []).flatMap((lane) => lane.items);

  return (
    items.find((item) => code && item.code === code) ??
    items.find((item) => normalizeName(item.name) === normalizedName) ??
    null
  );
}

function executionKindLabel(kind: ExecutionGuideItem["kind"]) {
  if (kind === "buy") return "매수";
  if (kind === "trim") return "매도";
  return "보유";
}

function executionKindClassName(kind: ExecutionGuideItem["kind"]) {
  if (kind === "buy") {
    return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  if (kind === "trim") {
    return "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
  }
  return "bg-slate-900/5 text-slate-600 ring-1 ring-inset ring-slate-200";
}

function formatHitRateBadgePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function buildExecutionConfidenceBadge(params: {
  kind: ExecutionGuideItem["kind"];
  feedbackAnalysis: FeedbackAnalysis | null;
  regime: string | null | undefined;
}) {
  const { kind, feedbackAnalysis, regime } = params;
  const normalizedRegime = String(regime ?? "").toUpperCase();

  if (kind === "buy") {
    const regimeRate = normalizedRegime
      ? feedbackAnalysis?.regimeAccuracy?.[normalizedRegime]?.buyHitRate ?? null
      : null;
    const signalRate = feedbackAnalysis?.signalHitRates?.buy_hit_5d ?? null;
    const effectiveRate = regimeRate ?? signalRate;

    if (normalizedRegime === "SIDEWAYS" && regimeRate != null && regimeRate <= 0) {
      return {
        hitRateBadge: "🔴 이 레짐에서 BUY 적중률 0%",
        confidenceLevel: "low" as const,
      };
    }
    if (typeof effectiveRate === "number" && effectiveRate > 0.6) {
      return {
        hitRateBadge: `🟢 BUY 적중률 ${formatHitRateBadgePercent(effectiveRate)}`,
        confidenceLevel: "high" as const,
      };
    }
    if (typeof effectiveRate === "number") {
      return {
        hitRateBadge: `🟡 BUY 적중률 ${formatHitRateBadgePercent(effectiveRate)}`,
        confidenceLevel: "medium" as const,
      };
    }
    return {
      hitRateBadge: "🟡 BUY 적중 데이터 부족",
      confidenceLevel: "medium" as const,
    };
  }

  if (kind === "hold") {
    const holdRate = feedbackAnalysis?.signalHitRates?.hold_hit_5d ?? null;
    if (typeof holdRate === "number" && holdRate > 0.7) {
      return {
        hitRateBadge: `🟢 HOLD 적중률 ${formatHitRateBadgePercent(holdRate)}`,
        confidenceLevel: "high" as const,
      };
    }
    if (typeof holdRate === "number") {
      return {
        hitRateBadge: `🟡 HOLD 적중률 ${formatHitRateBadgePercent(holdRate)}`,
        confidenceLevel: "medium" as const,
      };
    }
    return {
      hitRateBadge: "🟡 HOLD 적중 데이터 부족",
      confidenceLevel: "medium" as const,
    };
  }

  const trimRate = feedbackAnalysis?.signalHitRates?.trim_negative_5d ?? null;
  if (typeof trimRate === "number" && trimRate > 0.6) {
    return {
      hitRateBadge: `🟢 TRIM 적중률 ${formatHitRateBadgePercent(trimRate)}`,
      confidenceLevel: "high" as const,
    };
  }
  if (typeof trimRate === "number" && trimRate <= 0.2) {
    return {
      hitRateBadge: `🔴 TRIM 적중률 ${formatHitRateBadgePercent(trimRate)}`,
      confidenceLevel: "low" as const,
    };
  }
  if (typeof trimRate === "number") {
    return {
      hitRateBadge: `🟡 TRIM 적중률 ${formatHitRateBadgePercent(trimRate)}`,
      confidenceLevel: "medium" as const,
    };
  }
  return {
    hitRateBadge: "🟡 TRIM 적중 데이터 부족",
    confidenceLevel: "medium" as const,
  };
}

function buildExecutionListReason(params: {
  account: PortfolioAccount;
  accountGuide: AccountGuide | null;
  item: ExecutionGuideItem;
  holdingSummary: HoldingSummary | null;
  recommendation: RecommendationIdea | null;
  narrative: string;
}) {
  const { account, accountGuide, item, holdingSummary, recommendation, narrative } = params;
  const targetReason =
    recommendation?.executionTargets.find((target) => target.accountKey === account.key)?.reason ??
    recommendation?.executionTargets[0]?.reason ??
    null;

  const primary =
    item.kind === "buy"
      ? takeSentences(narrative, 1)[0] ?? takeSentences(item.reason, 1)[0] ?? null
      : item.kind === "trim"
        ? holdingSummary?.cautions[0] ??
          takeSentences(item.reason, 1)[0] ??
          takeSentences(narrative, 1)[0] ??
          null
        : holdingSummary?.insights[0] ??
          takeSentences(item.reason, 1)[0] ??
          takeSentences(narrative, 1)[0] ??
          null;

  const secondary =
    item.kind === "buy"
      ? takeSentences(targetReason, 1)[0] ??
        takeSentences(recommendation?.rationale, 1)[0] ??
        takeSentences(accountGuide?.actionLine, 1)[0] ??
        null
      : item.kind === "trim"
        ? takeSentences(accountGuide?.actionLine, 1)[0] ??
          takeSentences(narrative, 1)[0] ??
          null
        : holdingSummary?.cautions[0] ??
          takeSentences(accountGuide?.actionLine, 1)[0] ??
          null;

  return truncateText(uniqueStrings([primary, secondary]).slice(0, 2).join(" "), 220);
}

function buildExecutionListRows(params: {
  accountEntries: Array<{
    account: PortfolioAccount;
    accountGuide: AccountGuide | null;
  }>;
  stage2: Stage2Strategy | null;
  stage3: Stage3Analysis | null;
  technical: TechnicalSnapshot | null;
  impactMap: ImpactMap | null;
  recommendationBoard: ReturnType<typeof loadRecommendationBoard>;
  feedbackAnalysis: FeedbackAnalysis | null;
}) {
  const {
    accountEntries,
    stage2,
    stage3,
    technical,
    impactMap,
    recommendationBoard,
    feedbackAnalysis,
  } = params;
  const grouped = new Map<
    string,
    {
      kind: ExecutionGuideItem["kind"];
      accountKeys: string[];
      accounts: string[];
      name: string;
      code: string | null;
      amount: number | null;
      reasonCandidates: string[];
      hitRateBadge: string | null;
      confidenceLevel: "high" | "medium" | "low" | null;
    }
  >();

  for (const { account, accountGuide } of accountEntries) {
    const executionItems = [
      ...(accountGuide?.executionBuys ?? []),
      ...(accountGuide?.executionTrims ?? []),
      ...(accountGuide?.executionHolds ?? []),
    ];

    for (const item of executionItems) {
      const relatedHolding = findAccountHoldingByCodeOrName(account, item.code, item.name);
      const relatedHoldingGuide =
        relatedHolding != null ? findHoldingGuide(accountGuide, relatedHolding) : null;
      const relatedStage3Holding =
        relatedHolding != null ? findStage3Holding(stage3, account.key, relatedHolding) : null;
      const relatedTechnicalItem =
        item.code && technical?.scores?.[item.code]
          ? technical.scores[item.code]
          : relatedHolding?.code && technical?.scores?.[relatedHolding.code]
            ? technical.scores[relatedHolding.code]
            : null;
      const relatedImpactContext =
        relatedHolding != null
          ? getHoldingImpactContext(impactMap, account.key, relatedHoldingGuide)
          : [];
      const relatedCandidate =
        relatedHolding != null ? findCandidateByCodeOrName(stage2, relatedHolding) : null;
      const holdingSummary =
        relatedHolding != null
          ? buildHoldingSummary({
              account,
              holding: relatedHolding,
              holdingGuide: relatedHoldingGuide,
              stage3Holding: relatedStage3Holding,
              technicalItem: relatedTechnicalItem,
              impactContext: relatedImpactContext,
              candidate: relatedCandidate,
            })
          : null;
      const recommendation = findRecommendationIdeaByCodeOrName(
        recommendationBoard,
        item.code,
        item.name,
      );
      const narrative = buildExecutionNarrative({
        account,
        item,
        kind: item.kind,
        technicalItem: relatedTechnicalItem,
        holdingSummary,
      });
      const reason = buildExecutionListReason({
        account,
        accountGuide,
        item,
        holdingSummary,
        recommendation,
        narrative,
      });
      const amountValue =
        typeof item.suggestedAmount === "number"
          ? item.suggestedAmount
          : item.kind === "hold"
            ? relatedHolding?.marketValue ?? null
            : null;
      const confidenceBadge = buildExecutionConfidenceBadge({
        kind: item.kind,
        feedbackAnalysis,
        regime: stage2?.macro_view?.regime,
      });
      const key = `${item.kind}:${item.code ?? normalizeName(item.name)}`;
      const current = grouped.get(key);

      if (current) {
        current.accountKeys = uniqueStrings([...current.accountKeys, account.key]);
        current.accounts = uniqueStrings([...current.accounts, account.label]);
        current.reasonCandidates = uniqueStrings([...current.reasonCandidates, reason]);
        current.amount =
          typeof current.amount === "number" || typeof amountValue === "number"
            ? (current.amount ?? 0) + (amountValue ?? 0)
            : null;
        current.hitRateBadge = current.hitRateBadge ?? confidenceBadge.hitRateBadge;
        current.confidenceLevel =
          current.confidenceLevel ?? confidenceBadge.confidenceLevel;
        continue;
      }

      grouped.set(key, {
        kind: item.kind,
        accountKeys: [account.key],
        accounts: [account.label],
        name: item.name,
        code: item.code,
        amount: amountValue,
        reasonCandidates: [reason],
        hitRateBadge: confidenceBadge.hitRateBadge,
        confidenceLevel: confidenceBadge.confidenceLevel,
      });
    }
  }

  return [...grouped.entries()]
    .map(([key, value]) => {
      const amountLabel =
        typeof value.amount === "number"
          ? value.kind === "hold"
            ? `보유 ${formatCurrency(value.amount)}`
            : formatCurrency(value.amount)
          : value.kind === "trim"
            ? "비중 조정"
            : value.kind === "hold"
              ? "유지"
              : "금액 대기";

      return {
        key,
        kind: value.kind,
        accountKeys: value.accountKeys,
        accounts: value.accounts,
        name: value.name,
        code: value.code,
        amountLabel,
        reason: truncateText(value.reasonCandidates.slice(0, 2).join(" "), 240),
        hitRateBadge: value.hitRateBadge,
        confidenceLevel: value.confidenceLevel,
      } satisfies ExecutionListRow;
    })
    .sort((left, right) => {
      const priority = { buy: 0, trim: 1, hold: 2 } satisfies Record<
        ExecutionGuideItem["kind"],
        number
      >;
      return (
        priority[left.kind] - priority[right.kind] ||
        left.name.localeCompare(right.name, "ko-KR")
      );
    });
}

function buildRecommendationHighlightSpecs(
  item: RecommendationIdea,
  extraTexts: Array<string | null | undefined> = [],
) {
  return buildInlineHighlightSpecs(
    [item.rationale, ...item.reasons, ...item.risks, ...extraTexts],
    [
      item.name,
      item.code,
      item.dominantTheme,
      ...item.themes,
      ...item.targetAccounts,
      ...item.executionTargets.map((target) => target.accountLabel),
      buildRecommendationKind(item),
    ],
  );
}

function regimeLabel(value: string | null | undefined) {
  switch (String(value ?? "").toUpperCase()) {
    case "SIDEWAYS":
      return "횡보";
    case "BULL":
    case "BULLISH":
      return "상승";
    case "BEAR":
    case "BEARISH":
      return "하락";
    case "HIGH_VOL":
      return "고변동성";
    default:
      return value ?? "중립";
  }
}

function joinNaturalList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]}와 ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${items[items.length - 1]}`;
}

function buildAllocationHeatmapData(
  accountEntries: Array<{
    account: PortfolioAccount;
    accountGuide: AccountGuide | null;
  }>,
) {
  const categories = [...new Set(
    accountEntries.flatMap(({ accountGuide }) =>
      (accountGuide?.categories ?? []).map((category) => category.category),
    ),
  )];

  const rows = accountEntries.map(({ account, accountGuide }) => ({
    accountKey: account.key,
    accountLabel: account.label,
    cells: categories
      .map((categoryName) => {
        const category = accountGuide?.categories.find((item) => item.category === categoryName);
        if (!category) return null;
        return {
          category: categoryName,
          targetPct: category.targetPct,
          currentPct: category.currentPct,
          gapPct: category.gapPct,
        };
      })
      .filter(Boolean) as Array<{
      category: string;
      targetPct: number;
      currentPct: number;
      gapPct: number;
    }>,
  }));

  return {
    categories,
    rows,
  };
}

function buildHeroNarrative(params: {
  diagnosis: string | null;
  stage2: Stage2Strategy | null;
  macroIndicators: MacroIndicator[];
  recommendationBoard: ReturnType<typeof loadRecommendationBoard>;
}) {
  const { diagnosis, stage2, macroIndicators, recommendationBoard } = params;
  const wti = macroIndicators.find((item) => item.key === "WTI");
  const usdkrw = macroIndicators.find((item) => item.key === "USDKRW");
  const regime = regimeLabel(stage2?.macro_view?.regime);
  const reinforceThemes = uniqueStrings(
    (stage2?.strategy_changes ?? [])
      .filter((item) => item.direction === "reinforce")
      .map((item) => item.theme),
  );
  const watchThemes = reinforceThemes.filter((item) => item !== "방어 자산").slice(0, 3);
  const hasDefensiveTilt = reinforceThemes.includes("방어 자산");
  const recommendationThemes = recommendationBoard?.highlightedThemes?.slice(0, 3) ?? [];
  const focusThemes = uniqueStrings([...watchThemes, ...recommendationThemes]).slice(0, 3);

  const lines = [
    diagnosis
      ? `${diagnosis.replace(/\.$/, "")} 다만 이를 추세 전환으로 단정하기보다 단기 반등으로 해석하는 편이 더 적절합니다.`
      : "주식시장의 단기 위험 선호는 다소 개선됐지만, 아직 추세 전환을 확신하기는 이릅니다.",
    wti && usdkrw
      ? `WTI는 ${wti.close?.toFixed(2)}달러, 원/달러는 ${usdkrw.close?.toFixed(1)}원 수준이라 유가와 달러 압력이 완전히 해소되지 않았고, 이란 변수와 석유 정책 관련 불확실성도 계속 시장에 남아 있습니다.`
      : "유가와 달러 압력이 완전히 해소되지 않아 지정학 리스크의 2차 파급을 계속 점검해야 합니다.",
    `현재 레짐은 ${regime} 구간으로, 지수 전체가 같은 방향으로 가기보다 종목과 섹터를 선별해서 봐야 하는 장세에 가깝습니다.`,
    hasDefensiveTilt || focusThemes.length > 0
      ? `따라서 ${hasDefensiveTilt ? "금·KOFR 같은 방어 자산 비중을 일정 부분 유지하거나 확대하면서, " : ""}${focusThemes.length > 0 ? `${joinNaturalList(focusThemes)} 같은 물리적 인프라 자산을 더 주의 깊게 살펴보는 접근이 유효합니다.` : "방어 자산과 현금 관리 비중을 함께 높여 두는 편이 유효합니다."}`
      : "따라서 안전 자산과 현금 관리의 비중을 높이고, 신규 진입은 선별적으로 접근하는 편이 좋습니다.",
  ];

  return lines.filter(Boolean);
}

function statusChip(status: string | null | undefined) {
  if (status === "양호") {
    return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  if (status === "보강 필요") {
    return "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20";
  }
  return "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
}

export function DashboardPage() {
  const portfolio = loadLatestPortfolio();
  if (!portfolio) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-5xl items-center px-6 py-16">
        <section className="glass-panel w-full rounded-[2rem] p-8 text-center">
          <p className="section-kicker">Dashboard Test</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            포트폴리오 스냅샷을 찾지 못했습니다
          </h1>
          <p className={joinClasses("mt-4", BODY_NOTE_CLASS, "text-slate-600")}>
            `data/portfolio/latest.json`이 준비되면 계좌 중심 테스트 대시보드를 렌더링합니다.
          </p>
        </section>
      </main>
    );
  }

  const portfolioGuide = buildPortfolioGuide(portfolio);
  const totals = getPortfolioTotals(portfolio);
  const recommendationBoard = loadRecommendationBoard(portfolio.date);
  const stage2 = loadLatestDatedJson<Stage2Strategy>(
    "stage2-strategy-options.json",
    portfolio.date,
  ).data;
  const stage3 = loadLatestDatedJson<Stage3Analysis>(
    "stage3-quant-scores.json",
    portfolio.date,
  ).data;
  const impactMap = loadLatestDatedJson<ImpactMap>(
    "impact-map.json",
    portfolio.date,
  ).data;
  const marketVoice = loadLatestDatedJson<MarketVoiceArtifact>(
    "marketvoice-linked.json",
    portfolio.date,
  ).data;
  const holdingClusters = loadLatestDatedJson<HoldingClustersArtifact>(
    "holding-clusters.json",
    portfolio.date,
  ).data;
  const technical = loadLatestTechnicalSnapshot(portfolio.date);
  const latestFeedbackAnalysis = loadLatestFeedbackAnalysis(portfolio.date);
  const feedbackAnalysis = latestFeedbackAnalysis.data;

  const latestBriefing =
    loadResearchBriefings().find((item) => item.variant === "rich") ??
    loadResearchBriefings()[0] ??
    null;
  const researchOverview = getResearchBriefingOverview(latestBriefing);
  const latestBriefingContent = latestBriefing?.content ?? "";
  const diagnosis = extractResearchDiagnosis(latestBriefingContent);
  const researchTags = extractResearchTags(latestBriefingContent, 10).map((item) => item.label);
  const scenarios = extractResearchScenarioBranches(latestBriefingContent, 2);
  const checkpoints = extractResearchCheckpoints(latestBriefingContent, 6);
  const actionGroups = extractResearchActionGroups(latestBriefingContent, 4);
  const strategyGuide = extractResearchStrategyGuide(latestBriefingContent);
  const portfolioInsights = extractResearchPortfolioInsights(latestBriefingContent);
  const macroIndicators = loadLatestMacroIndicators(portfolio.date);
  const marketVoiceAccountSections = portfolio.accounts
    .map((account) => ({
      account,
      digest:
        marketVoice?.accountDigests?.find((item) => item.accountKey === account.key) ?? null,
    }))
    .filter((item) => (item.digest?.topTopics ?? []).length > 0);
  const marketVoiceResearchCandidates = marketVoice?.deepResearchCandidates ?? [];
  const heroNarrative = buildHeroNarrative({
    diagnosis,
    stage2,
    macroIndicators,
    recommendationBoard,
  });

  const summaryLines = marketSummaryLines(
    diagnosis,
    stage2?.macro_view?.summary,
    strategyGuide.supportingPoints.slice(0, 3),
    scenarios.flatMap((item) => [item.narrative, item.response]),
    [
      ...portfolioInsights.strengths.slice(0, 1),
      ...portfolioInsights.vulnerabilities.slice(0, 1),
      ...portfolioInsights.upgradeAxes.slice(0, 1),
    ],
  );

  const marketHighlights = buildInlineHighlightSpecs(
    [
      diagnosis,
      stage2?.macro_view?.summary,
      ...summaryLines,
      ...strategyGuide.supportingPoints,
      ...scenarios.flatMap((item) => [item.label, item.narrative, item.response]),
      ...(stage2?.strategy_changes ?? []).flatMap((item) => [item.theme, item.why_now]),
      ...(stage2?.account_actions ?? []).flatMap((item) => [
        item.account_key,
        item.rationale,
        item.reserve_cash_note,
      ]),
      ...portfolioInsights.strengths,
      ...portfolioInsights.vulnerabilities,
      ...portfolioInsights.upgradeAxes,
      marketVoice?.summary?.overview,
      ...(marketVoice?.topics ?? []).slice(0, 4).flatMap((item) => [
        item.title,
        item.portfolioLinkage,
        item.summary,
      ]),
      ...(recommendationBoard?.highlightedThemes ?? []),
    ],
    [
      ...researchTags,
      ...checkpoints.map((item) => item.label),
      ...((marketVoice?.topics ?? []).slice(0, 4).flatMap((item) => item.signalLabels ?? [])),
      ...(recommendationBoard?.highlightedThemes ?? []),
      regimeLabel(stage2?.macro_view?.regime),
    ],
  );

  const marketInsightCards = [
    {
      key: "focus",
      kicker: "핵심 진단",
      title:
        diagnosis ??
        researchOverview.description ??
        "오늘 브리핑의 핵심 해석을 다시 정리할 필요가 있습니다.",
      detail:
        summaryLines[1] ??
        stage2?.macro_view?.summary ??
        researchOverview.description ??
        "리포트와 딥리서치를 함께 읽어 현재 레짐의 해석 강도를 높였습니다.",
      tone: "focus" as const,
    },
    {
      key: "risk",
      kicker: "리스크 포인트",
      title:
        scenarios[1]?.narrative ??
        checkpoints[0]?.label ??
        "리스크 시나리오가 다시 열리면 방어 자산과 현금 대응이 더 중요해집니다.",
      detail:
        scenarios[1]?.response ??
        checkpoints.slice(0, 2).map((item) => item.label).join(" / ") ??
        "예상 경로가 흔들릴 때 무엇을 먼저 다시 확인할지 정리했습니다.",
      tone: "risk" as const,
    },
    {
      key: "action",
      kicker: "실행 초점",
      title:
        strategyGuide.weeklyPriority ??
        portfolioGuide?.globalActions?.[0] ??
        actionGroups[0]?.items?.[0] ??
        "계좌별 현금 여력과 분할 접근 강도를 먼저 맞추는 편이 좋습니다.",
      detail:
        portfolioInsights.upgradeAxes[0] ??
        strategyGuide.supportingPoints[0] ??
        actionGroups[0]?.items?.slice(0, 2).join(" / ") ??
        "실행 우선순위와 계좌별 역할을 함께 보면서 액션을 좁혀야 합니다.",
      tone: "action" as const,
    },
  ].map((item) => ({
    ...item,
    title: truncateText(item.title, 120),
    detail: truncateText(item.detail, 180),
  }));

  const coreLeadIdea = recommendationBoard?.lanes.find((lane) => lane.key === "core")?.items[0] ?? null;
  const tacticalLeadIdea =
    recommendationBoard?.lanes.find((lane) => lane.key === "sector")?.items[0] ??
    recommendationBoard?.lanes.find((lane) => lane.key === "stock")?.items[0] ??
    null;
  const recommendationInsightCards = [
    {
      key: "themes",
      kicker: "추천 중심 축",
      title:
        recommendationBoard?.highlightedThemes.slice(0, 3).join(" · ") ||
        "추천 테마 정리 중",
      detail:
        recommendationBoard?.highlightedThemes.length
          ? "리포트와 실행 후보, 기술 신호가 동시에 겹친 테마를 먼저 올렸습니다."
          : "추천 보드가 채워지면 현재 밀리는 테마가 여기 먼저 표시됩니다.",
      tone: "focus" as const,
    },
    {
      key: "core",
      kicker: "코어 우선",
      title:
        coreLeadIdea?.name ??
        "코어 우선 후보 대기",
      detail:
        coreLeadIdea?.rationale ??
        "장기 코어 자산은 레짐과 현금 여력을 같이 보면서 분할 접근하는 편이 좋습니다.",
      tone: "action" as const,
    },
    {
      key: "tactical",
      kicker: "전술 우선",
      title:
        tacticalLeadIdea?.name ??
        "전술 우선 후보 대기",
      detail:
        tacticalLeadIdea?.rationale ??
        "섹터 ETF나 개별주는 이벤트 강도와 기술 신호가 같이 맞을 때 설명력이 올라갑니다.",
      tone: "risk" as const,
    },
  ].map((item) => ({
    ...item,
    title: truncateText(item.title, 72),
    detail: truncateText(item.detail, 180),
  }));

  const analysisDateLabel =
    portfolioGuide?.analysisDateLabel ??
    formatDateContextLine({
      runDate: latestBriefing?.runDate ?? portfolio.date,
      effectiveMarketDate: latestBriefing?.effectiveMarketDate ?? portfolio.date,
    });

  const accountEntries = portfolio.accounts.map((account) => {
    const accountGuide = findAccountGuide(portfolioGuide, account.key);
    const insightLines = buildAccountInsightLines(
      account,
      accountGuide,
      stage2,
      strategyGuide.supportingPoints,
    );
    const keywords = buildAccountKeywords(accountGuide, researchTags);
    const scoreItems = buildScoreItems(accountGuide);
    const actionHeadline = getActionHeadline(accountGuide);
    const story = buildAccountStory(account, accountGuide);

    return {
      account,
      accountGuide,
      insightLines,
      keywords,
      scoreItems,
      actionHeadline,
      story,
    };
  });
  const executionListRows = buildExecutionListRows({
    accountEntries: accountEntries.map(({ account, accountGuide }) => ({
      account,
      accountGuide,
    })),
    stage2,
    stage3,
    technical,
    impactMap,
    recommendationBoard,
    feedbackAnalysis,
  });
  const executionListAccounts = accountEntries.map(({ account }) => ({
    key: account.key,
    label: account.label,
  }));
  const allocationHeatmap = buildAllocationHeatmapData(
    accountEntries.map(({ account, accountGuide }) => ({
      account,
      accountGuide,
    })),
  );
  const sectionIndexItems = [
    { number: "1", id: "today-actions", label: "오늘의 실행 리스트" },
    { number: "2", id: "portfolio-diagnosis", label: "핵심 진단" },
    { number: "3", id: "accounts-overview", label: "계좌 현황과 실행 방향성" },
    { number: "4", id: "account-holdings", label: "보유 종목" },
    { number: "5", id: "account-direction", label: "투자 방향성" },
    { number: "6", id: "market-guide", label: "시황 가이드와 추천 종목" },
    { number: "7", id: "market-voice", label: "머니토링 이벤트 레이어" },
    { number: "8", id: "recommendations", label: "추천 종목" },
    { number: "9", id: "feedback-dashboard", label: "피드백 대시보드" },
    { number: "10", id: "cluster-map", label: "상관관계 클러스터" },
  ];
  const sectionHeading = (id: string) => {
    const item = sectionIndexItems.find((section) => section.id === id);
    return item ? `${item.number}. ${item.label}` : id;
  };

  const content = (
    <main className="pb-14">
      <section className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-8 pt-5">
        <details
          id="today-actions"
          className="glass-panel scroll-mt-28 rounded-2xl px-6 py-6 [&_summary::-webkit-details-marker]:hidden"
          open
        >
          <summary className="section-header-row flex cursor-pointer list-none items-start justify-between gap-4">
            <div className="section-header-band">
              <p className="section-kicker">Today&apos;s Action List</p>
              <h2 className="mt-1.5 text-[1.3rem] font-semibold tracking-tight text-slate-950">
                {sectionHeading("today-actions")}
              </h2>
            </div>
          </summary>

          <div className="section-block mt-5">
            {executionListRows.length > 0 ? (
              <ExecutionListTable
                rows={executionListRows}
                accounts={executionListAccounts}
                bodyCopyClass={BODY_COPY_CLASS}
                bodyNoteMutedClass={BODY_NOTE_MUTED_CLASS}
              />
            ) : (
              <div
                className={joinClasses(
                  "rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5",
                  BODY_NOTE_MUTED_CLASS,
                  "text-slate-500",
                )}
              >
                오늘 기준으로 바로 실행할 항목이 아직 정리되지 않았습니다. 실행 계획이 생성되면 이 표에 계좌, 종목, 금액, 이유가 요약되어 표시됩니다.
              </div>
            )}
          </div>
        </details>

        <section
          id="portfolio-diagnosis"
          className="glass-panel scroll-mt-28 rounded-2xl px-6 py-6"
        >
          {/* 헤더 행: 진단 라벨 · 날짜 왼쪽, 점수 오른쪽 */}
          <div className="section-header-row flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="section-header-band">
              <p className="section-kicker">Portfolio Diagnosis</p>
              <h2 className="mt-1.5 text-[1.3rem] font-semibold tracking-tight text-slate-950">
                {sectionHeading("portfolio-diagnosis")}
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="flex items-center gap-2.5">
                <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-medium text-white">
                  {portfolio.date}
                </span>
                <BadgeCheck className="text-emerald-500" size={15} />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tracking-tight text-slate-950">
                  {formatScore(portfolioGuide?.score)}
                </span>
                <p className="section-kicker">포트폴리오 점수</p>
              </div>
              {analysisDateLabel && (
                <span className="text-xs text-slate-400">{analysisDateLabel}</span>
              )}
            </div>
          </div>

          {/* 본문: 전체 너비 사용 */}
          <div className="mt-4 space-y-2.5">
            {heroNarrative.map((line, index) => (
              <p
                key={line}
                className={joinClasses(
                  index === 0 ? BODY_COPY_LEAD_CLASS : BODY_COPY_CLASS,
                  index === 0 ? "text-slate-950" : "text-slate-700",
                )}
              >
                {renderHighlightedText(line, marketHighlights)}
              </p>
            ))}
          </div>
          {portfolioGuide?.globalActions?.[0] && (
            <p className="mt-3 text-[13px] text-slate-500">
              {portfolioGuide.globalActions[0]}
            </p>
          )}

          <div className="mt-6 grid grid-cols-4 gap-0 border-t border-slate-200/80 pt-5">
            {[
              {
                icon: WalletCards,
                label: "총 평가금액",
                value: formatCurrency(totals.totalEvaluationAmount),
              },
              {
                icon: LineChart,
                label: "총 보유 수익률",
                value: formatSignedPercent(totals.totalHoldingsProfitRate),
              },
              {
                icon: CircleDashed,
                label: "총 보유 손익",
                value: formatSignedCurrency(totals.totalHoldingsProfitLoss),
              },
              {
                icon: LayoutGrid,
                label: "가용 현금 / 보유 종목 수",
                value: `${formatCurrency(totals.totalCashAvailable)} / ${NUMBER_FORMATTER.format(totals.totalHoldingCount)}개`,
              },
            ].map((item, index) => {
              const Icon = item.icon;
              const valueClassName =
                item.label === "총 보유 수익률"
                  ? signedMetricTone(totals.totalHoldingsProfitRate)
                  : item.label === "총 보유 손익"
                    ? signedMetricTone(totals.totalHoldingsProfitLoss)
                    : "text-slate-950";
              return (
                <div
                  key={item.label}
                  className={joinClasses(
                    "px-6 py-1",
                    index > 0 && "border-l border-slate-200/80",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-slate-900/5 p-2.5 text-slate-700">
                      <Icon size={17} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {item.label}
                      </p>
                      <p
                        className={joinClasses(
                          "mt-2 text-lg font-semibold tracking-tight",
                          valueClassName,
                        )}
                      >
                        {item.value}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section
          id="accounts-overview"
          className="glass-panel scroll-mt-28 rounded-2xl px-6 py-6"
        >
          <div className="section-header-row flex items-center justify-between gap-4">
            <div className="section-header-band">
              <p className="section-kicker">Accounts First</p>
              <h2 className="mt-1.5 text-[1.3rem] font-semibold tracking-tight text-slate-950">
                {sectionHeading("accounts-overview")}
              </h2>
            </div>
            <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              계좌 4개
            </span>
          </div>

          <ExperimentalVisibility>
            <div className="mt-4">
              <AllocationHeatmap
                rows={allocationHeatmap.rows}
                categories={allocationHeatmap.categories}
              />
            </div>
          </ExperimentalVisibility>

          <div className="mt-5">
            <AccountTabs
              tabs={accountEntries.map(({ account, accountGuide }) => ({
                key: account.key,
                label: account.label,
                status: accountGuide?.status ?? "집계 중",
                profitRate: formatSignedPercent(account.profitRate),
                profitRateValue: account.profitRate ?? null,
                score: formatScore(accountGuide?.score),
                scoreValue: accountGuide?.score ?? null,
              }))}
            >
              {accountEntries.map(
                ({ account, accountGuide, insightLines, keywords, scoreItems, actionHeadline, story }) => {
                  const accountSummaryItems = [
                    {
                      label: "수익률",
                      value: formatPercent(account.profitRate),
                      toneClass: signedMetricTone(account.profitRate),
                    },
                    {
                      label: "수익금",
                      value: formatSignedCurrency(account.profitLoss),
                      toneClass: signedMetricTone(account.profitLoss),
                    },
                    {
                      label: "투자 총액",
                      value: formatCurrency(account.evaluationAmount),
                      toneClass: "text-slate-950",
                    },
                    {
                      label: "투자금",
                      value: formatCurrency(account.principal),
                      toneClass: "text-slate-950",
                    },
                    {
                      label: "현금",
                      value: formatCurrency(account.cashAvailable),
                      toneClass: "text-slate-950",
                    },
                    {
                      label: "종목 수",
                      value: `${NUMBER_FORMATTER.format(account.holdings.length)}개`,
                      toneClass: "text-slate-950",
                    },
                  ];

                  return (
                    <article key={account.key} className="space-y-6 py-1">
                      <div className="space-y-4">
                        <div className="grid grid-cols-6 gap-3">
                          {accountSummaryItems.map((item) => (
                            <div
                              key={item.label}
                              className="rounded-[1.3rem] border border-slate-200 bg-white px-4 py-3"
                            >
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                {item.label}
                              </p>
                              <p
                                className={joinClasses(
                                  "mt-2 text-lg font-semibold tracking-tight",
                                  item.toneClass,
                                )}
                              >
                                {item.value}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
                            {account.label}
                          </h3>
                          <span
                            className={joinClasses(
                              "rounded-full px-3 py-1 text-xs font-medium",
                              statusChip(accountGuide?.status),
                            )}
                          >
                            {accountGuide?.status ?? "집계 중"}
                          </span>
                          <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                            방향성 {actionHeadline}
                          </span>
                        </div>

                        <div className="space-y-3">
                          {story.paragraphs.map((paragraph, index) => (
                            <p
                              key={paragraph}
                              className={joinClasses(
                                index === 0 ? BODY_COPY_LEAD_CLASS : BODY_COPY_CLASS,
                                index === 0 ? "text-slate-950" : "text-slate-700",
                              )}
                            >
                              {renderHighlightedText(paragraph, story.highlights, {
                                multiline: true,
                              })}
                            </p>
                          ))}
                        </div>

                        <div>
                          {renderMetaLine(
                            story.highlights.slice(0, 7).map((item) => item.token),
                            { limit: 7, tone: "subtle" },
                          )}
                        </div>

                        <div className="rounded-[1.65rem] border border-slate-200 bg-slate-50/80 px-5 py-5">
                          <div className="grid grid-cols-3 gap-0">
                            {story.cards.map((card, index) => (
                              <div
                                key={`${account.key}-${card.title}`}
                                className={joinClasses(
                                  "px-4 pt-0",
                                  index > 0 && "border-l border-slate-200/80",
                                )}
                              >
                                <p
                                  className={joinClasses(
                                    "text-xs font-semibold uppercase tracking-[0.14em]",
                                    card.title === "계좌 역할"
                                      ? "text-slate-500"
                                      : card.title === "지금 중요 변수"
                                        ? "text-amber-700"
                                        : "text-sky-700",
                                  )}
                                >
                                  {card.title}
                                </p>
                                <p className={joinClasses("mt-2", BODY_NOTE_CLASS, "text-slate-700")}>
                                  {renderHighlightedText(card.body, story.highlights, {
                                    multiline: true,
                                  })}
                                </p>
                              </div>
                            ))}
                          </div>

                          <details className="mt-4">
                            <summary className="list-none">
                              <span className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-100">
                                점수 상세 보기
                              </span>
                            </summary>
                            <div className="mt-4 grid grid-cols-4 gap-3">
                              {scoreItems.map((item) => (
                                <div
                                  key={item.label}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
                                    {item.label}
                                  </p>
                                  <p className="mt-2 text-base font-semibold text-slate-900">
                                    {item.value}
                                  </p>
                                </div>
                              ))}
                            </div>
                            {!!accountGuide?.scoreDrivers.length && (
                              <div className="mt-4 grid gap-2">
                                {accountGuide.scoreDrivers.slice(0, 4).map((item) => (
                                  <p key={item} className="text-sm leading-6 text-slate-600">
                                    {item}
                                  </p>
                                ))}
                              </div>
                            )}
                          </details>
                        </div>
                      </div>

                      <div className="space-y-6 pt-4">
                    <section id="account-holdings" className="scroll-mt-36 space-y-4">
                      <div className="section-header-row flex items-start justify-between gap-4">
                        <div className="section-header-band">
                          <p className="section-kicker">Account Holdings</p>
                          <h4 className="mt-1.5 text-[1.02rem] font-semibold tracking-tight text-slate-950">
                            {sectionHeading("account-holdings")}
                          </h4>
                        </div>
                        <span className="text-xs text-slate-400">
                          종목별 요약과 점수
                        </span>
                      </div>

                      <div className="holdings-preview-rail">
                        <HoldingTabs
                          tabs={account.holdings.map((holding) => ({
                            key: `${account.key}-${holding.code ?? holding.name}`,
                            label: holding.name,
                            code: holding.code ?? null,
                            profitRate: formatSignedPercent(getHoldingProfitRate(holding)),
                            profitRateValue: getHoldingProfitRate(holding),
                            profitLoss: formatSignedCurrency(getHoldingProfitLoss(holding)),
                            profitLossValue: getHoldingProfitLoss(holding),
                          }))}
                        >
                          {account.holdings.map((holding) => {
                            const holdingGuide = findHoldingGuide(accountGuide, holding);
                            const stage3Holding = findStage3Holding(stage3, account.key, holding);
                            const technicalItem =
                              holding.code && technical?.scores?.[holding.code]
                                ? technical.scores[holding.code]
                                : null;
                            const candidate = findCandidateByCodeOrName(stage2, holding);
                            const impactContext = getHoldingImpactContext(
                              impactMap,
                              account.key,
                              holdingGuide,
                            );
                            const summary = buildHoldingSummary({
                              account,
                              holding,
                              holdingGuide,
                              stage3Holding,
                              technicalItem,
                              impactContext,
                              candidate,
                            });
                            const itemSignal = signalTone(
                              holdingGuide?.signal ??
                                holdingGuide?.technicalSignal ??
                                technicalItem?.signal,
                            );
                            const holdingHighlights = buildHoldingHighlightSpecs({
                              accountHighlights: story.highlights,
                              holding,
                              holdingGuide,
                              technicalItem,
                              summary,
                            });
                            const itemAction = getHoldingActionKind(
                              holding,
                              accountGuide,
                              candidate,
                            );
                            const profitLoss = getHoldingProfitLoss(holding);
                            const profitRate = getHoldingProfitRate(holding);

                            return (
                              <div
                                key={`holding-tab-panel-${account.key}-${holding.code ?? holding.name}`}
                                className="px-1 py-1"
                              >
                                <div className="space-y-4">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h5 className="text-lg font-semibold tracking-tight text-slate-950">
                                        {holding.name}
                                      </h5>
                                      <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                                        {holding.code ?? "티커 미입력"}
                                      </span>
                                      <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-500/20">
                                        {holdingKind(holding.name, holdingGuide?.category)}
                                      </span>
                                      <span
                                        className={joinClasses(
                                          "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                          itemSignal.badge,
                                        )}
                                      >
                                        {itemAction} · {itemSignal.label}
                                      </span>
                                    </div>
                                    <p className={joinClasses("mt-2", BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                                      평가금액 {formatCurrency(holding.marketValue)} · 손익{" "}
                                      <span className={scoreTone(profitLoss)}>
                                        {formatSignedCurrency(profitLoss)}
                                      </span>{" "}
                                      · 수익률{" "}
                                      <span className={scoreTone(profitRate)}>
                                        {formatSignedPercent(profitRate)}
                                      </span>
                                    </p>
                                    <div className="mt-3">
                                      {renderMetaLine(summary.chips, { limit: 6, tone: "subtle" })}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-4 gap-2">
                                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                        기술 종합 점수
                                      </p>
                                      <p className="mt-1 text-base font-semibold text-slate-950">
                                        {formatScore(
                                          holdingGuide?.technicalScore ?? technicalItem?.score,
                                        )}
                                      </p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                        총 평가 점수
                                      </p>
                                      <p className="mt-1 text-base font-semibold text-slate-950">
                                        {formatScore(holdingGuide?.score)}
                                      </p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                        리포트 근거
                                      </p>
                                      <p className="mt-1 text-base font-semibold text-slate-950">
                                        {summary.reportCount > 0 ? `${summary.reportCount}건` : "얕음"}
                                      </p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                        리스크 균형
                                      </p>
                                      <p className="mt-1 text-base font-semibold text-slate-950">
                                        {summary.negativeCount > 0
                                          ? `긍정 ${summary.positiveCount} / 주의 ${summary.negativeCount}`
                                          : summary.positiveCount > 0
                                            ? `긍정 ${summary.positiveCount}건`
                                            : "중립"}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="mt-4 space-y-4">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                        핵심 내용
                                      </p>
                                      <div className="mt-2 space-y-2">
                                        {summary.insights.length > 0 ? (
                                          summary.insights.map((item) => (
                                            <p
                                              key={item}
                                              className={joinClasses(BODY_NOTE_CLASS, "text-slate-700")}
                                            >
                                              {renderHighlightedText(item, holdingHighlights, {
                                                multiline: true,
                                              })}
                                            </p>
                                          ))
                                        ) : (
                                          <p className={joinClasses(BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                                            관련 리포트/딥리서치 요약이 더 구조화되면 이 영역의 설명력이 크게 좋아집니다.
                                          </p>
                                        )}
                                      </div>
                                    </div>

                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-4">
                                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                        유의할 점
                                      </p>
                                      <div className="mt-2 space-y-2">
                                        {summary.cautions.length > 0 ? (
                                          summary.cautions.map((item) => (
                                            <p
                                              key={item}
                                              className={joinClasses(BODY_NOTE_CLASS, "text-slate-700")}
                                            >
                                              {renderHighlightedText(item, holdingHighlights, {
                                                multiline: true,
                                              })}
                                            </p>
                                          ))
                                        ) : (
                                          <p className={joinClasses(BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                                            현재 기준 즉시 주의 신호는 크지 않지만, 리포트 커버리지가 약한 종목은 보수적으로 해석해야 합니다.
                                          </p>
                                        )}
                                      </div>

                                      <details className="mt-4 border-t border-slate-200/80 pt-4">
                                        <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">
                                          세부 근거 펼치기
                                        </summary>
                                        <div className="mt-3 grid grid-cols-2 gap-3">
                                          <div className="rounded-2xl bg-white px-4 py-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                              기술 신호
                                            </p>
                                            <div className="mt-2 space-y-1.5 text-sm">
                                              <p>
                                                <span className="text-slate-500">RSI </span>
                                                <span
                                                  className={joinClasses(
                                                    "font-medium",
                                                    buySellBiasTone(rsiBias(technicalItem?.rsi)),
                                                  )}
                                                >
                                                  {technicalItem?.rsi?.toFixed(2) ?? "-"}
                                                </span>
                                              </p>
                                              <p>
                                                <span className="text-slate-500">MACD 히스토그램 </span>
                                                <span
                                                  className={joinClasses(
                                                    "font-medium",
                                                    buySellBiasTone(macdBias(technicalItem?.macd?.histogram)),
                                                  )}
                                                >
                                                  {technicalItem?.macd?.histogram?.toFixed(2) ?? "-"}
                                                </span>
                                              </p>
                                              <p>
                                                <span className="text-slate-500">볼린저 위치 </span>
                                                <span
                                                  className={joinClasses(
                                                    "font-medium",
                                                    buySellBiasTone(
                                                      bollingerBias(technicalItem?.bollinger?.position),
                                                    ),
                                                  )}
                                                >
                                                  {technicalItem?.bollinger?.position
                                                    ? describeBollingerPosition(
                                                        technicalItem.bollinger.position,
                                                      )
                                                    : "미집계"}
                                                </span>
                                              </p>
                                              <p>
                                                <span className="text-slate-500">최근 등락 </span>
                                                <span
                                                  className={joinClasses(
                                                    "font-medium",
                                                    signedMetricTone(technicalItem?.change_pct),
                                                  )}
                                                >
                                                  {formatSignedPercent(technicalItem?.change_pct)}
                                                </span>
                                              </p>
                                            </div>
                                          </div>
                                          <div className="rounded-2xl bg-white px-4 py-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                              리포트/영향 근거
                                            </p>
                                            <div className="mt-2 space-y-2 text-sm text-slate-600">
                                              {impactContext.length > 0 ? (
                                                impactContext.map((item) => (
                                                  <div key={`${item.title}-${item.horizon}`}>
                                                    <p className="font-medium text-slate-800">
                                                      {item.title}
                                                    </p>
                                                    <p>
                                                      {formatDirection(item.direction)} · 강도{" "}
                                                      {item.strength?.toFixed(2) ?? "-"} · 시계{" "}
                                                      {item.horizon ?? "미지정"}
                                                    </p>
                                                  </div>
                                                ))
                                              ) : (
                                                <p>카테고리 기준 impact map 연결은 아직 약합니다.</p>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </details>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </HoldingTabs>
                      </div>

                      <div className="holdings-preview-default divide-y divide-slate-200/80">
                        {account.holdings.map((holding) => {
                          const holdingGuide = findHoldingGuide(accountGuide, holding);
                          const stage3Holding = findStage3Holding(stage3, account.key, holding);
                          const technicalItem =
                            holding.code && technical?.scores?.[holding.code]
                              ? technical.scores[holding.code]
                              : null;
                          const candidate = findCandidateByCodeOrName(stage2, holding);
                          const impactContext = getHoldingImpactContext(
                            impactMap,
                            account.key,
                            holdingGuide,
                          );
                          const summary = buildHoldingSummary({
                            account,
                            holding,
                            holdingGuide,
                            stage3Holding,
                            technicalItem,
                            impactContext,
                            candidate,
                          });
                          const itemSignal = signalTone(
                            holdingGuide?.signal ??
                              holdingGuide?.technicalSignal ??
                              technicalItem?.signal,
                          );
                          const holdingHighlights = buildHoldingHighlightSpecs({
                            accountHighlights: story.highlights,
                            holding,
                            holdingGuide,
                            technicalItem,
                            summary,
                          });
                          const itemAction = getHoldingActionKind(
                            holding,
                            accountGuide,
                            candidate,
                          );
                          const profitLoss = getHoldingProfitLoss(holding);
                          const profitRate = getHoldingProfitRate(holding);

                          return (
                            <div
                              key={`${account.key}-${holding.code ?? holding.name}`}
                              className="py-5 first:pt-0 last:pb-0"
                            >
                              <div className="space-y-4">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h5 className="text-lg font-semibold tracking-tight text-slate-950">
                                      {holding.name}
                                    </h5>
                                    <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                                      {holding.code ?? "티커 미입력"}
                                    </span>
                                    <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-500/20">
                                      {holdingKind(holding.name, holdingGuide?.category)}
                                    </span>
                                    <span
                                      className={joinClasses(
                                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                        itemSignal.badge,
                                      )}
                                    >
                                      {itemAction} · {itemSignal.label}
                                    </span>
                                  </div>
                                  <p className={joinClasses("mt-2", BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                                    평가금액 {formatCurrency(holding.marketValue)} · 손익{" "}
                                    <span className={scoreTone(profitLoss)}>
                                      {formatSignedCurrency(profitLoss)}
                                    </span>{" "}
                                    · 수익률{" "}
                                    <span className={scoreTone(profitRate)}>
                                      {formatSignedPercent(profitRate)}
                                    </span>
                                  </p>
                                  <div className="mt-3">
                                    {renderMetaLine(summary.chips, { limit: 6, tone: "subtle" })}
                                  </div>
                                </div>

                                <div className="grid grid-cols-4 gap-2">
                                  <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                      기술 종합 점수
                                    </p>
                                    <p className="mt-1 text-base font-semibold text-slate-950">
                                      {formatScore(
                                        holdingGuide?.technicalScore ?? technicalItem?.score,
                                      )}
                                    </p>
                                  </div>
                                  <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                      총 평가 점수
                                    </p>
                                    <p className="mt-1 text-base font-semibold text-slate-950">
                                      {formatScore(holdingGuide?.score)}
                                    </p>
                                  </div>
                                  <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                      리포트 근거
                                    </p>
                                    <p className="mt-1 text-base font-semibold text-slate-950">
                                      {summary.reportCount > 0 ? `${summary.reportCount}건` : "얕음"}
                                    </p>
                                  </div>
                                  <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                      리스크 균형
                                    </p>
                                    <p className="mt-1 text-base font-semibold text-slate-950">
                                      {summary.negativeCount > 0
                                        ? `긍정 ${summary.positiveCount} / 주의 ${summary.negativeCount}`
                                        : summary.positiveCount > 0
                                          ? `긍정 ${summary.positiveCount}건`
                                          : "중립"}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4 space-y-4">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                    핵심 내용
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {summary.insights.length > 0 ? (
                                      summary.insights.map((item) => (
                                        <p
                                          key={item}
                                          className={joinClasses(BODY_NOTE_CLASS, "text-slate-700")}
                                        >
                                          {renderHighlightedText(item, holdingHighlights, {
                                            multiline: true,
                                          })}
                                        </p>
                                      ))
                                    ) : (
                                      <p className={joinClasses(BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                                        관련 리포트/딥리서치 요약이 더 구조화되면 이 영역의 설명력이 크게 좋아집니다.
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-4">
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                    유의할 점
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {summary.cautions.length > 0 ? (
                                      summary.cautions.map((item) => (
                                        <p
                                          key={item}
                                          className={joinClasses(BODY_NOTE_CLASS, "text-slate-700")}
                                        >
                                          {renderHighlightedText(item, holdingHighlights, {
                                            multiline: true,
                                          })}
                                        </p>
                                      ))
                                    ) : (
                                      <p className={joinClasses(BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                                        현재 기준 즉시 주의 신호는 크지 않지만, 리포트 커버리지가 약한 종목은 보수적으로 해석해야 합니다.
                                      </p>
                                    )}
                                  </div>

                                  <details className="mt-4 border-t border-slate-200/80 pt-4">
                                    <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">
                                      세부 근거 펼치기
                                    </summary>
                                    <div className="mt-3 grid grid-cols-2 gap-3">
                                      <div className="rounded-2xl bg-white px-4 py-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                          기술 신호
                                        </p>
                                        <div className="mt-2 space-y-1.5 text-sm">
                                          <p>
                                            <span className="text-slate-500">RSI </span>
                                            <span
                                              className={joinClasses(
                                                "font-medium",
                                                buySellBiasTone(rsiBias(technicalItem?.rsi)),
                                              )}
                                            >
                                              {technicalItem?.rsi?.toFixed(2) ?? "-"}
                                            </span>
                                          </p>
                                          <p>
                                            <span className="text-slate-500">MACD 히스토그램 </span>
                                            <span
                                              className={joinClasses(
                                                "font-medium",
                                                buySellBiasTone(macdBias(technicalItem?.macd?.histogram)),
                                              )}
                                            >
                                              {technicalItem?.macd?.histogram?.toFixed(2) ?? "-"}
                                            </span>
                                          </p>
                                          <p>
                                            <span className="text-slate-500">볼린저 위치 </span>
                                            <span
                                              className={joinClasses(
                                                "font-medium",
                                                buySellBiasTone(
                                                  bollingerBias(technicalItem?.bollinger?.position),
                                                ),
                                              )}
                                            >
                                              {technicalItem?.bollinger?.position
                                                ? describeBollingerPosition(
                                                    technicalItem.bollinger.position,
                                                  )
                                                : "미집계"}
                                            </span>
                                          </p>
                                          <p>
                                            <span className="text-slate-500">최근 등락 </span>
                                            <span
                                              className={joinClasses(
                                                "font-medium",
                                                signedMetricTone(technicalItem?.change_pct),
                                              )}
                                            >
                                              {formatSignedPercent(technicalItem?.change_pct)}
                                            </span>
                                          </p>
                                        </div>
                                      </div>
                                      <div className="rounded-2xl bg-white px-4 py-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                          리포트/영향 근거
                                        </p>
                                        <div className="mt-2 space-y-2 text-sm text-slate-600">
                                          {impactContext.length > 0 ? (
                                            impactContext.map((item) => (
                                              <div key={`${item.title}-${item.horizon}`}>
                                                <p className="font-medium text-slate-800">
                                                  {item.title}
                                                </p>
                                                <p>
                                                  {formatDirection(item.direction)} · 강도{" "}
                                                  {item.strength?.toFixed(2) ?? "-"} · 시계{" "}
                                                  {item.horizon ?? "미지정"}
                                                </p>
                                              </div>
                                            ))
                                          ) : (
                                            <p>카테고리 기준 impact map 연결은 아직 약합니다.</p>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </details>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <section
                      id="account-direction"
                      className="scroll-mt-36 space-y-6 pt-5"
                    >
                      <div>
                        <div className="section-header-row">
                          <div className="section-header-band">
                            <p className="section-kicker">Investment Direction</p>
                            <h4 className="mt-1.5 text-[1.02rem] font-semibold tracking-tight text-slate-950">
                              {sectionHeading("account-direction")}
                            </h4>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {insightLines.map((line, index) => (
                            <p
                              key={line}
                              className={joinClasses(
                                index === 0 ? BODY_COPY_LEAD_CLASS : BODY_COPY_CLASS,
                                index === 0 ? "text-slate-900" : "text-slate-700",
                              )}
                            >
                              {line}
                            </p>
                          ))}
                        </div>
                        <div className="mt-4">
                          {renderMetaLine(keywords, { limit: 6, tone: "subtle" })}
                        </div>
                      </div>

                      <div className="border-t border-slate-200/80 pt-5">
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                            추천 실행 방향
                          </p>
                        </div>

                        <div className="mt-4 space-y-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">매수</p>
                            <div className="mt-2 space-y-2">
                              {(accountGuide?.executionBuys.length ?? 0) > 0 ? (
                                accountGuide?.executionBuys.map((item) => {
                                  const relatedHolding = findAccountHoldingByCodeOrName(
                                    account,
                                    item.code,
                                    item.name,
                                  );
                                  const relatedHoldingGuide = relatedHolding
                                    ? findHoldingGuide(accountGuide, relatedHolding)
                                    : null;
                                  const relatedStage3Holding = relatedHolding
                                    ? findStage3Holding(stage3, account.key, relatedHolding)
                                    : null;
                                  const relatedTechnicalItem =
                                    item.code && technical?.scores?.[item.code]
                                      ? technical.scores[item.code]
                                      : relatedHolding?.code && technical?.scores?.[relatedHolding.code]
                                        ? technical.scores[relatedHolding.code]
                                        : null;
                                  const relatedImpactContext = relatedHolding
                                    ? getHoldingImpactContext(impactMap, account.key, relatedHoldingGuide)
                                    : [];
                                  const relatedCandidate =
                                    relatedHolding != null
                                      ? findCandidateByCodeOrName(stage2, relatedHolding)
                                      : null;
                                  const relatedSummary = relatedHolding
                                    ? buildHoldingSummary({
                                        account,
                                        holding: relatedHolding,
                                        holdingGuide: relatedHoldingGuide,
                                        stage3Holding: relatedStage3Holding,
                                        technicalItem: relatedTechnicalItem,
                                        impactContext: relatedImpactContext,
                                        candidate: relatedCandidate,
                                      })
                                    : null;
                                  const narrative = buildExecutionNarrative({
                                    account,
                                    item,
                                    kind: "buy",
                                    technicalItem: relatedTechnicalItem,
                                    holdingSummary: relatedSummary,
                                  });
                                  const narrativeHighlights = buildExecutionHighlightSpecs({
                                    account,
                                    item,
                                    narrative,
                                    technicalItem: relatedTechnicalItem,
                                    holdingSummary: relatedSummary,
                                  });

                                  return (
                                    <div
                                      key={`${item.code ?? item.name}-buy`}
                                      className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
                                    >
                                      <p className="font-medium">
                                        {item.name}
                                        {item.code ? ` (${item.code})` : ""} ·{" "}
                                        {formatCurrency(item.suggestedAmount)}
                                      </p>
                                      <ExecutionNarrativeCard
                                        text={narrative}
                                        tone="buy"
                                        highlights={narrativeHighlights}
                                      />
                                    </div>
                                  );
                                })
                              ) : (
                                <p
                                  className={joinClasses(
                                    "rounded-2xl bg-slate-50 px-4 py-3",
                                    BODY_NOTE_MUTED_CLASS,
                                    "text-slate-500",
                                  )}
                                >
                                  이번 실행에서 강한 매수 권고는 없습니다.
                                </p>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="text-sm font-semibold text-slate-900">매도</p>
                            <div className="mt-2 space-y-2">
                              {(accountGuide?.executionTrims.length ?? 0) > 0 ? (
                                accountGuide?.executionTrims.map((item) => {
                                  const relatedHolding = findAccountHoldingByCodeOrName(
                                    account,
                                    item.code,
                                    item.name,
                                  );
                                  const relatedHoldingGuide = relatedHolding
                                    ? findHoldingGuide(accountGuide, relatedHolding)
                                    : null;
                                  const relatedStage3Holding = relatedHolding
                                    ? findStage3Holding(stage3, account.key, relatedHolding)
                                    : null;
                                  const relatedTechnicalItem =
                                    item.code && technical?.scores?.[item.code]
                                      ? technical.scores[item.code]
                                      : relatedHolding?.code && technical?.scores?.[relatedHolding.code]
                                        ? technical.scores[relatedHolding.code]
                                        : null;
                                  const relatedImpactContext = relatedHolding
                                    ? getHoldingImpactContext(impactMap, account.key, relatedHoldingGuide)
                                    : [];
                                  const relatedCandidate =
                                    relatedHolding != null
                                      ? findCandidateByCodeOrName(stage2, relatedHolding)
                                      : null;
                                  const relatedSummary = relatedHolding
                                    ? buildHoldingSummary({
                                        account,
                                        holding: relatedHolding,
                                        holdingGuide: relatedHoldingGuide,
                                        stage3Holding: relatedStage3Holding,
                                        technicalItem: relatedTechnicalItem,
                                        impactContext: relatedImpactContext,
                                        candidate: relatedCandidate,
                                      })
                                    : null;
                                  const narrative = buildExecutionNarrative({
                                    account,
                                    item,
                                    kind: "trim",
                                    technicalItem: relatedTechnicalItem,
                                    holdingSummary: relatedSummary,
                                  });
                                  const narrativeHighlights = buildExecutionHighlightSpecs({
                                    account,
                                    item,
                                    narrative,
                                    technicalItem: relatedTechnicalItem,
                                    holdingSummary: relatedSummary,
                                  });

                                  return (
                                    <div
                                      key={`${item.code ?? item.name}-trim`}
                                      className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900"
                                    >
                                      <p className="font-medium">
                                        {item.name}
                                        {item.code ? ` (${item.code})` : ""} ·{" "}
                                        {formatCurrency(item.suggestedAmount)}
                                      </p>
                                      <ExecutionNarrativeCard
                                        text={narrative}
                                        tone="trim"
                                        highlights={narrativeHighlights}
                                      />
                                    </div>
                                  );
                                })
                              ) : (
                                <p
                                  className={joinClasses(
                                    "rounded-2xl bg-slate-50 px-4 py-3",
                                    BODY_NOTE_MUTED_CLASS,
                                    "text-slate-500",
                                  )}
                                >
                                  즉시 축소가 필요한 종목은 아직 없습니다.
                                </p>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="text-sm font-semibold text-slate-900">보유 · 관망</p>
                            <div className="mt-2 space-y-2">
                              {(accountGuide?.executionHolds.length ?? 0) > 0 ? (
                                accountGuide?.executionHolds.map((item) => {
                                  const relatedHolding = findAccountHoldingByCodeOrName(
                                    account,
                                    item.code,
                                    item.name,
                                  );
                                  const relatedHoldingGuide = relatedHolding
                                    ? findHoldingGuide(accountGuide, relatedHolding)
                                    : null;
                                  const relatedStage3Holding = relatedHolding
                                    ? findStage3Holding(stage3, account.key, relatedHolding)
                                    : null;
                                  const relatedTechnicalItem =
                                    item.code && technical?.scores?.[item.code]
                                      ? technical.scores[item.code]
                                      : relatedHolding?.code && technical?.scores?.[relatedHolding.code]
                                        ? technical.scores[relatedHolding.code]
                                        : null;
                                  const relatedImpactContext = relatedHolding
                                    ? getHoldingImpactContext(impactMap, account.key, relatedHoldingGuide)
                                    : [];
                                  const relatedCandidate =
                                    relatedHolding != null
                                      ? findCandidateByCodeOrName(stage2, relatedHolding)
                                      : null;
                                  const relatedSummary = relatedHolding
                                    ? buildHoldingSummary({
                                        account,
                                        holding: relatedHolding,
                                        holdingGuide: relatedHoldingGuide,
                                        stage3Holding: relatedStage3Holding,
                                        technicalItem: relatedTechnicalItem,
                                        impactContext: relatedImpactContext,
                                        candidate: relatedCandidate,
                                      })
                                    : null;
                                  const narrative = buildExecutionNarrative({
                                    account,
                                    item,
                                    kind: "hold",
                                    technicalItem: relatedTechnicalItem,
                                    holdingSummary: relatedSummary,
                                  });
                                  const narrativeHighlights = buildExecutionHighlightSpecs({
                                    account,
                                    item,
                                    narrative,
                                    technicalItem: relatedTechnicalItem,
                                    holdingSummary: relatedSummary,
                                  });

                                  return (
                                    <div
                                      key={`${item.code ?? item.name}-hold`}
                                      className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700"
                                    >
                                      <p className="font-medium">
                                        {item.name}
                                        {item.code ? ` (${item.code})` : ""}
                                      </p>
                                      <ExecutionNarrativeCard
                                        text={narrative}
                                        tone="hold"
                                        highlights={narrativeHighlights}
                                      />
                                    </div>
                                  );
                                })
                              ) : (
                                <p
                                  className={joinClasses(
                                    "rounded-2xl bg-slate-50 px-4 py-3",
                                    BODY_NOTE_MUTED_CLASS,
                                    "text-slate-500",
                                  )}
                                >
                                  현재는 관망 또는 점진적 분할 접근이 적절합니다.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                    </article>
                  );
                },
              )}
            </AccountTabs>
          </div>
        </section>

        <section
          id="market-guide"
          className="glass-panel scroll-mt-28 rounded-2xl px-6 py-6"
        >
          <div className="section-header-row flex items-center justify-between gap-4">
            <div className="section-header-band">
              <p className="section-kicker">Market Guide</p>
              <h2 className="mt-1.5 text-[1.3rem] font-semibold tracking-tight text-slate-950">
                {sectionHeading("market-guide")}
              </h2>
            </div>
            <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              시황 · 이슈 · 계좌별 운용
            </span>
          </div>

          <div className="mt-5 rounded-[1.35rem] border border-slate-200 bg-white/85 px-5 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
            <div className="flex items-end justify-between gap-3">
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  브리핑 입력 스냅샷
                </p>
                <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-600")}>
                  {researchOverview.description}
                </p>
              </div>
              <p className="text-xs leading-5 text-slate-400">
                시황가이드와 추천종목은 아래 브리핑 입력을 바탕으로 다시 해석했습니다.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-3">
              {researchOverview.metricItems.map((item, index) => (
                <BriefingMetricCard
                  key={item.key}
                  kicker={item.label}
                  value={formatMetricCount(item.value, item.unit)}
                  detail={item.detail}
                  tone={RESEARCH_METRIC_TONES[index] ?? "neutral"}
                />
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {marketInsightCards.map((item) => (
              <InsightDigestCard
                key={item.key}
                kicker={item.kicker}
                title={item.title}
                detail={item.detail}
                highlights={marketHighlights}
                tone={item.tone}
              />
            ))}
          </div>

          <div className="mt-6">
            <CompactContentTabs
              tabs={[
                {
                  key: "summary",
                  label: "현 시황 요약",
                  subtitle: "리포트 + 딥리서치 + 시장 지표 결합",
                  badge: `${summaryLines.length}`,
                },
                {
                  key: "scenarios",
                  label: "시나리오",
                  subtitle: "3~6개월 기준 체크포인트",
                  badge: `${scenarios.length}`,
                },
              ]}
            >
              <section>
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-900/5 p-2.5 text-slate-700">
                    <LineChart size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      현 시황 요약
                    </p>
                    <p className={joinClasses("mt-1", BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                      리포트 + 딥리서치 + 시장 지표 결합
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {summaryLines.map((line, index) => (
                    <p
                      key={line}
                      className={joinClasses(
                        index === 0 ? BODY_COPY_LEAD_CLASS : BODY_COPY_CLASS,
                        index === 0 ? "text-slate-950" : "text-slate-700",
                      )}
                    >
                      {renderHighlightedText(line, marketHighlights)}
                    </p>
                  ))}
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  {macroIndicators.map((indicator: MacroIndicator) => (
                    <div
                      key={indicator.key}
                      className="rounded-[1.1rem] border border-slate-200 bg-white px-4 py-3"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {indicator.label}
                      </p>
                      <p className="mt-1.5 text-[1.05rem] font-semibold text-slate-950">
                        {formatIndicatorValue(indicator.close)}
                      </p>
                      <p
                        className={joinClasses(
                          "mt-1 text-sm font-medium",
                          signedMetricTone(indicator.changePct),
                        )}
                      >
                        {formatSignedPercent(indicator.changePct)}
                        {indicator.signal ? (
                          <span className="ml-1 font-normal text-slate-400">· {indicator.signal}</span>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-900/5 p-2.5 text-slate-700">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      시나리오와 체크포인트
                    </p>
                    <p className={joinClasses("mt-1", BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                      3~6개월 기준
                    </p>
                  </div>
                </div>

                <div className="mt-5 divide-y divide-slate-200/80">
                  {scenarios.map((item, index) => {
                    const scenarioHighlights = mergeHighlightSpecs(
                      marketHighlights,
                      buildInlineHighlightSpecs(
                        [item.label, item.narrative, item.response],
                        [item.label, item.probabilityLabel],
                      ),
                    );

                    return (
                      <div
                        key={item.id}
                        className={joinClasses("px-0 py-4", index === 0 && "pt-0")}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{item.label}</p>
                          {item.probabilityLabel ? (
                            <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                              {item.probabilityLabel}
                            </span>
                          ) : null}
                        </div>
                        <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-700")}>
                          {renderHighlightedText(item.narrative, scenarioHighlights)}
                        </p>
                        <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-600")}>
                          {renderHighlightedText(item.response, scenarioHighlights)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 border-t border-slate-200/80 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    체크포인트
                  </p>
                  <div className="mt-3 space-y-3">
                    {checkpoints.map((item, index) => {
                      const checkpointHighlights = mergeHighlightSpecs(
                        marketHighlights,
                        buildInlineHighlightSpecs([item.label]),
                      );

                      return (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 ring-1 ring-inset ring-slate-200">
                              Check {index + 1}
                            </span>
                          </div>
                          <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-700")}>
                            {renderHighlightedText(item.label, checkpointHighlights)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            </CompactContentTabs>
          </div>

          <div id="market-voice" className="mt-8 scroll-mt-36 pt-4">
            <div className="section-header-row flex items-end justify-between gap-3">
              <div className="max-w-3xl">
                <div className="section-header-band">
                  <p className="section-kicker">Market Voice</p>
                  <h3 className="mt-1.5 text-[1.1rem] font-semibold tracking-tight text-slate-950">
                    {sectionHeading("market-voice")}
                  </h3>
                </div>
                <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-600")}>
                  {marketVoice?.summary?.overview ??
                    "매 사이클마다 실시간 시황을 끌어와 내 계좌와 바로 연결해 보여줍니다."}
                </p>
              </div>
              <a
                href="/market-news"
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline"
              >
                시황 뉴스 전체 보기
                <ExternalLink size={14} />
              </a>
            </div>

            <div className="mt-6">
              <CompactContentTabs
                tabs={[
                  {
                    key: "account-linked",
                    label: "내 계좌 관련 시황",
                    subtitle: "보유·계좌 테마와 직접 연결된 이슈",
                    badge: `${marketVoiceAccountSections.length}`,
                  },
                  {
                    key: "research",
                    label: "딥리서치 후보",
                    subtitle: "바로 검증할 실시간 이벤트",
                    badge: `${marketVoiceResearchCandidates.length}`,
                  },
                ]}
              >
                <section>
                  {marketVoiceAccountSections.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-5 text-sm leading-7 text-slate-500">
                      아직 계좌와 직접 연결된 머니토링 이슈가 없습니다. 다음 사이클에서 새 이벤트가
                      들어오면 여기서 바로 보입니다.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {marketVoiceAccountSections.map(({ account, digest }) => (
                        <article
                          key={account.key}
                          className="rounded-[1.5rem] border border-slate-200/85 bg-white/95 px-5 py-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                {account.label}
                              </p>
                              <p className={joinClasses("mt-1", BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                                연결 이슈 {(digest?.topTopics ?? []).length}건
                              </p>
                            </div>
                            <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                              {account.key}
                            </span>
                          </div>

                          <div className="mt-4 space-y-4">
                            {(digest?.topTopics ?? []).slice(0, 2).map((topic) => (
                              <div
                                key={`${account.key}-${topic.topicId}`}
                                className="rounded-[1.15rem] border border-slate-200/80 bg-slate-50/65 px-4 py-4"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={joinClasses(
                                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                      marketVoiceDirectionClasses(topic.signalDirection),
                                    )}
                                  >
                                    {marketVoiceDirectionLabel(topic.signalDirection)}
                                  </span>
                                  {(topic.matchedCategories ?? []).slice(0, 2).map((category) => (
                                    <span
                                      key={`${topic.topicId}-${category}`}
                                      className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
                                    >
                                      {category}
                                    </span>
                                  ))}
                                </div>

                                <p className="mt-3 text-[1.02rem] font-semibold leading-7 tracking-tight text-slate-950">
                                  {topic.title}
                                </p>
                                <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-600")}>
                                  {renderHighlightedText(topic.portfolioLinkage, marketHighlights)}
                                </p>

                                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                                  <span>소스 {formatMetricCount(topic.sourceCount, "건")}</span>
                                  <span>{formatMarketVoiceDateTime(topic.updatedAt)}</span>
                                  {topic.topicUrl ? (
                                    <a
                                      href={topic.topicUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline"
                                    >
                                      원문
                                      <ExternalLink size={12} />
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  {marketVoiceResearchCandidates.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-5 text-sm leading-7 text-slate-500">
                      아직 딥리서치 후보로 승격된 실시간 이슈가 없습니다.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200/80">
                      {marketVoiceResearchCandidates.map((item, index) => (
                        <article
                          key={item.topicId ?? item.title ?? `marketvoice-research-${index}`}
                          className={joinClasses("py-4", index === 0 && "pt-0")}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                              {formatMetricCount(item.relevanceScore, "점")}
                            </span>
                          </div>
                          <p className="mt-3 text-[1.05rem] font-semibold leading-7 tracking-tight text-slate-950">
                            {item.title}
                          </p>
                          <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-600")}>
                            {renderHighlightedText(item.reason, marketHighlights)}
                          </p>
                          <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-700")}>
                            확인 질문: {renderHighlightedText(item.question, marketHighlights)}
                          </p>
                          {item.topicUrl ? (
                            <a
                              href={item.topicUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline"
                            >
                              머니토링 원문 묶음 보기
                              <ExternalLink size={14} />
                            </a>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </CompactContentTabs>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-200/80 pt-6">
            <CompactContentTabs
              tabs={[
                {
                  key: "issues",
                  label: "핵심 이슈",
                  subtitle: "지금 읽어야 하는 테마 변화",
                  badge: `${Math.min((stage2?.strategy_changes ?? []).length, 4)}`,
                },
                {
                  key: "accounts",
                  label: "계좌별 운용",
                  subtitle: "계좌별 비중과 행동 지침",
                  badge: `${(stage2?.account_actions ?? []).length}`,
                },
              ]}
            >
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  핵심 이슈
                </p>
                <div className="mt-5 divide-y divide-slate-200/80">
                  {(stage2?.strategy_changes ?? []).slice(0, 4).map((item, index) => {
                    const issueHighlights = mergeHighlightSpecs(
                      marketHighlights,
                      buildInlineHighlightSpecs([item.theme, item.why_now], [item.theme]),
                    );

                    return (
                      <div
                        key={`${item.theme}-${item.direction}`}
                        className={joinClasses("py-4", index === 0 && "pt-0")}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{item.theme}</p>
                          <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                            {formatDirection(item.direction)}
                          </span>
                        </div>
                        <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-700")}>
                          {renderHighlightedText(item.why_now, issueHighlights)}
                        </p>
                        <p className="mt-2 text-xs leading-6 text-slate-400">
                          관련 리포트 {(item.source_reports ?? []).join(", ")}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  계좌별 운용 지침
                </p>
                <div className="mt-5 divide-y divide-slate-200/80">
                  {(stage2?.account_actions ?? []).map((item, index) => {
                    const accountGuide = findAccountGuide(portfolioGuide, item.account_key ?? "");
                    const actionHighlights = mergeHighlightSpecs(
                      marketHighlights,
                      buildInlineHighlightSpecs(
                        [item.rationale, item.reserve_cash_note, accountGuide?.actionLine],
                        [
                          portfolio.accounts.find((account) => account.key === item.account_key)?.label ??
                            item.account_key,
                          item.bias,
                          ...(accountGuide?.assetFocus ?? []),
                        ],
                      ),
                    );
                    return (
                      <div
                        key={item.account_key}
                        className={joinClasses("py-4", index === 0 && "pt-0")}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">
                            {portfolio.accounts.find((account) => account.key === item.account_key)?.label ??
                              item.account_key}
                          </p>
                          <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                            {item.bias ?? "neutral"}
                          </span>
                        </div>
                        <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-700")}>
                          {renderHighlightedText(item.rationale, actionHighlights, {
                            multiline: true,
                          })}
                        </p>
                        <p className={joinClasses("mt-2", BODY_COPY_CLASS, "text-slate-500")}>
                          {renderHighlightedText(item.reserve_cash_note, actionHighlights, {
                            multiline: true,
                          })}
                        </p>
                        {accountGuide?.actionLine ? (
                          <p
                            className={joinClasses(
                              "mt-2 font-medium",
                              BODY_COPY_CLASS,
                              "text-slate-900",
                            )}
                          >
                            {renderHighlightedText(accountGuide.actionLine, actionHighlights, {
                              multiline: true,
                            })}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            </CompactContentTabs>
          </div>

          <div id="recommendations" className="mt-8 scroll-mt-36 pt-4">
            <div className="section-header-row flex flex-wrap items-center justify-between gap-4">
              <div className="section-header-band">
                <p className="section-kicker">Recommendations</p>
                <h3 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950">
                  {sectionHeading("recommendations")}
                </h3>
              </div>
              <p className={joinClasses(BODY_NOTE_MUTED_CLASS, "text-slate-500")}>
                코어 ETF · 섹터 ETF · 개별주를 현재 레짐과 계좌 적합도, 기술 점수, 리포트 신호를 함께 반영해 정리했습니다.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {recommendationInsightCards.map((item) => (
                <InsightDigestCard
                  key={item.key}
                  kicker={item.kicker}
                  title={item.title}
                  detail={item.detail}
                  highlights={marketHighlights}
                  tone={item.tone}
                />
              ))}
            </div>

            {(recommendationBoard?.lanes ?? []).length > 0 ? (
              <div className="mt-6">
                <RecommendationTabs
                  tabs={(recommendationBoard?.lanes ?? []).map((lane) => ({
                    key: lane.key,
                    label: lane.title,
                    count: lane.items.length,
                    subtitle: recommendationLaneSubtitle(lane.key),
                  }))}
                >
                  {(recommendationBoard?.lanes ?? []).map((lane) => {
                    const laneHighlights = mergeHighlightSpecs(
                      marketHighlights,
                      buildInlineHighlightSpecs(
                        [lane.description, ...lane.items.flatMap((item) => [item.rationale, ...item.reasons])],
                        [lane.title, ...lane.items.flatMap((item) => [item.dominantTheme, ...item.themes])],
                      ),
                    );

                    return (
                      <div key={lane.key} className="mt-4">
                        {lane.items.length === 0 ? (
                          <div
                            className={joinClasses(
                              "rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5",
                              BODY_NOTE_MUTED_CLASS,
                              "text-slate-500",
                            )}
                          >
                            현재 데이터 기준으로는 이 레인의 확신도 높은 후보가 아직 부족합니다. 다음 리포트와 기술 신호가 더 쌓이면 자동으로 채워집니다.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-200/80">
                            {lane.items.map((item: RecommendationIdea) => {
                              const signal = signalTone(item.signal);
                              const detail = buildRecommendationNarrative(item);
                              const recommendationHighlights = mergeHighlightSpecs(
                                laneHighlights,
                                buildRecommendationHighlightSpecs(item, [
                                  ...detail.insights,
                                  ...detail.cautions,
                                  detail.executionLine,
                                ]),
                              );
                              const primaryTarget = item.executionTargets[0] ?? null;
                              const chipTokens = uniqueStrings([
                                ...item.themes,
                                ...item.targetAccounts,
                                item.dominantTheme,
                              ]).slice(0, 5);

                              return (
                                <div key={item.code} className="py-5 first:pt-0 last:pb-0">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-semibold text-slate-900">{item.name}</p>
                                        <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                                          {item.code}
                                        </span>
                                        {item.held ? (
                                          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/20">
                                            현재 보유
                                          </span>
                                        ) : null}
                                        <span
                                          className={joinClasses(
                                            "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                            signal.badge,
                                          )}
                                        >
                                          {signal.label}
                                        </span>
                                      </div>
                                      <div className="mt-3">
                                        {renderMetaLine(chipTokens, { limit: 5, tone: "subtle" })}
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                      <span className="rounded-full bg-slate-900/5 px-2.5 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                                        기술 {formatScore(item.technicalScore)}
                                      </span>
                                      <span className="rounded-full bg-slate-900/5 px-2.5 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                                        총점 {formatScore(item.score)}
                                      </span>
                                      <span className="rounded-full bg-slate-900/5 px-2.5 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                                        {item.targetAccounts[0] ?? "관찰 우선"}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-4 space-y-4">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                        핵심 내용
                                      </p>
                                      <div className="mt-2 space-y-3">
                                        {detail.insights.map((sentence, index) => (
                                          <p
                                            key={sentence}
                                            className={joinClasses(
                                              index === 0 ? BODY_COPY_LEAD_CLASS : BODY_COPY_CLASS,
                                              index === 0 ? "text-slate-950" : "text-slate-700",
                                            )}
                                          >
                                            {renderHighlightedText(sentence, recommendationHighlights, {
                                              multiline: true,
                                            })}
                                          </p>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-4">
                                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                        유의할 점
                                      </p>
                                      <div className="mt-2 space-y-3">
                                        {detail.cautions.map((sentence) => (
                                          <p
                                            key={sentence}
                                            className={joinClasses(
                                              BODY_COPY_CLASS,
                                              "text-slate-700",
                                            )}
                                          >
                                            {renderHighlightedText(sentence, recommendationHighlights, {
                                              multiline: true,
                                            })}
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="mt-4 border-t border-slate-200/80 pt-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                      실행 포인트
                                    </p>
                                    <p
                                      className={joinClasses(
                                        "mt-2",
                                        BODY_COPY_CLASS,
                                        "text-slate-700",
                                      )}
                                    >
                                      {renderHighlightedText(detail.executionLine, recommendationHighlights, {
                                        multiline: true,
                                      })}
                                    </p>
                                    {primaryTarget ? (
                                      <p
                                        className={joinClasses(
                                          "mt-2",
                                          BODY_NOTE_MUTED_CLASS,
                                          "text-slate-500",
                                        )}
                                      >
                                        연결 금액 {formatCurrency(primaryTarget.suggestedAmount)} ·{" "}
                                        {renderHighlightedText(
                                          primaryTarget.reason ?? primaryTarget.source ?? "오늘 실행 후보로 연결된 종목입니다.",
                                          recommendationHighlights,
                                          { multiline: true },
                                        )}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </RecommendationTabs>
              </div>
            ) : (
              <div
                className={joinClasses(
                  "mt-6 rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6",
                  BODY_NOTE_MUTED_CLASS,
                  "text-slate-500",
                )}
              >
                현재 추천 종목 데이터가 아직 준비되지 않았습니다. Stage 분석과 추천 보드가 다시 생성되면 이 영역이 채워집니다.
              </div>
            )}
          </div>
        </section>

        <ExperimentalVisibility>
          <section
            id="feedback-dashboard"
            className="glass-panel scroll-mt-28 rounded-2xl px-6 py-6"
          >
            <div className="section-header-row flex flex-wrap items-center justify-between gap-4">
              <div className="section-header-band">
                <p className="section-kicker">Feedback Loop</p>
                <h2 className="mt-1.5 text-[1.3rem] font-semibold tracking-tight text-slate-950">
                  {sectionHeading("feedback-dashboard")}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                  표본 {feedbackAnalysis?.sampleSize ?? 0}건
                </span>
                {latestFeedbackAnalysis.fileName ? (
                  <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                    {latestFeedbackAnalysis.fileName}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="section-block mt-5">
              <FeedbackPanel
                analysis={feedbackAnalysis}
                fileName={latestFeedbackAnalysis.fileName}
              />
            </div>
          </section>
        </ExperimentalVisibility>

        <ExperimentalVisibility>
          <section id="cluster-map" className="glass-panel scroll-mt-28 rounded-2xl px-6 py-6">
            <div className="section-header-row flex flex-wrap items-center justify-between gap-4">
              <div className="section-header-band">
                <p className="section-kicker">Holding Overlap</p>
                <h2 className="mt-1.5 text-[1.3rem] font-semibold tracking-tight text-slate-950">
                  {sectionHeading("cluster-map")}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                  클러스터 {(holdingClusters?.clusters ?? []).length}개
                </span>
                {holdingClusters?.threshold != null ? (
                  <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                    임계치 {holdingClusters.threshold}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="section-block mt-5">
              <ClusterMap clusters={holdingClusters?.clusters ?? []} />
            </div>
          </section>
        </ExperimentalVisibility>

      </section>
      <FloatingSectionIndex items={sectionIndexItems} />
    </main>
  );

  return content;
}

export default function DashboardHomePage() {
  return <DashboardPage />;
}
