#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  buildRunMetadata,
  categoryForHolding,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function asPercent(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.abs(number) <= 1 ? round(number * 100, 2) : round(number, 2);
}

function marketChangePct(fundamental, technical) {
  const marketValue = numberOrNull(fundamental?.market?.changePct);
  if (marketValue !== null) return round(marketValue, 2);
  return asPercent(technical?.change_pct);
}

function uniq(values) {
  return [...new Set(values.map((item) => compactText(item)).filter(Boolean))];
}

function latestDashboardPath(date) {
  return path.join(ROOT_DIR, "data", "dashboard", `${date}-dashboard-view.json`);
}

async function readFirstExistingJson(paths) {
  for (const filePath of paths) {
    const payload = await readJson(filePath, null);
    if (payload) return payload;
  }
  return null;
}

function flattenPortfolioHoldings(portfolio) {
  return array(portfolio?.accounts).flatMap((account) =>
    array(account.holdings).map((holding) => ({
      accountKey: account.key,
      accountLabel: account.label ?? account.key,
      code: holding.code,
      name: holding.name,
      category: categoryForHolding(account.key, holding.code),
      decision: null,
      position: {
        quantity: holding.quantity ?? null,
        marketValue: holding.marketValue ?? null,
        purchaseValue: holding.purchaseValue ?? null,
        profitLoss: holding.profitLoss ?? null,
        profitRate: holding.profitRate ?? null,
      },
      riskFlags: [],
      scores: {},
      sourceSupport: {},
      fundamental: null,
    })),
  );
}

function groupHoldings(holdings) {
  const byCode = new Map();
  for (const holding of holdings) {
    const code = compactText(holding.code);
    if (!code) continue;
    const marketValue = numberOrNull(holding.position?.marketValue ?? holding.marketValue) ?? 0;
    if (marketValue <= 0) continue;

    const existing =
      byCode.get(code) ??
      {
        code,
        name: holding.name ?? SECURITIES_BY_CODE[code]?.name ?? code,
        category: holding.category ?? categoryForHolding(holding.accountKey, code),
        accounts: [],
        decisions: [],
        riskFlags: [],
        sourceSupport: {},
        scoreSamples: [],
        marketValue: 0,
        purchaseValue: 0,
        profitLoss: 0,
        quantity: 0,
        fundamental: holding.fundamental ?? null,
      };

    existing.name = existing.name ?? holding.name;
    existing.category = existing.category ?? holding.category;
    existing.marketValue += marketValue;
    existing.purchaseValue += numberOrNull(holding.position?.purchaseValue) ?? 0;
    existing.profitLoss += numberOrNull(holding.position?.profitLoss) ?? 0;
    existing.quantity += numberOrNull(holding.position?.quantity) ?? 0;
    existing.accounts.push({
      accountKey: holding.accountKey,
      accountLabel: holding.accountLabel ?? holding.accountKey,
      marketValue,
      profitRate: numberOrNull(holding.position?.profitRate),
      decision: holding.decision?.label ?? holding.decisionLabel ?? null,
    });
    existing.decisions.push(holding.decision?.label ?? holding.decisionLabel);
    existing.riskFlags.push(...array(holding.riskFlags));
    existing.scoreSamples.push({
      action: numberOrNull(holding.scores?.action),
      technical: numberOrNull(holding.scores?.technical),
      attractiveness: numberOrNull(holding.attractiveness?.overall),
    });
    existing.sourceSupport = {
      ...existing.sourceSupport,
      ...holding.sourceSupport,
    };
    if (!existing.fundamental && holding.fundamental) existing.fundamental = holding.fundamental;
    byCode.set(code, existing);
  }

  return [...byCode.values()].map((item) => ({
    ...item,
    accounts: item.accounts,
    decisions: uniq(item.decisions),
    riskFlags: uniq(item.riskFlags),
    profitRate:
      item.purchaseValue > 0
        ? round((item.profitLoss / item.purchaseValue) * 100, 2)
        : weightedProfitRate(item.accounts),
  }));
}

