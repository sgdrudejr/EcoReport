#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

const SOURCE_LABELS = {
  reports: "리포트",
  stockeasy: "StockEasy",
  marketvoice: "MarketVoice",
  technical: "기술지표",
  kis_etf: "KIS ETF",
  kisEtf: "KIS ETF",
  news: "뉴스",
  macro: "매크로",
  llm: "LLM",
};

const SOURCE_KEYS = ["reports", "stockeasy", "marketvoice", "technical", "kis_etf", "news"];

const STOCKEASY_SECTOR_ALIASES = {
  "전력기기": ["전력", "전력기기", "송배전", "변압기", "전선", "전력/에너지", "인프라", "AI 인프라"],
  "전력/태양광/ESS": ["전력", "태양광", "ESS", "신재생", "에너지", "배터리", "전력/에너지"],
  "반도체": ["반도체", "HBM", "메모리", "소부장", "AI반도체"],
  "반도체후공정": ["반도체", "후공정", "HBM", "소부장", "이수페타시스", "한미반도체", "리노공업", "테크윙"],
  "반도체전공정": ["반도체", "전공정", "소부장", "HPSP", "원익IPS", "주성엔지니어링", "한솔케미칼"],
  "2차전지": ["2차전지", "배터리", "전기차", "소재", "양극재"],
  "2차전지소부장": ["2차전지", "배터리", "소부장", "소재", "양극재"],
  "방산": ["방산", "우주항공", "UAM", "항공우주", "디펜스"],
  "조선": ["조선", "해운", "조선/해운"],
  "자동차": ["자동차", "전기차", "모빌리티"],
  "자동차소부장": ["자동차", "소부장", "전장", "모빌리티", "전기차"],
  "금융": ["금융", "은행", "증권", "보험", "고배당", "밸류업"],
  "은행": ["은행", "금융", "고배당", "밸류업"],
  "화장품": ["화장품", "뷰티", "소비재", "K-뷰티", "에이피알", "아모레퍼시픽", "코스맥스", "한국콜마"],
  "바이오": ["바이오", "헬스케어", "제약"],
  "바이오(코스닥)": ["바이오", "헬스케어", "제약", "코스닥"],
  "바이오(중소)": ["바이오", "헬스케어", "제약"],
  "엔터": ["엔터", "K-컬처", "콘텐츠", "미디어"],
  "게임": ["게임", "인터넷/콘텐츠", "콘텐츠", "플랫폼"],
  "인터넷": ["인터넷", "플랫폼", "콘텐츠", "IT/플랫폼"],
  "로봇": ["로봇", "AI", "자동화"],
  "SMR(소형모듈원자로)": ["SMR", "원자력", "전력", "에너지"],
  "건설": ["건설", "인프라", "전력", "원자력"],
  "철강/금속": ["철강", "금속", "원자재", "구리", "소재"],
  "석유화학": ["화학", "소재", "원자재"],
  "식품": ["식품", "소비재"],
  "여행레저": ["여행", "레저", "소비재"],
  "코스피": ["코스피", "국내지수", "코스피200", "국내 주식", "시장 대표"],
  "코스닥": ["코스닥", "국내성장주", "성장주", "테크"],
};

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sourceScore(support, source) {
  return round(Number(support?.[source] ?? 0), 3);
}

function sourceSupportView(support = {}) {
  return {
    reports: sourceScore(support, "reports"),
    stockeasy: sourceScore(support, "stockeasy"),
    marketvoice: sourceScore(support, "marketvoice"),
    technical: sourceScore(support, "technical"),
    kisEtf: sourceScore(support, "kis_etf"),
    news: sourceScore(support, "news"),
    macro: sourceScore(support, "macro"),
    llm: sourceScore(support, "llm"),
  };
}

function supportSummary(support = {}) {
  const parts = SOURCE_KEYS.map((source) => ({
    source,
    value: Number(support?.[source] ?? 0),
  }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 4)
    .map((item) => `${SOURCE_LABELS[item.source]} ${round(item.value, 2)}`);

  return parts.length > 0 ? parts.join(" / ") : "근거 약함";
}

function decisionTone(bucket, label) {
  const text = `${bucket ?? ""} ${label ?? ""}`;
  if (/IMMEDIATE|BUY_NOW|바로|매수확정/.test(text)) return "green";
  if (/CONDITIONAL|조건/.test(text)) return "blue";
  if (/BLOCKED|REJECT|제외|차단/.test(text)) return "gray";
  if (/TRIM|EXIT|감량|축소|매도/.test(text)) return "red";
  if (/PROTECT|보호|경계|WATCH|관찰/.test(text)) return "amber";
  return "slate";
}

function decisionPriority(bucket) {
  if (/IMMEDIATE|BUY_NOW/.test(bucket ?? "")) return 100;
  if (/CONDITIONAL/.test(bucket ?? "")) return 80;
  if (/HOLD_PROTECT|TRIM/.test(bucket ?? "")) return 65;
  if (/BLOCKED/.test(bucket ?? "")) return 55;
  if (/WATCH/.test(bucket ?? "")) return 45;
  return 35;
}

function actionGroupForCard(card) {
  const bucket = card?.decisionBucket ?? "";
  if (/IMMEDIATE|BUY_NOW/.test(bucket)) return "immediateBuys";
  if (/CONDITIONAL/.test(bucket)) return "conditionalBuys";
  if (/BLOCKED/.test(bucket)) return "blockedBuys";
  if (/TRIM|EXIT|HOLD_PROTECT/.test(bucket)) return "trimOrProtect";
  if (/WATCH/.test(bucket)) return "watch";
  return "holds";
}

function accountValue(account) {
  return array(account?.holdings).reduce((sum, holding) => sum + (Number(holding?.marketValue) || 0), 0);
}

function buildPortfolioHoldingLookup(portfolio) {
  const lookup = new Map();
  for (const account of array(portfolio?.accounts)) {
    for (const holding of array(account?.holdings)) {
      lookup.set(`${account.key}:${holding.code}`, holding);
    }
  }
  return lookup;
}

function normalizedCount(bundle) {
  return array(bundle?.observations).length;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function toScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (Math.abs(number) <= 1) return clampScore(number * 100);
  return clampScore(number);
}

function technicalRiskPenalty(card) {
  const flags = array(card?.riskFlags);
  const rsi = Number(card?.technical?.rsi);
  let penalty = 0;
  if (flags.some((flag) => String(flag).includes("RSI_OVERHEAT"))) penalty += 12;
  if (flags.some((flag) => String(flag).includes("BOLLINGER_ABOVE_UPPER"))) penalty += 8;
  if (flags.some((flag) => String(flag).includes("DAY_SURGE"))) penalty += 5;
  if (Number.isFinite(rsi) && rsi >= 85) penalty += 6;
  if (Number.isFinite(rsi) && rsi <= 30) penalty += 4;
  return penalty;
}

function evidenceCoverageScore(card, feature, supplement) {
  const support = supplement?.support ?? feature?.support ?? {};
  const supportCount = Object.values(support).filter((value) => Number(value) > 0).length;
  const reportScore =
    card?.reportCoverage?.status === "DIRECT_REPORT"
      ? 25
      : card?.reportCoverage?.available
        ? 17
        : 0;
  const externalScore = card?.externalCoverage?.available ? 15 : 0;
  const newSourceScore = supplement ? 12 : 0;
  return clampScore(20 + supportCount * 8 + reportScore + externalScore + newSourceScore);
}

function fundamentalLookup(fundamentalSnapshot) {
  return new Map(array(fundamentalSnapshot?.securities).map((security) => [security.code, security]));
}

function buildFundamentalView(record) {
  if (!record) {
    return {
      type: "unknown",
      basis: "수집필요",
      score: { overall: 20, label: "수집필요", confidence: 0 },
      dataNeeds: ["FUNDAMENTAL_SNAPSHOT_MISSING"],
    };
  }

  return {
    type: record.type ?? "unknown",
    basis: record.type === "etf" ? "ETF구성/수급" : record.type === "stock" ? "재무지표" : "수집필요",
    score: record.score ?? { overall: 20, label: "수집필요", confidence: 0 },
    metrics: record.metrics
      ? {
          per: record.metrics.per,
          estimatedPer: record.metrics.estimatedPer,
          pbr: record.metrics.pbr,
          roe: record.metrics.roe,
          roeEstimate: record.metrics.roeEstimate,
          eps: record.metrics.eps,
          annualEps: record.metrics.annualEps,
          epsGrowthPct: record.metrics.epsGrowthPct,
          estimatedEpsGrowthPct: record.metrics.estimatedEpsGrowthPct,
          operatingMargin: record.metrics.operatingMargin,
          operatingMarginEstimate: record.metrics.operatingMarginEstimate,
          dividendYield: record.metrics.dividendYield,
        }
      : null,
    market: record.market
      ? {
          price: record.market.price,
          changePct: record.market.changePct,
          volume: record.market.volume,
          marketCap: record.market.marketCap,
          nav: record.market.nav,
          navGapPct: record.market.navGapPct,
          rank: record.market.rank,
        }
      : null,
    etf: record.etf
      ? {
          ranking: record.etf.ranking,
          sectors: array(record.etf.sectors).slice(0, 5),
          keywords: array(record.etf.keywords).slice(0, 8),
          topHoldingWeightPct: record.etf.topHoldingWeightPct ?? null,
          concentrationTop5Pct: record.etf.concentrationTop5Pct ?? null,
          holdings: array(record.etf.holdings).slice(0, 8).map((holding) => ({
            code: holding.code,
            name: holding.name,
            weightPct: holding.weightPct,
            changePct: holding.changePct,
          })),
          flowProxy: record.etf.flowProxy ?? null,
        }
      : null,
    dataNeeds: array(record.dataNeeds).slice(0, 8),
    errors: array(record.errors).slice(0, 3),
    sourceUrls: record.sourceUrls ?? {},
  };
}

function fundamentalProxyScore(card, scoreBreakdown, fundamentalRecord) {
  const fundamentalScore = Number(fundamentalRecord?.score?.overall);
  if (Number.isFinite(fundamentalScore) && Number(fundamentalRecord?.score?.confidence ?? 0) > 0) {
    return clampScore(fundamentalScore);
  }
  const reportScore = Number(scoreBreakdown?.reportScore ?? card?.reportCoverage?.impactScore);
  if (Number.isFinite(reportScore)) return clampScore(reportScore);
  if (card?.externalCoverage?.available) return 45;
  return 20;
}

function buildAttractiveness(card, scoreBreakdown, feature, supplement, fundamentalRecord) {
  const action = toScore(card?.score ?? scoreBreakdown?.actionScore);
  const quant = toScore(scoreBreakdown?.factorScore, Math.round(action * 0.75));
  const technicalRaw = toScore(scoreBreakdown?.techScore ?? card?.technical?.score, Math.round(action * 0.8));
  const techPenalty = technicalRiskPenalty(card);
  const technical = clampScore(technicalRaw - techPenalty);
  const fundamental = fundamentalProxyScore(card, scoreBreakdown, fundamentalRecord);
  const evidence = evidenceCoverageScore(card, feature, supplement);
  const consensus = clampScore(50 + Number(feature?.netScore ?? 0) * 100);
  const riskFlags = array(card?.riskFlags);
  const structuralPenalty =
    (/BLOCKED|REJECT/.test(card?.decisionBucket ?? "") ? 18 : 0) +
    (riskFlags.some((flag) => String(flag).includes("NO_CLEAN_REPORT_LINK")) ? 8 : 0) +
    (riskFlags.some((flag) => String(flag).includes("BLOCKED_BY_STAGE4_VALIDATION")) ? 8 : 0);

  const overall = clampScore(
    quant * 0.24 +
      technical * 0.24 +
      fundamental * 0.22 +
      evidence * 0.18 +
      consensus * 0.12 -
      structuralPenalty,
  );

  let label = "중립관찰";
  if (overall >= 75 && technical >= 55 && structuralPenalty === 0) label = "매력높음";
  else if (overall >= 62) label = technical < 50 || structuralPenalty > 0 ? "조건매력" : "매력있음";
  else if (overall <= 40 || structuralPenalty >= 18) label = "주의필요";
  if (technicalRaw >= 75 && technical < 60) label = "과열주의";

  const gaps = [
    fundamentalRecord ? null : "기본수집부족",
    ...array(fundamentalRecord?.dataNeeds).slice(0, 3),
    card?.externalCoverage?.available ? null : "외부근거부족",
    card?.reportCoverage?.status === "DIRECT_REPORT" ? null : "직접근거부족",
    riskFlags.length > 0 ? "리스크확인" : null,
  ].filter(Boolean);

  const drivers = [
    technicalRaw >= 75 ? `기술 ${technicalRaw}` : null,
    quant >= 60 ? `퀀트 ${quant}` : null,
    fundamental >= 60 ? `기본 ${fundamental}` : null,
    evidence >= 70 ? "다중근거" : null,
    fundamentalRecord?.score?.label ? `기본 ${fundamentalRecord.score.label}` : null,
    supplement?.label ? `새보강 ${supplement.label}` : null,
    techPenalty > 0 ? `과열감점 -${techPenalty}` : null,
    structuralPenalty > 0 ? `구조감점 -${structuralPenalty}` : null,
  ].filter(Boolean);

  return {
    overall,
    label,
    tone:
      label === "매력높음" || label === "매력있음"
        ? "green"
        : label === "조건매력"
          ? "blue"
          : label === "과열주의"
            ? "amber"
            : label === "주의필요"
              ? "red"
              : "slate",
    components: {
      quant,
      technical,
      technicalRaw,
      fundamental,
      evidence,
      consensus,
      riskPenalty: techPenalty + structuralPenalty,
    },
    dataQuality: {
      fundamentalBasis: fundamentalRecord
        ? fundamentalRecord.type === "etf"
          ? "ETF구성"
          : "재무지표"
        : Number.isFinite(Number(scoreBreakdown?.reportScore ?? card?.reportCoverage?.impactScore))
          ? "리포트대체"
          : "부족",
      gaps,
    },
    drivers: drivers.slice(0, 6),
  };
}

function evidenceNotes(card) {
  const reportTitles = array(card?.reportCoverage?.topReports)
    .slice(0, 2)
    .map((report) => compactText(report?.title, 80));
  const externalTitles = array(card?.externalCoverage?.topics)
    .slice(0, 2)
    .map((topic) => compactText(topic?.title, 80));

  return [
    card?.evidence?.reason,
    ...array(card?.holdingRole?.evidenceNotes).slice(0, 4),
    ...reportTitles.map((title) => `리포트: ${title}`),
    ...externalTitles.map((title) => `외부: ${title}`),
  ]
    .map((item) => compactText(item, 150))
    .filter(Boolean)
    .slice(0, 8);
}

function actionItem(card) {
  return {
    id: `${card.accountKey}:${card.code}:${card.decisionBucket}`,
    accountKey: card.accountKey,
    accountLabel: card.accountLabel ?? card.accountKey,
    code: card.code,
    name: card.name,
    category: card.category ?? null,
    label: card.decisionLabel ?? card.sourceActionLabel ?? "확인필요",
    bucket: card.decisionBucket ?? null,
    tone: decisionTone(card.decisionBucket, card.decisionLabel),
    score: Number(card.score ?? 0),
    suggestedAmount: card.suggestedAmount ?? null,
    reason: compactText(card.blockedBuyReason ?? card.thesis ?? card.evidence?.reason, 140),
  };
}

function stage4AccountLookup(stage4) {
  return new Map(array(stage4?.accountPlans).map((account) => [account.key, account]));
}

function accountFeatureLookup(features) {
  return new Map(array(features?.accountFeatures).map((account) => [account.accountKey, account]));
}

function securityFeatureLookup(features) {
  return new Map(array(features?.securityFeatures).map((security) => [security.code, security]));
}

function supplementLookup(supplement) {
  return new Map(array(supplement?.securitySupplements).map((security) => [security.code, security]));
}

function buildHoldingView(card, context) {
  const position = card?.holdingRole?.position ?? context.portfolioHoldingByAccount.get(`${card.accountKey}:${card.code}`) ?? {};
  const scoreBreakdown = card?.holdingRole?.scoreBreakdown ?? {};
  const feature = context.securityFeaturesByCode.get(card.code);
  const supplement = context.supplementsByCode.get(card.code);
  const fundamentalRecord = context.fundamentalsByCode.get(card.code);
  const attractiveness = buildAttractiveness(card, scoreBreakdown, feature, supplement, fundamentalRecord);

  return {
    id: `${card.accountKey}:${card.code}`,
    accountKey: card.accountKey,
    accountLabel: card.accountLabel ?? card.accountKey,
    code: card.code,
    name: card.name,
    category: card.category ?? null,
    decision: {
      bucket: card.decisionBucket ?? null,
      label: card.decisionLabel ?? card.sourceActionLabel ?? "확인필요",
      tone: decisionTone(card.decisionBucket, card.decisionLabel),
      priority: decisionPriority(card.decisionBucket),
    },
    position: {
      marketValue: round(position?.marketValue, 0),
      weight: round(position?.weight ?? 0, 4),
      quantity: position?.quantity ?? null,
      profitLoss: round(position?.profitLoss, 0),
      profitRate: round(position?.profitRatePct ?? position?.profitRate, 2),
    },
    scores: {
      action: round(card.score ?? scoreBreakdown.actionScore, 0),
      consensus: round(feature?.netScore ?? 0, 3),
      technical: round(scoreBreakdown.techScore ?? card.technical?.score ?? 0, 0),
      report: round(scoreBreakdown.reportScore ?? card.reportCoverage?.impactScore ?? 0, 0),
      factor: round(scoreBreakdown.factorScore ?? 0, 0),
    },
    attractiveness,
    fundamental: buildFundamentalView(fundamentalRecord),
    sourceSupport: sourceSupportView(supplement?.support ?? feature?.support),
    badges: {
      reportCoverage: card.reportCoverage?.statusLabel ?? "근거없음",
      externalCoverage: card.externalCoverage?.statusLabel ?? "리포트밖",
      technicalBias: card.technical?.rsi ? `RSI ${round(card.technical.rsi, 1)}` : null,
      newEvidenceLabel: supplement?.label ?? null,
    },
    thesis: compactText(card.thesis ?? card.evidence?.reason, 220),
    addConditions: array(card.addConditions).map((item) => compactText(item, 120)).slice(0, 4),
    trimConditions: array(card.trimConditions).map((item) => compactText(item, 120)).slice(0, 3),
    invalidationConditions: array(card.invalidationConditions).map((item) => compactText(item, 120)).slice(0, 4),
    riskFlags: array(card.riskFlags).slice(0, 6),
    nextReview: card.nextReview ?? null,
    evidenceRefs: [
      `holding:${card.accountKey}:${card.code}`,
      supplement ? `supplement:security:${card.code}` : null,
      feature ? `feature:security:${card.code}` : null,
    ].filter(Boolean),
  };
}

function buildEvidenceItem(item, kind) {
  const id = kind === "theme" ? `theme:${item.theme}` : `security:${item.code}`;
  return {
    id,
    kind,
    code: item.code ?? null,
    name: item.name ?? item.theme,
    theme: item.theme ?? null,
    label: item.label ?? "확인필요",
    netScore: round(item.netScore, 3),
    sourceCount: item.sourceCount ?? 0,
    newSourceSupport: round(item.newSourceSupport, 3),
    existingSourceSupport: round(item.existingSourceSupport, 3),
    support: sourceSupportView(item.support),
    supportSummary: item.supportSummary ?? supportSummary(item.support),
    actionHint: compactText(item.actionHint, 180),
    stage4Refs: array(item.stage4).slice(0, 3),
    holdingRefs: array(item.holdingCards).slice(0, 3),
    displayGroup:
      Number(item.existingSourceSupport ?? 0) > 0
        ? "기존보강"
        : item.label === "감속점검" || item.label === "단독경계"
          ? "충돌점검"
          : "신규관찰",
  };
}

function buildConflictItem(item) {
  return {
    id: `${item.entityType}:${item.entityId}`,
    entityType: item.entityType ?? null,
    entityId: item.entityId ?? null,
    directions: array(item.directions),
    sources: array(item.sources),
    sourceSummary: item.sourceSummary ?? array(item.sources).map((source) => SOURCE_LABELS[source] ?? source).join(" / "),
    severity: array(item.directions).includes("negative") ? "높음" : "보통",
  };
}

function holdingViewRank(holding) {
  const bucket = holding?.decision?.bucket ?? "";
  const blockedPenalty = /BLOCKED|REJECT/.test(bucket) ? 25 : 0;
  return (
    Number(holding?.decision?.priority ?? 0) * 100 +
    Number(holding?.scores?.action ?? 0) -
    blockedPenalty
  );
}

function dedupeHoldingViews(holdingViews) {
  const byId = new Map();
  for (const holding of holdingViews) {
    const existing = byId.get(holding.id);
    if (!existing || holdingViewRank(holding) > holdingViewRank(existing)) {
      byId.set(holding.id, holding);
    }
  }
  return [...byId.values()];
}

function buildEvidenceIndex(holdingViews, supplement) {
  const index = {};

  for (const holding of holdingViews) {
    index[`holding:${holding.accountKey}:${holding.code}`] = {
      title: `${holding.name} / ${holding.accountLabel}`,
      summary: holding.thesis,
      notes: [
        `판정 ${holding.decision.label}, 점수 ${holding.scores.action}`,
        `근거 ${holding.badges.reportCoverage} / ${holding.badges.externalCoverage}`,
        ...holding.addConditions.slice(0, 2).map((item) => `추가조건: ${item}`),
        ...holding.riskFlags.slice(0, 2).map((item) => `위험: ${item}`),
      ],
    };
  }

  for (const item of array(supplement?.securitySupplements)) {
    index[`supplement:security:${item.code}`] = {
      title: `${item.name} 새 보강`,
      summary: item.actionHint,
      notes: [
        `${item.label} / ${item.supportSummary}`,
        `신규소스 ${round(item.newSourceSupport, 2)}, 기존근거 ${round(item.existingSourceSupport, 2)}`,
      ],
    };
  }

  for (const item of array(supplement?.themeSupplements)) {
    index[`supplement:theme:${item.theme}`] = {
      title: `${item.theme} 테마 보강`,
      summary: item.actionHint,
      notes: [
        `${item.label} / ${item.supportSummary}`,
        `소스 ${item.sourceCount}개`,
      ],
    };
  }

  return index;
}

function marketChangePct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) <= 1 ? round(number * 100, 2) : round(number, 2);
}

