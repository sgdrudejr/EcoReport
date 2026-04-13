#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import {
  ROOT_DIR,
  buildRunMetadata,
  normalizeLooseName,
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

const MAX_BUCKETS_PER_CARD = 1;
const MAX_BUCKET_LINES = 8;
const MIN_BUCKET_LINES = 3;
const OTHER_BUCKET_ALLOWED_REPORT_TYPES = new Set(["macro", "industry", "theme"]);

const POSITIVE_PATTERN =
  /긍정|개선|회복|상향|확대|증가|견조|안정화|완화|반등|유효|추천|최선호|매력|수혜|부각|유리|성장|호조/;
const NEGATIVE_PATTERN =
  /부정|악화|하향|둔화|부담|우려|리스크|압박|불확실성|하락|감소|약세|훼손|무효화|제한적|장기화|지연|침체|손실/;
const CONDITION_PATTERN =
  /만약|경우|시\b|된다면|될 경우|지속된다면|지속될 경우|완화될 경우|안정화될 경우|유지될 경우|상승할 경우|하락할 경우|장기화될 경우|마무리될 경우|재개될 경우|확대될 경우|축소될 경우|종전\s*시|달성\s*시|상회\s*시|하회\s*시/;
const COUNTERPOINT_PATTERN = /반면|그러나|다만|리스크|우려|부담|불확실성|압박|약세|하락|감소|둔화|장기화|지연|재점화|악화/;
const NOISE_PATTERN =
  /자료\s*:|Research Center|Bloomberg|QuantiWise|DART|Relative to|주가수익률|시가총액|괴리율|수익률|URL\s*:|www\.|@[A-Za-z0-9.-]+|그림\s*\d+|표\s*\d+|Chart|Figure|52\s*주\s*최고가|외국인\s*지분율|발행주식수|일평균\s*거래대금|상위\s*업종|하위\s*업종|Top\s*10|Top Picks|종목코드|종목\s*업종|1W\s*조정률|1M\s*누적|3M\s*누적|유니버스\s*200|기관투자자|고지사항|Compliance|투자등급|괴리율|Morning Letter|Bubble Index|ETF Flow|순매수|순매도|기관 매매|외국인 매매|ADR|GDR|Close\s+D-1|D-5|D-20|Event\s+국가\s+지표|u Korea|u Global|u Risk Factors|학술\s*목적|사전\s*통보|투자전략정보팀|리서치본부|모닝코멘트|기업개요|사업개요|회사개요|주주구성|요약\s*재무제표|Status\s*\.xlsx|IR협의회|콥데이|기업소개|FinBERT|심리\s*비율|교차\s*결합|Bubble|Sentiment/i;
const MARKET_RELEVANT_REPORT_TYPES = new Set(["macro", "industry", "strategy", "theme"]);

