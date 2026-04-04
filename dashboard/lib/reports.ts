import path from "path";
import { listRepoFiles, readRepoTextFile } from "@/lib/repo-artifacts";

const REPORTS_DIR = "reports/daily";

export interface ReportDocument {
  filename: string;
  date: string;
  slug: string;
  content: string;
}

export function getReportsDir() {
  return REPORTS_DIR;
}

export function loadReports(): ReportDocument[] {
  return listRepoFiles(REPORTS_DIR)
    .filter((f) => f.endsWith("-briefing.md"))
    .sort()
    .reverse()
    .map((filename) => {
      const relativePath = path.posix.join(REPORTS_DIR, filename);
      const content = readRepoTextFile(relativePath);
      if (!content) return null;

      return {
        filename,
        date: filename.slice(0, 10),
        slug: filename.replace(/\.md$/, ""),
        content,
      } satisfies ReportDocument;
    })
    .filter((report): report is ReportDocument => Boolean(report));
}

export function loadReportBySlug(slug: string): ReportDocument | null {
  if (!slug || slug.includes("/")) return null;

  const filename = `${slug}.md`;
  const content = readRepoTextFile(path.posix.join(REPORTS_DIR, filename));
  if (!content) return null;

  return {
    filename,
    date: filename.slice(0, 10),
    slug,
    content,
  };
}
