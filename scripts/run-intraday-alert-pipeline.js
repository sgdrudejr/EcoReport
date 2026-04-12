#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

import { ROOT_DIR, parseDateArgs, readJson, writeJson } from "./lib/pipeline-utils.js";

function parseArgs(argv) {
  const args = parseDateArgs(argv);
  args.dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function runNodeScript(script, args = []) {
  return execFileSync("node", [path.join(ROOT_DIR, "scripts", script), ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function buildTelegramMessage({ date, market, alerts, overlay }) {
  const fired = (alerts?.triggers ?? []).filter((item) => item.triggered);
  const lines = [
    `EcoReport Intraday Alert ${date}`,
    `fired: ${fired.length}`,
    `updated: ${market?.collectedAt ?? overlay?.updatedAt ?? "N/A"}`,
  ];

  for (const trigger of fired.slice(0, 5)) {
    lines.push(
      `- ${trigger.name}: ${trigger.actual ?? "N/A"} ${trigger.detail ? `/ ${trigger.detail}` : ""}`,
    );
  }

  if ((overlay?.updates ?? []).length > 0) {
    lines.push("Intraday score overlay:");
    for (const update of overlay.updates.slice(0, 3)) {
      lines.push(
        `- ${update.name}(${update.code}) ${update.baseActionScore} -> ${update.intradayActionScore} (${update.delta >= 0 ? "+" : ""}${update.delta})`,
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const intradayDir = path.join(ROOT_DIR, "data", "intraday", args.date);
  const marketFile = path.join(intradayDir, "market-lite.json");
  const alertsFile = path.join(intradayDir, "emergency-alerts.json");
  const overlayFile = path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage3-intraday-updates.json");

  runNodeScript("fetch-market-data-lite.js", ["--date", args.date, "--output", marketFile]);
  runNodeScript("evaluate-alert-triggers.js", [
    "--date",
    args.date,
    "--market-file",
    marketFile,
    "--output",
    alertsFile,
    "--markdown",
    path.join(intradayDir, "emergency-alerts.md"),
  ]);

  const [market, alerts] = await Promise.all([
    readJson(marketFile, null),
    readJson(alertsFile, { triggers: [] }),
  ]);
  const fired = (alerts?.triggers ?? []).filter((item) => item.triggered);

  let overlay = { updates: [] };
  if (fired.length > 0) {
    runNodeScript("recompute-stage3-intraday.js", [
      "--date",
      args.date,
      "--market-file",
      marketFile,
      "--alerts-file",
      alertsFile,
      "--output",
      overlayFile,
    ]);
    overlay = (await readJson(overlayFile, { updates: [] })) ?? { updates: [] };

    const message = buildTelegramMessage({
      date: args.date,
      market,
      alerts,
      overlay,
    });

    if (args.dryRun) {
      process.stdout.write(`${message}\n`);
    } else {
      runNodeScript("send-telegram-summary.js", [
        "--date",
        args.date,
        "--event",
        "intraday-alerts",
        "--message",
        message,
      ]);
    }
  }

  const latestState = {
    date: args.date,
    updatedAt: new Date().toISOString(),
    market,
    alerts,
    overlay,
  };
  await writeJson(path.join(ROOT_DIR, "data", "intraday", "latest.json"), latestState);
  console.log(path.join(ROOT_DIR, "data", "intraday", "latest.json"));
}

main().catch((error) => {
  console.error(`[intraday-alert-pipeline] 실패: ${error.message}`);
  process.exit(1);
});
