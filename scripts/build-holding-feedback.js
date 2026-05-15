#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

const VERSION = "0.1.0";

function compact(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function numberOrNull(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function round(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function won(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function manwon(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value / 10000).toLocaleString("ko-KR")}만원`;
}

function pct(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function pctRatio(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function firstItems(value, limit = 3) {
  return list(value)
    .map((item) => compact(typeof item === "string" ? item : item?.title ?? item?.summary ?? item?.name))
    .filter(Boolean)
    .slice(0, limit);
}

function safeCode(value) {
  return compact(value).replace(/[^0-9A-Za-z_-]/g, "_") || "UNKNOWN";
}

function buildActualHoldings(portfolio) {
  return list(portfolio?.accounts).flatMap((account) => {
    const accountValue = numberOrNull(
      account.totalValue,
      account.evaluationAmount,
      account.totalEvaluationAmount,
      account.totalAssetAmount,
    );
    return list(account.holdings)
      .filter((holding) => compact(holding.code) && (numberOrNull(holding.quantity) ?? 0) > 0)
      .map((holding) => ({
        accountKey: account.key,
        accountLabel: account.label ?? account.accountLabel ?? account.key,
        accountValue,
        holding,
      }));
  });
}

function cardPriority(card) {
  const bucketRank = {
    TRIM_REVIEW: 90,
    HOLD_PROTECT: 80,
    HOLD_KEEP: 70,
    WATCH_OFF_REPORT: 60,
    WATCH: 55,
    BLOCKED_BUY: 10,
  };
  const actionBonus = card?.sourceAction === "TRIM" ? 10 : card?.sourceAction === "HOLD" ? 6 : 0;
  const scoreBonus = typeof card?.score === "number" ? Math.min(5, card.score / 20) : 0;
  return (bucketRank[card?.decisionBucket] ?? 30) + actionBonus + scoreBonus;
}

function findCard(cards, actual) {
  const matches = list(cards).filter(
    (card) => card?.accountKey === actual.accountKey && compact(card?.code) === compact(actual.holding.code),
  );
  return matches.sort((a, b) => cardPriority(b) - cardPriority(a))[0] ?? null;
}

function positionFrom(actual, card) {
  const holding = actual.holding;
  const technical = card?.technical ?? {};
  const quantity = numberOrNull(holding.quantity);
  const currentPrice = numberOrNull(holding.currentPrice, card?.currentPrice, technical.currentPrice);
  const avgPrice = numberOrNull(holding.avgPrice, card?.entryPrice, technical.entryPrice);
  const marketValue = numberOrNull(holding.marketValue, holding.evaluationAmount, quantity && currentPrice ? quantity * currentPrice : null);
  const profitRate = numberOrNull(
    holding.profitRate,
    typeof avgPrice === "number" && typeof currentPrice === "number" && avgPrice > 0
      ? ((currentPrice - avgPrice) / avgPrice) * 100
      : null,
  );
  const profitLoss = numberOrNull(holding.profitLoss, typeof marketValue === "number" && typeof profitRate === "number" ? marketValue * (profitRate / (100 + profitRate)) : null);
  return {
    quantity,
    avgPrice,
    currentPrice,
    marketValue,
    accountWeightPct:
      typeof marketValue === "number" && typeof actual.accountValue === "number" && actual.accountValue > 0
        ? round((marketValue / actual.accountValue) * 100, 1)
        : null,
    profitRatePct: round(profitRate, 2),
    profitLoss,
  };
}

function deriveLevels(position, card) {
  const technical = card?.technical ?? {};
  const currentPrice = position.currentPrice;
  const avgPrice = position.avgPrice;
  if (typeof currentPrice !== "number" || currentPrice <= 0) {
    return {
      support1: null,
      support2: null,
      resistance1: avgPrice ?? null,
      resistance2: null,
      method: "가격 데이터 부족",
    };
  }

  const atrPct = numberOrNull(technical.atrPct) ?? 0.04;
  const recentHigh = numberOrNull(technical.recentHigh);
  const supportGap1 = Math.max(0.03, atrPct * 1.1);
  const supportGap2 = Math.max(0.06, atrPct * 2.0);
  const resistance1 =
    typeof avgPrice === "number" && avgPrice > currentPrice
      ? avgPrice
      : typeof recentHigh === "number" && recentHigh > currentPrice
        ? recentHigh
        : currentPrice * (1 + Math.max(0.03, atrPct));
  const resistance2 =
    typeof recentHigh === "number" && recentHigh > resistance1
      ? recentHigh
      : resistance1 * (1 + Math.max(0.04, atrPct));

  return {
    support1: Math.round(currentPrice * (1 - supportGap1)),
    support2: Math.round(currentPrice * (1 - supportGap2)),
    resistance1: Math.round(resistance1),
    resistance2: Math.round(resistance2),
    method: "ATR/평단/최근고점 기반 내부 추정",
  };
}

function deriveRecommendation({ card, position }) {
  const bucket = card?.decisionBucket ?? "DATA_GAP";
  const riskFlags = list(card?.riskFlags);
  const stopLoss = Boolean(card?.technical?.stopLossTriggered || riskFlags.includes("STOP_LOSS_TRIGGERED"));
  const profitRate = position.profitRatePct;
  const rsi = numberOrNull(card?.technical?.rsi);
  const overheat = riskFlags.some((flag) => String(flag).startsWith("RSI_OVERHEAT")) || (typeof rsi === "number" && rsi >= 80);
  const noCleanReport = riskFlags.includes("NO_CLEAN_REPORT_LINK") || card?.reportCoverage?.status === "NO_CLEAN_REPORT_LINK";

  if (stopLoss && typeof profitRate === "number" && profitRate < 0) {
    return {
      label: "손절감시",
      action: "추가매수 금지 / 지지 실패 시 감량",
      urgency: "high",
      tone: "red",
      oneLine: "관망만 하기에는 손절 플래그가 켜졌습니다. 반등을 기다리더라도 물타기는 막고, 지지선 이탈 시 감량 기준을 먼저 적용합니다.",
    };
  }

  if (bucket === "TRIM_REVIEW" || stopLoss) {
    return {
      label: typeof profitRate === "number" && profitRate > 0 ? "수익보호" : "감량검토",
      action: "분할 감량 검토",
      urgency: "high",
      tone: "amber",
      oneLine: "보유 명분은 남아 있지만 가격 리스크가 커졌습니다. 신규 매수보다 비중 보호와 이탈 기준 확인이 우선입니다.",
    };
  }

  if (bucket === "HOLD_PROTECT" || overheat) {
    return {
      label: "수익보호",
      action: "추가매수 보류 / 일부익절 조건 대기",
      urgency: "medium",
      tone: "amber",
      oneLine: "수익 구간이지만 과열 신호가 있습니다. 더 사기보다 보호선을 올리고 일부익절 조건을 준비합니다.",
    };
  }

  if (bucket === "BLOCKED_BUY") {
    return {
      label: "매수금지",
      action: "신규/추가매수 금지",
      urgency: "medium",
      tone: "red",
      oneLine: "오늘의 검증 기준에서는 매수 후보에서 제외됐습니다. 가격보다 근거 회복을 먼저 확인합니다.",
    };
  }

  if (bucket === "WATCH_OFF_REPORT" || noCleanReport) {
    return {
      label: "조건부관망",
      action: "보유 유지 / 근거 보강 전 추매 금지",
      urgency: "medium",
      tone: "blue",
      oneLine: "계좌 안에서는 보유 가능하지만 오늘 리포트 근거가 약합니다. 추가매수는 새 근거가 붙을 때까지 늦춥니다.",
    };
  }

  return {
    label: "보유유지",
    action: "관망 / 조건 충족 시 분할",
    urgency: "low",
    tone: "green",
    oneLine: "현재 카드 기준으로는 보유 명분이 유지됩니다. 급한 매도보다 정해둔 추가/감량 조건을 기다립니다.",
  };
}

function buildBullBear(card, recommendation) {
  const bull = [
    compact(card?.thesis),
    ...firstItems(card?.reportCoverage?.topReports, 2).map((item) => `리포트 근거: ${item}`),
    ...firstItems(card?.addConditions, 2).map((item) => `추가 조건: ${item}`),
  ].filter(Boolean);

  const bear = [
    ...firstItems(card?.trimConditions, 4),
    ...firstItems(card?.invalidationConditions, 3).map((item) => `무효화 조건: ${item}`),
    ...list(card?.riskFlags).slice(0, 4).map((flag) => `리스크 플래그: ${flag}`),
  ].filter(Boolean);

  if (bear.length === 0 && recommendation.urgency !== "low") {
    bear.push("감량/보호 판단이 있으나 세부 리스크 문구가 부족합니다. 다음 리포트와 가격 데이터를 재확인해야 합니다.");
  }

  return {
    bullCase: bull.slice(0, 4),
    bearCase: bear.slice(0, 6),
  };
}

function buildRules({ recommendation, position, levels, card }) {
  const rules = [];
  if (recommendation.label === "손절감시") {
    rules.push(`${won(levels.support1)} 부근 지지 실패 또는 종가 기준 추가 저점 이탈이면 감량을 우선 검토`);
    rules.push(`${won(levels.resistance1)} 회복 전까지 물타기 금지`);
    rules.push("반등이 나오면 손실 축소 매도/비중 조절을 먼저 검토");
  } else if (recommendation.label === "수익보호") {
    rules.push("추가매수보다 수익 보호선을 먼저 올림");
    rules.push(`${won(levels.support1)} 이탈 또는 RSI 과열 해소 실패 시 일부익절 검토`);
    rules.push(`${won(levels.resistance1)} 돌파 후 거래대금이 붙을 때만 추세 재확인`);
  } else if (recommendation.label === "조건부관망") {
    rules.push("오늘 리포트/근거가 새로 붙기 전까지 추가매수 보류");
    rules.push(`${won(levels.support1)} 지지와 계좌 내 목표 비중을 함께 확인`);
    rules.push("리포트 근거가 붙거나 점수가 개선될 때만 분할 추가 검토");
  } else {
    rules.push(`${won(levels.support1)} 이탈 전까지 보유 유지`);
    rules.push(`${won(levels.resistance1)} 돌파 시 추세 강화 여부 확인`);
    rules.push("추가매수는 기존 계획의 조건과 계좌 비중 한도 안에서만 실행");
  }

  for (const condition of firstItems(card?.trimConditions, 2)) {
    if (!rules.includes(condition)) rules.push(condition);
  }

  return rules.slice(0, 5).map((rule) =>
    compact(rule)
      .replace("null원", "-")
      .replace("undefined원", "-"),
  );
}

function buildFeedbackCard(actual, card) {
  const position = positionFrom(actual, card);
  const levels = deriveLevels(position, card);
  const recommendation = deriveRecommendation({ card, position });
  const bullBear = buildBullBear(card, recommendation);
  const executionRules = buildRules({ recommendation, position, levels, card });
  const technical = card?.technical ?? {};

  return {
    accountKey: actual.accountKey,
    accountLabel: actual.accountLabel,
    code: actual.holding.code,
    name: actual.holding.name ?? card?.name ?? actual.holding.code,
    question: `${actual.holding.name ?? card?.name ?? actual.holding.code} (${actual.holding.code}) : 평단 ${won(position.avgPrice)}인데 손절? 관망? 추매?`,
    recommendation,
    position,
    decision: {
      bucket: card?.decisionBucket ?? "DATA_GAP",
      label: card?.decisionLabel ?? recommendation.label,
      score: numberOrNull(card?.score),
      sourceAction: card?.sourceAction ?? null,
    },
    technical: {
      rsi: numberOrNull(technical.rsi),
      bollingerPosition: technical.bollingerPosition ?? null,
      atrPct: round(numberOrNull(technical.atrPct) != null ? numberOrNull(technical.atrPct) * 100 : null, 2),
      recentHigh: numberOrNull(technical.recentHigh),
      drawdownFromEntryPct:
        numberOrNull(technical.drawdownFromEntryPct) != null ? round(numberOrNull(technical.drawdownFromEntryPct) * 100, 2) : null,
      drawdownFromRecentHighPct:
        numberOrNull(technical.drawdownFromRecentHighPct) != null
          ? round(numberOrNull(technical.drawdownFromRecentHighPct) * 100, 2)
          : null,
      stopLossTriggered: Boolean(technical.stopLossTriggered),
      fallback: Boolean(technical.fallback),
    },
    levels,
    bullCase: bullBear.bullCase,
    bearCase: bullBear.bearCase,
    executionRules,
    watchList: [
      ...firstItems(card?.invalidationConditions, 3),
      ...firstItems(card?.nextReview, 2),
    ].slice(0, 5),
    sourceRefs: {
      holdingDecisionCards: `data/analysis-state/${actual.date}/holding-decision-cards.json`,
      portfolio: "data/portfolio/latest.json",
    },
  };
}

function urgencyRank(value) {
  return { high: 3, medium: 2, low: 1 }[value] ?? 0;
}

function buildSummary(cards) {
  const byLabel = {};
  const byAccount = {};
  for (const card of cards) {
    byLabel[card.recommendation.label] = (byLabel[card.recommendation.label] ?? 0) + 1;
    byAccount[card.accountLabel] = (byAccount[card.accountLabel] ?? 0) + 1;
  }
  return {
    totalHoldings: cards.length,
    highUrgency: cards.filter((card) => card.recommendation.urgency === "high").length,
    mediumUrgency: cards.filter((card) => card.recommendation.urgency === "medium").length,
    lowUrgency: cards.filter((card) => card.recommendation.urgency === "low").length,
    byLabel,
    byAccount,
  };
}

function markdownForCard(card) {
  const bullet = (items, fallback = "-") => {
    const rows = list(items).filter(Boolean);
    if (rows.length === 0) return `- ${fallback}`;
    return rows.map((item) => `- ${compact(item)}`).join("\n");
  };

  return [
    `## ${card.accountLabel} · ${card.name} (${card.code})`,
    "",
    `**결론: ${card.recommendation.label}**`,
    "",
    card.recommendation.oneLine,
    "",
    "### 1. 내 포지션",
    "",
    `- 수량: ${card.position.quantity ?? "-"}`,
    `- 평단/현재가: ${won(card.position.avgPrice)} / ${won(card.position.currentPrice)}`,
    `- 평가금액/손익률: ${manwon(card.position.marketValue)} / ${pct(card.position.profitRatePct)}`,
    `- 계좌 비중: ${card.position.accountWeightPct != null ? `${card.position.accountWeightPct.toFixed(1)}%` : "-"}`,
    "",
    "### 2. 기술적 판단",
    "",
    `- RSI: ${card.technical.rsi ?? "-"}`,
    `- 볼린저 위치: ${card.technical.bollingerPosition ?? "-"}`,
    `- 평단 대비: ${pct(card.technical.drawdownFromEntryPct)}`,
    `- 최근 고점 대비: ${pct(card.technical.drawdownFromRecentHighPct)}`,
    `- 손절 플래그: ${card.technical.stopLossTriggered ? "켜짐" : "없음"}`,
    "",
    "### 3. 내부 기준선",
    "",
    `- 1차 지지/2차 지지: ${won(card.levels.support1)} / ${won(card.levels.support2)}`,
    `- 1차 저항/2차 저항: ${won(card.levels.resistance1)} / ${won(card.levels.resistance2)}`,
    `- 산출 방식: ${card.levels.method}`,
    "",
    "### 4. 긍정 근거",
    "",
    bullet(card.bullCase, "오늘 연결된 긍정 근거가 약합니다."),
    "",
    "### 5. 리스크와 반대 근거",
    "",
    bullet(card.bearCase, "특이 리스크 플래그 없음"),
    "",
    "### 6. 실행 규칙",
    "",
    bullet(card.executionRules),
    "",
  ].join("\n");
}

function buildMarkdown(payload) {
  return [
    `# ${payload.date} 보유종목 피드백`,
    "",
    `- 총 보유종목: ${payload.summary.totalHoldings}`,
    `- 긴급 점검: ${payload.summary.highUrgency}`,
    `- 중간 점검: ${payload.summary.mediumUrgency}`,
    "",
    "> 이 문서는 StockEasy 복제물이 아니라 EcoReport 내부 데이터로 만든 보유종목별 실행 피드백입니다. 투자 판단의 참고 자료이며 최종 결정은 투자자 본인 책임입니다.",
    "",
    ...payload.cards.map(markdownForCard),
  ].join("\n");
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;
  const portfolio = await readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] });
  const decisionCards = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "holding-decision-cards.json"), {
    cards: [],
  });

  const actualHoldings = buildActualHoldings(portfolio).map((item) => ({ ...item, date }));
  const cards = actualHoldings
    .map((actual) => buildFeedbackCard(actual, findCard(decisionCards.cards, actual)))
    .sort((a, b) => {
      const urgency = urgencyRank(b.recommendation.urgency) - urgencyRank(a.recommendation.urgency);
      if (urgency !== 0) return urgency;
      return (b.position.marketValue ?? 0) - (a.position.marketValue ?? 0);
    });

  const payload = {
    version: VERSION,
    ...buildRunMetadata(args),
    summary: buildSummary(cards),
    cards,
    artifacts: {
      json: `data/holding-feedback/${date}/holding-feedback.json`,
      latestJson: "data/holding-feedback/latest-holding-feedback.json",
      markdown: `reports/daily/${date}-holding-feedback.md`,
    },
  };

  const outJson = path.join(ROOT_DIR, "data", "holding-feedback", date, "holding-feedback.json");
  const latestJson = path.join(ROOT_DIR, "data", "holding-feedback", "latest-holding-feedback.json");
  const outMarkdown = path.join(ROOT_DIR, "reports", "daily", `${date}-holding-feedback.md`);
  await writeJson(outJson, payload);
  await writeJson(latestJson, payload);
  await writeText(outMarkdown, buildMarkdown(payload));

  for (const card of cards) {
    const cardPath = path.join(
      ROOT_DIR,
      "reports",
      "daily",
      "holding-feedback",
      date,
      `${safeCode(card.accountKey)}-${safeCode(card.code)}.md`,
    );
    await writeText(cardPath, [`# ${card.question}`, "", markdownForCard(card)].join("\n"));
  }

  console.log(
    JSON.stringify(
      {
        date,
        totalHoldings: payload.summary.totalHoldings,
        highUrgency: payload.summary.highUrgency,
        output: payload.artifacts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
