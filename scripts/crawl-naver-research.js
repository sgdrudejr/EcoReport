#!/usr/bin/env node
// 네이버 증권 리서치 리포트를 크롤링하고 PDF 및 추출 텍스트를 저장하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { config as loadEnv } from 'dotenv';
import fetch from 'node-fetch';
import pdfParse from 'pdf-parse';
import { chromium } from 'playwright';

loadEnv();

const PAGE_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 20_000;
const RETRIES = 3;
const RETRY_DELAY_MS = 5_000;
const PDF_TEXT_LIMIT = 12_000;
const MAX_PAGES = 50;

const CATEGORY_CONFIG = [
  {
    category: '종목분석',
    listUrl: 'https://finance.naver.com/research/company_list.naver',
    detailKind: 'company',
  },
  {
    category: '산업분석',
    listUrl: 'https://finance.naver.com/research/industry_list.naver',
    detailKind: 'industry',
  },
  {
    category: '경제분석',
    listUrl: 'https://finance.naver.com/research/economy_list.naver',
    detailKind: 'economy',
  },
];

function parseArgs(argv) {
  const args = { date: todayIso(), limit: Number.POSITIVE_INFINITY, force: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = normalizeCliDate(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--limit' && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        args.limit = value;
      }
      index += 1;
      continue;
    }

    if (token === '--force') {
      args.force = true;
    }
  }

  return args;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCliDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--date 형식이 잘못되었습니다: ${value} (예: 2026-04-03)`);
  }

  return value;
}

function naverDateToIso(value) {
  const match = value?.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yy, mm, dd] = match;
  return `20${yy}-${mm}-${dd}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeWhitespace(value) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function parseTickerFromHref(href) {
  if (!href) {
    return null;
  }

  const match = href.match(/code=(\d{6})/);
  return match?.[1] ?? null;
}

function parseMoney(value) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number.parseInt(digits, 10) : null;
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
}

async function withRetry(label, task) {
  let lastError;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ ${label} 실패 (${attempt}/${RETRIES}): ${message}`);
      if (attempt < RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

async function ensureBrowser() {
  try {
    const browser = await chromium.launch({ headless: true });
    return browser;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Executable') || message.includes('playwright install')) {
      throw new Error(
        'Playwright Chromium 브라우저가 설치되지 않았습니다. `npx playwright install chromium` 를 먼저 실행해 주세요.',
      );
    }
    throw error;
  }
}

async function extractListRows(page, detailKind) {
  return page.$$eval(
    'table.type_1 tr',
    (rows, kind) => {
      const sanitize = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
      const absolute = (href) => new URL(href, window.location.href).href;
      const parseTicker = (href) => href?.match(/code=(\d{6})/)?.[1] ?? null;
      const results = [];

      for (const row of rows) {
        const pdfLink = row.querySelector('td.file a[href$=".pdf"]');
        const cells = Array.from(row.querySelectorAll('td'));

        if (!pdfLink || cells.length === 0) {
          continue;
        }

        if (kind === 'company' && cells.length >= 5) {
          const stockAnchor = cells[0].querySelector('a.stock_item');
          const titleAnchor = cells[1].querySelector('a[href*="_read.naver"]');

          results.push({
            ticker: parseTicker(stockAnchor?.getAttribute('href') ?? ''),
            ticker_name: sanitize(stockAnchor?.getAttribute('title') || stockAnchor?.textContent),
            title: sanitize(titleAnchor?.textContent),
            detail_url: titleAnchor ? absolute(titleAnchor.getAttribute('href')) : null,
            broker: sanitize(cells[2].textContent),
            pdf_url: absolute(pdfLink.getAttribute('href')),
            date: sanitize(cells[4].textContent),
          });
          continue;
        }

        if (kind === 'industry' && cells.length >= 5) {
          const titleAnchor = cells[1].querySelector('a[href*="_read.naver"]');
          results.push({
            sector: sanitize(cells[0].textContent),
            title: sanitize(titleAnchor?.textContent),
            detail_url: titleAnchor ? absolute(titleAnchor.getAttribute('href')) : null,
            broker: sanitize(cells[2].textContent),
            pdf_url: absolute(pdfLink.getAttribute('href')),
            date: sanitize(cells[4].textContent),
          });
          continue;
        }

        if (kind === 'economy' && cells.length >= 4) {
          const titleAnchor = cells[0].querySelector('a[href*="_read.naver"]');
          results.push({
            title: sanitize(titleAnchor?.textContent),
            detail_url: titleAnchor ? absolute(titleAnchor.getAttribute('href')) : null,
            broker: sanitize(cells[1].textContent),
            pdf_url: absolute(pdfLink.getAttribute('href')),
            date: sanitize(cells[3].textContent),
          });
        }
      }

      return results;
    },
    detailKind,
  );
}

async function collectCategoryRows(browserContext, categoryConfig, targetDate) {
  const page = await browserContext.newPage();
  const collected = [];

  try {
    for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage += 1) {
      const listUrl = `${categoryConfig.listUrl}?page=${currentPage}`;
      await withRetry(`${categoryConfig.category} 목록 ${currentPage}페이지`, async () => {
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        await page.waitForSelector('table.type_1', { timeout: PAGE_TIMEOUT_MS });
      });

      const rawRows = await extractListRows(page, categoryConfig.detailKind);
      if (rawRows.length === 0) {
        break;
      }

      const normalizedRows = rawRows.map((row) => ({
        ...row,
        category: categoryConfig.category,
        date: naverDateToIso(row.date),
      }));

      const pageMatches = normalizedRows.filter((row) => row.date === targetDate);
      const hasOlderRows = normalizedRows.some((row) => row.date && row.date < targetDate);

      collected.push(...pageMatches);

      console.log(`- ${categoryConfig.category} ${currentPage}페이지: ${pageMatches.length}건 수집`);

      if (hasOlderRows || pageMatches.length === 0) {
        break;
      }
    }
  } finally {
    await page.close();
  }

  return collected;
}

async function enrichRows(browserContext, items) {
  if (items.length === 0) {
    return items;
  }

  const detailPage = await browserContext.newPage();

  try {
    for (const item of items) {
      if (!item.detail_url) {
        continue;
      }

      try {
        await withRetry(`상세 메타 ${item.ticker_name || item.title}`, async () => {
          await detailPage.goto(item.detail_url, {
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT_MS,
          });
          await detailPage.waitForSelector('th.view_sbj', { timeout: PAGE_TIMEOUT_MS });
        });

        const meta = await detailPage.evaluate(() => {
          const header = document.querySelector('th.view_sbj');
          const clone = header ? header.cloneNode(true) : null;

          if (clone instanceof HTMLElement) {
            clone.querySelector('span')?.remove();
            clone.querySelector('.source')?.remove();
          }

          const title = clone instanceof HTMLElement ? clone.innerText.replace(/\s+/g, ' ').trim() : null;
          const tickerName = header?.querySelector('span em')?.textContent?.trim() ?? null;
          const sector = header?.querySelector('span em')?.textContent?.trim() ?? null;
          const opinion = document.querySelector('.view_info_1 .coment')?.textContent?.trim() ?? null;
          const targetPrice = document.querySelector('.view_info_1 .money strong')?.textContent?.trim() ?? null;

          return { title, tickerName, sector, opinion, targetPrice };
        });

        item.title = meta.title || item.title;
        if (item.category === '종목분석') {
          item.ticker_name = meta.tickerName || item.ticker_name;
        }

        if (item.category === '산업분석') {
          item.sector = meta.sector || item.sector;
        }

        item.opinion = meta.opinion || null;
        item.target_price = parseMoney(meta.targetPrice);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️ 상세 메타 수집 스킵 (${item.ticker_name || item.title}): ${message}`);
        item.opinion = item.opinion ?? null;
        item.target_price = item.target_price ?? null;
      }
    }
  } finally {
    await detailPage.close();
  }

  return items;
}

