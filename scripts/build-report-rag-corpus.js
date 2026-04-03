#!/usr/bin/env node
// 전문 텍스트 리포트를 병합하고 의미론적 청킹 및 로컬 검색용 RAG 코퍼스를 생성합니다.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import Database from 'better-sqlite3';

const DEFAULT_TARGET_CHARS = 1200;
const DEFAULT_MAX_CHARS = 1800;
const DEFAULT_OVERLAP_PARAGRAPHS = 1;

const HEADING_KEYWORDS = [
  'investment point',
  '투자포인트',
  '투자 포인트',
  '핵심포인트',
  '핵심 포인트',
  '요약',
  '결론',
  '시사점',
  '전망',
  '전략',
  'valuation',
  '실적',
  '가이던스',
  '수주',
  '리스크',
  'risk',
  'economy monitor',
  'compliance notice',
  'macro',
  'economist',
];

const DISCLAIMER_KEYWORDS = [
  'compliance notice',
  '투자판단',
  '본 보고서',
  '외부의 부당한 압력',
  '당사 조사분석담당자',
  '자료공표일 현재',
];

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
    targetChars: DEFAULT_TARGET_CHARS,
    maxChars: DEFAULT_MAX_CHARS,
    overlapParagraphs: DEFAULT_OVERLAP_PARAGRAPHS,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--date' && argv[index + 1]) {
      args.date = normalizeCliDate(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--target-chars' && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        args.targetChars = value;
      }
      index += 1;
      continue;
    }
    if (token === '--max-chars' && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        args.maxChars = value;
      }
      index += 1;
      continue;
    }
    if (token === '--overlap-paragraphs' && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value >= 0) {
        args.overlapParagraphs = value;
      }
      index += 1;
      continue;
    }
    if (token === '--force') {
      args.force = true;
    }
  }

  if (args.targetChars > args.maxChars) {
    args.targetChars = args.maxChars;
  }

  return args;
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeForHash(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

async function readJson(jsonPath) {
  return JSON.parse(await fs.readFile(jsonPath, 'utf8'));
}

async function writeJson(jsonPath, value) {
  await fs.writeFile(jsonPath, JSON.stringify(value, null, 2), 'utf8');
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function approxTokens(text) {
  return Math.max(1, Math.round(text.length / 2.6));
}

function isLikelyHeading(text) {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const compact = normalized.toLowerCase().replace(/\s+/g, ' ');
  if (HEADING_KEYWORDS.some((keyword) => compact.includes(keyword))) {
    return true;
  }

  if (/^\[PAGE \d+\]$/i.test(normalized)) {
    return true;
  }

  if (/^(\d+[\.\)]|[IVXⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[\.\)]|[가-힣A-Z][\.\)])\s+/.test(normalized)) {
    return true;
  }

  if (normalized.length <= 72 && /^[A-Za-z0-9가-힣 ·,:()/%&+\-]+$/.test(normalized)) {
    return true;
  }

  return false;
}

function looksTabular(lines) {
  if (lines.length < 3) {
    return false;
  }

  const shortLines = lines.filter((line) => line.trim().length <= 28).length;
  const numericDense = lines.filter((line) => (line.match(/\d/g) ?? []).length >= 6).length;
  return shortLines >= Math.ceil(lines.length * 0.5) || numericDense >= Math.ceil(lines.length * 0.4);
}

function materializeParagraph(lines) {
  const cleaned = lines.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return '';
  }

  if (looksTabular(cleaned)) {
    return cleaned.join('\n');
  }

  return cleaned.join(' ');
}