function buildMarketLayer(market, stage4, holdingCards) {
  const indices = Object.values(market?.indices ?? {}).map((item) => ({
    key: item.symbol ?? item.name,
    name: item.name ?? item.symbol,
    close: round(item.close, 2),
    changePct: marketChangePct(item.change_pct),
    source: item.source ?? null,
    tradedAt: item.traded_at ?? null,
  }));
  const macro = Object.values(market?.macro ?? {}).map((item) => ({
    key: item.symbol ?? item.name,
    name: item.name ?? item.symbol,
    close: round(item.close, 2),
    changePct: marketChangePct(item.change_pct),
    source: item.source ?? null,
    tradedAt: item.traded_at ?? null,
  }));
  return {
    date: market?.date ?? null,
    collectedAt: market?.collected_at ?? null,
    regime: holdingCards.summary?.regime ?? stage4.regime?.name ?? null,
    portfolioScore: round(holdingCards.summary?.portfolioScore ?? stage4.portfolioScore ?? 0, 0),
    indices,
    macro,
  };
}

function buildThemeLayer(supplement) {
  return array(supplement?.themeSupplements)
    .slice(0, 14)
    .map((item) => ({
      id: `theme:${item.theme}`,
      theme: item.theme,
      label: item.label ?? "확인필요",
      netScore: round(item.netScore, 3),
      sourceCount: item.sourceCount ?? 0,
      supportSummary: item.supportSummary ?? supportSummary(item.support),
      support: sourceSupportView(item.support),
      actionHint: compactText(item.actionHint, 150),
    }));
}

function buildSectorLayer(holdingViews, fundamentalSnapshot) {
  const sectors = new Map();
  function ensure(category) {
    const key = category || "미분류";
    if (!sectors.has(key)) {
      sectors.set(key, {
        id: `sector:${key}`,
        category: key,
        holdingCount: 0,
        stockCount: 0,
        etfCount: 0,
        marketValue: 0,
        attractivenessSum: 0,
        attractivenessCount: 0,
        topSecurities: [],
      });
    }
    return sectors.get(key);
  }

  for (const holding of holdingViews) {
    const sector = ensure(holding.category);
    sector.holdingCount += 1;
    sector.marketValue += Number(holding.position?.marketValue ?? 0);
    sector.attractivenessSum += Number(holding.attractiveness?.overall ?? 0);
    sector.attractivenessCount += 1;
    sector.topSecurities.push({
      code: holding.code,
      name: holding.name,
      score: holding.attractiveness?.overall ?? 0,
      held: true,
    });
  }

  for (const security of array(fundamentalSnapshot?.securities)) {
    const sector = ensure(security.category);
    if (security.type === "stock") sector.stockCount += 1;
    if (security.type === "etf") sector.etfCount += 1;
    if (!sector.topSecurities.some((item) => item.code === security.code)) {
      sector.topSecurities.push({
        code: security.code,
        name: security.name,
        score: security.score?.overall ?? 0,
        held: false,
      });
    }
  }

  return [...sectors.values()]
    .map((sector) => ({
      ...sector,
      marketValue: round(sector.marketValue, 0),
      averageAttractiveness: round(
        sector.attractivenessSum / Math.max(sector.attractivenessCount, 1),
        0,
      ),
      topSecurities: sector.topSecurities
        .sort((left, right) => Number(right.held) - Number(left.held) || right.score - left.score)
        .slice(0, 5),
    }))
    .sort(
      (left, right) =>
        right.marketValue - left.marketValue ||
        right.averageAttractiveness - left.averageAttractiveness ||
        left.category.localeCompare(right.category),
    )
    .slice(0, 14);
}

function buildSecurityLayer(fundamentalSnapshot, holdingViews, type) {
  const heldByCode = new Map();
  for (const holding of holdingViews) {
    if (!heldByCode.has(holding.code)) {
      heldByCode.set(holding.code, {
        accounts: new Set(),
        attractiveness: holding.attractiveness?.overall ?? null,
        decisionLabel: holding.decision?.label ?? null,
      });
    }
    heldByCode.get(holding.code).accounts.add(holding.accountLabel ?? holding.accountKey);
  }

  return array(fundamentalSnapshot?.securities)
    .filter((security) => security.type === type)
    .map((security) => {
      const held = heldByCode.get(security.code);
      return {
        code: security.code,
        name: security.name,
        category: security.category ?? null,
        held: Boolean(held),
        accounts: held ? [...held.accounts] : [],
        decisionLabel: held?.decisionLabel ?? null,
        attractiveness: held?.attractiveness ?? null,
        score: security.score ?? null,
        market: security.market ?? null,
        metrics: security.metrics ?? null,
        etf: security.etf
          ? {
              ranking: security.etf.ranking,
              sectors: array(security.etf.sectors).slice(0, 5),
              keywords: array(security.etf.keywords).slice(0, 6),
              holdings: array(security.etf.holdings).slice(0, 6),
              topHoldingWeightPct: security.etf.topHoldingWeightPct ?? null,
              concentrationTop5Pct: security.etf.concentrationTop5Pct ?? null,
            }
          : null,
        dataNeeds: array(security.dataNeeds).slice(0, 6),
      };
    })
    .sort((left, right) => {
      const leftHeld = left.held ? 1 : 0;
      const rightHeld = right.held ? 1 : 0;
      const leftRank = Number(left.market?.rank ?? 999);
      const rightRank = Number(right.market?.rank ?? 999);
      return rightHeld - leftHeld || leftRank - rightRank || (right.score?.overall ?? 0) - (left.score?.overall ?? 0);
    })
    .slice(0, type === "etf" ? 18 : 16);
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}·,./_+&-]/g, "");
}

