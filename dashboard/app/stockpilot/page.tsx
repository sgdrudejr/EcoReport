export const dynamic = "force-dynamic";

import fs from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  Eye,
  Minus,
  ShieldAlert,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

import { resolveRepoRoot } from "@/lib/repo-root";

// ─── 타입 ─────────────────────────────────────────────────────────────

type PolicyState = "BUY" | "WATCH" | "REJECT" | "ADD" | "HOLD" | "TRIM" | "EXIT";

type StockpilotHolding = {
  code: string;
  name: string;
  ticker?: string;
  final_score: number;
  filter_score: number;
  policy_state: PolicyState;
  factors?: Record<string, number | null>;
  gates?: Record<string, boolean>;
  commentary?: string;
  sourceMeta?: {
    stance?: string;
    confidence?: number;
    target_accounts?: string[];
    thesis?: string;
    horizon?: string;
  };
};

type StockpilotCandidate = StockpilotHolding;

type Stage3File = {
  date: string;
  generatedAt?: string;
  regime?: {
    name?: string;
    confidence?: number;
    signals?: string[];
    market_context?: {
      close?: number;
      rsi?: number;
      ma?: { ma20?: number; ma60?: number };
    };
  };
  coverage?: {
    factorCoverage?: number;
    techCoverage?: number;
  };
  leadingIndicator?: {
    score?: number;
    t10y2y?: number;
    vix?: number;
    cpiYoy?: number;
  };
  quality?: {
    unrelatedEvidenceRatio?: number;
    blockedEvidenceCount?: number;
  };
  stockpilotQuant?: {
    holdings?: StockpilotHolding[];
    candidates?: StockpilotCandidate[];
    summary?: {
      n_holdings?: number;
      n_candidates?: number;
      top_holdings?: Array<{ code: string; name: string; final_score: number; policy_state: PolicyState }>;
      top_candidates?: Array<{ code: string; name: string; final_score: number; policy_state: PolicyState }>;
    };
    macro?: {
      regime?: { name?: string; confidence?: number; signals?: string[] };
      leadingIndicator?: { score?: number; vix?: number; t10y2y?: number; cpiYoy?: number };
    };
  };
  accounts?: Record<string, {
    totalScore?: number;
    stage2Bias?: string;
    deployBudget?: number;
    coverage?: { factorCoverage?: number; techCoverage?: number };
  }>;
};

type Stage4File = {
  date?: string;
  portfolioScore?: number;
  emergencyDefense?: { enabled?: boolean; triggers?: string[] };
  accountPlans?: Array<{
    key: string;
    label?: string;
    totalScore?: number;
    stage2Bias?: string;
    deployBudget?: number;
    plannedDeployBudget?: number;
    topGap?: { category?: string; targetPct?: number; currentPct?: number; gapAmount?: number };
    stagedBuys?: Array<{ code?: string; name?: string; suggestedAmount?: number; urgency?: string; entryTriggers?: string[]; entryCondition?: string; confidence?: number; reason?: string }>;
    watches?: Array<{ code?: string; name?: string; reason?: string }>;
    trims?: Array<{ code?: string; name?: string; suggestedAmount?: number; reason?: string }>;
    holds?: Array<{ code?: string; name?: string; reason?: string }>;
    rejectedAlternatives?: Array<{ code?: string; name?: string; rejectionReason?: string }>;
    validatorFlags?: string[];
    validationConfidence?: number;
    noAction?: boolean;
    noActionReason?: string;
  }>;
};

type ImpactMapFile = {
  stage2MacroView?: { regime?: string; confidence?: string; summary?: string };
  reports?: Array<{ reportId?: string; title?: string; broker?: string; reportMeta?: { sector?: string; themes?: string[] } }>;
};

type DailyQualityFile = {
  stage1?: { contaminationRate?: number };
  stage3?: { unrelatedEvidenceRatio?: number; blockedEvidenceCount?: number };
  stage4?: { actionConflictCount?: number; noActionCount?: number };
};

type ReverseEngineeringFactor = {
  key?: string;
  label?: string;
  effect?: number;
};

