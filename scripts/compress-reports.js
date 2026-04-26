#!/usr/bin/env node
// 수집한 증권사 리포트를 LLM으로 1차 압축해 구조화 JSON으로 저장하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';

loadEnv();

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';
const LOCAL_LLM_BASE_URL =
  process.env.LOCAL_LLM_BASE_URL || process.env.LOCAL_LLM_URL || 'http://192.168.0.218:8080';
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'local';
const LOCAL_LLM_MAX_TEXT_CHARS = Number.parseInt(process.env.LOCAL_LLM_MAX_CHARS ?? '1500', 10);
const LOCAL_LLM_CONCURRENCY = Number.parseInt(process.env.LOCAL_LLM_CONCURRENCY ?? '1', 10);
const LOCAL_LLM_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_LLM_TIMEOUT_MS ?? '120000', 10);
const MAX_TEXT_CHARS = Number.parseInt(process.env.COMPRESS_REPORT_MAX_CHARS ?? '4000', 10);
const MAX_RETRIES = 3;
const CONCURRENCY = 5;
const REQUEST_DELAY_MS = 200;
const INPUT_COST_PER_MTOKEN = Number.parseFloat(
  process.env.ANTHROPIC_INPUT_COST_PER_MTOKEN ?? '0.8',
);
const OUTPUT_COST_PER_MTOKEN = Number.parseFloat(
  process.env.ANTHROPIC_OUTPUT_COST_PER_MTOKEN ?? '4.0',
);

function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    force: false,
  };

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlaceholder(value) {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'sk-ant-xxxxx' || normalized === 'xxxxx';
}

async function callLocalLlm(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_LLM_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${LOCAL_LLM_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: LOCAL_LLM_MODEL,
        max_tokens: 3000,
        temperature: 0,
        // Qwen 계열 로컬 서버에서 reasoning 전용 필드만 내려오는 경우를 방지합니다.
        chat_template_kwargs: { thinking: false },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Local LLM HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message ?? {};
  const text = message.content || message.reasoning_content || '';
  if (!text) {
    throw new Error('Local LLM returned an empty response.');
  }

  return {
    text,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

function makeAnthropicCaller(client) {
  return async (prompt) => {
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    return {
      text: extractTextFromBlocks(response.content),
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      },
    };
  };
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

function stripMarkdownFences(value) {
  return value
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractJsonPayload(value) {
  const stripped = stripMarkdownFences(value);
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1);
  }

  return stripped;
}

function parseStructuredJson(text) {
  return JSON.parse(extractJsonPayload(text));
}

function estimateCost(inputTokens, outputTokens) {
  const inputCost = (inputTokens / 1_000_000) * INPUT_COST_PER_MTOKEN;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOKEN;

  return inputCost + outputCost;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function buildPrompt(templatePath, report, maxChars = MAX_TEXT_CHARS) {
  const template = await fs.readFile(templatePath, 'utf8');
  const excerpt = (report.extracted_text ?? '').slice(0, maxChars);

  return [
    template.trim(),
    '',
    '## 메타데이터',
    `- ID: ${report.id}`,
    `- 제목: ${report.title ?? ''}`,
    `- 증권사: ${report.broker ?? ''}`,
    `- 날짜: ${report.date ?? ''}`,
    `- 카테고리: ${report.category ?? ''}`,
    `- 종목코드: ${report.ticker ?? ''}`,
    `- 종목명: ${report.ticker_name ?? ''}`,
    `- 투자의견: ${report.opinion ?? ''}`,
    `- 목표가: ${report.target_price ?? ''}`,
    '',
    '## 리포트 본문',
    excerpt || '(본문 없음)',
  ].join('\n');
}

async function compressOneReport(callLlm, prompt, report) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const { text, usage } = await callLlm(prompt);
      const parsed = parseStructuredJson(text);

      return {
        ok: true,
        item: {
          id: report.id,
          source_title: report.title,
          source_category: report.category,
          source_pdf_path: report.pdf_path,
          text_length: report.text_length ?? null,
          ...parsed,
        },
        usage,
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(REQUEST_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    item: {
      id: report.id,
      source_title: report.title,
      source_category: report.category,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    },
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

async function runWithConcurrency(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;

  async function consume() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => consume());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let callLlm;
  let usingLocalLlm = false;

  if (isPlaceholder(apiKey)) {
    console.log(`⚠️  ANTHROPIC_API_KEY 없음 → 로컬 LLM 사용 (${LOCAL_LLM_BASE_URL})`);
    callLlm = callLocalLlm;
    usingLocalLlm = true;
  } else {
    const client = new Anthropic({ apiKey });
    callLlm = makeAnthropicCaller(client);
  }

  const effectiveMaxTextChars = usingLocalLlm ? LOCAL_LLM_MAX_TEXT_CHARS : MAX_TEXT_CHARS;
  const effectiveConcurrency = usingLocalLlm ? LOCAL_LLM_CONCURRENCY : CONCURRENCY;
  if (usingLocalLlm) {
    console.log(`- 텍스트 한도: ${effectiveMaxTextChars}자 / 동시 처리: ${effectiveConcurrency}건`);
  }

  const inputPath = path.join(process.cwd(), 'data', 'reports', args.date, 'index.json');
  const outputPath = path.join(process.cwd(), 'data', 'reports', args.date, 'compressed.json');
  const templatePath = path.join(process.cwd(), 'prompts', 'compress-report.md');

  try {
    await fs.access(outputPath);
    if (!args.force) {
      console.log(`- 이미 압축 결과가 있습니다: ${outputPath}`);
      console.log('- 다시 실행하려면 --force 옵션을 사용하세요.');
      return;
    }
  } catch {
    // no-op
  }

  const reports = await readJson(inputPath);
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error(`압축할 리포트가 없습니다: ${inputPath}`);
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const results = await runWithConcurrency(reports, async (report, index) => {
    const prompt = await buildPrompt(templatePath, report, effectiveMaxTextChars);
    const result = await compressOneReport(callLlm, prompt, report);

    totalInputTokens += result.usage.input_tokens;
    totalOutputTokens += result.usage.output_tokens;

    console.log(
      result.ok
        ? `- [${index + 1}/${reports.length}] ${report.title} 압축 완료`
        : `⚠️ [${index + 1}/${reports.length}] ${report.title} 압축 실패: ${result.item.error}`,
    );

    return result.item;
  }, effectiveConcurrency);

  await fs.writeFile(outputPath, JSON.stringify(results, null, 2), 'utf8');

  const estimatedCost = estimateCost(totalInputTokens, totalOutputTokens);
  console.log('✅ 리포트 압축 저장 완료');
  console.log(`📁 ${outputPath}`);
  console.log(`- 총 호출 수: ${reports.length}`);
  console.log(`- 입력 토큰: ${totalInputTokens.toLocaleString()}`);
  console.log(`- 출력 토큰: ${totalOutputTokens.toLocaleString()}`);
  console.log(`- 예상 비용: $${estimatedCost.toFixed(4)}`);
  console.log(`- 사용 모델: ${usingLocalLlm ? `local (${LOCAL_LLM_BASE_URL})` : DEFAULT_MODEL}`);
}

main().catch((error) => {
  console.error(`❌ compress-reports 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
