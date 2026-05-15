export const dynamic = "force-dynamic";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { readRepoJsonFile } from "@/lib/repo-artifacts";

type Tone = "green" | "blue" | "amber" | "red" | string;

type HoldingFeedbackCard = {
  accountKey: string;
  accountLabel: string;
  code: string;
  name: string;
  question: string;
  recommendation: {
    label: string;
    action: string;
    urgency: "high" | "medium" | "low" | string;
    tone: Tone;
    oneLine: string;
  };
  position: {
    quantity?: number | null;
    avgPrice?: number | null;
    currentPrice?: number | null;
    marketValue?: number | null;
    accountWeightPct?: number | null;
    profitRatePct?: number | null;
    profitLoss?: number | null;
  };
  decision: {
    bucket?: string | null;
    label?: string | null;
    score?: number | null;
    sourceAction?: string | null;
  };
  technical: {
    rsi?: number | null;
    bollingerPosition?: string | null;
    atrPct?: number | null;
    recentHigh?: number | null;
    drawdownFromEntryPct?: number | null;
    drawdownFromRecentHighPct?: number | null;
    stopLossTriggered?: boolean;
  };
  levels: {
    support1?: number | null;
    support2?: number | null;
    resistance1?: number | null;
    resistance2?: number | null;
    method?: string | null;
  };
  bullCase?: string[];
  bearCase?: string[];
  executionRules?: string[];
};

type HoldingFeedbackFile = {
  version: string;
  date: string;
  generatedAt?: string;
  summary: {
    totalHoldings: number;
    highUrgency: number;
    mediumUrgency: number;
    lowUrgency: number;
    byLabel: Record<string, number>;
    byAccount: Record<string, number>;
  };
  cards: HoldingFeedbackCard[];
};

function loadFeedback() {
  return readRepoJsonFile<HoldingFeedbackFile>("data/holding-feedback/latest-holding-feedback.json");
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
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function krwShort(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  return `${Math.round(value / 10000).toLocaleString("ko-KR")}만원`;
}

function pct(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number") return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function compactList(items: string[] | undefined, fallback: string) {
  const rows = (items ?? []).filter(Boolean).slice(0, 4);
  if (rows.length === 0) return <p className="text-[12px] leading-5 text-slate-400">{fallback}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((item) => (
        <p key={item} className="flex gap-2 text-[12px] leading-5 text-slate-600">
          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-slate-400" />
          <span>{item}</span>
        </p>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

function FeedbackCard({ card }: { card: HoldingFeedbackCard }) {
  const tone = card.recommendation.tone;
  const isLoss = typeof card.position.profitRatePct === "number" && card.position.profitRatePct < 0;

  return (
    <article className={`rounded-lg border bg-white p-4 ${toneClass(tone, "border")}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-slate-400">{card.accountLabel}</p>
          <h2 className="mt-1 truncate text-[17px] font-bold text-slate-950">
            {card.name} <span className="font-mono text-[13px] text-slate-400">{card.code}</span>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass(tone)} ${toneClass(tone, "bg")} ${toneClass(tone, "border")}`}>
            {card.recommendation.label}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
            {card.decision.score ?? "-"}점
          </span>
        </div>
      </div>

      <div className={`mt-4 rounded-lg border px-3 py-3 ${toneClass(tone, "bg")} ${toneClass(tone, "border")}`}>
        <p className={`flex items-center gap-2 text-[13px] font-semibold ${toneClass(tone)}`}>
          {card.recommendation.urgency === "high" ? <ShieldAlert size={15} /> : <ClipboardCheck size={15} />}
          {card.recommendation.action}
        </p>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-700">{card.recommendation.oneLine}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="평단 / 현재가" value={`${krw(card.position.avgPrice)} / ${krw(card.position.currentPrice)}`} />
        <Metric label="손익률" value={pct(card.position.profitRatePct, 2)} />
        <Metric label="평가금액" value={krwShort(card.position.marketValue)} />
        <Metric label="계좌 비중" value={card.position.accountWeightPct != null ? `${card.position.accountWeightPct.toFixed(1)}%` : "-"} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
            <Gauge size={14} /> 기술/가격
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label="RSI" value={card.technical.rsi != null ? card.technical.rsi.toFixed(1) : "-"} />
            <Metric label="볼린저" value={card.technical.bollingerPosition ?? "-"} />
            <Metric label="평단 대비" value={pct(card.technical.drawdownFromEntryPct, 1)} />
            <Metric label="고점 대비" value={pct(card.technical.drawdownFromRecentHighPct, 1)} />
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">내부 기준선</p>
            <p className="mt-1 text-[12px] leading-5 text-slate-600">
              지지 {krw(card.levels.support1)} / {krw(card.levels.support2)}
              <br />
              저항 {krw(card.levels.resistance1)} / {krw(card.levels.resistance2)}
            </p>
          </div>
          {(card.technical.stopLossTriggered || isLoss) && (
            <p className="mt-3 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-5 text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              손절/손실 구간은 추가매수보다 이탈 기준 확인이 먼저입니다.
            </p>
          )}
        </div>

        <div className="grid gap-3">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <TrendingUp size={14} /> 긍정 근거
            </p>
            <div className="mt-2">{compactList(card.bullCase, "오늘 연결된 긍정 근거가 약합니다.")}</div>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <AlertTriangle size={14} /> 리스크
            </p>
            <div className="mt-2">{compactList(card.bearCase, "특이 리스크 플래그 없음")}</div>
          </section>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
          <BarChart3 size={14} /> 실행 규칙
        </p>
        <div className="mt-2">{compactList(card.executionRules, "실행 규칙 없음")}</div>
      </div>
    </article>
  );
}

export default function HoldingFeedbackPage() {
  const data = loadFeedback();

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
        <div className="mx-auto max-w-5xl rounded-lg border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-bold">종목 피드백 데이터가 없습니다</h1>
          <p className="mt-2 text-sm text-slate-500">`npm run features:holding-feedback` 실행 후 다시 확인하세요.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">Holding Feedback</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">보유종목별 피드백</h1>
            <p className="mt-1 text-sm text-slate-500">{data.date} 기준 · 내 평단과 현재 보유비중으로 만든 실행 판단</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="총 종목" value={`${data.summary.totalHoldings}`} />
            <Metric label="긴급" value={`${data.summary.highUrgency}`} />
            <Metric label="점검" value={`${data.summary.mediumUrgency}`} />
          </div>
        </header>

        <section className="grid gap-4">
          {data.cards.map((card) => (
            <FeedbackCard key={`${card.accountKey}-${card.code}`} card={card} />
          ))}
        </section>
      </div>
    </main>
  );
}