function uniqueCompactStrings(items, limit = 20) {
  const seen = new Set();
  const values = [];
  for (const item of items) {
    const text = compactText(item, 48);
    if (!text) continue;
    const key = normalizeMatchText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(text);
    if (values.length >= limit) break;
  }
  return values;
}

function parseLeaderLabel(label) {
  const text = String(label ?? "");
  if (!text || text.trim() === "-") return [];
  const leaders = [];
  const pattern = /([^()]+?)\(([-+]?\d+(?:\.\d+)?)\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const name = compactText(match[1], 42);
    const score = numberOrNull(match[2]);
    if (!name) continue;
    leaders.push({ name, score });
  }
  return leaders
    .filter((leader, index, list) => list.findIndex((item) => item.name === leader.name) === index)
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, 8);
}

function rowHoldDays(row) {
  const direct = numberOrNull(row?.holdDays);
  if (direct !== null) return direct;
  const match = String(row?.position ?? "").match(/(\d+)\s*일/);
  return match ? numberOrNull(match[1]) : null;
}

function addSectorRow(target, row) {
  const sector = compactText(row?.sector, 60);
  if (!sector) return;
  const existing =
    target.get(sector) ??
    {
      sector,
      rows: 0,
      changeSum: 0,
      changeCount: 0,
      signal: null,
      gapPct: null,
      holdDays: null,
      position: null,
      leadersByName: new Map(),
    };
  const changePct = numberOrNull(row.changePct);
  const signal = numberOrNull(row.signal);
  const gapPct = numberOrNull(row.gapPct);
  const holdDays = rowHoldDays(row);
  existing.rows += 1;
  if (changePct !== null) {
    existing.changeSum += changePct;
    existing.changeCount += 1;
  }
  if (signal !== null && (existing.signal === null || signal > existing.signal)) existing.signal = signal;
  if (gapPct !== null && (existing.gapPct === null || gapPct > existing.gapPct)) existing.gapPct = gapPct;
  if (holdDays !== null && (existing.holdDays === null || holdDays > existing.holdDays)) existing.holdDays = holdDays;
  if (!existing.position && row.position) existing.position = row.position;
  for (const leader of parseLeaderLabel(row.leaderLabel)) {
    const current = existing.leadersByName.get(leader.name);
    if (!current || Number(leader.score ?? 0) > Number(current.score ?? 0)) existing.leadersByName.set(leader.name, leader);
  }
  target.set(sector, existing);
}

function aggregateStockeasySnapshot(stockeasySnapshot) {
  const sectorRows = [
    ...array(stockeasySnapshot?.marketAnalysis?.sectors?.rows).map((row) => ({ ...row, sourcePanel: "sector" })),
    ...array(stockeasySnapshot?.marketAnalysis?.leadingSectors?.rows).map((row) => ({ ...row, sourcePanel: "leading" })),
  ];
  const rsRows = array(stockeasySnapshot?.stockAnalysis?.sectorRs);
  const sectorsByName = new Map();

  for (const row of sectorRows) addSectorRow(sectorsByName, row);

  for (const row of rsRows) {
    const sector = compactText(row.sector, 60);
    if (!sector || sectorsByName.has(sector)) continue;
    sectorsByName.set(sector, {
      sector,
      rows: 0,
      changeSum: 0,
      changeCount: 0,
      signal: null,
      gapPct: null,
      holdDays: null,
      position: null,
      leadersByName: new Map(),
      rsOnly: true,
    });
  }

  return { sectorRows, rsRows, sectorsByName };
}

function sectorAliasTerms(sector, leaders = []) {
  const direct = String(sector ?? "");
  const terms = [direct, ...direct.split(/[\/()\s]+/g)];
  for (const [key, aliases] of Object.entries(STOCKEASY_SECTOR_ALIASES)) {
    const sectorKey = normalizeMatchText(direct);
    const aliasKey = normalizeMatchText(key);
    if (sectorKey.includes(aliasKey) || aliasKey.includes(sectorKey)) {
      terms.push(...aliases);
    }
  }
  return uniqueCompactStrings(terms, 18).filter((term) => normalizeMatchText(term).length >= 2);
}

function findSectorRs(sector, rsRows, aliases) {
  const sectorKey = normalizeMatchText(sector);
  const aliasKeys = new Set(aliases.map(normalizeMatchText));
  let best = null;
  for (const row of rsRows) {
    const rowKey = normalizeMatchText(row?.sector);
    if (!rowKey) continue;
    const exact = rowKey === sectorKey;
    const partial = rowKey.includes(sectorKey) || sectorKey.includes(rowKey);
    const alias = [...aliasKeys].some((key) => key && (rowKey.includes(key) || key.includes(rowKey)));
    if (!exact && !partial && !alias) continue;
    const score = numberOrNull(row?.score) ?? 0;
    const bonus = exact ? 20 : partial ? 10 : 0;
    const candidate = { ...row, matchScore: score + bonus };
    if (!best || candidate.matchScore > best.matchScore) best = candidate;
  }
  return best;
}

function stockeasyChangeScore(changePct) {
  const value = Number(changePct);
  if (!Number.isFinite(value)) return 45;
  if (value >= 5) return 90;
  if (value >= 2) return 78;
  if (value >= 0) return 66;
  if (value >= -2) return 56;
  if (value >= -4) return 48;
  return 35;
}

function stockeasySectorComposite({ signal, changePct, gapPct, holdDays, rsScore, leaderScore, sourceRows }) {
  const rs = Number.isFinite(rsScore) ? rsScore : 55;
  const signalScore = signal === null ? 45 : clampScore((Number(signal) / 35) * 100);
  const holdScore = holdDays === null ? 45 : clampScore(Number(holdDays) * 4);
  const gapScore = gapPct === null ? 45 : clampScore(Number(gapPct) * 2);
  const leader = Number.isFinite(leaderScore) ? leaderScore : 45;
  const breadth = clampScore(Number(sourceRows ?? 0) * 18);
  return clampScore(
    rs * 0.3 +
      signalScore * 0.22 +
      leader * 0.17 +
      holdScore * 0.1 +
      gapScore * 0.08 +
      stockeasyChangeScore(changePct) * 0.08 +
      breadth * 0.05,
  );
}

function stockeasyPulseLabel({ signal, changePct, position, score }) {
  const text = String(position ?? "");
  if (signal === null && !text) return score >= 75 ? "RS강세" : "RS관찰";
  if (text.includes("이탈") || Number(signal ?? 0) <= 0) return "추세이탈";
  if (Number(changePct ?? 0) <= -3 && Number(signal ?? 0) > 0) return "눌림유지";
  if (Number(changePct ?? 0) >= 3 && score >= 72) return "강세유지";
  if (score >= 75) return "추세유지";
  if (score >= 60) return "중립관찰";
  return "약세관찰";
}

function stockeasyTrendLabel(trend) {
  if (!trend || trend.points < 2) return "기록부족";
  if (trend.direction === "up") return "상승중";
  if (trend.direction === "down") return "하락중";
  if (trend.direction === "recovering") return "회복중";
  if (trend.direction === "weakening") return "약화중";
  return "횡보";
}

function stockeasyTrendTone(trend) {
  if (!trend || trend.points < 2) return "slate";
  if (trend.direction === "up" || trend.direction === "recovering") return "green";
  if (trend.direction === "down" || trend.direction === "weakening") return "red";
  return "amber";
}

function stockeasyPulseAction({ label, changePct, score, matchedEtfCount = 0, leaderScore = 0 }) {
  if (label === "추세이탈") return "매수보류";
  if (matchedEtfCount === 0 && (score >= 50 || Number(leaderScore) >= 90)) return "ETF공백";
  if (label === "눌림유지") return "눌림관찰";
  if (Number(changePct ?? 0) >= 6) return "눌림대기";
  if (score >= 78) return "ETF탐색";
  if (score >= 65) return "후보검토";
  return "관찰";
}

function stockeasyTone(label, action) {
  if (label === "추세이탈" || action === "매수보류") return "red";
  if (action === "ETF탐색") return "green";
  if (action === "후보검토") return "blue";
  if (action === "눌림관찰" || action === "눌림대기" || action === "ETF공백") return "amber";
  return "slate";
}

function stockeasyImplication(item) {
  if (item.label === "추세이탈") return "ETF 신규매수는 막고 반등 확인 전까지 후보만 기록";
  if (item.action === "ETF공백") return "전용 ETF가 약하면 대표 종목형 또는 데이터 수집 보강 필요";
  if (item.label === "눌림유지") return "추세는 남아 있으나 당일 약세라 1차 매수보다 가격 안정 확인";
  if (item.action === "눌림대기") return "강한 섹터지만 ETF가 급등했으면 당일 추격보다 눌림 조건 우선";
  if (item.action === "ETF탐색") return "전용 ETF와 구성 상위 종목을 비교해 다음 매수 후보로 승격";
  return "섹터 신호와 ETF 수급이 동시에 개선될 때만 후보 유지";
}

function stockeasyBuyQuestion(item) {
  if (item.trend?.direction === "down") return "하락 추세가 멈출 때까지 신규매수 보류";
  if (item.trend?.direction === "up" && item.action === "ETF탐색") return "상승 추세 유지 중 ETF 거래대금과 NAV 괴리 확인";
  if (item.action === "ETF공백") return "국내 상장 전용 ETF가 있는지 보강 수집";
  if (item.label === "눌림유지") return "2거래일 안에 거래대금 유지와 추가 하락 둔화 확인";
  if (item.action === "눌림대기") return "급등 ETF는 NAV 괴리와 거래대금 유지 후 분할 검토";
  if (item.label === "추세이탈") return "재진입은 StockEasy 추세 회복 후 재검토";
  return "ETF 구성 상위종목이 StockEasy 리더와 겹치는지 확인";
}

function metricView(metrics) {
  if (!metrics) return null;
  return {
    per: metrics.estimatedPer ?? metrics.per ?? null,
    pbr: metrics.pbr ?? null,
    roe: metrics.roeEstimate ?? metrics.roe ?? null,
    epsGrowthPct: metrics.estimatedEpsGrowthPct ?? metrics.epsGrowthPct ?? null,
    operatingMargin: metrics.operatingMarginEstimate ?? metrics.operatingMargin ?? null,
  };
}

function stockeasySectorPoint(stockeasySnapshot, date, sectorName) {
  if (!stockeasySnapshot) return null;
  const { rsRows, sectorsByName } = aggregateStockeasySnapshot(stockeasySnapshot);
  const sectorKey = normalizeMatchText(sectorName);
  let item = sectorsByName.get(sectorName);
  if (!item) {
    item = [...sectorsByName.values()].find((candidate) => normalizeMatchText(candidate.sector) === sectorKey);
  }
  if (!item) return null;

  const leaders = [...item.leadersByName.values()]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, 8);
  const aliases = sectorAliasTerms(item.sector, leaders);
  const rs = findSectorRs(item.sector, rsRows, aliases);
  const changePct = item.changeCount > 0 ? round(item.changeSum / item.changeCount, 2) : null;
  const rsScore = numberOrNull(rs?.score);
  const leaderScore = leaders.length > 0 ? Math.max(...leaders.map((leader) => Number(leader.score ?? 0))) : null;
  const score = stockeasySectorComposite({
    signal: item.signal,
    changePct,
    gapPct: item.gapPct,
    holdDays: item.holdDays,
    rsScore,
    leaderScore,
    sourceRows: item.rows,
  });

  return {
    date,
    score,
    signal: item.signal === null ? null : round(item.signal, 1),
    changePct,
    rsScore,
    rank: rs?.rank ?? null,
    holdDays: item.holdDays,
  };
}

function trendDelta(current, previous, key) {
  const left = numberOrNull(current?.[key]);
  const right = numberOrNull(previous?.[key]);
  if (left === null || right === null) return null;
  return round(left - right, 2);
}

function buildStockeasySectorTrend(sectorName, currentPoint, stockeasyHistory) {
  const history = array(stockeasyHistory)
    .map((entry) => stockeasySectorPoint(entry.snapshot, entry.date, sectorName))
    .filter(Boolean)
    .filter((point, index, list) => list.findIndex((item) => item.date === point.date) === index)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));

  const currentKey = currentPoint?.date ?? history.at(-1)?.date ?? null;
  const current =
    history.find((point) => point.date === currentKey) ??
    (currentPoint ? { ...currentPoint, date: currentKey } : null) ??
    history.at(-1) ??
    null;
  const previous = [...history].reverse().find((point) => point.date !== current?.date) ?? null;
  const first = history[0] ?? previous;
  const recent = history.slice(-4);
  const scoreDelta = trendDelta(current, previous, "score");
  const signalDelta = trendDelta(current, previous, "signal");
  const changeDelta = trendDelta(current, previous, "changePct");
  const rsDelta = trendDelta(current, previous, "rsScore");
  const rankDelta =
    numberOrNull(current?.rank) !== null && numberOrNull(previous?.rank) !== null
      ? round(Number(previous.rank) - Number(current.rank), 0)
      : null;
  const spanScoreDelta = trendDelta(current, first, "score");
  const recentUpDays = recent.filter((point, index) => index > 0 && Number(point.score ?? 0) > Number(recent[index - 1].score ?? 0)).length;
  const recentDownDays = recent.filter((point, index) => index > 0 && Number(point.score ?? 0) < Number(recent[index - 1].score ?? 0)).length;

  let direction = "flat";
  const momentum =
    Number(scoreDelta ?? 0) * 0.7 +
    Number(signalDelta ?? 0) * 0.18 +
    Number(rsDelta ?? 0) * 0.08 +
    Number(rankDelta ?? 0) * 0.16 +
    Number(changeDelta ?? 0) * 0.12;
  if (scoreDelta !== null && scoreDelta >= 6) direction = "up";
  else if (scoreDelta !== null && scoreDelta <= -6) direction = "down";
  else if (momentum >= 3.5 || recentUpDays >= 2) direction = "recovering";
  else if (momentum <= -3.5 || recentDownDays >= 2) direction = "weakening";

  const trend = {
    direction,
    label: null,
    tone: null,
    points: history.length,
    previousDate: previous?.date ?? null,
    scoreDelta,
    signalDelta,
    changeDelta,
    rsDelta,
    rankDelta,
    spanScoreDelta,
    recent: history.slice(-6).map((point) => ({
      date: point.date,
      score: point.score,
      signal: point.signal,
      changePct: point.changePct,
      rsScore: point.rsScore,
      rank: point.rank,
    })),
  };
  trend.label = stockeasyTrendLabel(trend);
  trend.tone = stockeasyTrendTone(trend);
  return trend;
}

