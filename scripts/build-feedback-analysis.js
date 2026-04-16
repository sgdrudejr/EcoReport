#!/usr/bin/env node
// F1: 저장된 스냅샷을 실제 수익률과 연결해 score/팩터 예측력을 분석합니다.

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

const DEFAULT_HORIZONS = [5, 10, 20];
const DEFAULT_AUTO_ADJUST = {
  enabled: true,
  source: "data/feedback/latest-feedback.json",
  primaryHorizonDays: 10,
  minSamples: 24,
  minWeightMultiplier: 0.6,
  maxWeightMultiplier: 1.4,
  sensitivity: 1.1,
};
const BUY_SIGNALS = new Set(["BUY", "SELECTIVE_ADD", "AGGRESSIVE_ADD"]);
const TRIM_SIGNALS = new Set(["REDUCE", "TRIM"]);

function toNumber(value, digits = 4) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values, center = mean(values) ?? 0) {
  if (values.length <= 1) return 0;
  return (
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    (values.length - 1)
  );
}

function pearsonCorrelation(points) {
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const meanX = mean(xs);
  const meanY = mean(ys);
  if (meanX == null || meanY == null) return null;
  const stdX = Math.sqrt(variance(xs, meanX));
  const stdY = Math.sqrt(variance(ys, meanY));
  if (stdX <= 1e-9 || stdY <= 1e-9) return null;

  let covariance = 0;
  for (let index = 0; index < points.length; index += 1) {
    covariance += (points[index].x - meanX) * (points[index].y - meanY);
  }

  return covariance / ((points.length - 1) * stdX * stdY);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchNaverPrices(code, count = 90) {
  try {
    const items = await fetchJson(`https://m.stock.naver.com/api/stock/${code}/price?page=1&pageSize=${count}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://finance.naver.com",
      },
    });

    if (!Array.isArray(items)) return {};
    const prices = {};
    for (const item of items) {
      let date = item?.localTradedAt ?? item?.localDate ?? item?.date ?? null;
      const close = item?.closePrice ?? item?.close ?? item?.endPrice ?? null;
      if (!date || close == null) continue;
      date = String(date);
      if (/^\d{8}$/.test(date)) {
        date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      }
      const numeric = Number(String(close).replaceAll(",", ""));
      if (Number.isFinite(numeric)) {
        prices[date] = numeric;
      }
    }
    return prices;
  } catch {
    return {};
  }
}

async function fetchStooqPrices(symbol) {
  try {
    const csv = await fetchText(`https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}&i=d`);
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return {};
    const prices = {};
    for (const line of lines.slice(1)) {
      const [date, , , , close] = line.split(",");
      const numeric = Number(close);
      if (date && Number.isFinite(numeric)) {
        prices[date.trim()] = numeric;
      }
    }
    return prices;
  } catch {
    return {};
  }
}

const priceCache = new Map();

async function getPrices(code) {
  if (priceCache.has(code)) {
    return priceCache.get(code);
  }

  let prices = {};
  if (!code || String(code).startsWith("ACCOUNT:")) {
    prices = {};
  } else if (/^\d{6}$/.test(String(code))) {
    prices = await fetchNaverPrices(String(code));
    if (!Object.keys(prices).length) {
      prices = await fetchStooqPrices(`${code}.KS`);
    }
  } else if (String(code).endsWith(".KS") || String(code).endsWith(".KQ")) {
    prices = await fetchStooqPrices(String(code));
  } else {
    prices = await fetchStooqPrices(String(code));
  }

  priceCache.set(code, prices);
  return prices;
}

function getForwardReturn(prices, signalDate, days) {
  const dates = Object.keys(prices).sort();
  const entryDate = dates.find((date) => date >= signalDate);
  if (!entryDate) return null;
  const entryIndex = dates.indexOf(entryDate);
  const exitIndex = entryIndex + days;
  if (exitIndex >= dates.length) return null;
  const entryPrice = prices[entryDate];
  const exitPrice = prices[dates[exitIndex]];
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice === 0) {
    return null;
  }
  return ((exitPrice - entryPrice) / entryPrice) * 100;
}

async function listSnapshotFiles() {
  const dir = path.join(ROOT_DIR, "data", "feedback", "snapshots");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function signalDirection(signal) {
  if (BUY_SIGNALS.has(signal)) return 1;
  if (TRIM_SIGNALS.has(signal)) return -1;
  return 0;
}

function normalizeWeights(weights) {
  const safeWeights = Object.fromEntries(
    Object.entries(weights ?? {}).map(([key, value]) => [
      key,
      typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : 0,
    ]),
  );
  const total = Object.values(safeWeights).reduce((sum, value) => sum + value, 0);
  if (total <= 1e-9) return safeWeights;
  return Object.fromEntries(
    Object.entries(safeWeights).map(([key, value]) => [key, Number((value / total).toFixed(4))]),
  );
}

function buildWeightSuggestions(baseWeights, factorMetrics, config) {
  const normalizedBase = normalizeWeights(baseWeights);
  const adjustedRaw = {};
  const reasoning = [];

  for (const [factorName, baseWeight] of Object.entries(normalizedBase)) {
    const metric = factorMetrics?.[factorName] ?? null;
    const correlation =
      typeof metric?.correlation === "number" ? metric.correlation : null;
    const sampleCount = metric?.sampleCount ?? 0;
    let multiplier = 1;

    if (correlation != null && sampleCount >= (config.minSamples ?? 0)) {
      multiplier = Math.min(
        config.maxWeightMultiplier ?? 1.4,
        Math.max(
          config.minWeightMultiplier ?? 0.6,
          1 + correlation * (config.sensitivity ?? 1.1),
        ),
      );
    }

    adjustedRaw[factorName] = baseWeight * multiplier;
    reasoning.push({
      factor: factorName,
      baseWeight: toNumber(baseWeight),
      multiplier: toNumber(multiplier),
      correlation: toNumber(correlation),
      sampleCount,
    });
  }

  const normalizedSuggested = normalizeWeights(adjustedRaw);
  const deltas = Object.fromEntries(
    Object.keys(normalizedBase).map((factorName) => [
      factorName,
      toNumber(
        (normalizedSuggested[factorName] ?? 0) - (normalizedBase[factorName] ?? 0),
      ),
    ]),
  );

  return {
    baseWeights: normalizedBase,
    suggestedWeights: normalizedSuggested,
    deltas,
    reasoning,
  };
}

function summarizeSignalStats(evaluations, horizons) {
  const output = {};

  for (const horizon of horizons) {
    const horizonKey = `ret_${horizon}d`;
    const stats = {};
    for (const signal of new Set(evaluations.map((item) => item.signal).filter(Boolean))) {
      const items = evaluations.filter((item) => item.signal === signal && typeof item[horizonKey] === "number");
      const returns = items.map((item) => item[horizonKey]);
      if (!returns.length) continue;

      let hitRate = null;
      if (BUY_SIGNALS.has(signal)) {
        hitRate = returns.filter((value) => value > 0).length / returns.length;
      } else if (TRIM_SIGNALS.has(signal)) {
        hitRate = returns.filter((value) => value < 0).length / returns.length;
      }

      stats[signal] = {
        count: returns.length,
        avgReturnPct: toNumber(mean(returns)),
        hitRate: toNumber(hitRate),
        bestPct: toNumber(Math.max(...returns)),
        worstPct: toNumber(Math.min(...returns)),
      };
    }
    output[horizonKey] = stats;
  }

  return output;
}

function summarizeRegimeStats(evaluations, horizons) {
  const output = {};
  for (const horizon of horizons) {
    const horizonKey = `ret_${horizon}d`;
    const regimes = {};
    for (const regimeName of new Set(
      evaluations.map((item) => item.regimeName).filter(Boolean),
    )) {
      const items = evaluations.filter(
        (item) => item.regimeName === regimeName && typeof item[horizonKey] === "number",
      );
      const returns = items.map((item) => item[horizonKey]);
      if (!returns.length) continue;
      regimes[regimeName] = {
        sampleCount: returns.length,
        avgReturnPct: toNumber(mean(returns)),
        scoreCorrelation: toNumber(
          pearsonCorrelation(
            items.map((item) => ({ x: item.actionScore, y: item[horizonKey] })),
          ),
        ),
        buyHitRate: toNumber(
          (() => {
            const buyItems = items.filter((item) => BUY_SIGNALS.has(item.signal));
            if (!buyItems.length) return null;
            return (
              buyItems.filter((item) => item[horizonKey] > 0).length / buyItems.length
            );
          })(),
        ),
      };
    }
    output[horizonKey] = regimes;
  }
  return output;
}

function buildMispredictions(evaluations, primaryHorizonDays) {
  const horizonKey = `ret_${primaryHorizonDays}d`;
  return evaluations
    .filter((item) => typeof item[horizonKey] === "number")
    .map((item) => {
      const expectedDirection = signalDirection(item.signal);
      const actualDirection = Math.sign(item[horizonKey]);
      const mismatch =
        expectedDirection === 0
          ? Math.abs(item[horizonKey])
          : expectedDirection !== actualDirection && actualDirection !== 0
            ? Math.abs(item[horizonKey]) * (1 + Math.abs((item.actionScore ?? 50) - 50) / 50)
            : 0;

      return {
        date: item.date,
        code: item.code,
        name: item.name,
        accountKey: item.accountKey,
        signal: item.signal,
        actionScore: item.actionScore,
        regimeName: item.regimeName,
        returnPct: toNumber(item[horizonKey]),
        mismatchScore: mismatch,
        factors: item.factors,
        warnings: item.warnings,
      };
    })
    .filter((item) => item.mismatchScore > 0)
    .sort((left, right) => right.mismatchScore - left.mismatchScore)
    .slice(0, 12)
    .map(({ mismatchScore, ...item }) => item);
}

function buildAlerts(factorMetrics, primaryHorizonDays) {
  const horizonKey = `ret_${primaryHorizonDays}d`;
  return Object.entries(factorMetrics)
    .map(([factor, metric]) => {
      const horizonMetric = metric?.[horizonKey];
      if (!horizonMetric || horizonMetric.sampleCount < 8) return null;
      const correlation = horizonMetric.correlation;
      if (typeof correlation !== "number") return null;
      if (correlation <= -0.15) {
        return {
          level: "warning",
          factor,
          message: `${factor} 팩터가 최근 ${primaryHorizonDays}일 기준 역방향 상관을 보였습니다.`,
          correlation: toNumber(correlation),
        };
      }
      if (correlation >= 0.2) {
        return {
          level: "positive",
          factor,
          message: `${factor} 팩터가 최근 ${primaryHorizonDays}일 기준 상대적으로 잘 맞았습니다.`,
          correlation: toNumber(correlation),
        };
      }
      return null;
    })
    .filter(Boolean);
}

function averageHitRate(stats, signals) {
  let weightedSum = 0;
  let totalCount = 0;

  for (const signal of signals) {
    const item = stats?.[signal];
    const count = Number(item?.count ?? 0);
    const hitRate = item?.hitRate;
    if (count > 0 && typeof hitRate === "number" && Number.isFinite(hitRate)) {
      weightedSum += hitRate * count;
      totalCount += count;
    }
  }

  if (totalCount <= 0) return null;
  return toNumber(weightedSum / totalCount);
}

function buildLegacyWeightSuggestions(weightSummary, factorPrimaryMetrics) {
  return Object.entries(weightSummary?.deltas ?? {}).map(([factor, delta]) => {
    const metric = factorPrimaryMetrics?.[factor] ?? null;
    let suggestion = "최근 피드백 기준으로 가중치 유지";
    if (typeof delta === "number" && delta >= 0.03) {
      suggestion = "최근 피드백 기준으로 가중치 확대";
    } else if (typeof delta === "number" && delta <= -0.03) {
      suggestion = "최근 피드백 기준으로 가중치 축소";
    }

    return {
      factor,
      correlation_5d: toNumber(metric?.correlation),
      suggestion,
    };
  });
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const horizons = DEFAULT_HORIZONS;
  const analysisDate = args.date;
  const outputPath =
    args.output ??
    path.join(ROOT_DIR, "data", "feedback", "analysis", `${analysisDate}-feedback.json`);
  const latestOutputPath = path.join(ROOT_DIR, "data", "feedback", "latest-feedback.json");

  const strategy = await readJson(path.join(ROOT_DIR, "config", "strategy.json"), {});
  const baseWeights = {
    momentum: 0.35,
    research: 0.3,
    income: 0.15,
    macroFit: 0.2,
    ...(strategy?.scoring?.factorModel?.weights ?? {}),
  };
  const autoAdjust = {
    ...DEFAULT_AUTO_ADJUST,
    ...(strategy?.scoring?.factorModel?.autoAdjust ?? {}),
  };

  const snapshotFiles = await listSnapshotFiles();
  const snapshots = (
    await Promise.all(snapshotFiles.map((filePath) => readJson(filePath, null)))
  ).filter(Boolean);

  const maturedSnapshots = snapshots.filter(
    (snapshot) => String(snapshot?.date ?? "") <= analysisDate,
  );
  const uniqueCodes = new Set();
  for (const snapshot of maturedSnapshots) {
    for (const position of snapshot.positions ?? []) {
      if (position?.code) {
        uniqueCodes.add(position.code);
      }
    }
  }

  for (const code of uniqueCodes) {
    await getPrices(code);
  }

  const evaluations = [];
  for (const snapshot of maturedSnapshots) {
    for (const position of snapshot.positions ?? []) {
      const prices = priceCache.get(position.code) ?? {};
      const record = {
        date: snapshot.date,
        code: position.code,
        name: position.name,
        accountKey: position.accountKey,
        signal: position.signal,
        actionScore: position.actionScore,
        regimeName: snapshot.regime?.name ?? "UNKNOWN",
        factors: {
          raw: position.factors?.raw ?? {},
          zScores: position.factors?.zScores ?? {},
        },
        warnings: position.explain?.warnings ?? [],
      };

      for (const horizon of horizons) {
        record[`ret_${horizon}d`] = toNumber(
          getForwardReturn(prices, snapshot.date, horizon),
        );
      }
      evaluations.push(record);
    }
  }

  const scoreReturnCorrelation = Object.fromEntries(
    horizons.map((horizon) => {
      const horizonKey = `ret_${horizon}d`;
      const points = evaluations
        .filter(
          (item) =>
            typeof item.actionScore === "number" && typeof item[horizonKey] === "number",
        )
        .map((item) => ({ x: item.actionScore, y: item[horizonKey] }));
      return [
        horizonKey,
        {
          correlation: toNumber(pearsonCorrelation(points)),
          sampleCount: points.length,
        },
      ];
    }),
  );

  const factorMetrics = {};
  for (const factorName of Object.keys(baseWeights)) {
    factorMetrics[factorName] = Object.fromEntries(
      horizons.map((horizon) => {
        const horizonKey = `ret_${horizon}d`;
        const points = evaluations
          .filter(
            (item) =>
              typeof item.factors?.zScores?.[factorName] === "number" &&
              typeof item[horizonKey] === "number",
          )
          .map((item) => ({
            x: item.factors.zScores[factorName],
            y: item[horizonKey],
          }));
        return [
          horizonKey,
          {
            correlation: toNumber(pearsonCorrelation(points)),
            sampleCount: points.length,
          },
        ];
      }),
    );
  }

  const primaryHorizonDays = autoAdjust.primaryHorizonDays ?? 10;
  const primaryHorizonKey = `ret_${primaryHorizonDays}d`;
  const factorPrimaryMetrics = Object.fromEntries(
    Object.entries(factorMetrics).map(([factorName, metric]) => [
      factorName,
      {
        correlation: metric?.[primaryHorizonKey]?.correlation ?? null,
        sampleCount: metric?.[primaryHorizonKey]?.sampleCount ?? 0,
      },
    ]),
  );
  const weightSuggestions = buildWeightSuggestions(
    baseWeights,
    factorPrimaryMetrics,
    autoAdjust,
  );
  const signalAccuracy = summarizeSignalStats(evaluations, horizons);
  const factorPredictivePower = factorMetrics;
  const regimeAccuracy = summarizeRegimeStats(evaluations, horizons);
  const worstMispredictions = buildMispredictions(evaluations, primaryHorizonDays);
  const alerts = buildAlerts(factorMetrics, primaryHorizonDays);
  const scoreReturnCorrelationWithLegacyKeys = {
    ...scoreReturnCorrelation,
    actionScore_vs_ret5d: scoreReturnCorrelation.ret_5d?.correlation ?? null,
    actionScore_vs_ret10d: scoreReturnCorrelation.ret_10d?.correlation ?? null,
    actionScore_vs_ret20d: scoreReturnCorrelation.ret_20d?.correlation ?? null,
  };
  const signalHitRates = {
    buy_hit_5d: averageHitRate(signalAccuracy.ret_5d, ["BUY", "SELECTIVE_ADD", "AGGRESSIVE_ADD"]),
    hold_hit_5d: averageHitRate(signalAccuracy.ret_5d, ["HOLD", "WATCH"]),
    trim_negative_5d: averageHitRate(signalAccuracy.ret_5d, ["TRIM", "REDUCE"]),
  };
  const factorCorrelations = Object.fromEntries(
    Object.entries(factorPredictivePower).map(([factor, metric]) => [
      factor,
      {
        vs_ret5d: metric?.ret_5d?.correlation ?? null,
        vs_ret10d: metric?.ret_10d?.correlation ?? null,
        count: metric?.ret_5d?.sampleCount ?? null,
      },
    ]),
  );
  const legacyWeightSuggestions = buildLegacyWeightSuggestions(
    weightSuggestions,
    factorPrimaryMetrics,
  );

  const payload = {
    analysisDate,
    generatedAt: new Date().toISOString(),
    snapshotDates: maturedSnapshots.map((snapshot) => snapshot.date),
    snapshotCount: maturedSnapshots.length,
    positionCount: evaluations.length,
    sampleSize: evaluations.length,
    horizons,
    scoreReturnCorrelation: scoreReturnCorrelationWithLegacyKeys,
    signalAccuracy,
    signalHitRates,
    factorPredictivePower,
    factorCorrelations,
    regimeAccuracy,
    worstMispredictions,
    alerts,
    weightSuggestions: legacyWeightSuggestions,
    autoAdjustment: {
      enabled: autoAdjust.enabled !== false,
      primaryHorizonDays,
      minSamples: autoAdjust.minSamples ?? 24,
      baseWeights: weightSuggestions.baseWeights,
      suggestedWeights: weightSuggestions.suggestedWeights,
      deltas: weightSuggestions.deltas,
      reasoning: weightSuggestions.reasoning,
      readyFactors: weightSuggestions.reasoning.filter(
        (item) => item.sampleCount >= (autoAdjust.minSamples ?? 24),
      ).length,
      source: autoAdjust.source,
    },
  };

  await writeJson(outputPath, payload);
  await writeJson(latestOutputPath, payload);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`feedback analysis 생성 실패: ${error.message}`);
  process.exit(1);
});