const BUCKET_DEFINITIONS = [
  {
    id: "direct_holdings",
    label: "직접 보유종목",
    description: "내 보유 종목이나 ETF에 직접 연결되는 카드",
    priority: 100,
    minScore: 1,
  },
  {
    id: "geopolitics_regime",
    label: "지정학·리스크 레짐",
    description: "전쟁, 휴전, 제재, 공급망 충격처럼 시장 레짐을 바꾸는 이벤트",
    keywords: ["휴전", "종전", "전쟁", "지정학", "중동", "봉쇄", "갈등", "확전", "협상", "제재", "공급망"],
    priority: 96,
    minScore: 5,
  },
  {
    id: "rates_policy",
    label: "금리·통화정책",
    description: "연준, 기준금리, 채권금리, 크레딧 환경",
    keywords: ["금리", "연준", "fomc", "기준금리", "국고채", "회사채", "채권", "신용스프레드", "장단기금리차", "통화정책", "긴축", "완화"],
    themes: ["금리/매크로"],
    sectors: ["매크로"],
    priority: 90,
    minScore: 5,
  },
  {
    id: "credit_liquidity",
    label: "신용·유동성",
    description: "크레딧, 조달 여건, 스프레드, 유동성 압박",
    keywords: ["신용", "스프레드", "조달", "회사채", "유동성", "스트레스", "부도", "차환", "자금조달", "사모신용"],
    themes: ["금리/매크로"],
    sectors: ["매크로"],
    priority: 89,
    minScore: 5,
  },
  {
    id: "fx_dollar",
    label: "환율·달러",
    description: "원달러, 달러인덱스, 주요 통화 방향",
    keywords: ["환율", "달러", "원달러", "달러인덱스", "외환", "엔화", "위안", "유로", "fx"],
    priority: 88,
    minScore: 5,
  },
  {
    id: "oil_energy",
    label: "유가·에너지",
    description: "원유, 천연가스, 중동 리스크, 에너지 가격",
    keywords: ["유가", "원유", "브렌트", "wti", "두바이유", "호르무즈", "천연가스", "정유", "유류"],
    priority: 87,
    minScore: 5,
  },
  {
    id: "metals_commodities",
    label: "금·원자재",
    description: "금, 구리, 금속, 원자재 가격 논리",
    keywords: ["금가격", "gold", "comex 금", "귀금속", "온스", "구리", "은 가격", "알루미늄", "철광석", "원자재", "commodity", "금속", "철근"],
    priority: 84,
    minScore: 5,
  },
  {
    id: "inflation_trade_policy",
    label: "물가·관세·정책",
    description: "인플레이션, 관세, 재정/산업정책 영향",
    keywords: ["물가", "인플레", "인플레이션", "관세", "tariff", "232조", "포고령", "무역", "재정", "예산", "세출", "보조금", "산업정책"],
    priority: 82,
    minScore: 5,
  },
  {
    id: "us_equities",
    label: "미국증시·빅테크",
    description: "S&P500, 나스닥, 빅테크, 미국 주식 방향",
    keywords: ["s&p", "nasdaq", "dow", "미국 증시", "미국증시", "미국 주식", "big tech", "magnificent", "러셀", "미국지수"],
    priority: 80,
    minScore: 5,
  },
  {
    id: "korea_equities",
    label: "한국증시·수급",
    description: "코스피, 코스닥, 수급, 스타일 회전",
    keywords: ["kospi", "kosdaq", "국내증시", "한국증시", "코스피", "코스닥", "외국인", "기관", "수급", "밸류업"],
    priority: 79,
    minScore: 5,
  },
  {
    id: "global_equities",
    label: "중국·유럽·일본·신흥국",
    description: "미국 외 글로벌 증시와 지역별 사이클",
    keywords: ["중국", "유럽", "일본", "신흥국", "상해", "홍콩", "유로존", "독일", "프랑스", "대만", "브라질", "인도"],
    priority: 74,
    minScore: 5,
  },
  {
    id: "semiconductors",
    label: "반도체·메모리",
    description: "반도체, HBM, 메모리, 패키징",
    keywords: ["반도체", "hbm", "dram", "낸드", "nand", "패키징", "foundry", "memory", "cxl"],
    sectors: ["반도체"],
    priority: 78,
    minScore: 4,
  },
  {
    id: "ai_infra",
    label: "AI 인프라·데이터센터",
    description: "GPU, 데이터센터, 광통신, 스토리지",
    keywords: ["데이터센터", "gpu", "cpo", "광트랜시버", "스토리지", "서버", "하이퍼스케일러", "액침냉각", "ssd", "hbm", "ai capex"],
    themes: ["AI 인프라"],
    sectors: ["AI/인프라"],
    priority: 77,
    minScore: 4,
  },
  {
    id: "power_grid",
    label: "전력 인프라·원자력",
    description: "전력기기, 변압기, 송배전, 원전 밸류체인",
    keywords: ["전력", "변압기", "전력기기", "송배전", "전력망", "초고압", "765kv", "수주잔고", "원자력", "원전", "smr", "터빈"],
    themes: ["전력 인프라"],
    sectors: ["전력기기", "원자력"],
    priority: 76,
    minScore: 4,
  },
  {
    id: "defense_aerospace",
    label: "방산·항공우주",
    description: "방산, 미사일, 우주, 군수, 항공우주",
    keywords: ["방산", "국방", "미사일", "탄약", "자주포", "kf-21", "위성", "항공우주", "우주", "군사", "nato"],
    themes: ["방산"],
    sectors: ["방산"],
    priority: 75,
    minScore: 4,
  },
  {
    id: "autos_industrials",
    label: "자동차·산업재",
    description: "자동차, 타이어, 산업재, 조선, 기계",
    keywords: ["자동차", "타이어", "pbv", "hev", "산업재", "조선", "기계", "모빌리티", "완성차", "자동차 부품"],
    priority: 70,
    minScore: 4,
  },
  {
    id: "telecom_network",
    label: "통신·네트워크",
    description: "5G/6G, 주파수, 네트워크 CAPEX",
    keywords: ["통신", "5g", "6g", "sa", "네트워크", "주파수", "capex", "통신서비스"],
    priority: 68,
    minScore: 4,
  },
  {
    id: "healthcare_biotech",
    label: "헬스케어·바이오",
    description: "제약, 바이오, 의료기기, 진단",
    keywords: ["제약", "바이오", "의료", "헬스케어", "의료기기", "진단", "임상", "약물", "치료제"],
    priority: 67,
    minScore: 4,
  },
  {
    id: "consumer_financials",
    label: "소비재·금융",
    description: "유통, 음식료, 은행, 보험, 증권",
    keywords: ["유통", "음식료", "은행", "보험", "증권", "카드", "화장품", "리테일", "백화점"],
    priority: 65,
    minScore: 4,
  },
  {
    id: "internet_media",
    label: "인터넷·미디어·엔터",
    description: "플랫폼, 게임, 광고, 콘텐츠, 엔터테인먼트",
    keywords: ["하이브", "엔터", "광고", "콘텐츠", "넷플릭스", "ott", "플랫폼", "웹툰", "뉴진스", "게임", "미디어"],
    priority: 64,
    minScore: 4,
  },
  {
    id: "construction_infra",
    label: "건설·플랜트·재건",
    description: "중동 재건, 플랜트, 해외수주, 인프라 건설",
    keywords: ["건설", "재건", "플랜트", "해외수주", "중동", "인프라", "현장", "토목", "주택", "정비사업"],
    priority: 63,
    minScore: 4,
  },
  {
    id: "other",
    label: "기타 시장축",
    description: "고정 버킷에 명확히 들어가지 않는 카드",
    priority: 10,
  },
];

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countMatches(value, pattern) {
  return (String(value ?? "").match(pattern) ?? []).length;
}

