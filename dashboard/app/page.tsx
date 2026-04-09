import fs from "fs";
import path from "path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  ChevronsDown,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import FloatingSectionIndex, {
  type FloatingSectionIndexItem,
} from "@/components/FloatingSectionIndex";
import ActionPlaybook from "@/components/ActionPlaybook";
import PortfolioGuidanceTabs from "@/components/PortfolioGuidanceTabs";
import RecommendationBoard from "@/components/RecommendationBoard";
import ResearchSectionTabs, {
  type ResearchSectionTabItem,
} from "@/components/ResearchSectionTabs";
import ScenarioTree from "@/components/ScenarioTree";
import SectionJumpButton from "@/components/SectionJumpButton";
import TriggerButton from "@/components/TriggerButton";
import {
  buildPortfolioGuide,
  type PortfolioGuide,
} from "@/lib/portfolio-guidance";
import { loadRecommendationBoard } from "@/lib/recommendations";
import { loadReports } from "@/lib/reports";
import { listRepoFiles, readRepoJsonFile } from "@/lib/repo-artifacts";
import { resolveRepoRoot } from "@/lib/repo-root";
import {
  extractResearchActionGroups,
  extractResearchActionPoints,
  extractResearchCatalystTimeline,
  extractResearchCheckpoints,
  extractResearchDiagnosis,
  extractResearchPortfolioInsights,
  extractResearchScenarioBranches,
  extractResearchSections,
  extractResearchStrategyGuide,
  extractResearchTags,
  getResearchBriefingOverview,
  isStructuredResearchSectionTitle,
  loadResearchBriefings,
} from "@/lib/research";
import {
  getAccountHoldingCount,
  getAccountHoldingsProfitLoss,
  getAccountHoldingsProfitRate,
  getPortfolioTotals,
  loadLatestPortfolio,
  type PortfolioAccount,
} from "@/lib/portfolio";
import { formatDateContextLine } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

const REPO_ROOT = resolveRepoRoot();
const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR");
const MARKET_VALUE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface MarketIndex {
  close: number;
  change_pct: number | null;
  previous_close?: number | null;
  history?: number[];
}

interface MarketData {
  date: string;
  indices?: Record<string, MarketIndex>;
}

interface Tranche {
  filled: boolean;
  status?: string;
}

interface Strategy {
  name?: string;
  target_price?: number;
  current_price?: number;
  tranches?: Tranche[];
  dca_plan?: {
    total_tranches?: number;
    completed?: number;
    schedule?: Array<{
      tranche?: number;
      pct?: number;
      target_date?: string;
      status?: string;
    }>;
  };
}

type PriorityGapItem = {
  id: string;
  accountLabel: string;
  category: string;
  action: "보강 필요" | "비중 축소" | "유지";
  gapPct: number;
  gapAmount: number;
  preferredLabel?: string;
};

function loadLatestMarket(): MarketData | null {
  const dir = "data/market";
  const files = listRepoFiles(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const snapshots = files
    .slice(0, 8)
    .map((file) => readRepoJsonFile<MarketData>(path.posix.join(dir, file)))
    .filter((snapshot): snapshot is MarketData => snapshot !== null)
    .reverse();
  const latest = snapshots[snapshots.length - 1] ?? null;

  if (!latest) return null;

  const historyByIndex = new Map<string, number[]>();

  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.indices ?? {})) {
      const current = historyByIndex.get(key) ?? [];
      if (typeof value.close === "number") {
        current.push(value.close);
      }
      historyByIndex.set(key, current);
    }
  }

  return {
    ...latest,
    indices: Object.fromEntries(
      Object.entries(latest.indices ?? {}).map(([key, value]) => {
        const explicitHistory = historyByIndex.get(key) ?? [];
        const inferredPrevious =
          explicitHistory.length >= 2
            ? explicitHistory
            : typeof value.close === "number" &&
                typeof value.change_pct === "number" &&
                value.change_pct !== -100
              ? [
                  value.close / (1 + value.change_pct / 100),
                  value.close,
                ]
              : [value.close];
        const normalizedChangePct = deriveMarketChangePct({
          close: value.close,
          changePct: value.change_pct,
          previousClose:
            typeof value.previous_close === "number" ? value.previous_close : null,
          history: inferredPrevious,
        });

        return [
          key,
          {
            ...value,
            change_pct: normalizedChangePct,
            history: inferredPrevious,
          } satisfies MarketIndex,
        ];
      }),
    ),
  };
}

