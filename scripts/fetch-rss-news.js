#!/usr/bin/env node
// RSS 피드에서 최근 24시간 기사를 수집해 일별 뉴스 데이터로 저장하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { config as loadEnv } from 'dotenv';
import fetch from 'node-fetch';
import Parser from 'rss-parser';

loadEnv();

const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT_PER_FEED = 100;
const HIGH_SIGNAL_KEYWORDS = [
  '금리', '인하', '동결', 'fomc', 'fed', 'cpi', 'pce', '물가', '인플레',
  '유가', '원유', '브렌트', 'wti', '호르무즈', '이란', '휴전', 'ceasefire',
  '환율', '달러', 'usdkrw', '원화', '국채', '채권', '수익률곡선', '신용',
  '실적', '가이던스', '영업이익', '매출', '잠정실적', '컨센서스', '목표가',
  '반도체', 'hbm', 'dram', '낸드', '삼성전자', 'sk하이닉스',
  'ai', '데이터센터', '전력', '전력기기', '변압기', '방산', '원자력',
  'etf', '배당', '커버드콜', '금현물', '금선물', '관세', '수출', '경기',
  '코스피', '나스닥', 's&p', 'vix', '공급', '수주', 'smr', '원전',
];
const LOW_SIGNAL_KEYWORDS = [
  '벚꽃', '드라마', '촬영', '뮤직비디오', '안젤리나 졸리', '샤일로', '호텔', '투숙',
  '부활절', '여행', '쿠알라룸푸르', '관람', '박물관', '여사', '금관', '식목일',
  '어린이', '바다 배운다', '생태 프로그램', '반가사유상', '오찬', '국빈방한',
  '유튜버', '연예', '인스타', '유튜브', '브이로그',
];

function parseArgs(argv) {
  const args = { date: todayIso() };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = normalizeDate(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`잘못된 날짜 형식입니다: ${value}`);
  }

  return value;
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function stripHtml(value) {
  return (value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoFromDate(date) {
  return date ? date.toISOString() : null;
}

function sameIsoDate(date, targetDate) {
  return date && date.toISOString().slice(0, 10) === targetDate;
}

function withinLast24Hours(date, now) {
  if (!date) {
    return false;
  }

  return now.getTime() - date.getTime() <= 24 * 60 * 60 * 1000 && date.getTime() <= now.getTime();
}

function canonicalUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = '';
    if (url.hostname.includes('feedproxy.google.com') && url.searchParams.has('url')) {
      return canonicalUrl(url.searchParams.get('url'));
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function containsAnyKeyword(text, keywords) {
  const normalized = (text ?? '').toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function scoreInvestmentRelevance({ title, summary, category, source }) {
  const haystack = `${title ?? ''} ${summary ?? ''} ${category ?? ''} ${source ?? ''}`.trim();
  let score = 0;

  if (containsAnyKeyword(haystack, HIGH_SIGNAL_KEYWORDS)) {
    score += 3;
  }

  if (category === 'ETF' || category === '기술' || category === '글로벌') {
    score += 1;
  }

  if (containsAnyKeyword(haystack, ['실적', '목표가', '가이던스', '금리', '유가', '환율', '반도체', 'etf'])) {
    score += 2;
  }

  if (containsAnyKeyword(haystack, LOW_SIGNAL_KEYWORDS)) {
    score -= 3;
  }

  return score;
}

function isRelevantArticle(entry) {
  const score = scoreInvestmentRelevance(entry);
  const haystack = `${entry.title ?? ''} ${entry.summary ?? ''} ${entry.category ?? ''} ${entry.source ?? ''}`;
  const hasHighSignal = containsAnyKeyword(haystack, HIGH_SIGNAL_KEYWORDS);
  const hasLowSignal = containsAnyKeyword(haystack, LOW_SIGNAL_KEYWORDS);

  if (hasLowSignal && !hasHighSignal) {
    return { keep: false, score };
  }

  if (hasHighSignal) {
    return { keep: true, score };
  }

  if (entry.category === '시황' && score < 3) {
    return { keep: false, score };
  }

  if (score >= 2) {
    return { keep: true, score };
  }

  return { keep: false, score };
}

async function fetchXml(url) {
  const { signal, clear } = createTimeoutSignal(FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    clear();
  }
}

async function loadFeedsConfig() {
  const filePath = path.join(process.cwd(), 'config', 'feeds.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  return Object.values(parsed).flat();
}

async function loadExistingEntries(outputPath) {
  try {
    const raw = await fs.readFile(outputPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) => isRelevantArticle(entry).keep);
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.join(process.cwd(), 'data', 'news', `${args.date}.json`);
  const parser = new Parser({
    customFields: {
      item: ['content:encoded', 'dc:creator'],
    },
  });

  const feeds = await loadFeedsConfig();
  const existingEntries = await loadExistingEntries(outputPath);
  const existingByUrl = new Map(
    existingEntries
      .map((entry) => [canonicalUrl(entry.url), entry])
      .filter(([url]) => Boolean(url)),
  );

  const collectedAt = new Date();
  const allEntries = [...existingEntries];
  let nextId = allEntries.length + 1;

  for (const feed of feeds) {
    try {
      const xml = await fetchXml(feed.url);
      const parsed = await parser.parseString(xml);
      const items = (parsed.items ?? []).slice(0, DEFAULT_LIMIT_PER_FEED);

      let addedCount = 0;

      for (const item of items) {
        const publishedDate =
          toDate(item.isoDate) ??
          toDate(item.pubDate) ??
          toDate(item.published) ??
          toDate(item.created);

        const shouldInclude =
          args.date === todayIso()
            ? withinLast24Hours(publishedDate, collectedAt)
            : sameIsoDate(publishedDate, args.date);

        if (!shouldInclude) {
          continue;
        }

        const url = canonicalUrl(item.link || item.guid);
        if (!url || existingByUrl.has(url)) {
          continue;
        }

        const entry = {
          id: `news_${String(nextId).padStart(3, '0')}`,
          title: stripHtml(item.title),
          source: feed.name,
          category: feed.category,
          url,
          published: isoFromDate(publishedDate),
          summary: stripHtml(item.contentSnippet || item['content:encoded'] || item.content || item.summary || item.description),
          collected_at: collectedAt.toISOString(),
        };

        const relevance = isRelevantArticle(entry);
        if (!relevance.keep) {
          continue;
        }

        entry.relevance_score = relevance.score;

        allEntries.push(entry);
        existingByUrl.set(url, entry);
        nextId += 1;
        addedCount += 1;
      }

      console.log(`- ${feed.name}: ${addedCount}건 추가`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ RSS 피드 스킵 (${feed.name}): ${message}`);
    }
  }

  allEntries.sort((a, b) => new Date(b.published ?? 0).getTime() - new Date(a.published ?? 0).getTime());

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(allEntries, null, 2), 'utf8');

  console.log(`✅ 뉴스 ${allEntries.length}건 저장 완료`);
  console.log(`📁 ${outputPath}`);
}

main().catch((error) => {
  console.error(`❌ fetch-rss-news 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
