#!/usr/bin/env node
// Nitter RSS 또는 RapidAPI를 통해 지정 계정의 최근 트윗을 수집하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { config as loadEnv } from 'dotenv';
import fetch from 'node-fetch';
import Parser from 'rss-parser';

loadEnv();

const FETCH_TIMEOUT_MS = 10_000;
const RAPIDAPI_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_ACCOUNT = 20;

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

function configuredEnv(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'xxxxx' || trimmed.includes('여기에')) {
    return null;
  }

  return trimmed;
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
    return url.toString();
  } catch {
    return value.trim();
  }
}

function isRetweetText(value) {
  const text = (value ?? '').trim().toLowerCase();
  return text.startsWith('rt @') || text.startsWith('rt by @') || text.startsWith('rt by ') || text.includes('retweeted');
}

async function loadConfig() {
  const filePath = path.join(process.cwd(), 'config', 'twitter-accounts.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadExistingEntries(outputPath) {
  try {
    const raw = await fs.readFile(outputPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchText(url, timeoutMs) {
  const { signal, clear } = createTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
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

function parseRapidApiCandidates(payload) {
  const candidates = [];

  const addCandidate = (candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    candidates.push(candidate);
  };

  const stack = [payload];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current || typeof current !== 'object') {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    if ('text' in current || 'full_text' in current || 'created_at' in current) {
      addCandidate(current);
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return candidates;
}

async function fetchViaRapidApi(account) {
  const apiKey = configuredEnv(process.env.RAPIDAPI_KEY);
  const host = configuredEnv(process.env.RAPIDAPI_HOST) ?? 'twitter241.p.rapidapi.com';
  const baseUrl = configuredEnv(process.env.RAPIDAPI_BASE_URL) ?? `https://${host}/user-tweets`;

  if (!apiKey) {
    return [];
  }

  const url = new URL(baseUrl);
  url.searchParams.set('username', account.handle);
  url.searchParams.set('count', String(MAX_ITEMS_PER_ACCOUNT));

  const { signal, clear } = createTimeoutSignal(RAPIDAPI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': host,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rawTweets = parseRapidApiCandidates(payload);

    return rawTweets.map((tweet) => {
      const id =
        tweet.tweet_id ??
        tweet.id_str ??
        tweet.rest_id ??
        tweet.id ??
        null;
      const text = stripHtml(tweet.full_text || tweet.text || tweet.note_tweet?.note_tweet_results?.result?.text);
      const createdAt = toDate(tweet.created_at || tweet.createdAt || tweet.time || tweet.date);
      const urlValue =
        tweet.url ||
        (id ? `https://x.com/${account.handle}/status/${id}` : null);

      return {
        text,
        published: createdAt?.toISOString() ?? null,
        url: canonicalUrl(urlValue),
      };
    });
  } finally {
    clear();
  }
}

async function fetchViaNitter(account, nitterInstance, parser) {
  const url = `${nitterInstance.replace(/\/$/, '')}/${account.handle}/rss`;
  const xml = await fetchText(url, FETCH_TIMEOUT_MS);
  const feed = await parser.parseString(xml);

  return (feed.items ?? []).slice(0, MAX_ITEMS_PER_ACCOUNT).map((item) => {
    const published = toDate(item.isoDate || item.pubDate);
    const text = stripHtml(item.contentSnippet || item['content:encoded'] || item.content || item.title);

    return {
      text,
      published: published?.toISOString() ?? null,
      url: canonicalUrl(item.link || item.guid),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const outputPath = path.join(process.cwd(), 'data', 'tweets', `${args.date}.json`);
  const existingEntries = await loadExistingEntries(outputPath);
  const existingByUrl = new Map(
    existingEntries
      .map((entry) => [canonicalUrl(entry.url), entry])
      .filter(([url]) => Boolean(url)),
  );

  const parser = new Parser({
    customFields: {
      item: ['content:encoded'],
    },
  });

  const now = new Date();
  const nitterInstance = config.nitter_instance;
  const allEntries = [...existingEntries];
  let nextId = allEntries.length + 1;

  for (const account of config.accounts ?? []) {
    let tweets = [];
    let source = 'Nitter RSS';

    try {
      const rapidApiKey = configuredEnv(process.env.RAPIDAPI_KEY);

      if (rapidApiKey) {
        try {
          tweets = await fetchViaRapidApi(account);
          source = 'RapidAPI';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`⚠️ RapidAPI 실패 (${account.handle}): ${message}`);
          tweets = [];
        }
      }

      if (tweets.length === 0) {
        tweets = await fetchViaNitter(account, nitterInstance, parser);
        source = 'Nitter RSS';
      }

      let addedCount = 0;

      for (const tweet of tweets) {
        const publishedDate = toDate(tweet.published);
        const include =
          args.date === todayIso()
            ? withinLast24Hours(publishedDate, now)
            : sameIsoDate(publishedDate, args.date);

        if (!include) {
          continue;
        }

        if (!tweet.url || existingByUrl.has(tweet.url) || isRetweetText(tweet.text) || !tweet.text) {
          continue;
        }

        const entry = {
          id: `tweet_${String(nextId).padStart(3, '0')}`,
          handle: account.handle,
          category: account.category,
          priority: account.priority,
          text: tweet.text,
          published: publishedDate?.toISOString() ?? null,
          url: tweet.url,
          collected_at: now.toISOString(),
          source,
        };

        allEntries.push(entry);
        existingByUrl.set(tweet.url, entry);
        nextId += 1;
        addedCount += 1;
      }

      console.log(`- @${account.handle}: ${addedCount}건 추가 (${source})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ 트윗 수집 스킵 (@${account.handle}): ${message}`);
    }
  }

  allEntries.sort((a, b) => new Date(b.published ?? 0).getTime() - new Date(a.published ?? 0).getTime());

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(allEntries, null, 2), 'utf8');

  console.log(`✅ 트윗 ${allEntries.length}건 저장 완료`);
  console.log(`📁 ${outputPath}`);
}

main().catch((error) => {
  console.error(`❌ fetch-twitter 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
