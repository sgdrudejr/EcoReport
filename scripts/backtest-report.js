#!/usr/bin/env node
/**
 * 백테스트 마크다운 리포트 생성기
 * data/backtest/results.json 을 읽어 reports/backtest-summary.md 를 생성한다.
 *
 * 사용:
 *   node scripts/backtest-report.js
 *   node scripts/backtest-report.js --input data/backtest/results.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    input: path.join(ROOT_DIR, 'data', 'backtest', 'results.json'),
    output: path.join(ROOT_DIR, 'reports', 'backtest-summary.md'),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) { args.input = argv[i + 1]; i++; }
    if (argv[i] === '--output' && argv[i + 1]) { args.output = argv[i + 1]; i++; }
  }
  return args;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function fmt(n, decimals = 2) {
  if (n == null) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

function fmtN(n) {
  if (n == null) return 'N/A';
  return n.toFixed(4);
}

function signalEmoji(signal) {
  const map = { BUY: '🟢', HOLD: '🟡', WATCH: '🟠', REDUCE: '🔴', UNKNOWN: '⚪' };
  return map[signal] ?? '⚪';
}

function ratingBadge(hitRate) {
  if (hitRate == null) return '';
  if (hitRate >= 0.6) return ' ✅ 양호';
  if (hitRate >= 0.45) return ' ⚠️ 보통';
  return ' ❌ 개선 필요';
}

function buildReport(data) {
  const { dateRange, totalSignals, signalDistribution, summary, analysisDate } = data;
  const bySignal = summary?.by_signal ?? {};
  const byRegime = summary?.by_regime ?? {};

  const lines = [];

  lines.push('# EcoReport 백테스트 결과 리포트');
  lines.push('');
  lines.push(`**분석일**: ${analysisDate ?? 'N/A'}  `);
  lines.push(`**신호 기간**: ${dateRange?.from} ~ ${dateRange?.to}  `);
  lines.push(`**총 종목 신호 수**: ${totalSignals}개  `);
  lines.push('');

  // 신호 분포
  lines.push('## 신호 분포');
  lines.push('');
  lines.push('| 신호 | 건수 |');
  lines.push('|------|------|');
  for (const [sig, count] of Object.entries(signalDistribution ?? {})) {
    lines.push(`| ${signalEmoji(sig)} ${sig} | ${count} |`);
  }
  lines.push('');

  // 신호별 수익률
  lines.push('## 신호별 5일 수익률 성과');
  lines.push('');

  const analyzed = Object.keys(bySignal);
  if (analyzed.length === 0) {
    lines.push('> ⚠️ 아직 분석 가능한 데이터가 부족합니다.');
    lines.push('> 시스템이 더 많은 날짜를 축적하면 여기에 통계가 표시됩니다 (권장: 30일 이상).');
  } else {
    lines.push('| 신호 | 건수 | 평균 5일 수익 | 표준편차 | 샤프 | 적중률 | 최고 | 최저 |');
    lines.push('|------|------|-------------|---------|------|--------|------|------|');
    const signalOrder = ['BUY', 'HOLD', 'WATCH', 'REDUCE'];
    const remaining = Object.keys(bySignal).filter((s) => !signalOrder.includes(s));
    for (const sig of [...signalOrder, ...remaining]) {
      const s = bySignal[sig];
      if (!s) continue;
      const hitStr = s.hit_rate != null ? `${(s.hit_rate * 100).toFixed(0)}%${ratingBadge(s.hit_rate)}` : 'N/A';
      lines.push(
        `| ${signalEmoji(sig)} ${sig} | ${s.count} | **${fmt(s.avg_ret_5d_pct)}** | ` +
        `${fmtN(s.std)} | ${fmtN(s.sharpe)} | ${hitStr} | ${fmt(s.best)} | ${fmt(s.worst)} |`
      );
    }
  }
  lines.push('');

  // 레짐별 성과
  if (Object.keys(byRegime).length > 0) {
    lines.push('## 레짐별 신호 성과');
    lines.push('');
    for (const [regime, sigMap] of Object.entries(byRegime)) {
      lines.push(`### ${regime}`);
      lines.push('');
      lines.push('| 신호 | 건수 | 평균 5일 수익 |');
      lines.push('|------|------|-------------|');
      for (const [sig, stat] of Object.entries(sigMap)) {
        lines.push(`| ${signalEmoji(sig)} ${sig} | ${stat.count} | ${fmt(stat.avg_ret_5d_pct)} |`);
      }
      lines.push('');
    }
  }

  // 해석 가이드
  lines.push('## 해석 가이드');
  lines.push('');
  lines.push('| 지표 | 기준 | 의미 |');
  lines.push('|------|------|------|');
  lines.push('| BUY 적중률 | ≥60% ✅ | 매수 신호 후 5일 내 양수 수익 비율 |');
  lines.push('| REDUCE 적중률 | ≥60% ✅ | 매도 신호 후 5일 내 음수 수익 비율 |');
  lines.push('| 샤프 | >1.0 양호 | 변동성 대비 수익률 (일별 기준) |');
  lines.push('| BUY avg ≫ REDUCE avg | 방향성 유효 | 신호가 실제 방향을 잡고 있는지 |');
  lines.push('');
  lines.push('> **주의**: 데이터가 30일 미만이면 통계적 신뢰도가 낮습니다.');
  lines.push('> 가중치 조정은 최소 60일 이상 데이터 축적 후 권장합니다.');
  lines.push('');
  lines.push(`*생성: ${new Date().toISOString()}*`);

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let data;
  try {
    data = await readJson(args.input);
  } catch {
    console.error(`❌ ${args.input} 없음. 먼저 다음을 실행하세요:`);
    console.error('  node scripts/backtest-collect.js');
    console.error('  python3 scripts/backtest-analyze.py');
    process.exit(1);
  }

  const report = buildReport(data);
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, report, 'utf8');

  console.log(`✅ 백테스트 리포트 저장: ${args.output}`);
  console.log(`   신호 기간: ${data.dateRange?.from} ~ ${data.dateRange?.to}`);
  console.log(`   분석 신호 수: ${Object.keys(data.summary?.by_signal ?? {}).length}가지`);
}

main().catch((err) => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
