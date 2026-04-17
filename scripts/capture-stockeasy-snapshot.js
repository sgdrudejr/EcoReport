import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const repoRoot = process.cwd();
const PAGE_DELIMITER = "\n<<<CODEX_PAGE>>>\n";

function parseArgs(argv) {
  const args = {
    date: "",
    smokeTest: false,
    promisingSectors: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--smoke-test") {
      args.smokeTest = true;
    } else if (token === "--promising-sectors" && argv[index + 1]) {
      args.promisingSectors = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

const cli = parseArgs(process.argv.slice(2));
const captureDate = cli.date || new Date().toISOString().slice(0, 10);
const outputDir = path.join(repoRoot, "data", "external", "stockeasy", captureDate);
const outputPath = path.join(outputDir, "snapshot.json");

function runAppleScript(script) {
  return execFileSync("osascript", ["-"], {
    input: script,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function quoted(value) {
  return JSON.stringify(String(value));
}

function readJson(filePath, fallbackValue = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function parseNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").replace(/[^\d.+-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeNonNegativeCount(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.round(Math.abs(value)));
}

function toIsoDate(monthDayText, fallbackYear) {
  const match = monthDayText.match(/(\d{1,2})월\s+(\d{1,2})일\s+기준/);
  if (!match) return null;
  const [, monthText, dayText] = match;
  return `${fallbackYear}-${String(monthText).padStart(2, "0")}-${String(dayText).padStart(2, "0")}`;
}

function toMonthDayLabel(isoDate) {
  const match = String(isoDate).match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

function compactLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitBulletSummary(text) {
  const compact = compactLine(text);
  if (!compact) return [];

  if (compact.includes("•")) {
    return compact
      .split("•")
      .map((item) => compactLine(item))
      .filter(Boolean);
  }

  return compact
    .split(/\s{2,}/)
    .map((item) => compactLine(item))
    .filter(Boolean);
}

function parsePriceTriplet(text) {
  const tokens = compactLine(text).split(" ").filter(Boolean);
  const [targetPriceText, currentPriceText, gapPctText] = tokens;
  return {
    targetPrice: parseNumber(targetPriceText),
    currentPrice: parseNumber(currentPriceText),
    gapPct: parseNumber(gapPctText),
  };
}

function buildTextHelpers() {
  return `
    const textOf = (node) => String(node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
    const splitLines = (limit) =>
      (document.body.innerText || "")
        .split("\\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, limit);
    const extractTables = (tableLimit, rowLimit, cellLimit) =>
      Array.from(document.querySelectorAll("table"))
        .slice(0, tableLimit)
        .map((table, tableIndex) => {
          const rows = Array.from(table.querySelectorAll("tr"))
            .slice(0, rowLimit)
            .map((row) =>
              Array.from(row.querySelectorAll("th, td"))
                .slice(0, cellLimit)
                .map((cell) => textOf(cell))
                .filter((cell) => cell.length > 0),
            )
            .filter((cells) => cells.length > 0);
          return {
            tableIndex,
            headers: rows.find((cells) => cells.length > 1) ?? [],
            rows,
          };
        })
        .filter((table) => table.rows.length > 0);
    const clickByNeedle = (needle, resultKey) => {
      const candidates = Array.from(
        document.querySelectorAll("button, a, [role='tab'], [role='button'], td, th, tr, div, span")
      );
      const rawTarget =
        candidates.find((node) => textOf(node) === needle) ||
        candidates.find((node) => textOf(node).startsWith(needle)) ||
        candidates.find((node) => textOf(node).includes(needle));
      const target =
        rawTarget?.closest?.("button, a, [role='tab'], [role='button'], td, th, tr, div, span") ||
        rawTarget ||
        null;
      const availableMatches = candidates
        .map((node) => textOf(node))
        .filter((text) => text && text.includes(needle))
        .slice(0, 12);
      if (!target) {
        window[resultKey] = { needle, clicked: false, matchedText: null, availableMatches };
        return false;
      }
      target.scrollIntoView?.({ block: "center", inline: "center" });
      target.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true }));
      target.dispatchEvent?.(new MouseEvent("mouseup", { bubbles: true }));
      target.dispatchEvent?.(new MouseEvent("click", { bubbles: true }));
      if (typeof target.click === "function") {
        target.click();
      }
      window[resultKey] = { needle, clicked: true, matchedText: textOf(target), availableMatches };
      return true;
    };
  `.trim();
}

function buildClickScript(actionText, resultKey) {
  return `
    (() => {
      ${buildTextHelpers()}
      return clickByNeedle(${quoted(actionText)}, ${quoted(resultKey)});
    })();
  `.trim();
}

function buildExtractorScript({ lineLimit, tableLimit, rowLimit, cellLimit, actionCount }) {
  const actionRefs = Array.from({ length: actionCount }, (_, index) => `window.__codexAction${index} || null`).join(", ");
  return `
    (() => {
      ${buildTextHelpers()}
      return JSON.stringify({
        title: document.title,
        href: location.href,
        actionResults: [${actionRefs}],
        lines: splitLines(${lineLimit}),
        tables: extractTables(${tableLimit}, ${rowLimit}, ${cellLimit})
      });
    })();
  `.trim();
}

function fetchPage(url, lineLimit = 320, options = {}) {
  const actionTexts = Array.isArray(options.actionTexts)
    ? options.actionTexts.filter(Boolean).map((item) => String(item))
    : options.actionText
      ? [String(options.actionText)]
      : [];
  const actionDelaySec =
    typeof options.actionDelaySec === "number" && options.actionDelaySec > 0
      ? options.actionDelaySec
      : 1.8;
  const tableLimit =
    typeof options.tableLimit === "number" && options.tableLimit > 0 ? options.tableLimit : 3;
  const rowLimit = typeof options.rowLimit === "number" && options.rowLimit > 0 ? options.rowLimit : 80;
  const cellLimit =
    typeof options.cellLimit === "number" && options.cellLimit > 0 ? options.cellLimit : 20;

  const extractor = buildExtractorScript({
    lineLimit,
    tableLimit,
    rowLimit,
    cellLimit,
    actionCount: actionTexts.length,
  });

  const actionStatements = actionTexts
    .map(
      (actionText, index) => `
  do JavaScript ${quoted(buildClickScript(actionText, `__codexAction${index}`))} in tempTab
  delay ${actionDelaySec}
      `.trim(),
    )
    .join("\n");

  const script = `
tell application "Safari"
  activate
  if (count of windows) = 0 then
    make new document
    delay 0.5
  end if

  tell front window
    set tempTab to make new tab at end of tabs with properties {URL:${quoted(url)}}
    set current tab to tempTab
  end tell

  delay 3
  ${actionStatements}
  set payload to do JavaScript ${quoted(extractor)} in tempTab
  close tempTab
  return payload
end tell
  `.trim();

  return JSON.parse(runAppleScript(script));
}

function parsePagePayloads(raw) {
  if (!raw) return [];
  return raw
    .split(PAGE_DELIMITER)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk));
}

function buildClickNextScript() {
  return `
    (() => {
      ${buildTextHelpers()}
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((button) => textOf(button) === "다음");
      if (!target) return "false";
      const disabled =
        target.disabled ||
        target.getAttribute("disabled") !== null ||
        target.getAttribute("aria-disabled") === "true";
      if (disabled) return "false";
      target.scrollIntoView?.({ block: "center", inline: "center" });
      target.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true }));
      target.dispatchEvent?.(new MouseEvent("mouseup", { bubbles: true }));
      target.dispatchEvent?.(new MouseEvent("click", { bubbles: true }));
      target.click?.();
      return "true";
    })();
  `.trim();
}

function captureIndustryReports(targetDateLabel, maxPages = 30) {
  const pageScript = `
    (() => {
      ${buildTextHelpers()}
      const tables = extractTables(3, 80, 20);
      const table = tables.find(
        (item) =>
          item.headers.includes("일자") &&
          item.headers.includes("섹터") &&
          item.headers.includes("제목") &&
          item.headers.includes("요약")
      ) ?? null;

      if (!window.__codexIndustryRows) {
        window.__codexIndustryRows = {};
      }
      if (!window.__codexIndustryPageStats) {
        window.__codexIndustryPageStats = [];
      }

      const rows = (table?.rows ?? [])
        .slice(1)
        .map((cells) => ({
          date: cells[0] ?? null,
          sector: cells[1] ?? null,
          broker: cells[2] ?? null,
          opinion: cells[3] ?? null,
          change: cells[4] ?? null,
          title: cells[5] ?? null,
          summary: cells[6] ?? null,
        }))
        .filter((row) => row.date && row.title);

      const matchingRows = rows.filter((row) => row.date === ${quoted(targetDateLabel)});
      for (const row of matchingRows) {
        const key = [row.date, row.sector, row.broker, row.title].filter(Boolean).join("|");
        window.__codexIndustryRows[key] = row;
      }

      const lines = splitLines(260);
      const pageLabel = lines.find((line) => /^\\d+-\\d+\\s*\\/\\s*\\d+개$/.test(line)) ?? null;
      const pageStat = {
        pageLabel,
        matchingCount: matchingRows.length,
        accumulatedCount: Object.keys(window.__codexIndustryRows).length,
      };
      window.__codexIndustryPageStats.push(pageStat);
      window.__codexIndustryShouldStop = matchingRows.length === 0;

      return JSON.stringify(pageStat);
    })();
  `.trim();

  const finalScript = `
    (() => {
      const rows = Object.values(window.__codexIndustryRows || {}).map((row) => ({
        ...row,
        summaryBullets: String(row.summary || "")
          .split("•")
          .map((item) => item.trim())
          .filter(Boolean),
      }));
      return JSON.stringify({
        targetDateLabel: ${quoted(targetDateLabel)},
        rows,
        pageStats: window.__codexIndustryPageStats || [],
      });
    })();
  `.trim();

  const script = `
tell application "Safari"
  activate
  if (count of windows) = 0 then
    make new document
    delay 0.5
  end if

  tell front window
    set tempTab to make new tab at end of tabs with properties {URL:${quoted("https://stockeasy.intellio.kr/stock-analysis")}}
    set current tab to tempTab
  end tell

  delay 3
  do JavaScript ${quoted(buildClickScript("리포트", "__codexAction0"))} in tempTab
  delay 2.0
  do JavaScript ${quoted(buildClickScript("산업리포트", "__codexAction1"))} in tempTab
  delay 2.2

  set pagePayloads to ""
  repeat with pageIndex from 1 to ${maxPages}
    set pagePayload to do JavaScript ${quoted(pageScript)} in tempTab
    set pagePayloads to pagePayloads & pagePayload & ${quoted(PAGE_DELIMITER)}
    set shouldStop to do JavaScript "String(window.__codexIndustryShouldStop === true)" in tempTab
    if shouldStop is "true" then
      exit repeat
    end if
    set didAdvance to do JavaScript ${quoted(buildClickNextScript())} in tempTab
    if didAdvance is "false" then
      exit repeat
    end if
    delay 1.8
  end repeat

  set finalPayload to do JavaScript ${quoted(finalScript)} in tempTab
  close tempTab
  return pagePayloads & ${quoted("<<<CODEX_FINAL>>>")} & finalPayload
end tell
  `.trim();

  const raw = runAppleScript(script);
  const [pagesPart, finalPart] = raw.split("<<<CODEX_FINAL>>>");
  return {
    pageStats: parsePagePayloads(pagesPart),
    final: JSON.parse(finalPart),
  };
}

function buildPromisingSectorSet(baseSectors) {
  const values = new Set();
  for (const sector of baseSectors) {
    for (const item of normalizePromisingSector(sector)) {
      values.add(item);
    }
  }
  return values;
}

function normalizePromisingSector(value) {
  const text = compactLine(value);
  if (!text) return [];

  const aliasMap = new Map([
    ["반도체", ["반도체"]],
    ["전력/에너지", ["전력/에너지"]],
    ["전력기기", ["전력/에너지"]],
    ["원자력", ["전력/에너지"]],
    ["smr", ["전력/에너지"]],
    ["인프라", ["인프라"]],
    ["ai 인프라", ["인프라", "IT/플랫폼"]],
    ["ai/인프라", ["인프라", "IT/플랫폼"]],
    ["기계", ["기계"]],
    ["방산", ["방산"]],
    ["화학/소재", ["화학/소재"]],
    ["금", ["화학/소재"]],
    ["금/원자재", ["화학/소재"]],
    ["금융", ["금융"]],
    ["소비재", ["소비재"]],
    ["it/플랫폼", ["IT/플랫폼"]],
    ["k-컬처", ["K-컬처"]],
    ["조선/해운", ["조선/해운"]],
    ["바이오", ["바이오"]],
    ["자동차", ["자동차"]],
    ["2차전지", ["2차전지"]],
    ["지주사", ["지주사"]],
  ]);

  const normalizedKey = text.toLowerCase();
  if (aliasMap.has(normalizedKey)) {
    return aliasMap.get(normalizedKey) ?? [];
  }

  for (const [key, items] of aliasMap.entries()) {
    if (normalizedKey.includes(key)) {
      return items;
    }
  }

  return [text];
}

function deriveInternalPromisingSectors(explicitInput = "") {
  if (explicitInput) {
    return [...buildPromisingSectorSet(explicitInput.split(",").map((item) => item.trim()).filter(Boolean))];
  }

  const themeMap = readJson(path.join(repoRoot, "data", "reference", "stockeasy-theme-etf-map.json"), { etfs: [] });
  const securities = readJson(path.join(repoRoot, "config", "securities.json"), { securities: [] });
  const seeds = [];

  for (const etf of themeMap?.etfs ?? []) {
    for (const sector of etf?.sectors ?? []) {
      seeds.push(sector);
    }
  }

  for (const security of securities?.securities ?? []) {
    for (const sector of security?.thematic_triggers?.sectors ?? []) {
      seeds.push(sector);
    }
    for (const theme of security?.thematic_triggers?.themes ?? []) {
      seeds.push(theme);
    }
  }

  return [...buildPromisingSectorSet(seeds)];
}

function capturePromisingOverallRs(promisingSectors, targetCount = 100, maxPages = 80) {
  const normalizedSectors = [...new Set(promisingSectors.map((item) => compactLine(item)).filter(Boolean))];
  const pageScript = `
    (() => {
      ${buildTextHelpers()}
      if (!window.__codexPromisingRows) {
        window.__codexPromisingRows = {};
      }
      if (!window.__codexPromisingPageStats) {
        window.__codexPromisingPageStats = [];
      }

      const lines = splitLines(320);
      const tableStart = lines.findIndex((line) => /^\\d+개 종목$/.test(line));
      const rows = [];
      for (let index = tableStart + 1; tableStart >= 0 && index + 4 < lines.length; index += 1) {
        const sector = lines[index];
        const sectorRank = lines[index + 1];
        const name = lines[index + 2];
        const code = lines[index + 3];
        const metrics = lines[index + 4];

        if (!/^\\d+$/.test(String(sectorRank || "")) || !/^\\d{6}$/.test(String(code || "")) || !String(metrics || "").includes("\\t")) {
          continue;
        }

        const metricCells = String(metrics).split(/\\t+/);
        rows.push({
          sector,
          sectorRank,
          name,
          code,
          price: metricCells[0] ?? null,
          changePct: metricCells[1] ?? null,
          rs: metricCells[2] ?? null,
          rs1m: metricCells[3] ?? null,
          rs3m: metricCells[4] ?? null,
          rs6m: metricCells[5] ?? null,
          mmt: metricCells.length >= 8 ? metricCells[6] ?? null : null,
          marketCapLabel: metricCells.length >= 8 ? metricCells[7] ?? null : metricCells[6] ?? null,
        });

        index += 4;
      }

      const promisingSet = new Set(${JSON.stringify(normalizedSectors)});
      const matchingRows = rows.filter((row) => promisingSet.has(String(row.sector || "").trim()));
      for (const row of matchingRows) {
        const key = row.code || [row.sector, row.name].filter(Boolean).join("|");
        window.__codexPromisingRows[key] = row;
      }

      const pageLabel = lines.find((line) => /^\\d+-\\d+\\s*\\/\\s*\\d+개$/.test(line)) ?? null;
      const pageStat = {
        pageLabel,
        matchingCount: matchingRows.length,
        accumulatedCount: Object.keys(window.__codexPromisingRows).length,
      };
      window.__codexPromisingPageStats.push(pageStat);
      window.__codexPromisingShouldStop =
        Object.keys(window.__codexPromisingRows).length >= ${targetCount} || rows.length === 0;

      return JSON.stringify(pageStat);
    })();
  `.trim();

  const finalScript = `
    (() => {
      const rows = Object.values(window.__codexPromisingRows || {});
      rows.sort((left, right) => {
        const rsGap = (Number(right.rs || 0) - Number(left.rs || 0));
        if (rsGap !== 0) return rsGap;
        const threeMonthGap = Number(right.rs3m || 0) - Number(left.rs3m || 0);
        if (threeMonthGap !== 0) return threeMonthGap;
        return Number(left.sectorRank || 9999) - Number(right.sectorRank || 9999);
      });
      return JSON.stringify({
        sectors: ${JSON.stringify(normalizedSectors)},
        rows: rows.slice(0, ${targetCount}),
        totalCollected: rows.length,
        pageStats: window.__codexPromisingPageStats || [],
      });
    })();
  `.trim();

  const script = `
tell application "Safari"
  activate
  if (count of windows) = 0 then
    make new document
    delay 0.5
  end if

  tell front window
    set tempTab to make new tab at end of tabs with properties {URL:${quoted("https://stockeasy.intellio.kr/stock-analysis")}}
    set current tab to tempTab
  end tell

  delay 3

  set pagePayloads to ""
  repeat with pageIndex from 1 to ${maxPages}
    set pagePayload to do JavaScript ${quoted(pageScript)} in tempTab
    set pagePayloads to pagePayloads & pagePayload & ${quoted(PAGE_DELIMITER)}
    set shouldStop to do JavaScript "String(window.__codexPromisingShouldStop === true)" in tempTab
    if shouldStop is "true" then
      exit repeat
    end if
    set didAdvance to do JavaScript ${quoted(buildClickNextScript())} in tempTab
    if didAdvance is "false" then
      exit repeat
    end if
    delay 1.6
  end repeat

  set finalPayload to do JavaScript ${quoted(finalScript)} in tempTab
  close tempTab
  return pagePayloads & ${quoted("<<<CODEX_FINAL>>>")} & finalPayload
end tell
  `.trim();

  const raw = runAppleScript(script);
  const [pagesPart, finalPart] = raw.split("<<<CODEX_FINAL>>>");
  return {
    pageStats: parsePagePayloads(pagesPart),
    final: JSON.parse(finalPart),
  };
}

function parseMarketBlock(lines, marketLabel) {
  const startIndex = lines.indexOf(marketLabel);
  if (startIndex < 0) return null;
  const block = lines.slice(startIndex, startIndex + 10);
  return {
    market: marketLabel,
    statusLabel: block[1] ?? null,
    recommendedExposure: block[2] ?? null,
    distributionDays: parseNumber(block[5]),
    lastFollowThroughDay: block[7] ?? null,
  };
}

function parseTimeline(lines) {
  const timelineIndex = lines.indexOf("오늘의 타임라인");
  if (timelineIndex < 0) return [];

  const items = [];
  for (let index = timelineIndex + 1; index < lines.length - 1; index += 1) {
    if (!/^\d{2}:\d{2}$/.test(lines[index])) continue;
    const headline = lines[index + 1];
    if (!headline || headline === "전체" || headline === "시황" || headline === "브리핑") {
      continue;
    }
    items.push({ time: lines[index], headline });
    if (items.length >= 8) break;
  }
  return items;
}

function parseSectorRs(lines) {
  const startIndex = lines.indexOf("전체");
  const endIndex = lines.indexOf("12M", startIndex + 1);
  if (startIndex < 0 || endIndex < 0) return [];

  const sectors = [];
  for (let index = startIndex + 1; index < endIndex - 1; index += 2) {
    const sector = lines[index];
    const score = parseNumber(lines[index + 1]);
    if (!sector || typeof score !== "number") continue;
    sectors.push({
      sector,
      score,
      rank: sectors.length + 1,
    });
  }

  return sectors;
}

function parseStockLeaders(lines) {
  const tableStart = lines.findIndex((line) => /^\d+개 종목$/.test(line));
  if (tableStart < 0) return [];

  const leaders = [];
  for (let index = tableStart + 1; index + 4 < lines.length; index += 1) {
    const sector = lines[index];
    const rank = lines[index + 1];
    const name = lines[index + 2];
    const code = lines[index + 3];
    const metrics = lines[index + 4];

    if (!/^\d+$/.test(rank) || !/^\d{6}$/.test(code) || !metrics.includes("\t")) {
      continue;
    }

    const [priceText, changePctText, rsText, rs1mText, rs3mText, rs6mText, mmtText, marketCapLabel] =
      metrics.split(/\t+/);

    leaders.push({
      sector,
      rank: Number(rank),
      name,
      code,
      price: parseNumber(priceText),
      changePct: parseNumber(changePctText),
      rs: parseNumber(rsText),
      rs1m: parseNumber(rs1mText),
      rs3m: parseNumber(rs3mText),
      rs6m: parseNumber(rs6mText),
      mmt: mmtText && mmtText !== "-" ? mmtText : null,
      marketCapLabel: marketCapLabel ?? null,
    });

    if (leaders.length >= 20) break;
    index += 4;
  }

  return leaders;
}

function strategyBias(strategy) {
  const buys = sanitizeNonNegativeCount(strategy?.todayBuyCount) ?? 0;
  const exits = sanitizeNonNegativeCount(strategy?.todayExitCount) ?? 0;
  const pulseScore =
    (strategy?.dayDeltaPct ?? 0) * 0.6 +
    (strategy?.weekDeltaPct ?? 0) * 0.35 +
    buys * 4 -
    exits * 3;

  if (pulseScore >= 10) return "risk-on";
  if (pulseScore <= -4) return "cooling";
  return "selective";
}

function summarizeStrategies(strategies) {
  if (!Array.isArray(strategies) || strategies.length === 0) {
    return {
      overallBias: null,
      strongestName: null,
      strongestWeekDeltaPct: null,
      riskOnCount: 0,
      selectiveCount: 0,
      coolingCount: 0,
    };
  }

  const strongest = [...strategies].sort(
    (left, right) => (right.weekDeltaPct ?? Number.NEGATIVE_INFINITY) - (left.weekDeltaPct ?? Number.NEGATIVE_INFINITY),
  )[0];

  const counts = strategies.reduce(
    (accumulator, strategy) => {
      const bias = strategy.bias ?? strategyBias(strategy);
      if (bias === "risk-on") accumulator.riskOnCount += 1;
      else if (bias === "cooling") accumulator.coolingCount += 1;
      else accumulator.selectiveCount += 1;
      return accumulator;
    },
    {
      riskOnCount: 0,
      selectiveCount: 0,
      coolingCount: 0,
    },
  );

  const overallBias =
    counts.riskOnCount >= 2 ? "risk-on" : counts.coolingCount >= 2 ? "cooling" : "selective";

  return {
    overallBias,
    strongestName: strongest?.name ?? null,
    strongestWeekDeltaPct: strongest?.weekDeltaPct ?? null,
    ...counts,
  };
}

function parseStrategies(lines) {
  const strategies = [
    { key: "momentum_easy", name: "1호 - 모멘텀 Easy" },
    { key: "peak_easy", name: "2호 - 피크 Easy" },
    { key: "value_easy", name: "3호 - 밸류 Easy" },
  ];

  return strategies
    .map((strategy) => {
      const index = lines.indexOf(strategy.name, lines.indexOf("📖 전략실 이용 가이드"));
      if (index < 0) return null;

      return {
        key: strategy.key,
        name: strategy.name,
        style: lines[index + 1] ?? null,
        cumulativeReturnPct: parseNumber(lines[index + 4]),
        dayDeltaPct: parseNumber(lines[index + 5]),
        weekDeltaPct: parseNumber(lines[index + 6]),
        holdingCount: sanitizeNonNegativeCount(parseNumber(lines[index + 8])),
        todayBuyCount: sanitizeNonNegativeCount(parseNumber(lines[index + 10])),
        todayExitCount: sanitizeNonNegativeCount(parseNumber(lines[index + 12])),
        description: lines[index + 13] ?? null,
        bias: null,
      };
    })
    .filter(Boolean)
    .map((strategy) => ({
      ...strategy,
      bias: strategyBias(strategy),
    }));
}

function parseThemeBoard(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      mode: null,
      updatedAtLabel: null,
      refreshLabel: null,
      themes: [],
    };
  }

  const mode =
    lines.find((line) => line.includes("등락률순") || line.includes("전일비순")) ??
    null;
  const updatedAtLabel =
    lines.find((line) => /마지막 갱신|updated\s+\d{2}\/\d{2}\s+\d{2}:\d{2}/i.test(line)) ?? null;
  const refreshLabel =
    lines.find((line) => /자동 갱신/.test(line)) ?? null;

  const themes = [];
  const isThemeHeader = (index) => {
    const line = lines[index];
    if (!line) return null;

    if (/^\d+$/.test(line) && lines[index + 1] && lines[index + 2] === "종목명") {
      return {
        rank: Number(line),
        name: lines[index + 1],
        headerIndex: index + 2,
      };
    }

    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match && lines[index + 1] === "종목명") {
      return {
        rank: Number(match[1]),
        name: match[2],
        headerIndex: index + 1,
      };
    }

    if (
      /^\d+$/.test(line) &&
      lines[index + 1] &&
      typeof lines[index + 2] === "string" &&
      lines[index + 2].includes("종목명") &&
      lines[index + 2].includes("현재가")
    ) {
      return {
        rank: Number(line),
        name: lines[index + 1],
        headerIndex: index + 2,
      };
    }

    return null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const header = isThemeHeader(index);
    if (!header) continue;

    const rows = [];
    let cursor = header.headerIndex + 1;

    while (cursor + 1 < lines.length) {
      if (isThemeHeader(cursor)) break;
      const name = lines[cursor];
      const metricsLine = lines[cursor + 1];
      if (!name || !metricsLine || isThemeHeader(cursor + 1)) break;
      const [priceText, changePctText, rsText, newHighText, prevDayText] = metricsLine.split(/\t+/);

      const price = parseNumber(priceText);
      const rs = parseNumber(rsText);
      const changePct = parseNumber(changePctText);
      const newHighGapPct = parseNumber(newHighText);
      const vsPrevDayPct = parseNumber(prevDayText);

      if (!name || price == null || rs == null) break;

      rows.push({
        name,
        price,
        changePct,
        rs,
        newHighGapPct,
        vsPrevDayPct,
      });

      cursor += 2;
      if (rows.length >= 6) break;
    }

    if (rows.length > 0) {
      themes.push({
        rank: header.rank,
        name: header.name,
        leaders: rows,
      });
    }

    index = Math.max(index, cursor - 1);
    if (themes.length >= 16) break;
  }

  return {
    mode,
    updatedAtLabel,
    refreshLabel,
    themes,
  };
}

function normalizeHeaders(headers) {
  return headers.map((header) => compactLine(header));
}

function findTable(tables, predicate) {
  return (tables ?? []).find((table) => predicate(normalizeHeaders(table.headers ?? []), table));
}

function parseMarketSectorRows(tables) {
  const table = findTable(
    tables,
    (headers) => headers.includes("섹터명") && headers.includes("포지션") && headers.some((item) => item.includes("대표종목")),
  );
  if (!table) return [];

  return (table.rows ?? [])
    .slice(1)
    .map((cells) => ({
      sector: cells[0] ?? null,
      changePct: parseNumber(cells[1]),
      position: cells[2] ?? null,
      signal: cells[3] ?? null,
      gapPct: null,
      baseDateLabel: cells[4] ?? null,
      leaderLabel: cells[5] ?? null,
    }))
    .filter((row) => row.sector);
}

function parseLeadingSectorRows(tables) {
  const table = findTable(
    tables,
    (headers) => headers.includes("섹터명") && headers.includes("유지일") && headers.some((item) => item.includes("대표종목")),
  );
  if (!table) return [];

  return (table.rows ?? [])
    .slice(1)
    .map((cells) => ({
      sector: cells[0] ?? null,
      changePct: parseNumber(cells[1]),
      holdDays: parseNumber(String(cells[2] ?? "").replace(/[^\d.-]/g, "")),
      signal: cells[3] ?? null,
      gapPct: parseNumber(cells[4]),
      returnPct: null,
      leaderLabel: cells[5] ?? null,
    }))
    .filter((row) => row.sector);
}

function parseCompanyReportRows(tables) {
  const table = findTable(
    tables,
    (headers) => headers.includes("일자") && headers.includes("종목명") && headers.includes("제목") && headers.includes("요약"),
  );
  if (!table) return [];

  return (table.rows ?? [])
    .slice(1)
    .map((cells) => {
      const prices = parsePriceTriplet(cells[4] ?? "");
      return {
        date: cells[0] ?? null,
        name: cells[1] ?? null,
        broker: cells[2] ?? null,
        opinion: cells[3] ?? null,
        targetPrice: prices.targetPrice,
        currentPrice: prices.currentPrice,
        gapPct: prices.gapPct,
        change: cells[5] ?? null,
        title: cells[6] ?? null,
        summary: cells[7] ?? null,
        summaryBullets: splitBulletSummary(cells[7] ?? ""),
      };
    })
    .filter((row) => row.date && row.title);
}

function parsePromisingRows(rows) {
  return (rows ?? []).map((row, index) => ({
    sector: row.sector ?? null,
    rank: index + 1,
    sectorRank: parseNumber(row.sectorRank),
    name: row.name ?? null,
    code: row.code ?? null,
    price: parseNumber(row.price),
    changePct: parseNumber(row.changePct),
    rs: parseNumber(row.rs),
    rs1m: parseNumber(row.rs1m),
    rs3m: parseNumber(row.rs3m),
    rs6m: parseNumber(row.rs6m),
    mmt: row.mmt && row.mmt !== "-" ? row.mmt : null,
    marketCapLabel: row.marketCapLabel ?? null,
  }));
}

function summarizePromisingSectors(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const sector = compactLine(row?.sector);
    if (!sector) continue;
    counts.set(sector, (counts.get(sector) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sector, count]) => ({ sector, count }))
    .sort((left, right) => right.count - left.count || left.sector.localeCompare(right.sector));
}

