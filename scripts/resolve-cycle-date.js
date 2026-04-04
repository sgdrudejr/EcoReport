#!/usr/bin/env node

const SEOUL_TIME_ZONE = "Asia/Seoul";

function parseArgs(argv) {
  const args = {
    date: "",
    field: "date",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1].trim();
      index += 1;
      continue;
    }

    if (token === "--field" && argv[index + 1]) {
      args.field = argv[index + 1].trim();
      index += 1;
    }
  }

  return args;
}

function getSeoulParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    weekday: getPart("weekday"),
  };
}

function resolveCycleDate(requestedDate = "", now = new Date()) {
  if (requestedDate) {
    return {
      date: requestedDate,
      reason: "requested",
      weekday: "",
    };
  }

  const { year, month, day, weekday } = getSeoulParts(now);
  const effectiveDate = new Date(Date.UTC(year, month - 1, day));
  let reason = "today";

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

const args = parseArgs(process.argv.slice(2));
const resolved = resolveCycleDate(args.date);

if (args.field === "reason") {
  process.stdout.write(resolved.reason);
} else if (args.field === "weekday") {
  process.stdout.write(resolved.weekday);
} else {
  process.stdout.write(resolved.date);
}
