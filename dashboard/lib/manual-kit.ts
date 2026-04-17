import { listRepoDirectories, readRepoTextFile } from "@/lib/repo-artifacts";

export type ManualKitAction = {
  date: string;
  account: string;
  kind: string;
  name: string;
  amountLabel: string | null;
  keywords: string[];
  reason: string;
};

export type ManualKitPriorityTopic = {
  label: string;
  scope?: string | null;
  priority?: number | null;
  reason?: string | null;
  accountKeys?: string[];
  targetCodes?: string[];
  keywords?: string[];
  questions?: string[];
  gaps?: string[];
};

export type ManualKitOverlay = {
  date: string;
  availableDates: string[];
  responsePath: string;
  actions: ManualKitAction[];
  priorityTopics: ManualKitPriorityTopic[];
};

const MANUAL_KIT_ROOT = "knowledge/daily/manual-kit";
const FINAL_REFINEMENT_RESPONSE = "16-stage1-8-gemini-final-refinement-response.md";

function sortDatesDesc(values: string[]) {
  return [...values].sort((left, right) => right.localeCompare(left));
}

function buildResponsePath(date: string) {
  return `${MANUAL_KIT_ROOT}/${date}/${FINAL_REFINEMENT_RESPONSE}`;
}

function parseActions(content: string) {
  const actions: ManualKitAction[] = [];
  const actionRegex =
    /-\s*(\d{4}-\d{2}-\d{2})\s*\/\s*([^/]+?)\s*\/\s*([^/]+?)\s*\/\s*([^/]+?)(?:\s*\/\s*([\d,]+원))?\s*\/\s*키워드:\s*([^/]+?)\s*\/\s*([\s\S]+?)(?=\s*-\s*\d{4}-\d{2}-\d{2}\s*\/|\s*\[이번 라운드에서 다시 봐야 할 우선순위 토픽\]|$)/gm;

  for (const match of content.matchAll(actionRegex)) {
    actions.push({
      date: match[1],
      account: match[2].trim(),
      kind: match[3].trim(),
      name: match[4].trim(),
      amountLabel: match[5]?.trim() ?? null,
      keywords: match[6]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      reason: match[7].replace(/\s+/g, " ").trim(),
    });
  }

  return actions;
}

function parsePriorityTopics(content: string) {
  const marker = "[이번 라운드에서 다시 봐야 할 우선순위 토픽]";
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) return [];

  const jsonStart = content.indexOf("[", markerIndex + marker.length);
  if (jsonStart < 0) return [];

  const rawJson = content.slice(jsonStart).trim();
  try {
    const parsed = JSON.parse(rawJson) as ManualKitPriorityTopic[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasOverlay(date: string) {
  const content = readRepoTextFile(buildResponsePath(date));
  return Boolean(content?.trim());
}

export function listManualKitOverlayDates() {
  const dates = listRepoDirectories(MANUAL_KIT_ROOT).filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
  return sortDatesDesc(dates.filter((date) => hasOverlay(date)));
}

export function loadLatestManualKitOverlay(date?: string | null): ManualKitOverlay | null {
  const availableDates = listManualKitOverlayDates();
  const resolvedDate = date && availableDates.includes(date) ? date : availableDates[0];
  if (!resolvedDate) return null;

  const responsePath = buildResponsePath(resolvedDate);
  const content = readRepoTextFile(responsePath);
  if (!content) return null;

  return {
    date: resolvedDate,
    availableDates,
    responsePath,
    actions: parseActions(content),
    priorityTopics: parsePriorityTopics(content),
  };
}
