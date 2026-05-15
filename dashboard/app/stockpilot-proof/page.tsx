export const dynamic = "force-dynamic";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleGauge,
  Compass,
  Radar,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { readRepoJsonFile } from "@/lib/repo-artifacts";

type Tone = "green" | "blue" | "amber" | "red" | string;

type ProofSector = {
  sector?: string | null;
  score?: number | null;
  rsScore?: number | null;
  label?: string | null;
  action?: string | null;
  sources?: string[];
  leaders?: Array<{ name?: string | null; score?: number | null }>;
  matchedEtfs?: Array<{ code?: string | null; name?: string | null; held?: boolean; score?: number | null }>;
};

type ProofAccount = {
  accountKey: string;
  accountLabel: string;
  totalValue?: number | null;
  cash?: number | null;
  deployBudget?: number | null;
  proofScore: number;
  tone: Tone;
  verdict: string;
  matchedExposure?: number | null;
  matchedExposurePct?: number | null;
  buckets?: Record<string, number>;
  topThemes?: string[];
  topRisks?: string[];
  proof?: string[];
  topMatches?: Array<{
    code?: string | null;
    name?: string | null;
    category?: string | null;
    marketValue?: number | null;
    profitRate?: number | null;
    decision?: string | null;
    sector?: string | null;
    sectorScore?: number | null;
  }>;
  redFlags?: Array<{
    code?: string | null;
    name?: string | null;
    decision?: string | null;
    flags?: string[];
    reason?: string | null;
  }>;
};

type ProofFile = {
  version: string;
  date: string;
  generatedAt?: string;
  summary: {
    proofScore: number;
    tone: Tone;
    verdict: string;
    direction: string;
    accountCount: number;
    strongAccountCount: number;
    weakAccountCount: number;
  };
  market: {
    stance?: string | null;
    mode?: string | null;
    headline?: string | null;
    nextAction?: string | null;
    externalSignal?: {
      short?: string | null;
      long?: string | null;
      strategyBias?: string | null;
      riskOnCount?: number | null;
      source?: string | null;
      kospi?: { statusLabel?: string | null; recommendedExposure?: string | null } | null;
      kosdaq?: { statusLabel?: string | null; recommendedExposure?: string | null } | null;
    };
    internalSignal?: {
      source?: string | null;
      topThemeSupport?: number | null;
      riskOn?: boolean | null;
    };
  };
  radar?: {
    label?: string | null;
    stockeasyDependent?: boolean;
    sourceCounts?: Record<string, number>;
    items?: ProofSector[];
  };
  stockeasySectors: ProofSector[];
  accounts: ProofAccount[];
  sourceStatus?: Record<string, boolean | number>;
  artifacts?: Record<string, string>;
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
  return palette[tone]?.[kind] ?? palette.amber[kind];
}

function krw(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  return `${Math.round(value / 10000).toLocaleString("ko-KR")}만원`;
}

function pct(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number") return "-";
  return `${value.toFixed(digits)}%`;
}

