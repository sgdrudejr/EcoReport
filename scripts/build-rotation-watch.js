#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  categoryForHolding,
  parseDateArgs,
  readJson,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

function dateMs(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function parseExtraArgs(argv) {
  const options = {
    lookbackDays: 21,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--lookback-days" && argv[index + 1]) {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) options.lookbackDays = Math.round(value);
      index += 1;
    }
  }
  return options;
}

async function listAnalysisDates(date, lookbackDays) {
  const analysisRoot = path.join(ROOT_DIR, "data", "analysis-state");
  const target = dateMs(date);
  if (target === null) return [];
  let entries = [];
  try {
    entries = await fs.readdir(analysisRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((entryDate) => {
      const current = dateMs(entryDate);
      if (current === null) return false;
      return current <= target && target - current <= lookbackDays * DAY_MS;
    })
    .sort();
}

function directionScore(direction) {
  const text = String(direction ?? "").toLowerCase();
  if (/trim|reduce|축소|감량|보호/.test(text)) return -2;
  if (/buy|reinforce|강화|확대|add/.test(text)) return 2;
  if (/hold|유지/.test(text)) return 0.6;
  if (/watch|관찰|대기/.test(text)) return 0.3;
  return 0;
}

function stanceToDirection(stance) {
  const text = String(stance ?? "").toLowerCase();
  if (/trim|reduce|sell|축소|감량/.test(text)) return "reduce";
  if (/buy|add|매수|강화/.test(text)) return "reinforce";
  if (/hold|유지/.test(text)) return "hold";
  return "watch";
}

function directionLabel(direction) {
  const score = directionScore(direction);
  if (score <= -1.5) return "감량";
  if (score >= 1.5) return "강화";
  if (score > 0) return "관찰";
  return "중립";
}

function toneForStatus(status) {
  if (/신규|강화|회복/.test(status)) return "green";
  if (/감량|약화|하락|위험/.test(status)) return "red";
  if (/과열|대기|보류/.test(status)) return "amber";
  return "slate";
}

function normalizedKoreanText(value) {
  return String(value ?? "")
    .replace(/THEME::/gi, "")
    .replace(/[\s_\-+/·()]+/g, "")
    .toLowerCase();
}

function normalizedSearchText(value) {
  return String(value ?? "")
    .replace(/THEME::/gi, "")
    .replace(/[\s_\-+/·()]+/g, "")
    .toLowerCase();
}

function textMatchesTerm(text, term) {
  const left = normalizedSearchText(text);
  const right = normalizedSearchText(term);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function classifyThemeSignal(rawTheme) {
  const raw = compactText(rawTheme, 80);
  const normalized = normalizedKoreanText(raw);

  if (!raw) {
    return {
      key: "unknown",
      theme: "미분류",
      sector: "미분류",
      subTheme: "확인필요",
      layer: "미분류",
      definition: "원천 데이터의 테마명이 비어 있어 분류 보강이 필요합니다.",
    };
  }

  if (/ai.*전력|전력.*ai|전력인프라|전력핵심|데이터센터.*전력|변압기|전력기기|현대일렉트릭|ls일렉트릭/.test(normalized)) {
    return {
      key: "sector:power-infra/theme:ai-power",
      theme: "AI 전력인프라",
      sector: "전력기기/인프라",
      subTheme: "데이터센터 전력",
      layer: "테마",
      definition: "AI 데이터센터가 늘면서 전력망, 변압기, 전력설비 수요가 커지는 테마입니다. 반도체 섹터와는 다른 인프라 축입니다.",
    };
  }

  if (/ai반도체|ai.*semiconductor|hbm|npu|gpu|첨단패키징|aceai반도체|top3|sk하이닉스/.test(normalized)) {
    return {
      key: "sector:semiconductor/theme:ai-semiconductor",
      theme: "AI반도체/HBM",
      sector: "반도체",
      subTheme: "AI반도체",
      layer: "하위테마",
      definition: "반도체 대분류 안에서 AI 서버, HBM, GPU/NPU, 첨단 패키징 수요에 직접 노출된 하위 테마입니다.",
    };
  }

  if (/반도체|삼성전자|전공정|후공정|파운드리|메모리/.test(normalized)) {
    return {
      key: "sector:semiconductor/theme:broad-semiconductor",
      theme: "일반 반도체",
      sector: "반도체",
      subTheme: "메모리/장비/공정",
      layer: "섹터",
      definition: "메모리, 파운드리, 전공정/후공정 장비까지 포함하는 넓은 반도체 섹터입니다.",
    };
  }

  if (/방산|한화에어로|현대로템|국방|원자력|원전|smr/.test(normalized)) {
    return {
      key: "sector:defense-nuclear/theme:defense-nuclear",
      theme: "방산·원자력",
      sector: "방산/원전",
      subTheme: "방산 수출·SMR",
      layer: "복합테마",
      definition: "방산 수출, 지정학 리스크, 원전/SMR 수주 기대가 함께 움직이는 복합 테마입니다.",
    };
  }

  if (/금|골드|gold|krx금|헤지|안전자산/.test(normalized)) {
    return {
      key: "sector:safe-asset/theme:gold",
      theme: "금 헤지",
      sector: "원자재/안전자산",
      subTheme: "금",
      layer: "자산군",
      definition: "유가, 환율, 지정학 리스크가 커질 때 포트폴리오 변동성을 낮추는 안전자산 축입니다.",
    };
  }

  if (/구리|copper|commodity/.test(normalized)) {
    return {
      key: "sector:commodity/theme:copper",
      theme: "구리 원자재",
      sector: "원자재/구리",
      subTheme: "전력망·전기화",
      layer: "자산군",
      definition: "전력망, 전기차, 데이터센터 증설에 필요한 구리 수요를 보는 원자재 테마입니다.",
    };
  }

  if (/나스닥|nasdaq|기술주|성장주/.test(normalized)) {
    return {
      key: "sector:us-index/theme:nasdaq-growth",
      theme: "미국 나스닥 성장",
      sector: "미국지수",
      subTheme: "나스닥/기술성장",
      layer: "지수",
      definition: "미국 대형 기술주와 성장주 위험선호를 대표하는 지수 축입니다.",
    };
  }

  if (/s&p|sp500|snp500|미국코어|미국s&p500|tiger미국/.test(normalized)) {
    return {
      key: "sector:us-index/theme:sp500-core",
      theme: "미국 코어 지수",
      sector: "미국지수",
      subTheme: "S&P500",
      layer: "지수",
      definition: "미국 대형주 전반에 분산 노출되는 코어 지수 축입니다.",
    };
  }

  if (/kodex200|코스피|코리아|밸류업|국내지수|국내인덱스/.test(normalized)) {
    return {
      key: "sector:korea-index/theme:korea-index",
      theme: "국내 코어 지수",
      sector: "국내지수",
      subTheme: "KOSPI/밸류업",
      layer: "지수",
      definition: "국내 대형주와 밸류업 지수를 포함하는 코어 국내지수 축입니다.",
    };
  }

  if (/ess|로봇|산업기계/.test(normalized)) {
    return {
      key: "sector:ess-robotics/theme:ess-robotics",
      theme: "ESS·로봇",
      sector: "ESS/로봇",
      subTheme: "저장장치·로봇 밸류체인",
      layer: "테마",
      definition: "에너지저장장치와 로봇 밸류체인 진입 기대를 함께 보는 산업 테마입니다.",
    };
  }

  if (/조선|엔진|선박/.test(normalized)) {
    return {
      key: "sector:shipbuilding/theme:shipbuilding-engine",
      theme: "조선·엔진",
      sector: "조선/기계",
      subTheme: "조선·엔진 수혜",
      layer: "섹터",
      definition: "선박 발주, 엔진, 기자재 수요를 함께 보는 산업재 섹터입니다.",
    };
  }

  if (/ev|전기차|자동차|소재부품/.test(normalized)) {
    return {
      key: "sector:ev-auto/theme:ev-materials",
      theme: "EV 소재부품",
      sector: "자동차/소재",
      subTheme: "전기차 소재부품",
      layer: "테마",
      definition: "전기차, 부품, 소재 밸류체인의 회복 여부를 보는 테마입니다.",
    };
  }

  if (/텔레콤|통신|skt|sk텔레콤/.test(normalized)) {
    return {
      key: "sector:telecom/theme:telecom-income",
      theme: "통신·배당",
      sector: "통신/방어",
      subTheme: "통신·현금흐름",
      layer: "방어섹터",
      definition: "통신사의 배당, 현금흐름, 방어주 성격을 보는 섹터입니다.",
    };
  }

  if (/신재생|태양광|풍력|재생에너지/.test(normalized)) {
    return {
      key: "sector:renewable/theme:renewable-energy",
      theme: "신재생에너지",
      sector: "신재생에너지",
      subTheme: "태양광/풍력/전력전환",
      layer: "섹터",
      definition: "정책, 금리, 전력 수요 변화에 민감한 에너지 전환 섹터입니다.",
    };
  }

  if (/화장품|뷰티|미용|스킨부스터|의료미용|医美/.test(raw) || /화장품|뷰티|미용|스킨부스터|의료미용/.test(normalized)) {
    return {
      key: "sector:beauty/theme:k-beauty-medical",
      theme: "K뷰티·미용의료",
      sector: "화장품/미용",
      subTheme: "스킨부스터·미용의료",
      layer: "소비테마",
      definition: "화장품, 미용의료, 스킨부스터 수출과 내수 회복을 함께 보는 소비 테마입니다.",
    };
  }

  if (/글로벌성장|글로벌지수|지수편입/.test(normalized)) {
    return {
      key: "sector:global-index/theme:global-growth",
      theme: "글로벌 성장",
      sector: "글로벌지수",
      subTheme: "글로벌 성장/지수편입",
      layer: "지수",
      definition: "글로벌 성장주와 지수 편입 이벤트를 함께 보는 분산 성장 축입니다.",
    };
  }

  if (/배당|커버드콜|인컴|dividend|income/.test(normalized)) {
    return {
      key: "sector:income/theme:dividend-covered-call",
      theme: "배당·커버드콜",
      sector: "인컴/방어",
      subTheme: "배당·옵션프리미엄",
      layer: "자산군",
      definition: "변동성 장에서 현금흐름과 방어 역할을 기대하는 인컴형 자산군입니다.",
    };
  }

  return {
    key: `raw:${normalized || raw}`,
    theme: raw,
    sector: "기타",
    subTheme: raw,
    layer: "테마",
    definition: "아직 명시적 분류 규칙이 없어 원천 테마명 그대로 추적합니다.",
  };
}

function buildConceptGuide() {
  return [
    {
      term: "반도체",
      layer: "대분류 섹터",
      meaning: "메모리, 파운드리, 장비, 소재, 전공정/후공정을 모두 포함하는 넓은 산업 분류입니다.",
      examples: ["SOL 반도체전공정", "삼성전자", "반도체 장비"],
    },
    {
      term: "AI반도체",
      layer: "하위 테마",
      meaning: "AI 서버 수요와 직접 연결되는 HBM, GPU/NPU, 첨단 패키징, 고성능 메모리 중심의 하위 테마입니다.",
      examples: ["ACE AI반도체TOP3+", "HBM", "SK하이닉스"],
    },
    {
      term: "AI 전력인프라",
      layer: "인접 수혜 테마",
      meaning: "AI 데이터센터가 전기를 많이 쓰면서 변압기, 전력망, 전력설비가 수혜를 받는 테마입니다. AI반도체와는 다른 섹터입니다.",
      examples: ["KODEX AI전력핵심설비", "전력기기", "변압기"],
    },
  ];
}

function sectorStockeasyAliases(sector) {
  const aliases = {
    "방산/원전": ["방산", "SMR", "소형모듈원자로", "우주항공", "UAM", "원자력"],
    "전력기기/인프라": ["전력기기", "전력/태양광/ESS", "통신사/데이터", "전력", "ESS"],
    반도체: ["반도체", "반도체전공정", "반도체후공정", "메가테크"],
    "원자재/안전자산": ["철강/금속", "금", "원자재", "에너지"],
    "원자재/구리": ["철강/금속", "구리", "금속"],
    "미국지수": ["메가테크", "모멘텀", "외인수급"],
    국내지수: ["코스피", "코스닥", "외인수급", "모멘텀"],
    "ESS/로봇": ["로봇", "전력/태양광/ESS", "기계"],
    "인컴/방어": ["보험", "은행", "통신사/데이터", "금융"],
    신재생에너지: ["전력/태양광/ESS", "에너지", "태양광"],
    "화장품/미용": ["화장품", "의료기기", "헬스케어"],
    "조선/기계": ["조선", "운송", "기계"],
    "자동차/소재": ["자동차", "자동차소부장", "2차전지", "2차전지소부장"],
    "통신/방어": ["통신사/데이터"],
    글로벌지수: ["메가테크", "모멘텀", "외인수급"],
  };
  return [sector, ...(aliases[sector] ?? [])].filter(Boolean);
}

function parseLeaderLabel(label) {
  const text = String(label ?? "");
  const matches = [...text.matchAll(/([^()\s][^()]*?)\((\d+(?:\.\d+)?)\)/g)];
  return matches
    .map((match) => ({
      name: compactText(match[1], 40),
      score: numberOrNull(match[2]),
    }))
    .filter((item) => item.name)
    .slice(0, 8);
}

function candidateNameMap(stage2) {
  const map = new Map();
  for (const candidate of array(stage2?.candidate_scores)) {
    if (candidate.code) map.set(candidate.code, candidate.name ?? candidate.code);
  }
  return map;
}

async function readDailyRecord(date) {
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);
  const featuresDir = path.join(ROOT_DIR, "data", "features", date);
  const [stage2, stage4, briefingDelta, stockPulse, dashboardView, decisionFeatures, sourceConsensusSupplement, sourceDivergence, externalNews, technicalSnapshot, rssNews] = await Promise.all([
    readJson(path.join(analysisDir, "stage2-strategy-options.json"), null),
    readJson(path.join(analysisDir, "stage4-execution-plan.json"), null),
    readJson(path.join(analysisDir, "briefing-delta.json"), null),
    readJson(path.join(ROOT_DIR, "data", "stock-pulse", date, "stock-pulse.json"), null),
    readJson(path.join(ROOT_DIR, "data", "dashboard", `${date}-dashboard-view.json`), null),
    readJson(path.join(featuresDir, "decision-features.json"), null),
    readJson(path.join(featuresDir, "source-consensus-supplement.json"), null),
    readJson(path.join(featuresDir, "source-divergence.json"), null),
    readJson(path.join(analysisDir, "off-report-external-news.json"), null),
    readJson(path.join(ROOT_DIR, "data", "technical", `${date}.json`), null),
    readJson(path.join(ROOT_DIR, "data", "news", `${date}.json`), []),
  ]);

  const regime = stage4?.regime ?? {};
  const marketContext = regime.market_context ?? {};
  const stage2Macro = stage2?.macro_view ?? {};
  const candidates = candidateNameMap(stage2);
  const accountActions = array(stage2?.account_actions);

  return {
    date,
    stage2,
    stage4,
    briefingDelta,
    stockPulse,
    dashboardView,
    regimeName: regime.name ?? stage2Macro.regime ?? null,
    regimeConfidence: numberOrNull(regime.confidence),
    portfolioScore: numberOrNull(stage4?.portfolioScore ?? dashboardView?.portfolio?.score),
    marketRsi: numberOrNull(marketContext.rsi),
    marketScore: numberOrNull(marketContext.score),
    marketAlerts: array(marketContext.alerts),
    emergencyDefense: Boolean(stage4?.emergencyDefense?.enabled),
    strategyChanges: array(stage2?.strategy_changes),
    candidateScores: array(stage2?.candidate_scores),
    portfolioRisks: array(stage2?.portfolio_risks),
    accountActions,
    accountPlans: array(stage4?.accountPlans),
    stockPulseCounts: stockPulse?.counts ?? {},
    stockPulseItems: array(stockPulse?.items),
    candidateNameByCode: candidates,
    decisionFeatures,
    sourceConsensusSupplement,
    sourceDivergence,
    externalNews,
    technicalSnapshot,
    rssNews,
  };
}

async function loadRecords(dates) {
  const records = [];
  for (const date of dates) {
    const record = await readDailyRecord(date);
    if (record.stage2 || record.stage4 || record.dashboardView) records.push(record);
  }
  return records;
}

async function loadStockeasyHistory(date, lookbackDays) {
  const root = path.join(ROOT_DIR, "data", "external", "stockeasy");
  const target = dateMs(date);
  if (target === null) return [];
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const dates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((entryDate) => {
      const current = dateMs(entryDate);
      if (current === null) return false;
      return current <= target && target - current <= lookbackDays * DAY_MS;
    })
    .sort();

  const history = [];
  for (const entryDate of dates) {
    const snapshot = await readJson(path.join(root, entryDate, "snapshot.json"), null);
    if (snapshot) history.push({ date: entryDate, snapshot });
  }
  return history;
}

function stockeasyRows(snapshot) {
  return [
    ...array(snapshot?.marketAnalysis?.sectors?.rows).map((row) => ({ ...row, sourcePanel: "sector" })),
    ...array(snapshot?.marketAnalysis?.leadingSectors?.rows).map((row) => ({ ...row, sourcePanel: "leading" })),
  ];
}

function stockeasyRsRows(snapshot) {
  return array(snapshot?.stockAnalysis?.sectorRs);
}

function stockeasySectorPoint(entry, sector) {
  const aliases = sectorStockeasyAliases(sector);
  const rows = stockeasyRows(entry?.snapshot);
  const rsRows = stockeasyRsRows(entry?.snapshot);
  const candidates = rows.filter((row) => aliases.some((alias) => textMatchesTerm(row.sector, alias)));
  if (!candidates.length) return null;

  const bestRow = candidates
    .map((row) => ({
      row,
      signal: numberOrNull(row.signal),
      changePct: numberOrNull(row.changePct),
      holdDays: numberOrNull(row.holdDays ?? String(row.position ?? "").match(/\d+/)?.[0]),
      gapPct: numberOrNull(row.gapPct),
    }))
    .sort(
      (left, right) =>
        Number(right.signal ?? 0) + Math.abs(Number(right.changePct ?? 0)) * 1.5 + Number(right.gapPct ?? 0) * 0.1 -
        (Number(left.signal ?? 0) + Math.abs(Number(left.changePct ?? 0)) * 1.5 + Number(left.gapPct ?? 0) * 0.1),
    )[0];

  const rs = rsRows.find((row) => aliases.some((alias) => textMatchesTerm(row.sector, alias))) ?? null;
  return {
    date: entry.date,
    sourceTradingDate: entry.snapshot?.sourceTradingDate ?? entry.snapshot?.captureDate ?? entry.date,
    sourceTradingDateLabel: entry.snapshot?.sourceTradingDateLabel ?? null,
    sector: bestRow.row.sector,
    sourcePanel: bestRow.row.sourcePanel,
    signal: round(bestRow.signal, 1),
    changePct: round(bestRow.changePct, 2),
    holdDays: bestRow.holdDays,
    gapPct: round(bestRow.gapPct, 2),
    rsSector: rs?.sector ?? null,
    rsScore: numberOrNull(rs?.score),
    rsRank: numberOrNull(rs?.rank),
    leaders: parseLeaderLabel(bestRow.row.leaderLabel),
  };
}

function buildStockeasySectorRead(sector, stockeasyHistory) {
  const points = array(stockeasyHistory)
    .map((entry) => stockeasySectorPoint(entry, sector))
    .filter(Boolean);
  if (!points.length) {
    return {
      available: false,
      label: "자료없음",
      detail: "해당 섹터와 직접 매칭되는 StockEasy 섹터 신호가 없습니다.",
      points: [],
    };
  }

  const latest = points.at(-1);
  const previous = points.length >= 2 ? points.at(-2) : null;
  const first = points[0];
  const signalDelta = latest.signal !== null && first.signal !== null ? round(latest.signal - first.signal, 1) : null;
  const changeDelta = latest.changePct !== null && first.changePct !== null ? round(latest.changePct - first.changePct, 2) : null;
  const rsStrong = Number(latest.rsScore ?? 0) >= 80;
  const positive = Number(latest.changePct ?? 0) > 0 || Number(signalDelta ?? 0) > 2 || rsStrong;
  const weakening = Number(signalDelta ?? 0) < -4 || (previous && Number(latest.changePct ?? 0) < Number(previous.changePct ?? 0) - 2);
  const label = weakening ? "둔화의심" : positive ? "상승근거" : "중립";

  return {
    available: true,
    label,
    detail: `${latest.sector} / 등락 ${latest.changePct ?? "-"}% / RS ${latest.rsScore ?? "-"} / 신호변화 ${signalDelta ?? "-"}`,
    latest,
    signalDelta,
    changeDelta,
    points: points.slice(-6),
  };
}

function buildStockeasyUniverse(stockeasyHistory) {
  const latest = array(stockeasyHistory).at(-1);
  if (!latest?.snapshot) return [];
  const rsRows = stockeasyRsRows(latest.snapshot);
  const bySector = new Map();
  for (const row of stockeasyRows(latest.snapshot)) {
    const sector = compactText(row.sector, 60);
    if (!sector) continue;
    const existing = bySector.get(sector) ?? {
      sector,
      changePct: null,
      signal: null,
      holdDays: null,
      gapPct: null,
      sourcePanels: new Set(),
      leaders: [],
    };
    existing.changePct = numberOrNull(row.changePct) ?? existing.changePct;
    existing.signal = Math.max(Number(existing.signal ?? 0), Number(row.signal ?? 0));
    existing.holdDays = numberOrNull(row.holdDays ?? String(row.position ?? "").match(/\d+/)?.[0]) ?? existing.holdDays;
    existing.gapPct = numberOrNull(row.gapPct) ?? existing.gapPct;
    existing.sourcePanels.add(row.sourcePanel);
    existing.leaders.push(...parseLeaderLabel(row.leaderLabel));
    bySector.set(sector, existing);
  }
  return [...bySector.values()]
    .map((item) => {
      const rs = rsRows.find((row) => textMatchesTerm(row.sector, item.sector));
      return {
        sector: item.sector,
        signal: round(item.signal, 1),
        changePct: round(item.changePct, 2),
        holdDays: item.holdDays,
        gapPct: round(item.gapPct, 2),
        rsScore: numberOrNull(rs?.score),
        rsRank: numberOrNull(rs?.rank),
        leaders: item.leaders.slice(0, 5),
        sourcePanels: [...item.sourcePanels],
      };
    })
    .sort(
      (left, right) =>
        Number(right.rsScore ?? 0) + Number(right.signal ?? 0) * 0.8 + Number(right.changePct ?? 0) -
        (Number(left.rsScore ?? 0) + Number(left.signal ?? 0) * 0.8 + Number(left.changePct ?? 0)),
    )
    .slice(0, 24);
}

function extractRiskTriggers(record) {
  const lines = [
    ...array(record?.briefingDelta?.diff?.added),
    ...array(record?.portfolioRisks),
    ...array(record?.stage2?.macro_view?.summary ? [record.stage2.macro_view.summary] : []),
  ];
  const patterns = [
    /WTI[^,.。]*|\$ ?\d{2,3}[^,.。]*(?:유가|돌파|박스권)?/gi,
    /유가[^,.。]*(?:\$?\d{2,3}|급등|돌파|스태그플레이션)/gi,
    /달러-원[^,.。]*|환율[^,.。]*(?:1,?500|급등|이탈)/gi,
    /10 ?년물[^,.。]*|금리[^,.。]*(?:4\.8|상향|급등|지연)/gi,
    /엔 ?캐리[^,.。]*|VIX[^,.。]*|스태그플레이션[^,.。]*/gi,
  ];
  const hits = [];
  for (const line of lines) {
    const text = String(line ?? "");
    for (const pattern of patterns) {
      const matches = text.match(pattern) ?? [];
      hits.push(...matches.map((item) => compactText(item, 90)));
    }
  }
  return [...new Set(hits)].slice(0, 10);
}

function buildMarketTrend(records) {
  const first = records[0] ?? {};
  const latest = records.at(-1) ?? {};
  const previous = records.at(-2) ?? first;
  const scores = records.map((record) => record.portfolioScore).filter((value) => value !== null);
  const scoreDelta = scores.length >= 2 ? round(scores.at(-1) - scores[0], 1) : null;
  const currentRsi = latest.marketRsi;
  const overheatDays = records.filter((record) => Number(record.marketRsi ?? 0) >= 75).length;
  const alertText = array(latest.marketAlerts).join(" ");
  const currentOverheated = Number(currentRsi ?? 0) >= 75 || /과매수|상단/.test(alertText);
  const riskTriggers = extractRiskTriggers(latest);
  const emergencyDays = records.filter((record) => record.emergencyDefense).length;

  let mode = "중립관찰";
  if (latest.emergencyDefense || emergencyDays > 0) mode = "하락경계";
  else if (currentOverheated && riskTriggers.length >= 2) mode = "과열상승";
  else if (currentOverheated) mode = "상승과열";
  else if (String(latest.regimeName ?? "").includes("SIDEWAYS")) mode = "횡보전환";
  else if (String(latest.regimeName ?? "").includes("BULL")) mode = "상승유지";

  const previousRegime = previous.regimeName ?? first.regimeName ?? null;
  const regimeChanged = previousRegime && latest.regimeName && previousRegime !== latest.regimeName;
  const headline =
    mode === "과열상승" || mode === "상승과열"
      ? "상승장은 유지되지만 과열과 매크로 트리거가 커져 추격보다 보호·로테이션 감시가 우선입니다."
      : mode === "하락경계"
        ? "방어 신호가 켜져 위험자산 축소 순서를 먼저 정해야 합니다."
        : mode === "횡보전환"
          ? "상승 탄력이 둔해져 주도 섹터 교체와 현금 대기가 중요합니다."
          : "레짐은 크게 흔들리지 않았지만 주도권 이동 신호를 계속 추적해야 합니다.";

  return {
    mode,
    headline,
    currentRegime: latest.regimeName ?? null,
    previousRegime,
    regimeChanged: Boolean(regimeChanged),
    confidence: latest.regimeConfidence,
    portfolioScore: latest.portfolioScore,
    scoreDelta,
    currentRsi,
    marketScore: latest.marketScore,
    overheatDays,
    observedDays: records.length,
    alerts: latest.marketAlerts,
    riskTriggers,
  };
}

function addThemeSignal(themes, { theme, date, direction, source, reason, confidence, accountKey }) {
  const classification = classifyThemeSignal(theme);
  const name = compactText(classification.theme, 80);
  if (!name) return;
  const item =
    themes.get(classification.key) ??
    {
      theme: name,
      sector: classification.sector,
      subTheme: classification.subTheme,
      layer: classification.layer,
      definition: classification.definition,
      firstDate: date,
      lastDate: date,
      mentions: 0,
      scores: [],
      sources: new Set(),
      accounts: new Set(),
      reasons: [],
      rawThemes: new Set(),
      currentDirection: directionLabel(direction),
    };

  item.firstDate = item.firstDate < date ? item.firstDate : date;
  item.lastDate = item.lastDate > date ? item.lastDate : date;
  item.mentions += 1;
  item.scores.push({ date, score: directionScore(direction), direction });
  item.sources.add(source);
  if (accountKey) item.accounts.add(accountKey);
  if (reason) item.reasons.push(compactText(reason, 180));
  item.rawThemes.add(compactText(theme, 80));
  if (confidence) item.confidence = Math.max(Number(item.confidence ?? 0), Number(confidence));
  item.currentDirection = directionLabel(direction);
  themes.set(classification.key, item);
}

function buildThemeRotation(records) {
  const themes = new Map();
  const midpoint = Math.max(1, Math.floor(records.length / 2));
  const recentDates = new Set(records.slice(midpoint).map((record) => record.date));
  const previousDates = new Set(records.slice(0, midpoint).map((record) => record.date));

  for (const record of records) {
    for (const change of record.strategyChanges) {
      addThemeSignal(themes, {
        theme: change.theme,
        date: record.date,
        direction: change.direction,
        source: "strategy_changes",
        reason: change.why_now,
        confidence: change.condition_probability === "HIGH" ? 0.85 : change.condition_probability === "MEDIUM" ? 0.65 : 0.45,
      });
    }

    for (const candidate of record.candidateScores) {
      addThemeSignal(themes, {
        theme: candidate.name,
        date: record.date,
        direction: stanceToDirection(candidate.stance),
        source: "candidate_scores",
        reason: candidate.thesis,
        confidence: candidate.confidence,
      });
    }

    for (const account of record.accountActions) {
      for (const code of array(account.buy_candidates)) {
        addThemeSignal(themes, {
          theme: record.candidateNameByCode.get(code) ?? code,
          date: record.date,
          direction: "reinforce",
          source: "account_buy",
          accountKey: account.account_key,
        });
      }
      for (const code of array(account.trim_candidates)) {
        addThemeSignal(themes, {
          theme: record.candidateNameByCode.get(code) ?? code,
          date: record.date,
          direction: "reduce",
          source: "account_trim",
          accountKey: account.account_key,
        });
      }
      for (const code of array(account.hold_candidates)) {
        addThemeSignal(themes, {
          theme: record.candidateNameByCode.get(code) ?? code,
          date: record.date,
          direction: "hold",
          source: "account_hold",
          accountKey: account.account_key,
        });
      }
    }
  }

  return [...themes.values()]
    .map((item) => {
      const recentScore = item.scores
        .filter((score) => recentDates.has(score.date))
        .reduce((sum, score) => sum + score.score, 0);
      const previousScore = item.scores
        .filter((score) => previousDates.has(score.date))
        .reduce((sum, score) => sum + score.score, 0);
      const momentum = round(recentScore - previousScore, 2);
      let status = "관찰유지";
      if (recentScore <= -1.5) status = "과열감량";
      else if (recentScore >= 2 && previousScore <= 0.5) status = "신규부상";
      else if (recentScore >= 2 && Number(momentum ?? 0) > 0) status = "강화중";
      else if (previousScore >= 2 && recentScore <= 0.5) status = "약화중";
      else if (recentScore > 0.5) status = "관찰유지";

      const action =
        status === "과열감량"
          ? "보유분 보호"
          : status === "신규부상" || status === "강화중"
            ? "ETF/종목 후보화"
            : status === "약화중"
              ? "비중 확대 보류"
              : "조건 관찰";

      return {
        theme: item.theme,
        sector: item.sector,
        subTheme: item.subTheme,
        layer: item.layer,
        definition: item.definition,
        status,
        tone: toneForStatus(status),
        action,
        currentDirection: item.currentDirection,
        recentScore: round(recentScore, 2),
        previousScore: round(previousScore, 2),
        momentum,
        mentions: item.mentions,
        firstDate: item.firstDate,
        lastDate: item.lastDate,
        sources: [...item.sources],
        accounts: [...item.accounts],
        rawThemes: [...item.rawThemes].slice(0, 8),
        confidence: round(item.confidence ?? null, 2),
        reason: compactText(item.reasons.at(-1) ?? item.reasons[0] ?? "", 180),
      };
    })
    .sort(
      (left, right) =>
        Math.abs(Number(right.recentScore ?? 0)) + Math.abs(Number(right.momentum ?? 0)) + right.mentions * 0.2 -
        (Math.abs(Number(left.recentScore ?? 0)) + Math.abs(Number(left.momentum ?? 0)) + left.mentions * 0.2),
    )
    .slice(0, 18);
}

function buildSectorRotation(themeRotation) {
  const bySector = new Map();
  for (const item of themeRotation) {
    const sector = item.sector ?? "기타";
    const sectorItem =
      bySector.get(sector) ??
      {
        sector,
        recentScore: 0,
        previousScore: 0,
        momentum: 0,
        mentions: 0,
        firstDate: item.firstDate,
        lastDate: item.lastDate,
        themes: [],
        rawThemes: new Set(),
      };

    sectorItem.recentScore += Number(item.recentScore ?? 0);
    sectorItem.previousScore += Number(item.previousScore ?? 0);
    sectorItem.momentum += Number(item.momentum ?? 0);
    sectorItem.mentions += Number(item.mentions ?? 0);
    sectorItem.firstDate = sectorItem.firstDate < item.firstDate ? sectorItem.firstDate : item.firstDate;
    sectorItem.lastDate = sectorItem.lastDate > item.lastDate ? sectorItem.lastDate : item.lastDate;
    sectorItem.themes.push({
      theme: item.theme,
      subTheme: item.subTheme,
      status: item.status,
      action: item.action,
      momentum: item.momentum,
      reason: item.reason,
    });
    for (const rawTheme of array(item.rawThemes)) sectorItem.rawThemes.add(rawTheme);
    bySector.set(sector, sectorItem);
  }

  return [...bySector.values()]
    .map((item) => {
      const momentum = round(item.momentum, 2);
      const recentScore = round(item.recentScore, 2);
      const previousScore = round(item.previousScore, 2);
      const hasEmerging = item.themes.some((theme) => ["신규부상", "강화중"].includes(theme.status));
      const hasWeakening = item.themes.some((theme) => ["과열감량", "약화중"].includes(theme.status));
      let status = "관찰";
      if (hasEmerging && Number(previousScore ?? 0) <= 2 && Number(recentScore ?? 0) >= 4) status = "신규섹터";
      else if (hasEmerging && (hasWeakening || Number(momentum ?? 0) < 0)) status = "교체감시";
      else if (hasEmerging && Number(momentum ?? 0) > 2) status = "강화섹터";
      else if (hasWeakening) status = "과열주의";
      else if (Number(momentum ?? 0) > 2) status = "강화중";

      const action =
        status === "신규섹터"
          ? "후보확장"
          : status === "강화섹터"
            ? "후보심화"
            : status === "교체감시"
            ? "분리판단"
            : status === "과열주의"
              ? "추격금지"
              : "관찰";

      const themes = item.themes
        .sort((left, right) => Math.abs(Number(right.momentum ?? 0)) - Math.abs(Number(left.momentum ?? 0)))
        .slice(0, 5);

      return {
        sector: item.sector,
        status,
        tone: toneForStatus(status),
        action,
        recentScore,
        previousScore,
        momentum,
        mentions: item.mentions,
        firstDate: item.firstDate,
        lastDate: item.lastDate,
        themes,
        rawThemes: [...item.rawThemes].slice(0, 10),
        note:
          status === "교체감시"
            ? "같은 섹터 안에서도 과열 테마와 새 후보가 섞여 있어 대분류 매수보다 하위 테마별 판단이 필요합니다."
            : status === "신규섹터"
              ? "최근 구간에서 새로 점수가 붙은 섹터입니다. ETF 구성, 수급, 뉴스 확인 전까지는 후보 단계입니다."
              : status === "강화섹터"
                ? "이미 관찰되던 섹터가 최근 더 강해졌습니다. 신규 진입보다 보유 노출과 중복 여부를 먼저 확인합니다."
              : status === "과열주의"
                ? "최근 점수는 있지만 과열/감량 신호가 함께 있어 신규 추격은 보류합니다."
                : "추세 확인이 더 필요합니다.",
      };
    })
    .sort(
      (left, right) =>
        Math.abs(Number(right.recentScore ?? 0)) + Math.abs(Number(right.momentum ?? 0)) + right.mentions * 0.15 -
        (Math.abs(Number(left.recentScore ?? 0)) + Math.abs(Number(left.momentum ?? 0)) + left.mentions * 0.15),
    )
    .slice(0, 10);
}

function sectorMatchesClassification(sector, value) {
  const classified = classifyThemeSignal(value);
  if (classified.sector === sector) return true;
  return sectorStockeasyAliases(sector).some((alias) => textMatchesTerm(value, alias));
}

function relatedPulseItemsForSector(record, sector) {
  const byKey = new Map();
  for (const item of array(record?.stockPulseItems)) {
    const haystack = [item.category, item.name, item.code].join(" ");
    if (!sectorMatchesClassification(sector, haystack)) continue;
    byKey.set(`${item.code ?? item.name}:${item.name}`, item);
  }
  return [...byKey.values()].slice(0, 10);
}

function buildTechnicalSectorRead(items) {
  if (!items.length) {
    return {
      available: false,
      label: "자료없음",
      avgScore: null,
      avgRsi: null,
      overheatCount: 0,
      bullishCount: 0,
      warningCount: 0,
      detail: "대표 종목/ETF 기술지표가 아직 연결되지 않았습니다.",
      items: [],
    };
  }

  const scores = items.map((item) => numberOrNull(item.technical?.score)).filter((value) => value !== null);
  const rsis = items.map((item) => numberOrNull(item.technical?.rsi)).filter((value) => value !== null);
  const overheatCount = items.filter((item) => Number(item.technical?.rsi ?? 0) >= 75 || array(item.technical?.alerts).some((alert) => /과매수|상단/.test(alert))).length;
  const bullishCount = items.filter((item) => /BUY|상승|우호|위/.test([item.technical?.signal, item.technical?.reason].join(" "))).length;
  const warningCount = items.filter((item) => /손절|감량|추격금지|자료보강|위험/.test(item.verdict ?? "")).length;
  const avgScore = scores.length ? round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 1) : null;
  const avgRsi = rsis.length ? round(rsis.reduce((sum, value) => sum + value, 0) / rsis.length, 1) : null;
  const avgProfit = round(
    items.reduce((sum, item) => sum + Number(item.position?.profitRate ?? 0), 0) / Math.max(items.length, 1),
    1,
  );

  let label = "중립";
  if (Number(avgScore ?? 0) >= 70 && Number(avgRsi ?? 0) >= 75) label = "과열상승";
  else if (Number(avgScore ?? 0) >= 70 || bullishCount >= Math.ceil(items.length / 2)) label = "상승확인";
  else if (warningCount >= Math.ceil(items.length / 2) || Number(avgScore ?? 0) < 45) label = "하방경계";

  return {
    available: true,
    label,
    avgScore,
    avgRsi,
    avgProfit,
    overheatCount,
    bullishCount,
    warningCount,
    detail: `평균 기술 ${avgScore ?? "-"} / RSI ${avgRsi ?? "-"} / 과열 ${overheatCount}개 / 평균손익 ${avgProfit ?? "-"}%`,
    items: items
      .slice()
      .sort((left, right) => Number(right.technical?.score ?? 0) - Number(left.technical?.score ?? 0))
      .slice(0, 6)
      .map((item) => ({
        code: item.code ?? null,
        name: item.name,
        category: item.category ?? null,
        verdict: item.verdict ?? null,
        urgency: item.urgency ?? null,
        score: round(item.technical?.score, 0),
        rsi: round(item.technical?.rsi, 1),
        profitRate: round(item.position?.profitRate, 1),
        reason: compactText(item.technical?.reason ?? item.doNow ?? item.oneLine, 120),
      })),
  };
}

const SOURCE_LABELS = {
  reports: "리포트",
  stockeasy: "StockEasy",
  marketvoice: "MarketVoice",
  technical: "기술지표",
  kis_etf: "KIS ETF",
  news: "뉴스",
  macro: "매크로",
  llm: "LLM",
};

const CONFIRMATION_SOURCES = ["reports", "marketvoice", "technical", "kis_etf", "news", "macro", "llm"];

function emptySupportVector() {
  return {
    reports: 0,
    stockeasy: 0,
    marketvoice: 0,
    technical: 0,
    kis_etf: 0,
    news: 0,
    macro: 0,
    llm: 0,
  };
}

function mergeSupportVectors(items) {
  const support = emptySupportVector();
  for (const item of array(items)) {
    for (const source of Object.keys(support)) {
      support[source] = Math.max(Number(support[source] ?? 0), Number(item?.support?.[source] ?? 0) || 0);
    }
  }
  return support;
}

function supportSourceCount(support, sources = CONFIRMATION_SOURCES) {
  return sources.filter((source) => Number(support?.[source] ?? 0) >= 0.05).length;
}

function formatSupportSummary(support, sources = Object.keys(SOURCE_LABELS)) {
  const parts = sources
    .map((source) => [source, Number(support?.[source] ?? 0)])
    .filter(([, value]) => value >= 0.05)
    .sort((left, right) => right[1] - left[1])
    .map(([source, value]) => `${SOURCE_LABELS[source] ?? source} ${round(value, 2)}`);
  return parts.length ? parts.join(" / ") : "교차소스 부족";
}

function featureMatchesSector(sector, item) {
  const haystack = [
    item?.theme,
    item?.name,
    item?.code,
    item?.entityName,
    item?.category,
    ...(array(item?.themes)),
  ].join(" ");
  return sectorMatchesClassification(sector, haystack);
}

function relevantDecisionFeatureItems(record, sector) {
  const themeItems = array(record?.decisionFeatures?.themeFeatures)
    .filter((item) => featureMatchesSector(sector, item))
    .map((item) => ({ ...item, featureType: "theme", displayName: item.theme }));
  const securityItems = array(record?.decisionFeatures?.securityFeatures)
    .filter((item) => featureMatchesSector(sector, item))
    .map((item) => ({ ...item, featureType: "security", displayName: item.name ?? item.code }));
  const supplementThemes = array(record?.sourceConsensusSupplement?.themeSupplements)
    .filter((item) => featureMatchesSector(sector, item))
    .map((item) => ({ ...item, featureType: "themeSupplement", displayName: item.theme }));
  const supplementSecurities = array(record?.sourceConsensusSupplement?.securitySupplements)
    .filter((item) => featureMatchesSector(sector, item))
    .map((item) => ({ ...item, featureType: "securitySupplement", displayName: item.name ?? item.code }));

  return [...themeItems, ...securityItems, ...supplementThemes, ...supplementSecurities];
}

function relatedExternalNewsForSector(record, sector) {
  const holdings = Object.values(record?.externalNews?.holdings ?? {});
  const matches = holdings.filter((item) =>
    sectorMatchesClassification(sector, [item?.category, item?.name, item?.code].join(" ")),
  );
  const articles = matches.flatMap((item) =>
    array(item?.items).map((article) => ({
      holding: item.name,
      title: article.title,
      direction: article.direction ?? "neutral",
      publishedAt: article.publishedAt ?? null,
      url: article.url ?? null,
    })),
  );
  const positive = articles.filter((article) => article.direction === "positive").length;
  const negative = articles.filter((article) => article.direction === "negative").length;
  return {
    count: articles.length,
    positive,
    negative,
    articles: articles.slice(0, 5),
  };
}

function relatedSourceConflictsForSector(record, sector, featureItems) {
  const relatedCodes = new Set(
    array(featureItems)
      .map((item) => item.code)
      .filter(Boolean),
  );
  return array(record?.sourceDivergence?.divergence?.sourceConflicts)
    .filter((item) => {
      if (item.entityType === "theme") return sectorMatchesClassification(sector, item.entityId);
      if (item.entityType === "security") return relatedCodes.has(item.entityId);
      return false;
    })
    .slice(0, 6);
}

function weightedAverageNetScore(items) {
  const scored = array(items)
    .map((item) => ({
      score: numberOrNull(item?.netScore),
      weight: Math.max(1, supportSourceCount(item?.support)),
    }))
    .filter((item) => item.score !== null);
  if (!scored.length) return 0;
  const totalWeight = scored.reduce((sum, item) => sum + item.weight, 0);
  return round(scored.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight, 3);
}

function buildSourceConsensusSectorRead(sector, records) {
  const latest = records.at(-1) ?? {};
  const featureItems = relevantDecisionFeatureItems(latest, sector);
  const news = relatedExternalNewsForSector(latest, sector);
  const support = mergeSupportVectors(featureItems);
  if (news.count > 0) {
    support.news = Math.max(Number(support.news ?? 0), Math.min(0.72, 0.25 + news.count * 0.06));
  }

  const sourceCount = supportSourceCount(support);
  const rawNetScore = weightedAverageNetScore(featureItems);
  const newsNet = news.count > 0 ? round((news.positive - news.negative) * 0.08, 3) : 0;
  const netScore = round(rawNetScore + newsNet, 3);
  const positiveCount = featureItems.filter((item) => Number(item?.netScore ?? 0) >= 0.12).length + news.positive;
  const negativeCount = featureItems.filter((item) => Number(item?.netScore ?? 0) <= -0.12).length + news.negative;
  const conflicts = relatedSourceConflictsForSector(latest, sector, featureItems);
  const hasConflict = conflicts.length > 0 || (positiveCount > 0 && negativeCount > 0);

  let label = "외부부족";
  if (sourceCount >= 3 && netScore >= 0.15 && !hasConflict) label = "전방위확인";
  else if (sourceCount >= 2 && netScore >= 0.05 && !hasConflict) label = "교차확인";
  else if (netScore <= -0.1 && negativeCount > positiveCount) label = "부정우세";
  else if (hasConflict) label = "근거충돌";
  else if (sourceCount >= 2) label = "중립확인";

  const supportSummary = formatSupportSummary(support, CONFIRMATION_SOURCES);
  const topItems = featureItems
    .slice()
    .sort(
      (left, right) =>
        supportSourceCount(right.support) - supportSourceCount(left.support) ||
        Math.abs(Number(right.netScore ?? 0)) - Math.abs(Number(left.netScore ?? 0)),
    )
    .slice(0, 5)
    .map((item) => ({
      type: item.featureType,
      name: compactText(item.displayName ?? item.name ?? item.theme ?? item.code, 60),
      netScore: round(item.netScore, 3),
      sourceCount: item.sourceCount ?? supportSourceCount(item.support),
      supportSummary: formatSupportSummary(item.support, CONFIRMATION_SOURCES),
      label: item.label ?? null,
    }));

  const confidence = round(
    Math.min(
      0.92,
      Math.max(
        0.3,
        0.32 + sourceCount * 0.08 + Math.min(positiveCount, 3) * 0.04 - Math.min(negativeCount, 3) * 0.04 - (hasConflict ? 0.08 : 0),
      ),
    ),
    2,
  );

  return {
    available: sourceCount >= 2 || featureItems.length > 0 || news.count > 0,
    label,
    detail: `${supportSummary} / 합의 ${netScore} / 충돌 ${conflicts.length}건`,
    netScore,
    sourceCount,
    support,
    supportSummary,
    confidence,
    conflictCount: conflicts.length,
    topItems,
    news,
    missingSources: CONFIRMATION_SOURCES.filter((source) => Number(support?.[source] ?? 0) < 0.05),
    evidence: [
      supportSummary,
      ...topItems.map((item) => `${item.name}: ${item.supportSummary}`),
      ...news.articles.slice(0, 2).map((article) => `뉴스: ${compactText(article.title, 80)}`),
    ].slice(0, 6),
  };
}

function technicalRowsForSector(record, sector) {
  const rows = Object.values(record?.technicalSnapshot?.scores ?? {});
  return rows
    .filter((item) => sectorMatchesClassification(sector, [item?.name, item?.code, item?.bucket, item?.type, item?.signal_reason].join(" ")))
    .slice(0, 12);
}

function chartTriggerForItem(item) {
  const close = numberOrNull(item?.close);
  const previousClose = numberOrNull(item?.previous_close);
  const ma5 = numberOrNull(item?.ma?.ma5);
  const ma20 = numberOrNull(item?.ma?.ma20);
  const ma60 = numberOrNull(item?.ma?.ma60);
  const rsi = numberOrNull(item?.rsi);
  const volumeRatio = numberOrNull(item?.volume_ratio);
  const macdValue = numberOrNull(item?.macd?.value);
  const macdSignal = numberOrNull(item?.macd?.signal);
  const macdHistogram = numberOrNull(item?.macd?.histogram);
  const rs = numberOrNull(item?.relative_strength?.rs_vs_benchmark);
  const recentHighDistancePct = numberOrNull(item?.recent_high?.distance_pct);
  const changePct = numberOrNull(item?.change_pct);
  const alerts = array(item?.alerts).map((alert) => String(alert));
  const entry = [];
  const exit = [];
  const watch = [];

  if (close !== null && ma20 !== null && close >= ma20) entry.push("20일선 위");
  if (close !== null && ma20 !== null && close < ma20) exit.push("20일선 이탈");
  if (ma5 !== null && ma20 !== null && ma60 !== null && ma5 >= ma20 && ma20 >= ma60) entry.push("이평 정배열");
  if (ma5 !== null && ma20 !== null && ma60 !== null && ma5 < ma20 && ma20 <= ma60) exit.push("이평 역배열");
  if (rsi !== null && rsi >= 50 && rsi <= 70) entry.push(`RSI ${round(rsi, 1)} 건강`);
  if (rsi !== null && rsi >= 75) exit.push(`RSI ${round(rsi, 1)} 과열`);
  if (rsi !== null && rsi < 45) exit.push(`RSI ${round(rsi, 1)} 약세`);
  if (macdValue !== null && macdSignal !== null && macdHistogram !== null && macdValue > macdSignal && macdHistogram > 0) entry.push("MACD 양전환");
  if (macdValue !== null && macdSignal !== null && macdHistogram !== null && macdValue < macdSignal && macdHistogram < 0) exit.push("MACD 음전환");
  if (volumeRatio !== null && volumeRatio >= 1.5 && Number(changePct ?? 0) >= 0) entry.push(`거래량 ${round(volumeRatio, 1)}배`);
  if (volumeRatio !== null && volumeRatio >= 1.5 && Number(changePct ?? 0) < 0) exit.push(`하락거래 ${round(volumeRatio, 1)}배`);
  if (rs !== null && rs > 0) entry.push("상대강도 우위");
  if (rs !== null && rs < -0.1) exit.push("상대강도 약화");
  if (recentHighDistancePct !== null && recentHighDistancePct > -0.03 && Number(changePct ?? 0) >= 0) watch.push("신고가 근접");
  if (previousClose !== null && close !== null && previousClose > 0 && (close - previousClose) / previousClose <= -0.04) exit.push("장대음봉 후보");
  if (alerts.some((alert) => /골든크로스|MACD 골든/.test(alert))) entry.push("크로스 상향");
  if (alerts.some((alert) => /데드크로스|MACD 데드/.test(alert))) exit.push("크로스 하향");

  const entryScore = entry.length + watch.length * 0.4;
  const exitScore = exit.length;
  return {
    code: item?.code ?? null,
    name: item?.name ?? null,
    score: numberOrNull(item?.score),
    signal: item?.signal ?? null,
    close,
    rsi,
    ma20,
    changePct: round(Number(changePct ?? 0) * 100, 2),
    volumeRatio: round(volumeRatio, 2),
    entry,
    exit,
    watch,
    entryScore: round(entryScore, 1),
    exitScore: round(exitScore, 1),
  };
}

function buildChartTriggerRead(sector, records) {
  const latest = records.at(-1) ?? {};
  const items = technicalRowsForSector(latest, sector).map(chartTriggerForItem);
  if (!items.length) {
    return {
      available: false,
      label: "차트없음",
      detail: "섹터 대표 ETF/종목 차트가 아직 연결되지 않았습니다.",
      entryTriggers: [],
      exitTriggers: ["대표 ETF/종목 기술지표 연결 필요"],
      items: [],
    };
  }

  const entryTriggers = [...new Set(items.flatMap((item) => item.entry))].slice(0, 6);
  const exitTriggers = [...new Set(items.flatMap((item) => item.exit))].slice(0, 6);
  const watchTriggers = [...new Set(items.flatMap((item) => item.watch))].slice(0, 4);
  const avgEntryScore = round(items.reduce((sum, item) => sum + Number(item.entryScore ?? 0), 0) / items.length, 1);
  const avgExitScore = round(items.reduce((sum, item) => sum + Number(item.exitScore ?? 0), 0) / items.length, 1);
  const above20Count = items.filter((item) => item.entry.includes("20일선 위")).length;
  const below20Count = items.filter((item) => item.exit.includes("20일선 이탈")).length;
  const overheatCount = items.filter((item) => array(item.exit).some((trigger) => /과열/.test(trigger))).length;
  const bullishCount = items.filter((item) => Number(item.entryScore ?? 0) >= 3).length;
  const bearishCount = items.filter((item) => Number(item.exitScore ?? 0) >= 3).length;

  let label = "대기";
  if (overheatCount >= Math.ceil(items.length / 2) && avgEntryScore >= avgExitScore) label = "과열대기";
  else if (bullishCount >= Math.ceil(items.length / 2) && avgExitScore < 2) label = "진입신호";
  else if (overheatCount > 0 && avgEntryScore >= avgExitScore) label = "과열대기";
  else if (bearishCount >= Math.ceil(items.length / 2) || below20Count > above20Count) label = "이탈경계";
  else if (avgEntryScore >= 2 && avgEntryScore > avgExitScore) label = "형성중";

  return {
    available: true,
    label,
    detail: `차트 ${items.length}개 / 20일선 위 ${above20Count}개 / 이탈 ${below20Count}개 / 과열 ${overheatCount}개`,
    avgEntryScore,
    avgExitScore,
    above20Count,
    below20Count,
    overheatCount,
    entryTriggers,
    exitTriggers,
    watchTriggers,
    items: items
      .slice()
      .sort((left, right) => Number(right.entryScore ?? 0) - Number(left.entryScore ?? 0) || Number(left.exitScore ?? 0) - Number(right.exitScore ?? 0))
      .slice(0, 6),
  };
}

function inferNewsDirectionFromText(text) {
  if (/(급락|하향|악화|부진|중단|지연|우려|리스크|제재|적자|둔화|감소|실패)/i.test(text)) return "negative";
  if (/(급등|상향|호조|수주|계약|승인|확대|증설|투자|신고가|회복|수혜|흑자|최대)/i.test(text)) return "positive";
  return "neutral";
}

function relatedNewsForSector(record, sector) {
  const rss = array(record?.rssNews).map((entry) => ({
    title: entry.title,
    summary: entry.summary,
    source: entry.source,
    category: entry.category,
    url: entry.url,
    publishedAt: entry.publishedAt ?? entry.published ?? null,
    direction: entry.direction ?? inferNewsDirectionFromText(`${entry.title ?? ""} ${entry.summary ?? ""}`),
  }));
  const offReport = Object.values(record?.externalNews?.holdings ?? {}).flatMap((holding) =>
    array(holding?.items).map((entry) => ({
      title: entry.title,
      summary: entry.summary,
      source: entry.source,
      category: holding.category,
      url: entry.url,
      publishedAt: entry.publishedAt ?? null,
      direction: entry.direction ?? inferNewsDirectionFromText(`${entry.title ?? ""} ${entry.summary ?? ""}`),
    })),
  );
  return [...rss, ...offReport]
    .filter((entry) => sectorMatchesClassification(sector, [entry.title, entry.summary, entry.category].join(" ")))
    .slice(0, 20);
}

function buildNewsTriggerRead(sector, records) {
  const latest = records.at(-1) ?? {};
  const items = relatedNewsForSector(latest, sector);
  const positive = items.filter((item) => item.direction === "positive").length;
  const negative = items.filter((item) => item.direction === "negative").length;
  const neutral = items.filter((item) => item.direction === "neutral" || item.direction === "mixed").length;
  let label = "뉴스없음";
  if (positive >= 2 && positive > negative) label = "호재확인";
  else if (negative >= 1 && negative >= positive) label = "악재경계";
  else if (items.length > 0) label = "뉴스관찰";
  return {
    available: items.length > 0,
    label,
    detail: `뉴스 ${items.length}건 / 호재 ${positive} / 악재 ${negative} / 중립 ${neutral}`,
    positive,
    negative,
    neutral,
    headlines: items.slice(0, 5).map((item) => ({
      title: compactText(item.title, 90),
      direction: item.direction,
      source: item.source ?? null,
      publishedAt: item.publishedAt ?? null,
      url: item.url ?? null,
    })),
  };
}

function buildTransitionTriggerRead({ sector, chart, news, sourceConsensus, stockeasy }) {
  const entryReady =
    ["진입신호", "형성중"].includes(chart?.label) &&
    ["호재확인", "뉴스관찰"].includes(news?.label) &&
    ["전방위확인", "교차확인", "중립확인"].includes(sourceConsensus?.label);
  const blocked =
    ["이탈경계"].includes(chart?.label) ||
    news?.label === "악재경계" ||
    ["부정우세", "근거충돌", "외부부족"].includes(sourceConsensus?.label);
  const overheat = chart?.label === "과열대기";
  let label = "감시";
  if (blocked) label = "전환보류";
  else if (overheat) label = "눌림대기";
  else if (entryReady) label = "전환검토";
  else if (blocked) label = "전환보류";

  const entryChecklist = [
    stockeasy?.available ? "StockEasy RS 80 이상과 등락률 플러스 유지" : "StockEasy 섹터 캡처 재확인",
    sourceConsensus?.sourceCount >= 2 ? "교차소스 2개 이상 유지" : "리포트/MarketVoice/KIS ETF/뉴스 중 2개 이상 같은 방향 확인",
    ...(chart?.entryTriggers?.length ? chart.entryTriggers.slice(0, 3) : ["20일선 회복", "MACD 양전환"]),
    news?.positive > news?.negative ? "호재 뉴스 추가 확인" : "관련 뉴스 호재/악재 방향 확인",
  ].slice(0, 6);
  const exitChecklist = [
    ...(chart?.exitTriggers?.length ? chart.exitTriggers.slice(0, 4) : ["20일선 이탈", "RSI 하락반전"]),
    sourceConsensus?.label === "근거충돌" ? "교차소스 충돌 해소 전까지 전환 금지" : null,
    news?.negative > 0 ? "악재 뉴스 해소 전까지 전환 금지" : null,
  ].filter(Boolean).slice(0, 6);

  return {
    sector,
    label,
    tone: label === "전환검토" ? "green" : label === "전환보류" ? "red" : "amber",
    summary:
      label === "전환검토"
        ? "차트와 외부 근거가 함께 맞아 전환 검토가 가능합니다."
        : label === "눌림대기"
          ? "방향은 좋지만 차트가 과열이라 눌림 확인이 필요합니다."
          : label === "전환보류"
            ? "차트·뉴스·교차소스 중 하나 이상이 막고 있어 지금은 전환하지 않습니다."
            : "아직 전환 조건을 확인 중입니다.",
    entryChecklist,
    exitChecklist,
    chart,
    news,
  };
}

function buildTransitionTriggerBoard(sectorDeliberations) {
  const rows = array(sectorDeliberations)
    .map((item) => ({
      sector: item.sector,
      verdict: item.verdict,
      action: targetActionForCandidate(item),
      confidence: item.confidence,
      ...item.transitionTrigger,
    }))
    .sort((left, right) => {
      const order = { 전환검토: 4, 눌림대기: 3, 감시: 2, 전환보류: 1 };
      return Number(order[right.label] ?? 0) - Number(order[left.label] ?? 0);
    })
    .slice(0, 8);
  return {
    summary: "전환 트리거는 차트(20일선·RSI·MACD·거래량), 뉴스 호재/악재, 교차소스 합의가 동시에 맞는지로 판단합니다.",
    rows,
  };
}

function exposureForSector(portfolioImplications, sector) {
  const exposures = array(portfolioImplications?.crowdedExposures);
  const related = exposures.filter((item) => sectorMatchesClassification(sector, [item.category, ...array(item.names)].join(" ")));
  if (!related.length) return null;
  const weightPct = round(related.reduce((sum, item) => sum + Number(item.weightPct ?? 0), 0), 1);
  return {
    weightPct,
    holdingCount: related.reduce((sum, item) => sum + Number(item.holdingCount ?? 0), 0),
    categories: related.map((item) => item.category).filter(Boolean).slice(0, 5),
    risk: related.some((item) => item.risk === "집중점검") || Number(weightPct ?? 0) >= 15 ? "집중점검" : "보통",
  };
}

function buildSectorDeliberations({ sectorRotation, themeRotation, records, stockeasyHistory, portfolioImplications }) {
  const latest = records.at(-1) ?? {};
  const sectors = [
    ...array(sectorRotation).map((item) => item.sector),
    ...array(themeRotation)
      .filter((item) => ["신규부상", "강화중", "과열감량", "약화중"].includes(item.status))
      .map((item) => item.sector),
  ]
    .filter(Boolean)
    .filter((sector, index, list) => list.indexOf(sector) === index)
    .slice(0, 12);

  return sectors.map((sector) => {
    const sectorItem = array(sectorRotation).find((item) => item.sector === sector) ?? { sector };
    const themes = array(themeRotation).filter((item) => item.sector === sector);
    const stockeasy = buildStockeasySectorRead(sector, stockeasyHistory);
    const technical = buildTechnicalSectorRead(relatedPulseItemsForSector(latest, sector));
    const sourceConsensus = buildSourceConsensusSectorRead(sector, records);
    const chartTriggers = buildChartTriggerRead(sector, records);
    const newsTriggers = buildNewsTriggerRead(sector, records);
    const transitionTrigger = buildTransitionTriggerRead({ sector, chart: chartTriggers, news: newsTriggers, sourceConsensus, stockeasy });
    const exposure = exposureForSector(portfolioImplications, sector);
    const bullCase = [];
    const bearCase = [];

    if (["신규섹터", "강화섹터", "강화중"].includes(sectorItem.status)) {
      bullCase.push(`3주 로테이션이 ${sectorItem.status}로 잡혔고 변화값은 ${sectorItem.momentum ?? "-"}입니다.`);
    }
    if (themes.some((theme) => ["신규부상", "강화중"].includes(theme.status))) {
      bullCase.push(`하위테마 ${themes.filter((theme) => ["신규부상", "강화중"].includes(theme.status)).map((theme) => theme.theme).slice(0, 3).join(", ")}에 매수 후보화 신호가 있습니다.`);
    }
    if (stockeasy.label === "상승근거") bullCase.push(`StockEasy도 ${stockeasy.detail}로 상승 쪽 근거를 줍니다.`);
    if (technical.label === "상승확인") bullCase.push(`대표 종목/ETF 기술지표가 ${technical.detail}로 우상향입니다.`);
    if (technical.label === "과열상승") bullCase.push(`기술 추세 자체는 강합니다. ${technical.detail}.`);
    if (["전방위확인", "교차확인"].includes(sourceConsensus.label)) {
      bullCase.push(`StockEasy 밖 교차소스도 ${sourceConsensus.detail}로 같은 방향을 확인합니다.`);
    }
    if (["진입신호", "형성중"].includes(chartTriggers.label)) bullCase.push(`차트 트리거가 ${chartTriggers.detail}로 전환 형성 중입니다.`);
    if (newsTriggers.label === "호재확인") bullCase.push(`뉴스 트리거가 ${newsTriggers.detail}로 우호적입니다.`);

    if (["과열주의", "교체감시"].includes(sectorItem.status)) {
      bearCase.push(`섹터 판정이 ${sectorItem.status}라 대분류 매수보다 하위테마 분리 판단이 필요합니다.`);
    }
    if (Number(sectorItem.momentum ?? 0) < -5) {
      bearCase.push(`3주 변화값이 ${sectorItem.momentum}로 둔화되어 상승 지속을 그대로 믿기 어렵습니다.`);
    }
    if (stockeasy.label === "둔화의심") bearCase.push(`StockEasy는 ${stockeasy.detail}로 둔화 의심을 줍니다.`);
    if (technical.label === "과열상승") bearCase.push(`대표 종목/ETF RSI가 높아 추격 매수보다 눌림 확인이 필요합니다.`);
    if (technical.label === "하방경계") bearCase.push(`대표 종목/ETF 기술지표가 ${technical.detail}로 약합니다.`);
    if (sourceConsensus.label === "부정우세") bearCase.push(`교차소스는 ${sourceConsensus.detail}로 부정 쪽이 우세합니다.`);
    if (sourceConsensus.label === "근거충돌") bearCase.push(`교차소스가 ${sourceConsensus.detail}로 엇갈려 단정하기 어렵습니다.`);
    if (sourceConsensus.label === "외부부족") bearCase.push(`StockEasy 밖 확인 소스가 ${sourceConsensus.sourceCount}개라 전환 근거로는 부족합니다.`);
    if (chartTriggers.label === "이탈경계") bearCase.push(`차트 트리거가 ${chartTriggers.detail}라 전환보다 이탈 경계가 우선입니다.`);
    if (chartTriggers.label === "과열대기") bearCase.push(`차트 트리거가 ${chartTriggers.detail}라 눌림 확인 전까지 추격하지 않습니다.`);
    if (newsTriggers.label === "악재경계") bearCase.push(`뉴스 트리거가 ${newsTriggers.detail}라 호재 전환 확인이 필요합니다.`);
    if (exposure?.risk === "집중점검") bearCase.push(`내 계좌 노출이 ${exposure.weightPct}%라 중복 매수 위험이 있습니다.`);
    if (!stockeasy.available) bearCase.push("StockEasy 직접 섹터 신호가 없어 확신도를 낮춰야 합니다.");
    if (!technical.available) bearCase.push("대표 종목/ETF 기술지표 연결이 없어 데이터 보강이 필요합니다.");

    const bullScore =
      (["신규섹터", "강화섹터"].includes(sectorItem.status) ? 2 : 0) +
      (Number(sectorItem.momentum ?? 0) > 5 ? 1 : 0) +
      (stockeasy.label === "상승근거" ? 1.5 : 0) +
      (technical.label === "상승확인" ? 2 : technical.label === "과열상승" ? 1 : 0) +
      (sourceConsensus.label === "전방위확인" ? 3 : sourceConsensus.label === "교차확인" ? 2 : Number(sourceConsensus.netScore ?? 0) > 0 ? 0.8 : 0) +
      (chartTriggers.label === "진입신호" ? 2.5 : chartTriggers.label === "형성중" ? 1.5 : 0) +
      (newsTriggers.label === "호재확인" ? 1.2 : 0) +
      themes.filter((theme) => ["신규부상", "강화중"].includes(theme.status)).length;
    const bearScore =
      (["과열주의", "교체감시"].includes(sectorItem.status) ? 2 : 0) +
      (Number(sectorItem.momentum ?? 0) < -5 ? 1 : 0) +
      (stockeasy.label === "둔화의심" ? 2 : 0) +
      (technical.label === "과열상승" ? 2 : technical.label === "하방경계" ? 2 : 0) +
      (sourceConsensus.label === "부정우세" ? 3 : sourceConsensus.label === "근거충돌" ? 2 : sourceConsensus.label === "외부부족" ? 1 : 0) +
      (chartTriggers.label === "이탈경계" ? 3 : chartTriggers.label === "과열대기" ? 1.5 : 0) +
      (newsTriggers.label === "악재경계" ? 2 : 0) +
      (exposure?.risk === "집중점검" ? 1 : 0) +
      (!stockeasy.available || !technical.available ? 1 : 0);

    let verdict = "관찰유지";
    if (!stockeasy.available && !technical.available && sourceConsensus.label === "외부부족") verdict = "자료보강";
    else if (sourceConsensus.label === "부정우세" && bearScore >= bullScore) verdict = "하방경계";
    else if (bullScore >= 5 && bearScore >= 3) verdict = "과열상승";
    else if (bullScore >= 5) verdict = "상승확인";
    else if (bearScore >= 4) verdict = "하방경계";
    else if (bullScore >= 3 && bearScore >= 2) verdict = "교체감시";
    else if (bullScore >= 3) verdict = "상승의심";
    if (verdict === "상승확인" && sourceConsensus.label === "외부부족") verdict = "상승의심";

    const confidence = round(
      Math.min(
        0.92,
        Math.max(
          0.35,
          0.3 +
            Math.abs(bullScore - bearScore) * 0.06 +
            (stockeasy.available ? 0.06 : 0) +
            (technical.available ? 0.08 : 0) +
            Number(sourceConsensus.confidence ?? 0) * 0.18,
        ),
      ),
      2,
    );
    const finalAnswer =
      verdict === "상승확인"
        ? "상승 근거가 우세하고 StockEasy 밖 교차확인도 붙었습니다. 계좌 부족 자산군과 맞을 때만 분할 후보로 봅니다."
        : verdict === "과열상승"
          ? "오르는 것은 맞지만 이미 뜨거운 구간입니다. 매수보다 보유 보호와 눌림 대기가 먼저입니다."
          : verdict === "하방경계"
            ? "하방 전환 또는 둔화 의심이 더 큽니다. 신규 매수는 보류하고 이탈 조건을 봅니다."
            : verdict === "교체감시"
              ? "대분류 전체보다 하위테마별로 갈리는 구간입니다. 강한 하위테마와 약한 하위테마를 분리합니다."
              : verdict === "자료보강"
                ? "아직 결론을 낼 만큼 소스가 충분하지 않습니다. StockEasy, ETF 구성, 대표 종목 기술지표를 보강합니다."
                : "방향은 열려 있지만 결론 강도는 낮습니다. 다음 데이터까지 관찰합니다.";

    return {
      sector,
      verdict,
      tone: toneForStatus(verdict),
      confidence,
      question: `${sector} 섹터가 정말 오르는 중인가, 아니면 하방 전환/과열인가?`,
      finalAnswer,
      bullScore,
      bearScore,
      rotation: {
        status: sectorItem.status ?? "관찰",
        action: sectorItem.action ?? "관찰",
        recentScore: sectorItem.recentScore ?? null,
        momentum: sectorItem.momentum ?? null,
        note: sectorItem.note ?? null,
      },
      stockeasy,
      sourceConsensus,
      chartTriggers,
      newsTriggers,
      transitionTrigger,
      technical,
      exposure,
      themes: themes.slice(0, 5).map((theme) => ({
        theme: theme.theme,
        subTheme: theme.subTheme,
        status: theme.status,
        momentum: theme.momentum,
        action: theme.action,
      })),
      bullCase: bullCase.length ? bullCase.slice(0, 5) : ["아직 뚜렷한 상승 근거가 부족합니다."],
      bearCase: bearCase.length ? bearCase.slice(0, 5) : ["현재 데이터에서는 명확한 하방 근거가 크지 않습니다."],
      nextChecks: [
        "StockEasy는 베이스로만 보고 리포트/MarketVoice/KIS ETF/뉴스/기술 중 2개 이상이 같은 방향인지 확인",
        "차트에서 20일선 지지, RSI 50~70 재상승, MACD 양전환, 거래량 동반을 확인",
        "뉴스에서 수주/실적/정책/ETF 수급 호재가 악재보다 많은지 확인",
        exposure?.risk === "집중점검" ? "이미 보유 비중이 높아 신규 매수보다 감량/보호 조건을 먼저 확인" : "계좌 부족 자산군과 맞는 후보만 분할 검토",
      ],
    };
  });
}

function targetActionForCandidate(item) {
  if (item.sourceConsensus?.label === "외부부족" && item.verdict !== "하방경계") return "자료보강";
  if (item.sourceConsensus?.label === "근거충돌" && item.verdict !== "하방경계") return "조건대기";
  if (item.verdict === "상승확인") {
    if (!item.technical?.available) return "자료보강";
    if (item.stockeasy?.label === "둔화의심") return "조건대기";
    return "분할후보";
  }
  if (item.verdict === "과열상승") return "눌림대기";
  if (item.verdict === "교체감시") return "전환감시";
  if (item.verdict === "하방경계") return "재진입대기";
  if (item.verdict === "자료보강") return "자료보강";
  return "관찰";
}

function switchTriggerForCandidate(item) {
  const stockeasySector = item.stockeasy?.latest?.sector ?? item.sector;
  const rsi = item.technical?.avgRsi;
  const stockeasyBase =
    item.stockeasy?.available
      ? `${stockeasySector} StockEasy 등락률이 0% 이상이고 RS 80 이상이 다음 캡처에서도 유지`
      : "StockEasy 섹터 신호가 새로 수집되어 RS와 등락률이 확인";
  const technicalBase =
    item.technical?.available
      ? Number(rsi ?? 0) >= 75
        ? `대표 ETF/종목 RSI가 ${rsi}에서 70 이하로 식고 20일선을 지지`
        : "대표 ETF/종목이 20일선 위를 유지하고 RSI 50~70 구간에서 재상승"
      : "대표 ETF/종목 기술지표가 연결되고 20일선 위 추세가 확인";
  const sourceBase =
    Number(item.sourceConsensus?.sourceCount ?? 0) >= 2
      ? `교차소스(${item.sourceConsensus.supportSummary ?? item.sourceConsensus.detail})가 양호한 방향으로 유지`
      : "리포트/MarketVoice/KIS ETF/뉴스 중 최소 2개 이상이 같은 방향으로 확인";
  const chartBase = item.transitionTrigger?.entryChecklist?.length
    ? `차트(${item.transitionTrigger.entryChecklist.slice(2, 5).join(", ") || item.chartTriggers?.label}) 확인`
    : "차트에서 20일선 지지, RSI 50~70 재상승, MACD 양전환 확인";
  const newsBase = item.newsTriggers?.label === "호재확인"
    ? "호재 뉴스가 악재보다 우세"
    : "뉴스에서 수주/실적/정책/수급 호재가 악재보다 우세";

  if (item.verdict === "상승확인") {
    return `${stockeasyBase} + ${sourceBase} + ${chartBase} + ${newsBase}이면 1차 후보로 승격합니다.`;
  }
  if (item.verdict === "과열상승") {
    return `${stockeasyBase}하더라도 ${sourceBase} + ${chartBase} + ${technicalBase} 전까지는 추격하지 않습니다.`;
  }
  if (item.verdict === "교체감시") {
    return `${stockeasyBase} + ${sourceBase} + ${chartBase} + 기존 과열 보유의 RSI 하락반전/20일선 이탈이 같이 나오면 교체 후보로 올립니다.`;
  }
  if (item.verdict === "하방경계") {
    return `하방경계가 해제되고 ${stockeasyBase} + ${sourceBase} + ${chartBase} + ${newsBase}이 동시에 확인될 때만 재진입 후보로 복귀합니다.`;
  }
  return `${stockeasyBase} + ${sourceBase} + ${chartBase} + ${newsBase}을 먼저 확인합니다.`;
}

function invalidationForCandidate(item) {
  if (item.verdict === "상승확인") {
    return "다음 캡처에서 RS가 70 아래로 내려가거나 교차소스가 근거충돌/부정우세로 바뀌거나 대표 ETF가 20일선을 이탈하면 후보에서 내립니다.";
  }
  if (item.verdict === "과열상승") {
    return "강한 섹터라도 거래량 동반 장대음봉, RSI 하락반전, 20일선 이탈 중 2개가 나오면 보호/감량으로 전환합니다.";
  }
  if (item.verdict === "교체감시") {
    return "강한 하위테마 없이 대분류만 흔들리면 전환하지 않습니다.";
  }
  if (item.verdict === "하방경계") {
    return "하방경계 상태가 유지되는 동안 신규 매수 후보에서 제외합니다.";
  }
  return "자료가 보강되지 않으면 후보 강도를 올리지 않습니다.";
}

function priorityForCandidate(item) {
  if (item.sourceConsensus?.label === "외부부족" && item.verdict !== "하방경계") return "관찰";
  if (
    item.verdict === "상승확인" &&
    item.technical?.available &&
    item.stockeasy?.label !== "둔화의심" &&
    ["전방위확인", "교차확인"].includes(item.sourceConsensus?.label)
  ) return "1순위";
  if (item.verdict === "상승확인") return "2순위";
  if (item.verdict === "교체감시") return "2순위";
  if (item.verdict === "과열상승") return "3순위";
  if (item.verdict === "하방경계") return "제외";
  return "관찰";
}

function buildRotationTargets(sectorDeliberations) {
  const candidates = array(sectorDeliberations)
    .map((item) => {
      const action = targetActionForCandidate(item);
      const priority = priorityForCandidate(item);
      const crowdedPenalty = item.exposure?.risk === "집중점검" ? 10 : 0;
      const missingPenalty = !item.technical?.available ? 8 : 0;
      const externalPenalty = Number(item.sourceConsensus?.sourceCount ?? 0) < 2 ? 14 : 0;
      const score =
        Number(item.bullScore ?? 0) * 12 -
        Number(item.bearScore ?? 0) * 8 +
        Number(item.confidence ?? 0) * 20 -
        crowdedPenalty -
        missingPenalty -
        externalPenalty +
        (priority === "1순위" ? 25 : priority === "2순위" ? 14 : priority === "3순위" ? 6 : priority === "제외" ? -30 : 0);
      return {
        sector: item.sector,
        priority,
        action,
        verdict: item.verdict,
        tone: priority === "제외" ? "red" : action === "분할후보" || priority === "1순위" ? "green" : action === "전환감시" || action === "조건대기" ? "amber" : "slate",
        score: round(score, 1),
        confidence: item.confidence,
        whyWatch: compactText(item.finalAnswer, 150),
        switchWhen: switchTriggerForCandidate(item),
        invalidation: invalidationForCandidate(item),
        evidence: [
          item.bullCase?.[0] ?? null,
          item.stockeasy?.detail ? `StockEasy: ${item.stockeasy.detail}` : null,
          item.sourceConsensus?.detail ? `교차검증: ${item.sourceConsensus.detail}` : null,
          item.transitionTrigger?.summary ? `전환트리거: ${item.transitionTrigger.label} / ${item.transitionTrigger.summary}` : null,
          item.chartTriggers?.detail ? `차트: ${item.chartTriggers.detail}` : null,
          item.newsTriggers?.detail ? `뉴스: ${item.newsTriggers.detail}` : null,
          item.technical?.detail ? `기술: ${item.technical.detail}` : null,
          item.exposure?.weightPct != null ? `계좌노출: ${item.exposure.weightPct}% / ${item.exposure.risk}` : null,
        ].filter(Boolean).map((value) => compactText(value, 120)),
        sourceConsensus: item.sourceConsensus
          ? {
              label: item.sourceConsensus.label,
              detail: item.sourceConsensus.detail,
              sourceCount: item.sourceConsensus.sourceCount,
              supportSummary: item.sourceConsensus.supportSummary,
              netScore: item.sourceConsensus.netScore,
            }
          : null,
        transitionTrigger: item.transitionTrigger
          ? {
              label: item.transitionTrigger.label,
              tone: item.transitionTrigger.tone,
              summary: item.transitionTrigger.summary,
              entryChecklist: array(item.transitionTrigger.entryChecklist).slice(0, 6),
              exitChecklist: array(item.transitionTrigger.exitChecklist).slice(0, 6),
              chart: item.chartTriggers
                ? {
                    label: item.chartTriggers.label,
                    detail: item.chartTriggers.detail,
                    entryTriggers: array(item.chartTriggers.entryTriggers).slice(0, 5),
                    exitTriggers: array(item.chartTriggers.exitTriggers).slice(0, 5),
                  }
                : null,
              news: item.newsTriggers
                ? {
                    label: item.newsTriggers.label,
                    detail: item.newsTriggers.detail,
                    headlines: array(item.newsTriggers.headlines).slice(0, 3),
                  }
                : null,
            }
          : null,
        representative: array(item.technical?.items).slice(0, 4).map((techItem) => ({
          code: techItem.code ?? null,
          name: techItem.name ?? null,
          verdict: techItem.verdict ?? null,
          rsi: techItem.rsi ?? null,
          score: techItem.score ?? null,
          profitRate: techItem.profitRate ?? null,
        })),
      };
    })
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));

  const watch = candidates.filter((item) => item.priority !== "제외").slice(0, 6);
  const excluded = candidates.filter((item) => item.priority === "제외").slice(0, 6);
  const first = watch[0] ?? null;
  const second = watch[1] ?? null;
  return {
    summary: {
      answer:
        first && second
          ? `다음 전환 감시는 ${first.sector}, ${second.sector} 섹터가 우선입니다. 단, 지금은 시장 RSI 과열이라 조건 충족 전까지 추격하지 않습니다.`
        : first
            ? `다음 전환 감시는 ${first.sector} 섹터가 우선입니다. 조건 충족 전까지 추격하지 않습니다.`
            : "지금은 새 전환 후보보다 기존 보유 보호가 우선입니다.",
      currentAction: "즉시 전환이 아니라 후보 감시와 보호 우선",
      switchRule: "StockEasy는 베이스 레이더로만 쓰고, 전환은 StockEasy 상승/RS 유지 + 교차소스 2개 이상 확인 + 차트 전환 신호 + 뉴스 호재 우세 + 기존 과열 보유 보호 트리거 중 2개 이상이 맞을 때만 실행합니다.",
    },
    watch,
    excluded,
  };
}

