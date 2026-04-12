import fs from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";

import { resolveRepoRoot } from "@/lib/repo-root";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const repoRoot = resolveRepoRoot();
  const latestPath = path.join(repoRoot, "data", "intraday", "latest.json");

  if (!fs.existsSync(latestPath)) {
    return Response.json({ ok: true, updatedAt: null, alerts: { triggers: [] }, overlay: { updates: [] } });
  }

  const raw = await fs.promises.readFile(latestPath, "utf8");
  const payload = JSON.parse(raw);
  return Response.json(payload);
}
