import fs from "fs";
import path from "path";

function isRepoRoot(candidate: string) {
  return (
    fs.existsSync(path.join(candidate, "dashboard")) &&
    fs.existsSync(path.join(candidate, "config")) &&
    fs.existsSync(path.join(candidate, "data"))
  );
}

export function resolveRepoRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ];

  for (const candidate of candidates) {
    if (isRepoRoot(candidate)) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), "..");
}

