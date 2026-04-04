#!/usr/bin/env node

import { resolveTradingDateContext } from "./lib/trading-calendar.js";

function parseArgs(argv) {
  const args = {
    date: "",
    runDate: "",
    field: "date",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1].trim();
      index += 1;
      continue;
    }

    if (token === "--run-date" && argv[index + 1]) {
      args.runDate = argv[index + 1].trim();
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

const args = parseArgs(process.argv.slice(2));
const resolved = resolveTradingDateContext({
  requestedDate: args.date,
  runDate: args.runDate,
});

if (args.field === "reason") {
  process.stdout.write(resolved.reason);
} else if (args.field === "weekday") {
  process.stdout.write(resolved.weekday);
} else if (args.field === "run_date") {
  process.stdout.write(resolved.runDate);
} else if (args.field === "effective_market_date") {
  process.stdout.write(resolved.effectiveMarketDate);
} else if (args.field === "base_date") {
  process.stdout.write(resolved.baseDate);
} else if (args.field === "market_closed_label") {
  process.stdout.write(resolved.marketClosedLabel ?? "");
} else if (args.field === "json") {
  process.stdout.write(`${JSON.stringify(resolved)}\n`);
} else {
  process.stdout.write(resolved.date);
}
