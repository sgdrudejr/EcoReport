#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import { loadAnalysisContext } from "./lib/analysis-context.js";
import {
  buildRunMetadata,
  normalizeText,
  parseDateArgs,
  readJson,
  truncate,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import {
  buildShadowPaths,
  logShadowSummary,
  writeMirroredShadowJson,
  writeMirroredShadowText,
} from "./lib/shadow-pipeline.js";

const TOP_TOPIC_LIMIT = 8;
const SECONDARY_TOPIC_LIMIT = 5;
const EXECUTIVE_LINE_LIMIT = 5;
const WATCHPOINT_LIMIT = 6;
const ACTION_LIMIT = 6;
const MACRO_BUCKET_IDS = new Set([
  "geopolitics_regime",
  "rates_policy",
  "credit_liquidity",
  "fx_dollar",
  "oil_energy",
  "inflation_trade_policy",
  "metals_commodities",
]);
const STRUCTURAL_BUCKET_IDS = new Set([
  "power_grid",
  "ai_infra",
  "semiconductors",
  "defense_aerospace",
  "telecom_network",
  "healthcare_biotech",
  "construction_infra",
]);
const CYCLICAL_BUCKET_IDS = new Set([
  "us_equities",
  "korea_equities",
  "global_equities",
  "autos_industrials",
  "consumer_financials",
  "internet_media",
]);

const BUCKET_PRIORITY = {
  direct_holdings: 100,
  geopolitics_regime: 98,
  rates_policy: 96,
  credit_liquidity: 95,
  fx_dollar: 94,
  oil_energy: 93,
  inflation_trade_policy: 92,
  us_equities: 90,
  korea_equities: 88,
  global_equities: 86,
  ai_infra: 85,
  power_grid: 85,
  semiconductors: 84,
  defense_aerospace: 83,
  autos_industrials: 80,
  telecom_network: 78,
  healthcare_biotech: 77,
  consumer_financials: 76,
  metals_commodities: 75,
  internet_media: 74,
  construction_infra: 73,
  other: 10,
};

const BUCKET_ACTION_HINTS = {
  geopolitics_regime: "전쟁·휴전 관련 headline risk가 남아 있어 추격 대응보다 시나리오 점검이 우선입니다.",
  rates_policy: "물가와 금리의 2차 파급을 확인하기 전까지 장기 듀레이션·고밸류 추격은 보수적으로 보는 편이 안전합니다.",
  credit_liquidity: "신용스프레드와 조달 환경이 악화되면 성장 서사가 좋은 종목도 할인율 부담을 받을 수 있습니다.",
  fx_dollar: "원달러 변동성이 다시 커지면 수입원가·해외자산 평가가 동시에 흔들릴 수 있어 환 노출 점검이 필요합니다.",
  oil_energy: "유가 안정 여부가 확인될 때까지 비용 민감 업종은 실적 추정치 변화를 함께 봐야 합니다.",
  inflation_trade_policy: "관세·물가 정책은 업종별 수혜와 피해가 갈리므로 수혜 업종은 선별 강화, 피해 업종은 비용 전가 여부 확인이 필요합니다.",
  us_equities: "미국 지수 노출은 유지하되 금리 민감 구간에서 엔트리 가격은 분할로 보는 편이 낫습니다.",
  korea_equities: "국내 수급은 빠르게 흔들릴 수 있어 베이시스와 외국인 흐름을 함께 보는 게 좋습니다.",
  global_equities: "미국 외 지역은 환율·운임·현지 수요가 같이 작동하므로 단일 뉴스보다 복합 조건을 보는 편이 좋습니다.",
  ai_infra: "AI 인프라는 멀티플 부담이 커서 실적/발주 확인형 접근이 더 안전합니다.",
  power_grid: "전력 인프라는 구조적 수요 축으로 볼 수 있어 조정 시 선별 강화 후보군으로 다룰 만합니다.",
  semiconductors: "반도체는 이익 추정 상향과 밸류 부담이 공존하므로 리비전 지속 여부를 먼저 확인하는 편이 좋습니다.",
  defense_aerospace: "방산은 지정학 수혜와 밸류 부담이 동시에 움직여 수주 가시성 확인이 중요합니다.",
  autos_industrials: "자동차·산업재는 관세·환율·원가가 같이 움직여 Q&A형 조건 문장을 계속 추적해야 합니다.",
  telecom_network: "통신·네트워크는 CAPEX 사이클이 핵심이라 투자 로드맵 확인 전까지는 테마 과열을 경계하는 편이 좋습니다.",
  healthcare_biotech: "헬스케어는 임상·허가·수출 같은 개별 이벤트 비중이 커서 버킷보다 종목별 확인이 우선입니다.",
  consumer_financials: "소비재·금융은 물가·소비심리·조달비용이 같이 움직여 체력 차이가 크게 벌어질 수 있습니다.",
  internet_media: "인터넷·미디어·엔터는 이벤트와 실적 확인 전까지 멀티플 변동성이 큰 구간입니다.",
  construction_infra: "건설·플랜트·재건은 뉴스보다 실제 발주와 수주 가시성이 붙을 때 설명력이 커집니다.",
  metals_commodities: "원자재는 레짐 전환 속도가 빨라 headline보다 추세 유지 조건을 먼저 확인해야 합니다.",
  direct_holdings: "직접 보유 종목은 테마보다 개별 근거를 다시 읽고, 유지 조건과 깨지는 조건을 별도로 체크하는 편이 좋습니다.",
  other: "고정 버킷에 안 들어간 카드가 많아 다음 사이클에서 세부 버킷을 더 나누는 게 좋습니다.",
};

const BUCKET_PRIORITY_ACTION_TEXT = {
  geopolitics_regime: { action_type: "headline_risk", action: "휴전 확인 전 추격은 보류" },
  rates_policy: { action_type: "rates_sensitive", action: "금리 민감 자산은 신중하게" },
  credit_liquidity: { action_type: "credit_check", action: "유동성 둔화 신호 먼저 확인" },
  fx_dollar: { action_type: "fx_check", action: "환 노출부터 점검" },
  oil_energy: { action_type: "cost_pressure", action: "유가 안정 확인 전 비용 민감 업종은 보수적" },
  inflation_trade_policy: { action_type: "policy_split", action: "정책 수혜와 피해를 분리해서 보기" },
  power_grid: { action_type: "accumulate_on_pullback", action: "조정 시 분할 관심" },
  ai_infra: { action_type: "verify_before_add", action: "실적 확인 후 접근" },
  semiconductors: { action_type: "revision_check", action: "이익 상향 지속 여부 먼저 확인" },
  defense_aerospace: { action_type: "orderbook_check", action: "수주 가시성 확인 후 선별" },
  telecom_network: { action_type: "capex_watch", action: "CAPEX 확인 전 과열 추격은 보류" },
  healthcare_biotech: { action_type: "event_driven", action: "버킷보다 개별 이벤트 확인" },
  us_equities: { action_type: "watch_for_entry", action: "좋은 진입 자리 대기" },
  korea_equities: { action_type: "relative_selection", action: "수급 강한 쪽만 선별" },
  global_equities: { action_type: "relative_selection", action: "지역별 강약 구분 우선" },
  autos_industrials: { action_type: "selective_add", action: "실적 버티는 종목만 선별" },
  consumer_financials: { action_type: "selective_add", action: "체력 차이 나는 종목만 선별" },
  internet_media: { action_type: "event_driven", action: "실적·이벤트 확인 후 선별" },
  construction_infra: { action_type: "orderbook_check", action: "수주 확인 전 추격은 보류" },
  direct_holdings: { action_type: "hold_and_verify", action: "보유는 유지, 근거는 다시 확인" },
};

const BUCKET_TOPIC_FRAMES = {
  geopolitics_regime: {
    thesis: "휴전 기대는 risk-on에 우호적이지만, 충격의 잔재가 남아 있어 해석이 쉽게 뒤집힐 수 있습니다.",
    keep: "휴전 지속과 유가·환율 안정",
    risk: "재충돌, 제재 확대, 공급 차질 재발",
  },
  rates_policy: {
    thesis: "물가와 유가가 다시 금리 기대를 흔들 수 있어 듀레이션과 성장주 해석이 예민한 구간입니다.",
    keep: "유가 진정과 2차 물가 파급 제한",
    risk: "유가 재상승과 장기금리 반등",
  },
  credit_liquidity: {
    thesis: "신용과 유동성 환경이 나빠지면 좋은 스토리도 할인율 부담을 바로 받는 구간입니다.",
    keep: "조달 환경 안정과 스프레드 진정",
    risk: "신용스프레드 확대와 차입 부담 상승",
  },
  fx_dollar: {
    thesis: "환율이 진정되면 수입원가와 위험선호가 같이 안정될 수 있는 축입니다.",
    keep: "원달러 안정과 대외 리스크 완화",
    risk: "달러 재강세와 원화 변동성 확대",
  },
  oil_energy: {
    thesis: "유가 방향이 비용 압박과 기대 인플레이션을 함께 흔드는 핵심 변수입니다.",
    keep: "원유 공급 정상화와 유가 안정",
    risk: "유가 재급등과 원가 압박 확대",
  },
  inflation_trade_policy: {
    thesis: "관세와 물가 정책은 업종별 승패를 가르는 구간이라 수혜와 피해를 나눠 봐야 합니다.",
    keep: "비용 전가 가능한 업종 선별",
    risk: "정책 확산으로 마진 압박 확대",
  },
  metals_commodities: {
    thesis: "원자재는 레짐 전환 속도가 빨라 headline보다 추세 유지 조건이 더 중요합니다.",
    keep: "수급 타이트와 가격 지지 유지",
    risk: "경기 둔화와 재고 부담 확대",
  },
  power_grid: {
    thesis: "전력 인프라는 구조적 수요가 살아 있어 조정 시 다시 관심을 받을 수 있는 축입니다.",
    keep: "발주 증가와 수주잔고 유지",
    risk: "수익성 둔화와 정책·관세 부담",
  },
  ai_infra: {
    thesis: "AI 인프라는 장기 스토리가 유효하지만 멀티플 부담 때문에 확인형 접근이 더 낫습니다.",
    keep: "실적과 발주 증가 확인",
    risk: "CAPEX 둔화와 밸류 부담 확대",
  },
  semiconductors: {
    thesis: "반도체는 실적 상향과 밸류 부담이 같이 움직여 리비전의 지속성이 중요합니다.",
    keep: "메모리 가격과 이익 추정 상향 지속",
    risk: "재고 재확대와 CAPEX 둔화",
  },
  defense_aerospace: {
    thesis: "방산은 지정학 수혜 기대가 있지만 결국 수주 가시성이 계속 확인돼야 버팁니다.",
    keep: "수주잔고 확대와 납기 가시성",
    risk: "예산 지연과 밸류 피로",
  },
  telecom_network: {
    thesis: "통신·네트워크는 CAPEX 사이클이 핵심이라 투자 집행 확인 전까지는 과열 추격을 줄여야 합니다.",
    keep: "CAPEX 집행 로드맵과 수요 확인",
    risk: "발주 지연과 고객 투자 축소",
  },
  healthcare_biotech: {
    thesis: "헬스케어는 버킷보다는 임상·허가·수출 같은 개별 이벤트가 판단을 좌우합니다.",
    keep: "허가·수출·실적 이벤트 진전",
    risk: "이벤트 지연과 판가 부담",
  },
  us_equities: {
    thesis: "미국 증시는 지수 방향보다 금리 민감 업종과 대형 성장주의 강약 구분이 더 중요합니다.",
    keep: "장기금리 안정과 실적 확인",
    risk: "금리 재상승과 밸류 조정",
  },
  korea_equities: {
    thesis: "국내 증시는 외국인 수급과 업종 주도력에 따라 체감 강도가 크게 갈리는 구간입니다.",
    keep: "외국인 순매수와 주도 업종 유지",
    risk: "수급 이탈과 실적 하향",
  },
  global_equities: {
    thesis: "미국 외 지역은 지역별 경기와 환율, 비용 차이로 강약이 갈리는 구간입니다.",
    keep: "지역별 수요 회복과 비용 안정",
    risk: "운임·원가 재상승과 수요 둔화",
  },
  autos_industrials: {
    thesis: "자동차·산업재는 관세와 환율, 원가가 동시에 움직여 선별 접근이 필요한 구간입니다.",
    keep: "가격 전가와 수주·판매 유지",
    risk: "관세 확대와 원가 급등",
  },
  consumer_financials: {
    thesis: "소비재·금융은 소비심리와 조달비용 변화에 따라 체력 차이가 빠르게 벌어질 수 있습니다.",
    keep: "소비 회복과 비용 안정",
    risk: "건전성 악화와 소비 둔화",
  },
  internet_media: {
    thesis: "인터넷·미디어·엔터는 이벤트와 실적 확인 전까지 멀티플 변동성이 큰 구간입니다.",
    keep: "콘텐츠 흥행과 실적 회복 확인",
    risk: "광고 둔화와 밸류 재조정",
  },
  construction_infra: {
    thesis: "건설·플랜트·재건은 뉴스보다 실제 발주와 수주 가시성이 붙을 때 설명력이 커집니다.",
    keep: "재건 수요와 해외수주 가시성 확인",
    risk: "발주 지연과 원가 부담 확대",
  },
  direct_holdings: {
    thesis: "직접 보유 종목은 테마보다 개별 근거의 유지 여부를 먼저 다시 읽어야 하는 구간입니다.",
    keep: "실적과 투자 포인트 유지",
    risk: "주장 대비 숫자 약화",
  },
};

const HOLDING_BUCKET_RULES = {
  direct_holdings: { codes: ["047810", "064350", "434730", "449450", "138910", "423160", "360750", "133690", "458760", "251350"] },
  us_equities: { codes: ["360750", "133690", "458760"], namePatterns: [/미국s&p500/i, /나스닥100/i, /다우존스/i] },
  global_equities: { codes: ["251350"], namePatterns: [/선진국/i, /esg/i] },
  rates_policy: { codes: ["423160"], namePatterns: [/kofr/i, /금리/i] },
  fx_dollar: { codes: ["138910"], namePatterns: [/구리선물/i] },
  oil_energy: { codes: ["138910"], namePatterns: [/구리선물/i] },
  metals_commodities: { codes: ["138910"], namePatterns: [/구리선물/i] },
  inflation_trade_policy: { codes: ["423160", "138910"], namePatterns: [/kofr/i, /구리선물/i] },
  power_grid: { codes: ["434730"], namePatterns: [/원자력/i] },
  defense_aerospace: { codes: ["449450", "047810", "064350"], namePatterns: [/방산/i, /항공우주/i, /현대로템/i] },
  autos_industrials: { codes: ["064350"], namePatterns: [/현대로템/i] },
};

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function dedupeStrings(values, limit) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = normalizeText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (typeof limit === "number" && result.length >= limit) break;
  }

  return result;
}