function isGenericEtf(etf) {
  const sectors = array(etf.etf?.sectors).join(" ");
  const hasThemeSector = /반도체|2차전지|전력|AI|인프라|원자재|인터넷|콘텐츠|성장주|신재생/i.test(sectors);
  if (hasThemeSector) return false;
  const text = normalizeMatchText([etf.name, etf.category, ...array(etf.etf?.keywords)].join(" "));
  return /코스피|코스닥|국내인덱스|국내지수|레버리지|커버드콜|배당|밸류업|esg|코리아|시장대표|테마분산|200/.test(text);
}

function stockMatchView(stock, sectorItem, heldCodes, leader = null) {
  const aliases = sectorAliasTerms(sectorItem.sector, sectorItem.leaders);
  const haystack = normalizeMatchText([stock.name, stock.category].join(" "));
  const reasons = [];
  let matchScore = 0;

  if (leader) {
    matchScore += 46 + Number(leader.score ?? 0) * 0.32;
    reasons.push("StockEasy리더");
  }

  for (const term of aliases) {
    const key = normalizeMatchText(term);
    if (!key) continue;
    if (haystack.includes(key) || key.includes(haystack)) {
      matchScore += key === normalizeMatchText(sectorItem.sector) ? 28 : 16;
      reasons.push(term);
    }
  }

  if (matchScore < 20) return null;

  const fundamentalScore = Number(stock.score?.overall ?? 0);
  const dataPenalty = array(stock.dataNeeds).length > 0 ? 6 : 0;
  return {
    code: stock.code,
    name: stock.name,
    category: stock.category ?? null,
    held: heldCodes.has(stock.code),
    stockeasyScore: leader?.score ?? null,
    score: fundamentalScore || null,
    label: stock.score?.label ?? null,
    matchScore: clampScore(matchScore + fundamentalScore * 0.18 - dataPenalty),
    changePct: numberOrNull(stock.market?.changePct),
    volume: stock.market?.volume ?? null,
    metrics: metricView(stock.metrics),
    dataNeeds: array(stock.dataNeeds).slice(0, 4),
    reasons: uniqueCompactStrings(reasons, 5),
  };
}

function stockeasyStockDetails(sectorItem, stocks, heldCodes) {
  const byName = new Map(stocks.map((stock) => [normalizeMatchText(stock.name), stock]));
  const byCode = new Map();

  for (const leader of array(sectorItem.leaders)) {
    const stock = byName.get(normalizeMatchText(leader.name));
    if (stock) {
      const enriched = stockMatchView(stock, sectorItem, heldCodes, leader);
      if (enriched) byCode.set(enriched.code, enriched);
    } else {
      byCode.set(`leader:${leader.name}`, {
        code: null,
        name: leader.name,
        category: sectorItem.sector,
        held: false,
        stockeasyScore: leader.score ?? null,
        score: null,
        label: "수집필요",
        matchScore: clampScore(Number(leader.score ?? 0)),
        changePct: null,
        volume: null,
        metrics: null,
        dataNeeds: ["FUNDAMENTAL_DETAIL_MISSING"],
        reasons: ["StockEasy리더"],
      });
    }
  }

  for (const stock of stocks) {
    if (byCode.has(stock.code)) continue;
    const matched = stockMatchView(stock, sectorItem, heldCodes);
    if (matched) byCode.set(stock.code, matched);
  }

  return [...byCode.values()]
    .sort(
      (left, right) =>
        Number(right.stockeasyScore ?? 0) - Number(left.stockeasyScore ?? 0) ||
        Number(right.held) - Number(left.held) ||
        Number(right.matchScore ?? 0) - Number(left.matchScore ?? 0) ||
        Number(right.score ?? 0) - Number(left.score ?? 0),
    )
    .slice(0, 8);
}

function etfMatchView(etf, sectorItem, heldCodes) {
  const aliases = sectorAliasTerms(sectorItem.sector, sectorItem.leaders);
  const leaderKeys = new Set(array(sectorItem.leaders).map((leader) => normalizeMatchText(leader.name)));
  const sectorHaystack = normalizeMatchText([
    etf.name,
    etf.category,
    ...array(etf.etf?.sectors),
    ...array(etf.etf?.keywords),
  ].join(" "));
  const holdingHaystack = normalizeMatchText(array(etf.etf?.holdings).map((holding) => `${holding.code ?? ""} ${holding.name ?? ""}`).join(" "));
  const reasons = [];
  let directScore = 0;
  let sectorTermHits = 0;
  let leaderHits = 0;

  for (const term of aliases) {
    const key = normalizeMatchText(term);
    if (!key) continue;
    if (sectorHaystack.includes(key)) {
      directScore += key === normalizeMatchText(sectorItem.sector) ? 34 : 18;
      if (!leaderKeys.has(key)) sectorTermHits += 1;
      reasons.push(term);
    } else if (holdingHaystack.includes(key)) {
      directScore += 24;
      sectorTermHits += 1;
      reasons.push(term);
    }
  }

  for (const leader of sectorItem.leaders ?? []) {
    const key = normalizeMatchText(leader.name);
    if (!key) continue;
    if (holdingHaystack.includes(key)) {
      directScore += Number(leader.score ?? 0) >= 90 ? 28 : 20;
      leaderHits += 1;
      reasons.push(leader.name);
    }
  }

  if (directScore < 20) return null;
  if (sectorTermHits === 0 && leaderHits < 2) return null;
  if (sectorTermHits === 0 && isGenericEtf(etf)) return null;

  const etfScore = Number(etf.score?.overall ?? 0);
  const flowScore = Number(etf.score?.flow ?? etfScore);
  const dataPenalty = array(etf.dataNeeds).length > 0 ? 5 : 0;
  const matchScore = clampScore(directScore + etfScore * 0.18 + flowScore * 0.08 - dataPenalty);

  return {
    code: etf.code,
    name: etf.name,
    category: etf.category ?? null,
    held: heldCodes.has(etf.code),
    score: etfScore || null,
    flowScore: Number.isFinite(flowScore) ? flowScore : null,
    matchScore,
    changePct: numberOrNull(etf.market?.changePct),
    rank: etf.market?.rank ?? null,
    navGapPct: numberOrNull(etf.market?.navGapPct),
    volume: etf.market?.volume ?? null,
    dataNeeds: array(etf.dataNeeds).slice(0, 4),
    reasons: uniqueCompactStrings(reasons, 5),
    topHoldings: array(etf.etf?.holdings)
      .slice(0, 5)
      .map((holding) => ({
        code: holding.code,
        name: holding.name,
        weightPct: holding.weightPct ?? null,
        changePct: holding.changePct ?? null,
      })),
  };
}

function buildStockeasyPulse(stockeasySnapshot, fundamentalSnapshot, holdingViews, stockeasyHistory = []) {
  if (!stockeasySnapshot || Object.keys(stockeasySnapshot).length === 0) return null;
  const { sectorRows, rsRows, sectorsByName } = aggregateStockeasySnapshot(stockeasySnapshot);

  const heldCodes = new Set(holdingViews.map((holding) => holding.code).filter(Boolean));
  const etfs = array(fundamentalSnapshot?.securities).filter((security) => security.type === "etf");
  const stocks = array(fundamentalSnapshot?.securities).filter((security) => security.type === "stock");
  const sectors = [...sectorsByName.values()].map((item) => {
    const leaders = [...item.leadersByName.values()]
      .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
      .slice(0, 8);
    const aliases = sectorAliasTerms(item.sector, leaders);
    const rs = findSectorRs(item.sector, rsRows, aliases);
    const changePct = item.changeCount > 0 ? round(item.changeSum / item.changeCount, 2) : null;
    const rsScore = numberOrNull(rs?.score);
    const leaderScore = leaders.length > 0 ? Math.max(...leaders.map((leader) => Number(leader.score ?? 0))) : null;
    const score = stockeasySectorComposite({
      signal: item.signal,
      changePct,
      gapPct: item.gapPct,
      holdDays: item.holdDays,
      rsScore,
      leaderScore,
      sourceRows: item.rows,
    });
    const label = stockeasyPulseLabel({
      signal: item.signal,
      changePct,
      position: item.position,
      score,
    });
    const trend = buildStockeasySectorTrend(
      item.sector,
      {
        date: stockeasySnapshot.captureDate ?? stockeasySnapshot.sourceTradingDate ?? null,
        score,
        signal: item.signal === null ? null : round(item.signal, 1),
        changePct,
        rsScore,
        rank: rs?.rank ?? null,
      },
      stockeasyHistory,
    );
    return {
      id: `stockeasy-sector:${item.sector}`,
      sector: item.sector,
      score,
      rank: rs?.rank ?? null,
      rsScore,
      leaderScore,
      rsSector: rs?.sector ?? null,
      signal: item.signal === null ? null : round(item.signal, 1),
      changePct,
      gapPct: item.gapPct === null ? null : round(item.gapPct, 2),
      holdDays: item.holdDays,
      position: item.position,
      label,
      trend,
      action: stockeasyPulseAction({ label, changePct, score, leaderScore }),
      tone: stockeasyTone(label),
      leaders,
      aliases: aliases.slice(0, 8),
      sourceRows: item.rows,
      rsOnly: Boolean(item.rsOnly),
    };
  });

  for (const sector of sectors) {
    const matches = etfs
      .map((etf) => etfMatchView(etf, sector, heldCodes))
      .filter(Boolean)
      .sort(
        (left, right) =>
          Number(left.held) - Number(right.held) ||
          right.matchScore - left.matchScore ||
          Number(right.score ?? 0) - Number(left.score ?? 0),
      )
      .slice(0, 5);
    sector.matchedEtfs = matches;
    sector.matchedStocks = stockeasyStockDetails(sector, stocks, heldCodes);
    sector.action = stockeasyPulseAction({
      label: sector.label,
      changePct: sector.changePct,
      score: sector.score,
      matchedEtfCount: matches.length,
      leaderScore: sector.leaderScore,
    });
    sector.tone = stockeasyTone(sector.label, sector.action);
    sector.implication = stockeasyImplication(sector);
    sector.buyQuestion = stockeasyBuyQuestion(sector);
  }

  const sortedSectors = sectors.sort(
    (left, right) =>
      right.score - left.score ||
      Number(left.rank ?? 999) - Number(right.rank ?? 999) ||
      String(left.sector).localeCompare(String(right.sector)),
  );
  const radar = sortedSectors
    .filter((sector) => sector.matchedEtfs.length > 0 || sector.score >= 50 || Number(sector.leaderScore ?? 0) >= 90)
    .slice(0, 24)
    .map((sector) => ({
      id: `stockeasy-etf-radar:${sector.sector}`,
      sector: sector.sector,
      score: sector.score,
      rank: sector.rank,
      rsScore: sector.rsScore,
      signal: sector.signal,
      changePct: sector.changePct,
      label: sector.label,
      trend: sector.trend,
      action: sector.action,
      tone: sector.tone,
      leaders: sector.leaders.slice(0, 5),
      matchedStocks: sector.matchedStocks,
      matchedEtfs: sector.matchedEtfs,
      implication: sector.implication,
      buyQuestion: sector.buyQuestion,
    }));

  return {
    source: "StockEasy",
    capturedAt: stockeasySnapshot.capturedAt ?? null,
    sourceTradingDate: stockeasySnapshot.sourceTradingDate ?? stockeasySnapshot.captureDate ?? null,
    updatedAtLabel:
      stockeasySnapshot.marketSignal?.updatedAtLabel ?? stockeasySnapshot.marketAnalysis?.marketSignal?.updatedAtLabel ?? null,
    marketSignal: {
      short: stockeasySnapshot.marketSignal?.shortSignal ?? stockeasySnapshot.marketAnalysis?.marketSignal?.shortSignal ?? null,
      long: stockeasySnapshot.marketSignal?.longSignal ?? stockeasySnapshot.marketAnalysis?.marketSignal?.longSignal ?? null,
      kospi: stockeasySnapshot.marketSignal?.kospi ?? stockeasySnapshot.marketAnalysis?.marketSignal?.kospi ?? null,
      kosdaq: stockeasySnapshot.marketSignal?.kosdaq ?? stockeasySnapshot.marketAnalysis?.marketSignal?.kosdaq ?? null,
    },
    sectors: sortedSectors.slice(0, 32),
    etfRadar: radar,
    counts: {
      sectorRows: sectorRows.length,
      sectorCount: sortedSectors.length,
      rsRows: rsRows.length,
      etfCandidates: radar.reduce((sum, sector) => sum + sector.matchedEtfs.length, 0),
      etfGaps: radar.filter((sector) => sector.matchedEtfs.length === 0).length,
      historyDays: stockeasyHistory.length,
    },
  };
}

