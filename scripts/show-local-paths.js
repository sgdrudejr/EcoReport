#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { ROOT_DIR } from "./lib/pipeline-utils.js";
import { getLocalPathsFile, loadLocalPaths, resolveLocalPath } from "./lib/local-paths.js";

const localPaths = loadLocalPaths();

const resolved = {
  ecoreportRoot: ROOT_DIR,
  localPathsFile: getLocalPathsFile(),
  localPathsFileExists: fs.existsSync(getLocalPathsFile()),
  openTradingApiRoot: resolveLocalPath(
    localPaths.openTradingApiRoot,
    process.env.OPEN_TRADING_API_ROOT,
    process.env.KIS_OPEN_TRADING_API_ROOT,
    path.join(ROOT_DIR, "open-trading-api"),
    path.join(path.dirname(ROOT_DIR), "open-trading-api"),
    path.join(process.env.HOME ?? "", "stock-pilot", "open-trading-api"),
  ),
  obsidianVaultDir: resolveLocalPath(
    process.env.OBSIDIAN_VAULT_DIR,
    localPaths.obsidianVaultDir,
    "/Users/seo/my-wiki",
  ),
};

console.log(JSON.stringify(resolved, null, 2));
