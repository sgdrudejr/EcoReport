#!/usr/bin/env node
// 관심 종목과 ETF의 기술적 지표 및 종합 점수를 계산하는 스크립트입니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { config as loadEnv } from 'dotenv';
import fetch from 'node-fetch';
import {
  ADX,
  ATR,
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
  try {
    return await readJson(filePath);
  } catch {
    return {
      date,
      indices: {},
      macro: {},
      watchlist: {},
      fallback: {
        kind: 'market',
        reason: 'market snapshot missing',
        recoveredFromDate: null,
      },
    };
  }
}

async function loadPreviousTechnicalSnapshot(date) {
  const technicalDir = path.join(process.cwd(), 'data', 'technical');

  try {
    const entries = await fs.readdir(technicalDir, { withFileTypes: true });
    const previousFile = entries
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => name.slice(0, 10) < date)
      .sort()
      .at(-1);

    if (!previousFile) {
      return null;
    }

    const snapshot = await readJson(path.join(technicalDir, previousFile));
    return {
      date: previousFile.slice(0, 10),
      snapshot,
    };
  } catch {
    return null;
  }
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

function alignSeries(sourceLength, values) {
  const padding = Math.max(sourceLength - values.length, 0);
  return Array.from({ length: padding }, () => null).concat(values);
}

function findPivotIndexes(values, mode, left = 2, right = 2) {
  const pivots = [];

  for (let index = left; index < values.length - right; index += 1) {
    const pivot = values[index];
    if (pivot == null || Number.isNaN(pivot)) {
      continue;
    }

    let isPivot = true;

    for (let offset = 1; offset <= left; offset += 1) {
      const candidate = values[index - offset];
      if (candidate == null || Number.isNaN(candidate)) {
        isPivot = false;
        break;
      }

      if (mode === 'low' ? pivot > candidate : pivot < candidate) {
        isPivot = false;
        break;
      }
    }

    if (!isPivot) {
      continue;
    }

    for (let offset = 1; offset <= right; offset += 1) {
      const candidate = values[index + offset];
      if (candidate == null || Number.isNaN(candidate)) {
        isPivot = false;
        break;
      }

      if (mode === 'low' ? pivot > candidate : pivot < candidate) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      pivots.push(index);
    }
  }

  return pivots;
}

function detectRsiDivergence(history, rsiSeries) {
  if (!Array.isArray(history) || history.length < 25 || !Array.isArray(rsiSeries) || rsiSeries.length < 10) {
    return {
      type: 'none',
      strength: 'low',
      summary: 'RSI 다이버전스를 판별하기 위한 최근 데이터가 충분하지 않습니다.',
    };
  }

  const lookback = Math.min(45, history.length);
  const startIndex = history.length - lookback;
  const lows = history.slice(startIndex).map((row) => row.low);
  const highs = history.slice(startIndex).map((row) => row.high);
  const alignedRsi = alignSeries(history.length, rsiSeries).slice(startIndex);
  const lowPivots = findPivotIndexes(lows, 'low').filter((index) => alignedRsi[index] != null);
  const highPivots = findPivotIndexes(highs, 'high').filter((index) => alignedRsi[index] != null);
  const latestLowPair = lowPivots.length >= 2 ? lowPivots.slice(-2) : null;
  const latestHighPair = highPivots.length >= 2 ? highPivots.slice(-2) : null;

  const bullish =
    latestLowPair &&
    lows[latestLowPair[1]] < lows[latestLowPair[0]] * 0.997 &&
    alignedRsi[latestLowPair[1]] > alignedRsi[latestLowPair[0]] + 3;

  const bearish =
    latestHighPair &&
    highs[latestHighPair[1]] > highs[latestHighPair[0]] * 1.003 &&
    alignedRsi[latestHighPair[1]] < alignedRsi[latestHighPair[0]] - 3;

  if (bullish && latestLowPair) {
    const [previousIndex, latestIndex] = latestLowPair;
    return {
      type: 'bullish',
      strength: alignedRsi[latestIndex] >= 45 ? 'high' : 'medium',
      summary: `최근 저점은 낮아졌지만 RSI 저점은 높아져 강세 다이버전스가 보입니다 (${history[startIndex + previousIndex].date} → ${history[startIndex + latestIndex].date}).`,
      reference: {
        previousDate: history[startIndex + previousIndex].date,
        latestDate: history[startIndex + latestIndex].date,
        previousPrice: roundNumber(lows[previousIndex], 4),
        latestPrice: roundNumber(lows[latestIndex], 4),
        previousRsi: roundNumber(alignedRsi[previousIndex], 2),
        latestRsi: roundNumber(alignedRsi[latestIndex], 2),
      },
    };
  }

  if (bearish && latestHighPair) {
    const [previousIndex, latestIndex] = latestHighPair;
    return {
      type: 'bearish',
      strength: alignedRsi[latestIndex] <= 55 ? 'high' : 'medium',
      summary: `최근 고점은 높아졌지만 RSI 고점은 낮아져 약세 다이버전스가 보입니다 (${history[startIndex + previousIndex].date} → ${history[startIndex + latestIndex].date}).`,
      reference: {
        previousDate: history[startIndex + previousIndex].date,
        latestDate: history[startIndex + latestIndex].date,
        previousPrice: roundNumber(highs[previousIndex], 4),
        latestPrice: roundNumber(highs[latestIndex], 4),
        previousRsi: roundNumber(alignedRsi[previousIndex], 2),
        latestRsi: roundNumber(alignedRsi[latestIndex], 2),
      },
    };
  }

  return {
    type: 'none',
    strength: 'low',
    summary: '최근 구간에서는 뚜렷한 RSI 다이버전스가 보이지 않습니다.',
  };
}

