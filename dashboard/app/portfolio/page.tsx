export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Gauge,
  RadioTower,
  ShieldAlert,
  Signal,
  Target,
  TrendingUp,
} from "lucide-react";

import { readRepoJsonFile } from "@/lib/repo-artifacts";
import { loadLatestStockeasySnapshot } from "@/lib/stockeasy";

type Tone = "green" | "blue" | "amber" | "red" | string;

type ProofAccount = {
  accountKey: string;
  accountLabel: string;
  totalValue?: number | null;
  cash?: number | null;
  proofScore: number;
  tone: Tone;
  verdict: string;
  matchedExposurePct?: number | null;
  topRisks?: string[];
  proof?: string[];
  redFlags?: Array<{ name?: string | null; decision?: string | null; reason?: string | null }>;
};

type ProofFile = {
  date: string;
  summary: {
    proofScore: number;
    tone: Tone;
    verdict: string;
    direction: string;
    accountCount: number;
  };
  market?: {
    headline?: string | null;
    nextAction?: string | null;
    mode?: string | null;
  };
  accounts: ProofAccount[];
};

type FeedbackCard = {
  accountKey: string;
  accountLabel: string;
  code: string;
  name: string;
  recommendation: {
    label: string;
    action: string;
    urgency: string;
    tone: Tone;
    oneLine: string;
  };
  position: {
    marketValue?: number | null;
    profitRatePct?: number | null;
    accountWeightPct?: number | null;
  };
  decision?: { score?: number | null; label?: string | null };
  executionRules?: string[];
};

type StockeasyLeaderLite = {
  sector?: string | null;
  rank?: number | null;
  name?: string | null;
  code?: string | null;
  changePct?: number | null;
  rs?: number | null;
  rs1m?: number | null;
  rs3m?: number | null;
  rs6m?: number | null;
};

type StockeasyStrategyLite = {
  key?: string | null;
  name?: string | null;
  style?: string | null;
  cumulativeReturnPct?: number | null;
  dayDeltaPct?: number | null;
  weekDeltaPct?: number | null;
  holdingCount?: number | null;
  todayBuyCount?: number | null;
  todayExitCount?: number | null;
  bias?: string | null;
};

type FeedbackFile = {
  date: string;
  summary: {
    totalHoldings: number;
    highUrgency: number;
    mediumUrgency: number;
    lowUrgency: number;
    byLabel: Record<string, number>;
  };
  cards: FeedbackCard[];
};

type DashboardView = {
  meta?: { date?: string; generatedAt?: string };
  portfolio?: {
    score?: number | null;
    regime?: string | null;
    accounts?: Array<{
      accountKey?: string | null;
      accountLabel?: string | null;
      totalValue?: number | null;
      cash?: number | null;
      holdingCount?: number | null;
      stage4Score?: number | null;
      noActionReason?: string | null;
      topThemes?: string[];
      topRisks?: string[];
    }>;
  };
  accountStrategy?: {
    headline?: string | null;
    stance?: string | null;
    confidence?: number | null;
    todayDo?: Array<{ action?: string | null; name?: string | null; reason?: string | null; condition?: string | null }>;
    todayDoNot?: string[];
  };
  stockPulse?: {
    counts?: { activeHoldings?: number | null; highUrgency?: number | null; mediumUrgency?: number | null };
    summary?: { headline?: string | null; nextAction?: string | null };
    items?: Array<{ name?: string | null; code?: string | null; verdict?: string | null; urgency?: string | null; oneLine?: string | null }>;
  };
  rotationWatch?: {
    summary?: { headline?: string | null; mode?: string | null; stance?: string | null; nextAction?: string | null };
  };
};

function loadProof() {
  return (
    readRepoJsonFile<ProofFile>("data/stockpilot-proof/latest-account-direction-proof.json") ??
    readRepoJsonFile<ProofFile>("data/stockpilot-proof/latest-account-direction-proof-independent.json")
  );
}

