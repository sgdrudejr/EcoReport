#!/usr/bin/env node
// API 호출 없이 수동 LLM 검토용 일일 시황 종합 프롬프트를 생성합니다.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MAX_REPORTS_PER_SECTOR = 8;
const MAX_NEWS_ITEMS = 20;
const MAX_TWEETS = 20;
const MAX_EXCERPT = 320;

function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (!token.startsWith("--")) {
      args.date = token;
    }
  }

  return args;
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function readFile(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function truncate(value, limit = MAX_EXCERPT) {
  if (!value) {
    return "";
  }
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function formatScenarioBranches(item) {
  if (!Array.isArray(item?.scenario_branches) || item.scenario_branches.length === 0) {
    return "";
  }

  return item.scenario_branches
    .slice(0, 2)
    .map((branch) => {
      const name = branch?.name ?? "Scenario";
      const probability =
        typeof branch?.probability_pct === "number"
          ? ` ${branch.probability_pct}%`
          : "";
      const path = branch?.path ? truncate(branch.path, 90) : "";
      const response = branch?.portfolio_response
        ? ` / 대응 ${truncate(branch.portfolio_response, 90)}`
        : "";
      const narrative = path ? `: ${path}` : "";
      return `${name}${probability}${narrative}${response}`.trim();
    })
    .filter(Boolean)
    .join(" | ");
}

function formatCatalystTimeline(item) {
  if (!Array.isArray(item?.catalyst_timeline) || item.catalyst_timeline.length === 0) {
    return "";
  }

  return item.catalyst_timeline
    .slice(0, 3)
    .map((entry) => {
      const asset = entry?.asset ?? "N/A";
      const timing = entry?.expected_timing ? ` ${entry.expected_timing}` : "";
      const event = entry?.event ? ` ${truncate(entry.event, 70)}` : "";
      return `${asset}${timing}:${event.trim()}`.trim();
    })
    .filter(Boolean)
    .join(", ");
}

function groupReportsBySector(reports) {
  const grouped = new Map();

  for (const report of reports) {
    const sector = report.sector || report.category || "기타";
    const bucket = grouped.get(sector) ?? [];
    bucket.push(report);
    grouped.set(sector, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .map(([sector, items]) => [sector, items.slice(0, MAX_REPORTS_PER_SECTOR)]);
}

function formatCompressedReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    return null;
  }

  const grouped = groupReportsBySector(reports);
  return grouped
    .map(([sector, items]) => {
      const lines = items.map((item) => {
        const tickers =
          Array.isArray(item.tickers) && item.tickers.length > 0
            ? ` (${item.tickers.join(", ")})`
            : "";
        const themes =
          Array.isArray(item.themes) && item.themes.length > 0
            ? ` / 테마: ${item.themes.join(", ")}`
            : "";
        const changed = item.what_changed ? ` / 변화: ${item.what_changed}` : "";
        const numbers = Array.isArray(item.key_numbers) && item.key_numbers.length > 0
          ? ` / 핵심수치: ${item.key_numbers
              .slice(0, 2)
              .map((entry) => `${entry.label ?? "지표"} ${entry.value ?? "N/A"}`)
              .join(", ")}`
          : "";
        const impacts = Array.isArray(item.portfolio_impacts) && item.portfolio_impacts.length > 0
          ? ` / 포트폴리오영향: ${item.portfolio_impacts
              .slice(0, 2)
              .map((impact) => {
                const target = impact.target_name || impact.target_code || impact.account_key || impact.target_type || "N/A";
                const direction = impact.direction ?? "neutral";
                const horizon = impact.horizon ? ` ${impact.horizon}` : "";
                return `${target}:${direction}${horizon}`;
              })
              .join(", ")}`
          : "";
        const scenarios = formatScenarioBranches(item);
        const catalysts = formatCatalystTimeline(item);
        const confidence = item.confidence ? ` / 신뢰도: ${item.confidence}` : "";
        return `- [${item.broker}] ${item.title}${tickers} / 의견: ${item.opinion ?? "N/A"} / 핵심: ${item.key_thesis ?? "N/A"}${changed}${numbers}${themes}${impacts}${scenarios ? ` / 시나리오: ${scenarios}` : ""}${catalysts ? ` / 촉매일정: ${catalysts}` : ""}${confidence}`;
      });

      return `### ${sector}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function formatRawReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    return "- 오늘 수집된 리포트가 없습니다.";
  }

  const grouped = groupReportsBySector(reports);
  return grouped
    .map(([sector, items]) => {
      const lines = items.map((item) => {
        const tickerName = item.ticker_name ? ` (${item.ticker_name})` : "";
        const targetPrice = item.target_price ? ` / 목표가 ${item.target_price}` : "";
        const excerpt = item.extracted_text ? ` / 발췌: ${truncate(item.extracted_text)}` : "";
        return `- [${item.broker}] ${item.title}${tickerName} / ${item.category ?? "기타"}${targetPrice}${excerpt}`;
      });
      return `### ${sector}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function formatNews(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- 오늘 수집된 뉴스가 없습니다.";
  }

  return items
    .slice(0, MAX_NEWS_ITEMS)
    .map(
      (item) =>
        `- [${item.source}] ${item.title} / ${item.category ?? "기타"} / ${truncate(item.summary ?? "", 220)}`.trim(),
    )
    .join("\n");
}

function formatTweets(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- 오늘 수집된 트윗이 없습니다.";
  }

  return items
    .slice(0, MAX_TWEETS)
    .map(
      (item) =>
        `- [@${item.handle}] (${item.category ?? "기타"}, ${item.priority ?? "N/A"}) ${truncate(item.text ?? "", 220)}`.trim(),
    )
    .join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const templatePath = path.join(cwd, "prompts", "daily-synthesis.md");
  const manualCompressedPath = path.join(
    cwd,
    "data",
    "reports",
    args.date,
    "manual-compressed.json",
  );
  const compressedPath = path.join(cwd, "data", "reports", args.date, "compressed.json");
  const rawReportsPath = path.join(cwd, "data", "reports", args.date, "index.json");
  const newsPath = path.join(cwd, "data", "news", `${args.date}.json`);
  const tweetsPath = path.join(cwd, "data", "tweets", `${args.date}.json`);

  const [template, manualCompressedReports, compressedReports, rawReports, news, tweets] = await Promise.all([
    readFile(templatePath, ""),
    readJson(manualCompressedPath, []),
    readJson(compressedPath, []),
    readJson(rawReportsPath, []),
    readJson(newsPath, []),
    readJson(tweetsPath, []),
  ]);

  const prioritizedReports =
    Array.isArray(manualCompressedReports) && manualCompressedReports.length > 0
      ? manualCompressedReports
      : compressedReports;

  const reportsSection =
    formatCompressedReports(prioritizedReports) ?? formatRawReports(rawReports);

  let prompt = template;
  const replacements = {
    DATE: args.date,
    REPORTS_BY_SECTOR: reportsSection,
    NEWS_SUMMARY: formatNews(news),
    TWEETS_SUMMARY: formatTweets(tweets),
  };

  for (const [key, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }

  if (args.output) {
    const outputPath = path.isAbsolute(args.output)
      ? args.output
      : path.join(cwd, args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, prompt, "utf8");
  }

  process.stdout.write(prompt);
}

main().catch((error) => {
  console.error(
    `❌ build-synthesis-prompt 실패: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