function main() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const targetDateLabel = toMonthDayLabel(captureDate);

  const home = fetchPage("https://stockeasy.intellio.kr/", 280, {
    tableLimit: 2,
    rowLimit: 40,
  });
  const marketSignalPage = fetchPage("https://stockeasy.intellio.kr/market-analysis", 320, {
    tableLimit: 3,
    rowLimit: 60,
  });
  const marketSectorPage = fetchPage("https://stockeasy.intellio.kr/market-analysis", 420, {
    actionTexts: ["섹터"],
    actionDelaySec: 2.1,
    tableLimit: 3,
    rowLimit: 80,
  });
  const marketLeadingPage = fetchPage("https://stockeasy.intellio.kr/market-analysis", 420, {
    actionTexts: ["추세유지"],
    actionDelaySec: 2.1,
    tableLimit: 3,
    rowLimit: 80,
  });
  const marketThemeBoard = fetchPage("https://stockeasy.intellio.kr/market-analysis", 560, {
    actionTexts: ["테마보드"],
    actionDelaySec: 2.2,
    tableLimit: 3,
    rowLimit: 120,
  });

  if (cli.smokeTest) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          title: marketThemeBoard.title,
          href: marketThemeBoard.href,
          sourceTradingDateLabel:
            marketSignalPage.lines.find((line) => /\d{1,2}월\s+\d{1,2}일\s+기준/.test(line)) ?? null,
          marketTabs: {
            sectorAction: marketSectorPage.actionResults?.[0] ?? null,
            leadingAction: marketLeadingPage.actionResults?.[0] ?? null,
            themeAction: marketThemeBoard.actionResults?.[0] ?? null,
          },
          visibleThemeLines: marketThemeBoard.lines.slice(0, 24),
        },
        null,
        2,
      ),
    );
    return;
  }

  const stock = fetchPage("https://stockeasy.intellio.kr/stock-analysis", 520, {
    tableLimit: 3,
    rowLimit: 80,
  });
  const stockReportOverview = fetchPage("https://stockeasy.intellio.kr/stock-analysis", 520, {
    actionTexts: ["리포트"],
    actionDelaySec: 2.1,
    tableLimit: 3,
    rowLimit: 80,
  });
  const strategy = fetchPage("https://stockeasy.intellio.kr/strategy-room", 320, {
    tableLimit: 2,
    rowLimit: 40,
  });

  const sectorRs = parseSectorRs(stock.lines);
  const internalPromisingSectors = deriveInternalPromisingSectors(cli.promisingSectors);
  const matchedPromisingSectors = sectorRs
    .map((item) => item.sector)
    .filter((sector) => internalPromisingSectors.includes(sector));
  const finalPromisingSectors =
    matchedPromisingSectors.length > 0
      ? matchedPromisingSectors
      : sectorRs.slice(0, 6).map((item) => item.sector);

  const promisingCapture = capturePromisingOverallRs(finalPromisingSectors, 100, 80);
  const industryCapture = captureIndustryReports(targetDateLabel ?? captureDate.slice(5), 30);

  const marketDateLabel =
    marketSignalPage.lines.find((line) => /\d{1,2}월\s+\d{1,2}일\s+기준/.test(line)) ?? null;
  const sourceTradingDate = marketDateLabel ? toIsoDate(marketDateLabel, currentYear) : null;
  const shortSignalIndex = marketSignalPage.lines.indexOf("단기");
  const longSignalIndex = marketSignalPage.lines.indexOf("장기");
  const parsedStrategies = parseStrategies(strategy.lines);
  const promisingRows = parsePromisingRows(promisingCapture.final?.rows ?? []);
  const industryRows = (industryCapture.final?.rows ?? []).map((row) => ({
    ...row,
    summaryBullets: Array.isArray(row.summaryBullets) ? row.summaryBullets : splitBulletSummary(row.summary),
  }));

  const marketAnalysis = {
    marketSignal: {
      title: marketSignalPage.title,
      href: marketSignalPage.href,
      shortSignal: shortSignalIndex >= 0 ? marketSignalPage.lines[shortSignalIndex + 1] ?? null : null,
      longSignal: longSignalIndex >= 0 ? marketSignalPage.lines[longSignalIndex + 1] ?? null : null,
      kospi: parseMarketBlock(marketSignalPage.lines, "코스피"),
      kosdaq: parseMarketBlock(marketSignalPage.lines, "코스닥"),
      updatedAtLabel:
        marketSignalPage.lines.find((line) => /^updated\s+\d{2}\/\d{2}\s+\d{2}:\d{2}$/i.test(line)) ?? null,
      rawLines: marketSignalPage.lines,
      rawTables: marketSignalPage.tables,
    },
    sectors: {
      title: marketSectorPage.title,
      href: marketSectorPage.href,
      actionResult: marketSectorPage.actionResults?.[0] ?? null,
      rows: parseMarketSectorRows(marketSectorPage.tables),
      rawLines: marketSectorPage.lines,
      rawTables: marketSectorPage.tables,
    },
    leadingSectors: {
      title: marketLeadingPage.title,
      href: marketLeadingPage.href,
      actionResult: marketLeadingPage.actionResults?.[0] ?? null,
      rows: parseLeadingSectorRows(marketLeadingPage.tables),
      rawLines: marketLeadingPage.lines,
      rawTables: marketLeadingPage.tables,
    },
    themeBoard: {
      title: marketThemeBoard.title,
      href: marketThemeBoard.href,
      actionResult: marketThemeBoard.actionResults?.[0] ?? null,
      ...parseThemeBoard(marketThemeBoard.lines),
      rawLines: marketThemeBoard.lines,
      rawTables: marketThemeBoard.tables,
    },
  };

  const snapshot = {
    source: "stockeasy",
    capturedAt: now.toISOString(),
    captureDate,
    sourceTradingDate,
    sourceTradingDateLabel: marketDateLabel,
    collector: {
      mode: "manual_safari_capture",
      urls: {
        home: home.href,
        marketSignal: marketSignalPage.href,
        marketSector: marketSectorPage.href,
        marketLeading: marketLeadingPage.href,
        marketThemeBoard: marketThemeBoard.href,
        stockOverallRs: stock.href,
        stockReportOverview: stockReportOverview.href,
        strategy: strategy.href,
      },
    },
    home: {
      title: home.title,
      topTimeline: parseTimeline(home.lines),
      rawLines: home.lines,
    },
    marketAnalysis,
    marketSignal: marketAnalysis.marketSignal,
    marketThemes: marketAnalysis.themeBoard,
    stockAnalysis: {
      title: stock.title,
      sectorRs,
      stockLeaders: parseStockLeaders(stock.lines),
      promisingSectors: {
        requested: internalPromisingSectors,
        matched: finalPromisingSectors,
        top100Count: promisingRows.length,
        sectorMix: summarizePromisingSectors(promisingRows),
      },
      promisingSectorTop100: promisingRows,
      overallRsMeta: {
        pageStats: promisingCapture.pageStats,
        totalCollected: promisingCapture.final?.totalCollected ?? promisingRows.length,
        targetCount: 100,
      },
      reports: {
        companyOverview: {
          rows: parseCompanyReportRows(stockReportOverview.tables),
          rawLines: stockReportOverview.lines,
          rawTables: stockReportOverview.tables,
        },
        industry: {
          targetDateLabel: industryCapture.final?.targetDateLabel ?? targetDateLabel,
          rows: industryRows,
          pageStats: industryCapture.pageStats,
          detailMode: "table_summary_only",
        },
      },
      rawLines: stock.lines,
      rawTables: stock.tables,
    },
    strategyRoom: {
      title: strategy.title,
      strategies: parsedStrategies,
      summary: summarizeStrategies(parsedStrategies),
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(`Saved StockEasy snapshot to ${outputPath}`);
  console.log(
    JSON.stringify(
      {
        sourceTradingDate: snapshot.sourceTradingDate,
        marketSectorCount: snapshot.marketAnalysis.sectors.rows.length,
        leadingSectorCount: snapshot.marketAnalysis.leadingSectors.rows.length,
        themeCount: snapshot.marketThemes.themes.length,
        sectorCount: snapshot.stockAnalysis.sectorRs.length,
        leaderCount: snapshot.stockAnalysis.stockLeaders.length,
        promisingTop100Count: snapshot.stockAnalysis.promisingSectorTop100.length,
        industryReportCount: snapshot.stockAnalysis.reports.industry.rows.length,
        strategyCount: snapshot.strategyRoom.strategies.length,
      },
      null,
      2,
    ),
  );
}

main();