function weightedProfitRate(accounts) {
  const total = accounts.reduce((sum, item) => sum + (numberOrNull(item.marketValue) ?? 0), 0);
  if (total <= 0) return null;
  const weighted = accounts.reduce((sum, item) => {
    const value = numberOrNull(item.marketValue) ?? 0;
    const rate = numberOrNull(item.profitRate) ?? 0;
    return sum + rate * (value / total);
  }, 0);
  return round(weighted, 2);
}

function averageScore(samples, key) {
  const values = samples.map((item) => numberOrNull(item[key])).filter((item) => item !== null);
  if (!values.length) return null;
  return round(values.reduce((sum, item) => sum + item, 0) / values.length, 0);
}

function findNewsHits(normalizedNews, code, name) {
  const nameKey = compactText(name).toLowerCase();
  return array(normalizedNews?.observations)
    .filter((item) => {
      if (item.securityCode === code) return true;
      const text = `${item.entityName ?? ""} ${array(item.evidence)
        .map((evidence) => `${evidence.title ?? ""} ${evidence.text ?? ""}`)
        .join(" ")}`.toLowerCase();
      return nameKey && text.includes(nameKey);
    })
    .slice(0, 4)
    .map((item) => ({
      title: compactText(item.evidence?.[0]?.title ?? item.entityName, 120),
      direction: item.direction ?? "neutral",
      confidence: round(item.confidence ?? 0, 2),
      url: item.evidence?.[0]?.url ?? null,
    }));
}

function findStrategyMentions(strategy, code, name) {
  const needle = `${code} ${name}`.toLowerCase();
  const buckets = [
    ["todayDo", strategy?.todayDo],
    ["sellWatch", strategy?.sellWatch],
    ["buyWatch", strategy?.buyWatch],
  ];
  const mentions = [];
  for (const [bucket, rows] of buckets) {
    for (const row of array(rows)) {
      const haystack = `${row.name ?? ""} ${row.reason ?? ""} ${row.condition ?? ""} ${row.trigger ?? ""}`.toLowerCase();
      if (haystack.includes(code.toLowerCase()) || (name && haystack.includes(String(name).toLowerCase()))) {
        mentions.push({
          bucket,
          action: row.action ?? "확인",
          reason: compactText(row.reason, 140),
          trigger: compactText(row.condition ?? row.trigger, 140),
        });
      }
    }
  }
  return mentions.slice(0, 4);
}

function alert(severity, label, detail, tone = "amber") {
  return { severity, label, detail: compactText(detail, 150), tone };
}

function buildAlerts({ aggregate, technical, fundamental, newsHits, strategyMentions }) {
  const alerts = [];
  const rsi = numberOrNull(technical?.rsi);
  const changePct = marketChangePct(fundamental, technical);
  const volumeRatio = numberOrNull(technical?.volume_ratio);
  const score = numberOrNull(technical?.score);
  const signal = compactText(technical?.signal);

  if (rsi !== null && rsi >= 82) alerts.push(alert("high", "과열", `RSI ${rsi} 과열권입니다.`, "red"));
  else if (rsi !== null && rsi >= 70) alerts.push(alert("medium", "과열주의", `RSI ${rsi}로 추격매수보다 보호 판단이 우선입니다.`));

  if (changePct !== null && changePct >= 6) alerts.push(alert("high", "급등", `당일 ${changePct}% 상승으로 눌림 확인 전 매수 위험이 큽니다.`, "red"));
  if (changePct !== null && changePct <= -5) alerts.push(alert("high", "급락", `당일 ${changePct}% 하락으로 원인 확인이 필요합니다.`, "red"));

  if (volumeRatio !== null && volumeRatio >= 2) {
    alerts.push(alert("medium", "거래급증", `20일 평균 대비 거래량 ${round(volumeRatio, 2)}배입니다.`, "blue"));
  }

  if (/REDUCE|SELL/i.test(signal) || (score !== null && score <= 35)) {
    alerts.push(alert("medium", "기술약화", technical?.signal_reason ?? "기술 점수가 약합니다.", "amber"));
  }

  for (const risk of aggregate.riskFlags) {
    if (/OFF_REPORT|NO_CLEAN_REPORT|TECHNICAL_DATA_GAP/.test(risk)) {
      alerts.push(alert("medium", "근거보강", risk, "amber"));
    }
  }

  if (newsHits.some((item) => item.direction === "negative")) {
    alerts.push(alert("medium", "부정뉴스", "최근 뉴스 관측값에 부정 방향 신호가 있습니다.", "amber"));
  }

  if (strategyMentions.length > 0) {
    alerts.push(alert("low", "AI언급", `${strategyMentions[0].action}: ${strategyMentions[0].reason}`, "blue"));
  }

  return alerts.slice(0, 8);
}

