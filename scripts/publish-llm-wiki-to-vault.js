#!/usr/bin/env node
// EcoReport knowledge/wiki 를 Obsidian vault(/Users/seo/my-wiki)에 게시합니다.

import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_DIR, readText, writeText } from "./lib/pipeline-utils.js";

const DEFAULT_VAULT_DIR = "/Users/seo/my-wiki";

function parseArgs(argv) {
  const args = {
    vault: process.env.OBSIDIAN_VAULT_DIR || DEFAULT_VAULT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--vault" && argv[i + 1]) {
      args.vault = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function removeExtraFiles(dest, allowed) {
  try {
    const entries = await fs.readdir(dest, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await removeExtraFiles(target, allowed);
        const remaining = await fs.readdir(target).catch(() => []);
        if (remaining.length === 0 && !allowed.has(target)) {
          await fs.rmdir(target).catch(() => {});
        }
      } else if (!allowed.has(target)) {
        await fs.rm(target, { force: true });
      }
    }
  } catch {
    // ignore
  }
}

async function gatherFiles(dir, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      acc.push(target);
      await gatherFiles(target, acc);
    } else {
      acc.push(target);
    }
  }
  return acc;
}

function replaceLinks(markdownPath, text) {
  const depthFromPublishedRoot = path
    .relative(path.join(path.dirname(markdownPath), "."), path.join(path.dirname(markdownPath), ".."))
    .split(path.sep).length;

  const relativeToRoot =
    markdownPath.includes(`${path.sep}daily${path.sep}`)
      ? "../../../"
      : markdownPath.includes(`${path.sep}accounts${path.sep}`) || markdownPath.includes(`${path.sep}securities${path.sep}`)
        ? "../../../"
        : "../../";

  return text
    .replaceAll("../../data/", `${relativeToRoot}raw/ecoreport/data/`)
    .replaceAll("../../docs/", `${relativeToRoot}raw/ecoreport/docs/`);
}

async function rewriteMarkdownTree(publishedRoot) {
  const files = await gatherFiles(publishedRoot);
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const original = await readText(file, "");
    const rewritten = replaceLinks(file, original);
    if (rewritten !== original) {
      await writeText(file, rewritten);
    }
  }
}

async function copyAnalysisStateForPublishedDates(sourceDailyDir, rawTargetDataDir) {
  const entries = await fs.readdir(sourceDailyDir, { withFileTypes: true }).catch(() => []);
  const publishedDates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""));

  for (const date of publishedDates) {
    const src = path.join(ROOT_DIR, "data", "analysis-state", date);
    try {
      await copyDir(src, path.join(rawTargetDataDir, "analysis-state", date));
    } catch {
      // ignore missing dates
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vaultDir = path.resolve(args.vault);
  const sourceWikiDir = path.join(ROOT_DIR, "knowledge", "wiki");
  const targetWikiDir = path.join(vaultDir, "wiki", "ecoreport");
  const targetRawDir = path.join(vaultDir, "raw", "ecoreport");
  const targetRawDataDir = path.join(targetRawDir, "data");
  const targetRawDocsDir = path.join(targetRawDir, "docs");

  await ensureDir(targetWikiDir);
  await ensureDir(targetRawDataDir);
  await ensureDir(targetRawDocsDir);

  await copyDir(sourceWikiDir, targetWikiDir);
  const allowed = new Set(await gatherFiles(targetWikiDir));
  await removeExtraFiles(targetWikiDir, allowed);

  await copyAnalysisStateForPublishedDates(path.join(sourceWikiDir, "daily"), targetRawDataDir);
  await copyFile(
    path.join(ROOT_DIR, "data", "portfolio", "latest.json"),
    path.join(targetRawDataDir, "portfolio", "latest.json"),
  );
  await copyFile(
    path.join(ROOT_DIR, "docs", "LLM_WIKI_SYSTEM.md"),
    path.join(targetRawDocsDir, "LLM_WIKI_SYSTEM.md"),
  );
  await copyFile(
    path.join(ROOT_DIR, "docs", "OPERATOR_RUNBOOK.md"),
    path.join(targetRawDocsDir, "OPERATOR_RUNBOOK.md"),
  );

  await rewriteMarkdownTree(targetWikiDir);

  console.log(targetWikiDir);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