function stripInsightPrefix(text) {
  return cleanText(text)
    .replace(/^[^:]+:\s*/, "")
    .replace(/^지금 읽히는 중심 메시지는\s*/, "")
    .replace(/^이 흐름이 이어지려면\s*/, "")
    .replace(/^반대로\s*/, "")
    .replace(/^같이 부딪히는 반대 논리는\s*/, "")
    .replace(/\s*가 확인돼야 합니다\.?$/, "")
    .replace(/\s*이면 논리가 약해질 수 있습니다\.?$/, "")
    .replace(/\s*입니다\.?$/, "")
    .trim();
}

function sanitizeUiSnippet(value, limit = 84) {
  const text = cleanText(value)
    .replace(/[■□▶◆●▪]/g, " ")
    .replace(/\b(?:Analyst|BUY|SELL|HOLD)\b/gi, " ")
    .replace(/\(\s*유지\s*\)/g, " ")
    .replace(/\b\d{4}\.\d{2}\.\d{2}\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[-,:;.\s]+/, "")
    .trim();

  if (!text) return "";

  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return truncate(sentence, limit);
}

function buildEvidenceNumbers(bucket) {
  return dedupeStrings(
    (bucket.topEvidenceCards ?? []).flatMap((card) => card.key_numbers ?? []),
    3,
  );
}

