import fs from "fs";
import path from "path";
import { resolveRepoRoot } from "@/lib/repo-root";

const REPO_ROOT = resolveRepoRoot();
const REPORTS_DIR = path.join(REPO_ROOT, "reports", "daily");

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
  if (!fs.existsSync(REPORTS_DIR)) return [];

  return fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith("-briefing.md"))
    .sort()
    .reverse()
    .map((filename) => ({
      filename,
      date: filename.slice(0, 10),
      slug: filename.replace(/\.md$/, ""),
      content: fs.readFileSync(path.join(REPORTS_DIR, filename), "utf-8"),
    }));
}

export function loadReportBySlug(slug: string): ReportDocument | null {
  if (!slug || slug.includes("/")) return null;

  const filename = `${slug}.md`;
  const filePath = path.join(REPORTS_DIR, filename);
  if (!fs.existsSync(filePath)) return null;

  return {
    filename,
    date: filename.slice(0, 10),
    slug,
    content: fs.readFileSync(filePath, "utf-8"),
  };
}

