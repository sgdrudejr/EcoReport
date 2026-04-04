import path from "path";
import { listRepoFiles, readRepoTextFile } from "@/lib/repo-artifacts";
import { normalizeArtifactDateContext } from "@/lib/trading-calendar";

const REPORTS_DIR = "reports/daily";

export interface ReportDocument {
  filename: string;
  date: string;
  slug: string;
  content: string;
  runDate: string | null;
  effectiveMarketDate: string | null;
  generatedAt: string | null;
  hasExplicitDateContext: boolean;
}

export function getReportsDir() {
  return REPORTS_DIR;
}

function readMarkdownMeta(content: string, key: string) {
  const match = content.match(new RegExp(`^- ${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function buildReportDocument(filename: string, content: string): ReportDocument {
  const legacyDate = filename.slice(0, 10);
  const context = normalizeArtifactDateContext({
    date: legacyDate,
    runDate: readMarkdownMeta(content, "run_date") ?? readMarkdownMeta(content, "date"),
    effectiveMarketDate: readMarkdownMeta(content, "effective_market_date"),
    generatedAt: readMarkdownMeta(content, "generated_at"),
  });

  return {
    filename,
    date: context.effectiveMarketDate ?? legacyDate,
    slug: filename.replace(/\.md$/, ""),
    content,
    runDate: context.runDate,
    effectiveMarketDate: context.effectiveMarketDate ?? legacyDate,
    generatedAt: context.generatedAt,
    hasExplicitDateContext: context.hasExplicitContext,
  };
}

export function loadReports(): ReportDocument[] {
  const documents = listRepoFiles(REPORTS_DIR)
    .filter((f) => f.endsWith("-briefing.md"))
    .reduce<ReportDocument[]>((acc, filename) => {
      const relativePath = path.posix.join(REPORTS_DIR, filename);
      const content = readRepoTextFile(relativePath);
      if (!content) return acc;

      acc.push(buildReportDocument(filename, content));
      return acc;
    }, []);

  return documents
    .sort((left, right) => {
      const leftRunDate = left.runDate ?? "";
      const rightRunDate = right.runDate ?? "";
      if (leftRunDate !== rightRunDate) {
        return rightRunDate.localeCompare(leftRunDate);
      }
      if (left.hasExplicitDateContext !== right.hasExplicitDateContext) {
        return left.hasExplicitDateContext ? -1 : 1;
      }
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }
      return right.filename.localeCompare(left.filename);
    });
}

export function loadReportBySlug(slug: string): ReportDocument | null {
  if (!slug || slug.includes("/")) return null;

  const filename = `${slug}.md`;
  const content = readRepoTextFile(path.posix.join(REPORTS_DIR, filename));
  if (!content) return null;

  return buildReportDocument(filename, content);
}
