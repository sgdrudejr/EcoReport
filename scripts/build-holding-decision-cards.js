#!/usr/bin/env node

import path from "node:path";

import Parser from "rss-parser";

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  buildRunMetadata,
  enrichPortfolioWithSecurityCodes,
  getCategory,
  parseDateArgs,
  readJson,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

function compact(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit = 180) {
  const text = compact(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function formatAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatWeight(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatPctPoint(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function numberOrNull(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizedKey(value) {
  return compact(value).toLowerCase();
}

function hasHangulFinalConsonant(value) {
  const chars = compact(value);
  if (!chars) return false;
  const code = chars.charCodeAt(chars.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function subjectWithTopic(value) {
  const text = compact(value) || "이 보유종목";
  return `${text}${hasHangulFinalConsonant(text) ? "은" : "는"}`;
}

function reasonParticle(value) {
  const text = compact(value);
  if (!text) return "-";
  return `${text}${hasHangulFinalConsonant(text) ? "이라서" : "라서"}`;
}

const SOURCE_ACTION_LABELS = {
  BUY: "매수후보",
  TRIM: "감량검토",
  HOLD: "보유",
  WATCH: "관찰",
  REJECTED: "매수제외",
};

function sourceActionLabel(sourceAction) {
  return SOURCE_ACTION_LABELS[sourceAction] ?? sourceAction ?? "-";
}

function valueText(item, { includeReason = true } = {}) {
  const security = item?.code ? SECURITIES_BY_CODE[item.code] : null;
  return [
    item?.name,
    item?.code,
    ...(includeReason ? [item?.reason, item?.entryCondition, ...(item?.entryTriggers ?? [])] : []),
    security?.name,
    ...(security?.keywords?.topic_hints ?? []),
    ...(security?.keywords?.theme ?? []),
    ...(security?.thematic_triggers?.sectors ?? []),
    ...(security?.thematic_triggers?.themes ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchAiStackTags({ item, category, framework, includeReason = true }) {
  const text = valueText(item, { includeReason });
  return (framework.aiStack ?? [])
    .filter((lens) => {
      const categoryMatch = (lens.categories ?? []).some((candidate) => candidate === category);
      const keywordMatch = (lens.keywords ?? []).some((keyword) => text.includes(String(keyword).toLowerCase()));
      return categoryMatch || keywordMatch;
    })
    .map((lens) => ({
      key: lens.key,
      label: lens.label,
      addCondition: lens.addCondition,
      invalidation: lens.invalidation ?? [],
    }));
}

function technicalSnapshot(item, quantPosition = null) {
  const technical = item?.technical ?? quantPosition?.technical ?? {};
  return {
    rsi: numberOrNull(technical?.rsi, item?.rsi),
    bollingerPosition: technical?.bollingerPosition ?? technical?.bollinger?.position ?? item?.bollingerPosition ?? null,
    atrPct: numberOrNull(technical?.atrPct, technical?.atr?.pct, item?.atrPct),
    dayChangePct: numberOrNull(technical?.dayChangePct, technical?.change_pct, item?.dayChangePct),
    currentPrice: numberOrNull(item?.currentPrice, technical?.close, quantPosition?.stopLoss?.currentPrice),
    entryPrice: numberOrNull(item?.entryPrice, quantPosition?.stopLoss?.entryPrice),
    recentHigh: numberOrNull(item?.stopLoss?.recentHigh, quantPosition?.stopLoss?.recentHigh),
    drawdownFromEntryPct: numberOrNull(item?.stopLoss?.drawdownFromEntryPct, quantPosition?.stopLoss?.drawdownFromEntryPct),
    drawdownFromRecentHighPct: numberOrNull(
      item?.stopLoss?.drawdownFromRecentHighPct,
      quantPosition?.stopLoss?.drawdownFromRecentHighPct,
    ),
    stopLossTriggered: Boolean(item?.stopLoss?.triggered || quantPosition?.stopLoss?.triggered),
    fallback: Boolean(technical?.fallback || item?.fallback),
  };
}

function accountSnapshotFor(portfolio, accountKey) {
  return (portfolio?.accounts ?? []).find((account) => account.key === accountKey) ?? null;
}

function portfolioHoldingFor(portfolio, accountKey, item) {
  const account = accountSnapshotFor(portfolio, accountKey);
  const itemCode = item?.code ? String(item.code) : null;
  const itemName = normalizedKey(item?.name);
  return (
    (account?.holdings ?? []).find((holding) => itemCode && String(holding.code) === itemCode) ??
    (account?.holdings ?? []).find((holding) => itemName && normalizedKey(holding.name) === itemName) ??
    null
  );
}

function holdingMarketValue(holding, quantPosition, technical) {
  const fromQuantity =
    typeof holding?.quantity === "number" && typeof technical?.currentPrice === "number"
      ? holding.quantity * technical.currentPrice
      : null;
  return numberOrNull(quantPosition?.marketValue, holding?.marketValue, holding?.evaluationAmount, fromQuantity);
}

function buildPositionStats({ account, holding, quantPosition, technical }) {
  const marketValue = holdingMarketValue(holding, quantPosition, technical);
  const accountValue = numberOrNull(account?.evaluationAmount, account?.totalEvaluationAmount, account?.totalAssetAmount);
  const profitRatePct =
    numberOrNull(holding?.profitRate) ??
    (technical?.drawdownFromEntryPct != null ? technical.drawdownFromEntryPct * 100 : null);
  return {
    marketValue,
    accountValue,
    weight: marketValue != null && accountValue ? marketValue / accountValue : null,
    quantity: numberOrNull(holding?.quantity),
    profitLoss: numberOrNull(holding?.profitLoss),
    profitRatePct,
  };
}

function buildReportCoverage(quantPosition) {
  const report = quantPosition?.report ?? {};
  const impacts = Array.isArray(quantPosition?.reportImpacts) ? quantPosition.reportImpacts : [];
  const relation = report?.relationSummary ?? {};
  const directCount = numberOrNull(relation.directCount) ?? impacts.filter((impact) => impact?.relationType === "direct").length;
  const thematicCount =
    numberOrNull(relation.thematicCount) ?? impacts.filter((impact) => impact?.relationType === "thematic").length;
  const secondOrderCount =
    numberOrNull(relation.secondOrderCount) ?? impacts.filter((impact) => impact?.relationType === "second_order").length;
  const blockedCount = numberOrNull(relation.blockedCount) ?? 0;
  const impactCount = numberOrNull(report.impactCount, impacts.length) ?? impacts.length;
  const unrelatedEvidenceRatio = numberOrNull(relation.unrelatedEvidenceRatio) ?? 0;
  const available = report.available !== false && impactCount > 0;
  let status = "OFF_REPORT_HOLDING";

  if (directCount > 0 && unrelatedEvidenceRatio < 0.75) {
    status = "DIRECT_REPORT";
  } else if (thematicCount > 0 || secondOrderCount > 0) {
    status = "THEMATIC_REPORT";
  } else if (available && unrelatedEvidenceRatio < 0.75) {
    status = "WEAK_LINKED_REPORT";
  } else if (available || blockedCount > 0 || unrelatedEvidenceRatio >= 0.75) {
    status = "NO_CLEAN_REPORT_LINK";
  }

  const statusLabel = {
    DIRECT_REPORT: "직접근거",
    THEMATIC_REPORT: "테마근거",
    WEAK_LINKED_REPORT: "약한근거",
    NO_CLEAN_REPORT_LINK: "근거부족",
    OFF_REPORT_HOLDING: "리포트밖",
  }[status];

  return {
    status,
    statusLabel,
    available,
    impactCount,
    directCount,
    thematicCount,
    secondOrderCount,
    blockedCount,
    unrelatedEvidenceRatio,
    impactScore: report.impactScore ?? null,
    sourceLayer: report.sourceLayer ?? null,
    unavailableReason: report.unavailableReason ?? null,
    topReports: impacts.slice(0, 3).map((impact) => ({
      reportId: impact.reportId ?? null,
      title: impact.title ?? null,
      direction: impact.direction ?? null,
      relationType: impact.relationType ?? null,
      strength: impact.strength ?? null,
      confidence: impact.confidence ?? null,
    })),
  };
}

function categoryPlaybook(framework, category) {
  const policy = framework.offReportHoldingPolicy ?? {};
  return policy.categoryPlaybooks?.[category] ?? policy.default ?? {};
}

function isReportLight(reportCoverage) {
  return ["OFF_REPORT_HOLDING", "NO_CLEAN_REPORT_LINK", "WEAK_LINKED_REPORT"].includes(reportCoverage?.status);
}

function directionLabel(direction) {
  if (direction === "positive") return "호재";
  if (direction === "negative") return "경계";
  if (direction === "mixed") return "혼합";
  return "중립";
}

function externalSourceOrigins(topic) {
  return (topic?.subTopics ?? [])
    .flatMap((subTopic) => subTopic?.sourceOrigins ?? [])
    .filter((source) => source?.url || source?.title)
    .map((source) => ({
      title: truncate(source.title ?? source.url ?? "외부 원문", 120),
      author: source.author ?? null,
      type: source.type ?? null,
      url: source.url ?? null,
    }))
    .slice(0, 4);
}

function externalTopicSummary(topic) {
  const subTopicSummary = (topic?.subTopics ?? []).map((subTopic) => subTopic?.summary).find(Boolean);
  return truncate(subTopicSummary ?? topic?.summary ?? topic?.portfolioLinkage ?? "외부 보강 요약 없음", 260);
}

function externalNumbers(topic) {
  return [
    typeof topic?.topicDocumentSize === "number" ? `원문 ${topic.topicDocumentSize}건` : null,
    typeof topic?.quoteCount === "number" ? `인용 ${topic.quoteCount}건` : null,
    ...((topic?.keywordList ?? [])
      .filter((item) => typeof item?.fluctuationRate === "number" && Number.isFinite(item.fluctuationRate))
      .slice(0, 3)
      .map((item) => `${item.name} ${item.fluctuationRate > 0 ? "+" : ""}${item.fluctuationRate.toFixed(2)}%`)),
  ].filter(Boolean);
}

function buildExternalEvidenceForCard({ marketVoice, externalNews, accountKey, code, name, category }) {
  const topics = Array.isArray(marketVoice?.topics) ? marketVoice.topics : [];
  const matches = [];

  for (const topic of topics) {
    const directMatch = (topic?.portfolioMatches?.directHoldings ?? []).find(
      (match) =>
        String(match?.code ?? "") === String(code ?? "") &&
        (!match?.accountKey || !accountKey || match.accountKey === accountKey),
    );
    const categoryMatch = (topic?.portfolioMatches?.thematicAccounts ?? []).find(
      (match) => match?.accountKey === accountKey && match?.category === category,
    );
    const watchlistMatch = (topic?.portfolioMatches?.watchlist ?? []).find(
      (match) => String(match?.code ?? "") === String(code ?? ""),
    );
    const keywordCodeMatch = Boolean(code) && (topic?.keywordList ?? []).some((keyword) => String(keyword?.code ?? "") === String(code));

    if (!directMatch && !categoryMatch && !watchlistMatch && !keywordCodeMatch) {
      continue;
    }

    const connectionType = directMatch
      ? "직접"
      : categoryMatch
        ? "테마"
        : watchlistMatch
          ? "관심"
          : "코드";
    const direction =
      directMatch?.impactDirection ??
      categoryMatch?.impactDirection ??
      topic?.signalDirection ??
      "neutral";
    const matchBonus = directMatch ? 36 : categoryMatch ? 22 : watchlistMatch ? 14 : 12;

    matches.push({
      topicId: topic.topicId ?? null,
      title: truncate(topic.title ?? `${name ?? code} 외부 이슈`, 140),
      topicUrl: topic.topicUrl ?? null,
      updatedAt: topic.displayUpdatedAt ?? null,
      source: topic?.mainSource?.author ?? topic?.mainSource?.name ?? "Moneytoring",
      sourceTypes: topic.uniqueSourceTypeList ?? [],
      direction,
      directionLabel: directionLabel(direction),
      signalLabels: topic.signalLabels ?? [],
      relevanceScore: topic.relevanceScore ?? 0,
      connectionType,
      matchReasons: [
        ...(directMatch?.matchReasons ?? []),
        ...(categoryMatch?.matchReasons ?? []),
        ...(watchlistMatch?.matchReasons ?? []),
        keywordCodeMatch ? `키워드코드:${code}` : null,
      ].filter(Boolean).slice(0, 5),
      summary: externalTopicSummary(topic),
      numbers: externalNumbers(topic),
      sourceOrigins: externalSourceOrigins(topic),
      sortScore: (topic.relevanceScore ?? 0) + matchBonus,
    });
  }

  const newsKey = `${accountKey}:${code ?? name}`;
  const newsEntry = externalNews?.holdings?.[newsKey] ?? null;
  for (const item of newsEntry?.items ?? []) {
    matches.push({
      topicId: null,
      title: item.title,
      topicUrl: item.url ?? newsEntry.url ?? null,
      updatedAt: item.publishedAt ?? null,
      source: item.source ?? "Google News RSS",
      sourceTypes: ["NEWS_RSS"],
      direction: item.direction ?? "neutral",
      directionLabel: directionLabel(item.direction ?? "neutral"),
      signalLabels: [category].filter(Boolean),
      relevanceScore: 42,
      connectionType: "검색",
      matchReasons: [name, code, category].filter(Boolean).slice(0, 4),
      summary: item.summary ?? item.title,
      numbers: [],
      sourceOrigins: [
        {
          title: item.title,
          author: item.source ?? null,
          type: "NEWS_RSS",
          url: item.url ?? null,
        },
      ],
      sortScore: 48,
    });
  }

  const evidence = matches
    .sort((left, right) => (right.sortScore ?? 0) - (left.sortScore ?? 0))
    .slice(0, 3)
    .map(({ sortScore, ...item }) => item);
  const available = evidence.length > 0;
  const top = evidence[0] ?? null;

  return {
    available,
    statusLabel: available ? "외부근거" : "리포트밖",
    evidenceCount: evidence.length,
    topDirection: top?.direction ?? null,
    topDirectionLabel: top?.directionLabel ?? null,
    topTitle: top?.title ?? null,
    topics: evidence,
    provenance: {
      source: marketVoice?.provenance?.source ?? "marketvoice-linked",
      generatedAt: marketVoice?.generatedAt ?? null,
    },
  };
}

function buildHoldingRole({
  category,
  item,
  plan,
  quantPosition,
  account,
  holding,
  technical,
  reportCoverage,
  externalCoverage,
  framework,
}) {
  const playbook = categoryPlaybook(framework, category);
  const stats = buildPositionStats({ account, holding, quantPosition, technical });
  const score = numberOrNull(item?.score, quantPosition?.actionScore);
  const factorScore = numberOrNull(quantPosition?.factor?.score, quantPosition?.scores?.factorScore);
  const reportScore = numberOrNull(quantPosition?.scores?.reportScore, reportCoverage?.impactScore);
  const techScore = numberOrNull(quantPosition?.technicalBaseScore, quantPosition?.scores?.techScore);
  const evidenceNotes = [];

  if (isReportLight(reportCoverage)) {
    if (externalCoverage?.available) {
      evidenceNotes.push(`오늘 PDF 직접 근거는 약하지만 외부 보강 ${externalCoverage.evidenceCount}건을 확인했습니다.`);
      const topExternal = externalCoverage.topTitle
        ? `${externalCoverage.topDirectionLabel ?? "중립"}: ${externalCoverage.topTitle}`
        : null;
      if (topExternal) evidenceNotes.push(`외부 근거 ${topExternal}`);
    } else {
      evidenceNotes.push(`오늘 리포트 직접 근거는 약합니다: ${reportCoverage.statusLabel}`);
    }
  } else {
    evidenceNotes.push(`오늘 리포트 근거 ${reportCoverage.impactCount}건이 연결됐습니다.`);
  }
  if (stats.weight != null) {
    evidenceNotes.push(`계좌 내 비중 ${formatWeight(stats.weight)}, 평가손익률 ${formatPctPoint(stats.profitRatePct)}`);
  } else if (stats.marketValue != null) {
    evidenceNotes.push(`평가금액 ${formatAmount(stats.marketValue)}, 평가손익률 ${formatPctPoint(stats.profitRatePct)}`);
  }
  if (score != null) evidenceNotes.push(`액션 점수 ${score}점`);
  if (factorScore != null) evidenceNotes.push(`팩터 ${factorScore}점`);
  if (techScore != null) evidenceNotes.push(`기술 ${techScore}점`);
  if (reportScore != null) evidenceNotes.push(`리포트 ${reportScore}점`);
  if (plan?.topGap?.category === category) {
    evidenceNotes.push(`이 계좌의 최우선 부족 자산군과 일치: ${category}`);
  } else if (plan?.topGap?.category) {
    evidenceNotes.push(`오늘 신규자금 우선 갭은 ${reasonParticle(plan.topGap.category)} 추가매수 우선순위는 낮습니다.`);
  }

  return {
    role: playbook.role ?? "보유 역할 미정",
    keepRule: playbook.keepRule ?? null,
    addRule: playbook.addRule ?? null,
    trimRule: playbook.trimRule ?? null,
    invalidation: playbook.invalidation ?? [],
    reviewChecklist: playbook.reviewChecklist ?? [],
    position: stats,
    scoreBreakdown: {
      actionScore: score,
      factorScore,
      techScore,
      reportScore,
      signal: quantPosition?.signal ?? quantPosition?.technicalSignal ?? null,
      conviction: quantPosition?.conviction ?? null,
    },
    evidenceNotes: [...new Set(evidenceNotes)].slice(0, 7),
  };
}

function buildThesis({ item, sourceAction, reportCoverage, externalCoverage, holdingRole }) {
  if (sourceAction !== "REJECTED" && isReportLight(reportCoverage)) {
    if (externalCoverage?.available) {
      const top = externalCoverage.topics?.[0];
      return truncate(
        `${subjectWithTopic(item?.name)} 오늘 PDF 리포트 밖에 있지만 외부 시황/뉴스 ${externalCoverage.evidenceCount}건을 확인했습니다. 핵심은 '${top?.title ?? "외부 보강 이슈"}'이며 방향은 ${top?.directionLabel ?? "중립"}입니다. 그래서 '${holdingRole.role}' 역할과 가격/비중을 함께 보며, 외부 근거가 이어질 때만 추가 판단합니다.`,
        460,
      );
    }
    return truncate(
      `${subjectWithTopic(item?.name)} ${reportCoverage.statusLabel} 상태입니다. 그래서 오늘 판단은 새 리포트 한 줄보다 '${holdingRole.role}' 역할, 계좌 내 비중, 손익률, 팩터/기술 점수로 봅니다. ${holdingRole.keepRule ?? ""}`,
      420,
    );
  }
  return truncate(item?.reason ?? item?.rejectionReason ?? "근거 없음", 320);
}

function detectRiskFlags({ item, technical, framework, reportCoverage }) {
  const thresholds = framework.thresholds ?? {};
  const flags = [];
  if (technical.rsi != null && technical.rsi >= (thresholds.overheatRsi ?? 75)) flags.push(`RSI_OVERHEAT:${technical.rsi}`);
  if (technical.bollingerPosition === "above_upper") flags.push("BOLLINGER_ABOVE_UPPER");
  if (technical.dayChangePct != null && technical.dayChangePct >= (thresholds.dayChangeOverheatPct ?? 0.05)) {
    flags.push(`DAY_SURGE:${formatPct(technical.dayChangePct)}`);
  }
  if (technical.stopLossTriggered) flags.push("STOP_LOSS_TRIGGERED");
  if (!item?.code) flags.push("MISSING_SECURITY_CODE");
  if (!technical.currentPrice || (technical.rsi == null && technical.atrPct == null && !technical.bollingerPosition)) {
    flags.push("TECHNICAL_DATA_GAP");
  }
  if (/가격\/기술 데이터는 제한적|직접 연결 리포트가 부족|데이터가 부족/i.test(item?.reason ?? "")) {
    flags.push("WEAK_DIRECT_EVIDENCE");
  }
  if (reportCoverage?.status === "OFF_REPORT_HOLDING") flags.push("OFF_REPORT_HOLDING");
  if (reportCoverage?.status === "NO_CLEAN_REPORT_LINK") flags.push("NO_CLEAN_REPORT_LINK");
  if (reportCoverage?.status === "WEAK_LINKED_REPORT") flags.push("WEAK_LINKED_REPORT");
  if (item?.rejectionReason) flags.push("BLOCKED_BY_STAGE4_VALIDATION");
  return flags;
}

function hasFlag(flags, prefix) {
  return flags.some((flag) => flag === prefix || flag.startsWith(`${prefix}:`));
}

function classifyDecision({ sourceAction, item, technical, riskFlags, framework, reportCoverage }) {
  const thresholds = framework.thresholds ?? {};
  if (sourceAction === "REJECTED") return "BLOCKED_BUY";
  if (sourceAction === "BUY") return item?.conditionMet === false ? "CONDITIONAL_BUY" : "BUY_NOW";
  if (sourceAction === "TRIM") return "TRIM_REVIEW";
  if (hasFlag(riskFlags, "MISSING_SECURITY_CODE") || !technical.currentPrice) return "WATCH_DATA";
  if (["HOLD", "WATCH"].includes(sourceAction) && isReportLight(reportCoverage)) return "WATCH_OFF_REPORT";
  if (sourceAction === "HOLD") {
    const profitProtect =
      technical.drawdownFromEntryPct != null &&
      technical.drawdownFromEntryPct >= (thresholds.profitProtectFromEntryPct ?? 0.2) &&
      (hasFlag(riskFlags, "RSI_OVERHEAT") || hasFlag(riskFlags, "BOLLINGER_ABOVE_UPPER"));
    return profitProtect ? "HOLD_PROTECT" : "HOLD_KEEP";
  }
  if (hasFlag(riskFlags, "TECHNICAL_DATA_GAP")) return "WATCH_DATA";
  if ((item?.score ?? 0) <= (thresholds.watchRiskMaxScore ?? 44) || hasFlag(riskFlags, "WEAK_DIRECT_EVIDENCE")) {
    return "WATCH_RISK";
  }
  if (
    (item?.score ?? 0) >= (thresholds.watchAddMinScore ?? 47) ||
    hasFlag(riskFlags, "RSI_OVERHEAT") ||
    hasFlag(riskFlags, "BOLLINGER_ABOVE_UPPER")
  ) {
    return "WATCH_ADD";
  }
  return "WATCH_TRIM";
}

function buildAddConditions({ decisionBucket, sourceAction, item, technical, aiStackTags, plan, holdingRole, externalCoverage }) {
  const conditions = [];
  if (decisionBucket === "BUY_NOW") {
    conditions.push(`검증 통과 금액 ${formatAmount(item.suggestedAmount)} 이내에서 분할 실행`);
  }
  if (decisionBucket === "CONDITIONAL_BUY") {
    conditions.push(`진입 조건 확인: ${(item.entryTriggers ?? []).join(", ") || item.entryCondition || "조건 재점검"}`);
  }
  if (decisionBucket === "BLOCKED_BUY") {
    conditions.push(`차단 해제 조건: ${item.rejectionReason ?? "Stage 4 검증 사유 해소"}`);
  }
  if (hasOverheat(technical) && decisionBucket !== "WATCH_OFF_REPORT") {
    conditions.push("추격매수 금지: RSI 65 이하, 20일선 근처, 또는 급등 진정 후 1차 접근");
  }
  if (decisionBucket === "WATCH_DATA") {
    conditions.push("가격/기술 지표/종목 코드 정규화가 보강된 뒤 재판단");
  }
  if (decisionBucket === "WATCH_OFF_REPORT") {
    if (externalCoverage?.available) {
      const top = externalCoverage.topics?.[0];
      if (top?.direction === "negative") {
        conditions.push(`외부 경계 해소 전 추가 금지: ${top.title}`);
      } else if (top?.direction === "positive") {
        conditions.push(`외부 호재 확인: 가격 과열 완화 후 ${top.title} 지속 여부 점검`);
      } else {
        conditions.push(`외부 근거 혼재: ${top?.title ?? "외부 이슈"} 후속 확인 후 판단`);
      }
    }
    if (holdingRole?.addRule) conditions.push(holdingRole.addRule);
    if (holdingRole?.reviewChecklist?.length) {
      conditions.push(`리포트 공백 보강: ${holdingRole.reviewChecklist.slice(0, 3).join(", ")}`);
    }
    if (hasOverheat(technical)) {
      conditions.push("추격매수 금지: RSI 65 이하, 20일선 근처, 또는 급등 진정 후 1차 접근");
    }
  }
  if (plan?.topGap?.category && ["BUY", "WATCH", "REJECTED"].includes(sourceAction)) {
    conditions.push(`계좌 목표 비중 갭: ${plan.topGap.category} ${formatAmount(Math.max(plan.topGap.gapAmount ?? 0, 0))}`);
  }
  for (const tag of aiStackTags.slice(0, 2)) {
    if (tag.addCondition) conditions.push(tag.addCondition);
  }
  return [...new Set(conditions)].slice(0, 5);
}

function hasOverheat(technical) {
  return (
    (technical.rsi != null && technical.rsi >= 75) ||
    technical.bollingerPosition === "above_upper" ||
    (technical.dayChangePct != null && technical.dayChangePct >= 0.05)
  );
}

function buildTrimConditions({ item, technical, decisionBucket, holdingRole }) {
  const conditions = [];
  if (technical.stopLossTriggered) conditions.push("손절 조건 발동: 즉시 감량/매도 검토");
  if (technical.drawdownFromRecentHighPct != null && technical.drawdownFromRecentHighPct <= -0.12) {
    conditions.push(`최근 고점 대비 ${formatPct(technical.drawdownFromRecentHighPct)} 하락: 수익 보호선 점검`);
  }
  if (technical.drawdownFromEntryPct != null && technical.drawdownFromEntryPct <= -0.1) {
    conditions.push(`진입가 대비 ${formatPct(technical.drawdownFromEntryPct)}: 손절 기준 접근`);
  }
  if (decisionBucket === "HOLD_PROTECT") {
    conditions.push("강한 수익 구간: 20일선 이탈 또는 RSI 하락 반전 시 일부 이익 실현 검토");
  }
  if (decisionBucket === "WATCH_OFF_REPORT" && holdingRole?.trimRule) {
    conditions.push(holdingRole.trimRule);
  }
  if ((item?.score ?? 100) <= 38) conditions.push(`점수 ${item.score}점: forced trim 기준 접근`);
  return [...new Set(conditions)].slice(0, 4);
}

function buildInvalidation({ aiStackTags, category, item, holdingRole }) {
  const tagInvalidations = aiStackTags.flatMap((tag) => tag.invalidation ?? []);
  const generic = [
    `${category ?? "해당 자산군"} thesis를 뒷받침하는 리포트/수급/가격 신호가 동시에 약해질 때`,
    "계좌 목표 비중이나 클러스터 한도를 넘어 포트폴리오 집중도가 높아질 때",
  ];
  if (/소프트웨어|software|saas/i.test(valueText(item))) {
    generic.unshift("AI 기능이 실제 매출, ARR, 사용량 과금, 마진 개선으로 연결되지 않을 때");
  }
  return [...new Set([...(holdingRole?.invalidation ?? []), ...tagInvalidations, ...generic])].slice(0, 5);
}

function nextReviewFor(decisionBucket) {
  if (decisionBucket === "BUY_NOW") return "주문 직전 가격/호가/비중 재확인";
  if (decisionBucket === "CONDITIONAL_BUY" || decisionBucket === "WATCH_ADD" || decisionBucket === "BLOCKED_BUY") {
    return "다음 장 마감 후 또는 조건 충족 시";
  }
  if (decisionBucket === "WATCH_DATA") return "데이터 보강 직후";
  if (decisionBucket === "WATCH_OFF_REPORT") return "신규 리포트 발생 시 또는 주간 포트폴리오 점검";
  if (decisionBucket === "TRIM_REVIEW" || decisionBucket === "HOLD_PROTECT" || decisionBucket === "WATCH_TRIM") {
    return "익일 장중/장마감 리스크 재확인";
  }
  return "주간 점검 또는 신규 리포트 발생 시";
}

function quantPositionFor(quant, accountKey, code) {
  if (!code) return null;
  return quant?.positions?.[`${accountKey}:${code}`] ?? quant?.holdings?.[code] ?? null;
}

function buildCard({ item, sourceAction, plan, stage4, quant, framework, portfolio, marketVoice, externalNews }) {
  const accountKey = plan.key;
  const quantPosition = quantPositionFor(quant, accountKey, item?.code);
  const category = getCategory(item?.code, accountKey) ?? quantPosition?.category ?? "기타";
  const technical = technicalSnapshot(item, quantPosition);
  const account = accountSnapshotFor(portfolio, accountKey);
  const holding = portfolioHoldingFor(portfolio, accountKey, item);
  const rawReportCoverage = buildReportCoverage(quantPosition);
  const externalCoverage = buildExternalEvidenceForCard({
    marketVoice,
    externalNews,
    accountKey,
    code: item?.code,
    name: item?.name,
    category,
  });
  const reportCoverage = {
    ...rawReportCoverage,
    originalStatusLabel: rawReportCoverage.statusLabel,
    statusLabel: isReportLight(rawReportCoverage) && externalCoverage.available
      ? externalCoverage.statusLabel
      : rawReportCoverage.statusLabel,
    externalEvidenceCount: externalCoverage.evidenceCount,
  };
  const aiStackTags = matchAiStackTags({ item, category, framework, includeReason: !isReportLight(reportCoverage) });
  const holdingRole = buildHoldingRole({
    category,
    item,
    plan,
    quantPosition,
    account,
    holding,
    technical,
    reportCoverage,
    externalCoverage,
    framework,
  });
  const riskFlags = detectRiskFlags({ item, technical, framework, reportCoverage });
  const decisionBucket = classifyDecision({ sourceAction, item, technical, riskFlags, framework, reportCoverage });
  const decisionLabel =
    decisionBucket === "WATCH_OFF_REPORT" && externalCoverage.available
      ? "외부관찰"
      : framework.decisionBuckets?.[decisionBucket] ?? decisionBucket;
  const addConditions = buildAddConditions({
    decisionBucket,
    sourceAction,
    item,
    technical,
    aiStackTags,
    plan,
    holdingRole,
    externalCoverage,
  });
  const trimConditions = buildTrimConditions({ item, technical, decisionBucket, holdingRole });

  return {
    date: stage4.date,
    accountKey,
    accountLabel: plan.label,
    code: item?.code ?? null,
    name: item?.name ?? "N/A",
    category,
    sourceAction,
    sourceActionLabel: sourceActionLabel(sourceAction),
    decisionBucket,
    decisionLabel,
    score: item?.score ?? null,
    suggestedAmount: item?.suggestedAmount ?? null,
    currentPrice: technical.currentPrice,
    entryPrice: technical.entryPrice,
    technical,
    reportCoverage,
    externalCoverage,
    holdingRole,
    aiStackTags,
    thesis: buildThesis({ item, sourceAction, reportCoverage, externalCoverage, holdingRole }),
    addConditions,
    trimConditions,
    invalidationConditions: buildInvalidation({ aiStackTags, category, item, holdingRole }),
    blockedBuyReason: sourceAction === "REJECTED" ? item?.rejectionReason ?? null : null,
    riskFlags,
    nextReview: nextReviewFor(decisionBucket),
    evidence: {
      reason: item?.reason ?? null,
      rejectionReason: item?.rejectionReason ?? null,
      entryCondition: item?.entryCondition ?? null,
      entryTriggers: item?.entryTriggers ?? [],
      validationPolicy: plan.validationPolicy ?? null,
      validationFlags: plan.validatorFlags ?? [],
      reportCoverage,
      externalCoverage,
      holdingRoleEvidence: holdingRole.evidenceNotes,
    },
  };
}

function buildCards(stage4, quant, framework, portfolio, marketVoice, externalNews = null) {
  const cards = [];
  for (const plan of stage4.accountPlans ?? []) {
    for (const item of plan.stagedBuys ?? []) cards.push(buildCard({ item, sourceAction: "BUY", plan, stage4, quant, framework, portfolio, marketVoice, externalNews }));
    for (const item of plan.trims ?? []) cards.push(buildCard({ item, sourceAction: "TRIM", plan, stage4, quant, framework, portfolio, marketVoice, externalNews }));
    for (const item of plan.holds ?? []) cards.push(buildCard({ item, sourceAction: "HOLD", plan, stage4, quant, framework, portfolio, marketVoice, externalNews }));
    for (const item of plan.watches ?? []) cards.push(buildCard({ item, sourceAction: "WATCH", plan, stage4, quant, framework, portfolio, marketVoice, externalNews }));
    for (const item of plan.rejectedAlternatives ?? []) {
      cards.push(buildCard({ item, sourceAction: "REJECTED", plan, stage4, quant, framework, portfolio, marketVoice, externalNews }));
    }
  }
  return cards;
}

function summarize(cards, stage4) {
  const byBucket = cards.reduce((acc, card) => {
    acc[card.decisionBucket] = (acc[card.decisionBucket] ?? 0) + 1;
    return acc;
  }, {});
  const topBlocked = cards.filter((card) => card.decisionBucket === "BLOCKED_BUY").slice(0, 5);
  const topConditional = cards.filter((card) => ["CONDITIONAL_BUY", "WATCH_ADD"].includes(card.decisionBucket)).slice(0, 8);
  const trimWatch = cards.filter((card) => ["TRIM_REVIEW", "HOLD_PROTECT", "WATCH_TRIM", "WATCH_RISK"].includes(card.decisionBucket)).slice(0, 8);
  const offReportHoldings = cards.filter((card) => card.decisionBucket === "WATCH_OFF_REPORT").slice(0, 12);
  const dataNeeds = cards.filter((card) => card.decisionBucket === "WATCH_DATA").slice(0, 8);
  const externalEnriched = cards.filter(
    (card) => card.decisionBucket === "WATCH_OFF_REPORT" && card.externalCoverage?.available,
  ).length;
  return {
    portfolioScore: stage4.portfolioScore ?? null,
    regime: stage4.regime?.name ?? null,
    counts: {
      total: cards.length,
      immediateBuy: byBucket.BUY_NOW ?? 0,
      conditionalBuy: (byBucket.CONDITIONAL_BUY ?? 0) + (byBucket.WATCH_ADD ?? 0),
      blockedBuy: byBucket.BLOCKED_BUY ?? 0,
      trimOrProtect:
        (byBucket.TRIM_REVIEW ?? 0) +
        (byBucket.HOLD_PROTECT ?? 0) +
        (byBucket.WATCH_TRIM ?? 0) +
        (byBucket.WATCH_RISK ?? 0),
      offReportHoldings: byBucket.WATCH_OFF_REPORT ?? 0,
      externalEnriched,
      dataNeeds: byBucket.WATCH_DATA ?? 0,
    },
    topBlocked,
    topConditional,
    trimWatch,
    offReportHoldings,
    dataNeeds,
  };
}

function escapePipe(value) {
  return String(value ?? "-").replace(/\|/g, "\\|");
}

function cleanNewsTitle(value) {
  return compact(value)
    .replace(/\s+-\s+Google 뉴스$/i, "")
    .trim();
}

function inferExternalNewsDirection(text) {
  const haystack = compact(text);
  const positive = /(호조|상승|유입|증가|확대|돌파|수혜|인기|순자산|강세|방어|고배당|분배|개선)/i.test(haystack);
  const negative = /(하락|부진|유출|축소|경계|우려|불안|손실|급락|압박|둔화)/i.test(haystack);
  if (positive && negative) return "mixed";
  if (positive) return "positive";
  if (negative) return "negative";
  return "neutral";
}

function googleNewsQueryFor(card) {
  if (card.name) return `"${card.name}"`;
  if (card.code) return `"${card.code}"`;
  return `"${card.category ?? "ETF"}"`;
}

async function collectGoogleNewsForCards(cards, args) {
  const parser = new Parser();
  const uniqueCards = [
    ...new Map(cards.map((card) => [`${card.accountKey}:${card.code ?? card.name}`, card])).values(),
  ];
  const holdings = {};
  const errors = [];

  for (const card of uniqueCards) {
    const query = `${googleNewsQueryFor(card)} when:90d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    const key = `${card.accountKey}:${card.code ?? card.name}`;

    try {
      const feed = await parser.parseURL(url);
      const items = (feed.items ?? []).slice(0, 4).map((item) => {
        const title = cleanNewsTitle(item.title);
        const text = compact([title, item.contentSnippet, item.content].filter(Boolean).join(" "));
        return {
          title: truncate(title, 140),
          url: item.link ?? null,
          publishedAt: item.isoDate ?? item.pubDate ?? null,
          source: item.source?.title ?? null,
          summary: truncate(item.contentSnippet ?? item.content ?? title, 260),
          direction: inferExternalNewsDirection(text),
        };
      });

      holdings[key] = {
        accountKey: card.accountKey,
        code: card.code,
        name: card.name,
        category: card.category,
        query,
        url,
        items,
      };
    } catch (error) {
      errors.push({
        accountKey: card.accountKey,
        code: card.code,
        name: card.name,
        query,
        message: error instanceof Error ? error.message : String(error),
      });
      holdings[key] = {
        accountKey: card.accountKey,
        code: card.code,
        name: card.name,
        category: card.category,
        query,
        url,
        items: [],
      };
    }
  }

  return {
    ...buildRunMetadata(args),
    schemaVersion: 1,
    provenance: {
      source: "google-news-rss",
      queryWindow: "90d",
      note: "MarketVoice에 연결되지 않은 리포트밖 보유종목을 종목명/코드/카테고리로 보조 검색",
    },
    holdings,
    errors,
  };
}

function cardCondition(card) {
  if (card.decisionBucket === "HOLD_KEEP") return card.thesis ?? card.holdingRole?.keepRule ?? card.nextReview;
  return card.addConditions?.[0] ?? card.trimConditions?.[0] ?? card.holdingRole?.keepRule ?? card.blockedBuyReason ?? card.nextReview;
}

function buildMarkdown(payload) {
  const { date, summary, cards, framework } = payload;
  const lines = [
    `# Stage 4.5 보유종목 판단 카드 (${date})`,
    "",
    `- 포트폴리오 점수: ${summary.portfolioScore ?? "-"}`,
    `- 시장 국면: ${summary.regime ?? "-"}`,
    `- 전체 카드: ${summary.counts.total}`,
    `- 즉시 실행: ${summary.counts.immediateBuy}`,
    `- 조건부 매수: ${summary.counts.conditionalBuy}`,
    `- 차단된 매수: ${summary.counts.blockedBuy}`,
    `- 감량/보호: ${summary.counts.trimOrProtect}`,
    `- 리포트 밖 보유: ${summary.counts.offReportHoldings}`,
    `- 외부 보강: ${summary.counts.externalEnriched}`,
    `- 데이터 보강: ${summary.counts.dataNeeds}`,
    "",
    "## 오늘의 결론",
    "",
    summary.counts.immediateBuy > 0
      ? `- 즉시 실행 후보 ${summary.counts.immediateBuy}건이 있습니다. 주문 직전 가격과 계좌 비중을 다시 확인하세요.`
      : "- 즉시 실행 후보는 없습니다.",
    summary.counts.conditionalBuy > 0
      ? `- 조건부 매수/조정 대기 후보 ${summary.counts.conditionalBuy}건이 있습니다.`
      : "- 조건부 매수 후보는 제한적입니다.",
    summary.counts.blockedBuy > 0
      ? `- Stage 4 검증에서 차단된 매수 후보 ${summary.counts.blockedBuy}건이 있습니다. 이유를 확인하세요.`
      : "- 차단된 매수 후보는 없습니다.",
    summary.counts.trimOrProtect > 0
      ? `- 감량/수익보호/리스크 관찰 후보 ${summary.counts.trimOrProtect}건이 있습니다.`
      : "- 즉시 감량 후보는 없습니다.",
    summary.counts.offReportHoldings > 0
      ? `- 오늘 리포트에 직접 등장하지 않은 보유종목 ${summary.counts.offReportHoldings}건 중 외부 보강 ${summary.counts.externalEnriched}건을 확인했습니다.`
      : "- 리포트 밖 보유종목 별도 점검 대상은 없습니다.",
    summary.counts.dataNeeds > 0
      ? `- 데이터 보강 필요 후보 ${summary.counts.dataNeeds}건이 있습니다. 코드/가격/기술 지표를 먼저 고쳐야 합니다.`
      : "- 데이터 보강 필요 후보는 없습니다.",
    "",
    "## 주문 전 판단표",
    "",
    "| 계좌 | 판정 | 리포트상태 | 액션 | 종목 | 점수 | 금액 | 조건/이유 | 다음 점검 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const card of cards) {
    lines.push(
      `| ${escapePipe(card.accountLabel)} | ${escapePipe(card.decisionLabel)} | ${escapePipe(card.reportCoverage?.statusLabel ?? "-")} | ${escapePipe(card.sourceActionLabel ?? sourceActionLabel(card.sourceAction))} | ${escapePipe(card.name)} | ${escapePipe(card.score ?? "-")} | ${escapePipe(formatAmount(card.suggestedAmount))} | ${escapePipe(truncate(cardCondition(card), 80))} | ${escapePipe(card.nextReview)} |`,
    );
  }

  lines.push("", "## 리포트 밖 보유종목 보강", "");
  if (summary.offReportHoldings.length) {
    for (const card of summary.offReportHoldings) {
      lines.push(`- ${card.accountLabel} / ${card.name}: ${card.holdingRole?.role ?? "보유 역할 미정"}`);
      lines.push(`  - 유지 논리: ${card.holdingRole?.keepRule ?? card.thesis}`);
      if (card.holdingRole?.evidenceNotes?.length) {
        lines.push(`  - 계좌 근거: ${card.holdingRole.evidenceNotes.join(" / ")}`);
      }
      if (card.externalCoverage?.available) {
        for (const topic of card.externalCoverage.topics.slice(0, 2)) {
          lines.push(`  - 외부 근거: [${topic.directionLabel}] ${topic.title} / ${topic.summary}`);
          const sourceUrl = topic.sourceOrigins?.[0]?.url ?? topic.topicUrl;
          if (sourceUrl) lines.push(`  - 외부 원문: ${sourceUrl}`);
        }
      }
      if (card.addConditions?.length) lines.push(`  - 추가 조건: ${card.addConditions.slice(0, 2).join(" / ")}`);
      if (card.trimConditions?.length) lines.push(`  - 감량 조건: ${card.trimConditions.slice(0, 2).join(" / ")}`);
      if (card.holdingRole?.reviewChecklist?.length) {
        lines.push(`  - 다음 확인: ${card.holdingRole.reviewChecklist.join(", ")}`);
      }
    }
  } else {
    lines.push("- 리포트 밖 보유종목 없음");
  }

  lines.push("", "## 탈락 후보와 해제 조건", "");
  if (summary.topBlocked.length) {
    for (const card of summary.topBlocked) {
      lines.push(`- ${card.accountLabel} / ${card.name}: ${card.blockedBuyReason ?? "차단 사유 없음"}`);
      for (const condition of card.addConditions.slice(0, 2)) lines.push(`  - 해제 조건: ${condition}`);
    }
  } else {
    lines.push("- 탈락 후보 없음");
  }

  lines.push("", "## 종목별 상세 카드", "");
  for (const card of cards) {
    lines.push(`### ${card.accountLabel} / ${card.name} (${card.code ?? "N/A"})`);
    lines.push(`- 판정: ${card.decisionLabel}`);
    lines.push(`- 액션: ${card.sourceActionLabel ?? sourceActionLabel(card.sourceAction)}`);
    lines.push(`- AI 스택: ${card.aiStackTags.map((tag) => tag.label).join(", ") || "일반"}`);
    lines.push(`- 리포트 상태: ${card.reportCoverage?.statusLabel ?? "-"} / 직접 ${card.reportCoverage?.directCount ?? 0}건 / 전체 ${card.reportCoverage?.impactCount ?? 0}건`);
    lines.push(`- 계좌 역할: ${card.holdingRole?.role ?? "-"}`);
    if (card.holdingRole?.position) {
      lines.push(
        `- 계좌 비중/손익: ${formatWeight(card.holdingRole.position.weight)} / ${formatPctPoint(card.holdingRole.position.profitRatePct)} / ${formatAmount(card.holdingRole.position.marketValue)}`,
      );
    }
    if (card.holdingRole?.evidenceNotes?.length) lines.push(`- 계좌 근거: ${card.holdingRole.evidenceNotes.join(" / ")}`);
    if (card.externalCoverage?.available) {
      lines.push(`- 외부 보강: ${card.externalCoverage.evidenceCount}건 / ${card.externalCoverage.topDirectionLabel ?? "중립"}`);
      for (const topic of card.externalCoverage.topics.slice(0, 2)) {
        lines.push(`  - [${topic.directionLabel}] ${topic.title}`);
        lines.push(`    - 요약: ${topic.summary}`);
        if (topic.numbers?.length) lines.push(`    - 수치: ${topic.numbers.join(", ")}`);
        const sourceUrl = topic.sourceOrigins?.[0]?.url ?? topic.topicUrl;
        if (sourceUrl) lines.push(`    - 원문: ${sourceUrl}`);
      }
    }
    lines.push(`- 현재가/진입가: ${formatAmount(card.currentPrice)} / ${formatAmount(card.entryPrice)}`);
    lines.push(`- 기술 지표: RSI ${card.technical.rsi ?? "-"} / 볼린저 ${card.technical.bollingerPosition ?? "-"} / ATR ${formatPct(card.technical.atrPct)}`);
    lines.push(`- 투자 논리: ${card.thesis}`);
    lines.push(`- 추가매수 조건: ${card.addConditions.join(" / ") || "없음"}`);
    lines.push(`- 감량 조건: ${card.trimConditions.join(" / ") || "없음"}`);
    lines.push(`- 무효화 조건: ${card.invalidationConditions.join(" / ")}`);
    lines.push(`- 리스크 플래그: ${card.riskFlags.join(", ") || "없음"}`);
    lines.push(`- 다음 점검: ${card.nextReview}`);
    lines.push("");
  }

  lines.push("## AI 전략 참고 소스", "");
  for (const source of framework.sourceReferences ?? []) {
    lines.push(`- [${source.label}](${source.url}) - ${source.use}`);
  }

  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const frameworkPath = path.join(ROOT_DIR, "config", "ai-strategy-framework.json");
  const [framework, stage4, quant, portfolioRaw, marketVoice] = await Promise.all([
    readJson(frameworkPath, null),
    readJson(path.join(stateDir, "stage4-execution-plan.json"), null),
    readJson(path.join(stateDir, "stage3-quant-scores.json"), { positions: {}, holdings: {} }),
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(stateDir, "marketvoice-linked.json"), {
      summary: null,
      topics: [],
      accountDigests: [],
      deepResearchCandidates: [],
      impactReports: [],
    }),
  ]);

  if (!framework) throw new Error(`AI strategy framework missing: ${frameworkPath}`);
  if (!stage4) throw new Error(`Stage 4 execution plan missing: ${path.join(stateDir, "stage4-execution-plan.json")}`);

  const portfolio = enrichPortfolioWithSecurityCodes(portfolioRaw);
  let cards = buildCards(stage4, quant, framework, portfolio, marketVoice);
  let externalNews = null;
  const offReportWithoutExternal = cards.filter(
    (card) => card.decisionBucket === "WATCH_OFF_REPORT" && !card.externalCoverage?.available,
  );
  if (offReportWithoutExternal.length > 0) {
    try {
      externalNews = await collectGoogleNewsForCards(offReportWithoutExternal, args);
      await writeJson(path.join(stateDir, "off-report-external-news.json"), externalNews);
      cards = buildCards(stage4, quant, framework, portfolio, marketVoice, externalNews);
    } catch (error) {
      externalNews = {
        ...buildRunMetadata(args),
        schemaVersion: 1,
        provenance: {
          source: "google-news-rss",
          queryWindow: "90d",
          status: "failed",
        },
        holdings: {},
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
      await writeJson(path.join(stateDir, "off-report-external-news.json"), externalNews);
    }
  }
  const payload = {
    ...buildRunMetadata(args, {
      runId: args.runId ?? stage4.runId ?? null,
      runDate: args.runDate ?? stage4.runDate,
      effectiveMarketDate: args.effectiveMarketDate ?? stage4.effectiveMarketDate,
    }),
    frameworkVersion: framework.version,
    summary: summarize(cards, stage4),
    framework: {
      version: framework.version,
      decisionBuckets: framework.decisionBuckets,
      offReportHoldingPolicy: {
        description: framework.offReportHoldingPolicy?.description ?? null,
      },
      sourceReferences: framework.sourceReferences,
    },
    externalNews: externalNews
      ? {
          provenance: externalNews.provenance,
          queryCount: Object.keys(externalNews.holdings ?? {}).length,
          errorCount: externalNews.errors?.length ?? 0,
        }
      : null,
    cards,
  };

  const jsonPath = args.output ?? path.join(stateDir, "holding-decision-cards.json");
  const markdownPath = args.markdown ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-holding-decision-cards.md`);
  await writeJson(jsonPath, payload);
  await writeText(markdownPath, buildMarkdown(payload));

  process.stdout.write(`${jsonPath}\n`);
  process.stdout.write(`${markdownPath}\n`);
}

main().catch((error) => {
  console.error(`holding decision cards 생성 실패: ${error.message}`);
  process.exit(1);
});
