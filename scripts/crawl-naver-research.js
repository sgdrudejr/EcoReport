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
const TRANSIENT_NETWORK_RETRY_DELAY_MS = 15_000;
const PDF_TEXT_LIMIT = 12_000;
const MAX_PAGES = (() => {
  const raw = Number.parseInt(process.env.NAVER_MAX_PAGES ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 300;
})();
const NAVER_FINANCE_BASE = 'https://finance.naver.com/';
const NAVER_RESEARCH_BASE = 'https://finance.naver.com/research/';
const NAVER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const NAVER_HTML_DECODER = new TextDecoder('euc-kr');

const CATEGORY_CONFIG = [
  {
    source: '네이버증권',
    category: '종목분석',
    listUrl: 'https://finance.naver.com/research/company_list.naver',
    detailKind: 'company',
  },
  {
    source: '네이버증권',
    category: '산업분석',
    listUrl: 'https://finance.naver.com/research/industry_list.naver',
    detailKind: 'industry',
  },
  {
    source: '네이버증권',
    category: '경제분석',
    listUrl: 'https://finance.naver.com/research/economy_list.naver',
    detailKind: 'economy',
  },
  {
    source: '네이버증권',
    category: '시황정보',
    listUrl: 'https://finance.naver.com/research/market_info_list.naver',
    detailKind: 'simple',
  },
  {
    source: '네이버증권',
    category: '투자전략',
    listUrl: 'https://finance.naver.com/research/invest_list.naver',
    detailKind: 'simple',
  },
  {
    source: '네이버증권',
    category: '채권분석',
    listUrl: 'https://finance.naver.com/research/debenture_list.naver',
    detailKind: 'simple',
  },
];

const SHINHAN_LIST_API = 'https://www.shinhansec.com/siw/etc/browse/search05/data.do';
const SHINHAN_PDF_BASE = 'https://bbs2.shinhansec.com';

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

function absoluteUrl(href, baseUrl = NAVER_RESEARCH_BASE) {
  if (!href) {
    return null;
  }

  return new URL(href, baseUrl).href;
}

function decodeHtmlEntities(value) {
  if (!value) {
    return '';
  }

  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    middot: '·',
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
    hellip: '...',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const normalized = String(code).toLowerCase();
    if (normalized.startsWith('#x')) {
      const point = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    if (normalized.startsWith('#')) {
      const point = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return named[normalized] ?? entity;
  });
}

function htmlToText(value) {
  return sanitizeWhitespace(
    decodeHtmlEntities(
      value
        ?.replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]+>/g, ' ') ?? '',
    ),
  );
}

function extractResearchTableRows(html) {
  const match =
    html.match(
      /<table[^>]*(?:summary="[^"]*게시판 글목록[^"]*"[^>]*class="type_1"|class="type_1"[^>]*summary="[^"]*게시판 글목록[^"]*")[^>]*>[\s\S]*?<\/table>/i,
    ) ??
    html.match(/<table[^>]*class="type_1"[^>]*>[\s\S]*?<\/table>/i);

  return match?.[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
}

function extractCells(rowHtml) {
  return Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (match) => match[1]);
}

function extractFirstAnchor(html, baseUrl = NAVER_RESEARCH_BASE) {
  const match = html.match(/<a\b[^>]*href="([^"]+)"[^>]*?(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/i);
  if (!match) {
    return null;
  }

  return {
    href: absoluteUrl(match[1], baseUrl),
    titleAttr: decodeHtmlEntities(match[2] ?? ''),
    text: htmlToText(match[3]),
  };
}

