import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { notFound } from "next/navigation";
import {
  extractResearchSections,
  loadLatestMacroIndicators,
  loadResearchBriefingBySlug,
} from "@/lib/research";

export const dynamic = "force-dynamic";

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

  return (
    <main className="max-w-5xl mx-auto w-full px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{briefing.date}</p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-100">
            {briefing.variant === "rich" ? "리치 경제 리포트" : "경제 리포트"}
          </h1>
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
              <p className="text-xs uppercase tracking-wide text-zinc-500">
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
            className="rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-5"
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
