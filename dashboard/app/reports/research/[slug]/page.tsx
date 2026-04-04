import Link from "next/link";
import { notFound } from "next/navigation";
import ResearchSectionTabs, {
  type ResearchSectionTabItem,
} from "@/components/ResearchSectionTabs";
import {
  extractResearchActionPoints,
  extractResearchSections,
  extractResearchTags,
  getResearchBriefingStats,
  loadLatestMacroIndicators,
  loadResearchBriefingBySlug,
} from "@/lib/research";

export const dynamic = "force-dynamic";

function researchTagClass(tone: string) {
  if (tone === "rose") return "border-rose-500/30 bg-rose-950/20 text-rose-300";
  if (tone === "sky") return "border-sky-500/30 bg-sky-950/20 text-sky-300";
  if (tone === "emerald") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (tone === "amber") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  if (tone === "fuchsia") return "border-fuchsia-500/30 bg-fuchsia-950/20 text-fuchsia-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
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
  const tags = extractResearchTags(briefing.content, 12);
  const actionPoints = extractResearchActionPoints(briefing.content, 6);
  const sectionTabs: ResearchSectionTabItem[] = sections.map((section, index) => ({
    id: `research-detail-section-${index + 1}`,
    label: `Section ${index + 1}`,
    title: section.title,
    body: section.body,
    tags: extractResearchTags(`${section.title}\n${section.body}`, 6),
    actionPoints: extractResearchActionPoints(section.body, 3),
  }));

  return (
    <main className="max-w-5xl mx-auto w-full px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{briefing.date}</p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-100">
            {briefing.variant === "rich" ? "리치 경제 리포트" : "경제 리포트"}
          </h1>
          <div className="mt-4 space-y-3">
            <div className="-mx-1 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-3 px-1">
                <div className="min-w-[132px] rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <p className="text-xs text-zinc-500">활용 리포트</p>
                  <p className="mt-1 font-medium text-zinc-100">{stats.coveredReportCount ?? "-"}건</p>
                </div>
                <div className="min-w-[132px] rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <p className="text-xs text-zinc-500">사용 청크</p>
                  <p className="mt-1 font-medium text-zinc-100">{stats.usedChunkCount ?? "-"}개</p>
                </div>
                <div className="min-w-[132px] rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <p className="text-xs text-zinc-500">후보 청크</p>
                  <p className="mt-1 font-medium text-zinc-100">{stats.candidateChunkCount ?? "-"}개</p>
                </div>
                <div className="min-w-[132px] rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <p className="text-xs text-zinc-500">요약 전용</p>
                  <p className="mt-1 font-medium text-zinc-100">{stats.summaryChunkCount ?? "-"}개</p>
                </div>
              </div>
            </div>
            <div className="grid max-w-md grid-cols-2 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="text-xs text-zinc-500">모델</p>
                <p className="mt-1 font-medium text-zinc-100">{stats.model ?? "수동/로컬"}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="text-xs text-zinc-500">원문 길이</p>
                <p className="mt-1 font-medium text-zinc-100">
                  {stats.mergedTextLength != null
                    ? `${stats.mergedTextLength.toLocaleString()}자`
                    : "-"}
                </p>
              </div>
            </div>
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
        <section className="grid gap-3 md:grid-cols-3">
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

      {(tags.length > 0 || actionPoints.length > 0) && (
        <section className="grid gap-4 md:grid-cols-[1.4fr,1fr]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500">핵심 태그</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag.label}
                  className={`rounded-full border px-2.5 py-1 text-xs ${researchTagClass(tag.tone)}`}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500">액션 포인트</p>
            <ul className="mt-3 space-y-2 text-sm text-zinc-100">
              {actionPoints.length > 0 ? (
                actionPoints.map((point) => <li key={point}>- {point}</li>)
              ) : (
                <li>- 추출 가능한 액션 문구가 없습니다.</li>
              )}
            </ul>
          </div>
        </section>
      )}

      <ResearchSectionTabs sections={sectionTabs} />
    </main>
  );
}
