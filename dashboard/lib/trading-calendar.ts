import fs from "fs";
import path from "path";

import { resolveRepoRoot } from "@/lib/repo-root";

const DEFAULT_TIME_ZONE = "Asia/Seoul";
const CALENDAR_PATH = path.join(resolveRepoRoot(), "config", "market-calendar.json");

type TradingCalendarConfig = {
  timezone?: string;
  closed_dates?: Record<string, string>;
};

type CycleDateReason =
  | "requested"
  | "today"
  | "non-trading-fallback"
  | "requested-market-fallback";

export type TradingDateContext = {
  date: string;
  runDate: string;
  effectiveMarketDate: string;
  requestedDate: string | null;
  baseDate: string;
  weekday: string;
  reason: CycleDateReason;
  marketClosedLabel: string | null;
};

export type ArtifactDateContext = {
  runDate: string | null;
  effectiveMarketDate: string | null;
  generatedAt: string | null;
  reason: string | null;
  hasExplicitContext: boolean;
};

function readCalendar(): TradingCalendarConfig {
  try {
    return JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf-8")) as TradingCalendarConfig;
  } catch {
    return {};
  }
}

function getFormatter(timeZone = DEFAULT_TIME_ZONE, withWeekday = false) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withWeekday ? { weekday: "short" } : {}),
  });
}

function currentSeoulDate(now = new Date()) {
  const formatter = getFormatter(DEFAULT_TIME_ZONE);
  return formatter.format(now);
}

function previousDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function weekdayForDate(dateText: string, timeZone = DEFAULT_TIME_ZONE) {
  if (!dateText) return "";
  const date = new Date(`${dateText}T12:00:00Z`);
  const parts = getFormatter(timeZone, true).formatToParts(date);
  return parts.find((part) => part.type === "weekday")?.value ?? "";
}

export function resolveCycleDate(requestedDate?: string | null, now = new Date()): TradingDateContext {
  const calendar = readCalendar();
  const normalizedRunDate = currentSeoulDate(now);
  const baseDate =
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : normalizedRunDate;

  let effectiveMarketDate = baseDate;
  const closedDates = calendar.closed_dates ?? {};
  while (true) {
    const weekday = weekdayForDate(effectiveMarketDate, calendar.timezone ?? DEFAULT_TIME_ZONE);
    const isWeekend = weekday === "Sat" || weekday === "Sun";
    if (!isWeekend && !closedDates[effectiveMarketDate]) {
      break;
    }
    effectiveMarketDate = previousDate(effectiveMarketDate);
  }

  let reason: CycleDateReason = "today";
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    reason = effectiveMarketDate === baseDate ? "requested" : "requested-market-fallback";
  } else if (effectiveMarketDate !== normalizedRunDate) {
    reason = "non-trading-fallback";
  }

  const marketClosedLabel =
    effectiveMarketDate === baseDate
      ? null
      : closedDates[baseDate] ??
        (weekdayForDate(baseDate, calendar.timezone ?? DEFAULT_TIME_ZONE) === "Sat" ||
        weekdayForDate(baseDate, calendar.timezone ?? DEFAULT_TIME_ZONE) === "Sun"
          ? "weekend"
          : null);

  return {
    date: effectiveMarketDate,
    runDate: normalizedRunDate,
    effectiveMarketDate,
    requestedDate: requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null,
    baseDate,
    weekday: weekdayForDate(baseDate, calendar.timezone ?? DEFAULT_TIME_ZONE),
    reason,
    marketClosedLabel,
  };
}

export function normalizeArtifactDateContext(input: {
  date?: string | null;
  runDate?: string | null;
  effectiveMarketDate?: string | null;
  generatedAt?: string | null;
  resolutionReason?: string | null;
}): ArtifactDateContext {
  const runDate =
    input.runDate && /^\d{4}-\d{2}-\d{2}$/.test(input.runDate)
      ? input.runDate
      : input.generatedAt?.slice(0, 10) ?? null;

  const effectiveMarketDate =
    input.effectiveMarketDate && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveMarketDate)
      ? input.effectiveMarketDate
      : input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
        ? input.date
        : null;

  return {
    runDate,
    effectiveMarketDate,
    generatedAt: input.generatedAt ?? null,
    reason: input.resolutionReason ?? null,
    hasExplicitContext: Boolean(
      input.runDate || input.effectiveMarketDate || input.resolutionReason,
    ),
  };
}

export function formatDateContextLine(
  context: Pick<ArtifactDateContext, "runDate" | "effectiveMarketDate">,
) {
  if (context.runDate && context.effectiveMarketDate && context.runDate !== context.effectiveMarketDate) {
    return `실행일 ${context.runDate} · 기준 거래일 ${context.effectiveMarketDate}`;
  }
  if (context.effectiveMarketDate) {
    return `기준 거래일 ${context.effectiveMarketDate}`;
  }
  if (context.runDate) {
    return `실행일 ${context.runDate}`;
  }
  return null;
}
