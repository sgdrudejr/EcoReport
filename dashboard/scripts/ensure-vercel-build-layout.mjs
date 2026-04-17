import fs from "fs";
import path from "path";

const cwd = process.cwd();
const buildRoot = path.join(cwd, ".vercel-build");
const nestedDir = path.join(buildRoot, "dashboard-layout");
const sourceNextDir = path.join(cwd, ".next");

if (!fs.existsSync(sourceNextDir)) {
  process.exit(0);
}

fs.rmSync(nestedDir, { recursive: true, force: true });
fs.mkdirSync(nestedDir, { recursive: true });

for (const entry of fs.readdirSync(cwd)) {
  if (entry === ".vercel-build") {
    continue;
  }

  const target = path.join(cwd, entry);
  const linkPath = path.join(nestedDir, entry);
  const relativeTarget = path.relative(nestedDir, target);

  try {
    const stat = fs.lstatSync(target);
    const type = stat.isDirectory() ? "dir" : "file";
    fs.symlinkSync(relativeTarget, linkPath, type);
  } catch {
    if (fs.existsSync(target)) {
      fs.cpSync(target, linkPath, {
        recursive: true,
        force: true,
      });
    }
  }
}
