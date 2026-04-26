#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { ROOT_DIR, parseDateArgs, writeJson } from "./lib/pipeline-utils.js";

function parseArgs(argv) {
  const args = parseDateArgs(argv);
  args.manifest = path.join(ROOT_DIR, "config", "pipeline-manifest.yaml");
  args.report = null;
  args.dryRun = false;
  args.stage2Mode = "qwen";
  args.force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--manifest" && argv[index + 1]) {
      args.manifest = argv[index + 1];
      index += 1;
    } else if (token === "--report" && argv[index + 1]) {
      args.report = argv[index + 1];
      index += 1;
    } else if (token === "--stage2-mode" && argv[index + 1]) {
      args.stage2Mode = argv[index + 1];
      index += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--force") {
      args.force = true;
    }
  }

  return args;
}

async function readManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

function templateValue(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((item) => templateValue(item, variables));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, templateValue(nested, variables)]),
    );
  }
  return value;
}

function resolveFilePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
}

function topoSort(steps) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const indegree = new Map(steps.map((step) => [step.id, 0]));
  const outgoing = new Map(steps.map((step) => [step.id, []]));

  for (const step of steps) {
    for (const dependency of step.depends_on ?? []) {
      if (!byId.has(dependency)) {
        throw new Error(`unknown dependency: ${dependency} -> ${step.id}`);
      }
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
      outgoing.get(dependency).push(step.id);
    }
  }

  const queue = steps.filter((step) => (indegree.get(step.id) ?? 0) === 0).map((step) => step.id);
  const order = [];

  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  if (order.length !== steps.length) {
    throw new Error("cycle detected in pipeline manifest");
  }

  return order;
}

function latestMtime(paths) {
  const mtimes = paths
    .filter(Boolean)
    .map((item) => resolveFilePath(item))
    .filter((item) => fsSync.existsSync(item))
    .map((item) => fsSync.statSync(item).mtimeMs);
  return mtimes.length > 0 ? Math.max(...mtimes) : null;
}

function earliestMtime(paths) {
  const resolved = paths
    .filter(Boolean)
    .map((item) => resolveFilePath(item));

  if (resolved.length === 0 || resolved.some((item) => !fsSync.existsSync(item))) {
    return null;
  }

  return Math.min(...resolved.map((item) => fsSync.statSync(item).mtimeMs));
}

function shouldSkipStep(step, force) {
  if (force) return false;
  const earliestOutput = earliestMtime(step.outputs ?? []);
  if (earliestOutput == null) return false;
  const latestInput = latestMtime(step.inputs ?? []);
  if (latestInput == null) return false;
  return earliestOutput >= latestInput;
}

function executeCommand(step) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn("/bin/bash", ["-lc", step.command], {
      cwd: ROOT_DIR,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, step.timeout ?? 300000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        id: step.id,
        label: step.label,
        command: step.command,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: timedOut
          ? step.allow_failure
            ? "soft_failed"
            : "failed"
          : code === 0
            ? "completed"
            : step.allow_failure
              ? "soft_failed"
              : "failed",
        exitCode: timedOut ? 124 : code ?? 1,
        timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await readManifest(args.manifest);
  const variables = {
    date: args.date,
    runDate: args.runDate,
    effectiveMarketDate: args.effectiveMarketDate,
    stage2Mode: args.stage2Mode,
  };
  const steps = templateValue(manifest.steps ?? [], variables);
  const order = topoSort(steps);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const report = {
    manifest: args.manifest,
    date: args.date,
    runDate: args.runDate,
    effectiveMarketDate: args.effectiveMarketDate,
    stage2Mode: args.stage2Mode,
    generatedAt: new Date().toISOString(),
    dryRun: args.dryRun,
    steps: [],
  };

  if (args.dryRun) {
    for (const id of order) {
      const step = byId.get(id);
      report.steps.push({
        id: step.id,
        label: step.label,
        dependsOn: step.depends_on ?? [],
        command: step.command,
      });
    }

    const outputPath =
      args.report ?? path.join(ROOT_DIR, "data", "analysis-state", args.date, "pipeline-run.json");
    await writeJson(outputPath, report);
    process.stdout.write(
      `${order.map((id, index) => `${index + 1}. ${id}`).join("\n")}\n`,
    );
    process.stdout.write(`${outputPath}\n`);
    return;
  }

  const completed = new Set();
  const results = new Map();
  const pending = new Set(order);

  while (pending.size > 0) {
    const ready = [...pending]
      .map((id) => byId.get(id))
      .filter((step) => (step.depends_on ?? []).every((dependency) => completed.has(dependency)));

    if (ready.length === 0) {
      throw new Error("no runnable steps found; pipeline is stuck");
    }

    const executions = ready.map(async (step) => {
      pending.delete(step.id);

      if (shouldSkipStep(step, args.force)) {
        return {
          id: step.id,
          label: step.label,
          command: step.command,
          status: "skipped",
          exitCode: 0,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          stdout: "",
          stderr: "",
          cacheKey: step.cache_key ?? null,
        };
      }

      const result = await executeCommand(step);
      result.cacheKey = step.cache_key ?? null;
      return result;
    });

    const batchResults = await Promise.all(executions);
    for (const result of batchResults) {
      results.set(result.id, result);
      report.steps.push(result);
      if (result.status === "failed") {
        const outputPath =
          args.report ?? path.join(ROOT_DIR, "data", "analysis-state", args.date, "pipeline-run.json");
        await writeJson(outputPath, report);
        throw new Error(`${result.id} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
      }
      completed.add(result.id);
    }
  }

  report.overallStatus = report.steps.some((step) => step.status === "soft_failed")
    ? "warn"
    : "ok";

  const outputPath =
    args.report ?? path.join(ROOT_DIR, "data", "analysis-state", args.date, "pipeline-run.json");
  await writeJson(outputPath, report);
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  console.error(`[pipeline-dag] 실패: ${error.message}`);
  process.exit(1);
});