function buildEvidenceLine(bucket) {
  const titles = dedupeStrings((bucket.topReports ?? []).slice(0, 2), 2);
  const numbers = buildEvidenceNumbers(bucket);
  const titlePart =
    titles.length > 0 ? `대표 근거는 ${titles.join(", ")} 쪽입니다.` : "대표 근거 리포트를 더 쌓아 보면서 해석을 다듬을 수 있습니다.";
  const numberPart = numbers.length > 0 ? ` 눈에 띄는 숫자는 ${numbers.join(", ")} 입니다.` : "";
  return `${titlePart}${numberPart}`.trim();
}

function genericStanceText(stance) {
  if (stance === "constructive") return "좋게 보는 근거가 조금 더 우세합니다.";
  if (stance === "fragile") return "깨지는 조건 확인이 더 중요합니다.";
  if (stance === "two_sided") return "좋아지는 조건과 깨지는 조건이 같이 살아 있습니다.";
  if (stance === "mixed") return "해석이 갈리는 구간입니다.";
  return "아직 탐색형 해석이 더 적절합니다.";
}

function buildTopicNarrative(bucket) {
  const frame = BUCKET_TOPIC_FRAMES[bucket.bucket_id];
  if (frame) {
    return frame;
  }

  return {
    thesis: `${bucket.bucket_label}은 ${cleanText(bucket.description ?? "오늘 시장에서 따로 볼 필요가 있는 축")} 입니다. ${genericStanceText(bucket.stance)}`,
    keep: sanitizeUiSnippet(bucket.keepConditions?.[0], 72) || "핵심 숫자와 주장 유지",
    risk: sanitizeUiSnippet(bucket.breakConditions?.[0] ?? bucket.conflictingClaims?.[0], 72) || "반대 근거 확산",
  };
}

