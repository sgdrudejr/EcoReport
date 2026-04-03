import { NextRequest } from "next/server";

export const runtime = "nodejs";

const GITHUB_OWNER = "sgdrudejr";
const GITHUB_REPO = "EcoReport";

type MarkdownSaveRequest = {
  kind: "synthesis" | "advisory";
  targetPath: string;
  content: string;
};

type ReportSummarySaveRequest = {
  kind: "report-summary";
  date: string;
  reportId: string;
  content: string;
  reportMeta?: Record<string, unknown>;
};

type SaveRequest = MarkdownSaveRequest | ReportSummarySaveRequest;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMarkdownRequest(body: unknown): body is MarkdownSaveRequest {
  return (
    isObject(body) &&
    (body.kind === "synthesis" || body.kind === "advisory") &&
    typeof body.targetPath === "string" &&
    typeof body.content === "string"
  );
}

function isReportSummaryRequest(body: unknown): body is ReportSummarySaveRequest {
  return (
    isObject(body) &&
    body.kind === "report-summary" &&
    typeof body.date === "string" &&
    typeof body.reportId === "string" &&
    typeof body.content === "string"
  );
}

function isAllowedMarkdownPath(targetPath: string) {
  return (
    /^knowledge\/daily\/\d{4}-\d{2}-\d{2}-synthesis\.md$/.test(targetPath) ||
    /^reports\/daily\/\d{4}-\d{2}-\d{2}.*-briefing\.md$/.test(targetPath)
  );
}

async function fetchFile(token: string, targetPath: string) {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${targetPath}?ref=main`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return { sha: null, content: null };
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`기존 파일 조회 실패: ${response.status} ${detail}`);
  }

  const json = (await response.json()) as { sha?: string; content?: string };
  const decoded = json.content
    ? Buffer.from(json.content.replace(/\n/g, ""), "base64").toString("utf8")
    : null;

  return {
    sha: json.sha ?? null,
    content: decoded,
  };
}

async function saveFile(
  token: string,
  targetPath: string,
  content: string,
  message: string,
) {
  const existing = await fetchFile(token, targetPath);
  const encoded = Buffer.from(
    content.endsWith("\n") ? content : `${content}\n`,
    "utf8",
  ).toString("base64");

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${targetPath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: encoded,
        branch: "main",
        sha: existing.sha ?? undefined,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub 저장 실패: ${response.status} ${detail}`);
  }
}

async function saveMarkdown(
  token: string,
  payload: MarkdownSaveRequest,
) {
  if (!isAllowedMarkdownPath(payload.targetPath)) {
    return Response.json(
      { error: "허용되지 않은 저장 경로입니다." },
      { status: 400 },
    );
  }

  await saveFile(
    token,
    payload.targetPath,
    payload.content,
    `docs: save manual ${payload.kind} ${new Date().toISOString().slice(0, 10)}`,
  );

  return Response.json({ ok: true, path: payload.targetPath });
}

async function saveReportSummary(
  token: string,
  payload: ReportSummarySaveRequest,
) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload.content);
  } catch {
    return Response.json(
      { error: "리포트 요약은 유효한 JSON이어야 합니다." },
      { status: 400 },
    );
  }

  if (!isObject(parsed)) {
    return Response.json(
      { error: "리포트 요약 JSON은 객체 형태여야 합니다." },
      { status: 400 },
    );
  }

  const targetPath = `data/reports/${payload.date}/manual-compressed.json`;
  const existing = await fetchFile(token, targetPath);
  const currentItems = (() => {
    if (!existing.content) return [];
    try {
      const json = JSON.parse(existing.content);
      return Array.isArray(json) ? json : [];
    } catch {
      return [];
    }
  })();

  const nextItem = {
    id: payload.reportId,
    savedAt: new Date().toISOString(),
    ...(payload.reportMeta ?? {}),
    ...parsed,
  };

  const nextItems = [
    ...currentItems.filter(
      (item) => !isObject(item) || item.id !== payload.reportId,
    ),
    nextItem,
  ].sort((left, right) => {
    const leftRank = isObject(left) ? Number(left.rank ?? 9999) : 9999;
    const rightRank = isObject(right) ? Number(right.rank ?? 9999) : 9999;
    return leftRank - rightRank;
  });

  await saveFile(
    token,
    targetPath,
    JSON.stringify(nextItems, null, 2),
    `docs: save manual report summary ${payload.date} ${payload.reportId}`,
  );

  return Response.json({ ok: true, path: targetPath, items: nextItems.length });
}

export async function POST(request: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return Response.json(
      { error: "GITHUB_TOKEN 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  try {
    if (isMarkdownRequest(body)) {
      return await saveMarkdown(token, body);
    }

    if (isReportSummaryRequest(body)) {
      return await saveReportSummary(token, body);
    }

    return Response.json(
      { error: "지원하지 않는 저장 요청입니다." },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "저장 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 502 },
    );
  }
}
