#!/usr/bin/env node
// 최근 요약, 포트폴리오, 기술적 분석을 묶어 어드바이저 입력 컨텍스트를 조립하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { formatMarketVoiceForPrompt } from "./lib/marketvoice-utils.js";

const MAX_DAILY_FILES = 7;
const MAX_WEEKLY_FILES = 4;
const MAX_MONTHLY_FILES = 3;
const MAX_SECTION_CHARS = 4000;

function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === '--output' && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (!token.startsWith('--') && !args._dateConsumed) {
      args.date = token;
      args._dateConsumed = true;
    }
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

async function readFileIfExists(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function truncateText(value, limit = MAX_SECTION_CHARS) {
  if (!value) {
    return '';
  }

  return value.length > limit ? `${value.slice(0, limit)}\n...(truncated)` : value;
}

async function listMarkdownFiles(directory, predicate = () => true) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && predicate(entry.name))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch {
    return [];
  }
}

async function loadRecentMarkdownSections(directory, limit, title, predicate = () => true) {
  const files = await listMarkdownFiles(directory, predicate);
  const selected = files.slice(-limit);

  if (selected.length === 0) {
    return `${title}\n- 없음`;
  }

  const blocks = await Promise.all(
    selected.map(async (filePath) => {
      const content = truncateText(await readFileIfExists(filePath, ''));
      return `### ${path.basename(filePath)}\n${content || '(empty)'}`;
    }),
  );

  return `${title}\n${blocks.join('\n\n')}`;
}

function summarizeStrategy(strategy) {
  if (!strategy) {
    return '- 전략 파일이 없습니다.';
  }

  const lines = [
    `- 전략명: ${strategy.name ?? 'N/A'}`,
    `- 기간: ${strategy.period?.start ?? 'N/A'} ~ ${strategy.period?.end ?? 'N/A'}`,
    `- 총 현금: ${strategy.total_cash?.toLocaleString?.() ?? strategy.total_cash ?? 'N/A'}원`,
  ];

  if (strategy.accounts) {
    for (const [account, config] of Object.entries(strategy.accounts)) {
      const allocation = Object.entries(config.target_allocation ?? {})
        .map(([name, pct]) => `${name} ${Math.round(Number(pct) * 100)}%`)
        .join(', ');
      lines.push(
        `- ${account}: 현금 ${config.cash?.toLocaleString?.() ?? config.cash ?? 'N/A'}원 / 목표배분 ${allocation || 'N/A'}`,
      );
    }
  }

  return lines.join('\n');
}

function summarizeDcaPlan(strategy) {
  const plan = strategy?.dca_plan;
  if (!plan?.schedule) {
    return '- DCA 계획이 없습니다.';
  }

  return plan.schedule
    .map(
      (item) =>
        `- ${item.tranche}차: ${(Number(item.pct) * 100).toFixed(0)}% / 목표 ${item.target_date} / 상태 ${item.status}`,
    )
    .join('\n');
}

function summarizePortfolio(portfolio, strategy) {
  if (portfolio) {
    return truncateText(JSON.stringify(portfolio, null, 2), 3000);
  }

  return `최신 포트폴리오 스냅샷이 없어 strategy.json 기준으로 대체합니다.\n${summarizeStrategy(strategy)}`;
}

function summarizeTechnicals(technical) {
  if (!technical?.scores) {
    return '- 오늘 기술적 분석 결과가 없습니다.';
  }

  const marketContext = technical.market_context
    ? [
        `- 시장 컨텍스트: ${technical.market_context.signal}`,
        `- KOSPI score: ${technical.market_context.score ?? 'N/A'}`,
        `- KOSPI RSI: ${technical.market_context.rsi ?? 'N/A'}`,
        `- VIX: ${technical.market_context.vix ?? 'N/A'}`,
      ].join('\n')
    : '- 시장 컨텍스트 없음';

  const topRows = Object.values(technical.scores)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 12)
    .map(
      (item) =>
        `- ${item.name} (${item.code}): ${item.signal} / 점수 ${item.score} / RSI ${item.rsi ?? 'N/A'} / 이유: ${
          item.signal_reason ?? 'N/A'
        }`,
    )
    .join('\n');

  return `${marketContext}\n\n## Top Technical Scorecard\n${topRows}`;
}

function summarizeThemeCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '- 오늘 생성된 테마 ETF 후보가 없습니다.';
  }

  return candidates
    .slice(0, 10)
    .map(
      (item) =>
        `- ${item.name ?? item.code}: 테마 ${item.matched_theme ?? 'N/A'} / 추천 ${item.recommendation ?? 'N/A'}`,
    )
    .join('\n');
}

async function buildPrompt(date) {
  const cwd = process.cwd();
  const templatePath = path.join(cwd, 'prompts', 'daily-advisory.md');
  const strategyPath = path.join(cwd, 'config', 'strategy.json');
  const portfolioLatestPath = path.join(cwd, 'data', 'portfolio', 'latest.json');
  const technicalPath = path.join(cwd, 'data', 'technical', `${date}.json`);
  const todaySynthesisPath = path.join(cwd, 'knowledge', 'daily', `${date}-synthesis.md`);
  const yesterday = new Date(`${date}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);
  const yesterdaySynthesisPath = path.join(cwd, 'knowledge', 'daily', `${yesterdayIso}-synthesis.md`);
  const themeCandidatesPath = path.join(cwd, 'data', 'theme-candidates', `${date}.json`);
  const marketVoicePath = path.join(cwd, 'data', 'analysis-state', date, 'marketvoice-linked.json');

  const [template, strategy, portfolio, technical, todaySynthesis, yesterdaySynthesis, marketVoice] =
    await Promise.all([
      readFileIfExists(templatePath, ''),
      readJsonIfExists(strategyPath, null),
      readJsonIfExists(portfolioLatestPath, null),
      readJsonIfExists(technicalPath, null),
      readFileIfExists(todaySynthesisPath, ''),
      readFileIfExists(yesterdaySynthesisPath, ''),
      readJsonIfExists(marketVoicePath, null),
    ]);

  const [dailyDigests7d, weeklyDigests4w, monthlyDigests3m, themeCandidates] = await Promise.all([
    loadRecentMarkdownSections(
      path.join(cwd, 'knowledge', 'daily'),
      MAX_DAILY_FILES,
      '## Recent Daily Digests',
      (name) => name.endsWith('-digest.md'),
    ),
    loadRecentMarkdownSections(path.join(cwd, 'knowledge', 'weekly'), MAX_WEEKLY_FILES, '## Recent Weekly Reviews'),
    loadRecentMarkdownSections(path.join(cwd, 'knowledge', 'monthly'), MAX_MONTHLY_FILES, '## Recent Monthly Reviews'),
    readJsonIfExists(themeCandidatesPath, []),
  ]);

  const replacements = {
    DATE: date,
    DAILY_DIGESTS_7D: dailyDigests7d,
    WEEKLY_DIGESTS_4W: weeklyDigests4w,
    MONTHLY_DIGESTS_3M: monthlyDigests3m,
    PORTFOLIO: summarizePortfolio(portfolio, strategy),
    STRATEGY: summarizeStrategy(strategy),
    DCA_PLAN: summarizeDcaPlan(strategy),
    TECHNICALS: summarizeTechnicals(technical),
    TODAY_SYNTHESIS: todaySynthesis ? truncateText(todaySynthesis, 4000) : '- 오늘 종합 시황이 없습니다.',
    YESTERDAY_SYNTHESIS: yesterdaySynthesis
      ? truncateText(yesterdaySynthesis, 3000)
      : '- 어제 종합 시황이 없습니다.',
    MARKETVOICE_LINKED: formatMarketVoiceForPrompt(marketVoice, {
      maxTopics: 4,
      maxResearch: 2,
    }),
    THEME_ETF_CANDIDATES: summarizeThemeCandidates(themeCandidates),
  };

  let prompt = template;
  for (const [key, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }

  return prompt;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prompt = await buildPrompt(args.date);

  if (args.output) {
    const outputPath = path.isAbsolute(args.output)
      ? args.output
      : path.join(process.cwd(), args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, prompt, 'utf8');
  }

  process.stdout.write(prompt);
}

main().catch((error) => {
  console.error(`❌ build-context 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