function firstNonEmpty(...values) {
  for (const value of values.flat()) {
    const text = compactText(value, 150);
    if (text) return text;
  }
  return "";
}

function shortRisk(value) {
  const text = String(value ?? "");
  if (text.includes("RSI_OVERHEAT")) return "RSI과열";
  if (text.includes("BOLLINGER")) return "상단돌파";
  if (text.includes("BLOCKED")) return "실행차단";
  if (text.includes("NO_CLEAN_REPORT")) return "근거부족";
  if (text.includes("OFF_REPORT")) return "외부근거";
  if (text.includes("DAY_SURGE")) return "당일급등";
  return text.split(":")[0].slice(0, 10);
}

function actionBriefForHolding(holding) {
  const bucket = holding.decision?.bucket ?? "";
  const attr = holding.attractiveness ?? {};
  const components = attr.components ?? {};
  const fundamental = holding.fundamental ?? {};
  const riskFlags = array(holding.riskFlags);
  const isOverheated =
    attr.label === "과열주의" ||
    Number(components.technicalRaw ?? 0) >= 75 ||
    riskFlags.some((flag) => String(flag).includes("RSI_OVERHEAT"));

  let lane = "wait";
  let action = "보유유지";
  let instruction = "지금은 추가 행동 없이 보유 논리와 이탈 조건만 확인합니다.";
  let trigger = firstNonEmpty(holding.invalidationConditions, holding.nextReview) || "신규 리포트 또는 가격 이탈";
  let avoid = isOverheated ? "급등 추격매수" : "근거 없는 비중 확대";
  let urgency = 35;
  let tone = "slate";

  if (/IMMEDIATE|BUY_NOW/.test(bucket)) {
    lane = "do";
    action = "분할매수";
    instruction = "오늘 예산 안에서 1차만 분할매수 후보로 봅니다.";
    trigger = firstNonEmpty(holding.addConditions) || "Stage4 금액 한도 안에서만 실행";
    avoid = "한 번에 크게 매수";
    urgency = 90;
    tone = "green";
  } else if (/CONDITIONAL/.test(bucket)) {
    lane = "wait";
    action = "조건대기";
    instruction = "조건이 오기 전까지 주문하지 않고 가격/근거 충족을 기다립니다.";
    trigger = firstNonEmpty(holding.addConditions) || "가격 눌림 또는 근거 보강";
    avoid = "조건 전 선매수";
    urgency = 70;
    tone = "blue";
  } else if (/HOLD_PROTECT|TRIM|EXIT/.test(bucket)) {
    lane = "do";
    action = "수익보호";
    instruction = "보유분은 유지하되 신규매수는 막고, 이탈 신호가 나오면 일부 감량을 검토합니다.";
    trigger = firstNonEmpty(holding.trimConditions, holding.invalidationConditions) || "20일선 이탈 또는 RSI 하락 반전";
    avoid = "수익권 추격매수";
    urgency = 78;
    tone = "amber";
  } else if (/BLOCKED|REJECT/.test(bucket)) {
    lane = "avoid";
    action = "매수금지";
    instruction = "지표가 좋아 보여도 오늘 실행 후보에서는 제외합니다.";
    trigger = firstNonEmpty(holding.addConditions, holding.invalidationConditions) || "차단 사유 해소 후 재검토";
    avoid = "예외 매수";
    urgency = 82;
    tone = "gray";
  } else if (/WATCH/.test(bucket)) {
    lane = "wait";
    action = "관찰유지";
    instruction = "가격과 외부 근거만 추적하고 매수/매도는 보류합니다.";
    trigger = firstNonEmpty(holding.addConditions, holding.nextReview) || "근거 보강 또는 가격 조건";
    avoid = "단독 뉴스 매수";
    urgency = 55;
    tone = "amber";
  }

  if (isOverheated && lane !== "avoid" && action !== "수익보호") {
    avoid = "과열 추격";
    urgency += 6;
  }

  const riskSummary = riskFlags.slice(0, 3).map(shortRisk).filter(Boolean);
  const fundamentalLabel = fundamental.score?.label
    ? String(fundamental.score.label).startsWith("기본") || String(fundamental.score.label).startsWith("수급")
      ? fundamental.score.label
      : `기본 ${fundamental.score.label}`
    : null;
  const because = [
    `${holding.decision?.label ?? "판정"} · 매력 ${attr.overall ?? "-"}점`,
    attr.label ? `상태 ${attr.label}` : null,
    fundamentalLabel,
    riskSummary.length > 0 ? `주의 ${riskSummary.join("/")}` : null,
  ].filter(Boolean);

  return {
    id: `brief:${holding.id}`,
    lane,
    action,
    tone,
    urgency,
    code: holding.code,
    name: holding.name,
    accountLabel: holding.accountLabel,
    category: holding.category,
    decisionLabel: holding.decision?.label ?? "확인",
    score: holding.scores?.action ?? 0,
    attractiveness: attr.overall ?? 0,
    instruction: compactText(instruction, 130),
    because: compactText(because.join(" / "), 150),
    trigger: compactText(trigger, 150),
    avoid: compactText(avoid, 90),
  };
}

function buildDecisionBrief(holdingViews, actionGroups, analysisLayers) {
  const queue = holdingViews
    .map(actionBriefForHolding)
    .sort((left, right) => right.urgency - left.urgency || right.score - left.score);

  const doItems = queue.filter((item) => item.lane === "do");
  const waitItems = queue.filter((item) => item.lane === "wait");
  const avoidItems = queue.filter((item) => item.lane === "avoid");
  const buyCount = array(actionGroups.immediateBuys).length + array(actionGroups.conditionalBuys).length;
  const protectCount = doItems.filter((item) => item.action === "수익보호").length;

  let stance = "관찰우선";
  let headline = "오늘은 조건 확인이 먼저입니다.";
  if (array(actionGroups.immediateBuys).length > 0) {
    stance = "분할실행";
    headline = "바로 살 종목만 작게 분할하고 나머지는 조건을 기다립니다.";
  } else if (protectCount > 0 && buyCount === 0) {
    stance = "보호우선";
    headline = "새 매수보다 수익권 보호와 추격 금지가 먼저입니다.";
  } else if (avoidItems.length > doItems.length) {
    stance = "매수보류";
    headline = "좋아 보이는 항목도 차단 사유가 남아 있어 매수 보류가 기본입니다.";
  }

  const topEtf = array(analysisLayers?.etfs).find((item) => item.held) ?? array(analysisLayers?.etfs)[0];
  const topStock = array(analysisLayers?.stocks).find((item) => item.held) ?? array(analysisLayers?.stocks)[0];
  const topSector = array(analysisLayers?.sectors)[0];
  const topTheme = array(analysisLayers?.themes)[0];

  return {
    stance,
    headline,
    counts: {
      do: doItems.length,
      wait: waitItems.length,
      avoid: avoidItems.length,
      buy: buyCount,
      protect: protectCount,
    },
    lanes: {
      do: doItems.slice(0, 4),
      wait: waitItems.slice(0, 4),
      avoid: avoidItems.slice(0, 4),
    },
    actionQueue: queue.slice(0, 14),
    layerImplications: [
      {
        layer: "시황",
        verdict: analysisLayers?.market?.regime ?? "확인",
        soWhat:
          analysisLayers?.market?.regime === "BULL"
            ? "상승장은 유지되지만 과열 종목은 눌림 조건이 필요합니다."
            : "시장 체력이 약하면 신규매수보다 현금/방어 비중을 우선합니다.",
        action: protectCount > 0 ? "추격금지" : "조건대기",
      },
      {
        layer: "테마",
        verdict: topTheme?.theme ?? "테마확인",
        soWhat: topTheme?.supportSummary
          ? `${topTheme.theme} 근거가 강하지만 종목별 가격 조건을 따로 봅니다.`
          : "테마만으로는 매수하지 않습니다.",
        action: "종목검증",
      },
      {
        layer: "섹터",
        verdict: topSector?.category ?? "섹터확인",
        soWhat: topSector
          ? `${topSector.category} 노출은 보유 ${topSector.holdingCount ?? 0}개라 추가 전 과집중을 확인합니다.`
          : "섹터별 보유/후보 균형을 먼저 봅니다.",
        action: "비중확인",
      },
      {
        layer: "ETF",
        verdict: topEtf?.name ?? "ETF확인",
        soWhat: topEtf?.score?.label
          ? `${topEtf.name}은 ${topEtf.score.label}이지만 NAV/구성/과열 조건을 통과해야 합니다.`
          : "ETF도 구성과 수급 공백이 있으면 실행하지 않습니다.",
        action: topEtf?.dataNeeds?.length ? "자료보강" : "조건대기",
      },
      {
        layer: "종목",
        verdict: topStock?.name ?? "종목확인",
        soWhat: topStock?.score?.label
          ? `${topStock.name}은 ${topStock.score.label}이라 보유 논리는 보되 가격 규칙을 우선합니다.`
          : "재무지표가 비면 리포트/기술만으로 크게 움직이지 않습니다.",
        action: "규칙우선",
      },
    ],
  };
}

function sellBriefForHolding(holding) {
  const bucket = holding.decision?.bucket ?? "";
  const attr = holding.attractiveness ?? {};
  const components = attr.components ?? {};
  const profitRate = Number(holding.position?.profitRate ?? 0);
  const marketValue = Number(holding.position?.marketValue ?? 0);
  const riskFlags = array(holding.riskFlags);
  const isOverheated =
    attr.label === "과열주의" ||
    Number(components.technicalRaw ?? 0) >= 78 ||
    riskFlags.some((flag) => String(flag).includes("RSI_OVERHEAT"));
  const weakAttractiveness = Number(attr.overall ?? 0) <= 42;
  const hasInvalidation = array(holding.invalidationConditions).length > 0;

  let lane = "hold";
  let action = "유지";
  let tone = "green";
  let priority = 20;
  let decision = "지금은 매도보다 보유 논리 확인이 우선입니다.";
  let trigger = firstNonEmpty(holding.invalidationConditions, holding.nextReview) || "신규 리포트 또는 가격 이탈";
  let size = "0%";

  if (/EXIT/.test(bucket)) {
    lane = "sell";
    action = "전량검토";
    tone = "red";
    priority = 96;
    decision = "보유 논리가 깨졌는지 확인하고 전량 매도까지 검토합니다.";
    trigger = firstNonEmpty(holding.invalidationConditions, holding.trimConditions) || "무효화 조건 발생";
    size = "50~100%";
  } else if (/TRIM/.test(bucket)) {
    lane = "trim";
    action = "부분매도";
    tone = "amber";
    priority = 88;
    decision = "비중 과다 또는 리스크 확대 구간이라 일부 감량 후보입니다.";
    trigger = firstNonEmpty(holding.trimConditions, holding.invalidationConditions) || "반등 실패 또는 비중 과다";
    size = "20~40%";
  } else if (/HOLD_PROTECT/.test(bucket) || (isOverheated && profitRate >= 10)) {
    lane = "trim";
    action = "익절감시";
    tone = "amber";
    priority = 78 + Math.min(12, Math.max(0, profitRate / 5));
    decision = "지금 전량매도는 아니고, 이탈 신호가 나오면 일부 이익 실현을 검토합니다.";
    trigger = firstNonEmpty(holding.trimConditions, holding.invalidationConditions) || "20일선 이탈 또는 RSI 하락 반전";
    size = profitRate >= 25 ? "20~30%" : "10~20%";
  } else if (weakAttractiveness && (profitRate < 0 || /BLOCKED|REJECT/.test(bucket))) {
    lane = "stop";
    action = "손절감시";
    tone = "red";
    priority = 70;
    decision = "매력도와 실행 판정이 약하므로 추가 하락 시 손절 기준을 확인합니다.";
    trigger = firstNonEmpty(holding.invalidationConditions, holding.trimConditions) || "손실 확대 또는 근거 훼손";
    size = "20~50%";
  } else if (hasInvalidation || riskFlags.length > 0) {
    lane = "watch";
    action = "조건감시";
    tone = "blue";
    priority = 48 + Math.min(20, Math.max(0, profitRate / 3));
    decision = "매도는 보류하되 무효화 조건과 위험 플래그를 체크합니다.";
    trigger = firstNonEmpty(holding.invalidationConditions, holding.trimConditions) || "위험 플래그 재확인";
    size = "0~20%";
  }

  const riskSummary = riskFlags.slice(0, 3).map(shortRisk).filter(Boolean);
  const reason = [
    `손익 ${Number.isFinite(profitRate) ? `${profitRate > 0 ? "+" : ""}${round(profitRate, 1)}%` : "-"}`,
    `매력 ${attr.overall ?? "-"}점`,
    attr.label ? attr.label : null,
    riskSummary.length ? riskSummary.join("/") : null,
  ].filter(Boolean);

  return {
    id: `sell:${holding.id}`,
    lane,
    action,
    tone,
    priority: round(priority, 0),
    code: holding.code,
    name: holding.name,
    accountLabel: holding.accountLabel,
    category: holding.category,
    decisionLabel: holding.decision?.label ?? "확인",
    profitRate: round(profitRate, 2),
    marketValue: round(marketValue, 0),
    attractiveness: attr.overall ?? 0,
    size,
    decision: compactText(decision, 130),
    trigger: compactText(trigger, 150),
    reason: compactText(reason.join(" / "), 150),
  };
}

