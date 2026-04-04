import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Layers3,
} from "lucide-react";
import { loadReports, type ReportDocument } from "@/lib/reports";
import {
  extractResearchSections,
  getResearchBriefingStats,
  loadLatestMacroIndicators,
  loadResearchBriefings,
  type MacroIndicator,
  type ResearchBriefingDocument,
} from "@/lib/research";

export const dynamic = "force-dynamic";

function ReportCard({
  report,
  expanded,
}: {
  report: ReportDocument;
  expanded: boolean;
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <FileText size={16} className="text-zinc-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-200">{report.date}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {report.filename.replace(/\.md$/, "")}
            </p>
          </div>
        </div>
        <Link
          href={`/reports/${report.slug}`}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          전체 보기 <ChevronRight size={14} />
        </Link>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 px-5 py-4 prose prose-invert prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {report.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function formatIndicatorValue(value: number | null | undefined, label: string) {
  if (typeof value !== "number") return "-";
  if (label === "WTI" || label === "금") return value.toLocaleString();
  if (label === "원/달러") return value.toLocaleString();
  return value.toLocaleString();
}

function IndicatorCard({ indicator }: { indicator: MacroIndicator }) {
  const positive = typeof indicator.changePct === "number" && indicator.changePct > 0;
  const negative = typeof indicator.changePct === "number" && indicator.changePct < 0;
  const Icon =
    indicator.changePct == null ? Minus : positive ? TrendingUp : negative ? TrendingDown : Minus;
  const color =
    indicator.changePct == null
      ? "text-zinc-400"
      : positive
        ? "text-emerald-400"
        : negative
          ? "text-red-400"
          : "text-zinc-400";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="inline-flex rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] uppercase tracking-wide text-zinc-400">
            {indicator.label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
            {formatIndicatorValue(indicator.close, indicator.label)}
          </p>
        </div>
        {indicator.signal && (
          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300">
            {indicator.signal}
          </span>
        )}
      </div>
      <div className={`inline-flex items-center gap-1.5 text-sm font-medium ${color}`}>
        <Icon size={14} />
        {typeof indicator.changePct === "number"
          ? `${indicator.changePct > 0 ? "+" : ""}${(indicator.changePct * 100).toFixed(2)}%`
          : "등락 데이터 없음"}
      </div>
    </div>
  );
}

function getSectionTone(title: string) {
  if (title.includes("핵심")) {
    return "border-sky-900/50 bg-sky-950/20";
  }
  if (title.includes("거시") || title.includes("매크로")) {
    return "border-amber-900/50 bg-amber-950/20";
  }
  if (title.includes("섹터") || title.includes("성장")) {
    return "border-emerald-900/50 bg-emerald-950/20";
  }
  if (title.includes("포트폴리오") || title.includes("시사점")) {
    return "border-fuchsia-900/50 bg-fuchsia-950/20";
  }
  return "border-zinc-800 bg-zinc-950/70";
}

function ResearchBriefingCard({
  briefing,
}: {
  briefing: ResearchBriefingDocument;
}) {
  const sections = extractResearchSections(briefing.content);
  const indicators = loadLatestMacroIndicators(briefing.date);
  const stats = getResearchBriefingStats(briefing);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="border-b border-zinc-800 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-900/60 bg-sky-950/30 px-3 py-1 text-xs text-sky-300">
              <Layers3 size={13} />
              {briefing.variant === "rich" ? "리치 경제 브리핑" : "경제 브리핑"}
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-zinc-100">
                {briefing.date} 시장·경제 리포트
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                79건 리포트에서 추린 핵심 섹션을 계층적으로 정리한 브리핑입니다.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm text-zinc-300 lg:min-w-[320px]">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
              <p className="text-xs text-zinc-500">모델</p>
              <p className="mt-1 font-medium">
                {stats.model ?? "수동/로컬 생성"}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
              <p className="text-xs text-zinc-500">활용 리포트</p>
              <p className="mt-1 font-medium">
                {stats.coveredReportCount ?? "-"}건
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
              <p className="text-xs text-zinc-500">사용 청크</p>
              <p className="mt-1 font-medium">
                {stats.usedChunkCount ?? "-"}개
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
              <p className="text-xs text-zinc-500">원문 길이</p>
              <p className="mt-1 font-medium">
                {stats.mergedTextLength != null
                  ? `${stats.mergedTextLength.toLocaleString()}자`
                  : "-"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {indicators.length > 0 && (
        <div className="border-b border-zinc-800 px-5 py-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">핵심 마켓 보드</h3>
              <p className="text-sm text-zinc-500">
                숫자는 따로 떼어 보고, 서술은 아래 섹션에서 읽을 수 있게 구성했습니다.
              </p>
            </div>
            <Link
              href={`/reports/research/${briefing.slug}`}
              className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              전체 보기 →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {indicators.map((indicator) => (
              <IndicatorCard key={indicator.key} indicator={indicator} />
            ))}
          </div>
        </div>
      )}

      <div className="px-5 py-5 space-y-5">
        {sections.map((section, index) => (
          <section
            key={`${section.title}-${index}`}
            className={`rounded-2xl border p-5 ${getSectionTone(section.title)}`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Section {index + 1}
                </p>
                <h3 className="text-xl font-semibold text-zinc-100">
                  {section.title}
                </h3>
              </div>
            </div>
            <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-li:text-zinc-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {section.body}
              </ReactMarkdown>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const reports = loadReports();
  const researchBriefings = loadResearchBriefings();
  const latestResearchBriefing = researchBriefings[0] ?? null;

  return (
    <main className="max-w-6xl mx-auto w-full px-4 py-8 space-y-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">리포트</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            경제 브리핑과 어드바이저 브리핑을 분리해서 읽을 수 있습니다.
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          ← 대시보드
        </Link>
      </div>

      {latestResearchBriefing ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">경제 리포트</h2>
            <p className="mt-1 text-sm text-zinc-500">
              여러 증권사 리포트에서 추린 거시·섹터 브리핑입니다.
            </p>
          </div>
          <ResearchBriefingCard briefing={latestResearchBriefing} />
        </section>
      ) : (
        <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 text-zinc-500 text-sm">
          아직 생성된 경제 리포트가 없습니다.
        </div>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">어드바이저 브리핑</h2>
          <p className="mt-1 text-sm text-zinc-500">
            포트폴리오 행동 지침 중심의 브리핑 모음입니다.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {reports.length > 0
              ? `총 ${reports.length}개 · 최신순`
              : "아직 어드바이저 브리핑이 없습니다"}
          </p>
        </div>

        {reports.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 text-zinc-500 text-sm">
            분석을 실행하면 어드바이저 브리핑이 여기에 쌓입니다.
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((report, i) => (
              <ReportCard key={report.slug} report={report} expanded={i === 0} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