async function loadCurrentPortfolio() {
  return readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] });
}

function buildCrowdedExposures(portfolio) {
  const total = array(portfolio?.accounts).reduce(
    (sum, account) => sum + array(account.holdings).reduce((inner, holding) => inner + (Number(holding.marketValue) || 0), 0),
    0,
  );
  const byCategory = new Map();
  for (const account of array(portfolio?.accounts)) {
    for (const holding of array(account.holdings)) {
      const value = Number(holding.marketValue) || 0;
      if (value <= 0) continue;
      const category = categoryForHolding(account.key, holding.code) ?? "기타";
      const item =
        byCategory.get(category) ??
        {
          category,
          marketValue: 0,
          holdingCount: 0,
          names: [],
        };
      item.marketValue += value;
      item.holdingCount += 1;
      item.names.push(holding.name ?? holding.code);
      byCategory.set(category, item);
    }
  }
  return [...byCategory.values()]
    .map((item) => ({
      ...item,
      marketValue: round(item.marketValue, 0),
      weightPct: total > 0 ? round((item.marketValue / total) * 100, 1) : null,
      names: item.names.slice(0, 6),
      risk:
        item.holdingCount >= 3 || Number(item.marketValue ?? 0) / Math.max(total, 1) >= 0.18
          ? "집중점검"
          : "보통",
    }))
    .sort((left, right) => Number(right.marketValue ?? 0) - Number(left.marketValue ?? 0))
    .slice(0, 10);
}