type ReverseEngineeringGate = {
  key?: string;
  delta?: number;
};

type StockeasyReverseEngineeringFile = {
  strategy?: string;
  strategyLabel?: string;
  asOfDate?: string;
  coverage?: {
    buyEventsTotal?: number;
    buyEventsAnalyzed?: number;
    exitEventsTotal?: number;
    exitEventsAnalyzed?: number;
  };
  inference?: {
    likelyStyle?: string;
    confidence?: string;
  };
  buyAttribution?: {
    topFactors?: ReverseEngineeringFactor[];
    topGates?: ReverseEngineeringGate[];
  };
  exitAttribution?: {
    topFactors?: ReverseEngineeringFactor[];
  };
};

type StockeasyFinalReport = {
  reportDate: string | null;
  reportMarkdown: string | null;
  momentum: StockeasyReverseEngineeringFile | null;
  peak: StockeasyReverseEngineeringFile | null;
  value: StockeasyReverseEngineeringFile | null;
};

// ─── 데이터 로더 ──────────────────────────────────────────────────────

function loadLatestDate(analysisDir: string, requiredFiles: string[] = []): string | null {
  if (!fs.existsSync(analysisDir)) return null;
  const dirs = fs
    .readdirSync(analysisDir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  if (requiredFiles.length === 0) {
    return dirs[0] ?? null;
  }
  for (const date of dirs) {
    const dailyDir = path.join(analysisDir, date);
    const ok = requiredFiles.every((file) => fs.existsSync(path.join(dailyDir, file)));
    if (ok) return date;
  }
  return dirs[0] ?? null;
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readText(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function loadLatestStockeasyReport(knowledgeDailyDir: string) {
  if (!fs.existsSync(knowledgeDailyDir)) {
    return { reportDate: null, reportMarkdown: null };
  }
  const candidates = fs
    .readdirSync(knowledgeDailyDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}-stockeasy-style-comparison\.md$/.test(name))
    .sort()
    .reverse();
  const latest = candidates[0];
  if (!latest) {
    return { reportDate: null, reportMarkdown: null };
  }
  const reportDate = latest.slice(0, 10);
  return {
    reportDate,
    reportMarkdown: readText(path.join(knowledgeDailyDir, latest)),
  };
}

function loadStockeasyByDate(analysisDir: string, date: string | null): Omit<StockeasyFinalReport, "reportDate" | "reportMarkdown"> {
  if (!date) {
    return {
      momentum: null,
      peak: null,
      value: null,
    };
  }
  const dailyDir = path.join(analysisDir, date);
  return {
    momentum: readJson<StockeasyReverseEngineeringFile>(
      path.join(dailyDir, "stockeasy-momentum-reverse-engineering.json"),
    ),
    peak: readJson<StockeasyReverseEngineeringFile>(
      path.join(dailyDir, "stockeasy-peak-reverse-engineering.json"),
    ),
    value: readJson<StockeasyReverseEngineeringFile>(
      path.join(dailyDir, "stockeasy-value-reverse-engineering.json"),
    ),
  };
}

function loadPageData() {
  const root = resolveRepoRoot();
  const analysisDir = path.join(root, "data", "analysis-state");
  const knowledgeDailyDir = path.join(root, "knowledge", "daily");
  const date = loadLatestDate(analysisDir, ["stage3-quant-scores.json", "stage4-execution-plan.json"]);
  const latestStockeasy = loadLatestStockeasyReport(knowledgeDailyDir);
  const stockeasyFromLatest = loadStockeasyByDate(analysisDir, latestStockeasy.reportDate);
  const stockeasyFallback = loadStockeasyByDate(analysisDir, date);
  const stockeasy: StockeasyFinalReport = {
    reportDate: latestStockeasy.reportDate,
    reportMarkdown: latestStockeasy.reportMarkdown,
    momentum: stockeasyFromLatest.momentum ?? stockeasyFallback.momentum,
    peak: stockeasyFromLatest.peak ?? stockeasyFallback.peak,
    value: stockeasyFromLatest.value ?? stockeasyFallback.value,
  };
  if (!date) return { date: null, s3: null, s4: null, impact: null, quality: null, stockeasy };

  const dir = path.join(analysisDir, date);
  return {
    date,
    s3: readJson<Stage3File>(path.join(dir, "stage3-quant-scores.json")),
    s4: readJson<Stage4File>(path.join(dir, "stage4-execution-plan.json")),
    impact: readJson<ImpactMapFile>(path.join(dir, "impact-map.json")),
    quality: readJson<DailyQualityFile>(path.join(dir, "daily-quality.json")),
    stockeasy,
  };
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────

function policyBadge(policy: PolicyState | undefined) {
  switch (policy) {
    case "BUY":
      return { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "BUY" };
    case "WATCH":
      return { cls: "border-sky-200 bg-sky-50 text-sky-700", label: "WATCH" };
    case "ADD":
      return { cls: "border-indigo-200 bg-indigo-50 text-indigo-700", label: "ADD" };
    case "HOLD":
      return { cls: "border-slate-200 bg-slate-50 text-slate-600", label: "HOLD" };
    case "TRIM":
      return { cls: "border-amber-200 bg-amber-50 text-amber-700", label: "TRIM" };
    case "EXIT":
      return { cls: "border-rose-200 bg-rose-50 text-rose-700", label: "EXIT" };
    case "REJECT":
      return { cls: "border-slate-200 bg-slate-100 text-slate-400", label: "REJECT" };
    default:
      return { cls: "border-slate-200 bg-slate-50 text-slate-500", label: policy ?? "-" };
  }
}

function scoreMeter(score: number) {
  if (score >= 60) return "text-emerald-600";
  if (score >= 35) return "text-amber-600";
  if (score > 0) return "text-orange-500";
  return "text-slate-400";
}

function scoreBg(score: number) {
  if (score >= 60) return "bg-emerald-500";
  if (score >= 35) return "bg-amber-400";
  if (score > 0) return "bg-orange-400";
  return "bg-slate-300";
}

function regimeColor(name: string | undefined) {
  if (!name) return "text-slate-500";
  const n = name.toLowerCase();
  if (n.includes("growth")) return "text-emerald-600";
  if (n.includes("risk")) return "text-rose-600";
  if (n.includes("stagflation") || n.includes("recession")) return "text-red-600";
  if (n.includes("inflation")) return "text-amber-600";
  return "text-indigo-600";
}

function pct(v: number | undefined | null, digits = 1) {
  if (typeof v !== "number") return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

function num(v: number | undefined | null, digits = 1) {
  if (typeof v !== "number") return "-";
  return v.toFixed(digits);
}

function signed(v: number | undefined | null, digits = 3) {
  if (typeof v !== "number") return "-";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function krw(v: number | undefined | null) {
  if (typeof v !== "number") return "-";
  return `${Math.round(v / 10000).toLocaleString()}만원`;
}

function urgencyBadge(urgency: string | undefined) {
  if (urgency === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (urgency === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function biasLabel(bias: string | null | undefined) {
  if (bias === "selective_add") return "보강";
  if (bias === "hold") return "유지";
  if (bias === "aggressive_add") return "적극 보강";
  if (bias === "reduce" || bias === "trim") return "축소";
  return bias ?? "-";
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────

function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="section-kicker mb-1">{children}</p>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[1.05rem] font-semibold tracking-tight text-slate-900">{children}</h2>;
}

function PolicyChip({ policy }: { policy: PolicyState | undefined }) {
  const { cls, label } = policyBadge(policy);
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase ${cls}`}>
      {label}
    </span>
  );
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pctVal = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className={`w-8 text-right text-sm font-semibold tabular-nums ${scoreMeter(score)}`}>{score.toFixed(0)}</span>
      <div className="h-1.5 flex-1 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full transition-all ${scoreBg(score)}`} style={{ width: `${pctVal}%` }} />
      </div>
    </div>
  );
}

function CoverageBar({ label, value }: { label: string; value: number | undefined | null }) {
  const v = typeof value === "number" ? Math.round(value * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-slate-100">
        <div
          className={`h-1.5 rounded-full transition-all ${v >= 50 ? "bg-emerald-400" : v >= 20 ? "bg-amber-400" : "bg-slate-300"}`}
          style={{ width: `${Math.min(100, v)}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium text-slate-600 tabular-nums">{v}%</span>
    </div>
  );
}

function GateRow({ name, passed }: { name: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {passed
        ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
        : <XCircle size={12} className="text-rose-400 shrink-0" />}
      <span className={passed ? "text-slate-600" : "text-slate-400 line-through"}>{name.replace(/_/g, " ")}</span>
    </div>
  );
}

function HoldingCard({ h }: { h: StockpilotHolding }) {
  const { cls, label } = policyBadge(h.policy_state);
  const gates = h.gates ? Object.entries(h.gates) : [];
  const passedGates = gates.filter(([, v]) => v).length;

  return (
    <div className="glass-panel-soft rounded-2xl p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-slate-900 leading-tight">{h.name}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{h.code}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase ${cls}`}>{label}</span>
      </div>

      {/* 점수 바 */}
      <ScoreBar score={h.final_score} />

      {/* 게이트 */}
      {gates.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
          {gates.slice(0, 6).map(([k, v]) => <GateRow key={k} name={k} passed={v} />)}
        </div>
      )}

      {/* 게이트 통과율 */}
      {gates.length > 0 && (
        <p className="text-[11px] text-slate-400">게이트 {passedGates}/{gates.length} 통과</p>
      )}

      {/* 코멘터리 */}
      {h.commentary && (
        <p className="text-[12px] leading-[1.65] text-slate-500 border-t border-slate-100 pt-2">{h.commentary}</p>
      )}
    </div>
  );
}

function CandidateRow({ c, rank }: { c: StockpilotCandidate; rank: number }) {
  const { cls } = policyBadge(c.policy_state);
  const stance = c.sourceMeta?.stance ?? "-";
  const confidence = c.sourceMeta?.confidence ?? 0;
  const thesis = c.sourceMeta?.thesis;
  const targets = (c.sourceMeta?.target_accounts ?? []).join(", ");

  return (
    <div className="glass-panel-soft rounded-2xl p-4 space-y-2.5">
      {/* 상단 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{rank}</span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900 leading-tight">{c.name}</p>
            <p className="text-[11px] text-slate-400">{c.code}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase ${cls}`}>{c.policy_state}</span>
          <span className="text-[11px] text-slate-400">stance: {stance}</span>
        </div>
      </div>

      {/* 점수 + 신뢰도 */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <ScoreBar score={c.final_score} />
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-400">신뢰도</p>
          <p className="text-sm font-semibold text-slate-700">{Math.round(confidence * 100)}%</p>
        </div>
      </div>

      {/* 대상 계좌 */}
      {targets && (
        <p className="text-[11px] text-slate-400">계좌: <span className="font-medium text-slate-600">{targets}</span></p>
      )}

      {/* 투자 근거 */}
      {thesis && (
        <p className="text-[12px] leading-[1.65] text-slate-500 border-t border-slate-100 pt-2">{thesis}</p>
      )}
    </div>
  );
}

function AccountPlanCard({
  plan,
}: {
  plan: NonNullable<Stage4File["accountPlans"]>[number];
}) {
  const bias = plan.stage2Bias;
  const buys = plan.stagedBuys ?? [];
  const watches = plan.watches ?? [];
  const trims = plan.trims ?? [];
  const holds = plan.holds ?? [];
  const flags = plan.validatorFlags ?? [];

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-[13px] font-semibold text-slate-900">{plan.label ?? plan.key}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            스코어 <span className="font-semibold text-slate-700">{plan.totalScore ?? "-"}</span>
            {bias && <> · <span className="font-medium text-indigo-600">{biasLabel(bias)}</span></>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-400">배포 예산</p>
          <p className="text-base font-semibold text-slate-800 tabular-nums">{krw(plan.deployBudget)}</p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* topGap */}
        {plan.topGap?.category && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">비중 부족 카테고리</p>
            <p className="mt-1 text-sm font-semibold text-amber-900">{plan.topGap.category}</p>
            <p className="mt-0.5 text-xs text-amber-700">
              목표 {pct(plan.topGap.targetPct)} → 현재 {pct(plan.topGap.currentPct)}
              {plan.topGap.gapAmount != null && ` (부족 ${krw(plan.topGap.gapAmount)})`}
            </p>
          </div>
        )}

        {/* 매수 후보 */}
        {buys.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <Zap size={12} /> 매수 후보 {buys.length}개
            </p>
            <div className="space-y-2">
              {buys.map((b) => (
                <div key={b.code ?? b.name} className="flex items-start justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-2.5">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-900">{b.name ?? b.code}</p>
                    {b.entryCondition && <p className="mt-0.5 text-[11px] text-slate-500">{b.entryCondition}</p>}
                    {b.reason && <p className="mt-1 text-[11px] leading-[1.55] text-slate-500">{b.reason}</p>}
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    {b.suggestedAmount != null && (
                      <p className="text-sm font-semibold text-slate-800 tabular-nums">{krw(b.suggestedAmount)}</p>
                    )}
                    {b.urgency && (
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${urgencyBadge(b.urgency)}`}>
                        {b.urgency}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 관망 */}
        {watches.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-700">
              <Eye size={12} /> 관망 {watches.length}개
            </p>
            <div className="flex flex-wrap gap-2">
              {watches.map((w) => (
                <span key={w.code ?? w.name} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-700">
                  {w.name ?? w.code}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 비중 축소 */}
        {trims.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <ArrowDown size={12} /> 비중 축소 {trims.length}개
            </p>
            <div className="space-y-1">
              {trims.map((t) => (
                <div key={t.code ?? t.name} className="flex items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
                  <p className="text-[13px] font-medium text-slate-700">{t.name ?? t.code}</p>
                  {t.suggestedAmount != null && <p className="text-xs tabular-nums text-amber-700">{krw(t.suggestedAmount)}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 유지 */}
        {holds.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <Minus size={12} /> 유지 {holds.length}개
            </p>
            <div className="flex flex-wrap gap-2">
              {holds.map((h) => (
                <span key={h.code ?? h.name} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
                  {h.name ?? h.code}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 검증 플래그 */}
        {flags.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 space-y-1">
            <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">검증 플래그</p>
            {flags.map((f) => (
              <p key={f} className="text-[12px] text-amber-700">· {f}</p>
            ))}
          </div>
        )}

        {/* 노액션 */}
        {plan.noAction && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 text-center">
            {plan.noActionReason ?? "현 시점 실행 없음"}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────

export default function StockPilotPage() {
  const { date, s3, s4, impact, quality, stockeasy } = loadPageData();

  const spq = s3?.stockpilotQuant;
  const holdings = spq?.holdings ?? [];
  const candidates = (spq?.candidates ?? []).filter((c) => c.policy_state !== "REJECT");
  const rejectedCandidates = (spq?.candidates ?? []).filter((c) => c.policy_state === "REJECT");
  const accountPlans = s4?.accountPlans ?? [];
  const regime = s3?.regime ?? spq?.macro?.regime;
  const leading = s3?.leadingIndicator ?? spq?.macro?.leadingIndicator;
  const coverage = s3?.coverage;
  const portfolioScore = s4?.portfolioScore;
  const emergency = s4?.emergencyDefense;
  const macroSummary = impact?.stage2MacroView;
  const reportCount = impact?.reports?.length ?? 0;

  // 섹터 분포
  const sectorMap: Record<string, number> = {};
  for (const r of impact?.reports ?? []) {
    const sec = r.reportMeta?.sector ?? "기타";
    sectorMap[sec] = (sectorMap[sec] ?? 0) + 1;
  }
  const topSectors = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const noData = !s3 && !s4;
  const stockeasyStrategies = [
    { key: "momentum", label: "Momentum", data: stockeasy?.momentum },
    { key: "peak", label: "Peak", data: stockeasy?.peak },
    { key: "value", label: "Value", data: stockeasy?.value },
  ].filter((item) => item.data);
  const hasStockeasyReport = Boolean(stockeasy?.reportMarkdown) || stockeasyStrategies.length > 0;

  return (
    <main className="mx-auto w-full max-w-[calc(var(--dashboard-fixed-width)+60px)] px-3 pb-12 pt-5">
      {/* ── 페이지 헤더 ─────────────────────────────────────── */}
      <div className="glass-panel mb-5 rounded-2xl px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">StockPilot · Quant Dashboard</p>
            <h1 className="mt-1.5 text-[1.4rem] font-semibold tracking-tight text-slate-950">
              신규 대시보드
            </h1>
            <p className="mt-1.5 text-[13px] leading-[1.7] text-slate-500">
              {date ? `${date} 기준` : "데이터 없음"} · 10. Quant Scoring + 11. Execution Plan
            </p>
          </div>

          {/* 비상방어 배너 */}
          {emergency?.enabled && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5">
              <ShieldAlert size={15} className="text-rose-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-rose-700 uppercase tracking-wide">비상 방어 모드</p>
                {emergency.triggers?.map((t) => (
                  <p key={t} className="text-[11px] text-rose-600">{t}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 상단 지표 바 */}
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {/* 포트폴리오 스코어 */}
          <div className="rounded-xl border border-slate-200 bg-white/80 px-3.5 py-3">
            <p className="text-[11px] text-slate-400">포트폴리오 점수</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${scoreMeter(portfolioScore ?? 0)}`}>
              {portfolioScore ?? "-"}
            </p>
          </div>

          {/* 레짐 */}
          <div className="rounded-xl border border-slate-200 bg-white/80 px-3.5 py-3">
            <p className="text-[11px] text-slate-400">시장 레짐</p>
            <p className={`mt-1 text-[13px] font-bold leading-tight ${regimeColor(regime?.name)}`}>
              {regime?.name ?? "-"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">신뢰 {Math.round((regime?.confidence ?? 0) * 100)}%</p>
          </div>

          {/* VIX */}
          <div className="rounded-xl border border-slate-200 bg-white/80 px-3.5 py-3">
            <p className="text-[11px] text-slate-400">VIX</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{num(leading?.vix)}</p>
          </div>

          {/* 장단기 스프레드 */}
          <div className="rounded-xl border border-slate-200 bg-white/80 px-3.5 py-3">
            <p className="text-[11px] text-slate-400">10Y-2Y 스프레드</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${(leading?.t10y2y ?? 0) > 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {num(leading?.t10y2y)}%
            </p>
          </div>

          {/* CPI */}
          <div className="rounded-xl border border-slate-200 bg-white/80 px-3.5 py-3">
            <p className="text-[11px] text-slate-400">CPI YoY</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{num(leading?.cpiYoy)}%</p>
          </div>

          {/* 선행 점수 */}
          <div className="rounded-xl border border-slate-200 bg-white/80 px-3.5 py-3">
            <p className="text-[11px] text-slate-400">선행 스코어</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${scoreMeter(leading?.score ?? 0)}`}>
              {leading?.score ?? "-"}
            </p>
          </div>
        </div>

        {/* 커버리지 바 */}
        {coverage && (
          <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">데이터 커버리지</p>
            <CoverageBar label="팩터" value={coverage.factorCoverage} />
            <CoverageBar label="기술적" value={coverage.techCoverage} />
          </div>
        )}

        {/* 레짐 신호 */}
        {(regime?.signals ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {regime!.signals!.map((s) => (
              <span key={s} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] text-indigo-700">{s}</span>
            ))}
          </div>
        )}
      </div>

      {noData && (
        <div className="glass-panel rounded-2xl px-6 py-10 text-center text-slate-400">
          <CircleDashed size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">분석 데이터가 없습니다. 파이프라인을 먼저 실행해주세요.</p>
        </div>
      )}

      {/* ── Final Report. StockEasy 역추정 리포트 ───────────────────── */}
      {hasStockeasyReport && (
        <section className="section-shell mb-5">
          <div className="section-block" />
          <div className="glass-panel rounded-2xl px-6 py-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Kicker>Final Report · StockEasy</Kicker>
                <SectionTitle>최종 리포트 반영 (역추정 결과)</SectionTitle>
              </div>
              <p className="text-[12px] text-slate-500">
                기준일: {stockeasy?.reportDate ?? date ?? "-"}
              </p>
            </div>

            {stockeasyStrategies.length > 0 && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {stockeasyStrategies.map(({ key, label, data }) => {
                  const coverage = data?.coverage;
                  const buyTop = data?.buyAttribution?.topFactors?.slice(0, 3) ?? [];
                  const buyGateTop = data?.buyAttribution?.topGates?.slice(0, 1) ?? [];
                  const exitTop = data?.exitAttribution?.topFactors?.slice(0, 2) ?? [];
                  return (
                    <article key={key} className="glass-panel-soft rounded-2xl p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{label}</p>
                          <p className="mt-0.5 text-[13px] font-semibold text-slate-900">
                            {data?.strategyLabel ?? "-"}
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                          {String(data?.inference?.confidence ?? "-").toUpperCase()}
                        </span>
                      </div>

                      <p className="mt-2 text-[12px] leading-[1.6] text-slate-600">
                        {data?.inference?.likelyStyle ?? "-"}
                      </p>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-600">
                          매수 분석 {coverage?.buyEventsAnalyzed ?? 0}/{coverage?.buyEventsTotal ?? 0}
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-600">
                          매도 분석 {coverage?.exitEventsAnalyzed ?? 0}/{coverage?.exitEventsTotal ?? 0}
                        </div>
                      </div>

                      {buyTop.length > 0 && (
                        <div className="mt-3 border-t border-slate-100 pt-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">매수 Top</p>
                          <div className="mt-1.5 space-y-1">
                            {buyTop.map((factor) => (
                              <p key={factor.key} className="text-[12px] text-slate-600">
                                {factor.label ?? factor.key}: <span className="font-medium text-slate-800">{signed(factor.effect)}</span>
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {exitTop.length > 0 && (
                        <div className="mt-2 border-t border-slate-100 pt-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">매도 Top</p>
                          <div className="mt-1.5 space-y-1">
                            {exitTop.map((factor) => (
                              <p key={factor.key} className="text-[12px] text-slate-600">
                                {factor.label ?? factor.key}: <span className="font-medium text-slate-800">{signed(factor.effect)}</span>
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {buyGateTop.length > 0 && (
                        <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-indigo-700">대표 게이트 차이</p>
                          <p className="mt-1 text-[12px] text-indigo-800">
                            {buyGateTop[0]?.key}: {signed(buyGateTop[0]?.delta)}
                          </p>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {stockeasy?.reportMarkdown && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white/85 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  최종 비교 리포트 (Markdown → HTML)
                </p>
                <div className="prose prose-slate mt-3 max-w-none text-sm leading-7">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {stockeasy.reportMarkdown}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── A. 매크로 뷰 ────────────────────────────────────── */}
      {macroSummary?.summary && (
        <section className="section-shell mb-5">
          <div className="section-block" />
          <div className="glass-panel rounded-2xl px-6 py-5">
            <Kicker>07. Strategy Options · 매크로 뷰</Kicker>
            <SectionTitle>시황 요약</SectionTitle>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
                {macroSummary.regime ?? "-"}
              </span>
              <span className="text-[12px] text-slate-500">신뢰도: {macroSummary.confidence ?? "-"}</span>
            </div>
            <p className="mt-3 text-[13px] leading-[1.75] text-slate-600">{macroSummary.summary}</p>
          </div>
        </section>
      )}

      {/* ── B. 보유 종목 퀀트 ───────────────────────────────── */}
      {holdings.length > 0 && (
        <section className="section-shell mb-5">
          <div className="section-block" />
          <div className="glass-panel rounded-2xl px-6 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <Kicker>10. Quant Scoring · Holdings</Kicker>
                <SectionTitle>보유 종목 퀀트 평가</SectionTitle>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["ADD", "HOLD", "TRIM", "EXIT"] as PolicyState[]).map((p) => {
                  const count = holdings.filter((h) => h.policy_state === p).length;
                  if (!count) return null;
                  const { cls } = policyBadge(p);
                  return (
                    <span key={p} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase ${cls}`}>
                      {p} {count}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {holdings.map((h) => <HoldingCard key={h.code} h={h} />)}
            </div>
          </div>
        </section>
      )}

      {/* ── C. 신규 후보 종목 ───────────────────────────────── */}
      {candidates.length > 0 && (
        <section className="section-shell mb-5">
          <div className="section-block" />
          <div className="glass-panel rounded-2xl px-6 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <Kicker>10. Quant Scoring · Candidates</Kicker>
                <SectionTitle>신규 후보 종목</SectionTitle>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["BUY", "WATCH"] as PolicyState[]).map((p) => {
                  const count = candidates.filter((c) => c.policy_state === p).length;
                  if (!count) return null;
                  const { cls } = policyBadge(p);
                  return (
                    <span key={p} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase ${cls}`}>
                      {p} {count}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {candidates.map((c, i) => <CandidateRow key={c.code} c={c} rank={i + 1} />)}
            </div>

            {/* 제외된 후보 */}
            {rejectedCandidates.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">제외된 후보</p>
                <div className="flex flex-wrap gap-2">
                  {rejectedCandidates.map((c) => (
                    <span key={c.code} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-400 line-through">
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── D. 계좌별 실행 계획 ─────────────────────────────── */}
      {accountPlans.length > 0 && (
        <section className="section-shell mb-5">
          <div className="section-block" />
          <div>
            <div className="mb-3">
              <Kicker>11. Execution Plan</Kicker>
              <SectionTitle>계좌별 실행 계획</SectionTitle>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {accountPlans.map((plan) => <AccountPlanCard key={plan.key} plan={plan} />)}
            </div>
          </div>
        </section>
      )}

      {/* ── E. 리포트 커버리지 맵 ───────────────────────────── */}
      {reportCount > 0 && (
        <section className="section-shell mb-5">
          <div className="section-block" />
          <div className="glass-panel rounded-2xl px-6 py-5">
            <Kicker>Impact Map · 리포트 커버리지</Kicker>
            <SectionTitle>오늘 분석에 사용된 리포트 {reportCount}건</SectionTitle>
            {topSectors.length > 0 && (
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                {topSectors.map(([sector, count]) => (
                  <div key={sector} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-3.5 py-2.5">
                    <p className="text-[13px] font-medium text-slate-700">{sector}</p>
                    <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">{count}건</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── F. 데이터 품질 ──────────────────────────────────── */}
      {quality && (
        <section className="section-shell">
          <div className="section-block" />
          <div className="glass-panel rounded-2xl px-6 py-5">
            <Kicker>System</Kicker>
            <SectionTitle>데이터 품질</SectionTitle>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
                <p className="text-[11px] text-slate-400">03. Report Indexing 오염률</p>
                <p className={`mt-1 text-xl font-bold tabular-nums ${(quality.stage1?.contaminationRate ?? 0) > 0.2 ? "text-rose-600" : "text-slate-700"}`}>
                  {pct(quality.stage1?.contaminationRate)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
                <p className="text-[11px] text-slate-400">10. Quant Scoring 무관 증거 비율</p>
                <p className={`mt-1 text-xl font-bold tabular-nums ${(quality.stage3?.unrelatedEvidenceRatio ?? 0) > 0.3 ? "text-amber-600" : "text-slate-700"}`}>
                  {pct(quality.stage3?.unrelatedEvidenceRatio)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
                <p className="text-[11px] text-slate-400">11. Execution Plan 노액션 계좌</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-slate-700">
                  {quality.stage4?.noActionCount ?? 0}개
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
