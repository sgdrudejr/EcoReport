#!/usr/bin/env node
// LLM 단계별 입력 변경 여부를 감지해 실행 필요성을 판단하는 스크립트입니다.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const STATE_ROOT = path.join(ROOT, "data", "analysis-state");

function parseArgs(argv) {
  const args = {
    command: "check",
    date: new Date().toISOString().slice(0, 10),
    stage: null,
  };

  if (argv[0] && !argv[0].startsWith("--")) {
    args.command = argv[0];
    argv = argv.slice(1);
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--stage" && argv[index + 1]) {
      args.stage = argv[index + 1];
      index += 1;
    }
  }

  if (!args.stage) {
    throw new Error("--stage 값이 필요합니다. (report-queue|compress|synthesis|advisory)");
  }

  return args;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeJson(filePath, value) {
  if (filePath.endsWith(".json") === false) {
    return value;
  }

  if (filePath.includes(path.join("data", "technical"))) {
    const clone = structuredClone(value);
    delete clone.generated_at;
    return clone;
  }

  return value;
}

async function hashFile(filePath) {
  if (!(await pathExists(filePath))) {
    return { path: path.relative(ROOT, filePath), exists: false, hash: "MISSING" };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    const json = await readJson(filePath);
    const normalized = normalizeJson(filePath, json);
    return {
      path: path.relative(ROOT, filePath),
      exists: true,
      hash: sha256(stableSerialize(normalized)),
    };
  }

  const raw = await fs.readFile(filePath, "utf8");
  return {
    path: path.relative(ROOT, filePath),
    exists: true,
    hash: sha256(raw),
  };
}

async function listRecentFiles(directory, suffix, limit) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => path.join(directory, entry.name))
      .sort()
      .slice(-limit);
  } catch {
    return [];
  }
}

async function resolveStageInputs(stage, date) {
  const reportsDir = path.join(ROOT, "data", "reports", date);
  const knowledgeDailyDir = path.join(ROOT, "knowledge", "daily");
  const knowledgeWeeklyDir = path.join(ROOT, "knowledge", "weekly");
  const knowledgeMonthlyDir = path.join(ROOT, "knowledge", "monthly");

  if (stage === "report-queue") {
    return [
      path.join(reportsDir, "index.json"),
      path.join(ROOT, "data", "portfolio", "latest.json"),
      path.join(ROOT, "config", "watchlist.json"),
      path.join(ROOT, "prompts", "compress-report.md"),
    ];
  }

  if (stage === "compress") {
    return [path.join(reportsDir, "index.json")];
  }

  if (stage === "synthesis") {
    return [
      path.join(reportsDir, "compressed.json"),
      path.join(ROOT, "data", "news", `${date}.json`),
      path.join(ROOT, "data", "tweets", `${date}.json`),
    ];
  }

  if (stage === "advisory") {
    const recentDigests = await listRecentFiles(knowledgeDailyDir, "-digest.md", 7);
    const recentWeekly = await listRecentFiles(knowledgeWeeklyDir, ".md", 4);
    const recentMonthly = await listRecentFiles(knowledgeMonthlyDir, ".md", 3);

    return [
      path.join(knowledgeDailyDir, `${date}-synthesis.md`),
      path.join(ROOT, "data", "technical", `${date}.json`),
      path.join(ROOT, "data", "portfolio", "latest.json"),
      path.join(ROOT, "config", "strategy.json"),
      path.join(ROOT, "data", "theme-candidates", `${date}.json`),
      ...recentDigests,
      ...recentWeekly,
      ...recentMonthly,
    ];
  }

  throw new Error(`지원하지 않는 stage입니다: ${stage}`);
}

async function resolveStageOutputs(stage, date) {
  if (stage === "report-queue") {
    return [
      path.join(ROOT, "knowledge", "daily", `${date}-report-summary-queue.json`),
      path.join(ROOT, "knowledge", "daily", `${date}-report-summary-queue.md`),
    ];
  }

  if (stage === "compress") {
    return [path.join(ROOT, "data", "reports", date, "compressed.json")];
  }

  if (stage === "synthesis") {
    return [path.join(ROOT, "knowledge", "daily", `${date}-synthesis.md`)];
  }

  if (stage === "advisory") {
    const reportDir = path.join(ROOT, "reports", "daily");
    try {
      const entries = await fs.readdir(reportDir, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.startsWith(`${date}-`) &&
            entry.name.endsWith("-briefing.md"),
        )
        .map((entry) => path.join(reportDir, entry.name))
        .sort();
    } catch {
      return [];
    }
  }

  return [];
}

function buildCombinedHash(files) {
  return sha256(
    stableSerialize(
      files.map((file) => ({
        path: file.path,
        exists: file.exists,
        hash: file.hash,
      })),
    ),
  );
}

function getStatePath(stage, date) {
  return path.join(STATE_ROOT, date, `${stage}.json`);
}

async function readState(stage, date) {
  const filePath = getStatePath(stage, date);
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function writeState(stage, date, payload) {
  const filePath = getStatePath(stage, date);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function diffFiles(current, previous = []) {
  const previousMap = new Map(previous.map((item) => [item.path, item.hash]));
  return current
    .filter((item) => previousMap.get(item.path) !== item.hash)
    .map((item) => item.path);
}

async function checkStage(stage, date) {
  const inputs = await resolveStageInputs(stage, date);
  const hashedInputs = await Promise.all(inputs.map((filePath) => hashFile(filePath)));
  const combinedHash = buildCombinedHash(hashedInputs);
  const outputs = await resolveStageOutputs(stage, date);
  const outputExists = outputs.length > 0 && (await pathExists(outputs[0]));
  const state = await readState(stage, date);

  if (!outputExists) {
    return {
      shouldRun: true,
      reason: "기존 출력 파일이 없어 새로 생성해야 합니다.",
      hashedInputs,
      combinedHash,
    };
  }

  if (!state) {
    return {
      shouldRun: true,
      reason: "이전 LLM 실행 상태가 없어 1회 실행이 필요합니다.",
      hashedInputs,
      combinedHash,
    };
  }

  if (state.combinedHash !== combinedHash) {
    const changed = diffFiles(hashedInputs, state.inputs ?? []);
    return {
      shouldRun: true,
      reason:
        changed.length > 0
          ? `입력 변경 감지: ${changed.join(", ")}`
          : "입력 해시가 변경되어 재분석이 필요합니다.",
      hashedInputs,
      combinedHash,
    };
  }

  return {
    shouldRun: false,
    reason: "새로운 정보가 없어 LLM 단계를 건너뜹니다.",
    hashedInputs,
    combinedHash,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "check") {
    const result = await checkStage(args.stage, args.date);
    console.log(result.reason);
    process.exitCode = result.shouldRun ? 0 : 20;
    return;
  }

  if (args.command === "mark") {
    const inputs = await resolveStageInputs(args.stage, args.date);
    const hashedInputs = await Promise.all(inputs.map((filePath) => hashFile(filePath)));
    const combinedHash = buildCombinedHash(hashedInputs);
    const outputs = await resolveStageOutputs(args.stage, args.date);

    await writeState(args.stage, args.date, {
      stage: args.stage,
      date: args.date,
      updatedAt: new Date().toISOString(),
      combinedHash,
      inputs: hashedInputs,
      outputs: outputs.map((filePath) => path.relative(ROOT, filePath)),
    });

    console.log(`상태 저장 완료: ${args.stage} (${args.date})`);
    return;
  }

  throw new Error(`지원하지 않는 command입니다: ${args.command}`);
}

main().catch((error) => {
  console.error(
    `❌ llm-stage-gate 실패: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