function verdictFor({ aggregate, technical, alerts, strategyMentions }) {
  const decisionText = aggregate.decisions.join(" ");
  const profitRate = numberOrNull(aggregate.profitRate) ?? 0;
  const rsi = numberOrNull(technical?.rsi);
  const signal = compactText(technical?.signal);
  const strategyText = strategyMentions.map((item) => item.action).join(" ");

  if (/손절/.test(strategyText) || (/REDUCE|SELL/i.test(signal) && profitRate < 0)) return "손절감시";
  if (/매수금지|추격금지|매수제외/.test(`${decisionText} ${strategyText}`)) return "추격금지";
  if (/수익보호|부분익절|감량|익절/.test(`${decisionText} ${strategyText}`)) return "익절감시";
  if (profitRate >= 12 && rsi !== null && rsi >= 70) return "익절감시";
  if (alerts.some((item) => item.label === "근거보강")) return "자료보강";
  if (/REDUCE|SELL/i.test(signal)) return "감량검토";
  return "보유유지";
}

function actionText(verdict) {
  switch (verdict) {
    case "익절감시":
      return "20일선 이탈, RSI 하락반전, 장대음봉 중 하나가 나오면 일부 익절을 검토합니다.";
    case "손절감시":
      return "손실 확대 원인을 확인하고 20일선 회복 실패 시 감량 기준을 먼저 봅니다.";
    case "추격금지":
      return "좋아 보여도 오늘은 추가매수보다 보유분 보호와 눌림 대기가 우선입니다.";
    case "감량검토":
      return "기술 약화가 이어지면 비중 축소 후보로 올려둡니다.";
    case "자료보강":
      return "공시, 뉴스, 직접 리포트가 보강되기 전까지 결론 강도를 낮춥니다.";
    default:
      return "보유 논리는 유지하되 새 뉴스, 공시, 수급 변화를 확인합니다.";
  }
}

function doNotText(verdict) {
  if (verdict === "익절감시" || verdict === "추격금지") return "급등 구간 추격매수 금지";
  if (verdict === "손절감시") return "손절 기준 없이 물타기 금지";
  if (verdict === "자료보강") return "근거 부족 상태의 신규매수 금지";
  return "같은 테마 중복 확대 금지";
}

function urgencyFor(alerts, verdict) {
  if (alerts.some((item) => item.severity === "high")) return "높음";
  if (/손절|익절|추격/.test(verdict)) return "중간";
  if (alerts.length > 0) return "중간";
  return "낮음";
}