function isNoisyText(value) {
  const text = cleanText(value);
  if (!text || text.length < 20) return true;
  if (NOISE_PATTERN.test(text)) return true;

  const digitCount = countMatches(text, /\d/g);
  const alphaCount = countMatches(text, /[가-힣A-Za-z]/g);
  const percentCount = countMatches(text, /%/g);
  const arrowCount = countMatches(text, /[▶■◆●▪]/g);
  const pipeCount = countMatches(text, /[|]/g);
  const metricLabelCount = countMatches(text, /\(십억원\)|\(억원\)|매출액\s*\(좌\)|영업이익\s*\(우\)|현재\s*주가/g);
  const countryListHits = countMatches(
    text,
    /이집트|아랍에미리|사우디|이라크|카타르|알제리|리비아|바레인|모로코|요르단|오만|쿠웨이트|튀르키예|이란|예멘/g,
  );

  if (percentCount >= 5 && text.length < 240) return true;
  if (digitCount >= alphaCount && digitCount >= 16) return true;
  if (arrowCount >= 3 && text.length < 280) return true;
  if (pipeCount >= 4) return true;
  if (metricLabelCount >= 2) return true;
  if (countryListHits >= 8) return true;
  if (!/[다음음함됨임요]\.?$/.test(text) && digitCount >= 12 && text.length < 220) return true;

  return false;
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

function dedupeDistinctStrings(values, existing = [], limit) {
  const base = existing.map((value) => normalizeText(value));
  const result = [];

  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const normalized = normalizeText(text);
    if (base.some((item) => item === normalized || item.includes(normalized) || normalized.includes(item))) {
      continue;
    }
    if (result.some((item) => normalizeText(item) === normalized)) {
      continue;
    }
    result.push(text);
    if (typeof limit === "number" && result.length >= limit) break;
  }

  return result;
}