function scoreBucket(bucket) {
  const priority = BUCKET_PRIORITY[bucket.bucket_id] ?? 50;
  const holdingBoost = (bucket.matchedHoldings?.length ?? 0) * 8;
  const signalBoost =
    (bucket.commonClaims?.length ?? 0) * 3 +
    (bucket.keepConditions?.length ?? 0) * 2 +
    (bucket.breakConditions?.length ?? 0) * 2;

  return priority + bucket.cardCount * 4 + bucket.reportCount * 2 + holdingBoost + signalBoost;
}

function classifyBucketStance(bucket) {
  const hasKeep = (bucket.keepConditions?.length ?? 0) > 0;
  const hasBreak = (bucket.breakConditions?.length ?? 0) > 0;
  const hasConflict = (bucket.conflictingClaims?.length ?? 0) > 0;

  if (hasKeep && hasBreak) return "two_sided";
  if (hasBreak && !hasKeep) return "fragile";
  if (hasKeep && !hasBreak) return "constructive";
  if (hasConflict) return "mixed";
  return "watch";
}

function buildRegimeSummary(regime) {
  const name = regime?.name ?? "UNKNOWN";
  const confidence = typeof regime?.confidence === "number" ? Math.round(regime.confidence * 100) : null;
  const market = regime?.market_context ?? {};
  const score = typeof market.score === "number" ? market.score : null;
  const close = typeof market.close === "number" ? market.close.toLocaleString("ko-KR") : null;

  let summary = "시장 레짐 데이터가 제한적이어서 보수적으로 해석하는 편이 좋습니다.";
  if (name === "BULL") {
    summary = `지수 추세는 우상향 쪽이지만, 개별 테마는 금리·유가 변수에 따라 체감 강도가 달라질 수 있습니다.`;
  } else if (name === "BEAR") {
    summary = `추세는 방어적으로 보는 편이 맞고, 구조적 수혜 버킷만 선별하는 접근이 유리합니다.`;
  } else if (name === "SIDEWAYS") {
    summary = `지수보다 주제 선별이 중요한 장세라 버킷별 조건 문장이 특히 중요합니다.`;
  }

  return {
    name,
    confidencePct: confidence,
    marketScore: score,
    close,
    summary,
    signals: regime?.signals ?? [],
  };
}

