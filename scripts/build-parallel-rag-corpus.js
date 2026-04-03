#!/usr/bin/env node
// 리포트 청크와 포트폴리오 청크를 병렬 코퍼스로 결합합니다.

import fs from 'node:fs/promises';
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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = normalizeCliDate(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function initDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    DROP TABLE IF EXISTS chunks_fts;
    DROP TABLE IF EXISTS chunks;

    CREATE TABLE chunks (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      source_type TEXT NOT NULL,
      report_id TEXT,
      report_title TEXT,
      portfolio_date TEXT,
      account_key TEXT,
      account_label TEXT,
      holding_code TEXT,
      holding_name TEXT,
      sequence INTEGER,
      section_title TEXT,
      chunk_type TEXT,
      char_length INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      text TEXT NOT NULL,
      keywords TEXT,
      metadata_json TEXT
    );

    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text,
      section_title,
      keywords,
      content='chunks',
      content_rowid='rowid',
      tokenize='unicode61'
    );
  `);
  return db;
}

function buildMergedMarkdown(reportChunks, portfolioChunks) {
  const lines = ['# EcoReport Parallel Corpus', '', '## Portfolio Chunks', ''];
  for (const chunk of portfolioChunks) {
    lines.push(`### [${chunk.chunk_id}] ${chunk.section_title}`);
    lines.push(`- source: portfolio`);
    if (chunk.account_label) lines.push(`- account: ${chunk.account_label} (${chunk.account_key})`);
    if (chunk.holding_name) lines.push(`- holding: ${chunk.holding_name}${chunk.holding_code ? ` (${chunk.holding_code})` : ''}`);
    lines.push('');
    lines.push(chunk.text);
    lines.push('');
  }

  lines.push('## Report Chunks', '');
  for (const chunk of reportChunks) {
    lines.push(`### [${chunk.chunk_id}] ${chunk.section_title}`);
    lines.push(`- source: report`);
    lines.push(`- report: ${chunk.report_title ?? chunk.report_id}`);
    if (chunk.broker || chunk.category) {
      lines.push(`- meta: ${[chunk.broker, chunk.category].filter(Boolean).join(' / ')}`);
    }
    lines.push('');
    lines.push(chunk.text);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const reportChunksPath = path.join(rootDir, 'data', 'reports', args.date, 'rag', 'chunks.jsonl');
  const portfolioChunksPath = path.join(rootDir, 'data', 'portfolio', 'rag', args.date, 'chunks.jsonl');
  const outputDir = path.join(rootDir, 'knowledge', 'rag', args.date);
  await ensureDirectory(outputDir);

  const reportChunks = await readJsonl(reportChunksPath);
  const portfolioChunks = await readJsonl(portfolioChunksPath);
  const allChunks = [...portfolioChunks, ...reportChunks];

  const mergedMarkdownPath = path.join(outputDir, 'parallel-corpus.md');
  const chunksJsonlPath = path.join(outputDir, 'parallel-chunks.jsonl');
  const dbPath = path.join(outputDir, 'parallel-rag.db');
  const manifestPath = path.join(outputDir, 'parallel-manifest.json');

  await fs.writeFile(mergedMarkdownPath, buildMergedMarkdown(reportChunks, portfolioChunks), 'utf8');
  await fs.writeFile(chunksJsonlPath, `${allChunks.map((chunk) => JSON.stringify(chunk)).join('\n')}\n`, 'utf8');

  const db = initDatabase(dbPath);
  const insertChunk = db.prepare(`
    INSERT INTO chunks (
      chunk_id, source_type, report_id, report_title, portfolio_date, account_key, account_label,
      holding_code, holding_name, sequence, section_title, chunk_type, char_length, token_estimate,
      text, keywords, metadata_json
    ) VALUES (
      @chunk_id, @source_type, @report_id, @report_title, @portfolio_date, @account_key, @account_label,
      @holding_code, @holding_name, @sequence, @section_title, @chunk_type, @char_length, @token_estimate,
      @text, @keywords, @metadata_json
    )
  `);
  const insertFts = db.prepare(`
    INSERT INTO chunks_fts(rowid, text, section_title, keywords)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const chunk of allChunks) {
      const info = insertChunk.run({
        chunk_id: chunk.chunk_id,
        source_type: chunk.source_type,
        report_id: chunk.report_id ?? null,
        report_title: chunk.report_title ?? null,
        portfolio_date: chunk.portfolio_date ?? null,
        account_key: chunk.account_key ?? null,
        account_label: chunk.account_label ?? null,
        holding_code: chunk.holding_code ?? chunk.ticker ?? null,
        holding_name: chunk.holding_name ?? chunk.ticker_name ?? null,
        sequence: chunk.sequence ?? null,
        section_title: chunk.section_title ?? null,
        chunk_type: chunk.chunk_type ?? null,
        char_length: chunk.char_length ?? 0,
        token_estimate: chunk.token_estimate ?? 0,
        text: chunk.text ?? '',
        keywords: chunk.keywords ?? '',
        metadata_json: JSON.stringify(chunk),
      });
      insertFts.run(info.lastInsertRowid, chunk.text ?? '', chunk.section_title ?? '', chunk.keywords ?? '');
    }
  });
  tx();
  db.close();

  await writeJson(manifestPath, {
    date: args.date,
    generated_at: new Date().toISOString(),
    total_chunks: allChunks.length,
    report_chunks: reportChunks.length,
    portfolio_chunks: portfolioChunks.length,
    output_files: {
      merged_markdown: path.relative(rootDir, mergedMarkdownPath),
      chunks_jsonl: path.relative(rootDir, chunksJsonlPath),
      sqlite_db: path.relative(rootDir, dbPath),
    },
    source_type_counts: allChunks.reduce((acc, chunk) => {
      acc[chunk.source_type] = (acc[chunk.source_type] ?? 0) + 1;
      return acc;
    }, {}),
  });

  console.log(`✅ 병렬 RAG 코퍼스 생성 완료: 총 ${allChunks.length}개 청크 (report ${reportChunks.length} / portfolio ${portfolioChunks.length})`);
  console.log(`📚 merged: ${mergedMarkdownPath}`);
  console.log(`🗃 db: ${dbPath}`);
}

main().catch((error) => {
  console.error(`❌ build-parallel-rag-corpus 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