function createBias(side, summary, extra = {}) {
  return {
    side,
    label: side === 'buy_side' ? '매수 쪽' : side === 'sell_side' ? '매도 쪽' : '중립',
    summary,
    ...extra,
  };
}

function analyzeRsi(rsi, divergence) {
  if (rsi == null) {
    return createBias('neutral', 'RSI 데이터가 부족합니다.', {
      value: null,
      divergence: divergence?.type ?? 'none',
    });
  }

  if (divergence?.type === 'bullish') {
    return createBias('buy_side', `RSI ${roundNumber(rsi, 2)}로 중립권이지만 강세 다이버전스가 확인됩니다.`, {
      value: roundNumber(rsi, 2),
      divergence: 'bullish',
      strength: divergence.strength,
    });
  }

  if (divergence?.type === 'bearish') {
    return createBias('sell_side', `RSI ${roundNumber(rsi, 2)}와 함께 약세 다이버전스가 확인됩니다.`, {
      value: roundNumber(rsi, 2),
      divergence: 'bearish',
      strength: divergence.strength,
    });
  }

  if (rsi <= 35) {
    return createBias('buy_side', `RSI ${roundNumber(rsi, 2)}로 과매도에 가까워 매수 쪽 신호가 강합니다.`, {
      value: roundNumber(rsi, 2),
      divergence: 'none',
      strength: rsi <= 30 ? 'high' : 'medium',
    });
  }

  if (rsi >= 65) {
    return createBias('sell_side', `RSI ${roundNumber(rsi, 2)}로 과매수에 가까워 매도 쪽 경계가 필요합니다.`, {
      value: roundNumber(rsi, 2),
      divergence: 'none',
      strength: rsi >= 70 ? 'high' : 'medium',
    });
  }

  return createBias('neutral', `RSI ${roundNumber(rsi, 2)}로 중립 구간입니다.`, {
    value: roundNumber(rsi, 2),
    divergence: 'none',
    strength: 'low',
  });
}

function analyzeMacd(macd, macdPrev) {
  if (!macd) {
    return createBias('neutral', 'MACD 데이터가 부족합니다.');
  }

  const crossedUp =
    macdPrev &&
    macdPrev.MACD <= macdPrev.signal &&
    macd.MACD > macd.signal;
  const crossedDown =
    macdPrev &&
    macdPrev.MACD >= macdPrev.signal &&
    macd.MACD < macd.signal;

  if (crossedUp || (macd.MACD >= macd.signal && macd.histogram >= 0)) {
    return createBias(
      'buy_side',
      crossedUp
        ? 'MACD가 시그널선을 상향 돌파해 매수 쪽으로 기울었습니다.'
        : 'MACD가 시그널선 위에 있고 히스토그램도 플러스라 매수 쪽 모멘텀이 우세합니다.',
      {
        value: roundNumber(macd.MACD, 4),
        signal: roundNumber(macd.signal, 4),
        histogram: roundNumber(macd.histogram, 4),
        crossover: crossedUp ? 'bullish' : 'none',
      },
    );
  }

  if (crossedDown || (macd.MACD < macd.signal && macd.histogram < 0)) {
    return createBias(
      'sell_side',
      crossedDown
        ? 'MACD가 시그널선을 하향 이탈해 매도 쪽으로 기울었습니다.'
        : 'MACD가 시그널선 아래에 있고 히스토그램도 마이너스라 매도 쪽 모멘텀이 우세합니다.',
      {
        value: roundNumber(macd.MACD, 4),
        signal: roundNumber(macd.signal, 4),
        histogram: roundNumber(macd.histogram, 4),
        crossover: crossedDown ? 'bearish' : 'none',
      },
    );
  }

  return createBias('neutral', 'MACD가 방향을 고르는 중이라 아직 중립에 가깝습니다.', {
    value: roundNumber(macd.MACD, 4),
    signal: roundNumber(macd.signal, 4),
    histogram: roundNumber(macd.histogram, 4),
    crossover: 'none',
  });
}