function buildSellBrief(holdingViews) {
  const heldById = new Map();
  for (const holding of holdingViews) {
    const hasPosition =
      Number(holding.position?.marketValue ?? 0) > 0 || Number(holding.position?.quantity ?? 0) > 0;
    if (!hasPosition) continue;
    const existing = heldById.get(holding.id);
    const currentBlocked = /BLOCKED|REJECT/.test(holding.decision?.bucket ?? "");
    const existingBlocked = /BLOCKED|REJECT/.test(existing?.decision?.bucket ?? "");
    if (
      !existing ||
      (existingBlocked && !currentBlocked) ||
      Number(holding.scores?.action ?? 0) > Number(existing.scores?.action ?? 0)
    ) {
      heldById.set(holding.id, holding);
    }
  }

  const items = [...heldById.values()]
    .map(sellBriefForHolding)
    .sort((left, right) => right.priority - left.priority || Math.abs(right.profitRate ?? 0) - Math.abs(left.profitRate ?? 0));
  const sellNow = items.filter((item) => item.lane === "sell");
  const trim = items.filter((item) => item.lane === "trim");
  const stop = items.filter((item) => item.lane === "stop");
  const watch = items.filter((item) => item.lane === "watch");
  const hold = items.filter((item) => item.lane === "hold");

  let headline = "지금 전량매도 신호는 없고, 일부 익절/손절 조건만 감시합니다.";
  if (sellNow.length > 0) {
    headline = "전량 매도 검토 대상이 있습니다. 무효화 조건을 먼저 확인하세요.";
  } else if (trim.length > 0) {
    headline = "전량매도보다 수익권 일부익절 조건 감시가 핵심입니다.";
  } else if (stop.length > 0) {
    headline = "손실 확대 종목은 손절 기준을 먼저 확인해야 합니다.";
  }

  return {
    headline,
    counts: {
      sellNow: sellNow.length,
      trim: trim.length,
      stop: stop.length,
      watch: watch.length,
      hold: hold.length,
    },
    lanes: {
      sellNow: sellNow.slice(0, 4),
      trim: trim.slice(0, 5),
      stop: stop.slice(0, 4),
      watch: watch.slice(0, 4),
      hold: hold.slice(0, 5),
    },
    queue: items.slice(0, 16),
  };
}

function buildQwenCoachView(qwenCoach) {
  if (!qwenCoach || typeof qwenCoach !== "object") return null;
  return {
    status: qwenCoach.status ?? "unknown",
    headline: compactText(qwenCoach.headline, 180),
    provider: qwenCoach.provider ?? "qwen",
    model: qwenCoach.model ?? null,
    requestedModel: qwenCoach.requestedModel ?? null,
    webSearch: Boolean(qwenCoach.webSearch),
    searchStrategy: qwenCoach.searchStrategy ?? null,
    forcedSearch: Boolean(qwenCoach.forcedSearch),
    generatedAt: qwenCoach.generatedAt ?? null,
    sellCoach: array(qwenCoach.sellCoach).slice(0, 8).map((item) => ({
      code: item.code ?? null,
      name: item.name ?? null,
      accountLabel: item.accountLabel ?? null,
      action: item.action ?? "확인",
      confidence: round(item.confidence ?? 0, 0),
      reason: compactText(item.reason, 140),
      trigger: compactText(item.trigger, 140),
      webCheck: item.webCheck ?? null,
      sourceUrls: array(item.sourceUrls).slice(0, 3),
    })),
    buyCoach: array(qwenCoach.buyCoach).slice(0, 8).map((item) => ({
      code: item.code ?? null,
      name: item.name ?? null,
      action: item.action ?? "확인",
      confidence: round(item.confidence ?? 0, 0),
      reason: compactText(item.reason, 140),
      trigger: compactText(item.trigger, 140),
    })),
    riskWarnings: array(qwenCoach.riskWarnings).slice(0, 8).map((item) => compactText(item, 140)),
    researchBacklog: array(qwenCoach.researchBacklog).slice(0, 8).map((item) => ({
      question: compactText(item.question, 160),
      why: compactText(item.why, 140),
      priority: item.priority ?? "중간",
    })),
    searchedQueries: array(qwenCoach.searchedQueries).slice(0, 10).map((item) => compactText(item, 120)),
    error: qwenCoach.error ? compactText(qwenCoach.error, 240) : null,
  };
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return round(number <= 1 ? number * 100 : number, 0);
}

function buildAccountStrategyView(strategy, artifactPath = null) {
  if (!strategy || typeof strategy !== "object") return null;
  return {
    status: strategy.status ?? "unknown",
    headline: compactText(strategy.headline, 180),
    stance: compactText(strategy.stance, 20),
    provider: strategy.provider ?? "qwen",
    model: strategy.model ?? null,
    requestedModel: strategy.requestedModel ?? null,
    webSearch: Boolean(strategy.webSearch),
    searchStrategy: strategy.searchStrategy ?? null,
    forcedSearch: Boolean(strategy.forcedSearch),
    generatedAt: strategy.generatedAt ?? null,
    confidence: normalizeConfidence(strategy.confidence),
    artifact: artifactPath,
    todayDo: array(strategy.todayDo).slice(0, 8).map((item) => ({
      priority: item.priority ?? "중간",
      action: item.action ?? "확인",
      accountLabel: item.accountLabel ?? null,
      name: item.name ?? null,
      reason: compactText(item.reason, 180),
      condition: compactText(item.condition, 160),
      doNot: compactText(item.doNot, 140),
    })),
    todayDoNot: array(strategy.todayDoNot).slice(0, 10).map((item) => compactText(item, 150)),
    sellWatch: array(strategy.sellWatch).slice(0, 10).map((item) => ({
      accountLabel: item.accountLabel ?? null,
      name: item.name ?? null,
      action: item.action ?? "확인",
      reason: compactText(item.reason, 160),
      trigger: compactText(item.trigger, 150),
    })),
    buyWatch: array(strategy.buyWatch).slice(0, 10).map((item) => ({
      name: item.name ?? null,
      action: item.action ?? "확인",
      reason: compactText(item.reason, 160),
      trigger: compactText(item.trigger, 150),
    })),
    sectorView: array(strategy.sectorView).slice(0, 12).map((item) => ({
      sector: item.sector ?? null,
      view: item.view ?? null,
      action: item.action ?? "확인",
      reason: compactText(item.reason, 150),
    })),
    weeklyChecklist: array(strategy.weeklyChecklist).slice(0, 8).map((item) => compactText(item, 150)),
    missingData: array(strategy.missingData).slice(0, 8).map((item) => compactText(item, 150)),
    riskWarnings: array(strategy.riskWarnings).slice(0, 8).map((item) => compactText(item, 150)),
    validationWarnings: array(strategy.validationWarnings).slice(0, 8).map((item) => compactText(item, 150)),
    error: strategy.error ? compactText(strategy.error, 240) : null,
  };
}

function buildStockPulseView(stockPulse) {
  if (!stockPulse || typeof stockPulse !== "object") return null;
  return {
    status: stockPulse.status ?? "unknown",
    generatedAt: stockPulse.generatedAt ?? null,
    sourceStatus: stockPulse.sourceStatus ?? {},
    counts: stockPulse.counts ?? {},
    summary: {
      headline: compactText(stockPulse.summary?.headline, 180),
      nextAction: compactText(stockPulse.summary?.nextAction, 180),
    },
    items: array(stockPulse.items).slice(0, 40).map((item) => ({
      id: item.id ?? `stock-pulse:${item.code ?? item.name}`,
      code: item.code ?? null,
      name: item.name ?? null,
      category: item.category ?? null,
      type: item.type ?? null,
      verdict: item.verdict ?? "확인",
      urgency: item.urgency ?? "낮음",
      pulseScore: round(item.pulseScore ?? 0, 0),
      oneLine: compactText(item.oneLine, 170),
      doNow: compactText(item.doNow, 170),
      doNot: compactText(item.doNot, 130),
      nextCheck: compactText(item.nextCheck, 150),
      accounts: array(item.accounts).slice(0, 5).map((account) => ({
        accountKey: account.accountKey ?? null,
        accountLabel: account.accountLabel ?? null,
        marketValue: round(account.marketValue ?? 0, 0),
        profitRate: numberOrNull(account.profitRate),
        decision: account.decision ?? null,
      })),
      position: {
        marketValue: round(item.position?.marketValue ?? 0, 0),
        profitLoss: round(item.position?.profitLoss ?? 0, 0),
        profitRate: numberOrNull(item.position?.profitRate),
      },
      market: {
        price: numberOrNull(item.market?.price),
        changePct: numberOrNull(item.market?.changePct),
        volume: numberOrNull(item.market?.volume),
        volumeRatio: numberOrNull(item.market?.volumeRatio),
        navGapPct: numberOrNull(item.market?.navGapPct),
        rank: numberOrNull(item.market?.rank),
      },
      technical: {
        score: numberOrNull(item.technical?.score),
        signal: item.technical?.signal ?? null,
        reason: compactText(item.technical?.reason, 140),
        rsi: numberOrNull(item.technical?.rsi),
        ma20: numberOrNull(item.technical?.ma20),
        ma60: numberOrNull(item.technical?.ma60),
        recentHighDistancePct: numberOrNull(item.technical?.recentHighDistancePct),
        rsVsBenchmark: numberOrNull(item.technical?.rsVsBenchmark),
        alerts: array(item.technical?.alerts).slice(0, 4).map((value) => compactText(value, 90)),
      },
      fundamental: {
        score: numberOrNull(item.fundamental?.score),
        label: item.fundamental?.label ?? null,
        metrics: item.fundamental?.metrics ?? null,
        etf: item.fundamental?.etf ?? null,
      },
      alerts: array(item.alerts).slice(0, 6).map((alert) => ({
        severity: alert.severity ?? "low",
        label: alert.label ?? "확인",
        detail: compactText(alert.detail, 130),
        tone: alert.tone ?? "slate",
      })),
      quickFactors: array(item.quickFactors).slice(0, 5).map((value) => compactText(value, 60)),
      newsHits: array(item.newsHits).slice(0, 3).map((news) => ({
        title: compactText(news.title, 110),
        direction: news.direction ?? "neutral",
        confidence: numberOrNull(news.confidence),
        url: news.url ?? null,
      })),
      strategyMentions: array(item.strategyMentions).slice(0, 3).map((mention) => ({
        action: mention.action ?? "확인",
        reason: compactText(mention.reason, 120),
        trigger: compactText(mention.trigger, 120),
      })),
      missingSources: array(item.missingSources).slice(0, 6).map((value) => compactText(value, 80)),
      riskFlags: array(item.riskFlags).slice(0, 6).map((value) => compactText(value, 80)),
    })),
    artifacts: stockPulse.artifacts ?? {},
  };
}