function reduceFirstFromStockPulse(record) {
  return array(record?.stockPulseItems)
    .filter((item) => item.urgency === "높음" || /익절|추격금지|손절|감량/.test(item.verdict ?? ""))
    .map((item) => ({
      code: item.code ?? null,
      name: item.name,
      category: item.category ?? null,
      verdict: item.verdict ?? "확인",
      urgency: item.urgency ?? "낮음",
      profitRate: round(item.position?.profitRate, 2),
      rsi: round(item.technical?.rsi, 2),
      trigger: compactText(item.doNow ?? item.oneLine, 150),
      doNot: compactText(item.doNot, 110),
    }))
    .slice(0, 10);
}

function roleGapsFromStage4(record) {
  return array(record?.accountPlans)
    .map((plan) => ({
      accountKey: plan.key,
      accountLabel: plan.label ?? plan.key,
      gapCategory: plan.topGap?.category ?? null,
      gapAmount: round(plan.topGap?.gapAmount, 0),
      candidate: plan.candidateFromGap ?? null,
      noAction: Boolean(plan.noAction),
      reason: compactText(plan.noActionReason, 120),
    }))
    .filter((item) => item.gapCategory || item.candidate || item.noAction);
}

function buildPortfolioImplications({ records, themeRotation, sectorRotation, portfolio }) {
  const latest = records.at(-1) ?? {};
  const crowdedExposures = buildCrowdedExposures(portfolio);
  const reduceFirst = reduceFirstFromStockPulse(latest);
  const emergingThemes = themeRotation
    .filter((item) => ["신규부상", "강화중"].includes(item.status))
    .slice(0, 6);
  const emergingSectors = sectorRotation
    .filter((item) => ["신규섹터", "교체감시", "강화중"].includes(item.status))
    .slice(0, 5);
  const weakeningThemes = themeRotation
    .filter((item) => ["과열감량", "약화중"].includes(item.status))
    .slice(0, 6);

  return {
    stance:
      reduceFirst.length > 0
        ? "보호우선"
        : emergingThemes.length > 0
          ? "로테이션관찰"
          : "관찰유지",
    crowdedExposures,
    reduceFirst,
    emergingSectors,
    emergingThemes,
    weakeningThemes,
    roleGaps: roleGapsFromStage4(latest),
    rules: [
      "신규 매수는 3주 로테이션 강화 + 당일 과열 완화 + 계좌 부족 자산군 일치가 동시에 필요합니다.",
      "기존 주도 섹터가 과열감량으로 바뀌면 추가매수보다 20일선/RSI 하락반전 감시를 우선합니다.",
      "하락장 트리거가 켜지면 수익권·고RSI·중복테마 순서로 감량 후보를 정합니다.",
    ],
  };
}

