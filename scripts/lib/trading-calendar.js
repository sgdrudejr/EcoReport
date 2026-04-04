import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIME_ZONE = "Asia/Seoul";

function resolveRootDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ECOREPORT_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(moduleDir, "..", ".."),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      fsSync.existsSync(path.join(candidate, "config", "market-calendar.json")) &&
      fsSync.existsSync(path.join(candidate, "scripts"))
    ) {
      return candidate;
    }
  }

  return path.resolve(moduleDir, "..", "..");
}

const ROOT_DIR = resolveRootDir();
const CALENDAR_PATH = path.join(ROOT_DIR, "config", "market-calendar.json");

function readCalendar() {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(CALENDAR_PATH, "utf8"));
    const closedDates = parsed?.closed_dates ?? {};
    return {
      timezone: parsed?.timezone ?? DEFAULT_TIME_ZONE,
      closedDates,
    };
  } catch {
    return {
      timezone: DEFAULT_TIME_ZONE,
      closedDates: {},
    };
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

function formatParts(now, timeZone = DEFAULT_TIME_ZONE) {
  const formatter = getFormatter(timeZone, true);
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    weekday: getPart("weekday"),
  };
}

export function todayInSeoul(now = new Date()) {
  const { year, month, day } = formatParts(now, DEFAULT_TIME_ZONE);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

export function previousDate(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function weekdayForDate(dateText, timeZone = DEFAULT_TIME_ZONE) {
  if (!dateText) return "";
  const date = new Date(`${dateText}T12:00:00Z`);
  const parts = getFormatter(timeZone, true).formatToParts(date);
  return parts.find((part) => part.type === "weekday")?.value ?? "";
}

export function isTradingDay(dateText) {
  const calendar = readCalendar();
  const weekday = weekdayForDate(dateText, calendar.timezone);
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }
  return !calendar.closedDates[dateText];
}

export function marketClosureLabel(dateText) {
  const calendar = readCalendar();
  const weekday = weekdayForDate(dateText, calendar.timezone);
  if (weekday === "Sat" || weekday === "Sun") {
    return "weekend";
  }
  return calendar.closedDates[dateText] ?? null;
}

export function resolveTradingDateContext({
  requestedDate = "",
  runDate = "",
  now = new Date(),
} = {}) {
  const normalizedRunDate = /^\d{4}-\d{2}-\d{2}$/.test(runDate) ? runDate : todayInSeoul(now);
  const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : normalizedRunDate;

  let effectiveMarketDate = baseDate;
  while (!isTradingDay(effectiveMarketDate)) {
    effectiveMarketDate = previousDate(effectiveMarketDate);
  }

  let reason = "today";
  if (requestedDate) {
    reason = effectiveMarketDate === baseDate ? "requested" : "requested-market-fallback";
  } else if (effectiveMarketDate !== normalizedRunDate) {
    reason = "non-trading-fallback";
  }

  return {
    date: effectiveMarketDate,
    runDate: normalizedRunDate,
    effectiveMarketDate,
    requestedDate: requestedDate || null,
    baseDate,
    weekday: weekdayForDate(baseDate),
    reason,
    marketClosedLabel:
      effectiveMarketDate === baseDate ? null : marketClosureLabel(baseDate),
  };
}