function buildRotationWatchView(rotationWatch) {
  if (!rotationWatch || typeof rotationWatch !== "object") return null;
  return {
    status: rotationWatch.status ?? "unknown",
    generatedAt: rotationWatch.generatedAt ?? null,
    lookbackDays: numberOrNull(rotationWatch.lookbackDays),
    includedDates: array(rotationWatch.includedDates).slice(-24),
    summary: {
      headline: compactText(rotationWatch.summary?.headline, 190),
      mode: rotationWatch.summary?.mode ?? rotationWatch.marketTrend?.mode ?? null,
      stance: rotationWatch.summary?.stance ?? rotationWatch.portfolioImplications?.stance ?? null,
      latestMacroSummary: compactText(rotationWatch.summary?.latestMacroSummary, 190),
      nextAction: compactText(rotationWatch.summary?.nextAction, 180),
    },
    marketTrend: {
      mode: rotationWatch.marketTrend?.mode ?? null,
      currentRegime: rotationWatch.marketTrend?.currentRegime ?? null,
      previousRegime: rotationWatch.marketTrend?.previousRegime ?? null,
      regimeChanged: Boolean(rotationWatch.marketTrend?.regimeChanged),
      confidence: numberOrNull(rotationWatch.marketTrend?.confidence),
      portfolioScore: numberOrNull(rotationWatch.marketTrend?.portfolioScore),
      scoreDelta: numberOrNull(rotationWatch.marketTrend?.scoreDelta),
      currentRsi: numberOrNull(rotationWatch.marketTrend?.currentRsi),
      marketScore: numberOrNull(rotationWatch.marketTrend?.marketScore),
      overheatDays: numberOrNull(rotationWatch.marketTrend?.overheatDays),
      observedDays: numberOrNull(rotationWatch.marketTrend?.observedDays),
      alerts: array(rotationWatch.marketTrend?.alerts).slice(0, 6).map((item) => compactText(item, 100)),
      riskTriggers: array(rotationWatch.marketTrend?.riskTriggers).slice(0, 8).map((item) => compactText(item, 120)),
    },
    rotationTargets: {
      summary: {
        answer: compactText(rotationWatch.rotationTargets?.summary?.answer, 190),
        currentAction: compactText(rotationWatch.rotationTargets?.summary?.currentAction, 120),
        switchRule: compactText(rotationWatch.rotationTargets?.summary?.switchRule, 190),
      },
      watch: array(rotationWatch.rotationTargets?.watch).slice(0, 6).map((item) => ({
        sector: item.sector ?? null,
        priority: item.priority ?? null,
        action: item.action ?? null,
        verdict: item.verdict ?? null,
        tone: item.tone ?? "slate",
        score: numberOrNull(item.score),
        confidence: numberOrNull(item.confidence),
        whyWatch: compactText(item.whyWatch, 150),
        switchWhen: compactText(item.switchWhen, 180),
        invalidation: compactText(item.invalidation, 150),
        evidence: array(item.evidence).slice(0, 4).map((value) => compactText(value, 120)),
        sourceConsensus: item.sourceConsensus
          ? {
              label: item.sourceConsensus.label ?? null,
              detail: compactText(item.sourceConsensus.detail, 140),
              sourceCount: numberOrNull(item.sourceConsensus.sourceCount),
              supportSummary: compactText(item.sourceConsensus.supportSummary, 140),
              netScore: numberOrNull(item.sourceConsensus.netScore),
            }
          : null,
        transitionTrigger: item.transitionTrigger
          ? {
              label: item.transitionTrigger.label ?? null,
              tone: item.transitionTrigger.tone ?? "slate",
              summary: compactText(item.transitionTrigger.summary, 140),
              entryChecklist: array(item.transitionTrigger.entryChecklist).slice(0, 5).map((value) => compactText(value, 100)),
              exitChecklist: array(item.transitionTrigger.exitChecklist).slice(0, 5).map((value) => compactText(value, 100)),
              chart: item.transitionTrigger.chart
                ? {
                    label: item.transitionTrigger.chart.label ?? null,
                    detail: compactText(item.transitionTrigger.chart.detail, 120),
                    entryTriggers: array(item.transitionTrigger.chart.entryTriggers).slice(0, 5),
                    exitTriggers: array(item.transitionTrigger.chart.exitTriggers).slice(0, 5),
                  }
                : null,
              news: item.transitionTrigger.news
                ? {
                    label: item.transitionTrigger.news.label ?? null,
                    detail: compactText(item.transitionTrigger.news.detail, 120),
                    headlines: array(item.transitionTrigger.news.headlines).slice(0, 3),
                  }
                : null,
            }
          : null,
        representative: array(item.representative).slice(0, 4).map((rep) => ({
          code: rep.code ?? null,
          name: rep.name ?? null,
          verdict: rep.verdict ?? null,
          rsi: numberOrNull(rep.rsi),
          score: numberOrNull(rep.score),
          profitRate: numberOrNull(rep.profitRate),
        })),
      })),
      excluded: array(rotationWatch.rotationTargets?.excluded).slice(0, 6).map((item) => ({
        sector: item.sector ?? null,
        verdict: item.verdict ?? null,
        action: item.action ?? null,
        invalidation: compactText(item.invalidation, 140),
      })),
    },
    transitionTriggerBoard: {
      summary: compactText(rotationWatch.transitionTriggerBoard?.summary, 180),
      rows: array(rotationWatch.transitionTriggerBoard?.rows).slice(0, 8).map((item) => ({
        sector: item.sector ?? null,
        label: item.label ?? null,
        tone: item.tone ?? "slate",
        verdict: item.verdict ?? null,
        action: item.action ?? null,
        summary: compactText(item.summary, 140),
        entryChecklist: array(item.entryChecklist).slice(0, 5).map((value) => compactText(value, 100)),
        exitChecklist: array(item.exitChecklist).slice(0, 5).map((value) => compactText(value, 100)),
        chart: item.chart
          ? {
              label: item.chart.label ?? null,
              detail: compactText(item.chart.detail, 120),
              entryTriggers: array(item.chart.entryTriggers).slice(0, 5),
              exitTriggers: array(item.chart.exitTriggers).slice(0, 5),
            }
          : null,
        news: item.news
          ? {
              label: item.news.label ?? null,
              detail: compactText(item.news.detail, 120),
              headlines: array(item.news.headlines).slice(0, 3),
            }
          : null,
      })),
    },
    sectorRotation: array(rotationWatch.sectorRotation).slice(0, 10).map((item) => ({
      sector: item.sector ?? null,
      status: item.status ?? "관찰",
      tone: item.tone ?? "slate",
      action: item.action ?? "관찰",
      recentScore: numberOrNull(item.recentScore),
      previousScore: numberOrNull(item.previousScore),
      momentum: numberOrNull(item.momentum),
      mentions: numberOrNull(item.mentions),
      firstDate: item.firstDate ?? null,
      lastDate: item.lastDate ?? null,
      themes: array(item.themes).slice(0, 5).map((theme) => ({
        theme: theme.theme ?? null,
        subTheme: theme.subTheme ?? null,
        status: theme.status ?? null,
        action: theme.action ?? null,
        momentum: numberOrNull(theme.momentum),
        reason: compactText(theme.reason, 120),
      })),
      note: compactText(item.note, 170),
    })),
    sectorDeliberations: array(rotationWatch.sectorDeliberations).slice(0, 12).map((item) => ({
      sector: item.sector ?? null,
      verdict: item.verdict ?? "관찰유지",
      tone: item.tone ?? "slate",
      confidence: numberOrNull(item.confidence),
      question: compactText(item.question, 130),
      finalAnswer: compactText(item.finalAnswer, 170),
      bullScore: numberOrNull(item.bullScore),
      bearScore: numberOrNull(item.bearScore),
      rotation: {
        status: item.rotation?.status ?? null,
        action: item.rotation?.action ?? null,
        recentScore: numberOrNull(item.rotation?.recentScore),
        momentum: numberOrNull(item.rotation?.momentum),
        note: compactText(item.rotation?.note, 130),
      },
      stockeasy: {
        available: Boolean(item.stockeasy?.available),
        label: item.stockeasy?.label ?? null,
        detail: compactText(item.stockeasy?.detail, 140),
        latest: item.stockeasy?.latest
          ? {
              date: item.stockeasy.latest.date ?? null,
              sourceTradingDate: item.stockeasy.latest.sourceTradingDate ?? null,
              sector: item.stockeasy.latest.sector ?? null,
              changePct: numberOrNull(item.stockeasy.latest.changePct),
              signal: numberOrNull(item.stockeasy.latest.signal),
              rsScore: numberOrNull(item.stockeasy.latest.rsScore),
              leaders: array(item.stockeasy.latest.leaders).slice(0, 5),
            }
          : null,
      },
      sourceConsensus: {
        available: Boolean(item.sourceConsensus?.available),
        label: item.sourceConsensus?.label ?? null,
        detail: compactText(item.sourceConsensus?.detail, 140),
        netScore: numberOrNull(item.sourceConsensus?.netScore),
        sourceCount: numberOrNull(item.sourceConsensus?.sourceCount),
        supportSummary: compactText(item.sourceConsensus?.supportSummary, 140),
        confidence: numberOrNull(item.sourceConsensus?.confidence),
        conflictCount: numberOrNull(item.sourceConsensus?.conflictCount),
        missingSources: array(item.sourceConsensus?.missingSources).slice(0, 5),
        topItems: array(item.sourceConsensus?.topItems).slice(0, 4).map((topItem) => ({
          name: topItem.name ?? null,
          type: topItem.type ?? null,
          netScore: numberOrNull(topItem.netScore),
          supportSummary: compactText(topItem.supportSummary, 100),
          label: topItem.label ?? null,
        })),
        evidence: array(item.sourceConsensus?.evidence).slice(0, 5).map((value) => compactText(value, 110)),
      },
      transitionTrigger: item.transitionTrigger
        ? {
            label: item.transitionTrigger.label ?? null,
            tone: item.transitionTrigger.tone ?? "slate",
            summary: compactText(item.transitionTrigger.summary, 140),
            entryChecklist: array(item.transitionTrigger.entryChecklist).slice(0, 5).map((value) => compactText(value, 100)),
            exitChecklist: array(item.transitionTrigger.exitChecklist).slice(0, 5).map((value) => compactText(value, 100)),
          }
        : null,
      chartTriggers: item.chartTriggers
        ? {
            available: Boolean(item.chartTriggers.available),
            label: item.chartTriggers.label ?? null,
            detail: compactText(item.chartTriggers.detail, 140),
            entryTriggers: array(item.chartTriggers.entryTriggers).slice(0, 5),
            exitTriggers: array(item.chartTriggers.exitTriggers).slice(0, 5),
            watchTriggers: array(item.chartTriggers.watchTriggers).slice(0, 4),
            items: array(item.chartTriggers.items).slice(0, 4).map((chartItem) => ({
              code: chartItem.code ?? null,
              name: chartItem.name ?? null,
              score: numberOrNull(chartItem.score),
              rsi: numberOrNull(chartItem.rsi),
              entry: array(chartItem.entry).slice(0, 4),
              exit: array(chartItem.exit).slice(0, 4),
            })),
          }
        : null,
      newsTriggers: item.newsTriggers
        ? {
            available: Boolean(item.newsTriggers.available),
            label: item.newsTriggers.label ?? null,
            detail: compactText(item.newsTriggers.detail, 140),
            positive: numberOrNull(item.newsTriggers.positive),
            negative: numberOrNull(item.newsTriggers.negative),
            headlines: array(item.newsTriggers.headlines).slice(0, 4),
          }
        : null,
      technical: {
        available: Boolean(item.technical?.available),
        label: item.technical?.label ?? null,
        avgScore: numberOrNull(item.technical?.avgScore),
        avgRsi: numberOrNull(item.technical?.avgRsi),
        avgProfit: numberOrNull(item.technical?.avgProfit),
        overheatCount: numberOrNull(item.technical?.overheatCount),
        detail: compactText(item.technical?.detail, 140),
        items: array(item.technical?.items).slice(0, 5).map((techItem) => ({
          code: techItem.code ?? null,
          name: techItem.name ?? null,
          category: techItem.category ?? null,
          verdict: techItem.verdict ?? null,
          score: numberOrNull(techItem.score),
          rsi: numberOrNull(techItem.rsi),
          profitRate: numberOrNull(techItem.profitRate),
          reason: compactText(techItem.reason, 100),
        })),
      },
      exposure: item.exposure
        ? {
            weightPct: numberOrNull(item.exposure.weightPct),
            holdingCount: numberOrNull(item.exposure.holdingCount),
            categories: array(item.exposure.categories).slice(0, 5),
            risk: item.exposure.risk ?? null,
          }
        : null,
      themes: array(item.themes).slice(0, 5),
      bullCase: array(item.bullCase).slice(0, 4).map((value) => compactText(value, 130)),
      bearCase: array(item.bearCase).slice(0, 4).map((value) => compactText(value, 130)),
      nextChecks: array(item.nextChecks).slice(0, 4).map((value) => compactText(value, 130)),
    })),
    stockeasySectorUniverse: array(rotationWatch.stockeasySectorUniverse).slice(0, 18).map((item) => ({
      sector: item.sector ?? null,
      signal: numberOrNull(item.signal),
      changePct: numberOrNull(item.changePct),
      holdDays: numberOrNull(item.holdDays),
      gapPct: numberOrNull(item.gapPct),
      rsScore: numberOrNull(item.rsScore),
      rsRank: numberOrNull(item.rsRank),
      leaders: array(item.leaders).slice(0, 4),
      sourcePanels: array(item.sourcePanels).slice(0, 3),
    })),
    themeRotation: array(rotationWatch.themeRotation).slice(0, 14).map((item) => ({
      theme: item.theme ?? null,
      sector: item.sector ?? null,
      subTheme: item.subTheme ?? null,
      layer: item.layer ?? null,
      definition: compactText(item.definition, 160),
      status: item.status ?? "관찰",
      tone: item.tone ?? "slate",
      action: item.action ?? "조건 관찰",
      currentDirection: item.currentDirection ?? null,
      recentScore: numberOrNull(item.recentScore),
      previousScore: numberOrNull(item.previousScore),
      momentum: numberOrNull(item.momentum),
      mentions: numberOrNull(item.mentions),
      firstDate: item.firstDate ?? null,
      lastDate: item.lastDate ?? null,
      sources: array(item.sources).slice(0, 5),
      accounts: array(item.accounts).slice(0, 5),
      rawThemes: array(item.rawThemes).slice(0, 6).map((theme) => compactText(theme, 60)),
      reason: compactText(item.reason, 160),
    })),
    portfolioImplications: {
      stance: rotationWatch.portfolioImplications?.stance ?? null,
      crowdedExposures: array(rotationWatch.portfolioImplications?.crowdedExposures).slice(0, 10).map((item) => ({
        category: item.category ?? null,
        marketValue: numberOrNull(item.marketValue),
        weightPct: numberOrNull(item.weightPct),
        holdingCount: numberOrNull(item.holdingCount),
        risk: item.risk ?? null,
        names: array(item.names).slice(0, 5).map((name) => compactText(name, 50)),
      })),
      reduceFirst: array(rotationWatch.portfolioImplications?.reduceFirst).slice(0, 10).map((item) => ({
        code: item.code ?? null,
        name: item.name ?? null,
        category: item.category ?? null,
        verdict: item.verdict ?? "확인",
        urgency: item.urgency ?? "낮음",
        profitRate: numberOrNull(item.profitRate),
        rsi: numberOrNull(item.rsi),
        trigger: compactText(item.trigger, 150),
        doNot: compactText(item.doNot, 120),
      })),
      emergingSectors: array(rotationWatch.portfolioImplications?.emergingSectors).slice(0, 6).map((item) => ({
        sector: item.sector ?? null,
        status: item.status ?? null,
        action: item.action ?? null,
        momentum: numberOrNull(item.momentum),
        note: compactText(item.note, 140),
      })),
      emergingThemes: array(rotationWatch.portfolioImplications?.emergingThemes).slice(0, 8).map((item) => ({
        theme: item.theme ?? null,
        sector: item.sector ?? null,
        subTheme: item.subTheme ?? null,
        status: item.status ?? null,
        action: item.action ?? null,
        momentum: numberOrNull(item.momentum),
        reason: compactText(item.reason, 140),
      })),
      weakeningThemes: array(rotationWatch.portfolioImplications?.weakeningThemes).slice(0, 8).map((item) => ({
        theme: item.theme ?? null,
        status: item.status ?? null,
        action: item.action ?? null,
        momentum: numberOrNull(item.momentum),
        reason: compactText(item.reason, 140),
      })),
      roleGaps: array(rotationWatch.portfolioImplications?.roleGaps).slice(0, 6).map((item) => ({
        accountKey: item.accountKey ?? null,
        accountLabel: item.accountLabel ?? null,
        gapCategory: item.gapCategory ?? null,
        gapAmount: numberOrNull(item.gapAmount),
        candidate: item.candidate ?? null,
        noAction: Boolean(item.noAction),
        reason: compactText(item.reason, 120),
      })),
      rules: array(rotationWatch.portfolioImplications?.rules).slice(0, 5).map((item) => compactText(item, 150)),
    },
    conceptGuide: array(rotationWatch.conceptGuide).slice(0, 6).map((item) => ({
      term: item.term ?? null,
      layer: item.layer ?? null,
      meaning: compactText(item.meaning, 170),
      examples: array(item.examples).slice(0, 5).map((example) => compactText(example, 50)),
    })),
    scenarioPlaybook: array(rotationWatch.scenarioPlaybook).slice(0, 5).map((item) => ({
      scenario: item.scenario ?? "시나리오",
      trigger: compactText(item.trigger, 160),
      action: compactText(item.action, 160),
      firstMoves: array(item.firstMoves).slice(0, 6).map((move) => compactText(move, 60)),
    })),
    weeklyChecklist: array(rotationWatch.weeklyChecklist).slice(0, 8).map((item) => compactText(item, 150)),
    dataNeeds: array(rotationWatch.dataNeeds).slice(0, 6).map((item) => compactText(item, 140)),
    artifacts: rotationWatch.artifacts ?? {},
  };
}

