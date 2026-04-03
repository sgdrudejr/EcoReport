import { NextRequest } from "next/server";

export const runtime = "nodejs";

const GITHUB_OWNER = "sgdrudejr";
const GITHUB_REPO = "EcoReport";
const TARGET_PATH = "data/portfolio/latest.json";

type PortfolioSnapshot = {
  date: string;
  updatedAt: string;
  source: {
    method: string;
    reviewer?: string | null;
    note?: string | null;
  };
  accounts: Array<{
    key: string;
    label: string;
    accountNumber?: string | null;
    evaluationAmount?: number | null;
    cashAvailable?: number | null;
    settlementCash?: number | null;
    principal?: number | null;
    profitLoss?: number | null;
    profitRate?: number | null;
    screenshots?: string[];
    incomplete?: boolean;
    holdings: Array<{
      code?: string | null;
      name: string;
      quantity?: number | null;
      avgPrice?: number | null;
      currentPrice?: number | null;
      marketValue?: number | null;
      purchaseValue?: number | null;
      profitLoss?: number | null;
      profitRate?: number | null;
      note?: string | null;
    }>;
  }>;
};

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function validateSnapshot(snapshot: unknown): snapshot is PortfolioSnapshot {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  const maybe = snapshot as PortfolioSnapshot;
  return (
    typeof maybe.date === "string" &&
    typeof maybe.updatedAt === "string" &&
    Array.isArray(maybe.accounts)
  );
}

async function fetchExistingSha(token: string) {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${TARGET_PATH}?ref=main`,
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
    return null;
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`기존 파일 조회 실패: ${response.status} ${detail}`);
  }

  const json = (await response.json()) as { sha?: string };
  return json.sha ?? null;
}

export async function POST(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
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

  if (password && body.password && body.password !== password) {
    return unauthorized();
  }

  if (password && !body.password) {
    return unauthorized();
  }

  if (!validateSnapshot(body.snapshot)) {
    return Response.json(
      { error: "snapshot 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const snapshot = {
    ...body.snapshot,
    updatedAt: new Date().toISOString(),
  };

  const sha = await fetchExistingSha(token);
  const content = Buffer.from(
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  ).toString("base64");

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${TARGET_PATH}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `chore: update portfolio snapshot ${snapshot.date}`,
        content,
        branch: "main",
        sha: sha ?? undefined,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    return Response.json(
      {
        error: `GitHub 저장 실패: ${response.status}`,
        detail,
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    updatedAt: snapshot.updatedAt,
    path: TARGET_PATH,
  });
}
