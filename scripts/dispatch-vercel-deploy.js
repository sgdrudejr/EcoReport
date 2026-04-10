#!/usr/bin/env node

const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "sgdrudejr";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "EcoReport";
const EVENT_TYPE = "deploy-vercel";

function parseArgs(argv) {
  const options = {
    reason: "",
    requestedBy: process.env.USER ?? "local",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === "--reason" || token === "-r") && argv[index + 1]) {
      options.reason = argv[index + 1];
      index += 1;
    } else if ((token === "--requested-by" || token === "-u") && argv[index + 1]) {
      options.requestedBy = argv[index + 1];
      index += 1;
    } else if (token === "--dry-run") {
      options.dryRun = true;
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/dispatch-vercel-deploy.js --reason "share latest dashboard"

Options:
  --reason, -r        Deploy reason shown in GitHub Actions logs
  --requested-by, -u  Requester label sent in the payload
  --dry-run           Print the payload without calling GitHub
  --help, -h          Show this help message`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const payload = {
    requested_at: new Date().toISOString(),
    requested_by: options.requestedBy,
  };

  if (options.reason) {
    payload.reason = options.reason;
  }

  if (options.dryRun) {
    console.log(JSON.stringify({ event_type: EVENT_TYPE, client_payload: payload }, null, 2));
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN environment variable is required.");
    process.exit(1);
  }

  const response = await fetch(
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
        client_payload: payload,
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    console.error(`GitHub dispatch failed: ${response.status}`);
    if (detail) {
      console.error(detail);
    }
    process.exit(1);
  }

  console.log(
    `Requested Vercel deploy for ${GITHUB_OWNER}/${GITHUB_REPO}` +
      (options.reason ? ` (${options.reason})` : ".")
  );
}

await main();