function extractPdfUrl(html, baseUrl = NAVER_RESEARCH_BASE) {
  const match = html.match(/<a\b[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>/i);
  return match ? absoluteUrl(match[1], baseUrl) : null;
}

function parseListRowFromHtml(rowHtml, detailKind) {
  const cells = extractCells(rowHtml);
  if (cells.length === 0) {
    return null;
  }

  if (detailKind === 'company' && cells.length >= 5) {
    const stockAnchor = extractFirstAnchor(cells[0], NAVER_FINANCE_BASE);
    const titleAnchor = extractFirstAnchor(cells[1]);
    const pdfUrl = extractPdfUrl(cells[3]);
    if (!stockAnchor || !titleAnchor || !pdfUrl) {
      return null;
    }

    return {
      ticker: parseTickerFromHref(stockAnchor.href),
      ticker_name: stockAnchor.titleAttr || stockAnchor.text || null,
      title: titleAnchor.text,
      detail_url: titleAnchor.href,
      broker: htmlToText(cells[2]),
      pdf_url: pdfUrl,
      date: htmlToText(cells[4]),
    };
  }

  if (detailKind === 'industry' && cells.length >= 5) {
    const titleAnchor = extractFirstAnchor(cells[1]);
    const pdfUrl = extractPdfUrl(cells[3]);
    if (!titleAnchor || !pdfUrl) {
      return null;
    }

    return {
      sector: htmlToText(cells[0]),
      title: titleAnchor.text,
      detail_url: titleAnchor.href,
      broker: htmlToText(cells[2]),
      pdf_url: pdfUrl,
      date: htmlToText(cells[4]),
    };
  }

  if ((detailKind === 'economy' || detailKind === 'simple') && cells.length >= 4) {
    const titleAnchor = extractFirstAnchor(cells[0]);
    const pdfUrl = extractPdfUrl(cells[2]);
    if (!titleAnchor || !pdfUrl) {
      return null;
    }

    return {
      title: titleAnchor.text,
      detail_url: titleAnchor.href,
      broker: htmlToText(cells[1]),
      pdf_url: pdfUrl,
      date: htmlToText(cells[3]),
    };
  }

  return null;
}

function parseTickerFromHref(href) {
  if (!href) {
    return null;
  }

  const match = href.match(/code=([0-9A-Z]{6})/i);
  return match?.[1] ?? null;
}

function parseMoney(value) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number.parseInt(digits, 10) : null;
}

function incrementCounter(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function counterEntries(map) {
  return Object.fromEntries(
    Array.from(map.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ko')),
  );
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
}

function isLikelyTransientNetworkError(error) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return [
    'enotfound',
    'eai_again',
    'econnreset',
    'ecanceled',
    'etimedout',
    'timeout',
    'the operation was aborted',
    'fetch failed',
    'dns',
  ].some((token) => message.includes(token));
}

function retryDelayMsFor(error, attempt) {
  const multiplier = Math.max(attempt, 1);
  if (isLikelyTransientNetworkError(error)) {
    return TRANSIENT_NETWORK_RETRY_DELAY_MS * multiplier;
  }
  return RETRY_DELAY_MS * multiplier;
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
        await sleep(retryDelayMsFor(error, attempt));
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

        if ((kind === 'economy' || kind === 'simple') && cells.length >= 4) {
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

async function collectCategoryRows(browserContext, categoryConfig, targetDate, crawlStats) {
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
        source: categoryConfig.source,
        category: categoryConfig.category,
        date: naverDateToIso(row.date),
      }));

      const pageMatches = normalizedRows.filter((row) => row.date === targetDate);
      const hasOlderRows = normalizedRows.some((row) => row.date && row.date < targetDate);

      collected.push(...pageMatches);
      crawlStats.pageLogs.push({
        source: categoryConfig.source,
        category: categoryConfig.category,
        page: currentPage,
        matchedCount: pageMatches.length,
        totalRowsOnPage: normalizedRows.length,
      });

      console.log(`- ${categoryConfig.category} ${currentPage}페이지: ${pageMatches.length}건 수집`);

      // 페이지는 최신 -> 과거 순으로 정렬된다.
      // targetDate보다 더 오래된 날짜가 등장하면 이후 페이지는 전부 더 과거이므로 종료한다.
      // 단순히 "현재 페이지에 매칭이 없음"만으로는 종료하면 안 된다
      // (아직 targetDate에 도달하기 전의 최신 구간일 수 있음).
      if (hasOlderRows) {
        break;
      }
    }
  } finally {
    await page.close();
  }

  return collected;
}