function chooseBestSnippet(candidates, { prefer = "neutral" } = {}) {
  const scored = candidates
    .map((candidate) => {
      const text = cleanText(candidate);
      if (!text) return null;

      let score = 0;
      if (!isNoisyText(text)) score += 8;
      if (text.length >= 40 && text.length <= 220) score += 5;
      if (CONDITION_PATTERN.test(text)) score += 3;
      if (COUNTERPOINT_PATTERN.test(text)) score += 3;
      score += Math.min(countMatches(text, /\d+(?:\.\d+)?(?:%|bp|조|억|원|달러|배)/g), 4);

      if (prefer === "positive") {
        if (POSITIVE_PATTERN.test(text)) score += 5;
        if (NEGATIVE_PATTERN.test(text)) score -= 2;
      } else if (prefer === "negative") {
        if (NEGATIVE_PATTERN.test(text)) score += 5;
        if (POSITIVE_PATTERN.test(text)) score -= 2;
      } else if (prefer === "condition") {
        if (CONDITION_PATTERN.test(text)) score += 5;
      }

      return { text, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.text ?? null;
}

function inferStance(text) {
  const value = cleanText(text);
  const positiveHits = countMatches(value, /긍정|개선|회복|상향|확대|증가|견조|안정화|완화|반등|유효|추천|최선호|매력|수혜|성장|호조/g);
  const negativeHits = countMatches(value, /부정|악화|하향|둔화|부담|우려|리스크|압박|불확실성|하락|감소|약세|장기화|지연|침체|손실/g);

  if (positiveHits > negativeHits) return "positive";
  if (negativeHits > positiveHits) return "negative";
  return "mixed";
}

function buildCardSummary(extract) {
  const snippets = [
    extract.claim,
    extract.bull_chunk,
    extract.risk_chunk,
    extract.keep_condition,
    extract.break_condition,
  ].filter(Boolean);

  const primarySnippet = chooseBestSnippet(snippets, { prefer: "neutral" });
  const positiveSnippet = chooseBestSnippet([extract.bull_chunk, extract.claim, extract.keep_condition].filter(Boolean), {
    prefer: "positive",
  });
  const negativeSnippet = chooseBestSnippet([extract.risk_chunk, extract.break_condition, extract.claim].filter(Boolean), {
    prefer: "negative",
  });
  const keepSnippet = chooseBestSnippet([extract.keep_condition, extract.claim].filter(Boolean), { prefer: "condition" });
  const breakSnippet = chooseBestSnippet([extract.break_condition, extract.risk_chunk].filter(Boolean), {
    prefer: "negative",
  });

  const importanceScore =
    (primarySnippet ? 2 : 0) +
    (keepSnippet ? 2 : 0) +
    (breakSnippet ? 2 : 0) +
    (extract.key_numbers?.length ? 1 : 0) +
    (extract.quality?.selected_chunk_count >= 2 ? 1 : 0) +
    (!isNoisyText(primarySnippet) ? 1 : 0);

  return {
    primarySnippet,
    positiveSnippet,
    negativeSnippet,
    keepSnippet,
    breakSnippet,
    stance: inferStance(`${positiveSnippet ?? ""}\n${negativeSnippet ?? ""}\n${primarySnippet ?? ""}`),
    importanceScore,
  };
}

function loadHoldings(portfolio) {
  const holdings = [];
  const seen = new Set();

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account?.holdings ?? []) {
      const code = String(holding?.code ?? holding?.ticker ?? "").trim();
      const name = String(holding?.name ?? "").trim();
      const key = `${code}:${name}`;
      if (!code || !name || seen.has(key)) continue;
      seen.add(key);
      holdings.push({
        code,
        name,
        looseName: normalizeLooseName(name),
        accountKey: account.key,
      });
    }
  }

  return holdings;
}

function detectDirectHoldingMatches(extract, holdings) {
  const combined = cleanText(
    [
      extract.title,
      extract.ticker_name,
      extract.claim,
      extract.keep_condition,
      extract.break_condition,
      extract.bull_chunk,
      extract.risk_chunk,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const normalized = normalizeText(combined);
  const looseCombined = normalizeLooseName(combined);

  return holdings.filter((holding) => {
    if (holding.code && normalized.includes(normalizeText(holding.code))) return true;
    if (holding.name && normalized.includes(normalizeText(holding.name))) return true;
    if (holding.looseName && looseCombined.includes(holding.looseName)) return true;
    return false;
  });
}

function countKeywordHits(text, keywords) {
  const normalized = normalizeText(text);
  let hits = 0;
  for (const keyword of keywords ?? []) {
    if (!keyword) continue;
    if (normalized.includes(normalizeText(keyword))) {
      hits += 1;
    }
  }
  return hits;
}

function buildBucketContext(extract, cardSummary) {
  const titleText = cleanText([extract.title, extract.ticker_name].filter(Boolean).join(" "));
  const evidenceTexts = [
    cardSummary.primarySnippet,
    cardSummary.positiveSnippet,
    cardSummary.negativeSnippet,
    cardSummary.keepSnippet,
    cardSummary.breakSnippet,
  ]
    .filter(Boolean)
    .filter((text, index, values) => values.indexOf(text) === index);
  const evidenceText = cleanText(evidenceTexts.join("\n"));
  const analysisText = cleanText(
    [
      extract.claim,
      extract.keep_condition,
      extract.break_condition,
      extract.bull_chunk,
      extract.risk_chunk,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return {
    titleText,
    evidenceTexts,
    evidenceText,
    analysisText,
  };
}

function scoreBucket(bucket, extract, cardSummary, holdingMatches) {
  if (bucket.id === "direct_holdings") {
    return holdingMatches.length > 0 ? 12 + holdingMatches.length * 2 : 0;
  }

  const context = buildBucketContext(extract, cardSummary);
  const normalizedAnalysis = normalizeText(context.analysisText);
  const titleHits = countKeywordHits(context.titleText, bucket.keywords);
  const evidenceHits = countKeywordHits(context.evidenceText, bucket.keywords);
  const analysisHits = countKeywordHits(context.analysisText, bucket.keywords);
  const themeHits = (bucket.themes ?? []).filter((theme) => (extract.themes ?? []).includes(theme)).length;
  const sectorHits = (bucket.sectors ?? []).filter((sector) => extract.sector === sector).length;
  const textualHits = titleHits + evidenceHits + analysisHits;

  if (textualHits === 0) {
    return 0;
  }

  let score = titleHits * 3 + evidenceHits * 2 + analysisHits + themeHits + sectorHits;

  if (bucket.id === "geopolitics_regime" && /휴전|종전|전쟁|갈등|확전|제재|봉쇄/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "rates_policy" && /금리|연준|fomc|장단기/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "credit_liquidity" && /신용|스프레드|조달|유동성|스트레스|부도/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "fx_dollar" && /환율|원달러|달러인덱스|엔화|위안|유로/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "oil_energy" && /유가|원유|브렌트|wti|두바이유|호르무즈|천연가스/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "metals_commodities" && /gold|금가격|귀금속|온스|구리|알루미늄|철광석/.test(normalizeText(context.analysisText))) score += 3;
  if (bucket.id === "inflation_trade_policy" && /물가|인플레이션|관세|tariff|232조|무역|보조금/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "us_equities" && /s&p|nasdaq|dow|big tech|러셀|미국 증시/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "korea_equities" && /kospi|kosdaq|외국인|기관|수급|밸류업/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "global_equities" && /중국|유럽|일본|홍콩|대만|신흥국|인도|브라질/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "semiconductors" && /반도체|hbm|dram|nand|패키징|foundry|cxl/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "ai_infra" && /데이터센터|gpu|서버|광트랜시버|액침냉각|스토리지|하이퍼스케일러/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "power_grid" && /전력|변압기|전력기기|송배전|전력망|초고압|원자력|원전|smr/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "defense_aerospace" && /방산|국방|미사일|탄약|자주포|항공우주|위성|nato/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "autos_industrials" && /자동차|타이어|pbv|hev|조선|산업재|모빌리티|완성차/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "telecom_network" && /통신|5g|6g|주파수|네트워크|capex|sa/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "healthcare_biotech" && /제약|바이오|의료기기|진단|임상|치료제/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "consumer_financials" && /은행|보험|증권|카드|유통|음식료|리테일|화장품/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "internet_media" && /하이브|엔터|광고|콘텐츠|넷플릭스|ott|플랫폼|웹툰|뉴진스|게임|미디어/.test(normalizedAnalysis)) score += 3;
  if (bucket.id === "construction_infra" && /건설|재건|플랜트|해외수주|중동|인프라|토목|정비사업/.test(normalizedAnalysis)) score += 3;

  if (isNoisyText(context.evidenceText) && isNoisyText(context.analysisText)) {
    score -= 4;
  }

  return score >= (bucket.minScore ?? 4) ? score : 0;
}

function classifyBuckets(extract, cardSummary, holdingMatches) {
  const scored = BUCKET_DEFINITIONS.map((bucket) => ({
    bucket,
    score: scoreBucket(bucket, extract, cardSummary, holdingMatches),
  }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.bucket.priority - left.bucket.priority);

  const direct = scored.filter((item) => item.bucket.id === "direct_holdings").slice(0, 1);
  const thematic = scored
    .filter((item) => item.bucket.id !== "direct_holdings")
    .slice(0, MAX_BUCKETS_PER_CARD);
  const combined = [...direct, ...thematic];

  if (combined.length === 0) {
    return ["other"];
  }

  return dedupeStrings(combined.map((item) => item.bucket.id));
}

function normalizeCard(extract, holdings) {
  const cardSummary = buildCardSummary(extract);
  const holdingMatches = detectDirectHoldingMatches(extract, holdings);
  const bucketIds = classifyBuckets(extract, cardSummary, holdingMatches);
  const isBroadMarketReport = MARKET_RELEVANT_REPORT_TYPES.has(String(extract.report_type ?? "").trim());
  const hasCleanSnippet = [
    cardSummary.primarySnippet,
    cardSummary.positiveSnippet,
    cardSummary.negativeSnippet,
    cardSummary.keepSnippet,
    cardSummary.breakSnippet,
  ].some((snippet) => snippet && !isNoisyText(snippet));
  const rawCombined = cleanText(
    [extract.claim, extract.keep_condition, extract.break_condition, extract.bull_chunk, extract.risk_chunk]
      .filter(Boolean)
      .join("\n"),
  );
  const hasMetaOnlyPattern = /학술\s*목적|사전\s*통보|투자전략정보팀|리서치본부|모닝코멘트/.test(rawCombined);

  if (hasMetaOnlyPattern) {
    return null;
  }

  if (!hasCleanSnippet) {
    return null;
  }

  if (
    bucketIds.length === 1 &&
    bucketIds[0] === "other" &&
    holdingMatches.length === 0 &&
    (!isBroadMarketReport || cardSummary.importanceScore < 6)
  ) {
    return null;
  }

  if (bucketIds.length === 1 && bucketIds[0] === "other") {
    const hasConditionEdge = Boolean(cardSummary.keepSnippet || cardSummary.breakSnippet);
    const hasCounterNarrative =
      COUNTERPOINT_PATTERN.test(rawCombined) || CONDITION_PATTERN.test(rawCombined);

    if (!OTHER_BUCKET_ALLOWED_REPORT_TYPES.has(String(extract.report_type ?? "").trim())) {
      return null;
    }

    if (cardSummary.importanceScore < 6 && !hasConditionEdge) {
      return null;
    }

    if (!hasCounterNarrative && cardSummary.importanceScore < 7) {
      return null;
    }
  }

  return {
    report_id: extract.report_id,
    title: extract.title,
    broker: extract.broker,
    report_type: extract.report_type,
    sector: extract.sector,
    themes: extract.themes ?? [],
    key_numbers: extract.key_numbers ?? [],
    bucket_ids: bucketIds,
    matched_holdings: holdingMatches.map((holding) => holding.name),
    primary_snippet: cardSummary.primarySnippet,
    positive_snippet: cardSummary.positiveSnippet,
    negative_snippet: cardSummary.negativeSnippet,
    keep_condition: cardSummary.keepSnippet,
    break_condition: cardSummary.breakSnippet,
    stance: cardSummary.stance,
    importance_score: cardSummary.importanceScore,
  };
}

function buildBucketInsightLines(bucket, cards, summary) {
  const lines = [];

  lines.push(`${bucket.label}에서는 ${cards.length}개 카드가 ${summary.reportCount}개 리포트에서 남았고, 오늘 시장을 설명하는 하나의 축으로 묶였습니다.`);

  if (summary.commonClaims.length > 0) {
    lines.push(`주요 주장은 ${summary.commonClaims.slice(0, 2).join(" / ")} 입니다.`);
  }

  if (summary.conflictingClaims.length > 0) {
    lines.push(`반대편 논리는 ${summary.conflictingClaims.join(" / ")} 입니다.`);
  } else {
    lines.push("반대편 논리는 아직 제한적이어서 동일 방향 해석이 더 우세합니다.");
  }

  if (summary.keepConditions.length > 0) {
    lines.push(`유지 조건은 ${summary.keepConditions.join(" / ")} 입니다.`);
  }

  if (summary.breakConditions.length > 0) {
    lines.push(`깨지는 조건은 ${summary.breakConditions.join(" / ")} 입니다.`);
  }

  if (summary.keepConditions.length === 0 && summary.breakConditions.length === 0) {
    if (summary.reportCount <= 2) {
      lines.push("아직 카드 수가 적어서 탐색용 버킷으로만 유지하는 편이 안전합니다.");
    } else {
      lines.push("조건 문장은 아직 얕아서, 다음 사이클에서 카드가 더 쌓이면 유지/훼손 조건을 더 선명하게 만들 수 있습니다.");
    }
  }

  if (summary.matchedHoldings.length > 0) {
    lines.push(`직접 보유와 닿는 종목/ETF는 ${summary.matchedHoldings.join(", ")} 입니다.`);
  }

  if (summary.topReports.length > 0) {
    lines.push(`대표 근거 리포트는 ${summary.topReports.join(", ")} 입니다.`);
  }

  while (lines.length < MIN_BUCKET_LINES) {
    lines.push("이 버킷은 아직 탐색 단계이므로 다음 배치에서 추가 근거 확인이 필요합니다.");
  }

  return lines.slice(0, MAX_BUCKET_LINES);
}

function summarizeBucket(bucket, cards) {
  const sorted = [...cards].sort((left, right) => right.importance_score - left.importance_score);
  const reportCount = new Set(cards.map((card) => card.report_id)).size;
  const commonClaims = dedupeStrings(
    sorted
      .map((card) => card.primary_snippet ?? card.positive_snippet)
      .filter((text) => text && !isNoisyText(text))
      .map((text) => truncate(text, 110)),
    3,
  );

  const positive = sorted
    .filter((card) => card.stance === "positive")
    .map((card) => card.positive_snippet ?? card.primary_snippet)
    .filter((text) => text && !isNoisyText(text));
  const negative = sorted
    .filter((card) => card.stance === "negative")
    .map((card) => card.negative_snippet ?? card.break_condition ?? card.primary_snippet)
    .filter((text) => text && !isNoisyText(text));

  const conflictingClaims = dedupeStrings(
    [
      positive[0] ? `강세 쪽은 ${truncate(positive[0], 110)}` : null,
      negative[0] ? `약세 쪽은 ${truncate(negative[0], 100)}` : null,
    ].filter(Boolean),
    2,
  );

  const keepConditions = dedupeDistinctStrings(
    sorted
      .map((card) => card.keep_condition)
      .filter((text) => text && !isNoisyText(text))
      .map((text) => truncate(text, 100)),
    [...commonClaims, ...conflictingClaims],
    2,
  );

  const breakConditions = dedupeDistinctStrings(
    sorted
      .map((card) => card.break_condition ?? card.negative_snippet)
      .filter((text) => text && !isNoisyText(text))
      .map((text) => truncate(text, 100)),
    [...commonClaims, ...conflictingClaims, ...keepConditions],
    2,
  );

  const prunedBreakConditions = breakConditions.filter(
    (item) =>
      !keepConditions.some((keep) => {
        const left = normalizeText(item);
        const right = normalizeText(keep);
        return left === right || left.includes(right) || right.includes(left);
      }),
  );

  const topEvidenceCards = sorted.slice(0, 5).map((card) => ({
    report_id: card.report_id,
    title: card.title,
    broker: card.broker,
    importance_score: card.importance_score,
    summary: truncate(card.primary_snippet ?? card.positive_snippet ?? card.negative_snippet ?? "", 180),
    key_numbers: (card.key_numbers ?? []).slice(0, 4),
  }));

  const topReports = dedupeStrings(topEvidenceCards.map((card) => card.title), 3);
  const matchedHoldings = dedupeStrings(cards.flatMap((card) => card.matched_holdings ?? []), 4);

  const summary = {
    bucket_id: bucket.id,
    bucket_label: bucket.label,
    description: bucket.description,
    reportCount,
    cardCount: cards.length,
    commonClaims,
    conflictingClaims,
    keepConditions,
    breakConditions: prunedBreakConditions,
    topEvidenceCards,
    topReports,
    matchedHoldings,
  };

  summary.insightLines = buildBucketInsightLines(bucket, cards, summary);
  return summary;
}

function buildMarkdown(payload) {
  const lines = [
    `# Stage 2 Shadow Topic Buckets (${payload.date})`,
    "",
    `- 리포트 수: ${payload.reportCount}`,
    `- 근거 카드 수: ${payload.cardCount}`,
    `- 활성 버킷 수: ${payload.bucketCount}`,
    `- 상위 버킷: ${payload.topBuckets.join(", ") || "없음"}`,
    "",
  ];

  for (const bucket of payload.buckets) {
    lines.push(`## ${bucket.bucket_label}`);
    for (const line of bucket.insightLines) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const shadowPaths = buildShadowPaths(ROOT_DIR, args.date);
  const shadowPath = path.join(
    ROOT_DIR,
    "data",
    "analysis-state",
    args.date,
    "stage1-shadow",
    "stage1-shadow-extracts.json",
  );
  const portfolioPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const outputJsonPath =
    args.output ??
    path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage2-shadow-topic-buckets.json");
  const outputMarkdownPath =
    args.markdown ??
    path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage2-shadow-topic-buckets.md");
  const canonicalJsonPath = path.join(shadowPaths.stage2Dir, "stage2-shadow-topic-buckets.json");
  const canonicalMarkdownPath = path.join(shadowPaths.stage2Dir, "stage2-shadow-topic-buckets.md");

  const [shadow, portfolio] = await Promise.all([
    readJson(shadowPath, null),
    readJson(portfolioPath, { accounts: [] }),
  ]);

  if (!shadow?.extracts?.length) {
    throw new Error(`Stage 1 shadow 입력이 없습니다: ${shadowPath}`);
  }

  const holdings = loadHoldings(portfolio);
  const cards = shadow.extracts.map((extract) => normalizeCard(extract, holdings)).filter(Boolean);

  const activeBuckets = [];
  for (const bucket of BUCKET_DEFINITIONS) {
    const bucketCards = cards.filter((card) => card.bucket_ids.includes(bucket.id));
    if (bucketCards.length === 0) continue;
    activeBuckets.push(summarizeBucket(bucket, bucketCards));
  }

  activeBuckets.sort((left, right) => right.cardCount - left.cardCount || right.reportCount - left.reportCount);

  const runMeta = buildRunMetadata(args);
  const payload = {
    ...runMeta,
    source: "stage1-shadow",
    reportCount: shadow.reportCount ?? shadow.extracts.length,
    cardCount: cards.length,
    bucketCount: activeBuckets.length,
    topBuckets: activeBuckets.filter((bucket) => bucket.bucket_id !== "other").slice(0, 8).map((bucket) => bucket.bucket_label),
    buckets: activeBuckets,
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

  logShadowSummary("stage2-shadow", [
    `reports=${payload.reportCount} cards=${payload.cardCount} buckets=${payload.bucketCount}`,
    `top_buckets=${payload.topBuckets.join(", ")}`,
    `output=${path.relative(ROOT_DIR, outputJsonPath)}`,
    `canonical=${path.relative(ROOT_DIR, canonicalJsonPath)}`,
  ]);
}

main().catch((error) => {
  console.error(`stage2 shadow topic buckets 생성 실패: ${error.message}`);
  process.exit(1);
});
