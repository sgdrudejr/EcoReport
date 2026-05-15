export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  FileText,
  Layers3,
  Newspaper,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";

import { listRepoDirectories, listRepoFiles, readRepoJsonFile } from "@/lib/repo-artifacts";

type MarketVoice = {
  date: string;
  summary?: {
    overview?: string | null;
    directHoldingTopics?: number | null;
    thematicAccountTopics?: number | null;
    watchlistTopics?: number | null;
    highPriorityTopics?: number | null;
  };
  topics?: Array<{
    title?: string | null;
    summary?: string | null;
    priority?: string | null;
    direction?: string | null;
    matchedAccounts?: string[];
  }>;
  deepResearchCandidates?: Array<{ title?: string | null; reason?: string | null; priority?: string | null }>;
};

type DashboardView = {
  meta?: { date?: string; generatedAt?: string };
  sourceCoverage?: Record<string, number | string[]>;
  newEvidence?: {
    reports?: Array<{ title?: string | null; broker?: string | null; sector?: string | null; summary?: string | null }>;
    marketVoice?: Array<{ title?: string | null; summary?: string | null }>;
  };
  rotationWatch?: {
    summary?: { headline?: string | null; mode?: string | null; stance?: string | null; nextAction?: string | null };
    rotationTargets?: {
      summary?: { answer?: string | null; currentAction?: string | null; switchRule?: string | null };
      watch?: Array<{ sector?: string | null; action?: string | null; whyWatch?: string | null; priority?: string | null }>;
    };
  };
  health?: { status?: string | null; warnings?: string[]; missingArtifacts?: string[] };
};

type Feedback = {
  date?: string;
  summary?: Record<string, unknown>;
  hitRate?: number | null;
  recommendation?: string | null;
  notes?: string[];
};

type SystemHealth = {
  status?: string | null;
  generatedAt?: string | null;
  summary?: Record<string, unknown>;
  checks?: Array<{ id?: string | null; status?: string | null; label?: string | null; message?: string | null }>;
};

