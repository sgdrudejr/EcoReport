#!/usr/bin/env node
/**
 * 백테스트용 신호 수집기
 * data/analysis-state/{date}/stage3-quant-scores.json 파일에서
 * 날짜별 신호(BUY/HOLD/REDUCE)와 스코어를 수집해 backtest-signals.json 으로 저장한다.
 *
 * 사용:
 *   node scripts/backtest-collect.js
 *   node scripts/backtest-collect.js --output data/backtest/signals.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { output: path.join(ROOT_DIR, 'data', 'backtest', 'signals.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output' && argv[i + 1]) {
      args.output = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function collectSignals() {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, 'data', 'analysis-state');

  let dateDirs;
  try {
    const entries = await fs.readdir(stateDir, { withFileTypes: true });
    dateDirs = entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    console.error('❌ data/analysis-state 디렉토리를 읽을 수 없습니다.');
    process.exit(1);
  }

  console.log(`📂 ${dateDirs.length}개 날짜 디렉토리 발견`);

  const allSignals = [];
  let skipped = 0;

  for (const dateStr of dateDirs) {
    const scorePath = path.join(stateDir, dateStr, 'stage3-quant-scores.json');
    const data = await readJson(scorePath);
    if (!data) {
      skipped++;
      continue;
    }

    const regime = data.regime?.name ?? 'UNKNOWN';
    const portfolioScore = data.portfolio?.totalScore ?? null;
    const leadingScore = data.leadingIndicator?.score ?? null;

    // 종목별 신호 수집
    for (const [code, holding] of Object.entries(data.holdings ?? {})) {
      const signal = holding.signal ?? null;
      if (!signal) continue;

      allSignals.push({
        date: dateStr,
        code,
        name: holding.name,
        accountKey: holding.accountKey,
        category: holding.category,
        signal,                         // BUY / HOLD / REDUCE / WATCH
        actionScore: holding.actionScore ?? null,
        technicalBaseScore: holding.technicalBaseScore ?? null,
        conviction: holding.conviction ?? null,
        p_buy: holding.probabilities?.p_buy ?? null,
        p_sell: holding.probabilities?.p_sell ?? null,
        regime,
        portfolioScore,
        leadingScore,
        // 수익률은 backtest-analyze.py가 채워넣음
        ret_5d: null,
        ret_10d: null,
        ret_20d: null,
      });
    }

    // 계좌별 신호도 수집
    for (const [key, account] of Object.entries(data.accounts ?? {})) {
      allSignals.push({
        date: dateStr,
        code: `ACCOUNT:${key}`,
        name: account.label,
        accountKey: key,
        category: 'account',
        signal: account.stage2Bias?.toUpperCase() ?? 'HOLD',
        actionScore: account.totalScore ?? null,
        technicalBaseScore: account.baseScores?.techScore ?? null,
        conviction: null,
        p_buy: null,
        p_sell: null,
        regime,
        portfolioScore,
        leadingScore,
        ret_5d: null,
        ret_10d: null,
        ret_20d: null,
      });
    }

    console.log(`  ✓ ${dateStr} — 종목 ${Object.keys(data.holdings ?? {}).length}개, 레짐: ${regime}`);
  }

  if (skipped > 0) console.log(`  ⚠️ ${skipped}개 날짜 스킵 (stage3 파일 없음)`);

  const holdingSignals = allSignals.filter((s) => !s.code.startsWith('ACCOUNT:'));
  const uniqueDates = [...new Set(allSignals.map((s) => s.date))];

  // 신호 분포 요약
  const dist = {};
  for (const s of holdingSignals) {
    dist[s.signal] = (dist[s.signal] ?? 0) + 1;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    totalDates: uniqueDates.length,
    totalSignals: holdingSignals.length,
    dateRange: { from: uniqueDates[0], to: uniqueDates[uniqueDates.length - 1] },
    signalDistribution: dist,
    signals: allSignals,
  };

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n📊 신호 수집 결과:`);
  console.log(`  기간: ${output.dateRange.from} ~ ${output.dateRange.to}`);
  console.log(`  종목 신호 수: ${holdingSignals.length}`);
  console.log(`  신호 분포:`, dist);
  console.log(`✅ 저장: ${args.output}`);
  console.log(`\n다음 단계: python3 scripts/backtest-analyze.py`);
}

collectSignals().catch((err) => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