function normalizeHoldingEntries(portfolio, stage3) {
  const accountByCode = new Map();
  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account?.holdings ?? []) {
      const code = String(holding?.code ?? "").trim();
      if (!code) continue;
      const current = accountByCode.get(code) ?? [];
      current.push({
        accountKey: account.key,
        accountLabel: account.label,
      });
      accountByCode.set(code, current);
    }
  }

  return Object.entries(stage3?.holdings ?? {}).map(([code, item]) => ({
    code,
    name: item?.name ?? code,
    category: item?.category ?? "기타",
    signal: item?.signal ?? "WATCH",
    actionScore: item?.actionScore ?? item?.scores?.actionScore ?? null,
    conviction: item?.conviction ?? "LOW",
    accounts: accountByCode.get(code) ?? [],
  }));
}

function matchHoldingsToBucket(bucket, holdings) {
  const matchedNames = new Set((bucket.matchedHoldings ?? []).map((value) => normalizeText(value)));
  const rule = HOLDING_BUCKET_RULES[bucket.bucket_id] ?? { codes: [], namePatterns: [] };

  return holdings.filter((holding) => {
    if (matchedNames.has(normalizeText(holding.name))) return true;
    if ((rule.codes ?? []).includes(holding.code)) return true;
    return (rule.namePatterns ?? []).some((pattern) => pattern.test(holding.name) || pattern.test(holding.category));
  });
}

function shortSignalLabel(signal) {
  if (signal === "BUY") return "보강";
  if (signal === "HOLD") return "유지";
  if (signal === "SELL") return "축소";
  if (signal === "WATCH") return "관찰";
  return "관찰";
}

function buildTopicLines(bucket, relatedHoldings, actionText) {
  const lines = [];
  const narrative = buildTopicNarrative(bucket);

  lines.push(`지금 해석: ${narrative.thesis}`);
  lines.push(`좋아지려면: ${narrative.keep}`);
  lines.push(`경계 신호: ${narrative.risk}`);
  lines.push(`투자 메모: ${actionText}`);

  if (relatedHoldings.length > 0) {
    const holdingText = relatedHoldings
      .slice(0, 3)
      .map((holding) => `${holding.name}(${shortSignalLabel(holding.signal)})`)
      .join(", ");
    lines.push(`연결 자산: ${holdingText}`);
  }

  lines.push(`근거: ${buildEvidenceLine(bucket)}`);

  return dedupeStrings(lines, 6).slice(0, 6);
}

function buildAccountImplications(stage3Accounts) {
  return Object.values(stage3Accounts ?? {})
    .sort((left, right) => (right.totalScore ?? 0) - (left.totalScore ?? 0))
    .map((account) => ({
      accountKey: account.key,
      label: account.label,
      totalScore: account.totalScore ?? null,
      bias: account.stage2Bias ?? "hold",
      note: cleanText(account.note),
      riskNotes: (account.riskPenalty?.notes ?? []).slice(0, 2),
    }));
}

function classifyTopicPlaybook(topic) {
  if (topic.bucket_id === "direct_holdings") return "holding";
  if (MACRO_BUCKET_IDS.has(topic.bucket_id)) return "macro";
  if (STRUCTURAL_BUCKET_IDS.has(topic.bucket_id)) return "structural";
  if (CYCLICAL_BUCKET_IDS.has(topic.bucket_id)) return "cyclical";
  return "general";
}

function strongestHoldingSignal(topic) {
  const signalRank = { BUY: 4, HOLD: 3, WATCH: 2, SELL: 1 };
  return [...(topic.related_holdings ?? [])]
    .sort((left, right) => (signalRank[right.signal] ?? 0) - (signalRank[left.signal] ?? 0))[0]?.signal;
}

function buildPriorityWhyNow(topic) {
  const core = cleanText(topic.thesis ?? stripInsightPrefix(topic.summary_lines?.[0] ?? ""));
  const keep = cleanText(topic.keep_watch ?? "");
  const risk = cleanText(topic.risk_watch ?? "");

  if (keep && risk) {
    return truncate(`${core} 지금은 ${risk}보다 ${keep} 쪽이 유지되는지 먼저 볼 구간입니다.`, 150);
  }
  if (risk) {
    return truncate(`${core} 다만 ${risk} 신호가 강해지면 해석을 바로 줄여야 합니다.`, 140);
  }
  if (keep) {
    return truncate(`${core} 이어서 보려면 ${keep} 확인이 필요합니다.`, 140);
  }
  return truncate(core, 120);
}

