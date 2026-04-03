#!/usr/bin/env node
// 리포트, 뉴스, 트윗을 섹터별로 통합해 일일 시황 종합을 생성하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';

loadEnv();

const DEFAULT_MODEL =
  process.env.ANTHROPIC_SYNTHESIS_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-3-5-sonnet-latest';
const MAX_REPORTS_PER_SECTOR = 12;
const MAX_NEWS_ITEMS = 20;
const MAX_TWEETS = 20;

function parseArgs(argv) {
  const args = { date: new Date().toISOString().slice(0, 10), force: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === '--force') {
      args.force = true;
    }
  }

  return args;
}

function isPlaceholder(value) {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'sk-ant-xxxxx' || normalized === 'xxxxx';
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (fallback !== null) {
      return fallback;
    }
    throw error;
  }
}

function groupReportsBySector(reports) {
  const grouped = new Map();

  for (const report of reports) {
    if (report.error) {
      continue;
    }

    const sector = report.sector || '기타';
    const bucket = grouped.get(sector) ?? [];
    bucket.push(report);
    grouped.set(sector, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .map(([sector, items]) => [sector, items.slice(0, MAX_REPORTS_PER_SECTOR)]);
}

function formatReportsBySector(reports) {
  const grouped = groupReportsBySector(reports);
  if (grouped.length === 0) {
    return '- 오늘 압축된 리포트가 없습니다.';
  }

  return grouped
    .map(([sector, items]) => {
      const lines = items.map((item) => {
        const tickers =
          Array.isArray(item.tickers) && item.tickers.length > 0
            ? ` (${item.tickers.join(', ')})`
            : '';
        const targetChange = item.target_change ? ` / 목표가 ${item.target_change}` : '';
        const themes =
          Array.isArray(item.themes) && item.themes.length > 0
            ? ` / 테마: ${item.themes.join(', ')}`
            : '';
        return `- [${item.broker}] ${item.title}${tickers} / 의견: ${
          item.opinion ?? 'N/A'
        }${targetChange} / 핵심: ${item.key_thesis ?? 'N/A'}${themes}`;
      });

      return `### ${sector}\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

function formatNews(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '- 오늘 수집된 뉴스가 없습니다.';
  }

  return items
    .slice(0, MAX_NEWS_ITEMS)
    .map(
      (item) =>
        `- [${item.source}] ${item.title} / ${item.category ?? '기타'} / ${
          item.summary ?? ''
        }`.trim(),
    )
    .join('\n');
}

function formatTweets(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '- 오늘 수집된 트윗이 없습니다.';
  }

  return items
    .slice(0, MAX_TWEETS)
    .map(
      (item) =>
        `- [@${item.handle}] (${item.category ?? '기타'}, ${item.priority ?? 'N/A'}) ${
          item.text ?? ''
        }`.trim(),
    )
    .join('\n');
}

async function buildPrompt(templatePath, variables) {
  let template = await fs.readFile(templatePath, 'utf8');

  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`{{${key}}}`, value);
  }

  return template;
}

function extractTextFromBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return '';
  }

  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (isPlaceholder(apiKey)) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }

  const templatePath = path.join(process.cwd(), 'prompts', 'daily-synthesis.md');
  const manualCompressedPath = path.join(
    process.cwd(),
    'data',
    'reports',
    args.date,
    'manual-compressed.json',
  );
  const compressedPath = path.join(process.cwd(), 'data', 'reports', args.date, 'compressed.json');
  const newsPath = path.join(process.cwd(), 'data', 'news', `${args.date}.json`);
  const tweetsPath = path.join(process.cwd(), 'data', 'tweets', `${args.date}.json`);
  const outputPath = path.join(process.cwd(), 'knowledge', 'daily', `${args.date}-synthesis.md`);

  try {
    await fs.access(outputPath);
    if (!args.force) {
      console.log(`- 이미 종합 시황 파일이 있습니다: ${outputPath}`);
      console.log('- 다시 실행하려면 --force 옵션을 사용하세요.');
      return;
    }
  } catch {
    // no-op
  }

  const [manualReports, reports, news, tweets] = await Promise.all([
    readJson(manualCompressedPath, []),
    readJson(compressedPath, []),
    readJson(newsPath, []),
    readJson(tweetsPath, []),
  ]);

  const prioritizedReports =
    Array.isArray(manualReports) && manualReports.length > 0
      ? manualReports
      : reports;

  const prompt = await buildPrompt(templatePath, {
    DATE: args.date,
    REPORTS_BY_SECTOR: formatReportsBySector(prioritizedReports),
    NEWS_SUMMARY: formatNews(news),
    TWEETS_SUMMARY: formatTweets(tweets),
  });

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1800,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = extractTextFromBlocks(response.content);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, text, 'utf8');

  console.log('✅ 일일 시황 종합 저장 완료');
  console.log(`📁 ${outputPath}`);
  console.log(`- 사용 모델: ${DEFAULT_MODEL}`);
  console.log(`- 입력 토큰: ${(response.usage?.input_tokens ?? 0).toLocaleString()}`);
  console.log(`- 출력 토큰: ${(response.usage?.output_tokens ?? 0).toLocaleString()}`);
}

main().catch((error) => {
  console.error(`❌ synthesize-daily 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