function toneClass(tone: Tone, kind: "text" | "bg" | "border" = "text") {
  const palette: Record<string, Record<string, string>> = {
    green: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
    blue: { text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
    amber: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
    red: { text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
  };
  return palette[tone]?.[kind] ?? palette.blue[kind];
}

function krw(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  return `${Math.round(value / 10000).toLocaleString("ko-KR")}만원`;
}

function pct(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number") return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function signedPct(value: number | null | undefined, digits = 1) {
  return pct(value, digits);
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-950">
      {children}
      <ArrowRight size={13} />
    </Link>
  );
}

function AccountCard({ account }: { account: ProofAccount }) {
  return (
    <article className={`rounded-lg border bg-white p-4 ${toneClass(account.tone, "border")}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-slate-950">{account.accountLabel}</p>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">{account.verdict}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass(account.tone)} ${toneClass(account.tone, "bg")} ${toneClass(account.tone, "border")}`}>
          {account.proofScore}점
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="평가" value={krw(account.totalValue)} />
        <Metric label="현금" value={krw(account.cash)} />
        <Metric label="겹침" value={account.matchedExposurePct != null ? `${account.matchedExposurePct.toFixed(1)}%` : "-"} />
      </div>
      {(account.redFlags ?? []).length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-700">
            <AlertTriangle size={14} /> {account.redFlags![0].name}: {account.redFlags![0].reason}
          </p>
        </div>
      )}
    </article>
  );
}

function StockeasyBadge({ leader }: { leader: StockeasyLeaderLite | null }) {
  if (!leader) {
    return <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-400">RS 없음</span>;
  }
  return (
    <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
      {leader.sector ?? "RS"} · RS {leader.rs ?? "-"}
    </span>
  );
}

