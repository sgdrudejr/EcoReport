import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { resolveRepoRoot } from "@/lib/repo-root";

const REPO_ROOT = resolveRepoRoot();
const DATA_BRANCH_REFS = ["origin/data", "ssh-origin/data", "data"];

function absolutePath(relativePath: string) {
  return path.join(REPO_ROOT, relativePath);
}

function runGit(args: string[]) {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function readRepoTextFile(relativePath: string) {
  const localPath = absolutePath(relativePath);
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, "utf-8");
  }

  for (const ref of DATA_BRANCH_REFS) {
    try {
      const content = runGit(["show", `${ref}:${relativePath}`]);
      if (content) {
        return content;
      }
    } catch {
      // try next ref
    }
  }

  return null;
}

export function readRepoJsonFile<T>(relativePath: string): T | null {
  const raw = readRepoTextFile(relativePath);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function listRepoFiles(relativeDir: string) {
  const merged = new Set<string>();

  const localDir = absolutePath(relativeDir);
  if (fs.existsSync(localDir)) {
    for (const file of fs.readdirSync(localDir)) {
      merged.add(file);
    }
  }

  for (const ref of DATA_BRANCH_REFS) {
    try {
      const output = runGit(["ls-tree", "-r", "--name-only", ref, "--", relativeDir]);
      const files = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && path.posix.dirname(line) === relativeDir)
        .map((line) => path.posix.basename(line));

      for (const file of files) {
        merged.add(file);
      }
    } catch {
      // try next ref
    }
  }

  return [...merged];
}