function analyzeBollinger(close, bollinger, position) {
  if (close == null || !bollinger) {
    return createBias('neutral', '볼린저밴드 데이터가 부족합니다.');
  }

  const range = bollinger.upper - bollinger.lower;
  const distanceRatio = range > 0 ? (close - bollinger.lower) / range : null;

  if (position === 'below_lower' || (distanceRatio != null && distanceRatio <= 0.18)) {
    return createBias('buy_side', '가격이 볼린저 하단에 가까워 단기 반등 관점의 매수 쪽에 가깝습니다.', {
      position,
      distanceRatio: roundNumber(distanceRatio, 3),
    });
  }

  if (position === 'above_upper' || (distanceRatio != null && distanceRatio >= 0.82)) {
    return createBias('sell_side', '가격이 볼린저 상단에 가까워 단기 과열에 따른 매도 쪽 경계가 필요합니다.', {
      position,
      distanceRatio: roundNumber(distanceRatio, 3),
    });
  }

  return createBias('neutral', '가격이 볼린저 중단 부근에 있어 중립에 가깝습니다.', {
    position,
    distanceRatio: roundNumber(distanceRatio, 3),
  });
}

function analyzeMovingAverages(close, ma5, ma20, ma60, ma120) {
  if (close == null || ma20 == null) {
    return createBias('neutral', '이평선 데이터가 부족합니다.');
  }

  const trendUp =
    ma5 != null &&
    ma20 != null &&
    ma60 != null &&
    ma5 >= ma20 &&
    ma20 >= ma60;
  const trendDown =
    ma5 != null &&
    ma20 != null &&
    ma60 != null &&
    ma5 <= ma20 &&
    ma20 <= ma60;

  if (close >= ma20 && trendUp) {
    return createBias('buy_side', '주가가 20일선 위에 있고 단기·중기 이평선 배열도 우상향이라 매수 쪽입니다.', {
      above20: true,
      trend: 'up',
    });
  }

  if (close < ma20 && trendDown) {
    return createBias('sell_side', '주가가 20일선 아래에 있고 이평선 배열도 역배열에 가까워 매도 쪽입니다.', {
      above20: false,
      trend: 'down',
    });
  }

  const longTrendUp = ma60 != null && ma120 != null ? ma60 >= ma120 : null;
  return createBias(
    close >= ma20 || longTrendUp
      ? 'neutral'
      : 'sell_side',
    close >= ma20
      ? '주가는 20일선 위지만 이평선 배열이 완전히 정리되진 않아 중립입니다.'
      : longTrendUp
        ? '주가는 눌려 있지만 장기 추세가 완전히 꺾이진 않아 중립 구간입니다.'
        : '주가와 중기 추세가 모두 약해 매도 쪽에 더 가깝습니다.',
    {
      above20: close >= ma20,
      trend: longTrendUp ? 'mixed' : 'down',
    },
  );
}