function scoreWidth(score: number) {
  return `${Math.max(0, Math.min(100, score))}%`;
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

function ScoreBar({ score, tone }: { score: number; tone: Tone }) {
  const fill =
    tone === "green" ? "bg-emerald-500" : tone === "blue" ? "bg-blue-500" : tone === "red" ? "bg-rose-500" : "bg-amber-500";
  return (
    <div className="flex items-center gap-3">
      <span className={`w-10 text-right text-lg font-bold tabular-nums ${toneClass(tone)}`}>{score}</span>
      <div className="h-2 flex-1 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${fill}`} style={{ width: scoreWidth(score) }} />
      </div>
    </div>
  );
}

function AccountProof({ account }: { account: ProofAccount }) {
  const bucketRows = Object.entries(account.buckets ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <article className={`rounded-lg border bg-white p-4 ${toneClass(account.tone, "border")}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold text-slate-950">{account.accountLabel}</p>
          <p className="mt-0.5 text-[12px] text-slate-500">{account.verdict}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass(account.tone)} ${toneClass(account.tone, "bg")} ${toneClass(account.tone, "border")}`}>
          {account.proofScore}점
        </span>
      </div>

      <div className="mt-4">
        <ScoreBar score={account.proofScore} tone={account.tone} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label="총 평가" value={krw(account.totalValue)} />
        <MiniMetric label="겹친 노출" value={krw(account.matchedExposure)} />
        <MiniMetric label="겹침 비중" value={pct(account.matchedExposurePct)} />
      </div>

      {bucketRows.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {bucketRows.map(([bucket, count]) => (
            <span key={bucket} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
              {bucket} {count}
            </span>
          ))}
        </div>
      )}

      {(account.proof ?? []).length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
          {account.proof!.slice(0, 4).map((item) => (
            <p key={item} className="flex gap-2 text-[12px] leading-6 text-slate-600">
              <CheckCircle2 size={13} className="mt-1 shrink-0 text-slate-400" />
              <span>{item}</span>
            </p>
          ))}
        </div>
      )}

      {(account.topMatches ?? []).length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">레이더와 겹치는 보유</p>
          <div className="mt-2 space-y-2">
            {account.topMatches!.slice(0, 4).map((item) => (
              <div key={`${item.code}-${item.sector}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-slate-800">{item.name}</p>
                  <p className="text-[11px] text-slate-500">{item.sector ?? item.category ?? "-"} · {item.decision ?? "-"}</p>
                </div>
                <p className="shrink-0 text-[12px] font-semibold text-slate-700 tabular-nums">{pct(item.profitRate)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(account.redFlags ?? []).length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            <AlertTriangle size={13} /> 검증 플래그
          </p>
          <div className="mt-1.5 space-y-1">
            {account.redFlags!.slice(0, 3).map((flag) => (
              <p key={`${flag.code}-${flag.reason}`} className="text-[12px] leading-5 text-amber-800">
                {flag.name}: {flag.decision ?? "-"} · {flag.reason}
              </p>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export default function StockPilotProofPage() {
  const proof = loadProof();

  if (!proof) {
    return (
      <main className="mx-auto w-full max-w-[calc(var(--dashboard-fixed-width)+60px)] px-3 py-10">
        <div className="glass-panel rounded-lg px-6 py-10 text-center">
          <CircleGauge size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">아직 StockPilot Proof 산출물이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-400">`npm run features:stockpilot-proof -- --date YYYY-MM-DD` 실행 후 다시 열어주세요.</p>
        </div>
      </main>
    );
  }

  const signal = proof.market.externalSignal;
  const internalSignal = proof.market.internalSignal;
  const radarItems = proof.radar?.items ?? proof.stockeasySectors ?? [];
  const sourceRows = Object.entries(proof.sourceStatus ?? {});

  return (
    <main className="mx-auto w-full max-w-[calc(var(--dashboard-fixed-width)+60px)] px-3 pb-12 pt-5">
      <section className="glass-panel rounded-lg px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">StockPilot Proof</p>
            <h1 className="mt-1.5 text-[1.45rem] font-semibold tracking-tight text-slate-950">
              계좌 방향성 증명기
            </h1>
            <p className="mt-1.5 max-w-3xl text-[13px] leading-6 text-slate-500">
              {proof.date} 기준 · 자체 레이더, 선택적 외부 관찰 신호, KIS 계좌, Stage4 실행조건을 결합해 오늘 내 계좌가 시장 방향을 얼마나 증명하는지 판정합니다.
            </p>
          </div>
          <div className={`rounded-lg border px-4 py-3 ${toneClass(proof.summary.tone, "bg")} ${toneClass(proof.summary.tone, "border")}`}>
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${toneClass(proof.summary.tone)}`}>총판정</p>
            <p className={`mt-1 text-xl font-bold ${toneClass(proof.summary.tone)}`}>{proof.summary.verdict}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-3">
          <MiniMetric label="평균 증명 점수" value={`${proof.summary.proofScore}점`} />
          <MiniMetric label="투자 방향" value={proof.summary.direction} />
          <MiniMetric label="시장 자세" value={proof.market.stance ?? "-"} />
          <MiniMetric label="계좌 수" value={proof.summary.accountCount} />
        </div>
      </section>

      <section className="mt-5 grid grid-cols-[1.05fr_1.35fr] gap-4">
        <div className="glass-panel rounded-lg px-5 py-4">
          <div className="flex items-center gap-2">
            <Compass size={16} className="text-blue-600" />
            <h2 className="text-[1rem] font-semibold text-slate-950">시장 방향</h2>
          </div>
          <p className="mt-3 text-[13px] leading-6 text-slate-600">{proof.market.headline}</p>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            다음 행동: {proof.market.nextAction}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniMetric label="단기/장기" value={`${signal?.short ?? "-"} / ${signal?.long ?? "-"}`} />
            <MiniMetric label="외부 소스" value={signal?.source ?? "unavailable"} />
            <MiniMetric label="전략실 Bias" value={`${signal?.strategyBias ?? "-"} · ${signal?.riskOnCount ?? 0}개`} />
            <MiniMetric label="KOSPI" value={`${signal?.kospi?.statusLabel ?? "-"} · ${signal?.kospi?.recommendedExposure ?? "-"}`} />
            <MiniMetric label="KOSDAQ" value={`${signal?.kosdaq?.statusLabel ?? "-"} · ${signal?.kosdaq?.recommendedExposure ?? "-"}`} />
            <MiniMetric label="내부 신호" value={`${internalSignal?.riskOn ? "risk-on" : "selective"} · ${internalSignal?.topThemeSupport ?? "-"}`} />
            <MiniMetric label="레이더 모드" value={proof.radar?.label ?? "-"} />
          </div>
        </div>

        <div className="glass-panel rounded-lg px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Radar size={16} className="text-emerald-600" />
              <h2 className="text-[1rem] font-semibold text-slate-950">강한 섹터 레이더</h2>
            </div>
            <span className="text-[12px] text-slate-400">{radarItems.length}개</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {radarItems.slice(0, 6).map((sector) => (
              <div key={sector.sector} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{sector.sector}</p>
                  <span className="text-[12px] font-bold text-emerald-700 tabular-nums">{sector.score ?? "-"}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">RS {sector.rsScore ?? "-"} · {sector.label ?? "-"} · {sector.action ?? "-"}</p>
                {(sector.leaders ?? []).length > 0 && (
                  <p className="mt-1 truncate text-[11px] text-slate-400">
                    {(sector.leaders ?? []).slice(0, 3).map((leader) => leader.name).join(", ")}
                  </p>
                )}
                {(sector.sources ?? []).length > 0 && (
                  <p className="mt-1 truncate text-[10px] uppercase tracking-wide text-slate-400">
                    {(sector.sources ?? []).join(" + ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={16} className="text-slate-700" />
          <h2 className="text-[1rem] font-semibold text-slate-950">계좌별 증명 결과</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {proof.accounts.map((account) => (
            <AccountProof key={account.accountKey} account={account} />
          ))}
        </div>
      </section>

      <section className="mt-5 grid grid-cols-[1fr_1fr] gap-4">
        <div className="glass-panel rounded-lg px-5 py-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-indigo-600" />
            <h2 className="text-[1rem] font-semibold text-slate-950">데이터 연결 상태</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {sourceRows.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="text-[12px] text-slate-500">{key}</span>
                <span className="text-[12px] font-semibold text-slate-800">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-lg px-5 py-4">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-600" />
            <h2 className="text-[1rem] font-semibold text-slate-950">산출물</h2>
          </div>
          <div className="mt-3 space-y-2">
            {Object.entries(proof.artifacts ?? {}).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{key}</p>
                <p className="mt-0.5 truncate text-[12px] text-slate-600">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