async function readFirstExistingJson(paths) {
  for (const filePath of paths) {
    const value = await readJson(filePath, null);
    if (value && typeof value === "object") {
      return {
        value,
        artifactPath: path.relative(ROOT_DIR, filePath),
      };
    }
  }
  return { value: null, artifactPath: null };
}

async function readStockeasyHistory(date) {
  const root = path.join(ROOT_DIR, "data", "external", "stockeasy");
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const dates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name <= date)
    .sort()
    .slice(-12);

  const history = [];
  for (const itemDate of dates) {
    const snapshot = await readJson(path.join(root, itemDate, "snapshot.json"), null);
    if (snapshot) history.push({ date: itemDate, snapshot });
  }
  return history;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);
  const featureDir = path.join(ROOT_DIR, "data", "features", date);
  const normalizedDir = path.join(ROOT_DIR, "data", "normalized", date);
  const fundamentalDir = path.join(ROOT_DIR, "data", "fundamentals", date);

  const [
    systemHealth,
    stage4,
    holdingCards,
    decisionFeatures,
    supplement,
    fundamentalSnapshot,
    market,
    portfolio,
    normalizedReports,
    normalizedStockeasy,
    normalizedMarketvoice,
    normalizedTechnical,
    normalizedKisEtf,
    normalizedNews,
    stockeasySnapshot,
    qwenCoachRaw,
    qwenAccountStrategyRaw,
    stockPulseRaw,
    rotationWatchRaw,
  ] = await Promise.all([
    readJson(path.join(analysisDir, "system-health.json"), {}),
    readJson(path.join(analysisDir, "stage4-execution-plan.json"), {}),
    readJson(path.join(analysisDir, "holding-decision-cards.json"), { cards: [] }),
    readJson(path.join(featureDir, "decision-features.json"), {}),
    readJson(path.join(featureDir, "source-consensus-supplement.json"), {}),
    readJson(path.join(fundamentalDir, "security-fundamentals.json"), {}),
    readJson(path.join(ROOT_DIR, "data", "market", `${date}.json`), {}),
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(normalizedDir, "reports.normalized.json"), {}),
    readJson(path.join(normalizedDir, "stockeasy.normalized.json"), {}),
    readJson(path.join(normalizedDir, "marketvoice.normalized.json"), {}),
    readJson(path.join(normalizedDir, "technical.normalized.json"), {}),
    readJson(path.join(normalizedDir, "kis_etf.normalized.json"), {}),
    readJson(path.join(normalizedDir, "news.normalized.json"), {}),
    readJson(path.join(ROOT_DIR, "data", "external", "stockeasy", date, "snapshot.json"), null),
    readJson(path.join(analysisDir, "qwen-cockpit-coach.json"), null),
    readFirstExistingJson([
      path.join(analysisDir, "qwen-account-strategy.json"),
      path.join(analysisDir, "qwen-account-strategy-test.json"),
    ]),
    readJson(path.join(ROOT_DIR, "data", "stock-pulse", date, "stock-pulse.json"), null),
    readJson(path.join(analysisDir, "rotation-watch.json"), null),
  ]);

  const stage4Accounts = stage4AccountLookup(stage4);
  const accountFeatures = accountFeatureLookup(decisionFeatures);
  const securityFeaturesByCode = securityFeatureLookup(decisionFeatures);
  const supplementsByCode = supplementLookup(supplement);
  const fundamentalsByCode = fundamentalLookup(fundamentalSnapshot);
  const portfolioHoldingByAccount = buildPortfolioHoldingLookup(portfolio);
  const stockeasyHistory = await readStockeasyHistory(date);

  const accountViews = array(portfolio.accounts).map((account) => {
    const plan = stage4Accounts.get(account.key) ?? {};
    const feature = accountFeatures.get(account.key) ?? {};
    return {
      accountKey: account.key,
      accountLabel: account.label ?? account.key,
      totalValue: round(accountValue(account), 0),
      cash: round(account.cash ?? account.cashBalance ?? 0, 0),
      holdingCount: array(account.holdings).length,
      stage4Score: round(plan.totalScore ?? 0, 0),
      deployBudget: round(plan.plannedDeployBudget ?? plan.deployBudget ?? 0, 0),
      noAction: Boolean(plan.noAction),
      noActionReason: compactText(plan.noActionReason, 120),
      support: sourceSupportView(feature.support),
      topThemes: array(feature.topSupportingThemes).slice(0, 5),
      topRisks: array(feature.topRisks).slice(0, 5),
    };
  });

  const holdingViews = dedupeHoldingViews(
    array(holdingCards.cards).map((card) =>
      buildHoldingView(card, {
        portfolioHoldingByAccount,
        securityFeaturesByCode,
        supplementsByCode,
        fundamentalsByCode,
      }),
    ),
  )
    .sort((left, right) => right.decision.priority - left.decision.priority || right.scores.action - left.scores.action);

  const attractivenessRanking = [...holdingViews]
    .sort(
      (left, right) =>
        right.attractiveness.overall - left.attractiveness.overall ||
        right.scores.action - left.scores.action,
    )
    .slice(0, 12)
    .map((holding) => ({
      id: holding.id,
      accountKey: holding.accountKey,
      accountLabel: holding.accountLabel,
      code: holding.code,
      name: holding.name,
      category: holding.category,
      decisionLabel: holding.decision.label,
      attractiveness: holding.attractiveness,
      riskFlags: holding.riskFlags,
    }));

  const attractivenessSummary = {
    average: round(
      holdingViews.reduce((sum, holding) => sum + holding.attractiveness.overall, 0) / Math.max(holdingViews.length, 1),
      0,
    ),
    highCount: holdingViews.filter((holding) => holding.attractiveness.overall >= 75).length,
    conditionalCount: holdingViews.filter(
      (holding) => holding.attractiveness.overall >= 62 && holding.attractiveness.overall < 75,
    ).length,
    cautionCount: holdingViews.filter((holding) => holding.attractiveness.overall <= 45).length,
  };

  const actionGroups = {
    immediateBuys: [],
    conditionalBuys: [],
    blockedBuys: [],
    trimOrProtect: [],
    watch: [],
    holds: [],
  };

  for (const card of array(holdingCards.cards)) {
    actionGroups[actionGroupForCard(card)].push(actionItem(card));
  }

  for (const key of Object.keys(actionGroups)) {
    actionGroups[key].sort((left, right) => right.score - left.score);
  }

  const coverage = {
    reports: normalizedCount(normalizedReports),
    stockeasy: normalizedCount(normalizedStockeasy),
    marketvoice: normalizedCount(normalizedMarketvoice),
    technical: normalizedCount(normalizedTechnical) || Number(supplement?.sourceCoverage?.technical ?? 0),
    kisEtf: normalizedCount(normalizedKisEtf) || Number(supplement?.sourceCoverage?.kisEtf ?? 0),
    news: normalizedCount(normalizedNews) || Number(supplement?.sourceCoverage?.news ?? 0),
    fundamentals: array(fundamentalSnapshot?.securities).length,
  };

  const healthChecks = array(systemHealth.checks).map((check) => ({
    key: check.key,
    label: check.label,
    status: check.status,
    detail: compactText(check.detail, 160),
    path: check.path ?? null,
  }));

  const analysisLayers = {
    market: buildMarketLayer(market, stage4, holdingCards),
    themes: buildThemeLayer(supplement),
    sectors: buildSectorLayer(holdingViews, fundamentalSnapshot),
    etfs: buildSecurityLayer(fundamentalSnapshot, holdingViews, "etf"),
    stocks: buildSecurityLayer(fundamentalSnapshot, holdingViews, "stock"),
  };
  const stockeasyPulse = buildStockeasyPulse(stockeasySnapshot, fundamentalSnapshot, holdingViews, stockeasyHistory);
  const decisionBrief = buildDecisionBrief(holdingViews, actionGroups, analysisLayers);
  const sellBrief = buildSellBrief(holdingViews);
  const qwenCoach = buildQwenCoachView(qwenCoachRaw);
  const accountStrategy = buildAccountStrategyView(
    qwenAccountStrategyRaw.value,
    qwenAccountStrategyRaw.artifactPath,
  );
  const stockPulse = buildStockPulseView(stockPulseRaw);
  const rotationWatch = buildRotationWatchView(rotationWatchRaw);

  const payload = {
    meta: {
      date,
      runDate: systemHealth.runDate ?? holdingCards.runDate ?? stage4.runDate ?? args.runDate,
      effectiveMarketDate:
        systemHealth.effectiveMarketDate ?? holdingCards.effectiveMarketDate ?? stage4.effectiveMarketDate ?? date,
      runId: systemHealth.runId ?? holdingCards.runId ?? stage4.runId ?? args.runId ?? null,
      generatedAt: new Date().toISOString(),
      sourceGeneratedAt: {
        systemHealth: systemHealth.generatedAt ?? null,
        holdingCards: holdingCards.generatedAt ?? null,
        decisionFeatures: decisionFeatures.generatedAt ?? null,
        supplement: supplement.generatedAt ?? null,
      },
      version: "dashboard-view.v1.8",
    },
    health: {
      overallStatus: systemHealth.overallStatus ?? "unknown",
      checks: healthChecks,
      warnings: healthChecks.filter((check) => check.status === "warn"),
      blockers: healthChecks.filter((check) => check.status === "error"),
      counts: systemHealth.counts ?? {},
    },
    sourceCoverage: {
      ...coverage,
      activeSources: Object.entries(coverage)
        .filter(([, count]) => Number(count) > 0)
        .map(([source]) => source),
    },
    portfolio: {
      score: round(holdingCards.summary?.portfolioScore ?? stage4.portfolioScore ?? 0, 0),
      regime: holdingCards.summary?.regime ?? stage4.regime?.name ?? null,
      attractiveness: attractivenessSummary,
      accounts: accountViews,
    },
    actionBoard: actionGroups,
    newEvidence: {
      reinforcedThemes: array(supplement.themeSupplements)
        .filter((item) => Number(item.existingSourceSupport ?? 0) > 0)
        .slice(0, 12)
        .map((item) => buildEvidenceItem(item, "theme")),
      reinforcedSecurities: array(supplement.securitySupplements)
        .filter((item) => Number(item.existingSourceSupport ?? 0) > 0)
        .slice(0, 12)
        .map((item) => buildEvidenceItem(item, "security")),
      newWatchCandidates: array(supplement.securitySupplements)
        .filter((item) => Number(item.existingSourceSupport ?? 0) === 0)
        .slice(0, 12)
        .map((item) => buildEvidenceItem(item, "security")),
      conflicts: array(supplement.newSourceConflicts).slice(0, 20).map(buildConflictItem),
    },
    decisionBrief,
    sellBrief,
    qwenCoach,
    accountStrategy,
    stockPulse,
    rotationWatch,
    stockeasyPulse,
    analysisLayers,
    holdings: holdingViews,
    attractivenessRanking,
    themes: array(supplement.themeSupplements).slice(0, 18).map((item) => ({
      id: `theme:${item.theme}`,
      theme: item.theme,
      label: item.label,
      netScore: round(item.netScore, 3),
      sourceCount: item.sourceCount ?? 0,
      support: sourceSupportView(item.support),
      supportSummary: item.supportSummary ?? supportSummary(item.support),
      actionHint: compactText(item.actionHint, 150),
    })),
    conflicts: array(supplement.newSourceConflicts).slice(0, 30).map(buildConflictItem),
    evidenceIndex: buildEvidenceIndex(holdingViews, supplement),
    artifacts: {
      dashboardView: `data/dashboard/${date}-dashboard-view.json`,
      finalHtml: `reports/daily/${date}-final.html`,
      executionPlanTable: `reports/daily/${date}-stage4-execution-plan-table.md`,
      sourceSupplement: `reports/daily/${date}-source-consensus-supplement.md`,
      fundamentals: `data/fundamentals/${date}/security-fundamentals.json`,
      stockeasySnapshot: `data/external/stockeasy/${date}/snapshot.json`,
      qwenCoach: `data/analysis-state/${date}/qwen-cockpit-coach.json`,
      accountStrategy: accountStrategy?.artifact ?? `data/analysis-state/${date}/qwen-account-strategy.json`,
      stockPulse: `data/stock-pulse/${date}/stock-pulse.json`,
      rotationWatch: `data/analysis-state/${date}/rotation-watch.json`,
    },
  };

  const outputPath = args.output
    ? path.resolve(ROOT_DIR, args.output)
    : path.join(ROOT_DIR, "data", "dashboard", `${date}-dashboard-view.json`);
  await writeJson(outputPath, payload);
  await writeJson(path.join(ROOT_DIR, "data", "dashboard", "latest-dashboard-view.json"), payload);

  console.log(`Wrote dashboard view to ${outputPath}`);
  console.log(`holdings=${payload.holdings.length} themes=${payload.themes.length} conflicts=${payload.conflicts.length}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