function buildScenarioPlaybook(marketTrend, portfolioImplications) {
  const firstReduce = portfolioImplications.reduceFirst.slice(0, 4).map((item) => item.name);
  const emerging = portfolioImplications.emergingThemes.slice(0, 4).map((item) => item.theme);
  return [
    {
      scenario: "상승 지속",
      trigger: "시장 RSI가 70 이하로 식고 20일선 위에서 거래대금이 유지될 때",
      action: "기존 보유는 유지하되 신규매수는 계좌 부족 자산군과 일치하는 후보만 분할 검토",
      firstMoves: emerging.length ? emerging : ["미국인덱스", "금/원자재", "방산"],
    },
    {
      scenario: "주도 섹터 교체",
      trigger: "AI/전력/반도체 과열이 꺾이고 방산·원자력·금/원자재·배당 쪽 상대강도가 개선될 때",
      action: "과열 테마는 추가매수 금지, 새 주도 후보는 ETF 구성·수급·뉴스 확인 후 후보 승격",
      firstMoves: emerging.length ? emerging : ["SMR 원자력", "방산 수출", "금/원자재 헤지"],
    },
    {
      scenario: "하락장 전환",
      trigger: marketTrend.riskTriggers.length
        ? marketTrend.riskTriggers.slice(0, 3).join(" / ")
        : "지수 20일선 이탈, VIX 상승, 금리·환율·유가 동시 악화",
      action: "현금 확보가 우선이며 수익권·고RSI·중복 테마부터 감량 후보로 올림",
      firstMoves: firstReduce.length ? firstReduce : ["고RSI 수익권 ETF", "중복 테마", "근거 약한 보유종목"],
    },
  ];
}