async function downloadPdf(url, destinationPath) {
  await withRetry(`PDF 다운로드 ${path.basename(destinationPath)}`, async () => {
    const { signal, clear } = withTimeoutSignal(FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          accept: 'application/pdf,*/*',
          referer: 'https://finance.naver.com/',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(destinationPath, buffer);
    } finally {
      clear();
    }
  });
}

async function extractPdfText(pdfPath) {
  try {
    const buffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(buffer);
    const fullText = sanitizeWhitespace(parsed.text);
    return {
      extracted_text: fullText.slice(0, PDF_TEXT_LIMIT),
      text_length: fullText.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ PDF 텍스트 추출 실패 (${path.basename(pdfPath)}): ${message}`);
    return {
      extracted_text: '',
      text_length: 0,
    };
  }
}

async function buildIndexEntries(targetDate, rows, outputDir, limit) {
  const results = [];
  let sequence = 1;

  for (const row of rows) {
    if (results.length >= limit) {
      break;
    }

    const id = `report_${String(sequence).padStart(3, '0')}`;
    const pdfFileName = `${id}.pdf`;
    const pdfAbsolutePath = path.join(outputDir, pdfFileName);
    const pdfRelativePath = path.join('data', 'reports', targetDate, pdfFileName);

    try {
      await downloadPdf(row.pdf_url, pdfAbsolutePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ PDF 다운로드 스킵 (${row.title}): ${message}`);
      continue;
    }

    const textMeta = await extractPdfText(pdfAbsolutePath);

    results.push({
      id,
      title: row.title,
      broker: row.broker,
      date: targetDate,
      category: row.category,
      ticker: row.ticker ?? null,
      ticker_name: row.ticker_name ?? null,
      opinion: row.opinion ?? null,
      target_price: row.target_price ?? null,
      pdf_path: pdfRelativePath,
      extracted_text: textMeta.extracted_text,
      text_length: textMeta.text_length,
      ...(row.sector ? { sector: row.sector } : {}),
    });

    sequence += 1;
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.join(process.cwd(), 'data', 'reports', args.date);
  const indexPath = path.join(outputDir, 'index.json');

  try {
    if (!args.force) {
      await fs.access(indexPath);
      console.log(`ℹ️ ${args.date} index.json 이 이미 존재해 수집을 건너뜁니다. (--force 로 재실행 가능)`);
      return;
    }
  } catch {
    // no-op
  }

  await fs.mkdir(outputDir, { recursive: true });

  const browser = await ensureBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  });

  try {
    const collectedRows = [];

    for (const categoryConfig of CATEGORY_CONFIG) {
      const categoryRows = await collectCategoryRows(context, categoryConfig, args.date);
      collectedRows.push(...categoryRows);
    }

    await enrichRows(context, collectedRows);

    const sortedRows = collectedRows.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category, 'ko');
      }
      return a.title.localeCompare(b.title, 'ko');
    });

    const entries = await buildIndexEntries(args.date, sortedRows, outputDir, args.limit);
    await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf8');

    console.log(`✅ 리포트 ${entries.length}건 저장 완료`);
    console.log(`📁 ${indexPath}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`❌ crawl-naver-research 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