function inferPriorityAction(topic) {
  const playbook = classifyTopicPlaybook(topic);
  const holdingSignal = strongestHoldingSignal(topic);
  const hasLinkedHolding = (topic.related_holdings ?? []).length > 0;

  if (playbook === "holding") {
    if (BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id]) return BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id];
    if (topic.stance === "fragile") {
      return { action_type: "hold_reduce_risk", action: "보유는 유지하되 비중 확대는 보류" };
    }
    if (topic.stance === "constructive") {
      return { action_type: "hold_with_conviction", action: "보유 관점 유지" };
    }
    return { action_type: "hold_and_verify", action: "보유는 유지, 근거는 다시 확인" };
  }

  if (playbook === "macro") {
    if (BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id]) return BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id];
    if (topic.stance === "constructive") {
      return { action_type: "macro_tailwind", action: "우호 흐름 확인 후 관련 자산 선별" };
    }
    if (topic.stance === "fragile") {
      return { action_type: "avoid_chasing", action: "민감 자산 추격은 보류" };
    }
    return { action_type: "macro_confirm", action: "방향 베팅보다 조건 확인 우선" };
  }

  if (playbook === "structural") {
    if (BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id] && topic.stance !== "fragile") {
      return BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id];
    }
    if (topic.stance === "constructive" && (holdingSignal === "BUY" || holdingSignal === "HOLD")) {
      return { action_type: "accumulate_on_pullback", action: "조정 시 분할 관심" };
    }
    if (topic.stance === "constructive") {
      return { action_type: "candidate_watch", action: "후보군으로 유지" };
    }
    if (topic.stance === "fragile") {
      return { action_type: "verify_before_add", action: "실적 확인 전 추가는 신중" };
    }
    return { action_type: "selective_structural", action: "핵심 축은 유효, 추격은 보류" };
  }

  if (playbook === "cyclical") {
    if (BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id] && topic.stance !== "fragile") {
      return BUCKET_PRIORITY_ACTION_TEXT[topic.bucket_id];
    }
    if (topic.stance === "constructive" && hasLinkedHolding) {
      return { action_type: "selective_add", action: "강한 종목만 선별 강화" };
    }
    if (topic.stance === "constructive") {
      return { action_type: "watch_for_entry", action: "좋은 진입 자리 대기" };
    }
    if (topic.stance === "fragile") {
      return { action_type: "avoid_new_entries", action: "신규 진입은 서두르지 않기" };
    }
    return { action_type: "relative_selection", action: "업종 내 강약 구분 우선" };
  }

  if (topic.stance === "constructive") {
    return { action_type: "candidate_watch", action: "관심 버킷으로 유지" };
  }
  if (topic.stance === "fragile") {
    return { action_type: "avoid_chasing", action: "확인 전까지 관찰만 유지" };
  }
  return { action_type: "explore", action: "탐색 유지" };
}

function buildPriorityActions(topTopics, accountImplications) {
  const actions = [];

  for (const topic of topTopics) {
    if (actions.length >= ACTION_LIMIT) break;

    const holdingNames = topic.related_holdings.map((holding) => holding.name);
    const scope =
      holdingNames.length > 0 ? `${topic.bucket_label} / ${holdingNames.join(", ")}` : topic.bucket_label;
    const inferred = inferPriorityAction(topic);

    actions.push({
      scope,
      action_type: inferred.action_type,
      action: inferred.action,
      why_now: buildPriorityWhyNow(topic),
      evidence_bucket: topic.bucket_id,
    });
  }

  for (const account of accountImplications) {
    if (actions.length >= ACTION_LIMIT) break;
    actions.push({
      scope: account.label,
      action_type:
        account.bias === "aggressive_add"
          ? "account_tighten"
          : account.bias === "selective_add"
            ? "account_selective_add"
            : "account_review",
      action:
        account.bias === "aggressive_add"
          ? "공격적 추가보다 검증된 테마로 압축"
          : account.bias === "selective_add"
            ? "선별 보강 기조 유지"
            : "구조 점검 우선",
      why_now: truncate(account.note, 100),
      evidence_bucket: "account",
    });
  }

  return dedupeStrings(actions.map((item) => JSON.stringify(item)))
    .map((value) => JSON.parse(value))
    .slice(0, ACTION_LIMIT);
}

function buildWatchpoints(topTopics, regimeSummary, portfolioSummary) {
  const watchpoints = [
    regimeSummary.summary,
    ...(topTopics
      .filter((topic) => topic.stance === "fragile" || topic.stance === "two_sided")
      .map((topic) => `${topic.bucket_label}: ${truncate(topic.risk_watch ?? topic.summary_lines[2] ?? "", 100)}`)),
    `포트폴리오 총점은 ${portfolioSummary.totalScore ?? "n/a"}점이며, 메모는 "${portfolioSummary.note}" 입니다.`,
  ];

  return dedupeStrings(watchpoints, WATCHPOINT_LIMIT);
}