async function fetchDecodedText(url, { decoder = null, referer = undefined } = {}) {
  const { signal, clear } = withTimeoutSignal(FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'user-agent': NAVER_USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(referer ? { referer } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!decoder) {
      return buffer.toString('utf8');
    }

    return decoder.decode(buffer);
  } finally {
    clear();
  }
}

async function fetchNaverHtml(url, referer = undefined) {
  return fetchDecodedText(url, {
    decoder: NAVER_HTML_DECODER,
    referer,
  });
}

async function collectCategoryRowsWithoutBrowser(categoryConfig, targetDate, crawlStats) {
  const collected = [];

  for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage += 1) {
    const listUrl = `${categoryConfig.listUrl}?page=${currentPage}`;
    const html = await withRetry(`${categoryConfig.category} 목록 ${currentPage}페이지`, async () =>
      fetchNaverHtml(listUrl, categoryConfig.listUrl),
    );

    const rawRows = extractResearchTableRows(html)
      .map((rowHtml) => parseListRowFromHtml(rowHtml, categoryConfig.detailKind))
      .filter(Boolean);

    if (rawRows.length === 0) {
      break;
    }

    const normalizedRows = rawRows.map((row) => ({
      ...row,
      source: categoryConfig.source,
      category: categoryConfig.category,
      date: naverDateToIso(row.date),
    }));

    const pageMatches = normalizedRows.filter((row) => row.date === targetDate);
    const hasOlderRows = normalizedRows.some((row) => row.date && row.date < targetDate);

    collected.push(...pageMatches);
    crawlStats.pageLogs.push({
      source: categoryConfig.source,
      category: categoryConfig.category,
      page: currentPage,
      matchedCount: pageMatches.length,
      totalRowsOnPage: normalizedRows.length,
    });

    console.log(`- ${categoryConfig.category} ${currentPage}페이지: ${pageMatches.length}건 수집`);

    // 페이지는 최신 -> 과거 순으로 정렬된다.
    // targetDate보다 더 오래된 날짜가 등장하면 이후 페이지는 전부 더 과거이므로 종료한다.
    // 단순히 "현재 페이지에 매칭이 없음"만으로는 종료하면 안 된다
    // (아직 targetDate에 도달하기 전의 최신 구간일 수 있음).
    if (hasOlderRows) {
      break;
    }
  }

  return collected;
}

