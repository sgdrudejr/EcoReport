import fs from "fs";
import path from "path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import FloatingSectionIndex, {
  type FloatingSectionIndexItem,
} from "@/components/FloatingSectionIndex";
import PortfolioGuidanceTabs from "@/components/PortfolioGuidanceTabs";
import RecommendationBoard from "@/components/RecommendationBoard";
import ResearchSectionTabs, {
  type ResearchSectionTabItem,
} from "@/components/ResearchSectionTabs";
import TriggerButton from "@/components/TriggerButton";
import { buildPortfolioGuide } from "@/lib/portfolio-guidance";
import { loadRecommendationBoard } from "@/lib/recommendations";
import { loadReports } from "@/lib/reports";
import {
  listRepoFiles,
  readRepoJsonFile,
} from "@/lib/repo-artifacts";
import { resolveRepoRoot } from "@/lib/repo-root";
import {
  extractResearchSections,
  extractResearchTags,
  extractResearchActionPoints,
  getResearchBriefingStats,
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

// ── 데이터 로더 ────────────────────────────────────────────────────────

interface MarketIndex {
  close: number;
  change_pct: number;
}
interface MarketData {
  date: string;
  indices?: Record<string, MarketIndex>;
}

function loadLatestMarket(): MarketData | null {
  const dir = "data/market";
  const files = listRepoFiles(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  return readRepoJsonFile<MarketData>(path.posix.join(dir, files[0]));
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

function loadStrategy(): Strategy | null {
  const file = path.join(REPO_ROOT, "config", "strategy.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────

function MarketCard({
  label,
  close,
  changePct,
}: {
  label: string;
  close: number | null | undefined;
  changePct: number | null | undefined;
}) {
  const safeClose = typeof close === "number" ? close : 0;
  const safeChangePct = typeof changePct === "number" ? changePct : 0;
  const positive = safeChangePct > 0;
  const neutral = safeChangePct === 0;
  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
  const color = neutral
    ? "text-zinc-400"
    : positive
    ? "text-emerald-400"
    : "text-red-400";

  return (
    <div className="bg-zinc-900 rounded-xl p-4 flex flex-col gap-1 border border-zinc-800">
      <span className="text-xs text-zinc-500 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">
        {safeClose.toLocaleString()}
      </span>
      <span className={`flex items-center gap-1 text-sm font-medium ${color}`}>
        <Icon size={14} />
        {safeChangePct > 0 ? "+" : ""}
        {safeChangePct.toFixed(2)}%
      </span>
    </div>
  );
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
    ? "text-emerald-400"
    : profitNegative
      ? "text-red-400"
      : "text-zinc-400";

  const holdingsProfitLoss = getAccountHoldingsProfitLoss(account);
  const holdingsProfitRate = getAccountHoldingsProfitRate(account);
  const holdingsProfitClass =
    holdingsProfitLoss > 0
      ? "text-emerald-400"
      : holdingsProfitLoss < 0
        ? "text-red-400"
        : "text-zinc-400";

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">{account.label}</p>
          <p className="text-xs text-zinc-500 mt-1">
            {account.accountNumber || "계좌번호 미입력"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {typeof guideScore === "number" && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                guideScore >= 75
                  ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300"
                  : guideScore >= 55
                    ? "border-amber-900/60 bg-amber-950/30 text-amber-300"
                    : "border-red-900/60 bg-red-950/30 text-red-300"
              }`}
            >
              {guideScore}점
            </span>
          )}
          {account.incomplete && (
            <span className="rounded-full bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300 border border-amber-900/60">
              부분 캡처
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs text-zinc-500">총 평가금액</p>
        <p className="text-xl font-semibold tabular-nums">
          {(account.evaluationAmount ?? 0).toLocaleString()}원
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-zinc-500">예수금</p>
          <p className="tabular-nums text-zinc-200">
            {(account.cashAvailable ?? 0).toLocaleString()}원
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">손익</p>
          <p className={`tabular-nums ${profitClass}`}>
            {(account.profitLoss ?? 0) > 0 ? "+" : ""}
            {(account.profitLoss ?? 0).toLocaleString()}원
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500 pt-1">
        <span>보유 종목 {getAccountHoldingCount(account)}개</span>
        <span>
          수익률{" "}
          <span className={profitClass}>
            {formatSignedPercent(account.profitRate)}
          </span>
        </span>
      </div>

      {account.holdings.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>보유 종목 합산 손익</span>
            <span className={`font-medium ${holdingsProfitClass}`}>
              {holdingsProfitLoss > 0 ? "+" : ""}
              {holdingsProfitLoss.toLocaleString()}원
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>보유 종목 합산 수익률</span>
            <span className={`font-medium ${holdingsProfitClass}`}>
              {formatSignedPercent(holdingsProfitRate)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {account.holdings.map((holding) => (
              <span
                key={`${account.key}-${holding.code ?? holding.name}`}
                className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300"
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

function GuidanceScoreCard({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  const color =
    score >= 75 ? "text-emerald-400" : score >= 55 ? "text-amber-300" : "text-red-400";

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>
        {score}점
      </p>
    </div>
  );
}

function researchTagClass(tone: string) {
  if (tone === "rose") return "border-rose-500/30 bg-rose-950/20 text-rose-300";
  if (tone === "sky") return "border-sky-500/30 bg-sky-950/20 text-sky-300";
  if (tone === "emerald") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (tone === "amber") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  if (tone === "fuchsia") return "border-fuchsia-500/30 bg-fuchsia-950/20 text-fuchsia-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

// ── 메인 페이지 ───────────────────────────────────────────────────────

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
    ? extractResearchSections(researchBriefing.content).slice(0, 3)
    : [];
  const researchStats = getResearchBriefingStats(researchBriefing);
  const researchTags = researchBriefing
    ? extractResearchTags(researchBriefing.content, 8)
    : [];
  const researchActionPoints = researchBriefing
    ? extractResearchActionPoints(researchBriefing.content, 4)
    : [];
  const researchSectionTabs: ResearchSectionTabItem[] = researchSections.map((section, index) => ({
    id: `dashboard-research-section-${index + 1}`,
    label: `Section ${index + 1}`,
    title: section.title,
    body: section.body,
    tags: extractResearchTags(`${section.title}\n${section.body}`, 5),
    actionPoints: extractResearchActionPoints(section.body, 2),
  }));
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
  const sectionIndexItems: FloatingSectionIndexItem[] = [
    hasMarket ? { id: "market-overview", label: "시장지표" } : null,
    portfolio ? { id: "portfolio-overview", label: "포트폴리오" } : null,
    portfolioGuide ? { id: "portfolio-guide", label: "운용가이드" } : null,
    recommendationBoard ? { id: "recommendation-board", label: "종목추천" } : null,
    researchBriefing && researchSections.length > 0
      ? { id: "research-summary", label: "경제리포트" }
      : null,
  ].filter((item): item is FloatingSectionIndexItem => item !== null);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8 space-y-8">
      {/* 헤더 */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100 md:text-4xl">EcoReport</h1>
          {briefing && (
            <p className="mt-1 text-sm text-zinc-500 md:text-base">
              {briefingDateLine ?? briefing.date}
            </p>
          )}
        </div>
        <div className="md:self-start">
          <TriggerButton />
        </div>
      </div>

      {/* 시장 지표 카드 */}
      {hasMarket && (
        <section id="market-overview" className="scroll-mt-24 md:scroll-mt-28">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            시장 지표
          </h2>
          <div className="md:hidden -mx-4 overflow-x-auto px-4">
            <div className="flex gap-3 pb-1">
              {Object.entries(indices).map(([key, val]) => (
                <div key={key} className="min-w-[160px]">
                  <MarketCard label={key} close={val.close} changePct={val.change_pct} />
                </div>
              ))}
            </div>
          </div>
          <div className="hidden md:grid md:grid-cols-3 xl:grid-cols-6 gap-3">
            {Object.entries(indices).map(([key, val]) => (
              <MarketCard
                key={key}
                label={key}
                close={val.close}
                changePct={val.change_pct}
              />
            ))}
          </div>
        </section>
      )}

      {/* 포트폴리오 */}
      {(portfolio || strategy) && (
        <section id="portfolio-overview" className="scroll-mt-24 md:scroll-mt-28">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            포트폴리오
          </h2>
          <div className="space-y-4">
            {portfolio ? (
              <>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-sm text-zinc-400">
                      최신 스냅샷 기준 총 평가금액
                    </p>
                    <p className="text-2xl font-semibold tabular-nums text-zinc-100">
                      {(totals?.totalEvaluationAmount ?? 0).toLocaleString()}원
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      보유 종목 {totals?.totalHoldingCount ?? 0}개 · 합산 손익{" "}
                      <span
                        className={
                          (totals?.totalHoldingsProfitLoss ?? 0) > 0
                            ? "text-emerald-400"
                            : (totals?.totalHoldingsProfitLoss ?? 0) < 0
                              ? "text-red-400"
                              : "text-zinc-400"
                        }
                      >
                        {(totals?.totalHoldingsProfitLoss ?? 0) > 0 ? "+" : ""}
                        {(totals?.totalHoldingsProfitLoss ?? 0).toLocaleString()}원
                      </span>{" "}
                      · 수익률{" "}
                      <span
                        className={
                          (totals?.totalHoldingsProfitLoss ?? 0) > 0
                            ? "text-emerald-400"
                            : (totals?.totalHoldingsProfitLoss ?? 0) < 0
                              ? "text-red-400"
                              : "text-zinc-400"
                        }
                      >
                        {formatSignedPercent(totals?.totalHoldingsProfitRate)}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href="/portfolio"
                      className="inline-flex items-center rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
                    >
                      상세 보기
                    </Link>
                    <Link
                      href="/portfolio/update"
                      className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                    >
                      캡처 업데이트
                    </Link>
                  </div>
                </div>
                <div className="md:hidden -mx-4 overflow-x-auto px-4">
                  <div className="flex gap-3 pb-1">
                    {portfolio.accounts.map((account) => (
                      <div key={account.key} className="min-w-[300px] max-w-[300px]">
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
                <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-3 gap-3">
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
              <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 text-sm text-zinc-400 flex items-center justify-between gap-4">
                <p>아직 저장된 포트폴리오 스냅샷이 없습니다.</p>
                <Link
                  href="/portfolio/update"
                  className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  첫 스냅샷 만들기
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {portfolioGuide && (
        <section id="portfolio-guide" className="scroll-mt-24 md:scroll-mt-28">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
                운용 가이드
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                점수보다 중요한 건 지금 어떤 계좌에서 무엇을 보강할지입니다.
                아래 가이드는 현재 스냅샷과 목표 배분 기준입니다.
              </p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-[1.05fr,0.95fr] gap-3 md:hidden">
            <div className="row-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs leading-5 text-zinc-500">
                포트폴리오
                <br />
                운용 점수
              </p>
              <p className="mt-3 text-4xl font-semibold tabular-nums text-zinc-100">
                {portfolioGuide.score}점
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500">총 현금 비중</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                {formatPercent(portfolioGuide.totalCashPct * 100)}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500">이번 단계 기준</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                {formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">다음 분할매수 비중</p>
            </div>
          </div>
          <div className="hidden md:grid md:grid-cols-3 gap-3 mb-4">
            <GuidanceScoreCard
              score={portfolioGuide.score}
              label="포트폴리오 운용 점수"
            />
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">총 현금 비중</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-100">
                {formatPercent(portfolioGuide.totalCashPct * 100)}
              </p>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">이번 단계 기준</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-100">
                {formatPercent(portfolioGuide.nextTranchePct * 100, 0)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">다음 분할매수 비중</p>
            </div>
          </div>

          {portfolioGuide.incompleteCount > 0 && (
            <div className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
              부분 캡처 계좌가 {portfolioGuide.incompleteCount}개 있어 일부 가이드는
              참고용입니다. 누락 종목을 채우면 정밀도가 올라갑니다.
            </div>
          )}

          <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-sm font-medium text-zinc-100">오늘의 우선 지침</p>
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              {portfolioGuide.globalActions.length > 0 ? (
                portfolioGuide.globalActions.map((action) => (
                  <li key={action}>- {action}</li>
                ))
              ) : (
                <li>- 현재는 급한 보강보다 기존 비중 유지가 우선입니다.</li>
              )}
            </ul>
          </div>

          <PortfolioGuidanceTabs
            accounts={portfolioGuide.accounts}
            analysisDateLabel={portfolioGuide.analysisDateLabel}
          />
        </section>
      )}

      {recommendationBoard && (
        <section id="recommendation-board" className="scroll-mt-24 md:scroll-mt-28">
          <RecommendationBoard board={recommendationBoard} />
        </section>
      )}

      {researchBriefing && researchSections.length > 0 && (
        <section id="research-summary" className="scroll-mt-24 md:scroll-mt-28">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
                경제 리포트 요약
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                오늘 브리핑에서 가장 중요한 거시·섹터 변화만 먼저 볼 수 있게 정리했습니다.
              </p>
              {researchDateLine && (
                <p className="mt-1 text-xs text-zinc-600">{researchDateLine}</p>
              )}
            </div>
            <Link
              href="/reports"
              className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              전체 리포트 보기 →
            </Link>
          </div>

          <div className="mb-4 -mx-1 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-3 px-1">
              <div className="min-w-[132px] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="text-xs text-zinc-500">활용 리포트</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {researchStats.coveredReportCount ?? "-"}건
                </p>
              </div>
              <div className="min-w-[132px] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="text-xs text-zinc-500">사용 청크</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {researchStats.usedChunkCount ?? "-"}개
                </p>
              </div>
              <div className="min-w-[132px] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="text-xs text-zinc-500">후보 청크</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {researchStats.candidateChunkCount ?? "-"}개
                </p>
              </div>
              <div className="min-w-[132px] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="text-xs text-zinc-500">요약 전용</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {researchStats.summaryChunkCount ?? "-"}개
                </p>
              </div>
            </div>
          </div>

          {(researchTags.length > 0 || researchActionPoints.length > 0) && (
            <div className="mb-4 grid gap-3 md:grid-cols-[1.5fr,1fr]">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-4">
                <p className="text-xs text-zinc-500">핵심 태그</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {researchTags.map((tag) => (
                    <span
                      key={tag.label}
                      className={`rounded-full border px-2.5 py-1 text-xs ${researchTagClass(tag.tone)}`}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-4">
                <p className="text-xs text-zinc-500">액션 포인트</p>
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

          <ResearchSectionTabs sections={researchSectionTabs} />
        </section>
      )}

      {/* 어드바이저 브리핑 */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          어드바이저 브리핑
        </h2>
        {briefing ? (
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 prose prose-invert prose-sm max-w-none">
            {briefingDateLine && (
              <p className="mb-4 text-xs text-zinc-500 not-prose">{briefingDateLine}</p>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {briefing.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 text-zinc-500 text-sm">
            아직 브리핑이 없습니다. 분석을 실행하면 여기에 표시됩니다.
          </div>
        )}
      </section>

      <FloatingSectionIndex items={sectionIndexItems} />
    </main>
  );
}
