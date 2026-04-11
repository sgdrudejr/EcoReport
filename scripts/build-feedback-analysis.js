#!/usr/bin/env node
/**
 * Performance Feedback Loop — Step 2: 스냅샷 분석
 *
 * 과거 스냅샷을 읽고, Python 가격 조회 모듈(backtest-analyze.py)과 동일한
 * Naver/Stooq API를 통해 실제 수익률을 비교한 뒤 분석 리포트를 생성한다.
 *
 * 실제 수익률 조회는 Python subprocess로 위임한다.
 *
 * 사용:
 *   node scripts/build-feedback-analysis.js
 *   node scripts/build-feedback-analysis.js --min-days 5
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT_DIR, writeJson, writeText } from "./lib/pipeline-utils.js";

const SNAPSHOTS_DIR = path.join(ROOT_DIR, "data", "feedback", "snapshots");
const ANALYSIS_DIR = path.join(ROOT_DIR, "data", "feedback", "analysis");
const REPORT_PATH = path.join(ROOT_DIR, "reports", "feedback-summary.md");

function parseArgs(argv) {
  let minDays = 5;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--min-days" && argv[i + 1]) {
      minDays = parseInt(argv[++i], 10);
    }
  }
  return { minDays };
}

function pythonBin() {
  const venvPython = path.join(ROOT_DIR, ".venv", "bin", "python");
  try {
    fs.access(venvPython);
    return venvPython;
  } catch {
    return "python3";
  }
}

/**
 * Python subprocess로 종목별 수익률 조회
 * 입력: [{code, date}] → 출력: [{code, date, ret_5d, ret_10d, ret_20d}]
 */