function parseDetailMetaFromHtml(html) {
  const headerHtml = html.match(/<th[^>]*class="view_sbj"[^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? '';
  const labelHtml = headerHtml.match(/<span>\s*<em>([\s\S]*?)<\/em>\s*<\/span>/i)?.[1] ?? '';
  const titleHtml = headerHtml
    .replace(/<p\b[^>]*class="source"[^>]*>[\s\S]*?<\/p>/i, ' ')
    .replace(/<span[\s\S]*?<\/span>/i, ' ');
  const targetPriceHtml =
    html.match(/<em\b[^>]*class="money"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/i)?.[1] ?? '';
  const opinionHtml = html.match(/<em\b[^>]*class="coment"[^>]*>([\s\S]*?)<\/em>/i)?.[1] ?? '';

  return {
    title: htmlToText(titleHtml) || null,
    label: htmlToText(labelHtml) || null,
    opinion: htmlToText(opinionHtml) || null,
    targetPrice: parseMoney(htmlToText(targetPriceHtml)),
  };
}

async function enrichRowsWithoutBrowser(items) {
  if (items.length === 0) {
    return items;
  }

  for (const item of items) {
    if (!item.detail_url || item.source === '신한투자증권') {
      continue;
    }

    try {
      const html = await withRetry(`상세 메타 ${item.ticker_name || item.title}`, async () =>
        fetchNaverHtml(item.detail_url, NAVER_RESEARCH_BASE),
      );
      const meta = parseDetailMetaFromHtml(html);

      item.title = meta.title || item.title;
      if (item.category === '종목분석') {
        item.ticker_name = meta.label || item.ticker_name;
      }

      if (item.category === '산업분석') {
        item.sector = meta.label || item.sector;
      }

      item.opinion = meta.opinion ?? null;
      item.target_price = meta.targetPrice ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ 상세 메타 수집 스킵 (${item.ticker_name || item.title}): ${message}`);
      item.opinion = item.opinion ?? null;
      item.target_price = item.target_price ?? null;
    }
  }

  return items;
}

function shinhanDateToIso(value) {
  const match = value?.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yyyy, mm, dd] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeShinhanCategory(item) {
  const boardTitle = sanitizeWhitespace(item.BOARD_TITLE);
  if (boardTitle === '기업분석') return '종목분석';
  if (boardTitle === '산업분석') return '산업분석';
  if (boardTitle === '경제') return '경제분석';
  if (boardTitle === '채권/신용분석') return '채권분석';
  if (boardTitle === '투자전략') return '투자전략';
  if (boardTitle === '주식전략/시황') return '시황정보';
  return boardTitle || '신한리서치';
}

function shinhanPdfUrl(item) {
  if (!item?.ATTACHMENT_ID) {
    return null;
  }

  return `${SHINHAN_PDF_BASE}/board/message/file.pdf.do?attachmentId=${item.ATTACHMENT_ID}`;
}

async function fetchShinhanRows(targetDate) {
  const collected = [];
  const pageSize = 100;
  const pageLogs = [];

  for (let startCount = 0; startCount < 2_000; startCount += pageSize) {
    const body = new URLSearchParams({
      startCount: String(startCount),
      listCount: String(pageSize),
      query: '',
      searchType: 'A',
      boardCode: '',
    });

    const payload = await withRetry(`신한 리서치 API ${startCount}`, async () => {
      const { signal, clear } = withTimeoutSignal(FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(SHINHAN_LIST_API, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body,
          signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
      } finally {
        clear();
      }
    });

    const items = payload?.body?.collectionList?.find((entry) => entry.thisCollection === 'researchFinder')?.itemList ?? [];
    if (items.length === 0) {
      break;
    }

    const normalized = items
      .filter((item) => String(item.ATTACHMENT_COUNT || '0') !== '0' && String(item.EXT || '').toLowerCase() === 'pdf')
      .map((item) => ({
        source: '신한투자증권',
        category: normalizeShinhanCategory(item),
        title: sanitizeWhitespace(item.TITLE),
        broker: '신한투자증권',
        date: shinhanDateToIso(item.DATE),
        pdf_url: shinhanPdfUrl(item),
        detail_url: `${SHINHAN_PDF_BASE}/siw/board/message/view.file.pop.do?boardName=${encodeURIComponent(item.BOARD_NAME)}&messageId=${encodeURIComponent(item.DOCID)}`,
        ticker: parseTickerFromHref(item.VARIABLE_FIELD_NAME1) ?? null,
        ticker_name: sanitizeWhitespace(item.VARIABLE_FIELD_NAME4) || null,
        opinion: null,
        target_price: null,
        board_name: item.BOARD_NAME,
        attachment_id: item.ATTACHMENT_ID,
      }));

    const pageMatches = normalized.filter((item) => item.date === targetDate);
    const hasOlderRows = normalized.some((item) => item.date && item.date < targetDate);

    console.log(`- 신한투자증권 API ${startCount / pageSize + 1}페이지: ${pageMatches.length}건 수집`);
    pageLogs.push({
      source: '신한투자증권',
      category: '전체',
      page: startCount / pageSize + 1,
      matchedCount: pageMatches.length,
      totalRowsOnPage: normalized.length,
    });
    collected.push(...pageMatches);

    if (hasOlderRows || pageMatches.length === 0) {
      break;
    }
  }

  return { rows: collected, pageLogs };
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.pdf_url || row.detail_url || `${row.category}|${row.broker}|${row.title}|${row.date}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

      if (item.source === '신한투자증권') {
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
          'user-agent': NAVER_USER_AGENT,
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

async function buildIndexEntries(targetDate, rows, outputDir, limit, crawlStats) {
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
      crawlStats.downloadFailures.push({
        source: row.source ?? '알 수 없음',
        category: row.category,
        broker: row.broker,
        title: row.title,
        pdf_url: row.pdf_url,
        error: message,
      });
      continue;
    }

    const textMeta = await extractPdfText(pdfAbsolutePath);

    results.push({
      id,
      title: row.title,
      broker: row.broker,
      source: row.source ?? '알 수 없음',
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

async function writeCrawlManifest(targetDate, outputDir, crawlStats, entries) {
  const sourceCounts = new Map();
  const categoryCounts = new Map();
  const brokerCounts = new Map();

  for (const entry of entries) {
    incrementCounter(sourceCounts, entry.source ?? '알 수 없음');
    incrementCounter(categoryCounts, entry.category ?? '미분류');
    incrementCounter(brokerCounts, entry.broker ?? '알 수 없음');
  }

  const manifest = {
    date: targetDate,
    generated_at: new Date().toISOString(),
    input_sources: [
      ...CATEGORY_CONFIG.map((config) => ({
        source: config.source,
        category: config.category,
        list_url: config.listUrl,
      })),
      {
        source: '신한투자증권',
        category: '전체',
        list_url: 'https://www.shinhansec.com/siw/insights/research/list/view-popup.do',
        api_url: SHINHAN_LIST_API,
      },
    ],
    page_logs: crawlStats.pageLogs,
    category_failures: crawlStats.categoryFailures,
    total_matched_before_dedupe: crawlStats.totalMatchedBeforeDedupe,
    total_unique_after_dedupe: crawlStats.totalUniqueAfterDedupe,
    downloaded_count: entries.length,
    failed_download_count: crawlStats.downloadFailures.length,
    source_counts: counterEntries(sourceCounts),
    category_counts: counterEntries(categoryCounts),
    top_brokers: counterEntries(brokerCounts),
    download_failures: crawlStats.downloadFailures,
  };

  const manifestPath = path.join(outputDir, 'crawl-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const markdownLines = [
    `# ${targetDate} 리포트 수집 매니페스트`,
    '',
    `- 생성 시각: ${manifest.generated_at}`,
    `- 매칭 건수(중복 제거 전): ${manifest.total_matched_before_dedupe}`,
    `- 저장 건수(중복 제거 후/PDF 다운로드 성공): ${manifest.downloaded_count}`,
    `- 다운로드 실패: ${manifest.failed_download_count}`,
    `- 카테고리/소스 실패: ${manifest.category_failures.length}`,
    '',
    '## 출처별 건수',
    ...Object.entries(manifest.source_counts).map(([key, value]) => `- ${key}: ${value}건`),
    '',
    '## 카테고리별 건수',
    ...Object.entries(manifest.category_counts).map(([key, value]) => `- ${key}: ${value}건`),
    '',
    '## 상위 증권사',
    ...Object.entries(manifest.top_brokers)
      .slice(0, 20)
      .map(([key, value]) => `- ${key}: ${value}건`),
    '',
    '## 페이지 로그',
    ...manifest.page_logs.map(
      (pageLog) =>
        `- ${pageLog.source} / ${pageLog.category} / ${pageLog.page}페이지: ${pageLog.matchedCount}건 (페이지 원본 ${pageLog.totalRowsOnPage}건)`,
    ),
  ];

  if (manifest.category_failures.length > 0) {
    markdownLines.push('', '## 카테고리/소스 실패');
    markdownLines.push(
      ...manifest.category_failures.map(
        (failure) => `- ${failure.source} / ${failure.category}: ${failure.error}`,
      ),
    );
  }

  if (manifest.download_failures.length > 0) {
    markdownLines.push('', '## 다운로드 실패');
    markdownLines.push(
      ...manifest.download_failures.map(
        (failure) => `- ${failure.source} / ${failure.category} / ${failure.title} / ${failure.error}`,
      ),
    );
  }

  const markdownPath = path.join(outputDir, 'crawl-manifest.md');
  await fs.writeFile(markdownPath, markdownLines.join('\n'), 'utf8');
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

  let browser = null;
  let context = null;
  let useBrowser = false;

  try {
    browser = await ensureBrowser();
    context = await browser.newContext({
      userAgent: NAVER_USER_AGENT,
    });
    useBrowser = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ Playwright 브라우저 실행 실패, fetch 폴백으로 계속합니다: ${message}`);
    try {
      await context?.close();
    } catch {
      // no-op
    }
    try {
      await browser?.close();
    } catch {
      // no-op
    }
    browser = null;
    context = null;
  }

  try {
    const collectedRows = [];
    const crawlStats = {
      pageLogs: [],
      downloadFailures: [],
      categoryFailures: [],
      totalMatchedBeforeDedupe: 0,
      totalUniqueAfterDedupe: 0,
    };

    for (const categoryConfig of CATEGORY_CONFIG) {
      let categoryRows = [];

      if (useBrowser) {
        try {
          categoryRows = await collectCategoryRows(context, categoryConfig, args.date, crawlStats);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`⚠️ ${categoryConfig.category} 브라우저 수집 실패, fetch 폴백으로 전환합니다: ${message}`);
          crawlStats.categoryFailures.push({
            source: categoryConfig.source,
            category: categoryConfig.category,
            mode: 'browser',
            error: message,
          });

          try {
            categoryRows = await collectCategoryRowsWithoutBrowser(categoryConfig, args.date, crawlStats);
          } catch (fallbackError) {
            const fallbackMessage =
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            console.warn(`⚠️ ${categoryConfig.category} fetch 폴백도 실패했습니다: ${fallbackMessage}`);
            crawlStats.categoryFailures.push({
              source: categoryConfig.source,
              category: categoryConfig.category,
              mode: 'fetch',
              error: fallbackMessage,
            });
            categoryRows = [];
          }
        }
      } else {
        try {
          categoryRows = await collectCategoryRowsWithoutBrowser(categoryConfig, args.date, crawlStats);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`⚠️ ${categoryConfig.category} fetch 수집 실패, 다음 카테고리로 진행합니다: ${message}`);
          crawlStats.categoryFailures.push({
            source: categoryConfig.source,
            category: categoryConfig.category,
            mode: 'fetch',
            error: message,
          });
          categoryRows = [];
        }
      }

      collectedRows.push(...categoryRows);
    }

    try {
      const shinhanResult = await fetchShinhanRows(args.date);
      collectedRows.push(...shinhanResult.rows);
      crawlStats.pageLogs.push(...shinhanResult.pageLogs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ 신한투자증권 수집 실패, 다른 소스 결과로 계속합니다: ${message}`);
      crawlStats.categoryFailures.push({
        source: '신한투자증권',
        category: '전체',
        mode: 'api',
        error: message,
      });
    }

    if (collectedRows.length === 0) {
      const reasons = crawlStats.categoryFailures
        .map((failure) => `${failure.source}/${failure.category}:${failure.error}`)
        .join(' | ');
      throw new Error(reasons || '수집 가능한 리포트가 없습니다.');
    }

    if (useBrowser) {
      await enrichRows(context, collectedRows);
    } else {
      await enrichRowsWithoutBrowser(collectedRows);
    }
    crawlStats.totalMatchedBeforeDedupe = collectedRows.length;

    const uniqueRows = dedupeRows(collectedRows);
    crawlStats.totalUniqueAfterDedupe = uniqueRows.length;
    const sortedRows = uniqueRows.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category, 'ko');
      }
      return a.title.localeCompare(b.title, 'ko');
    });

    const entries = await buildIndexEntries(args.date, sortedRows, outputDir, args.limit, crawlStats);
    await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf8');
    await writeCrawlManifest(args.date, outputDir, crawlStats, entries);

    console.log(`✅ 리포트 ${entries.length}건 저장 완료`);
    console.log(`📁 ${indexPath}`);
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(`❌ crawl-naver-research 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
