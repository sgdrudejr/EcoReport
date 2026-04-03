#!/usr/bin/env node
// 병렬 RAG 코퍼스(SQLite FTS)를 질의합니다.

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
    sourceType: '',
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
      continue;
    }
    if (token === '--source-type' && argv[index + 1]) {
      args.sourceType = argv[index + 1];
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
  const dbPath = path.join(rootDir, 'knowledge', 'rag', args.date, 'parallel-rag.db');
  const db = new Database(dbPath, { readonly: true });
  const ftsQuery = sanitizeFtsQuery(args.query);

  const sql = `
    SELECT
      chunks.chunk_id,
      chunks.source_type,
      chunks.report_id,
      chunks.report_title,
      chunks.account_key,
      chunks.account_label,
      chunks.holding_code,
      chunks.holding_name,
      chunks.section_title,
      chunks.chunk_type,
      chunks.text,
      bm25(chunks_fts) AS score
    FROM chunks_fts
    JOIN chunks ON chunks.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
      ${args.sourceType ? 'AND chunks.source_type = ?' : ''}
    ORDER BY score
    LIMIT ?
  `;
  const rows = args.sourceType
    ? db.prepare(sql).all(ftsQuery, args.sourceType, args.limit)
    : db.prepare(sql).all(ftsQuery, args.limit);

  for (const row of rows) {
    const subject =
      row.source_type === 'portfolio'
        ? `${row.account_label ?? '계좌'}${row.holding_name ? ` / ${row.holding_name}` : ''}`
        : `${row.report_title ?? row.report_id}`;
    console.log(`[${row.source_type}] ${subject}`);
    console.log(`- ${row.section_title} / ${row.chunk_type} / score ${row.score}`);
    console.log(`- ${truncate(row.text)}`);
    console.log('');
  }

  db.close();
}

main();