function HoldingRow({ card, stockeasyLeader }: { card: FeedbackCard; stockeasyLeader: StockeasyLeaderLite | null }) {
  const tone = card.recommendation.tone;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-400">{card.accountLabel}</p>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900">
            {card.name} <span className="font-mono text-[11px] text-slate-400">{card.code}</span>
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass(tone)} ${toneClass(tone, "bg")} ${toneClass(tone, "border")}`}>
          {card.recommendation.label}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-slate-600">{card.recommendation.action}</p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
        <StockeasyBadge leader={stockeasyLeader} />
        <span>손익 {pct(card.position.profitRatePct, 2)}</span>
        <span>비중 {card.position.accountWeightPct != null ? `${card.position.accountWeightPct.toFixed(1)}%` : "-"}</span>
        <span>점수 {card.decision?.score ?? "-"}</span>
      </div>
    </div>
  );
}

function MarketSignalPanel({ stockeasy }: { stockeasy: any }) {
  const marketSignal = stockeasy?.marketSignal;
  const strategies = (stockeasy?.strategyRoom?.strategies ?? []) as StockeasyStrategyLite[];
  const summary = stockeasy?.strategyRoom?.summary;
  return (
    <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <Signal size={14} /> 시장 신호등
            </p>
            <h2 className="mt-2 text-lg font-bold text-slate-950">
              단기 {marketSignal?.shortSignal ?? "-"} · 장기 {marketSignal?.longSignal ?? "-"}
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">
              StockEasy 공개 구조를 참고해 시장 노출과 계좌 행동을 같이 봅니다.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
            {stockeasy?.sourceTradingDateLabel ?? stockeasy?.sourceTradingDate ?? "-"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric label="KOSPI" value={`${marketSignal?.kospi?.statusLabel ?? "-"} · ${marketSignal?.kospi?.recommendedExposure ?? "-"}`} />
          <Metric label="KOSDAQ" value={`${marketSignal?.kosdaq?.statusLabel ?? "-"} · ${marketSignal?.kosdaq?.recommendedExposure ?? "-"}`} />
          <Metric label="KOSPI DD" value={`${marketSignal?.kospi?.distributionDays ?? "-"}개`} />
          <Metric label="KOSDAQ DD" value={`${marketSignal?.kosdaq?.distributionDays ?? "-"}개`} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <RadioTower size={14} /> 전략실 Pulse
            </p>
            <h2 className="mt-2 text-lg font-bold text-slate-950">
              {summary?.overallBias === "risk-on" ? "전략실은 위험선호 우위" : "전략실은 선택/냉각 감시"}
            </h2>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
            최강 {summary?.strongestName ?? "-"}
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {strategies.slice(0, 3).map((strategy) => (
            <div key={strategy.key ?? strategy.name} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="truncate text-[12px] font-semibold text-slate-900">{strategy.name ?? "-"}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{strategy.style ?? "-"}</p>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-600">
                <span>누적 {signedPct(strategy.cumulativeReturnPct)}</span>
                <span>주간 {signedPct(strategy.weekDeltaPct)}</span>
                <span>보유 {strategy.holdingCount ?? "-"}</span>
                <span>매수/이탈 {strategy.todayBuyCount ?? "-"} / {strategy.todayExitCount ?? "-"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StockeasyRadarPanel({ stockeasy }: { stockeasy: any }) {
  const sectors = (stockeasy?.stockAnalysis?.sectorRs ?? []).slice(0, 8);
  const leaders = (stockeasy?.stockAnalysis?.stockLeaders ?? []).slice(0, 8);
  const themes = (stockeasy?.marketThemes?.rawLines ?? [])
    .filter((line: string) => /^\d+$/.test(String(line)))
    .slice(0, 0);

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
          <TrendingUp size={14} /> RS 섹터 레이더
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sectors.map((sector: any) => (
            <span key={`${sector.sector}-${sector.rank}`} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
              {sector.rank}. {sector.sector} {sector.score}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
          <Target size={14} /> 상위 RS 종목
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {leaders.map((leader: StockeasyLeaderLite) => (
            <div key={`${leader.code}-${leader.sector}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="truncate text-[12px] font-semibold text-slate-900">
                {leader.name} <span className="font-mono text-[11px] text-slate-400">{leader.code}</span>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {leader.sector} · RS {leader.rs ?? "-"} · 1M {leader.rs1m ?? "-"} · 등락 {signedPct(leader.changePct)}
              </p>
            </div>
          ))}
        </div>
        {themes.length > 0 ? null : null}
      </div>
    </section>
  );
}