function buildWeeklyChecklist(marketTrend, portfolioImplications) {
  return [
    `레짐: ${marketTrend.currentRegime ?? "-"} 유지 여부와 RSI ${marketTrend.currentRsi ?? "-"} 과열 해소 확인`,
    "AI/전력/반도체는 추가매수보다 20일선 이탈·RSI 하락반전·거래량 급증 후 식는지 확인",
    "방산·원자력·금/원자재·배당/커버드콜 중 새로 상대강도가 붙는 섹터를 ETF 후보로 분리",
    "계좌 부족 자산군과 후보 섹터가 다르면 매수 후보에서 제외",
    portfolioImplications.reduceFirst[0]
      ? `${portfolioImplications.reduceFirst[0].name}은 ${portfolioImplications.reduceFirst[0].trigger}`
      : "고긴급 보유종목이 생기면 감량/보호 트리거를 먼저 기록",
  ];
}

function renderMarkdown(payload) {
  const lines = [
    `# ${payload.date} 3주 로테이션 감지판`,
    "",
    `- run_date: ${payload.runDate}`,
    `- effective_market_date: ${payload.effectiveMarketDate}`,
    `- run_id: ${payload.runId ?? "-"}`,
    `- lookback_days: ${payload.lookbackDays}`,
    `- included_dates: ${payload.includedDates.join(", ") || "-"}`,
    `- status: ${payload.status}`,
    "",
    "## 1. 결론",
    `- ${payload.summary.headline}`,
    `- 시장 모드: ${payload.marketTrend.mode}`,
    `- 포트폴리오 대응: ${payload.portfolioImplications.stance}`,
    `- 전환 답: ${payload.rotationTargets?.summary?.answer ?? "-"}`,
    `- 전환 규칙: ${payload.rotationTargets?.summary?.switchRule ?? "-"}`,
    "",
    "## 2. 시장 국면 변화",
    `- 현재 레짐: ${payload.marketTrend.currentRegime ?? "-"}`,
    `- 직전 레짐: ${payload.marketTrend.previousRegime ?? "-"}`,
    `- 포트폴리오 점수 변화: ${payload.marketTrend.scoreDelta ?? "-"}`,
    `- 현재 RSI: ${payload.marketTrend.currentRsi ?? "-"}`,
    `- 과열 관측일: ${payload.marketTrend.overheatDays}/${payload.marketTrend.observedDays}`,
    "- 하락장 트리거:",
    ...(payload.marketTrend.riskTriggers.length
      ? payload.marketTrend.riskTriggers.map((item) => `  - ${item}`)
      : ["  - 아직 구조적 트리거가 충분히 누적되지 않았습니다."]),
    "",
    "## 3. 앞으로 유심히 볼 섹터",
    "| 우선 | 섹터 | 지금 행동 | 현재판정 | 교차검증 | 전환 조건 | 무효 조건 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(payload.rotationTargets?.watch ?? []).slice(0, 6).map(
      (item) =>
        `| ${item.priority} | ${item.sector} | ${item.action} | ${item.verdict} | ${item.sourceConsensus?.label ?? "-"} / ${compactText(item.sourceConsensus?.supportSummary, 55)} | ${compactText(item.switchWhen, 100)} | ${compactText(item.invalidation, 80)} |`,
    ),
    "",
    "## 4. 전환 트리거 보드",
    `- ${payload.transitionTriggerBoard?.summary ?? "차트/뉴스/교차소스 트리거를 확인합니다."}`,
    "| 트리거 | 섹터 | 현재판정 | 차트 | 뉴스 | 들어갈 조건 | 막는 조건 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(payload.transitionTriggerBoard?.rows ?? []).slice(0, 8).map(
      (item) =>
        `| ${item.label} | ${item.sector} | ${item.verdict} | ${item.chart?.label ?? "-"} / ${compactText(item.chart?.detail, 60)} | ${item.news?.label ?? "-"} / ${compactText(item.news?.detail, 60)} | ${array(item.entryChecklist).slice(0, 3).join(", ")} | ${array(item.exitChecklist).slice(0, 3).join(", ")} |`,
    ),
    "",
    "## 5. 지금 전환 제외",
    ...(payload.rotationTargets?.excluded?.length
      ? payload.rotationTargets.excluded.slice(0, 6).map((item) => `- ${item.sector}: ${item.verdict} / ${compactText(item.invalidation, 100)}`)
      : ["- 명시적 제외 섹터가 없습니다."]),
    "",
    "## 6. 신규·강화 섹터 후보",
    "| 상태 | 섹터 | 하위테마 | 최근점수 | 변화 | 액션 | 판단 |",
    "| --- | --- | --- | ---: | ---: | --- | --- |",
    ...(payload.sectorRotation ?? []).slice(0, 8).map(
      (item) =>
        `| ${item.status} | ${item.sector} | ${item.themes.map((theme) => theme.theme).slice(0, 3).join(", ")} | ${item.recentScore ?? "-"} | ${item.momentum ?? "-"} | ${item.action} | ${compactText(item.note, 80)} |`,
    ),
    "",
    "## 7. 섹터 자기질문",
    "| 판정 | 섹터 | 질문 | 교차검증 | 상승근거 | 하방의심 | 결론 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(payload.sectorDeliberations ?? []).slice(0, 8).map(
      (item) =>
        `| ${item.verdict} | ${item.sector} | ${compactText(item.question, 60)} | ${item.sourceConsensus?.label ?? "-"} / ${compactText(item.sourceConsensus?.supportSummary, 70)} | ${compactText(item.bullCase?.[0], 90)} | ${compactText(item.bearCase?.[0], 90)} | ${compactText(item.finalAnswer, 90)} |`,
    ),
    "",
    "## 8. StockEasy 베이스 섹터 유니버스",
    "| 섹터 | 등락 | 신호 | RS | 대표 |",
    "| --- | ---: | ---: | ---: | --- |",
    ...(payload.stockeasySectorUniverse ?? []).slice(0, 12).map(
      (item) =>
        `| ${item.sector} | ${item.changePct ?? "-"} | ${item.signal ?? "-"} | ${item.rsScore ?? "-"} | ${array(item.leaders).map((leader) => leader.name).slice(0, 3).join(", ") || "-"} |`,
    ),
    "",
    "## 9. 섹터/테마 로테이션",
    "| 상태 | 섹터 | 테마 | 최근점수 | 변화 | 액션 | 이유 |",
    "| --- | --- | --- | ---: | ---: | --- | --- |",
    ...payload.themeRotation.slice(0, 12).map(
      (item) =>
        `| ${item.status} | ${item.sector ?? "-"} | ${item.theme} | ${item.recentScore ?? "-"} | ${item.momentum ?? "-"} | ${item.action} | ${compactText(item.reason, 80)} |`,
    ),
    "",
    "## 10. 내 계좌에 미치는 영향",
    "### 먼저 보호/감량 감시할 보유",
    ...(payload.portfolioImplications.reduceFirst.length
      ? payload.portfolioImplications.reduceFirst
          .slice(0, 8)
          .map((item) => `- ${item.name}: ${item.verdict} / RSI ${item.rsi ?? "-"} / 손익 ${item.profitRate ?? "-"}% / ${item.trigger}`)
      : ["- 현재 고긴급 보호 후보가 없습니다."]),
    "",
    "### 집중 노출",
    ...(payload.portfolioImplications.crowdedExposures.length
      ? payload.portfolioImplications.crowdedExposures
          .slice(0, 8)
          .map((item) => `- ${item.category}: ${item.weightPct ?? "-"}% / ${item.holdingCount}개 / ${item.risk}`)
      : ["- 집중 노출을 계산할 수 없습니다."]),
    "",
    "### 부족 자산군",
    ...(payload.portfolioImplications.roleGaps.length
      ? payload.portfolioImplications.roleGaps.map(
          (item) => `- ${item.accountLabel}: ${item.gapCategory ?? "-"} ${item.gapAmount ?? "-"}원 / 후보 ${item.candidate ?? "-"} / ${item.reason}`,
        )
      : ["- 계좌 부족 자산군 정보가 없습니다."]),
    "",
    "## 11. 시나리오별 행동",
    ...payload.scenarioPlaybook.flatMap((item) => [
      `### ${item.scenario}`,
      `- 트리거: ${item.trigger}`,
      `- 액션: ${item.action}`,
      `- 먼저 볼 대상: ${item.firstMoves.join(", ") || "-"}`,
      "",
    ]),
    "## 12. 이번 주 체크리스트",
    ...payload.weeklyChecklist.map((item) => `- ${item}`),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseDateArgs(argv);
  const extra = parseExtraArgs(argv);
  const dates = await listAnalysisDates(args.date, extra.lookbackDays);
  const records = await loadRecords(dates);
  const portfolio = await loadCurrentPortfolio();
  const stockeasyHistory = await loadStockeasyHistory(args.date, extra.lookbackDays);

  const marketTrend = buildMarketTrend(records);
  const themeRotation = buildThemeRotation(records);
  const sectorRotation = buildSectorRotation(themeRotation);
  const portfolioImplications = buildPortfolioImplications({ records, themeRotation, sectorRotation, portfolio });
  const sectorDeliberations = buildSectorDeliberations({ sectorRotation, themeRotation, records, stockeasyHistory, portfolioImplications });
  const rotationTargets = buildRotationTargets(sectorDeliberations);
  const transitionTriggerBoard = buildTransitionTriggerBoard(sectorDeliberations);
  const stockeasySectorUniverse = buildStockeasyUniverse(stockeasyHistory);
  const scenarioPlaybook = buildScenarioPlaybook(marketTrend, portfolioImplications);
  const weeklyChecklist = buildWeeklyChecklist(marketTrend, portfolioImplications);
  const latest = records.at(-1) ?? {};
  const status = records.length >= 2 ? "ok" : "warn";

  const payload = {
    ...buildRunMetadata(args),
    status,
    lookbackDays: extra.lookbackDays,
    includedDates: records.map((record) => record.date),
    summary: {
      headline: marketTrend.headline,
      mode: marketTrend.mode,
      stance: portfolioImplications.stance,
      latestMacroSummary: compactText(latest?.stage2?.macro_view?.summary, 220),
      nextAction:
        portfolioImplications.reduceFirst.length > 0
          ? "고RSI 수익권 보유를 먼저 보호하고, 새 섹터는 후보화만 합니다."
          : "로테이션 후보를 주간 단위로 승격/탈락시킵니다.",
    },
    marketTrend,
    rotationTargets,
    transitionTriggerBoard,
    sectorRotation,
    sectorDeliberations,
    stockeasySectorUniverse,
    themeRotation,
    portfolioImplications,
    conceptGuide: buildConceptGuide(),
    scenarioPlaybook,
    weeklyChecklist,
    dataNeeds: [
      records.length < 4 ? "3주 롤링 판단을 강화하려면 거래일 4개 이상 누적 필요" : null,
      "StockEasy는 베이스 레이더이며 리포트/MarketVoice/KIS ETF/뉴스/기술지표 중 2개 이상 교차확인 전까지 전환 확신도를 낮게 취급",
      "전환은 차트 20일선·RSI·MACD·거래량 신호와 뉴스 호재/악재 방향이 같이 맞을 때만 후보 승격",
      "ETF NAV·구성·수급이 없는 후보는 매수 후보가 아니라 관찰 후보",
    ].filter(Boolean),
    artifacts: {
      json: `data/analysis-state/${args.date}/rotation-watch.json`,
      markdown: `reports/daily/${args.date}-rotation-watch.md`,
      dashboardView: `data/dashboard/${args.date}-dashboard-view.json`,
    },
  };

  const jsonPath = args.output
    ? path.resolve(ROOT_DIR, args.output)
    : path.join(ROOT_DIR, "data", "analysis-state", args.date, "rotation-watch.json");
  const markdownPath = args.markdown
    ? path.resolve(ROOT_DIR, args.markdown)
    : path.join(ROOT_DIR, "reports", "daily", `${args.date}-rotation-watch.md`);

  await writeJson(jsonPath, payload);
  await writeText(markdownPath, renderMarkdown(payload));
  console.log(`Wrote rotation watch to ${jsonPath}`);
  console.log(`Wrote rotation watch markdown to ${markdownPath}`);
  console.log(`status=${payload.status} dates=${payload.includedDates.length} mode=${payload.marketTrend.mode}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
