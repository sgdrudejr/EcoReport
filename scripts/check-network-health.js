#!/usr/bin/env node

import dns from "node:dns/promises";

function parseArgs(argv) {
  const args = {
    targets: [],
    attempts: 1,
    delaySec: 5,
    timeoutMs: 8000,
    field: "json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--targets" && argv[index + 1]) {
      args.targets = argv[index + 1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
    } else if (token === "--attempts" && argv[index + 1]) {
      args.attempts = Number.parseInt(argv[index + 1], 10) || args.attempts;
      index += 1;
    } else if (token === "--delay-sec" && argv[index + 1]) {
      args.delaySec = Number.parseInt(argv[index + 1], 10) || args.delaySec;
      index += 1;
    } else if (token === "--timeout-ms" && argv[index + 1]) {
      args.timeoutMs = Number.parseInt(argv[index + 1], 10) || args.timeoutMs;
      index += 1;
    } else if (token === "--field" && argv[index + 1]) {
      args.field = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTarget(raw) {
  try {
    const url = new URL(raw);
    return {
      raw,
      host: url.hostname,
      url: url.toString(),
    };
  } catch {
    return {
      raw,
      host: raw,
      url: null,
    };
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      ok: response.status < 500,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeTarget(target, timeoutMs) {
  const resolved = resolveTarget(target);
  const result = {
    target: resolved.raw,
    host: resolved.host,
    dnsOk: false,
    address: null,
    httpOk: resolved.url ? false : null,
    status: null,
    error: null,
  };

  try {
    const lookup = await dns.lookup(resolved.host);
    result.dnsOk = true;
    result.address = lookup.address;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }

  if (resolved.url) {
    const http = await fetchWithTimeout(resolved.url, timeoutMs);
    result.httpOk = http.ok;
    result.status = http.status;
    if (!http.ok) {
      result.error = http.statusText;
    }
  }

  return result;
}

function summarize(results) {
  return results
    .map((result) => {
      const pieces = [`${result.host}`, result.dnsOk ? "dns:ok" : "dns:fail"];
      if (result.address) {
        pieces.push(`ip:${result.address}`);
      }
      if (result.httpOk !== null) {
        pieces.push(result.httpOk ? `http:${result.status ?? "ok"}` : `http:fail(${result.status ?? "n/a"})`);
      }
      if (result.error) {
        pieces.push(`error:${result.error}`);
      }
      return pieces.join(" ");
    })
    .join(" | ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.targets.length === 0) {
    throw new Error("--targets is required");
  }

  let lastResults = [];
  for (let attempt = 1; attempt <= Math.max(1, args.attempts); attempt += 1) {
    lastResults = await Promise.all(args.targets.map((target) => probeTarget(target, args.timeoutMs)));
    const ready = lastResults.every((result) => result.dnsOk && (result.httpOk == null || result.httpOk));
    if (ready) {
      if (args.field === "ready") {
        process.stdout.write("true");
      } else if (args.field === "summary") {
        process.stdout.write(summarize(lastResults));
      } else {
        process.stdout.write(`${JSON.stringify({ ready, results: lastResults }, null, 2)}\n`);
      }
      return;
    }

    if (attempt < args.attempts) {
      await sleep(args.delaySec * 1000);
    }
  }

  const ready = lastResults.every((result) => result.dnsOk && (result.httpOk == null || result.httpOk));
  if (args.field === "ready") {
    process.stdout.write(ready ? "true" : "false");
  } else if (args.field === "summary") {
    process.stdout.write(summarize(lastResults));
  } else {
    process.stdout.write(`${JSON.stringify({ ready, results: lastResults }, null, 2)}\n`);
  }

  if (!ready) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
