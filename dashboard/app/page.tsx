import fs from "fs";
import path from "path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  ChevronsDown,
  Minus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
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
  extractResearchActionPoints,
  extractResearchScenarioBranches,
  extractResearchSections,
  extractResearchTags,
  getResearchBriefingStats,
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
  return `${(value ?? 0).toLocaleString()}원`;
}

function formatSignedCurrency(value: number | null | undefined) {
  const safeValue = value ?? 0;
  return `${safeValue > 0 ? "+" : ""}${safeValue.toLocaleString()}원`;
}

function formatPctPoint(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`;
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
      chipClass: "border-zinc-700 bg-zinc-900 text-zinc-300",
      accentClass: "text-zinc-100",
      cardClass: "border-zinc-800/80 bg-zinc-900/80",
    };
  }

  if (score >= 75) {
    return {
      label: "안정 구간",
      description: "현 배분이 비교적 목표 범위에 근접합니다.",
      chipClass: "border-emerald-500/30 bg-emerald-950/25 text-emerald-200",
      accentClass: "text-emerald-300",
      cardClass: "border-emerald-500/18 bg-emerald-950/12",
    };
  }

  if (score >= 55) {
    return {
      label: "보강 필요",
      description: "보완할 자산과 계좌가 분명하게 보입니다.",
      chipClass: "border-amber-500/30 bg-amber-950/25 text-amber-200",
      accentClass: "text-amber-200",
      cardClass: "border-amber-500/18 bg-amber-950/12",
    };
  }

  return {
    label: "조정 우선",
    description: "배분과 근거를 먼저 재정렬할 시점입니다.",
    chipClass: "border-red-500/30 bg-red-950/25 text-red-200",
    accentClass: "text-red-200",
    cardClass: "border-red-500/18 bg-red-950/12",
  };
}

function researchTagClass(tone: string) {
  if (tone === "rose") return "border-rose-500/30 bg-rose-950/20 text-rose-300";
  if (tone === "sky") return "border-sky-500/30 bg-sky-950/20 text-sky-300";
  if (tone === "emerald") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (tone === "amber") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  if (tone === "fuchsia") return "border-fuchsia-500/30 bg-fuchsia-950/20 text-fuchsia-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function buildMarketMood(indices: Record<string, MarketIndex>) {
  const changes = Object.values(indices)
    .map((item) => item.change_pct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (changes.length === 0) {
    return {
      label: "시장 데이터 대기",
      description: "핵심 지수가 들어오면 시장 모멘텀을 이곳에 압축해 보여줍니다.",
      chipClass: "border-zinc-700 bg-zinc-900 text-zinc-300",
    };
  }

  const average = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const positives = changes.filter((value) => value > 0).length;

  if (average > 0.45 || positives >= Math.ceil(changes.length * 0.7)) {
    return {
      label: "리스크 온",
      description: "주요 지수의 상승 우위가 확인됩니다. 공격적 비중 확대는 기술 신호와 함께 확인하는 편이 안전합니다.",
      chipClass: "border-emerald-500/30 bg-emerald-950/20 text-emerald-200",
    };
  }

  if (average < -0.45 || positives <= Math.floor(changes.length * 0.3)) {
    return {
      label: "리스크 오프",
      description: "주요 지수에 하방 압력이 있습니다. 신규 진입보다 현금 여력과 방어 자산 비중을 먼저 점검하는 흐름입니다.",
      chipClass: "border-red-500/30 bg-red-950/20 text-red-200",
    };
  }

  return {
    label: "혼조 장세",
    description: "지수 방향성이 엇갈립니다. 거시 요약과 계좌별 목표 배분을 같이 보고 선택지를 좁히는 구간입니다.",
    chipClass: "border-sky-500/30 bg-sky-950/20 text-sky-200",
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
      tone: "amber" as const,
    };
  }

  if (typeof dataQualityPenalty === "number" && dataQualityPenalty > 0) {
    return {
      label: `패널티 ${dataQualityPenalty.toFixed(1)}점`,
      detail: "누락 또는 미분류 노출이 감지돼 데이터 품질 감점이 반영됐습니다.",
      tone: "amber" as const,
    };
  }

  return {
    label: "정상",
    detail: "현재 스냅샷 기준 큰 데이터 누락 없이 점수 계산에 반영됐습니다.",
    tone: "emerald" as const,
  };
}

function SummaryMetricCard({
  kicker,
  value,
  detail,
  tone = "zinc",
  compact = false,
}: {
  kicker: string;
  value: string;
  detail: string;
  tone?: "emerald" | "amber" | "rose" | "sky" | "zinc";
  compact?: boolean;
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-500/18 bg-emerald-950/14"
      : tone === "amber"
        ? "border-amber-500/18 bg-amber-950/14"
        : tone === "rose"
          ? "border-red-500/18 bg-red-950/14"
          : tone === "sky"
            ? "border-sky-500/18 bg-sky-950/14"
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
      ? "border-emerald-500/16 bg-emerald-950/12 text-emerald-200"
      : tone === "amber"
        ? "border-amber-500/16 bg-amber-950/12 text-amber-200"
        : tone === "rose"
          ? "border-red-500/16 bg-red-950/12 text-red-200"
          : tone === "sky"
            ? "border-sky-500/16 bg-sky-950/12 text-sky-200"
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
    ? "border-emerald-500/16 bg-emerald-950/12"
    : "border-amber-500/16 bg-amber-950/12";

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
              ? "border-emerald-500/30 bg-emerald-950/25 text-emerald-200"
              : "border-amber-500/30 bg-amber-950/25 text-amber-200",
          )}
        >
          {item.action}
        </span>
      </div>

      <p className="mt-3 text-sm text-zinc-300">
        {isBuildUp ? "목표보다 " : "목표 대비 "}
        <span className={isBuildUp ? "text-emerald-200" : "text-amber-200"}>
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

function MarketCard({
  label,
  close,
  changePct,
  history = [],
}: {
  label: string;
  close: number | null | undefined;
  changePct: number | null | undefined;
  history?: number[];
}) {
  const safeClose = typeof close === "number" ? close : 0;
  const hasChangePct = typeof changePct === "number" && Number.isFinite(changePct);
  const safeChangePct = hasChangePct ? changePct : 0;
  const positive = safeChangePct > 0;
  const neutral = hasChangePct && safeChangePct === 0;
  const Icon = !hasChangePct ? Minus : neutral ? Minus : positive ? TrendingUp : TrendingDown;
  const valueTone = !hasChangePct
    ? "text-zinc-300"
    : neutral
      ? "text-zinc-300"
      : positive
        ? "text-emerald-200"
        : "text-red-200";
  const barTone = !hasChangePct
    ? "bg-zinc-500/60"
    : neutral
      ? "bg-zinc-500/60"
      : positive
        ? "bg-emerald-400"
        : "bg-red-400";
  const barWidth = hasChangePct
    ? Math.min(100, Math.abs(safeChangePct) * 18 + 18)
    : 22;
  const sparklineSeries = history.filter((value) => Number.isFinite(value));
  const minSeries = Math.min(...sparklineSeries);
  const maxSeries = Math.max(...sparklineSeries);
  const span = Math.max(maxSeries - minSeries, 1);
  const sparklinePoints =
    sparklineSeries.length >= 2
      ? sparklineSeries
          .map((value, index) => {
            const x =
              sparklineSeries.length === 1
                ? 0
                : (index / (sparklineSeries.length - 1)) * 100;
            const y = 30 - ((value - minSeries) / span) * 24;
            return `${x},${y}`;
          })
          .join(" ")
      : null;

  return (
    <div className="glass-panel-soft rounded-[1.45rem] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">
            {safeClose.toLocaleString()}
          </p>
        </div>
        <span
          className={joinClasses(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
            !hasChangePct
              ? "border-zinc-700 bg-zinc-900 text-zinc-300"
              : neutral
              ? "border-zinc-700 bg-zinc-900 text-zinc-300"
              : positive
                ? "border-emerald-500/25 bg-emerald-950/20 text-emerald-200"
                : "border-red-500/25 bg-red-950/20 text-red-200",
          )}
        >
          <Icon size={13} />
          {hasChangePct ? (
            <>
              {safeChangePct > 0 ? "+" : ""}
              {safeChangePct.toFixed(2)}%
            </>
          ) : (
            "변화 대기"
          )}
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-full bg-white/6">
        <div className={joinClasses("h-1.5 rounded-full", barTone)} style={{ width: `${barWidth}%` }} />
      </div>

      {sparklinePoints && (
        <div className="mt-4 rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2">
          <svg viewBox="0 0 100 32" className="h-9 w-full">
            <polyline
              fill="none"
              stroke={positive ? "rgb(52 211 153)" : neutral ? "rgb(161 161 170)" : "rgb(248 113 113)"}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={sparklinePoints}
            />
          </svg>
        </div>
      )}

      <p className={joinClasses("mt-3 text-xs font-medium", valueTone)}>
        {!hasChangePct
          ? "등락 데이터 연결 대기"
          : neutral
          ? "보합권"
          : positive
            ? "상승 우위 흐름"
            : "하락 압력 우위"}
      </p>
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
    ? "text-emerald-300"
    : profitNegative
      ? "text-red-300"
      : "text-zinc-300";

  const holdingsProfitLoss = getAccountHoldingsProfitLoss(account);
  const holdingsProfitRate = getAccountHoldingsProfitRate(account);
  const holdingsProfitClass =
    holdingsProfitLoss > 0
      ? "text-emerald-300"
      : holdingsProfitLoss < 0
        ? "text-red-300"
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
      ? "border-emerald-500/18 bg-emerald-950/12 text-emerald-200"
      : tone === "amber"
        ? "border-amber-500/18 bg-amber-950/12 text-amber-200"
        : "border-sky-500/18 bg-sky-950/12 text-sky-200";

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
  const researchBriefing = loadResearchBriefings()[0] ?? null;
  const researchSections = researchBriefing
    ? extractResearchSections(researchBriefing.content)
        .filter((section) => !isStructuredResearchSectionTitle(section.title))
        .slice(0, 3)
    : [];
  const researchScenarioBranches = researchBriefing
    ? extractResearchScenarioBranches(researchBriefing.content, 2)
    : [];
  const researchStats = getResearchBriefingStats(researchBriefing);
  const researchTags = researchBriefing
    ? extractResearchTags(researchBriefing.content, 8)
    : [];
  const researchActionPoints = researchBriefing
    ? extractResearchActionPoints(researchBriefing.content, 4)
    : [];
  const researchSectionTabs: ResearchSectionTabItem[] = researchSections.map(
    (section, index) => ({
      id: `dashboard-research-section-${index + 1}`,
      label: `Section ${index + 1}`,
      title: section.title,
      body: section.body,
      tags: extractResearchTags(`${section.title}\n${section.body}`, 5),
      actionPoints: extractResearchActionPoints(section.body, 2),
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
  const macroTargetId =
    researchBriefing && (researchSections.length > 0 || researchScenarioBranches.length > 0)
      ? "macro-view"
      : hasMarket
        ? "macro-view"
        : null;
  const strategyTargetId = portfolioGuide ? "strategy-overview" : portfolio ? "strategy-overview" : null;
  const actionTargetId = portfolioGuide || recommendationBoard ? "action-overview" : null;
  const mainScenario =
    researchScenarioBranches.find((branch) => /(main|base|기준|메인)/i.test(branch.label)) ??
    researchScenarioBranches[0] ??
    null;
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
    ? `${marketMood.description} 현재 기본 시나리오는 ${mainScenario.narrative || mainScenario.label}이며, 이번 주 전략 초점은 ${
        portfolioGuide?.globalActions[0] ??
        mainScenario.response ??
        "현금 비중과 계좌별 목표 재정렬"
      } 입니다.`
    : portfolioGuide
      ? `${marketMood.description} 현재 총 평가금액은 ${formatCurrency(
          totals?.totalEvaluationAmount,
        )}이며, 이번 주 전략 초점은 ${
          portfolioGuide.globalActions[0] ?? "우선순위 재정렬"
        } 입니다.`
      : "거시 방향성부터 이번 주 전략, 오늘 실행 순서로 판단할 수 있게 화면을 재정렬했습니다.";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
      <section className="glass-panel relative overflow-hidden rounded-[2rem] p-5 md:p-7 lg:p-8">
        <div className="absolute -right-12 -top-14 h-44 w-44 rounded-full bg-emerald-400/12 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-36 w-36 rounded-full bg-sky-400/12 blur-3xl" />

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

            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-zinc-50 md:text-5xl">
              왜 이 매매를 해야 하는지부터 보여줍니다.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300 md:text-base">
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
                <span className="rounded-full border border-sky-500/30 bg-sky-950/20 px-3 py-1 text-xs text-sky-200">
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
                  (totals?.totalHoldingsProfitLoss ?? 0) >= 0 ? "emerald" : "rose"
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
                    ? "emerald"
                    : portfolioGuide?.score != null && portfolioGuide.score >= 55
                      ? "amber"
                      : "rose"
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
                tone={topPriority?.action === "보강 필요" ? "emerald" : "amber"}
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

          <aside className="glass-panel-soft rounded-[1.75rem] p-4 md:p-5">
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
              <div className="rounded-[1.2rem] border border-sky-500/20 bg-sky-950/12 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  1. Macro View
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  {mainScenario
                    ? `${mainScenario.label}${mainScenario.probabilityLabel ? ` · ${mainScenario.probabilityLabel}` : ""}`
                    : marketMood.label}
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {mainScenario?.narrative || marketMood.description}
                </p>
              </div>

              <div className="rounded-[1.2rem] border border-emerald-500/20 bg-emerald-950/12 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  2. Strategy
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  현금 {portfolioGuide ? formatPercent(portfolioGuide.totalCashPct * 100) : "-"} · 다음 단계{" "}
                  {portfolioGuide ? formatPercent(portfolioGuide.nextTranchePct * 100, 0) : "-"}
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {portfolioGuide?.globalActions[0] ??
                    "이번 주는 계좌별 목표 비중과 대기 자금 배치를 먼저 확인합니다."}
                </p>
              </div>

              <div className="rounded-[1.2rem] border border-amber-500/20 bg-amber-950/12 p-3">
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
          className="glass-panel order-20 scroll-mt-32 rounded-[2rem] p-5 md:p-6"
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

          <div className="mt-5 md:hidden -mx-5 overflow-x-auto px-5">
            <div className="flex min-w-max gap-3">
              {Object.entries(indices).map(([key, value]) => (
                <div key={key} className="min-w-[210px] max-w-[210px]">
                  <MarketCard
                    label={key}
                    close={value.close}
                    changePct={value.change_pct}
                    history={value.history}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-6">
            {Object.entries(indices).map(([key, value]) => (
              <MarketCard
                key={key}
                label={key}
                close={value.close}
                changePct={value.change_pct}
                history={value.history}
              />
            ))}
          </div>
        </section>
      )}

      {(portfolio || strategy) && (
        <section
          id={portfolioGuide ? "portfolio-overview" : "strategy-overview"}
          className="glass-panel order-50 scroll-mt-32 rounded-[2rem] p-5 md:p-6"
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
                <p className="mt-3 text-sm text-sky-200">
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
                className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-950/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-950/35"
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
                  tone="sky"
                />
                <SummaryMetricCard
                  kicker="보유 종목"
                  value={`${totals?.totalHoldingCount ?? 0}개`}
                  detail="전체 계좌 합산 기준"
                  tone="zinc"
                  compact
                />
                <SummaryMetricCard
                  kicker="합산 손익"
                  value={formatSignedCurrency(totals?.totalHoldingsProfitLoss)}
                  detail={`수익률 ${formatSignedPercent(totals?.totalHoldingsProfitRate)}`}
                  tone={
                    (totals?.totalHoldingsProfitLoss ?? 0) >= 0 ? "emerald" : "rose"
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
                  tone="amber"
                  compact
                />
              </div>

              <div className="mt-5 md:hidden -mx-5 overflow-x-auto px-5">
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
          className="glass-panel order-30 scroll-mt-32 rounded-[2rem] p-5 md:p-6"
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
            <div className="glass-panel-soft rounded-[1.65rem] p-5">
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
                      <Sparkles size={15} className="mt-0.5 shrink-0 text-emerald-300" />
                      <span>{driver}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              <div className="glass-panel-soft rounded-[1.65rem] p-5">
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
                    <Target size={15} className="mt-1 shrink-0 text-sky-300" />
                    <span>
                      다음 분할매수 기준은 {formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
                      입니다.
                    </span>
                  </li>
                  {portfolioGuide.globalActions.slice(0, 2).map((action) => (
                    <li key={action} className="flex gap-2">
                      <Target size={15} className="mt-1 shrink-0 text-emerald-300" />
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

              <div className="glass-panel-soft rounded-[1.65rem] p-5">
                <div className="flex items-start gap-3">
                  {dataQualitySummary.tone === "emerald" ? (
                    <ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={18} />
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

          <div className="mt-5 md:hidden -mx-5 overflow-x-auto px-5">
            <div className="flex gap-3 pb-1">
              <SummaryMetricCard
                kicker="포트폴리오 운용 점수"
                value={`${portfolioGuide.score}점`}
                detail={globalScoreMeta.description}
                tone={
                  portfolioGuide.score >= 75
                    ? "emerald"
                    : portfolioGuide.score >= 55
                      ? "amber"
                      : "rose"
                }
              />
              <SummaryMetricCard
                kicker="총 현금 비중"
                value={formatPercent(portfolioGuide.totalCashPct * 100)}
                detail="현금 파킹 포함"
                tone="amber"
              />
              <SummaryMetricCard
                kicker="이번 단계 기준"
                value={formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
                detail="다음 분할매수 비중"
                tone="sky"
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
                  ? "emerald"
                  : portfolioGuide.score >= 55
                    ? "amber"
                    : "rose"
              }
            />
            <SummaryMetricCard
              kicker="총 현금 비중"
              value={formatPercent(portfolioGuide.totalCashPct * 100)}
              detail="현금 파킹 포함"
              tone="amber"
            />
            <SummaryMetricCard
              kicker="이번 단계 기준"
              value={formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
              detail="다음 분할매수 비중"
              tone="sky"
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
          className="glass-panel order-40 scroll-mt-32 rounded-[2rem] p-5 md:p-6"
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
              <span className="rounded-full border border-emerald-500/30 bg-emerald-950/20 px-3 py-1.5 text-sm font-medium text-emerald-200">
                1순위 {topPriority.accountLabel} · {topPriority.category}
              </span>
            )}
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,0.85fr),minmax(0,1.15fr)]">
            <div className="glass-panel-soft rounded-[1.65rem] p-5">
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

            <div className="glass-panel-soft rounded-[1.65rem] p-5">
              <p className="section-kicker">Today Checklist</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-50">
                오늘의 우선 지침
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
                {portfolioGuide?.globalActions?.length ? (
                  portfolioGuide.globalActions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <Target size={15} className="mt-1 shrink-0 text-emerald-300" />
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
          className="glass-panel order-10 scroll-mt-32 rounded-[2rem] p-5 md:p-6"
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

          <div className="mt-5 md:hidden -mx-5 overflow-x-auto px-5">
            <div className="flex min-w-max gap-3">
              <SummaryMetricCard
                kicker="활용 리포트"
                value={`${researchStats.coveredReportCount ?? "-"}건`}
                detail="요약에 직접 활용된 리포트 수"
                tone="sky"
                compact
              />
              <SummaryMetricCard
                kicker="사용 청크"
                value={`${researchStats.usedChunkCount ?? "-"}개`}
                detail="실제 인용에 반영된 텍스트 조각"
                tone="emerald"
                compact
              />
              <SummaryMetricCard
                kicker="후보 청크"
                value={`${researchStats.candidateChunkCount ?? "-"}개`}
                detail="검토 후보로 올라온 텍스트 조각"
                tone="zinc"
                compact
              />
              <SummaryMetricCard
                kicker="요약 전용"
                value={`${researchStats.summaryChunkCount ?? "-"}개`}
                detail="배경 설명 위주 청크"
                tone="amber"
                compact
              />
            </div>
          </div>

          <div className="mt-5 hidden gap-3 md:grid md:grid-cols-4">
            <SummaryMetricCard
              kicker="활용 리포트"
              value={`${researchStats.coveredReportCount ?? "-"}건`}
              detail="요약에 직접 활용된 리포트 수"
              tone="sky"
              compact
            />
            <SummaryMetricCard
              kicker="사용 청크"
              value={`${researchStats.usedChunkCount ?? "-"}개`}
              detail="실제 인용에 반영된 텍스트 조각"
              tone="emerald"
              compact
            />
            <SummaryMetricCard
              kicker="후보 청크"
              value={`${researchStats.candidateChunkCount ?? "-"}개`}
              detail="검토 후보로 올라온 텍스트 조각"
              tone="zinc"
              compact
            />
            <SummaryMetricCard
              kicker="요약 전용"
              value={`${researchStats.summaryChunkCount ?? "-"}개`}
              detail="배경 설명 위주 청크"
              tone="amber"
              compact
            />
          </div>

          {researchScenarioBranches.length > 0 && (
            <div className="mt-5">
              <ScenarioTree branches={researchScenarioBranches} />
            </div>
          )}

          {(researchTags.length > 0 || researchActionPoints.length > 0) && (
            <div className="mt-5 grid gap-3 md:grid-cols-[1.5fr,1fr]">
              <div className="glass-panel-soft rounded-[1.5rem] p-4">
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
              <div className="glass-panel-soft rounded-[1.5rem] p-4">
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
            <div className="mt-5">
              <ResearchSectionTabs sections={researchSectionTabs} />
            </div>
          )}
        </section>
      )}

      <section className="glass-panel order-60 rounded-[2rem] p-5 md:p-6">
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
          <div className="glass-panel-soft mt-5 rounded-[1.6rem] p-5 prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {briefing.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="glass-panel-soft mt-5 rounded-[1.6rem] p-5 text-sm text-zinc-400">
            아직 브리핑이 없습니다. 분석을 실행하면 여기에 표시됩니다.
          </div>
        )}
      </section>

      <FloatingSectionIndex items={sectionIndexItems} />
    </main>
  );
}
