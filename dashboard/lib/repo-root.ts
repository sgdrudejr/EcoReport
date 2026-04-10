import fs from "fs";
import path from "path";

function isRepoRoot(candidate: string) {
  const hasSharedArtifacts =
    fs.existsSync(path.join(candidate, "config")) &&
    fs.existsSync(path.join(candidate, "data"));

  const hasMonorepoLayout = fs.existsSync(path.join(candidate, "dashboard"));
  const hasFlattenedAppLayout =
    fs.existsSync(path.join(candidate, "app")) &&
    fs.existsSync(path.join(candidate, "package.json"));

  return hasSharedArtifacts && (hasMonorepoLayout || hasFlattenedAppLayout);
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
