import path from "node:path";

import { NextRequest } from "next/server";

import { resolveCycleDate } from "@/lib/cycle-date";
import { listRepoDirectories, listRepoFiles, readRepoJsonFile } from "@/lib/repo-artifacts";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PACKET_FILES = {
  manifest: "manifest.json",
  research: "research-context.v1.json",
  "research-context": "research-context.v1.json",
  portfolio: "portfolio-action-context.v1.json",
  "portfolio-action": "portfolio-action-context.v1.json",
  "claim-review": "claim-review-context.v1.json",
  claims: "claim-review-context.v1.json",
  "source-audit": "source-audit-map.v1.json",
  sources: "source-audit-map.v1.json",
  human: "human-output-manifest.v1.json",
  "human-output": "human-output-manifest.v1.json",
} as const;

type PacketKey = keyof typeof PACKET_FILES;

function normalizeDate(value: string | null) {
  return value && DATE_PATTERN.test(value) ? value : null;
}

function normalizePacket(value: string | null): PacketKey {
  const key = (value ?? "manifest").trim() as PacketKey;
  return key in PACKET_FILES ? key : "manifest";
}

function exchangeDir(date: string) {
  return path.posix.join("data", "analysis-state", date, "llm-exchange");
}

function packetPath(date: string, packet: PacketKey) {
  return path.posix.join(exchangeDir(date), PACKET_FILES[packet]);
}

function hasManifest(date: string) {
  return Boolean(readRepoJsonFile(packetPath(date, "manifest")));
}

function availableDates() {
  return listRepoDirectories("data/analysis-state")
    .filter((entry) => DATE_PATTERN.test(entry))
    .sort()
    .reverse()
    .filter(hasManifest);
}

function availablePackets(date: string) {
  const allowed = new Set(Object.values(PACKET_FILES));
  return listRepoFiles(exchangeDir(date))
    .filter((file) => allowed.has(file as (typeof PACKET_FILES)[PacketKey]))
    .sort();
}

function resolveDate(requestedDate: string | null) {
  const explicitDate = normalizeDate(requestedDate);
  if (explicitDate) return explicitDate;

  const cycleDate = resolveCycleDate(null).effectiveMarketDate;
  if (hasManifest(cycleDate)) return cycleDate;

  return availableDates()[0] ?? cycleDate;
}

export async function GET(request: NextRequest) {
  const date = resolveDate(request.nextUrl.searchParams.get("date"));
  const packet = normalizePacket(request.nextUrl.searchParams.get("packet"));
  const relativePath = packetPath(date, packet);
  const payload = readRepoJsonFile<Record<string, unknown>>(relativePath);

  if (!payload) {
    return Response.json(
      {
        ok: false,
        error: "LLM exchange packet not found",
        date,
        packet,
        path: relativePath,
        availableDates: availableDates().slice(0, 20),
        availablePackets: availablePackets(date),
      },
      { status: 404 },
    );
  }

  return Response.json({
    ok: true,
    date,
    packet,
    path: relativePath,
    contract: payload.contract ?? null,
    audience: payload.audience ?? null,
    payload,
  });
}
