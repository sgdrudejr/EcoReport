#!/usr/bin/env node
// 포트폴리오 스냅샷과 전략 파일을 계좌/보유종목 중심의 RAG 코퍼스로 변환합니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import Database from 'better-sqlite3';

const ACCOUNT_KEY_TO_STRATEGY_KEY = {
  ISA: 'ISA',
  PENSION: '연금저축',
  TOSS: '토스증권',
};

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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function approxTokens(text) {
  return Math.max(1, Math.round(text.length / 2.6));
}

function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return '미확인';
  }
  return `${Number(value).toLocaleString('ko-KR')}원`;
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return '미확인';
  }
  const num = Number(value);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function buildKeywords(...values) {
  return Array.from(
    new Set(
      values
        .flat()
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ).join(' | ');
}

function getStrategyAccount(strategy, accountKey) {
  const strategyKey = ACCOUNT_KEY_TO_STRATEGY_KEY[accountKey];
  if (!strategyKey) {
    return null;
  }
  return strategy?.accounts?.[strategyKey] ?? null;
}

function makeChunk(base, text, extra = {}) {
  const trimmed = String(text ?? '').trim();
  return {
    ...base,
    ...extra,
    text: trimmed,
    char_length: trimmed.length,
    token_estimate: approxTokens(trimmed),
  };
}

function getPortfolioTotals(snapshot) {
  const totals = {
    evaluationAmount: 0,
    cashAvailable: 0,
    principal: 0,
    profitLoss: 0,
    holdingCount: 0,
    holdingsValue: 0,
    holdingsPurchaseValue: 0,
  };

  for (const account of snapshot.accounts ?? []) {
    totals.evaluationAmount += Number(account.evaluationAmount ?? 0);
    totals.cashAvailable += Number(account.cashAvailable ?? 0);
    totals.principal += Number(account.principal ?? 0);
    totals.profitLoss += Number(account.profitLoss ?? 0);
    totals.holdingCount += Array.isArray(account.holdings) ? account.holdings.length : 0;
    for (const holding of account.holdings ?? []) {
      totals.holdingsValue += Number(holding.marketValue ?? 0);
      totals.holdingsPurchaseValue += Number(holding.purchaseValue ?? 0);
    }
  }

  totals.holdingsProfitLoss = totals.holdingsValue - totals.holdingsPurchaseValue;
  totals.holdingsProfitRate =
    totals.holdingsPurchaseValue > 0
      ? (totals.holdingsProfitLoss / totals.holdingsPurchaseValue) * 100
      : null;

  return totals;
}

function buildPortfolioChunks(snapshot, strategy) {
  const chunks = [];
  let sequence = 1;
  const totals = getPortfolioTotals(snapshot);
  const strategyName = strategy?.name ?? '전략 미확인';

  chunks.push(
    makeChunk(
      {
        chunk_id: `portfolio_${snapshot.date}_chunk_${String(sequence).padStart(3, '0')}`,
        source_type: 'portfolio',
        portfolio_date: snapshot.date,
        account_key: null,
        account_label: null,
        holding_code: null,
        holding_name: null,
        sequence,
        section_title: '포트폴리오 전체 개요',
        chunk_type: 'portfolio_overview',
        keywords: buildKeywords('포트폴리오', '전체 개요', strategyName, snapshot.source?.method),
      },
      [
        `포트폴리오 기준일은 ${snapshot.date}이며 업데이트 시각은 ${snapshot.updatedAt}이다.`,
        `데이터 출처는 ${snapshot.source?.method ?? '미확인'}이고 메모는 ${snapshot.source?.note ?? '없음'}이다.`,
        `전체 평가금액은 ${formatMoney(totals.evaluationAmount)}, 가용 현금은 ${formatMoney(totals.cashAvailable)}이다.`,
        `보유 종목 수는 ${totals.holdingCount}개이고, 보유 종목 기준 손익은 ${formatMoney(totals.holdingsProfitLoss)}, 수익률은 ${formatPct(totals.holdingsProfitRate)}이다.`,
        `현재 적용 전략은 ${strategyName}이다.`,
      ].join(' '),
    ),
  );
  sequence += 1;

  for (const account of snapshot.accounts ?? []) {
    const accountStrategy = getStrategyAccount(strategy, account.key);
    const holdings = account.holdings ?? [];
    const holdingsValue = holdings.reduce((sum, holding) => sum + Number(holding.marketValue ?? 0), 0);
    const holdingsPurchaseValue = holdings.reduce((sum, holding) => sum + Number(holding.purchaseValue ?? 0), 0);
    const holdingsProfitLoss = holdings.reduce((sum, holding) => {
      if (holding.profitLoss != null) return sum + Number(holding.profitLoss);
      if (holding.marketValue != null && holding.purchaseValue != null) {
        return sum + (Number(holding.marketValue) - Number(holding.purchaseValue));
      }
      return sum;
    }, 0);
    const holdingsProfitRate =
      holdingsPurchaseValue > 0 ? (holdingsProfitLoss / holdingsPurchaseValue) * 100 : null;
    const holdingNames = holdings.map((holding) => holding.name).filter(Boolean);
    const base = {
      source_type: 'portfolio',
      portfolio_date: snapshot.date,
      account_key: account.key,
      account_label: account.label,
      holding_code: null,
      holding_name: null,
    };

    chunks.push(
      makeChunk(
        {
          ...base,
          chunk_id: `portfolio_${snapshot.date}_chunk_${String(sequence).padStart(3, '0')}`,
          sequence,
          section_title: `${account.label} 계좌 요약`,
          chunk_type: 'account_summary',
          keywords: buildKeywords(account.key, account.label, '계좌 요약', holdingNames),
        },
        [
          `${account.label} 계좌의 평가금액은 ${formatMoney(account.evaluationAmount)}이고, 예수금은 ${formatMoney(account.cashAvailable)}이다.`,
          `원금은 ${formatMoney(account.principal)}, 손익은 ${formatMoney(account.profitLoss)}, 수익률은 ${formatPct(account.profitRate)}이다.`,
          `보유 종목은 ${holdings.length}개이며 보유 종목 평가합은 ${formatMoney(holdingsValue)}, 보유 종목 손익은 ${formatMoney(holdingsProfitLoss)}, 보유 종목 수익률은 ${formatPct(holdingsProfitRate)}이다.`,
          holdingNames.length > 0 ? `현재 보유 종목은 ${holdingNames.join(', ')}이다.` : '현재 보유 종목은 없다.',
          account.incomplete ? '이 계좌는 부분 캡처 기반이라 일부 데이터가 누락되었을 수 있다.' : '이 계좌는 현재 입력 기준에서 완전한 상태로 본다.',
        ].join(' '),
      ),
    );
    sequence += 1;

    if (accountStrategy?.target_allocation) {
      const targetEntries = Object.entries(accountStrategy.target_allocation)
        .map(([label, ratio]) => `${label} ${(Number(ratio) * 100).toFixed(1)}%`)
        .join(', ');
      chunks.push(
        makeChunk(
          {
            ...base,
            chunk_id: `portfolio_${snapshot.date}_chunk_${String(sequence).padStart(3, '0')}`,
            sequence,
            section_title: `${account.label} 목표 배분`,
            chunk_type: 'account_target',
            keywords: buildKeywords(account.key, account.label, '목표 배분', Object.keys(accountStrategy.target_allocation)),
          },
          [
            `${account.label} 계좌의 전략상 목표 현금은 ${formatMoney(accountStrategy.cash ?? null)}이다.`,
            `${account.label} 계좌의 목표 배분은 ${targetEntries}이다.`,
          ].join(' '),
        ),
      );
      sequence += 1;
    }

    for (const holding of holdings) {
      const profitLoss =
        holding.profitLoss != null
          ? Number(holding.profitLoss)
          : holding.marketValue != null && holding.purchaseValue != null
            ? Number(holding.marketValue) - Number(holding.purchaseValue)
            : null;
      const profitRate =
        holding.profitRate != null
          ? Number(holding.profitRate)
          : holding.purchaseValue
            ? (Number(profitLoss ?? 0) / Number(holding.purchaseValue)) * 100
            : null;

      chunks.push(
        makeChunk(
          {
            ...base,
            chunk_id: `portfolio_${snapshot.date}_chunk_${String(sequence).padStart(3, '0')}`,
            sequence,
            section_title: `${account.label} · ${holding.name}`,
            chunk_type: 'holding_detail',
            holding_code: holding.code ?? null,
            holding_name: holding.name,
            keywords: buildKeywords(
              account.key,
              account.label,
              holding.code,
              holding.name,
              '보유 종목',
            ),
          },
          [
            `${account.label} 계좌에서 ${holding.name}${holding.code ? ` (${holding.code})` : ''}을 ${holding.quantity ?? '미확인'}주 보유 중이다.`,
            `평가금액은 ${formatMoney(holding.marketValue)}, 매수금액은 ${formatMoney(holding.purchaseValue)}, 손익은 ${formatMoney(profitLoss)}, 수익률은 ${formatPct(profitRate)}이다.`,
            `평균단가는 ${formatMoney(holding.avgPrice)}, 현재가는 ${formatMoney(holding.currentPrice)}이다.`,
            holding.note ? `메모: ${holding.note}` : '',
          ].filter(Boolean).join(' '),
        ),
      );
      sequence += 1;
    }
  }

  return chunks;
}

function buildMergedMarkdown(snapshot, chunks) {
  const lines = ['# EcoReport Portfolio Corpus', ''];
  lines.push(`- 기준일: ${snapshot.date}`);
  lines.push(`- 업데이트 시각: ${snapshot.updatedAt}`);
  lines.push('');

  for (const chunk of chunks) {
    lines.push(`## [${chunk.chunk_id}] ${chunk.section_title}`);
    if (chunk.account_label) {
      lines.push(`- 계좌: ${chunk.account_label} (${chunk.account_key})`);
    }
    if (chunk.holding_name) {
      lines.push(`- 종목: ${chunk.holding_name}${chunk.holding_code ? ` (${chunk.holding_code})` : ''}`);
    }
    lines.push(`- 유형: ${chunk.chunk_type}`);
    lines.push('');
    lines.push(chunk.text);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
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
      portfolio_date TEXT NOT NULL,
      account_key TEXT,
      account_label TEXT,
      holding_code TEXT,
      holding_name TEXT,
      sequence INTEGER NOT NULL,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const portfolioPath = path.join(rootDir, 'data', 'portfolio', 'latest.json');
  const strategyPath = path.join(rootDir, 'config', 'strategy.json');
  const ragDir = path.join(rootDir, 'data', 'portfolio', 'rag', args.date);

  await ensureDirectory(ragDir);

  const snapshot = await readJson(portfolioPath);
  if (snapshot.date !== args.date) {
    console.warn(`⚠️ latest.json 기준일(${snapshot.date})과 --date(${args.date})가 다릅니다. snapshot 기준으로 계속 진행합니다.`);
  }
  const strategy = await readJson(strategyPath).catch(() => null);
  const chunks = buildPortfolioChunks(snapshot, strategy);

  const mergedMarkdownPath = path.join(ragDir, 'merged-portfolio.md');
  const corpusJsonPath = path.join(ragDir, 'portfolio-corpus.json');
  const chunksJsonlPath = path.join(ragDir, 'chunks.jsonl');
  const dbPath = path.join(ragDir, 'portfolio-rag.db');
  const manifestPath = path.join(ragDir, 'chunk-manifest.json');

  await fs.writeFile(mergedMarkdownPath, buildMergedMarkdown(snapshot, chunks), 'utf8');
  await writeJson(
    corpusJsonPath,
    chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      source_type: chunk.source_type,
      portfolio_date: chunk.portfolio_date,
      account_key: chunk.account_key,
      account_label: chunk.account_label,
      holding_code: chunk.holding_code,
      holding_name: chunk.holding_name,
      sequence: chunk.sequence,
      section_title: chunk.section_title,
      chunk_type: chunk.chunk_type,
      char_length: chunk.char_length,
      token_estimate: chunk.token_estimate,
      keywords: chunk.keywords,
    })),
  );
  await fs.writeFile(
    chunksJsonlPath,
    `${chunks.map((chunk) => JSON.stringify(chunk)).join('\n')}\n`,
    'utf8',
  );

  const db = initDatabase(dbPath);
  const insertChunk = db.prepare(`
    INSERT INTO chunks (
      chunk_id, source_type, portfolio_date, account_key, account_label, holding_code, holding_name,
      sequence, section_title, chunk_type, char_length, token_estimate, text, keywords, metadata_json
    ) VALUES (
      @chunk_id, @source_type, @portfolio_date, @account_key, @account_label, @holding_code, @holding_name,
      @sequence, @section_title, @chunk_type, @char_length, @token_estimate, @text, @keywords, @metadata_json
    )
  `);
  const insertFts = db.prepare(`
    INSERT INTO chunks_fts(rowid, text, section_title, keywords)
    VALUES (?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const chunk of chunks) {
      const info = insertChunk.run({
        ...chunk,
        metadata_json: JSON.stringify({
          source_type: chunk.source_type,
          portfolio_date: chunk.portfolio_date,
          account_key: chunk.account_key,
          account_label: chunk.account_label,
          holding_code: chunk.holding_code,
          holding_name: chunk.holding_name,
          chunk_type: chunk.chunk_type,
        }),
      });
      insertFts.run(info.lastInsertRowid, chunk.text, chunk.section_title, chunk.keywords);
    }
  });
  tx();
  db.close();

  await writeJson(manifestPath, {
    date: args.date,
    generated_at: new Date().toISOString(),
    total_chunks: chunks.length,
    account_count: snapshot.accounts?.length ?? 0,
    holding_count: (snapshot.accounts ?? []).reduce((sum, account) => sum + (account.holdings?.length ?? 0), 0),
    chunk_type_counts: chunks.reduce((acc, chunk) => {
      acc[chunk.chunk_type] = (acc[chunk.chunk_type] ?? 0) + 1;
      return acc;
    }, {}),
    output_files: {
      merged_markdown: path.relative(rootDir, mergedMarkdownPath),
      corpus_json: path.relative(rootDir, corpusJsonPath),
      chunks_jsonl: path.relative(rootDir, chunksJsonlPath),
      sqlite_db: path.relative(rootDir, dbPath),
    },
  });

  console.log(`✅ 포트폴리오 RAG 코퍼스 생성 완료: ${chunks.length}개 청크`);
  console.log(`📚 merged: ${mergedMarkdownPath}`);
  console.log(`🗃 db: ${dbPath}`);
}

main().catch((error) => {
  console.error(`❌ build-portfolio-rag-corpus 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