function buildExecutiveSummary(regimeSummary, topTopics, portfolioSummary, secondaryCount) {
  const highDensityTopics = topTopics
    .filter((topic) => topic.bucket_id !== "other")
    .slice(0, 3)
    .map((topic) => topic.bucket_label);
  const riskBucketIds = new Set([
    "geopolitics_regime",
    "rates_policy",
    "credit_liquidity",
    "fx_dollar",
    "oil_energy",
    "inflation_trade_policy",
  ]);
  const riskTopics = topTopics
    .filter((topic) => riskBucketIds.has(topic.bucket_id))
    .slice(0, 3)
    .map((topic) => topic.bucket_label);

  const lines = [
    `시장 레짐은 ${regimeSummary.name}${regimeSummary.confidencePct ? `(${regimeSummary.confidencePct}%)` : ""}로 읽히며, ${regimeSummary.summary}`,
    highDensityTopics.length > 0 ? `오늘 근거 밀도가 높은 축은 ${highDensityTopics.join(", ")} 입니다.` : null,
    riskTopics.length > 0 ? `같이 봐야 할 리스크 축은 ${riskTopics.join(", ")} 입니다.` : null,
    `포트폴리오 총점은 ${portfolioSummary.totalScore ?? "n/a"}점이고, 현재 메모는 "${portfolioSummary.note}" 입니다.`,
    secondaryCount > 0 ? `이번 shadow에서 주버킷 밖 보조 테마 ${secondaryCount}개도 같이 남겨 두었습니다.` : null,
  ].filter(Boolean);

  return lines.slice(0, EXECUTIVE_LINE_LIMIT);
}

function buildDashboardPreview(regimeSummary, topTopics, portfolioSummary) {
  const headline =
    regimeSummary.name === "BULL"
      ? "지수 추세는 우상향이지만, 실제 알파는 주제 버킷 선별에서 갈리는 구간"
      : regimeSummary.name === "BEAR"
        ? "방어 우위 장세로, 구조적 수요 버킷만 제한적으로 살아남는 구간"
        : "방향성보다 논리 축 선별이 중요한 장세";

  const subhead = `상위 버킷은 ${topTopics.slice(0, 4).map((topic) => topic.bucket_label).join(", ")} 이고, 포트폴리오 총점은 ${portfolioSummary.totalScore ?? "n/a"}점입니다.`;

  const bullets = dedupeStrings(
    topTopics.slice(0, 4).map((topic) => `${topic.bucket_label}: ${truncate(topic.decision_note ?? topic.thesis ?? topic.summary_lines[0] ?? "", 100)}`),
    4,
  );

  return { headline, subhead, bullets };
}

