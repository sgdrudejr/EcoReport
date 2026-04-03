#!/usr/bin/env node
// 생성된 RAG 코퍼스 SQLite FTS 인덱스를 질의합니다.

import path from 'node:path';
import process from 'node:process';

import Database from 'better-sqlite3';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCliDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--date 형식이 잘못되었습니다: ${value} (예: 2026-04-03)`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    date: todayIso(),
    query: '',
    limit: 8,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = normalizeCliDate(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--query' && argv[index + 1]) {
      args.query = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--limit' && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        args.limit = value;
      }
      index += 1;
    }
  }

  if (!args.query) {
    throw new Error('--query 가 필요합니다.');
  }

  return args;
}

function sanitizeFtsQuery(query) {
  const tokens = String(query ?? '')
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim())
    .filter(Boolean)
    .flatMap((token) => token.split(/\s+/))
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error('유효한 검색 토큰이 없습니다.');
  }

  return tokens.map((token) => `"${token}"`).join(' OR ');
}

function truncate(text, limit = 280) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const dbPath = path.join(rootDir, 'data', 'reports', args.date, 'rag', 'report-rag.db');
  const db = new Database(dbPath, { readonly: true });
  const ftsQuery = sanitizeFtsQuery(args.query);

  const rows = db
    .prepare(
      `
      SELECT
        chunks.chunk_id,
        chunks.report_id,
        reports.title,
        reports.broker,
        reports.category,
        chunks.section_title,
        chunks.page_start,
        chunks.page_end,
        chunks.chunk_type,
        chunks.text,
        bm25(chunks_fts) AS score
      FROM chunks_fts
      JOIN chunks ON chunks.rowid = chunks_fts.rowid
      JOIN reports ON reports.report_id = chunks.report_id
      WHERE chunks_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `,
    )
    .all(ftsQuery, args.limit);

  for (const row of rows) {
    console.log(`[${row.report_id}] ${row.title}`);
    console.log(`- ${row.broker} / ${row.category} / ${row.section_title} / p.${row.page_start}-${row.page_end} / ${row.chunk_type}`);
    console.log(`- score: ${row.score}`);
    console.log(`- ${truncate(row.text)}`);
    console.log('');
  }

  db.close();
}

main();
