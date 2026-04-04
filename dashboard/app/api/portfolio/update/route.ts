import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { resolveRepoRoot } from "@/lib/repo-root";

export const runtime = "nodejs";

const GITHUB_OWNER = "sgdrudejr";
const GITHUB_REPO = "EcoReport";
const TARGET_PATH = "data/portfolio/latest.json";
const LOCAL_TARGET_PATH = path.join(resolveRepoRoot(), TARGET_PATH);

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

async function writeLocalSnapshot(snapshot: PortfolioSnapshot) {
  await fs.mkdir(path.dirname(LOCAL_TARGET_PATH), { recursive: true });
  await fs.writeFile(
    LOCAL_TARGET_PATH,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
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

  try {
    await writeLocalSnapshot(snapshot);
  } catch (error) {
    return Response.json(
      {
        error: "로컬 파일 저장에 실패했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }

  const token = process.env.GITHUB_TOKEN;
  let githubSynced = false;
  let warning: string | null = null;

  if (token) {
    try {
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
        warning = `로컬 저장은 완료됐지만 GitHub 동기화는 실패했습니다 (${response.status}). ${detail}`;
      } else {
        githubSynced = true;
      }
    } catch (error) {
      warning =
        error instanceof Error
          ? `로컬 저장은 완료됐지만 GitHub 동기화 중 오류가 났습니다. ${error.message}`
          : "로컬 저장은 완료됐지만 GitHub 동기화 중 알 수 없는 오류가 났습니다.";
    }
  } else {
    warning = "로컬 파일에는 저장됐지만 GITHUB_TOKEN이 없어 GitHub 동기화는 건너뛰었습니다.";
  }

  return Response.json({
    ok: true,
    updatedAt: snapshot.updatedAt,
    path: TARGET_PATH,
    githubSynced,
    warning,
  });
}