function buildMarkdown(payload) {
  const lines = [
    `# Stage 3 Shadow Final Insights (${payload.date})`,
    "",
    `- 시장 레짐: ${payload.market_regime.name}${payload.market_regime.confidencePct ? ` (${payload.market_regime.confidencePct}%)` : ""}`,
    `- 포트폴리오 총점: ${payload.portfolio_summary.totalScore ?? "n/a"}`,
    `- 상위 버킷: ${payload.top_topics.map((topic) => topic.bucket_label).join(", ")}`,
    "",
    "## Executive Summary",
    ...payload.executive_summary.map((line) => `- ${line}`),
    "",
    "## Top Topics",
  ];

  for (const topic of payload.top_topics) {
    lines.push(`### ${topic.bucket_label}`);
    lines.push(`- 지금 해석: ${topic.thesis}`);
    lines.push(`- 좋아지려면: ${topic.keep_watch}`);
    lines.push(`- 경계 신호: ${topic.risk_watch}`);
    lines.push(`- 투자 메모: ${topic.decision_note}`);
    lines.push(`- 근거: ${topic.evidence_note}`);
    if (topic.related_holdings?.length) {
      lines.push(`- 연결 자산: ${topic.related_holdings.map((holding) => holding.name).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Portfolio Implications");
  for (const item of payload.portfolio_implications) {
    lines.push(`- ${item.label}: ${item.totalScore ?? "n/a"}점, bias=${item.bias}, ${item.note}`);
  }
  lines.push("");
  lines.push("## Priority Actions");
  for (const item of payload.priority_actions) {
    lines.push(`- ${item.scope}: ${item.action} — ${item.why_now}`);
  }
  lines.push("");
  lines.push("## Watchpoints");
  for (const item of payload.watchpoints) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Dashboard Preview");
  lines.push(`- 헤드라인: ${payload.dashboard_preview.headline}`);
  lines.push(`- 서브헤드: ${payload.dashboard_preview.subhead}`);
  for (const item of payload.dashboard_preview.bullets) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const context = await loadAnalysisContext(args, {
    portfolio: true,
    stage3: true,
  });
  const { paths, data } = context;
  const shadowPaths = buildShadowPaths(paths.rootDir, args.date);

  const bucketsPath = path.join(paths.analysisDir, "stage2-shadow-topic-buckets.json");
  const outputJsonPath =
    args.output ?? path.join(paths.analysisDir, "stage3-shadow-final-insights.json");
  const outputMarkdownPath =
    args.markdown ?? path.join(paths.analysisDir, "stage3-shadow-final-insights.md");
  const canonicalJsonPath = path.join(shadowPaths.stage3Dir, "stage3-shadow-final-insights.json");
  const canonicalMarkdownPath = path.join(shadowPaths.stage3Dir, "stage3-shadow-final-insights.md");

  const bucketsPayload = await readJson(bucketsPath, null);
  if (!bucketsPayload?.buckets?.length) {
    throw new Error(`Stage 2 shadow bucket 입력이 없습니다: ${bucketsPath}`);
  }

  const holdings = normalizeHoldingEntries(data.portfolio, data.stage3);
  const rankedBuckets = bucketsPayload.buckets
    .map((bucket) => ({
      ...bucket,
      bucketScore: scoreBucket(bucket),
      stance: classifyBucketStance(bucket),
      relatedHoldings: matchHoldingsToBucket(bucket, holdings),
    }))
    .sort((left, right) => right.bucketScore - left.bucketScore);

  const topTopics = rankedBuckets
    .filter((bucket) => bucket.bucket_id !== "other")
    .slice(0, TOP_TOPIC_LIMIT)
    .map((bucket) => {
      const protoTopic = {
        bucket_id: bucket.bucket_id,
        stance: bucket.stance,
        related_holdings: bucket.relatedHoldings,
      };
      const inferredAction = inferPriorityAction(protoTopic);
      const narrative = buildTopicNarrative(bucket);
      const evidenceNote = buildEvidenceLine(bucket);
      const topic = {
        bucket_id: bucket.bucket_id,
        bucket_label: bucket.bucket_label,
        description: bucket.description,
        stance: bucket.stance,
        report_count: bucket.reportCount,
        card_count: bucket.cardCount,
        bucket_score: bucket.bucketScore,
        related_holdings: bucket.relatedHoldings,
        thesis: narrative.thesis,
        keep_watch: narrative.keep,
        risk_watch: narrative.risk,
        decision_note: inferredAction.action,
        evidence_note: evidenceNote,
        source_reports: bucket.topReports ?? [],
      };

      return {
        ...topic,
        summary_lines: buildTopicLines(bucket, bucket.relatedHoldings, inferredAction.action),
      };
    });

  const secondaryTopics = rankedBuckets
    .filter((bucket) => bucket.bucket_id === "other" || !topTopics.some((topic) => topic.bucket_id === bucket.bucket_id))
    .slice(0, SECONDARY_TOPIC_LIMIT)
    .map((bucket) => ({
      bucket_id: bucket.bucket_id,
      bucket_label: bucket.bucket_label,
      card_count: bucket.cardCount,
      report_count: bucket.reportCount,
    }));

  const marketRegime = buildRegimeSummary(data.stage3?.regime ?? {});
  const portfolioSummary = {
    totalScore: data.stage3?.portfolio?.totalScore ?? null,
    note: cleanText(data.stage3?.portfolio?.note),
    accountCount: (data.portfolio?.accounts ?? []).length,
    holdingCount: holdings.length,
  };
  const portfolioImplications = buildAccountImplications(data.stage3?.accounts ?? {});
  const executiveSummary = buildExecutiveSummary(
    marketRegime,
    topTopics,
    portfolioSummary,
    secondaryTopics.length,
  );
  const priorityActions = buildPriorityActions(topTopics, portfolioImplications);
  const watchpoints = buildWatchpoints(topTopics, marketRegime, portfolioSummary);
  const dashboardPreview = buildDashboardPreview(marketRegime, topTopics, portfolioSummary);

  const payload = {
    ...buildRunMetadata(args),
    source: "stage2-shadow+stage3-quant",
    market_regime: marketRegime,
    portfolio_summary: portfolioSummary,
    executive_summary: executiveSummary,
    top_topics: topTopics,
    secondary_topics: secondaryTopics,
    portfolio_implications: portfolioImplications,
    priority_actions: priorityActions,
    watchpoints,
    dashboard_preview: dashboardPreview,
  };

  await writeMirroredShadowJson({
    legacyPath: outputJsonPath,
    canonicalPath: canonicalJsonPath,
    payload,
  });
  await writeMirroredShadowText({
    legacyPath: outputMarkdownPath,
    canonicalPath: canonicalMarkdownPath,
    payload: `${buildMarkdown(payload)}\n`,
  });

  logShadowSummary("stage3-shadow", [
    `top_topics=${payload.top_topics.length} secondary=${payload.secondary_topics.length} accounts=${payload.portfolio_implications.length}`,
    `regime=${payload.market_regime.name} portfolio_score=${payload.portfolio_summary.totalScore ?? "n/a"}`,
    `output=${path.relative(paths.rootDir, outputJsonPath)}`,
    `canonical=${path.relative(paths.rootDir, canonicalJsonPath)}`,
  ]);
}

main().catch((error) => {
  console.error(`stage3 shadow final insights 생성 실패: ${error.message}`);
  process.exit(1);
});
