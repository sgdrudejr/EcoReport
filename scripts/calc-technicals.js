#!/usr/bin/env node
// 관심 종목과 ETF의 기술적 지표 및 종합 점수를 계산하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { config as loadEnv } from 'dotenv';
import fetch from 'node-fetch';
import {
  ADX,
  BollingerBands,
  MACD,
  RSI,
  SMA,
  Stochastic,
} from 'technicalindicators';

loadEnv();

const HISTORY_PAGE_SIZE = 60;
const HISTORY_PAGES = 3;
const REQUEST_DELAY_MS = 150;
const FETCH_TIMEOUT_MS = 15_000;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

async function fetchJson(url) {
  const { signal, clear } = createTimeoutSignal(FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clear();
  }
}

function parseNumber(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized || normalized === 'N/D' || normalized === 'null') {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value, digits = 4) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return Number.parseFloat(value.toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadWatchlist() {
  return readJson(path.join(process.cwd(), 'config', 'watchlist.json'));
}

function flattenWatchlist(watchlist) {
  return [
    ...(watchlist.core_etf ?? []).map((item) => ({ ...item, bucket: 'core_etf', type: 'etf' })),
    ...(watchlist.satellite_etf ?? []).map((item) => ({ ...item, bucket: 'satellite_etf', type: 'etf' })),
    ...(watchlist.individual_stocks ?? []).map((item) => ({ ...item, bucket: 'individual_stocks', type: 'stock' })),
  ];
}

async function loadMarketSnapshot(date) {
  const filePath = path.join(process.cwd(), 'data', 'market', `${date}.json`);
  return readJson(filePath);
}

async function fetchNaverSeries(urlBuilder) {
  const rows = [];

  for (let page = 1; page <= HISTORY_PAGES; page += 1) {
    const response = await fetchJson(urlBuilder(page));
    if (!Array.isArray(response) || response.length === 0) {
      break;
    }

    rows.push(...response);

    if (response.length < HISTORY_PAGE_SIZE) {
      break;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return rows;
}

function normalizeHistoryRows(rows, includeVolume = true) {
  const deduped = new Map();

  for (const row of rows) {
    const date = row.localTradedAt;
    if (!date) {
      continue;
    }

    deduped.set(date, {
      date,
      open: parseNumber(row.openPrice),
      high: parseNumber(row.highPrice),
      low: parseNumber(row.lowPrice),
      close: parseNumber(row.closePrice),
      volume: includeVolume ? parseNumber(row.accumulatedTradingVolume) : null,
      change: parseNumber(row.compareToPreviousClosePrice),
      change_pct:
        parseNumber(row.fluctuationsRatio) != null
          ? parseNumber(row.fluctuationsRatio) / 100
          : null,
    });
  }

  return [...deduped.values()]
    .filter((row) => row.close != null && row.high != null && row.low != null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

async function initHistoricalData(item) {
  const rows = await fetchNaverSeries(
    (page) =>
      `https://m.stock.naver.com/api/stock/${item.code}/price?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
  );
  return normalizeHistoryRows(rows, true);
}

async function initIndexHistoricalData(indexCode) {
  const rows = await fetchNaverSeries(
    (page) =>
      `https://m.stock.naver.com/api/index/${indexCode}/price?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
  );
  return normalizeHistoryRows(rows, false);
}

function getLatestAndPrevious(series) {
  if (!Array.isArray(series) || series.length === 0) {
    return { latest: null, previous: null };
  }

  return {
    latest: series.at(-1) ?? null,
    previous: series.at(-2) ?? null,
  };
}

function determineBollingerPosition(close, bands) {
  if (close == null || !bands) {
    return 'unknown';
  }

  if (close > bands.upper) {
    return 'above_upper';
  }
  if (close < bands.lower) {
    return 'below_lower';
  }
  if (close >= bands.middle) {
    return 'upper_half';
  }
  return 'lower_half';
}

function buildAlerts({ ma5Prev, ma20Prev, ma5, ma20, rsi, macdPrev, macd, bbPosition, volumeRatio }) {
  const alerts = [];

  if (ma5Prev != null && ma20Prev != null && ma5 != null && ma20 != null) {
    if (ma5Prev <= ma20Prev && ma5 > ma20) {
      alerts.push('골든크로스(5일/20일) 발생');
    } else if (ma5Prev >= ma20Prev && ma5 < ma20) {
      alerts.push('데드크로스(5일/20일) 발생');
    }
  }

  if (rsi != null) {
    if (rsi >= 70) {
      alerts.push('RSI 과매수 구간 진입');
    } else if (rsi <= 30) {
      alerts.push('RSI 과매도 구간 진입');
    }
  }

  if (macdPrev && macd) {
    if (macdPrev.MACD <= macdPrev.signal && macd.MACD > macd.signal) {
      alerts.push('MACD 시그널 상향 돌파');
    } else if (macdPrev.MACD >= macdPrev.signal && macd.MACD < macd.signal) {
      alerts.push('MACD 시그널 하향 이탈');
    }
  }

  if (bbPosition === 'above_upper') {
    alerts.push('볼린저밴드 상단 이탈');
  } else if (bbPosition === 'below_lower') {
    alerts.push('볼린저밴드 하단 이탈');
  }

  if (volumeRatio != null && volumeRatio >= 2) {
    alerts.push('거래량 급증(20일 평균 대비 2배 이상)');
  }

  return alerts;
}

function calcScore(metrics) {
  const {
    close,
    ma5,
    ma20,
    ma60,
    ma120,
    rsi,
    macd,
    bollinger,
    stochastic,
    adx,
    volumeRatio,
    dayChangePct,
  } = metrics;

  let score = 50;

  if (close != null && ma20 != null) {
    score += close >= ma20 ? 8 : -8;
  }
  if (ma5 != null && ma20 != null) {
    score += ma5 >= ma20 ? 8 : -8;
  }
  if (ma20 != null && ma60 != null) {
    score += ma20 >= ma60 ? 6 : -6;
  }
  if (ma60 != null && ma120 != null) {
    score += ma60 >= ma120 ? 6 : -6;
  }

  if (rsi != null) {
    if (rsi < 30) {
      score += 6;
    } else if (rsi < 45) {
      score += 3;
    } else if (rsi <= 65) {
      score += 8;
    } else if (rsi <= 75) {
      score += 2;
    } else {
      score -= 8;
    }
  }

  if (macd) {
    score += macd.MACD >= macd.signal ? 6 : -6;
    score += macd.histogram >= 0 ? 6 : -6;
  }

  if (bollinger) {
    const position = determineBollingerPosition(close, bollinger);
    if (position === 'below_lower') {
      score += 4;
    } else if (position === 'above_upper') {
      score -= 4;
    } else if (position === 'upper_half') {
      score += 1;
    }
  }

  if (stochastic) {
    if (stochastic.k < 20 && stochastic.d < 20) {
      score += 4;
    } else if (stochastic.k > 80 && stochastic.d > 80) {
      score -= 4;
    }
  }

  if (adx != null && adx.adx != null && ma20 != null && ma60 != null) {
    const trendPositive = ma20 >= ma60;
    if (adx.adx >= 25) {
      score += trendPositive ? 6 : -6;
    } else {
      score += trendPositive ? 1 : -1;
    }
  }

  if (volumeRatio != null && volumeRatio >= 2) {
    score += dayChangePct != null && dayChangePct >= 0 ? 4 : -4;
  }

  return clamp(Math.round(score), 0, 100);
}

function scoreToSignal(score) {
  if (score >= 80) {
    return 'STRONG_BUY';
  }
  if (score >= 60) {
    return 'BUY';
  }
  if (score >= 40) {
    return 'HOLD';
  }
  if (score >= 20) {
    return 'REDUCE';
  }
  return 'SELL';
}

function buildSignalReason({ score, close, ma20, ma60, rsi, macd, bollingerPosition, volumeRatio }) {
  const reasons = [];

  if (close != null && ma20 != null) {
    reasons.push(close >= ma20 ? '주가가 20일선 위에서 유지 중' : '주가가 20일선 아래에 위치');
  }

  if (ma20 != null && ma60 != null) {
    reasons.push(ma20 >= ma60 ? '중기 추세는 우상향' : '중기 추세는 약세');
  }

  if (macd) {
    reasons.push(macd.MACD >= macd.signal ? 'MACD 모멘텀이 우호적' : 'MACD 모멘텀이 둔화');
  }

  if (rsi != null) {
    if (rsi >= 70) {
      reasons.push('RSI 기준 단기 과열 구간');
    } else if (rsi <= 30) {
      reasons.push('RSI 기준 단기 과매도 구간');
    } else {
      reasons.push('RSI는 중립 범위');
    }
  }

  if (bollingerPosition === 'above_upper') {
    reasons.push('볼린저밴드 상단 돌파로 과열 경계');
  } else if (bollingerPosition === 'below_lower') {
    reasons.push('볼린저밴드 하단 이탈로 반등 구간 가능성');
  }

  if (volumeRatio != null && volumeRatio >= 2) {
    reasons.push('거래량 급증이 동반됨');
  }

  if (reasons.length === 0) {
    return score >= 45 ? '기술적 신호가 뚜렷하지 않아 중립 판단' : '기술적 약세 신호가 우세';
  }

  return reasons.slice(0, 3).join(', ');
}

function calculateIndicators(history, snapshot) {
  const closes = history.map((row) => row.close);
  const highs = history.map((row) => row.high);
  const lows = history.map((row) => row.low);
  const volumes = history.map((row) => row.volume ?? 0);

  const ma5Series = SMA.calculate({ period: 5, values: closes });
  const ma20Series = SMA.calculate({ period: 20, values: closes });
  const ma60Series = SMA.calculate({ period: 60, values: closes });
  const ma120Series = SMA.calculate({ period: 120, values: closes });
  const volumeMa20Series = SMA.calculate({ period: 20, values: volumes });
  const rsiSeries = RSI.calculate({ period: 14, values: closes });
  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const bollingerSeries = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const stochasticSeries = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3,
  });
  const adxSeries = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

  const ma5 = getLatestAndPrevious(ma5Series);
  const ma20 = getLatestAndPrevious(ma20Series);
  const ma60 = getLatestAndPrevious(ma60Series);
  const ma120 = getLatestAndPrevious(ma120Series);
  const rsi = getLatestAndPrevious(rsiSeries);
  const macd = getLatestAndPrevious(macdSeries);
  const bollinger = getLatestAndPrevious(bollingerSeries);
  const stochastic = getLatestAndPrevious(stochasticSeries);
  const adx = getLatestAndPrevious(adxSeries);
  const volumeMa20 = getLatestAndPrevious(volumeMa20Series);

  const latestClose = snapshot?.close ?? history.at(-1)?.close ?? null;
  const volumeRatio =
    snapshot?.volume != null && volumeMa20.latest != null && volumeMa20.latest !== 0
      ? snapshot.volume / volumeMa20.latest
      : null;
  const bollingerPosition = determineBollingerPosition(latestClose, bollinger.latest);

  const score = calcScore({
    close: latestClose,
    ma5: ma5.latest,
    ma20: ma20.latest,
    ma60: ma60.latest,
    ma120: ma120.latest,
    rsi: rsi.latest,
    macd: macd.latest,
    bollinger: bollinger.latest,
    stochastic: stochastic.latest,
    adx: adx.latest,
    volumeRatio,
    dayChangePct: snapshot?.change_pct ?? history.at(-1)?.change_pct ?? null,
  });

  const alerts = buildAlerts({
    ma5Prev: ma5.previous,
    ma20Prev: ma20.previous,
    ma5: ma5.latest,
    ma20: ma20.latest,
    rsi: rsi.latest,
    macdPrev: macd.previous,
    macd: macd.latest,
    bbPosition: bollingerPosition,
    volumeRatio,
  });

  return {
    score,
    signal: scoreToSignal(score),
    signal_reason: buildSignalReason({
      score,
      close: latestClose,
      ma20: ma20.latest,
      ma60: ma60.latest,
      rsi: rsi.latest,
      macd: macd.latest,
      bollingerPosition,
      volumeRatio,
    }),
    rsi: roundNumber(rsi.latest, 2),
    macd: macd.latest
      ? {
          value: roundNumber(macd.latest.MACD, 4),
          signal: roundNumber(macd.latest.signal, 4),
          histogram: roundNumber(macd.latest.histogram, 4),
        }
      : null,
    bollinger: bollinger.latest
      ? {
          upper: roundNumber(bollinger.latest.upper, 4),
          middle: roundNumber(bollinger.latest.middle, 4),
          lower: roundNumber(bollinger.latest.lower, 4),
          position: bollingerPosition,
        }
      : null,
    stochastic: stochastic.latest
      ? {
          k: roundNumber(stochastic.latest.k, 2),
          d: roundNumber(stochastic.latest.d, 2),
        }
      : null,
    adx: adx.latest
      ? {
          value: roundNumber(adx.latest.adx, 2),
          pdi: roundNumber(adx.latest.pdi, 2),
          mdi: roundNumber(adx.latest.mdi, 2),
        }
      : null,
    ma: {
      ma5: roundNumber(ma5.latest, 4),
      ma20: roundNumber(ma20.latest, 4),
      ma60: roundNumber(ma60.latest, 4),
      ma120: roundNumber(ma120.latest, 4),
    },
    volume_ratio: roundNumber(volumeRatio, 3),
    close: roundNumber(latestClose, 4),
    previous_close: roundNumber(snapshot?.previous_close ?? history.at(-2)?.close ?? null, 4),
    change_pct: roundNumber(snapshot?.change_pct ?? history.at(-1)?.change_pct ?? null, 6),
    history_points: history.length,
    alerts,
  };
}

function determineMarketSignal(indexIndicators, vix) {
  const ma20 = indexIndicators?.ma?.ma20;
  const ma60 = indexIndicators?.ma?.ma60;
  const ma120 = indexIndicators?.ma?.ma120;
  const close = indexIndicators?.close;

  if (vix != null && vix >= 30) {
    return 'HIGH_VOLATILITY';
  }

  if (close != null && ma20 != null && ma60 != null && ma120 != null) {
    if (close >= ma20 && ma20 >= ma60 && ma60 >= ma120) {
      return 'BULLISH';
    }
    if (close < ma20 && ma20 < ma60) {
      return 'BEARISH';
    }
  }

  return 'NEUTRAL';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const market = await loadMarketSnapshot(args.date);
  const watchlist = await loadWatchlist();
  const items = flattenWatchlist(watchlist);

  const output = {
    date: args.date,
    generated_at: new Date().toISOString(),
    market_context: {},
    scores: {},
  };

  try {
    const kospiHistory = await initIndexHistoricalData('KOSPI');
    const kospiIndicators = calculateIndicators(kospiHistory, market.indices?.KOSPI ?? null);
    const vix = market.macro?.VIX?.close ?? null;
    output.market_context = {
      index: 'KOSPI',
      signal: determineMarketSignal(kospiIndicators, vix),
      vix: roundNumber(vix, 4),
      score: kospiIndicators.score,
      close: kospiIndicators.close,
      ma: kospiIndicators.ma,
      rsi: kospiIndicators.rsi,
      alerts: kospiIndicators.alerts,
    };
    console.log('- 시장 컨텍스트 계산 완료');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ 시장 컨텍스트 계산 실패: ${message}`);
  }

  for (const item of items) {
    try {
      const history = await initHistoricalData(item);
      if (history.length < 120) {
        console.warn(`⚠️ ${item.name}: 과거 데이터가 부족해 일부 지표 품질이 낮을 수 있습니다 (${history.length}개)`);
      }

      const snapshot = market.watchlist?.[item.code] ?? null;
      const indicators = calculateIndicators(history, snapshot);

      output.scores[item.code] = {
        code: item.code,
        name: snapshot?.name ?? item.name,
        account: item.account ?? null,
        bucket: item.bucket,
        type: item.type,
        ...indicators,
      };

      console.log(`- ${item.name} 기술적 분석 완료`);
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ ${item.name} 기술적 분석 실패: ${message}`);
    }
  }

  const outputPath = path.join(process.cwd(), 'data', 'technical', `${args.date}.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('✅ 기술적 분석 저장 완료');
  console.log(`📁 ${outputPath}`);
}

main().catch((error) => {
  console.error(`❌ calc-technicals 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