export default function PortfolioDashboardPage() {
  const proof = loadProof();
  const feedback = readRepoJsonFile<FeedbackFile>("data/holding-feedback/latest-holding-feedback.json");
  const view = readRepoJsonFile<DashboardView>("data/dashboard/latest-dashboard-view.json");
  const stockeasy = loadLatestStockeasySnapshot(view?.meta?.date ?? proof?.date ?? feedback?.date ?? null);
  const stockeasyLeaders = [
    ...((stockeasy?.stockAnalysis?.stockLeaders ?? []) as StockeasyLeaderLite[]),
    ...((stockeasy?.stockAnalysis?.promisingSectorTop100 ?? []) as StockeasyLeaderLite[]),
  ];
  const stockeasyLeaderByCode = new Map<string, StockeasyLeaderLite>();
  for (const leader of stockeasyLeaders) {
    if (leader.code && !stockeasyLeaderByCode.has(leader.code)) stockeasyLeaderByCode.set(leader.code, leader);
  }
  const urgentCards = (feedback?.cards ?? [])
    .filter((card) => card.recommendation.urgency === "high" || card.recommendation.urgency === "medium")
    .slice(0, 6);
  const todayDo = view?.accountStrategy?.todayDo?.slice(0, 4) ?? [];
  const stockPulseItems = view?.stockPulse?.items?.filter((item) => item.urgency === "높음").slice(0, 4) ?? [];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">Portfolio Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">계좌·종목 통합 대시보드</h1>
            <p className="mt-1 text-sm text-slate-500">
              계좌 증명기, 종목 피드백, StockPulse, 계좌 전략을 한 화면으로 묶었습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SectionLink href="/stockpilot-proof">계좌 증명기</SectionLink>
            <SectionLink href="/holding-feedback">종목 피드백</SectionLink>
            <SectionLink href="/stockpilot">신규 대시보드</SectionLink>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <div className={`rounded-lg border px-4 py-3 ${toneClass(proof?.summary.tone ?? "amber", "bg")} ${toneClass(proof?.summary.tone ?? "amber", "border")}`}>
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${toneClass(proof?.summary.tone ?? "amber")}`}>총판정</p>
            <p className={`mt-1 text-xl font-bold ${toneClass(proof?.summary.tone ?? "amber")}`}>{proof?.summary.verdict ?? "-"}</p>
          </div>
          <Metric label="증명 점수" value={proof ? `${proof.summary.proofScore}점` : "-"} />
          <Metric label="보유종목" value={feedback?.summary.totalHoldings ?? "-"} />
          <Metric label="긴급 점검" value={feedback?.summary.highUrgency ?? "-"} />
        </section>

        {stockeasy ? <MarketSignalPanel stockeasy={stockeasy} /> : null}

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                  <BriefcaseBusiness size={14} /> 오늘 계좌 결론
                </p>
                <h2 className="mt-2 text-lg font-bold text-slate-950">{view?.accountStrategy?.headline ?? proof?.summary.direction ?? "-"}</h2>
                <p className="mt-1 text-[13px] leading-6 text-slate-500">
                  {view?.rotationWatch?.summary?.headline ?? proof?.market?.headline ?? "-"}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {view?.accountStrategy?.stance ?? view?.rotationWatch?.summary?.stance ?? "-"}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(proof?.accounts ?? []).map((account) => (
                <AccountCard key={account.accountKey} account={account} />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <Target size={14} /> 오늘 할 일
            </p>
            <div className="mt-3 space-y-2">
              {todayDo.length > 0 ? (
                todayDo.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[13px] font-semibold text-slate-900">{item.action} · {item.name}</p>
                    <p className="mt-1 text-[12px] leading-5 text-slate-600">{item.reason}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">오늘 할 일 데이터가 없습니다.</p>
              )}
            </div>
          </div>
        </section>

        {stockeasy ? <StockeasyRadarPanel stockeasy={stockeasy} /> : null}

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <ShieldAlert size={14} /> 먼저 볼 보유종목
              </p>
              <SectionLink href="/holding-feedback">전체 보기</SectionLink>
            </div>
            <div className="mt-3 grid gap-2">
              {urgentCards.map((card) => (
                <HoldingRow key={`${card.accountKey}-${card.code}`} card={card} stockeasyLeader={stockeasyLeaderByCode.get(card.code) ?? null} />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <Gauge size={14} /> StockPulse 속보판
              </p>
              <span className="text-[11px] font-semibold text-slate-400">
                고긴급 {view?.stockPulse?.counts?.highUrgency ?? 0} · 중긴급 {view?.stockPulse?.counts?.mediumUrgency ?? 0}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-6 text-slate-600">{view?.stockPulse?.summary?.headline ?? "-"}</p>
            <div className="mt-3 space-y-2">
              {stockPulseItems.map((item) => (
                <div key={`${item.code}-${item.name}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[13px] font-semibold text-slate-900">
                    {item.name} <span className="font-mono text-[11px] text-slate-400">{item.code}</span> · {item.verdict}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-slate-600">{item.oneLine}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
            <BadgeCheck size={14} /> 하지 말 것
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {(view?.accountStrategy?.todayDoNot ?? []).slice(0, 6).map((item) => (
              <p key={item} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
                {item}
              </p>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