function loadStrategy(): Strategy | null {
  const file = path.join(REPO_ROOT, "config", "strategy.json");
  if (!fs.existsSync(file)) return null;

  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Strategy;
  } catch {
    return null;
  }
}

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatSignedPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(digits)}%`;
}

function formatCurrency(value: number | null | undefined) {
  return `${NUMBER_FORMATTER.format(value ?? 0)}원`;
}

function formatSignedCurrency(value: number | null | undefined) {
  const safeValue = value ?? 0;
  return `${safeValue > 0 ? "+" : ""}${NUMBER_FORMATTER.format(safeValue)}원`;
}

function formatMetricCount(
  value: number | null | undefined,
  unit: string,
  fallback = "집계 중",
) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return `${NUMBER_FORMATTER.format(value)}${unit}`;
}

function formatPctPoint(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function formatMarketIndexLevel(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return MARKET_VALUE_FORMATTER.format(value);
}

function describeMarketFlow(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "등락 대기";
  }

  if (value === 0) {
    return "보합";
  }

  return value > 0 ? "상승 우위" : "하락 우위";
}

function cleanDisplayText(value: string | null | undefined) {
  if (!value) return "";

  return value
    .replace(/\*\*/g, "")
    .replace(/^[-*•\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeDisplayLines(items: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const cleanedItems: string[] = [];

  for (const item of items) {
    const cleaned = cleanDisplayText(item);
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleanedItems.push(cleaned);
  }

  return cleanedItems;
}

function summarizeNarrative(value: string | null | undefined, maxLength = 120) {
  const cleaned = cleanDisplayText(value);
  if (!cleaned) return null;

  const firstSentence =
    cleaned.split(/(?<=[.!?。]|다\.)\s+/).find((sentence) => sentence.trim().length > 0) ??
    cleaned;
  const summary = firstSentence.length >= 28 ? firstSentence : cleaned;

  return summary.length > maxLength
    ? `${summary.slice(0, maxLength).trimEnd()}...`
    : summary;
}

function normalizeMarketChangePct(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.abs(value) <= 1 ? value * 100 : value;
}

function deriveMarketChangePct({
  close,
  changePct,
  previousClose,
  history,
}: {
  close: number | null | undefined;
  changePct: number | null | undefined;
  previousClose?: number | null;
  history: number[];
}) {
  const normalized = normalizeMarketChangePct(changePct);
  if (normalized != null) {
    return normalized;
  }

  const validHistory = history.filter((value) => Number.isFinite(value));
  const latestClose =
    typeof close === "number" && Number.isFinite(close)
      ? close
      : validHistory[validHistory.length - 1];
  const baselineClose =
    typeof previousClose === "number" &&
    Number.isFinite(previousClose) &&
    previousClose !== 0
      ? previousClose
      : validHistory.length >= 2
        ? validHistory[validHistory.length - 2]
        : null;

  if (
    typeof latestClose !== "number" ||
    !Number.isFinite(latestClose) ||
    typeof baselineClose !== "number" ||
    !Number.isFinite(baselineClose) ||
    baselineClose === 0
  ) {
    return null;
  }

  return ((latestClose - baselineClose) / baselineClose) * 100;
}

function scoreMeta(score: number | null | undefined) {
  if (typeof score !== "number") {
    return {
      label: "데이터 준비 중",
      description: "아직 충분한 근거가 쌓이지 않았습니다.",
      chipClass: "border-white/8 bg-white/[0.03] text-zinc-300",
      accentClass: "text-zinc-100",
      cardClass: "border-white/8 bg-white/[0.03]",
    };
  }

  if (score >= 75) {
    return {
      label: "안정 구간",
      description: "현 배분이 비교적 목표 범위에 근접합니다.",
      chipClass: "border-blue-500/30 bg-blue-500/14 text-blue-200",
      accentClass: "text-blue-300",
      cardClass: "border-blue-500/18 bg-blue-500/10",
    };
  }

  if (score >= 55) {
    return {
      label: "보강 필요",
      description: "보완할 자산과 계좌가 분명하게 보입니다.",
      chipClass: "border-amber-500/30 bg-amber-500/12 text-amber-200",
      accentClass: "text-amber-200",
      cardClass: "border-amber-500/18 bg-amber-500/10",
    };
  }

  return {
    label: "조정 우선",
    description: "배분과 근거를 먼저 재정렬할 시점입니다.",
    chipClass: "border-rose-500/30 bg-rose-500/14 text-rose-200",
    accentClass: "text-rose-200",
    cardClass: "border-rose-500/18 bg-rose-500/10",
  };
}

function researchTagClass(tone: string) {
  if (tone === "rose") return "border-rose-500/30 bg-rose-500/14 text-rose-300";
  if (tone === "sky") return "border-blue-500/30 bg-blue-500/14 text-blue-300";
  if (tone === "emerald") return "border-sky-500/30 bg-sky-500/14 text-sky-300";
  if (tone === "amber") return "border-amber-500/30 bg-amber-500/14 text-amber-300";
  if (tone === "fuchsia") return "border-indigo-500/30 bg-indigo-500/14 text-indigo-300";
  return "border-white/8 bg-white/[0.03] text-zinc-300";
}

function buildResearchSectionLabel(title: string, index: number) {
  const normalized = title.replace(/\([^)]*\)/g, "").trim();

  if (/오늘 한 줄 진단/i.test(normalized)) return "진단";
  if (/촉매/i.test(normalized)) return "촉매";
  if (/macro/i.test(normalized) || /매크로|거시/.test(normalized)) return "매크로";
  if (/strategy/i.test(normalized) || /이번 주 대응/.test(normalized)) return "전략";
  if (/action/i.test(normalized) || /오늘 실행/.test(normalized)) return "실행";
  if (/시사점/.test(normalized)) return "시사점";
  if (/체크포인트/.test(normalized)) return "체크";

  return `Section ${index + 1}`;
}

function normalizeLookupValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

function formatResearchAccountLabel(
  label: string,
  accounts: PortfolioAccount[] | undefined,
) {
  const normalized = normalizeLookupValue(label);
  const matched = accounts?.find((account) => {
    const candidates = [account.key, account.label].filter(Boolean);
    return candidates.some((candidate) => normalizeLookupValue(candidate) === normalized);
  });

  if (matched) {
    return matched.label;
  }

  if (/pension|연금/i.test(label)) return "연금저축";
  if (/toss|토스/i.test(label)) return "토스증권";
  if (/kis|한투|한국투자/i.test(label)) return "한투 일반";
  if (/isa/i.test(label)) return "ISA";
  return label;
}

function buildMarketMood(indices: Record<string, MarketIndex>) {
  const changes = Object.values(indices)
    .map((item) => item.change_pct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (changes.length === 0) {
    return {
      label: "시장 데이터 대기",
      description: "핵심 지수가 들어오면 시장 모멘텀을 이곳에 압축해 보여줍니다.",
      chipClass: "border-white/8 bg-white/[0.03] text-zinc-300",
    };
  }

  const average = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const positives = changes.filter((value) => value > 0).length;

  if (average > 0.45 || positives >= Math.ceil(changes.length * 0.7)) {
    return {
      label: "리스크 온",
      description: "주요 지수의 상승 우위가 확인됩니다. 공격적 비중 확대는 기술 신호와 함께 확인하는 편이 안전합니다.",
      chipClass: "border-rose-500/30 bg-rose-500/14 text-rose-200",
    };
  }

  if (average < -0.45 || positives <= Math.floor(changes.length * 0.3)) {
    return {
      label: "리스크 오프",
      description: "주요 지수에 하방 압력이 있습니다. 신규 진입보다 현금 여력과 방어 자산 비중을 먼저 점검하는 흐름입니다.",
      chipClass: "border-sky-500/30 bg-sky-500/14 text-sky-200",
    };
  }

  return {
    label: "혼조 장세",
    description: "지수 방향성이 엇갈립니다. 거시 요약과 계좌별 목표 배분을 같이 보고 선택지를 좁히는 구간입니다.",
    chipClass: "border-blue-500/30 bg-blue-500/14 text-blue-200",
  };
}

function buildPriorityGaps(portfolioGuide: PortfolioGuide | null): PriorityGapItem[] {
  if (!portfolioGuide) return [];

  return portfolioGuide.accounts
    .flatMap((account) =>
      account.categories
        .filter((category) => category.action !== "유지")
        .map((category) => ({
          id: `${account.key}-${category.category}`,
          accountLabel: account.label,
          category: category.category,
          action: category.action,
          gapPct: category.gapPct,
          gapAmount: category.gapAmount,
          preferredLabel: category.preferredLabel,
        })),
    )
    .sort((left, right) => {
      const leftPriority = left.action === "보강 필요" ? 0 : 1;
      const rightPriority = right.action === "보강 필요" ? 0 : 1;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return Math.abs(right.gapAmount) - Math.abs(left.gapAmount);
    });
}

function buildDataQualitySummary(
  portfolioGuide: PortfolioGuide | null,
  focusAccount: PortfolioGuide["accounts"][number] | null,
) {
  const dataQualityPenalty =
    focusAccount?.riskPenaltyBreakdown?.dataQuality?.total ?? null;

  if ((portfolioGuide?.incompleteCount ?? 0) > 0) {
    return {
      label: "주의",
      detail: `부분 캡처 계좌 ${portfolioGuide?.incompleteCount ?? 0}개가 있어 일부 계산은 참고용입니다.`,
      tone: "caution" as const,
    };
  }

  if (typeof dataQualityPenalty === "number" && dataQualityPenalty > 0) {
    return {
      label: `패널티 ${dataQualityPenalty.toFixed(1)}점`,
      detail: "누락 또는 미분류 노출이 감지돼 데이터 품질 감점이 반영됐습니다.",
      tone: "caution" as const,
    };
  }

  return {
    label: "정상",
    detail: "현재 스냅샷 기준 큰 데이터 누락 없이 점수 계산에 반영됐습니다.",
    tone: "brand" as const,
  };
}

function SummaryMetricCard({
  kicker,
  value,
  detail,
  tone = "neutral",
  compact = false,
}: {
  kicker: string;
  value: string;
  detail: string;
  tone?: "brand" | "up" | "down" | "caution" | "risk" | "info" | "neutral";
  compact?: boolean;
}) {
  const toneClasses =
    tone === "brand"
      ? "border-blue-500/18 bg-blue-500/10"
      : tone === "up"
        ? "border-rose-500/18 bg-rose-500/10"
        : tone === "down"
          ? "border-sky-500/18 bg-sky-500/10"
          : tone === "caution"
            ? "border-amber-500/18 bg-amber-500/10"
            : tone === "risk"
              ? "border-rose-500/18 bg-rose-500/10"
              : tone === "info"
                ? "border-indigo-500/18 bg-indigo-500/10"
            : "border-white/8 bg-white/[0.03]";

  return (
    <div className={joinClasses("glass-panel-soft rounded-[1.45rem] p-4", toneClasses)}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {kicker}
      </p>
      <p
        className={joinClasses(
          "mt-2 font-semibold tracking-tight text-zinc-50",
          compact ? "text-xl leading-snug" : "text-[1.85rem]",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-400">{detail}</p>
    </div>
  );
}

function ScoreFactorTile({
  label,
  value,
  detail,
  tone = "zinc",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "emerald" | "amber" | "rose" | "sky" | "zinc";
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-blue-500/16 bg-blue-500/10 text-blue-200"
      : tone === "amber"
        ? "border-amber-500/16 bg-amber-500/10 text-amber-200"
        : tone === "rose"
          ? "border-rose-500/16 bg-rose-500/10 text-rose-200"
          : tone === "sky"
            ? "border-sky-500/16 bg-sky-500/10 text-sky-200"
            : "border-white/8 bg-white/[0.03] text-zinc-100";

  return (
    <div className={joinClasses("rounded-[1.25rem] border p-4", toneClasses)}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-400">{detail}</p>
    </div>
  );
}

function PriorityGapCard({ item }: { item: PriorityGapItem }) {
  const isBuildUp = item.action === "보강 필요";
  const toneClass = isBuildUp
    ? "border-blue-500/16 bg-blue-500/10"
    : "border-amber-500/16 bg-amber-500/10";

  return (
    <article className={joinClasses("glass-panel-soft rounded-[1.45rem] p-4", toneClass)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {item.accountLabel}
          </p>
          <h3 className="mt-2 text-base font-semibold text-zinc-50">
            {item.category}
          </h3>
        </div>
        <span
          className={joinClasses(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            isBuildUp
              ? "border-blue-500/30 bg-blue-500/14 text-blue-200"
              : "border-amber-500/30 bg-amber-500/14 text-amber-200",
          )}
        >
          {item.action}
        </span>
      </div>

      <p className="mt-3 text-sm text-zinc-300">
        {isBuildUp ? "목표보다 " : "목표 대비 "}
        <span className={isBuildUp ? "text-blue-200" : "text-amber-200"}>
          {formatPctPoint(Math.abs(item.gapPct) * 100)}
        </span>
        {isBuildUp ? " 부족합니다." : " 초과입니다."}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        예상 영향 금액 {formatSignedCurrency(item.gapAmount)}
      </p>
      {item.preferredLabel && (
        <p className="mt-3 text-sm text-zinc-400">
          대표 자산: <span className="text-zinc-200">{item.preferredLabel}</span>
        </p>
      )}
    </article>
  );
}

function MarketIndexRow({
  label,
  close,
  changePct,
}: {
  label: string;
  close: number | null | undefined;
  changePct: number | null | undefined;
}) {
  const hasChangePct = typeof changePct === "number" && Number.isFinite(changePct);
  const toneClass = !hasChangePct
    ? "text-zinc-400"
    : changePct > 0
      ? "text-rose-200"
      : changePct < 0
        ? "text-sky-200"
        : "text-zinc-300";

  return (
    <div className="flex flex-col gap-1 border-b border-white/6 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="flex items-baseline gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          {label}
        </p>
        <p className="text-sm font-semibold tabular-nums text-zinc-100 md:text-base">
          {formatMarketIndexLevel(close)}
        </p>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className={joinClasses("font-medium tabular-nums", toneClass)}>
          {hasChangePct ? formatSignedPercent(changePct, 2) : "등락 대기"}
        </span>
        <span className="text-zinc-500">{describeMarketFlow(changePct)}</span>
      </div>
    </div>
  );
}

function PortfolioAccountCard({
  account,
  guideScore = null,
}: {
  account: PortfolioAccount;
  guideScore?: number | null;
}) {
  const profitPositive = (account.profitLoss ?? 0) > 0;
  const profitNegative = (account.profitLoss ?? 0) < 0;
  const profitClass = profitPositive
    ? "text-rose-300"
    : profitNegative
      ? "text-sky-300"
      : "text-zinc-300";

  const holdingsProfitLoss = getAccountHoldingsProfitLoss(account);
  const holdingsProfitRate = getAccountHoldingsProfitRate(account);
  const holdingsProfitClass =
    holdingsProfitLoss > 0
      ? "text-rose-300"
      : holdingsProfitLoss < 0
        ? "text-sky-300"
        : "text-zinc-300";
  const guideMeta = scoreMeta(guideScore);

  return (
    <div className="glass-panel-soft rounded-[1.55rem] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-50">{account.label}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {account.accountNumber || "계좌번호 미입력"}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {typeof guideScore === "number" && (
            <span
              className={joinClasses(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                guideMeta.chipClass,
              )}
            >
              {guideScore}점
            </span>
          )}
          {account.incomplete && (
            <span className="rounded-full border border-amber-500/30 bg-amber-950/25 px-2 py-1 text-[11px] text-amber-200">
              부분 캡처
            </span>
          )}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs text-zinc-500">총 평가금액</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">
          {formatCurrency(account.evaluationAmount)}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">예수금</p>
          <p className="mt-2 tabular-nums text-zinc-200">
            {formatCurrency(account.cashAvailable)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">손익</p>
          <p className={joinClasses("mt-2 tabular-nums", profitClass)}>
            {formatSignedCurrency(account.profitLoss)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
        <span>보유 종목 {getAccountHoldingCount(account)}개</span>
        <span className={profitClass}>{formatSignedPercent(account.profitRate)}</span>
      </div>

      {account.holdings.length > 0 && (
        <>
          <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
            <span>보유 종목 합산 손익</span>
            <span className={joinClasses("font-medium", holdingsProfitClass)}>
              {formatSignedCurrency(holdingsProfitLoss)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>보유 종목 합산 수익률</span>
            <span className={joinClasses("font-medium", holdingsProfitClass)}>
              {formatSignedPercent(holdingsProfitRate)}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {account.holdings.map((holding) => (
              <span
                key={`${account.key}-${holding.code ?? holding.name}`}
                className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300"
              >
                {holding.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StageSeparator({
  orderClass,
  fromLabel,
  toLabel,
  title,
  detail,
  tone = "sky",
}: {
  orderClass: string;
  fromLabel: string;
  toLabel: string;
  title: string;
  detail: string;
  tone?: "sky" | "emerald" | "amber";
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-blue-500/18 bg-blue-500/10 text-blue-200"
      : tone === "amber"
        ? "border-amber-500/18 bg-amber-500/10 text-amber-200"
        : "border-indigo-500/18 bg-indigo-500/10 text-indigo-200";

  return (
    <section className={joinClasses("scroll-mt-32", orderClass)}>
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <div
            className={joinClasses(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium",
              toneClasses,
            )}
          >
            <span>{fromLabel}</span>
            <ChevronsDown size={14} />
            <span>{toLabel}</span>
          </div>
          <div className="h-px flex-1 bg-white/10" />
        </div>
        <div className="mt-3 text-center">
          <p className="text-sm font-medium text-zinc-200">{title}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{detail}</p>
        </div>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const briefing = loadReports()[0] ?? null;
  const market = loadLatestMarket();
  const strategy = loadStrategy();
  const portfolio = loadLatestPortfolio();
  const portfolioGuide = portfolio ? buildPortfolioGuide(portfolio) : null;
  const recommendationBoard = loadRecommendationBoard(
    briefing?.date ?? portfolio?.date ?? market?.date,
  );
  const researchBriefings = loadResearchBriefings();
  const targetResearchDate =
    briefing?.effectiveMarketDate ?? briefing?.date ?? portfolio?.date ?? market?.date ?? null;
  const researchBriefing = targetResearchDate
    ? researchBriefings.find(
        (doc) =>
          doc.effectiveMarketDate === targetResearchDate ||
          doc.runDate === targetResearchDate ||
          doc.date === targetResearchDate,
      ) ?? null
    : researchBriefings[0] ?? null;
  const researchSections = researchBriefing
    ? extractResearchSections(researchBriefing.content)
        .filter((section) => !isStructuredResearchSectionTitle(section.title))
    : [];
  const researchDiagnosis = researchBriefing
    ? extractResearchDiagnosis(researchBriefing.content)
    : null;
  const researchCatalysts = researchBriefing
    ? extractResearchCatalystTimeline(researchBriefing.content, 6)
    : [];
  const researchCheckpoints = researchBriefing
    ? extractResearchCheckpoints(researchBriefing.content, 8)
    : [];
  const researchStrategyGuide = researchBriefing
    ? extractResearchStrategyGuide(researchBriefing.content)
    : {
        cashGuidance: null,
        weeklyPriority: null,
        accountGoals: [],
        supportingPoints: [],
      };
  const researchActionGroups = researchBriefing
    ? extractResearchActionGroups(researchBriefing.content, 4)
    : [];
  const researchPortfolioInsights = researchBriefing
    ? extractResearchPortfolioInsights(researchBriefing.content)
    : {
        strengths: [],
        vulnerabilities: [],
        upgradeAxes: [],
      };
  const researchScenarioBranches = researchBriefing
    ? extractResearchScenarioBranches(researchBriefing.content, 2)
    : [];
  const researchOverview = getResearchBriefingOverview(researchBriefing);
  const researchMetricTones = ["info", "brand", "neutral", "caution"] as const;
  const researchTags = researchBriefing
    ? extractResearchTags(researchBriefing.content, 8)
    : [];
  const researchActionPoints = researchBriefing
    ? dedupeDisplayLines(extractResearchActionPoints(researchBriefing.content, 4))
    : [];
  const researchSectionTabs: ResearchSectionTabItem[] = researchSections.map(
    (section, index) => ({
      id: `dashboard-research-section-${index + 1}`,
      label: buildResearchSectionLabel(section.title, index),
      title: section.title,
      body: section.body,
      tags: extractResearchTags(`${section.title}\n${section.body}`, 5),
      actionPoints: dedupeDisplayLines(extractResearchActionPoints(section.body, 2)),
    }),
  );
  const briefingDateLine = briefing
    ? formatDateContextLine({
        runDate: briefing.runDate,
        effectiveMarketDate: briefing.effectiveMarketDate,
      })
    : null;
  const researchDateLine = researchBriefing
    ? formatDateContextLine({
        runDate: researchBriefing.runDate,
        effectiveMarketDate: researchBriefing.effectiveMarketDate,
      })
    : null;

  const indices = market?.indices ?? {};
  const hasMarket = Object.keys(indices).length > 0;
  const totals = portfolio ? getPortfolioTotals(portfolio) : null;
  const marketMood = buildMarketMood(indices);
  const mainScenario =
    researchScenarioBranches.find((branch) => /(main|base|기준|메인)/i.test(branch.label)) ??
    researchScenarioBranches[0] ??
    null;
  const heroMacroSummary = summarizeNarrative(
    researchDiagnosis ?? marketMood.description,
    150,
  );
  const heroStrategySummary = summarizeNarrative(
    portfolioGuide?.globalActions[0] ??
      researchStrategyGuide.weeklyPriority ??
      mainScenario?.response ??
      null,
    100,
  );
  const decisionMacroSummary =
    summarizeNarrative(
      mainScenario?.response ?? researchDiagnosis ?? marketMood.description,
      96,
    ) ?? marketMood.description;
  const decisionStrategySummary =
    summarizeNarrative(
      portfolioGuide?.globalActions[0] ??
        researchStrategyGuide.weeklyPriority ??
        "이번 주는 계좌별 목표 비중과 대기 자금 배치를 먼저 확인합니다.",
      92,
    ) ?? "이번 주는 계좌별 목표 비중과 대기 자금 배치를 먼저 확인합니다.";
  const showResearchStrategyCards =
    researchStrategyGuide.accountGoals.length > 0 ||
    researchPortfolioInsights.strengths.length > 0 ||
    researchPortfolioInsights.vulnerabilities.length > 0 ||
    researchPortfolioInsights.upgradeAxes.length > 0;
  const macroTargetId =
    researchBriefing && (researchSections.length > 0 || researchScenarioBranches.length > 0)
      ? "macro-view"
      : hasMarket
        ? "macro-view"
        : null;
  const strategyTargetId = portfolioGuide ? "strategy-overview" : portfolio ? "strategy-overview" : null;
  const actionTargetId = portfolioGuide || recommendationBoard ? "action-overview" : null;
  const hasMacroView =
    hasMarket ||
    !!researchBriefing ||
    researchScenarioBranches.length > 0;
  const hasStrategyView = !!(portfolioGuide || portfolio || strategy);
  const hasActionView = !!(portfolioGuide || recommendationBoard);
  const sectionIndexItems = [
    hasMacroView && macroTargetId
      ? { id: macroTargetId, label: "거시", secondaryLabel: "방향" }
      : null,
    hasStrategyView && strategyTargetId
      ? { id: strategyTargetId, label: "주간", secondaryLabel: "전략" }
      : null,
    hasActionView && actionTargetId
      ? { id: actionTargetId, label: "오늘", secondaryLabel: "실행" }
      : null,
  ].filter(Boolean) as FloatingSectionIndexItem[];

  const focusAccount =
    portfolioGuide?.accounts
      .slice()
      .sort((left, right) => left.score - right.score)[0] ?? null;
  const focusScoreMeta = scoreMeta(focusAccount?.score ?? portfolioGuide?.score ?? null);
  const globalScoreMeta = scoreMeta(portfolioGuide?.score ?? null);
  const priorityGaps = buildPriorityGaps(portfolioGuide);
  const topPriority = priorityGaps[0] ?? null;
  const dataQualitySummary = buildDataQualitySummary(portfolioGuide, focusAccount);
  const strategyProgress =
    strategy?.dca_plan?.total_tranches &&
    typeof strategy?.dca_plan?.completed === "number"
      ? `${strategy.dca_plan.completed}/${strategy.dca_plan.total_tranches}`
      : null;
  const nextStrategyStep =
    strategy?.dca_plan?.schedule?.find(
      (item) => item.status !== "done" && item.status !== "completed",
    ) ?? null;
  const scoreFactors = focusAccount
    ? [
        {
          label: "배분 점수",
          value: `${focusAccount.allocationScore}점`,
          detail: "목표 배분과 현재 비중 차이를 반영합니다.",
          tone: "sky" as const,
        },
        {
          label: "기술 점수",
          value:
            focusAccount.technicalScore != null
              ? `${focusAccount.technicalScore}점`
              : "데이터 부족",
          detail: "보유 종목 기술 신호의 가중 평균입니다.",
          tone:
            focusAccount.technicalScore != null && focusAccount.technicalScore >= 55
              ? ("emerald" as const)
              : ("amber" as const),
        },
        {
          label: "리포트 점수",
          value:
            focusAccount.reportScore != null
              ? `${focusAccount.reportScore}점`
              : "직접 신호 부족",
          detail:
            focusAccount.reportStatus === "available"
              ? "직접 연결된 리포트 영향이 반영됩니다."
              : "관련 리포트 커버리지가 부족합니다.",
          tone:
            focusAccount.reportStatus === "available"
              ? ("emerald" as const)
              : ("zinc" as const),
        },
        {
          label: "리스크 패널티",
          value:
            focusAccount.riskPenaltyTotal != null
              ? `-${focusAccount.riskPenaltyTotal.toFixed(1)}점`
              : "없음",
          detail: "데이터 품질, 집중도, 레짐 스트레스 감점을 포함합니다.",
          tone:
            focusAccount.riskPenaltyTotal != null && focusAccount.riskPenaltyTotal > 0
              ? ("rose" as const)
              : ("emerald" as const),
        },
      ]
    : [];
  const scoreDrivers = focusAccount?.scoreDrivers.slice(0, 4) ?? [];
  const improvementActions = focusAccount?.improvementActions.slice(0, 3) ?? [];
  const heroDescription = mainScenario
    ? [heroMacroSummary, heroStrategySummary ? `이번 주 전략은 ${heroStrategySummary}` : null]
        .filter(Boolean)
        .join(" ")
    : portfolioGuide
      ? [
          heroMacroSummary ??
            `현재 총 평가금액은 ${formatCurrency(totals?.totalEvaluationAmount)}입니다.`,
          heroStrategySummary ? `이번 주 전략은 ${heroStrategySummary}` : null,
        ]
          .filter(Boolean)
          .join(" ")
      : "거시 방향성부터 이번 주 전략, 오늘 실행 순서로 판단할 수 있게 화면을 재정렬했습니다.";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-2.5 py-4 md:gap-8 md:px-6 md:py-8">
      <section className="glass-panel relative overflow-hidden rounded-[1.7rem] p-4 md:p-7 lg:p-8">
        <div className="absolute -right-12 -top-14 h-44 w-44 rounded-full bg-blue-400/12 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-36 w-36 rounded-full bg-indigo-400/12 blur-3xl" />

        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.35fr),22rem]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                Macro - Strategy - Action
              </span>
              {briefingDateLine && (
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
                  {briefingDateLine}
                </span>
              )}
            </div>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-300 md:text-base">
              {heroDescription}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className={joinClasses("rounded-full border px-3 py-1 text-xs", marketMood.chipClass)}>
                {marketMood.label}
              </span>
              {researchTags.slice(0, 3).map((tag) => (
                <span
                  key={tag.label}
                  className={joinClasses("rounded-full border px-3 py-1 text-xs", researchTagClass(tag.tone))}
                >
                  {tag.label}
                </span>
              ))}
              {strategyProgress && (
                <span className="rounded-full border border-blue-500/30 bg-blue-500/14 px-3 py-1 text-xs text-blue-200">
                  분할매수 {strategyProgress}
                </span>
              )}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryMetricCard
                kicker="총 평가금액"
                value={formatCurrency(totals?.totalEvaluationAmount)}
                detail={`보유 ${totals?.totalHoldingCount ?? 0}개 · 손익 ${formatSignedCurrency(
                  totals?.totalHoldingsProfitLoss,
                )} · 수익률 ${formatSignedPercent(totals?.totalHoldingsProfitRate)}`}
                tone={
                  (totals?.totalHoldingsProfitLoss ?? 0) >= 0 ? "up" : "down"
                }
              />
              <SummaryMetricCard
                kicker="운용 점수"
                value={
                  typeof portfolioGuide?.score === "number"
                    ? `${portfolioGuide.score}점`
                    : "미산출"
                }
                detail={globalScoreMeta.description}
                tone={
                  portfolioGuide?.score != null && portfolioGuide.score >= 75
                    ? "brand"
                    : portfolioGuide?.score != null && portfolioGuide.score >= 55
                      ? "caution"
                      : "risk"
                }
              />
              <SummaryMetricCard
                kicker="1순위 액션"
                value={
                  topPriority
                    ? `${topPriority.accountLabel} · ${topPriority.category}`
                    : "유지 우선"
                }
                detail={
                  topPriority
                    ? `${topPriority.action} ${formatPctPoint(
                        Math.abs(topPriority.gapPct) * 100,
                      )} · 예상 영향 ${formatSignedCurrency(topPriority.gapAmount)}`
                    : "급한 보강보다 기존 비중 유지가 우선입니다."
                }
                tone={topPriority?.action === "보강 필요" ? "brand" : "caution"}
                compact
              />
              <SummaryMetricCard
                kicker="데이터 상태"
                value={dataQualitySummary.label}
                detail={dataQualitySummary.detail}
                tone={dataQualitySummary.tone}
                compact
              />
            </div>
          </div>

          <aside className="mobile-flat-chrome glass-panel-soft rounded-[1.5rem] p-0 md:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="section-kicker">Decision Flow</p>
                <h2 className="mt-2 text-xl font-semibold text-zinc-50">
                  {"Macro -> Strategy -> Action"}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  방향성을 먼저 정리한 뒤, 이번 주 전략과 오늘 실행 순서로 내려오도록 재배치했습니다.
                </p>
              </div>
              <span className={joinClasses("rounded-full border px-2.5 py-1 text-[11px]", globalScoreMeta.chipClass)}>
                {globalScoreMeta.label}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-[1.2rem] border border-blue-500/20 bg-blue-500/10 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  1. Macro View
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  {mainScenario
                    ? `${mainScenario.label}${mainScenario.probabilityLabel ? ` · ${mainScenario.probabilityLabel}` : ""}`
                    : marketMood.label}
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {decisionMacroSummary}
                </p>
              </div>

              <div className="rounded-[1.2rem] border border-indigo-500/20 bg-indigo-500/10 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  2. Strategy
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  현금 {portfolioGuide ? formatPercent(portfolioGuide.totalCashPct * 100) : "-"} · 다음 단계{" "}
                  {portfolioGuide ? formatPercent(portfolioGuide.nextTranchePct * 100, 0) : "-"}
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {decisionStrategySummary}
                </p>
              </div>

              <div className="rounded-[1.2rem] border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  3. Action
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  {topPriority
                    ? `${topPriority.accountLabel} · ${topPriority.category}`
                    : "오늘 실행 체크"}
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {topPriority
                    ? `${topPriority.action} ${formatPctPoint(Math.abs(topPriority.gapPct) * 100)}`
                    : "마지막에 추천과 체크리스트로 오늘 실행만 남깁니다."}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <SectionJumpButton
                targetId={macroTargetId}
                clearSearchParams={["account", "actionAccount", "actionCode", "preflight"]}
                className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
              >
                거시방향
                <ArrowUpRight size={14} />
              </SectionJumpButton>
              <SectionJumpButton
                targetId={strategyTargetId}
                clearSearchParams={["actionAccount", "actionCode", "preflight"]}
                className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
              >
                주간전략
                <ArrowUpRight size={14} />
              </SectionJumpButton>
              <SectionJumpButton
                targetId={actionTargetId}
                clearSearchParams={["actionAccount", "actionCode", "preflight"]}
                className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
              >
                오늘실행
                <ArrowUpRight size={14} />
              </SectionJumpButton>
            </div>
          </aside>
        </div>
      </section>

      {hasMarket && (
        <section
          id={
            researchBriefing && (researchSections.length > 0 || researchScenarioBranches.length > 0)
              ? "market-overview"
              : "macro-view"
          }
          className="section-shell order-20 scroll-mt-32"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="section-kicker">Macro Dashboard</p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                시장 지표
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                방향성 판단을 뒷받침하는 숫자를 먼저 정리해 둡니다.
              </p>
            </div>
            <span className={joinClasses("rounded-full border px-3 py-1.5 text-sm font-medium", marketMood.chipClass)}>
              {marketMood.label}
            </span>
          </div>

          <div className="mt-5 border-y border-white/8 px-1 md:px-2">
            {Object.entries(indices).map(([key, value]) => (
              <MarketIndexRow
                key={key}
                label={key}
                close={value.close}
                changePct={value.change_pct}
              />
            ))}
          </div>
        </section>
      )}

      {(portfolio || strategy) && (
        <section
          id={portfolioGuide ? "portfolio-overview" : "strategy-overview"}
          className="section-shell order-50 scroll-mt-32"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="section-kicker">Account Detail</p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                계좌별 상세 현황
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                전략과 실행을 본 뒤, 마지막에 계좌별 잔고와 보유 상태를 세부적으로 확인합니다.
              </p>
              {strategyProgress && (
                <p className="mt-3 text-sm text-blue-200">
                  분할매수 진행 {strategyProgress}
                  {nextStrategyStep?.target_date
                    ? ` · 다음 단계 예정 ${nextStrategyStep.target_date}`
                    : ""}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/portfolio"
                className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
              >
                상세 보기
              </Link>
              <Link
                href="/portfolio/update"
                className="inline-flex items-center rounded-full border border-blue-500/25 bg-blue-500/14 px-4 py-2 text-sm font-medium text-blue-100 transition hover:bg-blue-500/20"
              >
                캡처 업데이트
              </Link>
            </div>
          </div>

          {portfolio ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryMetricCard
                  kicker="총 평가금액"
                  value={formatCurrency(totals?.totalEvaluationAmount)}
                  detail="최신 스냅샷 기준 자산 합계"
                  tone="info"
                />
                <SummaryMetricCard
                  kicker="보유 종목"
                  value={`${totals?.totalHoldingCount ?? 0}개`}
                  detail="전체 계좌 합산 기준"
                  tone="neutral"
                  compact
                />
                <SummaryMetricCard
                  kicker="합산 손익"
                  value={formatSignedCurrency(totals?.totalHoldingsProfitLoss)}
                  detail={`수익률 ${formatSignedPercent(totals?.totalHoldingsProfitRate)}`}
                  tone={
                    (totals?.totalHoldingsProfitLoss ?? 0) >= 0 ? "up" : "down"
                  }
                  compact
                />
                <SummaryMetricCard
                  kicker="총 현금 비중"
                  value={
                    portfolioGuide
                      ? formatPercent(portfolioGuide.totalCashPct * 100)
                      : "-"
                  }
                  detail="대기 자금과 방어 비중을 함께 반영"
                  tone="caution"
                  compact
                />
              </div>

              <div className="mt-5 md:hidden -mx-3 overflow-x-auto px-3">
                <div className="flex gap-3 pb-1">
                  {portfolio.accounts.map((account) => (
                    <div key={account.key} className="min-w-[305px] max-w-[305px]">
                      <PortfolioAccountCard
                        account={account}
                        guideScore={
                          portfolioGuide?.accounts.find((item) => item.key === account.key)?.score ??
                          null
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-3">
                {portfolio.accounts.map((account) => (
                  <PortfolioAccountCard
                    key={account.key}
                    account={account}
                    guideScore={
                      portfolioGuide?.accounts.find((item) => item.key === account.key)?.score ??
                      null
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-[1.45rem] border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-400">
              아직 저장된 포트폴리오 스냅샷이 없습니다. 캡처를 업로드하면 이 화면에서 계좌별 액션을 바로 제안합니다.
            </div>
          )}
        </section>
      )}

      {portfolioGuide && (
        <section
          id="strategy-overview"
          className="order-30 scroll-mt-32"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="section-kicker">Strategy</p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                이번 주 대응
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                거시 시나리오를 바탕으로 현금 비중과 계좌별 목표를 먼저 맞춘 뒤, 오늘 실행으로 내려갑니다.
              </p>
              {portfolioGuide.analysisDateLabel && (
                <p className="mt-3 text-xs text-zinc-500">
                  기준 {portfolioGuide.analysisDateLabel}
                </p>
              )}
            </div>
            <span
              className={joinClasses(
                "inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-sm font-medium",
                globalScoreMeta.chipClass,
              )}
            >
              {portfolioGuide.score}점 · {globalScoreMeta.label}
            </span>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.15fr),minmax(0,0.85fr)]">
            <div className="section-block">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-kicker">Explainable Score</p>
                  <h3 className="mt-2 text-xl font-semibold text-zinc-50">
                    왜 이 점수인가
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {focusAccount
                      ? `${focusAccount.label} 계좌는 ${focusAccount.score}점으로 ${focusScoreMeta.label} 구간입니다.`
                      : "점수 산정 근거가 여기에 표시됩니다."}
                  </p>
                </div>
                {focusAccount && (
                  <span
                    className={joinClasses(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      focusScoreMeta.chipClass,
                    )}
                  >
                    Focus {focusAccount.label}
                  </span>
                )}
              </div>

              {scoreFactors.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {scoreFactors.map((factor) => (
                    <ScoreFactorTile
                      key={factor.label}
                      label={factor.label}
                      value={factor.value}
                      detail={factor.detail}
                      tone={factor.tone}
                    />
                  ))}
                </div>
              )}

              {scoreDrivers.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm text-zinc-300">
                  {scoreDrivers.map((driver) => (
                    <li key={driver} className="flex gap-2">
                      <Sparkles size={15} className="mt-0.5 shrink-0 text-blue-300" />
                      <span>{driver}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              <div className="section-block">
                <p className="section-kicker">This Week Response</p>
                <h3 className="mt-2 text-xl font-semibold text-zinc-50">
                  현금 비중과 계좌별 목표
                </h3>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
                  <li className="flex gap-2">
                    <Target size={15} className="mt-1 shrink-0 text-amber-300" />
                    <span>
                      총 현금 비중 {formatPercent(portfolioGuide.totalCashPct * 100)} 기준으로
                      방어 여력을 유지합니다.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Target size={15} className="mt-1 shrink-0 text-blue-300" />
                    <span>
                      다음 분할매수 기준은 {formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
                      입니다.
                    </span>
                  </li>
                  {portfolioGuide.globalActions.slice(0, 2).map((action) => (
                    <li key={action} className="flex gap-2">
                      <Target size={15} className="mt-1 shrink-0 text-blue-300" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>

                {nextStrategyStep?.target_date && (
                  <div className="mt-5 rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      Next Step
                    </p>
                    <p className="mt-2 text-sm text-zinc-200">
                      다음 단계 예정일은 {nextStrategyStep.target_date} 입니다.
                    </p>
                  </div>
                )}
              </div>

              <div className="section-block">
                <div className="flex items-start gap-3">
                  {dataQualitySummary.tone === "brand" ? (
                    <ShieldCheck className="mt-0.5 shrink-0 text-blue-300" size={18} />
                  ) : (
                    <ShieldAlert className="mt-0.5 shrink-0 text-amber-300" size={18} />
                  )}
                  <div>
                    <p className="section-kicker">Data Integrity</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {dataQualitySummary.detail}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 md:hidden -mx-3 overflow-x-auto px-3">
            <div className="flex gap-3 pb-1">
              <SummaryMetricCard
                kicker="포트폴리오 운용 점수"
                value={`${portfolioGuide.score}점`}
                detail={globalScoreMeta.description}
                tone={
                  portfolioGuide.score >= 75
                    ? "brand"
                    : portfolioGuide.score >= 55
                      ? "caution"
                      : "risk"
                }
              />
              <SummaryMetricCard
                kicker="총 현금 비중"
                value={formatPercent(portfolioGuide.totalCashPct * 100)}
                detail="현금 파킹 포함"
                tone="caution"
              />
              <SummaryMetricCard
                kicker="이번 단계 기준"
                value={formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
                detail="다음 분할매수 비중"
                tone="info"
              />
            </div>
          </div>

          <div className="mt-5 hidden gap-3 md:grid md:grid-cols-3">
            <SummaryMetricCard
              kicker="포트폴리오 운용 점수"
              value={`${portfolioGuide.score}점`}
              detail={globalScoreMeta.description}
              tone={
                portfolioGuide.score >= 75
                  ? "brand"
                  : portfolioGuide.score >= 55
                    ? "caution"
                    : "risk"
              }
            />
            <SummaryMetricCard
              kicker="총 현금 비중"
              value={formatPercent(portfolioGuide.totalCashPct * 100)}
              detail="현금 파킹 포함"
              tone="caution"
            />
            <SummaryMetricCard
              kicker="이번 단계 기준"
              value={formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
              detail="다음 분할매수 비중"
              tone="info"
            />
          </div>

          {priorityGaps.length > 0 && (
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {priorityGaps.slice(0, 3).map((item) => (
                <PriorityGapCard key={item.id} item={item} />
              ))}
            </div>
          )}

          <div className="mt-5">
            <PortfolioGuidanceTabs
              accounts={portfolioGuide.accounts}
              analysisDateLabel={portfolioGuide.analysisDateLabel}
            />
          </div>

          {showResearchStrategyCards && (
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              <div className="section-block">
                <p className="section-kicker">Account Goals</p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                  계좌별 목표
                </h3>
                {researchStrategyGuide.accountGoals.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {researchStrategyGuide.accountGoals.map((item) => (
                      <div
                        key={`${item.account}-${item.goal}`}
                        className="rounded-[1.05rem] border border-white/8 bg-white/[0.03] p-3"
                      >
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          {formatResearchAccountLabel(item.account, portfolio?.accounts)}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-zinc-200">{item.goal}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-zinc-400">
                    이번 브리핑에는 별도 계좌 목표가 구조화되어 있지 않습니다.
                  </p>
                )}
              </div>

              <div className="section-block">
                <p className="section-kicker">Portfolio Insight</p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                  포트폴리오 시사점
                </h3>
                <div className="mt-4 space-y-4 text-sm">
                  {researchPortfolioInsights.strengths.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-blue-300">
                        좋은 점
                      </p>
                      <ul className="mt-2 space-y-1.5 text-zinc-300">
                        {researchPortfolioInsights.strengths.slice(0, 2).map((item) => (
                          <li key={item}>- {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {researchPortfolioInsights.vulnerabilities.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-rose-300">
                        취약점
                      </p>
                      <ul className="mt-2 space-y-1.5 text-zinc-300">
                        {researchPortfolioInsights.vulnerabilities.slice(0, 2).map((item) => (
                          <li key={item}>- {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {researchPortfolioInsights.upgradeAxes.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-sky-300">
                        보완 축
                      </p>
                      <ul className="mt-2 space-y-1.5 text-zinc-300">
                        {researchPortfolioInsights.upgradeAxes.slice(0, 3).map((item) => (
                          <li key={item}>- {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {hasMacroView && hasStrategyView && (
        <StageSeparator
          orderClass="order-[25]"
          fromLabel="거시방향"
          toLabel="주간전략"
          title="시나리오를 이번 주 운용 원칙으로 번역합니다."
          detail="시장 레짐과 시나리오를 보고, 이번 주 현금 비중과 계좌별 목표를 정합니다."
          tone="sky"
        />
      )}

      {hasActionView && (
        <section
          id="action-overview"
          className="section-shell order-40 scroll-mt-32"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="section-kicker">Action</p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                오늘의 실행
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                버튼, 체크리스트, 매수·매도 후보만 남겨서 바로 실행할 수 있게 구성했습니다.
              </p>
            </div>
            {topPriority && (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/14 px-3 py-1.5 text-sm font-medium text-blue-200">
                1순위 {topPriority.accountLabel} · {topPriority.category}
              </span>
            )}
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,0.85fr),minmax(0,1.15fr)]">
            <div className="section-block">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-kicker">Action Console</p>
                  <h3 className="mt-2 text-xl font-semibold text-zinc-50">
                    지금 바로 실행
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    최신 분석을 다시 돌리고, 실행에 필요한 화면으로 바로 이동합니다.
                  </p>
                </div>
                <span
                  className={joinClasses(
                    "rounded-full border px-2.5 py-1 text-[11px]",
                    globalScoreMeta.chipClass,
                  )}
                >
                  {globalScoreMeta.label}
                </span>
              </div>

              <div className="mt-4">
                <TriggerButton />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/portfolio/update"
                  className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
                >
                  포트 업데이트
                  <ArrowUpRight size={14} />
                </Link>
                <Link
                  href="/reports"
                  className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
                >
                  리포트 보기
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            </div>

            <div className="section-block">
              <p className="section-kicker">Today Checklist</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-50">
                오늘의 우선 지침
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
                {portfolioGuide?.globalActions?.length ? (
                  portfolioGuide.globalActions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <Target size={15} className="mt-1 shrink-0 text-blue-300" />
                      <span>{action}</span>
                    </li>
                  ))
                ) : (
                  <li className="flex gap-2">
                    <Target size={15} className="mt-1 shrink-0 text-zinc-500" />
                    <span>현재는 급한 보강보다 기존 비중 유지가 우선입니다.</span>
                  </li>
                )}
              </ul>

              {improvementActions.length > 0 && (
                <div className="mt-5 rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Focus Account Actions
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-zinc-200">
                    {improvementActions.map((action) => (
                      <li key={action}>- {action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {researchActionGroups.length > 0 && (
            <details className="section-block mt-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="section-kicker">Report Action Overlay</p>
                  <h3 className="mt-2 text-xl font-semibold text-zinc-50">
                    리포트 추가 실행 메모
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    체크리스트와 겹치는 긴 문장은 접어두고, 필요할 때만 원문 실행 메모를 확인합니다.
                  </p>
                </div>
                <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
                  {researchActionGroups.length}개 계좌 메모
                </span>
              </summary>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {researchActionGroups.map((group) => (
                  <div
                    key={group.id}
                    className="rounded-[1.15rem] border border-white/8 bg-white/[0.03] p-4"
                  >
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      {formatResearchAccountLabel(group.account, portfolio?.accounts)}
                    </p>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-200">
                      {group.items.map((item) => (
                        <li key={`${group.id}-${item}`}>- {cleanDisplayText(item)}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}

          {portfolioGuide && (
            <div className="mt-5">
              <ActionPlaybook accounts={portfolioGuide.accounts} />
            </div>
          )}

          {recommendationBoard && (
            <div className="mt-5">
              <RecommendationBoard board={recommendationBoard} />
            </div>
          )}
        </section>
      )}

      {hasStrategyView && hasActionView && (
        <StageSeparator
          orderClass="order-[35]"
          fromLabel="주간전략"
          toLabel="오늘실행"
          title="전략을 오늘의 버튼과 체크리스트로 좁힙니다."
          detail="이번 주 대응 원칙을 유지한 채, 오늘 실제로 누를 액션만 남깁니다."
          tone="emerald"
        />
      )}

      {researchBriefing &&
        (researchSections.length > 0 || researchScenarioBranches.length > 0) && (
        <section
          id="macro-view"
          className="section-shell order-10 scroll-mt-32"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="section-kicker">Macro View</p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
                3-6개월 방향성
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                현재 시장 레짐과 향후 시나리오를 먼저 확인하고, 그 뒤에 이번 주 전략과 오늘 실행으로 내려갑니다.
              </p>
              {researchDateLine && (
                <p className="mt-3 text-xs text-zinc-500">{researchDateLine}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={joinClasses(
                  "rounded-full border px-3 py-1.5 text-sm font-medium",
                  marketMood.chipClass,
                )}
              >
                {marketMood.label}
              </span>
              <Link
                href="/reports"
                className="inline-flex items-center gap-2 text-sm text-zinc-300 transition hover:text-zinc-100"
              >
                전체 리포트 보기
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>

          <div className="mt-5 md:hidden -mx-3 overflow-x-auto px-3">
            <div className="flex min-w-max gap-3">
              {researchOverview.metricItems.map((item, index) => (
                <SummaryMetricCard
                  key={item.key}
                  kicker={item.label}
                  value={formatMetricCount(item.value, item.unit)}
                  detail={item.detail}
                  tone={researchMetricTones[index] ?? "neutral"}
                  compact
                />
              ))}
            </div>
          </div>

          <div className="mt-5 hidden gap-3 md:grid md:grid-cols-4">
            {researchOverview.metricItems.map((item, index) => (
              <SummaryMetricCard
                key={item.key}
                kicker={item.label}
                value={formatMetricCount(item.value, item.unit)}
                detail={item.detail}
                tone={researchMetricTones[index] ?? "neutral"}
                compact
              />
            ))}
          </div>

          {(researchDiagnosis || researchCatalysts.length > 0 || researchCheckpoints.length > 0) && (
            <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,0.88fr),minmax(0,1.12fr)]">
              {researchDiagnosis && (
                <div className="section-block">
                  <p className="section-kicker">오늘 한 줄 진단</p>
                  <p className="mt-3 text-base font-medium leading-7 text-zinc-100">
                    {researchDiagnosis}
                  </p>
                </div>
              )}

              {researchCatalysts.length > 0 && (
                <div className="section-block">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="section-kicker">Catalyst Timeline</p>
                      <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                        6개월 촉매 일정
                      </h3>
                    </div>
                    <span className="rounded-full border border-blue-500/25 bg-blue-500/14 px-2.5 py-1 text-[11px] text-blue-200">
                      {researchCatalysts.length}개
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {researchCatalysts.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-blue-500/25 bg-blue-500/14 px-2.5 py-1 text-[11px] text-blue-200">
                            {item.scope}
                          </span>
                          <span className="text-xs text-zinc-500">{item.timing}</span>
                        </div>
                        <p className="mt-2 text-sm font-medium text-zinc-100">{item.event}</p>
                        {item.why && (
                          <p className="mt-1 text-xs leading-5 text-zinc-400">{item.why}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {researchCheckpoints.length > 0 && (
                <div
                  className={joinClasses(
                    "section-block",
                    researchDiagnosis || researchCatalysts.length > 0 ? "xl:col-span-2" : "",
                  )}
                >
                  <p className="section-kicker">Watchlist</p>
                  <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                    다음 체크포인트
                  </h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {researchCheckpoints.map((item) => (
                      <span
                        key={item.id}
                        className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300"
                      >
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {researchScenarioBranches.length > 0 && (
            <div className="mt-5">
              <ScenarioTree branches={researchScenarioBranches} />
            </div>
          )}

          {(researchTags.length > 0 || researchActionPoints.length > 0) && (
            <div className="mt-5 grid gap-3 md:grid-cols-[1.5fr,1fr]">
              <div className="section-block">
                <p className="section-kicker">핵심 태그</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {researchTags.map((tag) => (
                    <span
                      key={tag.label}
                      className={joinClasses("rounded-full border px-2.5 py-1 text-xs", researchTagClass(tag.tone))}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="section-block">
                <p className="section-kicker">액션 포인트</p>
                <ul className="mt-3 space-y-2 text-sm text-zinc-100">
                  {researchActionPoints.length > 0 ? (
                    researchActionPoints.map((point) => <li key={point}>- {point}</li>)
                  ) : (
                    <li>- 오늘 브리핑에서 별도 액션 문구가 추출되지 않았습니다.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {researchSectionTabs.length > 0 && (
            <details className="section-block mt-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="section-kicker">Research Sections</p>
                  <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                    원문 섹션 펼쳐보기
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    상단 요약과 중복되는 긴 본문은 접어두고, 필요할 때만 원문 흐름을 확인합니다.
                  </p>
                </div>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
                  {researchSectionTabs.length}개 섹션
                </span>
              </summary>

              <div className="mt-4">
                <ResearchSectionTabs sections={researchSectionTabs} />
              </div>
            </details>
          )}
        </section>
      )}

      <section className="section-shell order-60">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker">Advisor Briefing</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
              어드바이저 브리핑
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              이동 중에는 상단 요약으로 먼저 판단하고, 필요할 때만 장문 브리핑으로 내려와 근거를 확인할 수 있게 구성했습니다.
            </p>
          </div>
          {briefingDateLine && (
            <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
              {briefingDateLine}
            </span>
          )}
        </div>

        {briefing ? (
          <details className="section-block mt-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="section-kicker">Advisor Source</p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                  원문 브리핑 펼쳐보기
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  위 요약과 겹치는 장문 브리핑은 기본으로 접어두고, 필요할 때만 원문을 확인합니다.
                </p>
              </div>
              <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
                원문 보기
              </span>
            </summary>

            <div className="prose prose-invert prose-sm mt-4 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {briefing.content}
              </ReactMarkdown>
            </div>
          </details>
        ) : (
          <div className="section-block mt-5 text-sm text-zinc-400">
            아직 브리핑이 없습니다. 분석을 실행하면 여기에 표시됩니다.
          </div>
        )}
      </section>

      <FloatingSectionIndex items={sectionIndexItems} />
    </main>
  );
}
