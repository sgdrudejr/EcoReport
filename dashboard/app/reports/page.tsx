import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, ChevronRight } from "lucide-react";
import { loadReports, type ReportDocument } from "@/lib/reports";

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

export default function ReportsPage() {
  const reports = loadReports();

  return (
    <main className="max-w-4xl mx-auto w-full px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">리포트</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {reports.length > 0
              ? `총 ${reports.length}개 · 최신순`
              : "아직 리포트가 없습니다"}
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          ← 대시보드
        </Link>
      </div>

      {/* 리포트 목록 (첫 번째만 펼침) */}
      {reports.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 text-zinc-500 text-sm">
          분석을 실행하면 리포트가 여기에 쌓입니다.
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report, i) => (
            <ReportCard key={report.slug} report={report} expanded={i === 0} />
          ))}
        </div>
      )}
    </main>
  );
}
