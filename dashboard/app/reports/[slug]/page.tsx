import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { notFound } from "next/navigation";
import { loadReportBySlug } from "@/lib/reports";
import { formatDateContextLine } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const report = loadReportBySlug(slug);

  if (!report) {
    notFound();
  }

  return (
    <main className="max-w-4xl mx-auto w-full px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{report.date}</p>
          {formatDateContextLine({
            runDate: report.runDate,
            effectiveMarketDate: report.effectiveMarketDate,
          }) && (
            <p className="mt-1 text-xs text-zinc-600">
              {formatDateContextLine({
                runDate: report.runDate,
                effectiveMarketDate: report.effectiveMarketDate,
              })}
            </p>
          )}
          <h1 className="text-2xl font-bold text-zinc-100 mt-1">
            {report.filename.replace(/\.md$/, "")}
          </h1>
        </div>
        <Link
          href="/reports"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          ← 리포트 목록
        </Link>
      </div>

      <article className="bg-zinc-900 rounded-xl border border-zinc-800 px-6 py-5 prose prose-invert prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {report.content}
        </ReactMarkdown>
      </article>
    </main>
  );
}
