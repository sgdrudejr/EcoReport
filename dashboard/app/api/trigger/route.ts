import { NextRequest } from "next/server";
import { resolveCycleDate } from "@/lib/cycle-date";

const GITHUB_OWNER = "sgdrudejr";
const GITHUB_REPO = "EcoReport";
const EVENT_TYPE = "run-cycle";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const requestedDate =
    payload && typeof payload === "object" && typeof payload.date === "string"
      ? payload.date
      : "";
  const cycleDate = resolveCycleDate(requestedDate);

  // ── GitHub repository_dispatch 호출 ──────────────────────────────────
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return Response.json(
      { error: "GITHUB_TOKEN 환경변수가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: EVENT_TYPE,
        client_payload: {
          date: cycleDate.date,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return Response.json(
      { error: `GitHub API 오류: ${res.status}`, detail: text },
      { status: 502 }
    );
  }

  // GitHub dispatches API는 성공 시 204 No Content 반환
  return Response.json({ ok: true, event: EVENT_TYPE, date: cycleDate.date, reason: cycleDate.reason });
}