function fetchReturns(positions) {
  const input = JSON.stringify(positions);
  try {
    const result = execFileSync(
      path.join(ROOT_DIR, ".venv", "bin", "python"),
      [path.join(ROOT_DIR, "scripts", "fetch-forward-returns.py")],
      { input, encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(result);
  } catch (err) {
    console.error(`[feedback-analysis] 수익률 조회 실패: ${err.message}`);
    return [];
  }
}

function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : Math.round((num / denom) * 10000) / 10000;
}

function hitRate(items, scoreFn, returnFn, threshold) {
  const filtered = items.filter((i) => scoreFn(i) >= threshold && returnFn(i) != null);
  if (filtered.length === 0) return null;
  const hits = filtered.filter((i) => returnFn(i) > 0).length;
  return Math.round((hits / filtered.length) * 10000) / 10000;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(ANALYSIS_DIR, { recursive: true });

  // 스냅샷 로드
  let files;
  try {
    files = (await fs.readdir(SNAPSHOTS_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    console.error("[feedback-analysis] 스냅샷 없음. 먼저 build-feedback-snapshot.js를 실행하세요.");
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("[feedback-analysis] 스냅샷 파일이 없습니다.");
    process.exit(1);
  }

  // 경과일 계산 — 오늘로부터 minDays 이상 지난 스냅샷만 분석
  const today = new Date();
  const eligibleFiles = files.filter((f) => {
    const dateStr = f.replace(".json", "");
    const snapshotDate = new Date(dateStr);
    const daysDiff = Math.floor((today - snapshotDate) / (1000 * 60 * 60 * 24));
    return daysDiff >= args.minDays;
  });

  console.log(`[feedback-analysis] 전체 스냅샷: ${files.length}, 분석 대상 (>= ${args.minDays}일): ${eligibleFiles.length}`);

  if (eligibleFiles.length === 0) {
    console.log("[feedback-analysis] 아직 분석 가능한 스냅샷이 없습니다 (최소 경과일 미충족).");
    process.exit(0);
  }

  // 모든 대상 스냅샷의 포지션 수집
  const allSnapshots = [];
  for (const file of eligibleFiles) {
    const snapshot = JSON.parse(await fs.readFile(path.join(SNAPSHOTS_DIR, file), "utf8"));
    allSnapshots.push(snapshot);
  }

  // 수익률 조회 요청 구성
  const returnRequests = [];
  const seen = new Set();
  for (const snap of allSnapshots) {
    for (const pos of snap.positions ?? []) {
      const key = `${pos.code}:${snap.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        returnRequests.push({ code: pos.code, date: snap.date });
      }
    }
  }

  console.log(`[feedback-analysis] ${returnRequests.length}개 종목-날짜 수익률 조회 중...`);
  const returnsRaw = fetchReturns(returnRequests);
  const returnsMap = new Map(returnsRaw.map((r) => [`${r.code}:${r.date}`, r]));

  // 포지션별 통합 데이터 구축
  const enriched = [];
  for (const snap of allSnapshots) {
    for (const pos of snap.positions ?? []) {
      const ret = returnsMap.get(`${pos.code}:${snap.date}`);
      enriched.push({
        date: snap.date,
        regime: snap.regime,
        ...pos,
        ret_1d: ret?.ret_1d ?? null,
        ret_3d: ret?.ret_3d ?? null,
        ret_5d: ret?.ret_5d ?? null,
        ret_10d: ret?.ret_10d ?? null,
        ret_20d: ret?.ret_20d ?? null,
      });
    }
  }

  // ret_5d 우선, 없으면 ret_3d/ret_1d 순으로 bestReturn 채움
  for (const e of enriched) {
    e.bestReturn = e.ret_5d ?? e.ret_3d ?? e.ret_1d ?? null;
    e.bestReturnPeriod = e.ret_5d != null ? "5d" : e.ret_3d != null ? "3d" : e.ret_1d != null ? "1d" : null;
  }
  const withReturns = enriched.filter((e) => e.bestReturn != null);
  console.log(`[feedback-analysis] 수익률 확보: ${withReturns.length} / ${enriched.length}`);

  if (withReturns.length < 3) {
    console.log("[feedback-analysis] 수익률 데이터 부족, 분석 스킵.");
    process.exit(0);
  }

  // === 분석 ===

  // 1. 점수-수익률 상관관계
  const scoreReturnCorr = {
    "actionScore_vs_ret5d": pearsonCorrelation(
      withReturns.map((e) => e.actionScore),
      withReturns.map((e) => e.bestReturn),
    ),
    "actionScore_vs_ret10d": pearsonCorrelation(
      withReturns.filter((e) => e.ret_10d != null).map((e) => e.actionScore),
      withReturns.filter((e) => e.ret_10d != null).map((e) => e.ret_10d),
    ),
    "actionScore_vs_ret20d": pearsonCorrelation(
      withReturns.filter((e) => e.ret_20d != null).map((e) => e.actionScore),
      withReturns.filter((e) => e.ret_20d != null).map((e) => e.ret_20d),
    ),
  };

  // 2. 시그널 적중률
  const signalHitRates = {
    buy_hit_5d: hitRate(withReturns, (e) => e.actionScore, (e) => e.bestReturn, 68),
    hold_hit_5d: hitRate(withReturns, (e) => e.actionScore, (e) => e.bestReturn, 50),
    trim_negative_5d: (() => {
      const trims = withReturns.filter((e) => e.actionScore <= 38 && e.bestReturn != null);
      if (trims.length === 0) return null;
      return Math.round(trims.filter((e) => e.bestReturn < 0).length / trims.length * 10000) / 10000;
    })(),
  };

  // 3. 팩터별 상관관계 (예측력)
  const factorCorrelations = {};
  for (const factor of ["momentum", "research", "income", "macroFit"]) {
    const valid = withReturns.filter((e) => e.factors?.[factor] != null);
    factorCorrelations[factor] = {
      vs_ret5d: pearsonCorrelation(valid.map((e) => e.factors[factor]), valid.map((e) => e.bestReturn)),
      vs_ret10d: pearsonCorrelation(
        valid.filter((e) => e.ret_10d != null).map((e) => e.factors[factor]),
        valid.filter((e) => e.ret_10d != null).map((e) => e.ret_10d),
      ),
      count: valid.length,
    };
  }

  // 4. 레짐별 정확도
  const regimeAccuracy = {};
  const regimes = [...new Set(withReturns.map((e) => e.regime))];
  for (const regime of regimes) {
    const subset = withReturns.filter((e) => e.regime === regime);
    regimeAccuracy[regime] = {
      count: subset.length,
      avgReturn5d: subset.length > 0
        ? Math.round(subset.reduce((s, e) => s + e.bestReturn, 0) / subset.length * 100) / 100
        : null,
      scoreCorr5d: pearsonCorrelation(
        subset.map((e) => e.actionScore),
        subset.map((e) => e.ret_5d),
      ),
      buyHitRate: hitRate(subset, (e) => e.actionScore, (e) => e.bestReturn, 68),
    };
  }

  // 5. 최악 오판 (고점수+음수수익, 저점수+양수수익)
  const worstMispredictions = {
    highScoreLosers: withReturns
      .filter((e) => e.actionScore >= 68 && e.bestReturn < -2)
      .sort((a, b) => a.bestReturn - b.bestReturn)
      .slice(0, 5)
      .map((e) => ({ date: e.date, code: e.code, name: e.name, score: e.actionScore, bestReturn: e.bestReturn, period: e.bestReturnPeriod })),
    lowScoreWinners: withReturns
      .filter((e) => e.actionScore <= 38 && e.bestReturn > 2)
      .sort((a, b) => b.bestReturn - a.bestReturn)
      .slice(0, 5)
      .map((e) => ({ date: e.date, code: e.code, name: e.name, score: e.actionScore, bestReturn: e.bestReturn, period: e.bestReturnPeriod })),
  };

  // 6. 가중치 조정 제안
  const weightSuggestions = Object.entries(factorCorrelations).map(([factor, corr]) => {
    const c = corr.vs_ret5d;
    let suggestion = "유지";
    if (c != null && c > 0.15) suggestion = "비중↑ (양의 예측력)";
    else if (c != null && c < -0.10) suggestion = "비중↓ (음의 예측력)";
    else if (c != null && Math.abs(c) < 0.05) suggestion = "비중↓ (예측력 거의 없음)";
    return { factor, correlation_5d: c, suggestion };
  });

  const analysis = {
    generatedAt: new Date().toISOString(),
    snapshotDates: eligibleFiles.map((f) => f.replace(".json", "")),
    sampleSize: withReturns.length,
    scoreReturnCorrelation: scoreReturnCorr,
    signalHitRates,
    factorCorrelations,
    regimeAccuracy,
    worstMispredictions,
    weightSuggestions,
  };

  const analysisPath = path.join(ANALYSIS_DIR, `${new Date().toISOString().slice(0, 10)}-feedback.json`);
  await writeJson(analysisPath, analysis);
  console.log(analysisPath);

  // Markdown 리포트 생성
  const md = [
    "# Performance Feedback Summary",
    "",
    `> 생성: ${analysis.generatedAt} | 샘플: ${analysis.sampleSize}개 포지션-날짜`,
    `> 스냅샷: ${analysis.snapshotDates.join(", ")}`,
    "",
    "## 1. 점수-수익률 상관관계",
    "",
    `| 비교 | Pearson r |`,
    `|------|----------|`,
    `| actionScore vs ret_5d | ${scoreReturnCorr.actionScore_vs_ret5d ?? "N/A"} |`,
    `| actionScore vs ret_10d | ${scoreReturnCorr.actionScore_vs_ret10d ?? "N/A"} |`,
    `| actionScore vs ret_20d | ${scoreReturnCorr.actionScore_vs_ret20d ?? "N/A"} |`,
    "",
    "## 2. 시그널 적중률",
    "",
    `| 지표 | 값 |`,
    `|------|-----|`,
    `| BUY(≥68) 양수수익 비율 (5d) | ${signalHitRates.buy_hit_5d ?? "N/A"} |`,
    `| HOLD(≥50) 양수수익 비율 (5d) | ${signalHitRates.hold_hit_5d ?? "N/A"} |`,
    `| TRIM(≤38) 음수수익 비율 (5d) | ${signalHitRates.trim_negative_5d ?? "N/A"} |`,
    "",
    "## 3. 팩터별 예측력",
    "",
    `| 팩터 | corr(5d) | corr(10d) | 샘플 | 제안 |`,
    `|------|----------|-----------|------|------|`,
    ...weightSuggestions.map((w) =>
      `| ${w.factor} | ${w.correlation_5d ?? "N/A"} | ${factorCorrelations[w.factor]?.vs_ret10d ?? "N/A"} | ${factorCorrelations[w.factor]?.count ?? 0} | ${w.suggestion} |`,
    ),
    "",
    "## 4. 레짐별 정확도",
    "",
    `| 레짐 | 샘플 | 평균수익(5d) | 점수상관 | BUY적중률 |`,
    `|------|------|-------------|---------|----------|`,
    ...Object.entries(regimeAccuracy).map(([regime, v]) =>
      `| ${regime} | ${v.count} | ${v.avgReturn5d ?? "N/A"}% | ${v.scoreCorr5d ?? "N/A"} | ${v.buyHitRate ?? "N/A"} |`,
    ),
    "",
    "## 5. 최악 오판",
    "",
    "### 고점수 → 손실",
    ...worstMispredictions.highScoreLosers.map((e) =>
      `- ${e.date} ${e.name}(${e.code}): score=${e.score}, ret(${e.period})=${e.bestReturn}%`,
    ),
    ...(worstMispredictions.highScoreLosers.length === 0 ? ["- 해당 없음"] : []),
    "",
    "### 저점수 → 수익",
    ...worstMispredictions.lowScoreWinners.map((e) =>
      `- ${e.date} ${e.name}(${e.code}): score=${e.score}, ret(${e.period})=${e.bestReturn}%`,
    ),
    ...(worstMispredictions.lowScoreWinners.length === 0 ? ["- 해당 없음"] : []),
    "",
  ].join("\n");

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeText(REPORT_PATH, md);
  console.log(REPORT_PATH);
}

main().catch((err) => {
  console.error(`[feedback-analysis] 실패: ${err.message}`);
  process.exit(1);
});
