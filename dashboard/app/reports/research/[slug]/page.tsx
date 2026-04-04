import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { notFound } from "next/navigation";
import {
  extractResearchSections,
  getResearchBriefingStats,
  loadLatestMacroIndicators,
  loadResearchBriefingBySlug,
} from "@/lib/research";

export const dynamic = "force-dynamic";

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
  return "border-zinc-800 bg-zinc-900";
}

export default async function ResearchDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const briefing = loadResearchBriefingBySlug(slug);

  if (!briefing) {
    notFound();
  }

  const sections = extractResearchSections(briefing.content);
  const indicators = loadLatestMacroIndicators(briefing.date);
  const stats = getResearchBriefingStats(briefing);

  return (
    <main className="max-w-5xl mx-auto w-full px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{briefing.date}</p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-100">
            {briefing.variant === "rich" ? "리치 경제 리포트" : "경제 리포트"}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
              모델 {stats.model ?? "수동/로컬"}
            </span>
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
              활용 리포트 {stats.coveredReportCount ?? "-"}건
            </span>
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
              사용 청크 {stats.usedChunkCount ?? "-"}개
            </span>
          </div>
        </div>
        <Link
          href="/reports"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          ← 리포트 목록
        </Link>
      </div>

      {indicators.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {indicators.map((indicator) => (
            <div
              key={indicator.key}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4"
            >
              <p className="inline-flex rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] uppercase tracking-wide text-zinc-400">
                {indicator.label}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                {indicator.close?.toLocaleString() ?? "-"}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {typeof indicator.changePct === "number"
                  ? `${indicator.changePct > 0 ? "+" : ""}${(indicator.changePct * 100).toFixed(2)}%`
                  : "등락 데이터 없음"}
              </p>
            </div>
          ))}
        </section>
      )}

      <div className="space-y-4">
        {sections.map((section, index) => (
          <section
            key={`${section.title}-${index}`}
            className={`rounded-2xl border px-6 py-5 ${getSectionTone(section.title)}`}
          >
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Section {index + 1}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-100">
              {section.title}
            </h2>
            <div className="mt-4 prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-li:text-zinc-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {section.body}
              </ReactMarkdown>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