function latestDateDir(relativeDir: string) {
  return listRepoDirectories(relativeDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .at(-1);
}

function latestFeedbackFile() {
  const files = listRepoFiles("data/feedback/analysis")
    .filter((name) => /^\d{4}-\d{2}-\d{2}-feedback\.json$/.test(name))
    .sort();
  const latest = files.at(-1);
  return latest ? readRepoJsonFile<Feedback>(`data/feedback/analysis/${latest}`) : null;
}

function loadMarketVoice(dateHint?: string | null) {
  const date = dateHint ?? latestDateDir("data/analysis-state");
  if (!date) return null;
  return readRepoJsonFile<MarketVoice>(`data/analysis-state/${date}/marketvoice-linked.json`);
}

function toneClass(status: string | null | undefined) {
  if (status === "ok" || status === "complete") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "warn" || status === "incomplete") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function metricValue(value: unknown) {
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  if (Array.isArray(value)) return value.length.toLocaleString("ko-KR");
  if (typeof value === "string") return value;
  return "-";
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

function EvidenceCard({
  title,
  subtitle,
  body,
}: {
  title: string;
  subtitle?: string | null;
  body?: string | null;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[13px] font-semibold text-slate-900">{title}</p>
      {subtitle && <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>}
      {body && <p className="mt-2 text-[12px] leading-5 text-slate-600">{body}</p>}
    </article>
  );
}

export default function ResearchDashboardPage() {
  const view = readRepoJsonFile<DashboardView>("data/dashboard/latest-dashboard-view.json");
  const date = view?.meta?.date ?? latestDateDir("data/analysis-state");
  const marketVoice = loadMarketVoice(date);
  const feedback = latestFeedbackFile();
  const health = date ? readRepoJsonFile<SystemHealth>(`data/analysis-state/${date}/system-health.json`) : null;
  const sourceCoverage = view?.sourceCoverage ?? {};
  const activeSources = Array.isArray(sourceCoverage.activeSources) ? sourceCoverage.activeSources : [];
  const topTopics = (marketVoice?.topics ?? []).slice(0, 4);
  const watchSectors = view?.rotationWatch?.rotationTargets?.watch?.slice(0, 4) ?? [];
  const reports = view?.newEvidence?.reports?.slice(0, 4) ?? [];
  const healthChecks = (health?.checks ?? []).slice(0, 5);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">Research Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">리서치·검증 통합 대시보드</h1>
            <p className="mt-1 text-sm text-slate-500">시황 뉴스, 리포트, Shadow Preview, 피드백 검증을 한 화면에서 봅니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SectionLink href="/">실행 리포트</SectionLink>
            <SectionLink href="/market-news">시황 뉴스</SectionLink>
            <SectionLink href="/shadow-preview">Shadow</SectionLink>
            <SectionLink href="/feedback-report">피드백</SectionLink>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-5">
          <Metric label="날짜" value={date ?? "-"} />
          <Metric label="리포트" value={metricValue(sourceCoverage.reports)} />
          <Metric label="뉴스" value={metricValue(sourceCoverage.news)} />
          <Metric label="시황토픽" value={marketVoice?.topics?.length ?? 0} />
          <div className={`rounded-lg border px-3 py-2 ${toneClass(health?.status ?? view?.health?.status)}`}>
            <p className="text-[11px] opacity-75">시스템</p>
            <p className="mt-0.5 text-[14px] font-semibold">{health?.status ?? view?.health?.status ?? "-"}</p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                  <Newspaper size={14} /> 시황·뉴스 요약
                </p>
                <h2 className="mt-2 text-lg font-bold text-slate-950">{marketVoice?.summary?.overview ?? "시황 요약 데이터가 없습니다."}</h2>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                고우선 {marketVoice?.summary?.highPriorityTopics ?? 0}
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {topTopics.map((topic) => (
                <EvidenceCard
                  key={`${topic.title}-${topic.priority}`}
                  title={topic.title ?? "뉴스 토픽"}
                  subtitle={[topic.priority, topic.direction].filter(Boolean).join(" · ")}
                  body={topic.summary}
                />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <Layers3 size={14} /> 로테이션·Shadow 감시
            </p>
            <h2 className="mt-2 text-lg font-bold text-slate-950">{view?.rotationWatch?.summary?.headline ?? "-"}</h2>
            <p className="mt-1 text-[13px] leading-6 text-slate-500">
              {view?.rotationWatch?.rotationTargets?.summary?.answer ?? view?.rotationWatch?.summary?.nextAction ?? "-"}
            </p>
            <div className="mt-4 space-y-2">
              {watchSectors.map((item) => (
                <EvidenceCard
                  key={`${item.sector}-${item.priority}`}
                  title={`${item.sector ?? "섹터"} · ${item.action ?? "-"}`}
                  subtitle={item.priority}
                  body={item.whyWatch}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <FileText size={14} /> 최신 근거 리포트
              </p>
              <SectionLink href="/reports">전체 보기</SectionLink>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {reports.length > 0 ? (
                reports.map((report) => (
                  <EvidenceCard
                    key={`${report.title}-${report.broker}`}
                    title={report.title ?? "리포트"}
                    subtitle={[report.broker, report.sector].filter(Boolean).join(" · ")}
                    body={report.summary}
                  />
                ))
              ) : (
                <p className="text-sm text-slate-400">신규 리포트 요약이 없습니다.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <SearchCheck size={14} /> 소스 커버리지
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeSources.map((source) => (
                <span key={String(source)} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                  {String(source)}
                </span>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {Object.entries(sourceCoverage)
                .filter(([key, value]) => key !== "activeSources" && typeof value === "number")
                .slice(0, 8)
                .map(([key, value]) => (
                  <Metric key={key} label={key} value={metricValue(value)} />
                ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <Activity size={14} /> 피드백 검증
              </p>
              <SectionLink href="/feedback-report">피드백 리포트</SectionLink>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-slate-600">
              {feedback?.recommendation ?? "최근 피드백 분석을 통해 전략 결과를 재평가합니다."}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="분석일" value={feedback?.date ?? "-"} />
              <Metric label="Hit" value={typeof feedback?.hitRate === "number" ? `${(feedback.hitRate * 100).toFixed(1)}%` : "-"} />
              <Metric label="상태" value={health?.status ?? "-"} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
              <ShieldCheck size={14} /> 시스템 헬스
            </p>
            <div className="mt-3 space-y-2">
              {healthChecks.length > 0 ? (
                healthChecks.map((check) => (
                  <div key={`${check.id}-${check.label}`} className={`rounded-lg border px-3 py-2 ${toneClass(check.status)}`}>
                    <p className="text-[12px] font-semibold">{check.label ?? check.id}</p>
                    {check.message && <p className="mt-1 text-[12px] leading-5 opacity-80">{check.message}</p>}
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">헬스 체크 데이터가 없습니다.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