function summarizeExecutionBias(indicators) {
  const sideScore = (side) => {
    if (side === 'buy_side') return 1;
    if (side === 'sell_side') return -1;
    return 0;
  };

  const weightedScore =
    sideScore(indicators.rsi.side) * 1.2 +
    sideScore(indicators.macd.side) * 1 +
    sideScore(indicators.bollinger.side) * 0.8 +
    sideScore(indicators.movingAverage.side) * 1;

  if (weightedScore >= 1.5) {
    return createBias('buy_side', '여러 기술 지표가 매수 쪽에 더 가깝습니다.');
  }

  if (weightedScore <= -1.5) {
    return createBias('sell_side', '여러 기술 지표가 매도 쪽에 더 가깝습니다.');
  }

  return createBias('neutral', '기술 지표가 엇갈려 현재는 중립 또는 관망에 가깝습니다.');
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

function computeRecentHigh(highs, window = 20) {
  const series = highs.slice(-window).filter((value) => value != null);
  if (!series.length) {
    return null;
  }
  return Math.max(...series);
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
  const atrSeries = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

  const ma5 = getLatestAndPrevious(ma5Series);
  const ma20 = getLatestAndPrevious(ma20Series);
  const ma60 = getLatestAndPrevious(ma60Series);
  const ma120 = getLatestAndPrevious(ma120Series);
  const rsi = getLatestAndPrevious(rsiSeries);
  const macd = getLatestAndPrevious(macdSeries);
  const bollinger = getLatestAndPrevious(bollingerSeries);
  const stochastic = getLatestAndPrevious(stochasticSeries);
  const adx = getLatestAndPrevious(adxSeries);
  const atr = getLatestAndPrevious(atrSeries);
  const volumeMa20 = getLatestAndPrevious(volumeMa20Series);

  const latestClose = snapshot?.close ?? history.at(-1)?.close ?? null;
  const atrPct =
    latestClose != null && atr.latest != null && latestClose !== 0
      ? atr.latest / latestClose
      : null;
  const volumeRatio =
    snapshot?.volume != null && volumeMa20.latest != null && volumeMa20.latest !== 0
      ? snapshot.volume / volumeMa20.latest
      : null;
  const bollingerPosition = determineBollingerPosition(latestClose, bollinger.latest);
  const recentHighWindow = 20;
  const recentHigh = computeRecentHigh(highs, recentHighWindow);

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
    atr: atr.latest != null
      ? {
          value: roundNumber(atr.latest, 4),
          pct: roundNumber(atrPct, 6),
        }
      : null,
    ma: {
      ma5: roundNumber(ma5.latest, 4),
      ma20: roundNumber(ma20.latest, 4),
      ma60: roundNumber(ma60.latest, 4),
      ma120: roundNumber(ma120.latest, 4),
    },
    recent_high: {
      window: recentHighWindow,
      value: roundNumber(recentHigh, 4),
      distance_pct:
        recentHigh != null && latestClose != null && recentHigh !== 0
          ? roundNumber((latestClose - recentHigh) / recentHigh, 6)
          : null,
    },
    volume_ratio: roundNumber(volumeRatio, 3),
    close: roundNumber(latestClose, 4),
    previous_close: roundNumber(snapshot?.previous_close ?? history.at(-2)?.close ?? null, 4),
    change_pct: roundNumber(snapshot?.change_pct ?? history.at(-1)?.change_pct ?? null, 6),
    history_points: history.length,
    alerts,
    technical_analysis: {
      execution_bias: executionBias,
      indicators: indicatorAnalysis,
      rsi_divergence: rsiDivergence,
    },
    // 최근 60일 일별 수익률 — CVaR/MaxDrawdown 계산에 활용
    daily_returns: closes.length >= 2
      ? closes.slice(-61).reduce((acc, price, idx, arr) => {
          if (idx === 0) return acc;
          const ret = roundNumber((price - arr[idx - 1]) / arr[idx - 1], 6);
          if (ret != null) acc.push(ret);
          return acc;
        }, [])
      : [],
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
  const [market, priorTechnical] = await Promise.all([
    loadMarketSnapshot(args.date),
    loadPreviousTechnicalSnapshot(args.date),
  ]);
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
    if (priorTechnical?.snapshot?.market_context) {
      output.market_context = {
        ...priorTechnical.snapshot.market_context,
        fallback: {
          source: 'previous_technical_snapshot',
          recovered_from_date: priorTechnical.date,
          reason: message,
        },
      };
    }
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
      const fallbackIndicators = priorTechnical?.snapshot?.scores?.[item.code] ?? null;
      if (fallbackIndicators) {
        output.scores[item.code] = {
          ...fallbackIndicators,
          code: item.code,
          name: fallbackIndicators.name ?? item.name,
          account: fallbackIndicators.account ?? item.account ?? null,
          bucket: fallbackIndicators.bucket ?? item.bucket,
          type: fallbackIndicators.type ?? item.type,
          fallback: {
            source: 'previous_technical_snapshot',
            recovered_from_date: priorTechnical.date,
            reason: message,
          },
        };
      }
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