function buildPulseItem({ aggregate, technical, fundamental, newsHits, strategyMentions }) {
  const alerts = buildAlerts({ aggregate, technical, fundamental, newsHits, strategyMentions });
  const verdict = verdictFor({ aggregate, technical, alerts, strategyMentions });
  const changePct = marketChangePct(fundamental, technical);
  const rsi = numberOrNull(technical?.rsi);
  const volumeRatio = numberOrNull(technical?.volume_ratio);
  const technicalScore = numberOrNull(technical?.score) ?? averageScore(aggregate.scoreSamples, "technical");
  const fundamentalScore = numberOrNull(fundamental?.score?.overall ?? aggregate.fundamental?.score?.overall);
  const attractiveness = averageScore(aggregate.scoreSamples, "attractiveness");
  const pulseScore = round(
    (technicalScore ?? 50) * 0.38 +
      (fundamentalScore ?? attractiveness ?? 50) * 0.32 +
      (attractiveness ?? 50) * 0.2 -
      alerts.filter((item) => item.severity === "high").length * 10 -
      alerts.filter((item) => item.severity === "medium").length * 4,
    0,
  );
  const missingSources = [
    newsHits.length === 0 ? "뉴스미수집" : null,
    "DART미연결",
    ...(fundamental?.dataNeeds ?? aggregate.fundamental?.dataNeeds ?? []),
  ].filter(Boolean);

  const quickFactors = [
    changePct !== null ? `등락 ${changePct}%` : null,
    rsi !== null ? `RSI ${rsi}` : null,
    volumeRatio !== null ? `거래량 ${round(volumeRatio, 2)}배` : null,
    aggregate.profitRate !== null ? `손익 ${aggregate.profitRate}%` : null,
  ].filter(Boolean);

  return {
    id: `stock-pulse:${aggregate.code}`,
    code: aggregate.code,
    name: aggregate.name,
    category: aggregate.category,
    type: fundamental?.type ?? aggregate.fundamental?.type ?? SECURITIES_BY_CODE[aggregate.code]?.type ?? null,
    verdict,
    urgency: urgencyFor(alerts, verdict),
    pulseScore,
    oneLine: compactText(`${verdict}: ${actionText(verdict)}`, 150),
    doNow: actionText(verdict),
    doNot: doNotText(verdict),
    nextCheck: "장중 가격/거래량, DART 공시, 종목 직접 뉴스, 외국인·기관 수급을 다시 확인",
    accounts: aggregate.accounts.map((item) => ({
      accountKey: item.accountKey,
      accountLabel: item.accountLabel,
      marketValue: round(item.marketValue, 0),
      profitRate: round(item.profitRate, 2),
      decision: item.decision,
    })),
    position: {
      marketValue: round(aggregate.marketValue, 0),
      purchaseValue: round(aggregate.purchaseValue, 0),
      profitLoss: round(aggregate.profitLoss, 0),
      profitRate: round(aggregate.profitRate, 2),
      quantity: round(aggregate.quantity, 4),
    },
    market: {
      price: numberOrNull(fundamental?.market?.price ?? technical?.close),
      previousClose: numberOrNull(technical?.previous_close),
      changePct,
      volume: numberOrNull(fundamental?.market?.volume ?? technical?.volume_current),
      volumeRatio: round(volumeRatio, 2),
      nav: numberOrNull(fundamental?.market?.nav),
      navGapPct: numberOrNull(fundamental?.market?.navGapPct),
      rank: numberOrNull(fundamental?.market?.rank),
    },
    technical: {
      score: round(technicalScore, 0),
      signal: technical?.signal ?? null,
      reason: compactText(technical?.signal_reason, 150),
      rsi,
      ma20: numberOrNull(technical?.ma?.ma20),
      ma60: numberOrNull(technical?.ma?.ma60),
      recentHighDistancePct: asPercent(technical?.recent_high?.distance_pct),
      rsVsBenchmark: asPercent(technical?.relative_strength?.rs_vs_benchmark),
      alerts: array(technical?.alerts).slice(0, 5).map((item) => compactText(item, 80)),
    },
    fundamental: {
      score: round(fundamentalScore, 0),
      label: fundamental?.score?.label ?? aggregate.fundamental?.score?.label ?? null,
      metrics: fundamental?.metrics ?? aggregate.fundamental?.metrics ?? null,
      etf: fundamental?.etf
        ? {
            rank: fundamental.etf.ranking?.rank ?? null,
            navGapPct: fundamental.etf.ranking?.navGapPct ?? null,
            concentrationTop5Pct: fundamental.etf.concentrationTop5Pct ?? null,
            topHoldings: array(fundamental.etf.holdings).slice(0, 5).map((item) => ({
              code: item.code ?? null,
              name: item.name ?? null,
              weightPct: numberOrNull(item.weightPct),
              changePct: numberOrNull(item.changePct),
            })),
          }
        : null,
    },
    alerts,
    quickFactors,
    newsHits,
    strategyMentions,
    missingSources: uniq(missingSources).slice(0, 8),
    riskFlags: aggregate.riskFlags,
    sourceSupport: aggregate.sourceSupport,
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const date = args.date;

  const [
    dashboard,
    latestDashboard,
    portfolio,
    technical,
    fundamentals,
    normalizedNews,
    qwenAccountStrategy,
  ] = await Promise.all([
    readJson(latestDashboardPath(date), null),
    readJson(path.join(ROOT_DIR, "data", "dashboard", "latest-dashboard-view.json"), null),
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(ROOT_DIR, "data", "technical", `${date}.json`), { scores: {} }),
    readJson(path.join(ROOT_DIR, "data", "fundamentals", date, "security-fundamentals.json"), { securities: [] }),
    readJson(path.join(ROOT_DIR, "data", "normalized", date, "news.normalized.json"), null),
    readFirstExistingJson([
      path.join(ROOT_DIR, "data", "analysis-state", date, "qwen-account-strategy.json"),
      path.join(ROOT_DIR, "data", "analysis-state", date, "qwen-account-strategy-test.json"),
    ]),
  ]);

  const view = dashboard ?? latestDashboard ?? {};
  const holdingRows = array(view.holdings).length > 0 ? view.holdings : flattenPortfolioHoldings(portfolio);
  const fundamentalsByCode = new Map(array(fundamentals.securities).map((item) => [item.code, item]));
  const aggregates = groupHoldings(holdingRows);

  const items = aggregates
    .map((aggregate) =>
      buildPulseItem({
        aggregate,
        technical: technical.scores?.[aggregate.code] ?? null,
        fundamental: fundamentalsByCode.get(aggregate.code) ?? aggregate.fundamental ?? null,
        newsHits: findNewsHits(normalizedNews, aggregate.code, aggregate.name),
        strategyMentions: findStrategyMentions(qwenAccountStrategy, aggregate.code, aggregate.name),
      }),
    )
    .sort((left, right) => {
      const urgencyRank = { "높음": 3, "중간": 2, "낮음": 1 };
      return (
        (urgencyRank[right.urgency] ?? 0) - (urgencyRank[left.urgency] ?? 0) ||
        (right.position.marketValue ?? 0) - (left.position.marketValue ?? 0)
      );
    });

  const payload = {
    date,
    runDate: metadata.runDate,
    effectiveMarketDate: metadata.effectiveMarketDate,
    runId: metadata.runId,
    generatedAt: metadata.generatedAt,
    status: items.length > 0 ? "ok" : "warn",
    sourceStatus: {
      portfolio: array(portfolio.accounts).length > 0 ? "ok" : "missing",
      technical: Object.keys(technical.scores ?? {}).length > 0 ? "ok" : "missing",
      fundamentals: array(fundamentals.securities).length > 0 ? "ok" : "missing",
      news: normalizedNews ? "ok" : "missing",
      dart: "not_configured",
      qwen: qwenAccountStrategy ? "ok" : "missing",
    },
    counts: {
      activeHoldings: items.length,
      highUrgency: items.filter((item) => item.urgency === "높음").length,
      mediumUrgency: items.filter((item) => item.urgency === "중간").length,
      missingNews: items.filter((item) => item.missingSources.includes("뉴스미수집")).length,
      missingDart: items.filter((item) => item.missingSources.includes("DART미연결")).length,
    },
    summary: {
      headline:
        items.filter((item) => item.urgency === "높음").length > 0
          ? "과열·급등·기술약화 종목을 먼저 확인해야 합니다."
          : "급한 개별주 경보는 제한적이며, 공시/뉴스 보강이 다음 과제입니다.",
      nextAction: "DART 공시와 종목 직접 뉴스 수집을 붙이면 장중 속보판 정확도가 올라갑니다.",
    },
    items,
    artifacts: {
      stockPulse: `data/stock-pulse/${date}/stock-pulse.json`,
      perSecurityDir: `data/stock-pulse/${date}/securities`,
    },
  };

  const outputPath = args.output
    ? path.resolve(ROOT_DIR, args.output)
    : path.join(ROOT_DIR, "data", "stock-pulse", date, "stock-pulse.json");
  await writeJson(outputPath, payload);
  await writeJson(path.join(ROOT_DIR, "data", "stock-pulse", "latest-stock-pulse.json"), payload);

  for (const item of items) {
    await writeJson(path.join(ROOT_DIR, "data", "stock-pulse", date, "securities", `${item.code}.json`), item);
  }

  console.log(`Wrote stock pulse to ${outputPath}`);
  console.log(`holdings=${items.length} high=${payload.counts.highUrgency} medium=${payload.counts.mediumUrgency}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
