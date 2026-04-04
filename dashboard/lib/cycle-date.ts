const SEOUL_TIME_ZONE = "Asia/Seoul";

type CycleDateReason = "requested" | "today" | "weekend-fallback";

type CycleDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
};

function getSeoulDateParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    weekday: getPart("weekday"),
  } satisfies CycleDateParts;
}

export function resolveCycleDate(requestedDate?: string | null, now = new Date()) {
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return {
      date: requestedDate,
      reason: "requested" as CycleDateReason,
      weekday: "",
    };
  }

  const { year, month, day, weekday } = getSeoulDateParts(now);
  const effectiveDate = new Date(Date.UTC(year, month - 1, day));
  let reason: CycleDateReason = "today";

  if (weekday === "Sat") {
    effectiveDate.setUTCDate(effectiveDate.getUTCDate() - 1);
    reason = "weekend-fallback";
  } else if (weekday === "Sun") {
    effectiveDate.setUTCDate(effectiveDate.getUTCDate() - 2);
    reason = "weekend-fallback";
  }

  return {
    date: effectiveDate.toISOString().slice(0, 10),
    reason,
    weekday,
  };
}