function parseParagraphBlocks(rawText) {
  const lines = normalizeWhitespace(rawText).split('\n');
  const blocks = [];
  let buffer = [];
  let currentPage = 1;

  const flush = () => {
    const text = materializeParagraph(buffer);
    if (text) {
      blocks.push({ page: currentPage, text });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    const pageMatch = trimmed.match(/^\[PAGE\s+(\d+)\]$/i);
    if (pageMatch) {
      flush();
      currentPage = Number.parseInt(pageMatch[1], 10);
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    buffer.push(trimmed);
  }

  flush();
  return blocks;
}

function classifyChunkType(text, sectionTitle) {
  const combined = `${sectionTitle ?? ''}\n${text}`.toLowerCase();
  if (DISCLAIMER_KEYWORDS.some((keyword) => combined.includes(keyword.toLowerCase()))) {
    return 'disclaimer';
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const numericDenseLines = lines.filter((line) => (line.match(/\d/g) ?? []).length >= 6).length;
  if (lines.length >= 4 && looksTabular(lines) && numericDenseLines >= Math.max(2, Math.floor(lines.length * 0.25))) {
    return 'table';
  }
  return 'analysis';
}

function splitOversizedParagraph(paragraph, maxChars) {
  if (paragraph.text.length <= maxChars) {
    return [paragraph];
  }

  const sentences = paragraph.text.split(/(?<=[.!?다요])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    const pieces = [];
    let start = 0;
    while (start < paragraph.text.length) {
      pieces.push({
        ...paragraph,
        text: paragraph.text.slice(start, start + maxChars),
      });
      start += maxChars - 160;
    }
    return pieces;
  }

  const pieces = [];
  let current = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const sentenceLength = sentence.length + 1;
    if (currentLength > 0 && currentLength + sentenceLength > maxChars) {
      pieces.push({ ...paragraph, text: current.join(' ') });
      current = [sentence];
      currentLength = sentenceLength;
    } else {
      current.push(sentence);
      currentLength += sentenceLength;
    }
  }

  if (current.length > 0) {
    pieces.push({ ...paragraph, text: current.join(' ') });
  }

  return pieces;
}

function chunkReport(report, options) {
  const paragraphBlocks = parseParagraphBlocks(report.text);
  const normalizedBlocks = [];
  let currentSection = report.title;

  for (const block of paragraphBlocks) {
    if (isLikelyHeading(block.text)) {
      currentSection = block.text;
      continue;
    }

    const pieces = splitOversizedParagraph({ ...block, sectionTitle: currentSection }, options.maxChars);
    normalizedBlocks.push(...pieces);
  }

  const chunks = [];
  let currentBlocks = [];
  let currentLength = 0;
  let sequence = 1;

  const flush = () => {
    if (currentBlocks.length === 0) {
      return;
    }

    const text = currentBlocks.map((block) => block.text).join('\n\n').trim();
    const firstBlock = currentBlocks[0];
    const lastBlock = currentBlocks[currentBlocks.length - 1];
    const sectionTitle = firstBlock.sectionTitle || report.title;
    const chunkType = classifyChunkType(text, sectionTitle);

    chunks.push({
      chunk_id: `${report.id}_chunk_${String(sequence).padStart(3, '0')}`,
      report_id: report.id,
      sequence,
      section_title: sectionTitle,
      page_start: firstBlock.page,
      page_end: lastBlock.page,
      chunk_type: chunkType,
      char_length: text.length,
      token_estimate: approxTokens(text),
      text,
    });

    sequence += 1;
    if (options.overlapParagraphs > 0) {
      currentBlocks = currentBlocks.slice(Math.max(0, currentBlocks.length - options.overlapParagraphs));
      currentLength = currentBlocks.reduce((sum, block) => sum + block.text.length + 2, 0);
    } else {
      currentBlocks = [];
      currentLength = 0;
    }
  };

  for (const block of normalizedBlocks) {
    const nextLength = currentLength + block.text.length + (currentBlocks.length > 0 ? 2 : 0);
    if (currentBlocks.length > 0 && nextLength > options.maxChars && currentLength >= options.targetChars) {
      flush();
    }

    currentBlocks.push(block);
    currentLength += block.text.length + (currentBlocks.length > 1 ? 2 : 0);

    if (currentLength >= options.maxChars) {
      flush();
    }
  }

  currentBlocks = currentBlocks.filter((block, index, array) => index >= array.length - options.overlapParagraphs);
  if (currentLength > 0) {
    const text = currentBlocks.map((block) => block.text).join('\n\n').trim();
    if (text) {
      const firstBlock = currentBlocks[0];
      const lastBlock = currentBlocks[currentBlocks.length - 1];
      chunks.push({
        chunk_id: `${report.id}_chunk_${String(sequence).padStart(3, '0')}`,
        report_id: report.id,
        sequence,
        section_title: firstBlock.sectionTitle || report.title,
        page_start: firstBlock.page,
        page_end: lastBlock.page,
        chunk_type: classifyChunkType(text, firstBlock.sectionTitle || report.title),
        char_length: text.length,
        token_estimate: approxTokens(text),
        text,
      });
    }
  }

  return chunks;
}

function buildKeywords(report, chunk) {
  const values = [
    report.title,
    report.broker,
    report.category,
    report.source,
    report.ticker,
    report.ticker_name,
    report.sector,
    chunk.section_title,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  return Array.from(new Set(values)).join(' | ');
}

function buildMergedMarkdown(uniqueReports) {
  const sections = ['# EcoReport Merged Report Corpus', ''];

  for (const report of uniqueReports) {
    sections.push(`## [${report.id}] ${report.title}`);
    sections.push(`- 증권사: ${report.broker}`);
    sections.push(`- 카테고리: ${report.category}`);
    sections.push(`- 출처: ${report.source}`);
    if (report.ticker || report.ticker_name) {
      sections.push(`- 종목: ${report.ticker_name ?? 'N/A'} (${report.ticker ?? 'N/A'})`);
    }
    if (report.sector) {
      sections.push(`- 섹터: ${report.sector}`);
    }
    sections.push(`- PDF: ${report.pdf_path}`);
    sections.push(`- 전문 텍스트: ${report.text_path}`);
    sections.push('');
    sections.push(report.text);
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  return sections.join('\n');
}

function initDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    DROP TABLE IF EXISTS chunks_fts;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS reports;

    CREATE TABLE reports (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      broker TEXT,
      category TEXT,
      source TEXT,
      ticker TEXT,
      ticker_name TEXT,
      sector TEXT,
      pdf_path TEXT,
      text_path TEXT,
      text_hash TEXT NOT NULL,
      normalized_hash TEXT NOT NULL,
      char_length INTEGER NOT NULL,
      page_count INTEGER,
      duplicate_of TEXT,
      duplicate_reason TEXT
    );

    CREATE TABLE chunks (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      report_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      section_title TEXT,
      page_start INTEGER,
      page_end INTEGER,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const reportDir = path.join(rootDir, 'data', 'reports', args.date);
  const indexPath = path.join(reportDir, 'index.json');
  const ragDir = path.join(reportDir, 'rag');
  const manifestPath = path.join(ragDir, 'chunk-manifest.json');

  await fs.access(indexPath);
  await ensureDirectory(ragDir);

  const indexEntries = await readJson(indexPath);
  const textManifest = await readJson(path.join(reportDir, 'text-manifest.json'));

  const seenHashes = new Map();
  const reports = [];
  const uniqueReports = [];
  const duplicateReports = [];
  const allChunks = [];

  for (const entry of indexEntries) {
    const textPath = path.join(rootDir, entry.full_text_path ?? '');
    const text = normalizeWhitespace(await fs.readFile(textPath, 'utf8'));
    const normalizedHash = sha1(normalizeForHash(text));
    const rawHash = sha1(text);
    const textMeta = textManifest.entries.find((item) => item.id === entry.id) ?? null;

    const report = {
      id: entry.id,
      date: entry.date,
      title: entry.title,
      broker: entry.broker,
      category: entry.category,
      source: entry.source ?? '알 수 없음',
      ticker: entry.ticker ?? null,
      ticker_name: entry.ticker_name ?? null,
      sector: entry.sector ?? null,
      pdf_path: entry.pdf_path,
      text_path: entry.full_text_path,
      text_hash: rawHash,
      normalized_hash: normalizedHash,
      char_length: text.length,
      page_count: textMeta?.page_count ?? null,
      text,
      duplicate_of: null,
      duplicate_reason: null,
    };

    if (seenHashes.has(normalizedHash)) {
      const original = seenHashes.get(normalizedHash);
      report.duplicate_of = original.id;
      report.duplicate_reason = 'normalized_text_hash_match';
      duplicateReports.push(report);
      reports.push(report);
      continue;
    }

    seenHashes.set(normalizedHash, report);
    reports.push(report);
    uniqueReports.push(report);

    const chunks = chunkReport(report, {
      targetChars: args.targetChars,
      maxChars: args.maxChars,
      overlapParagraphs: args.overlapParagraphs,
    }).map((chunk) => ({
      ...chunk,
      source_type: 'report',
      report_title: report.title,
      broker: report.broker,
      category: report.category,
      source: report.source,
      ticker: report.ticker,
      ticker_name: report.ticker_name,
      sector: report.sector,
      keywords: buildKeywords(report, chunk),
    }));

    allChunks.push(...chunks);
  }

  const mergedMarkdownPath = path.join(ragDir, 'merged-reports.md');
  const corpusJsonPath = path.join(ragDir, 'report-corpus.json');
  const chunksJsonlPath = path.join(ragDir, 'chunks.jsonl');
  const dbPath = path.join(ragDir, 'report-rag.db');

  await fs.writeFile(mergedMarkdownPath, buildMergedMarkdown(uniqueReports), 'utf8');
  await writeJson(
    corpusJsonPath,
    reports.map((report) => ({
      report_id: report.id,
      date: report.date,
      title: report.title,
      broker: report.broker,
      category: report.category,
      source: report.source,
      ticker: report.ticker,
      ticker_name: report.ticker_name,
      sector: report.sector,
      pdf_path: report.pdf_path,
      text_path: report.text_path,
      char_length: report.char_length,
      page_count: report.page_count,
      duplicate_of: report.duplicate_of,
      duplicate_reason: report.duplicate_reason,
    })),
  );

  const jsonlLines = allChunks.map((chunk) =>
    JSON.stringify({
      chunk_id: chunk.chunk_id,
      source_type: chunk.source_type,
      report_id: chunk.report_id,
      report_title: chunk.report_title,
      broker: chunk.broker,
      category: chunk.category,
      source: chunk.source,
      ticker: chunk.ticker,
      ticker_name: chunk.ticker_name,
      sector: chunk.sector,
      sequence: chunk.sequence,
      section_title: chunk.section_title,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      chunk_type: chunk.chunk_type,
      char_length: chunk.char_length,
      token_estimate: chunk.token_estimate,
      keywords: chunk.keywords,
      text: chunk.text,
    }),
  );
  await fs.writeFile(chunksJsonlPath, `${jsonlLines.join('\n')}\n`, 'utf8');

  const db = initDatabase(dbPath);
  const insertReport = db.prepare(`
    INSERT INTO reports (
      report_id, date, title, broker, category, source, ticker, ticker_name, sector,
      pdf_path, text_path, text_hash, normalized_hash, char_length, page_count, duplicate_of, duplicate_reason
    ) VALUES (
      @report_id, @date, @title, @broker, @category, @source, @ticker, @ticker_name, @sector,
      @pdf_path, @text_path, @text_hash, @normalized_hash, @char_length, @page_count, @duplicate_of, @duplicate_reason
    )
  `);
  const insertChunk = db.prepare(`
    INSERT INTO chunks (
      chunk_id, report_id, sequence, section_title, page_start, page_end, chunk_type,
      char_length, token_estimate, text, keywords, metadata_json
    ) VALUES (
      @chunk_id, @report_id, @sequence, @section_title, @page_start, @page_end, @chunk_type,
      @char_length, @token_estimate, @text, @keywords, @metadata_json
    )
  `);
  const insertFts = db.prepare(`
    INSERT INTO chunks_fts(rowid, text, section_title, keywords)
    VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const report of reports) {
      insertReport.run({
        report_id: report.id,
        date: report.date,
        title: report.title,
        broker: report.broker,
        category: report.category,
        source: report.source,
        ticker: report.ticker,
        ticker_name: report.ticker_name,
        sector: report.sector,
        pdf_path: report.pdf_path,
        text_path: report.text_path,
        text_hash: report.text_hash,
        normalized_hash: report.normalized_hash,
        char_length: report.char_length,
        page_count: report.page_count,
        duplicate_of: report.duplicate_of,
        duplicate_reason: report.duplicate_reason,
      });
    }

    for (const chunk of allChunks) {
      const info = insertChunk.run({
        chunk_id: chunk.chunk_id,
        report_id: chunk.report_id,
        sequence: chunk.sequence,
        section_title: chunk.section_title,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        chunk_type: chunk.chunk_type,
        char_length: chunk.char_length,
        token_estimate: chunk.token_estimate,
        text: chunk.text,
        keywords: chunk.keywords,
        metadata_json: JSON.stringify({
          source_type: chunk.source_type,
          report_id: chunk.report_id,
          report_title: chunk.report_title,
          broker: chunk.broker,
          category: chunk.category,
          source: chunk.source,
          ticker: chunk.ticker,
          ticker_name: chunk.ticker_name,
          sector: chunk.sector,
          page_start: chunk.page_start,
          page_end: chunk.page_end,
          chunk_type: chunk.chunk_type,
        }),
      });
      insertFts.run(info.lastInsertRowid, chunk.text, chunk.section_title, chunk.keywords);
    }
  });
  insertAll();
  db.close();

  const manifest = {
    date: args.date,
    generated_at: new Date().toISOString(),
    total_reports: reports.length,
    unique_reports: uniqueReports.length,
    duplicate_reports: duplicateReports.length,
    total_chunks: allChunks.length,
    target_chars: args.targetChars,
    max_chars: args.maxChars,
    overlap_paragraphs: args.overlapParagraphs,
    output_files: {
      merged_markdown: path.relative(rootDir, mergedMarkdownPath),
      corpus_json: path.relative(rootDir, corpusJsonPath),
      chunks_jsonl: path.relative(rootDir, chunksJsonlPath),
      sqlite_db: path.relative(rootDir, dbPath),
    },
    duplicate_entries: duplicateReports.map((report) => ({
      report_id: report.id,
      title: report.title,
      broker: report.broker,
      duplicate_of: report.duplicate_of,
      duplicate_reason: report.duplicate_reason,
    })),
    chunk_type_counts: allChunks.reduce((acc, chunk) => {
      acc[chunk.chunk_type] = (acc[chunk.chunk_type] ?? 0) + 1;
      return acc;
    }, {}),
  };

  await writeJson(manifestPath, manifest);

  console.log(`✅ RAG 코퍼스 생성 완료: ${uniqueReports.length}개 리포트 / ${allChunks.length}개 청크`);
  console.log(`📚 merged: ${mergedMarkdownPath}`);
  console.log(`🗃 db: ${dbPath}`);
}

main().catch((error) => {
  console.error(`❌ build-report-rag-corpus 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
