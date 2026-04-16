#!/usr/bin/env node
// 머니토링 시황을 수집해 포트폴리오/관심종목/딥리서치 관점으로 다시 연결합니다.

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  buildPortfolioMaps,
  buildRunMetadata,
  clamp,
  getCategory,
  parseDateArgs,
  readJson,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";
import { buildMarketVoicePaths } from "./lib/marketvoice-utils.js";

const MONEYTORING_API_URL = "https://api.moneytoring.ai/graphql";
const DEFAULT_TOPIC_LIMIT = 12;
const DEFAULT_DETAIL_LIMIT = 8;

const GET_MAVO_TOPIC_PAGINATION_QUERY = `
  query getMavoTopicPaginationQuery(
    $sortBy: MarketVoiceSortBy!
    $sourceTypeList: [MarketVoiceSourceTypeEnum]
    $keywordIdList: [ID!]
    $cursorPaginationInput: CursorPaginationInputType!
  ) {
    mavoTopicPagination(
      sortBy: $sortBy
      sourceTypeList: $sourceTypeList
      keywordIdList: $keywordIdList
      cursorPaginationInput: $cursorPaginationInput
    ) {
      topicList {
        id
        title
        summary
        displayUpdatedAt
        quoteCount
        imageUrlList
        mainSource {
          type
          name
          author
        }
        uniqueSourceTypeList
        keywordList {
          id
          name
          logo
          type
          code
          country
          fluctuationRate
        }
        topicDocumentSize
      }
    }
  }
`;

const GET_MARKET_VOICE_TOPIC_DETAIL_QUERY = `
  query getMarketVoiceTopicDetailQuery(
    $topicId: ID!
    $sortDirection: SortDirection!
  ) {
    marketVoiceTopicDetail(topicId: $topicId, sortDirection: $sortDirection) {
      id
      title
      displaySourceInfo {
        type
        count
      }
      subTopicList {
        id
        title
        summary
        displayCreatedAt
        displayUpdatedAt
        sourceOriginList {
          id
          title
          type
          author
          url
          displayCreatedAt
        }
      }
    }
  }
`;

const DEFAULT_SOURCE_TYPE_LIST = [
  "DISCLOSURE",
  "COMPANY_NEWS",
  "TELEGRAM",
  "YOUTUBE",
  "IR",
];

const CATEGORY_KEYWORDS = {
  미국인덱스: ["s&p500", "s&p 500", "미국증시", "미국 주식", "미국지수"],
  "S&P500": ["s&p500", "s&p 500", "미국증시", "미국 주식", "대형주"],
  "나스닥100": ["나스닥", "nasdaq", "빅테크", "엔비디아", "ai"],
  "배당/커버드콜": ["배당", "커버드콜", "인컴", "다우존스"],
  금: ["gold", "금", "귀금속", "안전자산", "금가격"],
  현금파킹: ["kofr", "금리", "단기금리", "현금", "유동성", "채권"],
  전력기기: ["전력", "변압기", "송배전", "전력 인프라", "데이터센터 전력"],
  방산: ["방산", "국방", "무기", "전차", "미사일", "nato"],
  원자력: ["원자력", "원전", "smr", "원자로", "전력 안보"],
};

const SIGNAL_RULES = [
  {
    id: "geopolitics-oil",
    label: "중동/유가",
    patterns: [/이란|중동|호르무즈|원유|유가|브렌트|wti/i],
    directions: {
      금: "positive",
      방산: "positive",
      현금파킹: "positive",
      미국인덱스: "negative",
      "S&P500": "negative",
      "나스닥100": "negative",
      원자력: "positive",
    },
    riskTags: ["geopolitics", "oil"],
    horizon: "1w",
    defaultDirection: "negative",
  },
  {
    id: "rates-fx",
    label: "금리/환율",
    patterns: [/금리|환율|원\/달러|달러 강세|채권금리|국채/i],
    directions: {
      현금파킹: "positive",
      금: "positive",
      미국인덱스: "negative",
      "S&P500": "negative",
      "나스닥100": "negative",
    },
    riskTags: ["rates", "fx"],
    horizon: "1w",
    defaultDirection: "negative",
  },
  {
    id: "ai-power",
    label: "AI 인프라/전력",
    patterns: [/ai|데이터센터|엔비디아|nvidia|tsmc|hbm|cpo|광트랜시버|전력 수요|전력 인프라/i],
    directions: {
      전력기기: "positive",
      미국인덱스: "positive",
      "S&P500": "positive",
      "나스닥100": "positive",
    },
    riskTags: ["ai", "power"],
    horizon: "1m",
    defaultDirection: "positive",
  },
  {
    id: "defense",
    label: "방산/국방",
    patterns: [/방산|국방|미사일|전차|nato|수주|군수/i],
    directions: {
      방산: "positive",
    },
    riskTags: ["defense"],
    horizon: "1m",
    defaultDirection: "positive",
  },
  {
    id: "nuclear",
    label: "원자력/SMR",
    patterns: [/원자력|원전|smr|원자로/i],
    directions: {
      원자력: "positive",
      전력기기: "positive",
    },
    riskTags: ["nuclear"],
    horizon: "1m",
    defaultDirection: "positive",
  },
  {
    id: "income",
    label: "배당/인컴",
    patterns: [/배당|커버드콜|인컴|다우존스/i],
    directions: {
      "배당/커버드콜": "positive",
      현금파킹: "positive",
    },
    riskTags: ["income"],
    horizon: "1m",
    defaultDirection: "positive",
  },
];

const POSITIVE_PATTERN =
  /(급증|확대|증가|호조|회복|재개|본격화|강화|승인|발급|공급 계약|수주|투자 확대|매출 급증|가속|수혜)/i;
const NEGATIVE_PATTERN =
  /(둔화|감소|부진|위축|하락|리스크|우려|불안|중단|지연|압박|악화|제재|동결|급락)/i;

function compactText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣]+/gi, "");
}

function uniqueStrings(items) {
  return [...new Set((items ?? []).map((item) => compactText(item)).filter(Boolean))];
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function normalizeTopicId(topicId) {
  if (String(topicId ?? "").startsWith("TWF")) {
    return topicId;
  }

  return Buffer.from(`MarketVoiceTopicType:${topicId}`).toString("base64");
}

function decodeMoneytoringNumericId(globalId) {
  try {
    const decoded = Buffer.from(globalId, "base64").toString("utf8");
    const match = decoded.match(/:(\d+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildMoneytoringTopicUrl(globalId) {
  const numericId = decodeMoneytoringNumericId(globalId);
  return numericId ? `https://www.moneytoring.ai/mv/${numericId}` : "https://www.moneytoring.ai/mv";
}

async function requestMoneytoringGraphQL(query, variables) {
  const response = await fetch(MONEYTORING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Moneytoring GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.errors?.length) {
    throw new Error(`Moneytoring GraphQL error: ${JSON.stringify(payload.errors)}`);
  }

  if (!payload?.data) {
    throw new Error("Moneytoring GraphQL returned empty data.");
  }

  return payload.data;
}

async function fetchLatestTopics(limit = DEFAULT_TOPIC_LIMIT) {
  const data = await requestMoneytoringGraphQL(GET_MAVO_TOPIC_PAGINATION_QUERY, {
    sortBy: "LATEST",
    sourceTypeList: DEFAULT_SOURCE_TYPE_LIST,
    keywordIdList: [],
    cursorPaginationInput: {
      first: limit,
      after: null,
    },
  });

  return data?.mavoTopicPagination?.topicList ?? [];
}

async function fetchTopicDetail(topicId) {
  const data = await requestMoneytoringGraphQL(GET_MARKET_VOICE_TOPIC_DETAIL_QUERY, {
    topicId: normalizeTopicId(topicId),
    sortDirection: "DESC",
  });

  return data?.marketVoiceTopicDetail ?? null;
}

function resolveAccountKey(accountHint) {
  const normalized = compactText(accountHint);
  if (!normalized || normalized === "전계좌") return null;
  if (normalized === "ISA") return "ISA";
  if (normalized === "연금저축") return "PENSION";
  if (normalized === "토스" || normalized === "토스증권") return "KIS_MAIN";
  if (normalized === "한투 일반" || normalized === "한국투자" || normalized === "KIS_MAIN") return "KIS_MAIN";
  return normalized;
}

function buildHoldingProfiles(coverage) {
  return [...coverage.holdingsByCode.values()].map((holding) => {
    const security = SECURITIES_BY_CODE[holding.code] ?? null;
    const category = getCategory(holding.code, holding.accountKey) ?? "기타";
    const strongTokens = uniqueStrings([
      holding.name,
      security?.name,
      ...(security?.keywords?.aliases ?? []),
    ]);
    const themeTokens = uniqueStrings([
      ...(security?.keywords?.topic_hints ?? []),
      ...(security?.keywords?.theme ?? []),
      ...(security?.keywords?.macro ?? []),
      ...(CATEGORY_KEYWORDS[category] ?? []),
    ]);

    return {
      ...holding,
      category,
      strongTokens,
      themeTokens,
    };
  });
}

function buildWatchlistProfiles(watchlist) {
  const items = [
    ...(watchlist?.core_etf ?? []),
    ...(watchlist?.satellite_etf ?? []),
    ...(watchlist?.individual_stocks ?? []),
  ];

  return items.map((item) => {
    const security = item?.code ? SECURITIES_BY_CODE[item.code] ?? null : null;
    const accountKey = resolveAccountKey(item.account);
    const category = item?.code ? getCategory(item.code, accountKey) ?? getCategory(item.code, null) ?? "기타" : "기타";
    return {
      code: item.code ?? null,
      name: item.name ?? item.code ?? "관심종목",
      accountHint: item.account ?? null,
      accountKey,
      category,
      strongTokens: uniqueStrings([item.name, security?.name, ...(security?.keywords?.aliases ?? [])]),
      themeTokens: uniqueStrings([
        ...(security?.keywords?.topic_hints ?? []),
        ...(security?.keywords?.theme ?? []),
        ...(security?.keywords?.macro ?? []),
        ...(CATEGORY_KEYWORDS[category] ?? []),
      ]),
    };
  });
}

function buildAccountThemeProfiles(portfolio) {
  const profiles = [];

  for (const account of portfolio?.accounts ?? []) {
    const categoryMap = new Map();

    for (const holding of account.holdings ?? []) {
      const category = getCategory(holding.code, account.key) ?? "기타";
      if (category === "기타") continue;
      const security = SECURITIES_BY_CODE[holding.code] ?? null;
      const entry = categoryMap.get(category) ?? {
        accountKey: account.key,
        accountLabel: account.label,
        category,
        themeTokens: [],
      };
      entry.themeTokens.push(
        ...(security?.keywords?.topic_hints ?? []),
        ...(security?.keywords?.theme ?? []),
        ...(security?.keywords?.macro ?? []),
        ...(CATEGORY_KEYWORDS[category] ?? []),
      );
      categoryMap.set(category, entry);
    }

    for (const entry of categoryMap.values()) {
      profiles.push({
        ...entry,
        themeTokens: uniqueStrings(entry.themeTokens),
      });
    }
  }

  return profiles;
}

function buildTopicHaystacks(topic, detail) {
  const keywordNames = (topic?.keywordList ?? []).map((item) => item?.name);
  const detailTexts = (detail?.subTopicList ?? []).flatMap((item) => [item?.title, item?.summary]);
  const topicText = compactText([
    topic?.title,
    topic?.summary,
    ...keywordNames,
    ...detailTexts,
  ].filter(Boolean).join("\n"));

  const keywordLooseSet = new Set(
    (topic?.keywordList ?? []).flatMap((item) => [
      normalizeLoose(item?.name),
      normalizeLoose(item?.code),
    ]).filter(Boolean),
  );

  return {
    text: topicText,
    looseText: normalizeLoose(topicText),
    keywordLooseSet,
  };
}

function findMatchedTokens(tokens, haystack) {
  const matches = [];
  for (const token of tokens ?? []) {
    const loose = normalizeLoose(token);
    if (!loose) continue;
    if (loose.length < 3 && !/^(ai|smr|vix)$/i.test(loose)) continue;
    if (haystack.looseText.includes(loose) || haystack.keywordLooseSet.has(loose)) {
      matches.push(compactText(token));
    }
  }
  return uniqueStrings(matches).slice(0, 4);
}

function detectTopicSignals(topicText) {
  return SIGNAL_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(topicText))).map((rule) => ({
    id: rule.id,
    label: rule.label,
    directions: rule.directions,
    riskTags: rule.riskTags,
    horizon: rule.horizon,
    defaultDirection: rule.defaultDirection,
  }));
}

function inferTopicDirection(topicText, keywordList, signals) {
  let score = 0;
  const hasPositive = POSITIVE_PATTERN.test(topicText);
  const hasNegative = NEGATIVE_PATTERN.test(topicText);

  if (hasPositive) score += 1;
  if (hasNegative) score -= 1;

  const fluctuationRates = (keywordList ?? [])
    .map((item) => item?.fluctuationRate)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const maxPositiveRate = fluctuationRates.length > 0 ? Math.max(...fluctuationRates) : null;
  const minNegativeRate = fluctuationRates.length > 0 ? Math.min(...fluctuationRates) : null;

  if (typeof maxPositiveRate === "number" && maxPositiveRate >= 1.5) score += 1;
  if (typeof minNegativeRate === "number" && minNegativeRate <= -1.5) score -= 1;

  for (const signal of signals) {
    if (signal.defaultDirection === "positive") score += 0.6;
    if (signal.defaultDirection === "negative") score -= 0.6;
  }

  if (hasPositive && hasNegative && Math.abs(score) < 1.2) {
    return "mixed";
  }
  if (score >= 1.2) return "positive";
  if (score <= -1.2) return "negative";
  return "neutral";
}

function matchingKeywordRate(topic, profile) {
  for (const keyword of topic?.keywordList ?? []) {
    if (profile?.code && compactText(keyword?.code) === compactText(profile.code)) {
      return keyword?.fluctuationRate;
    }
  }

  const strongTokenSet = new Set((profile?.strongTokens ?? []).map((item) => normalizeLoose(item)).filter(Boolean));
  for (const keyword of topic?.keywordList ?? []) {
    const looseName = normalizeLoose(keyword?.name);
    if (looseName && strongTokenSet.has(looseName)) {
      return keyword?.fluctuationRate;
    }
  }

  return null;
}

function directionForCategory(category, signals, topicDirection, directRate = null) {
  for (const signal of signals) {
    const categoryDirection = signal?.directions?.[category];
    if (categoryDirection) {
      return categoryDirection;
    }
  }

  if (typeof directRate === "number" && directRate >= 0.5) return "positive";
  if (typeof directRate === "number" && directRate <= -0.5) return "negative";
  if (topicDirection === "mixed") return "neutral";
  return topicDirection;
}

function buildDirectHoldingMatches(topic, haystack, holdingProfiles, signals, topicDirection) {
  return uniqueBy(
    holdingProfiles
      .map((holding) => {
        const directCodeMatch = (topic?.keywordList ?? []).some(
          (item) => compactText(item?.code) === compactText(holding.code),
        );
        const matchedTokens = findMatchedTokens(holding.strongTokens, haystack);
        if (!directCodeMatch && matchedTokens.length === 0) {
          return null;
        }

        return {
          code: holding.code,
          name: holding.name,
          accountKey: holding.accountKey,
          accountLabel: holding.accountLabel,
          category: holding.category,
          matchReasons: uniqueStrings([
            directCodeMatch ? `키워드코드:${holding.code}` : null,
            ...matchedTokens,
          ]),
          impactDirection: directionForCategory(
            holding.category,
            signals,
            topicDirection,
            matchingKeywordRate(topic, holding),
          ),
        };
      })
      .filter(Boolean),
    (item) => `${item.accountKey}:${item.code}`,
  );
}

function buildThematicMatches(haystack, themeProfiles, directHoldingMatches, signals, topicDirection) {
  const directKeys = new Set(directHoldingMatches.map((item) => `${item.accountKey}:${item.category}`));

  return uniqueBy(
    themeProfiles
      .map((profile) => {
        const matchedSignals = signals.filter((signal) => signal?.directions?.[profile.category]);
        const matchedTokens = findMatchedTokens(profile.themeTokens, haystack);
        if (matchedSignals.length === 0 && matchedTokens.length < 2) {
          return null;
        }
        if (directKeys.has(`${profile.accountKey}:${profile.category}`)) {
          return null;
        }

        return {
          accountKey: profile.accountKey,
          accountLabel: profile.accountLabel,
          category: profile.category,
          matchReasons: uniqueStrings([
            ...matchedSignals.map((item) => item.label),
            ...matchedTokens,
          ]).slice(0, 5),
          impactDirection: directionForCategory(profile.category, signals, topicDirection, null),
        };
      })
      .filter(Boolean),
    (item) => `${item.accountKey}:${item.category}`,
  );
}

function buildWatchlistMatches(haystack, watchlistProfiles, directHoldingMatches) {
  const directCodes = new Set(directHoldingMatches.map((item) => item.code));

  return uniqueBy(
    watchlistProfiles
      .map((item) => {
        if (item.code && directCodes.has(item.code)) {
          return null;
        }
        const directCodeMatch = Boolean(item.code) && haystack.keywordLooseSet.has(normalizeLoose(item.code));
        const matchedTokens = findMatchedTokens(item.strongTokens, haystack);
        const themeTokens = findMatchedTokens(item.themeTokens, haystack);
        if (!directCodeMatch && matchedTokens.length === 0 && themeTokens.length < 2) {
          return null;
        }

        return {
          code: item.code,
          name: item.name,
          accountHint: item.accountHint,
          accountKey: item.accountKey,
          category: item.category,
          matchReasons: uniqueStrings([
            directCodeMatch ? `키워드코드:${item.code}` : null,
            ...matchedTokens,
            ...themeTokens,
          ]).slice(0, 5),
        };
      })
      .filter(Boolean),
    (item) => `${item.accountKey ?? item.accountHint}:${item.code ?? item.name}`,
  );
}

function buildRelevanceScore(topic, directHoldingMatches, thematicMatches, watchlistMatches, signals, topicDirection) {
  const directBonus = directHoldingMatches.length * 32;
  const thematicBonus = thematicMatches.length * 14;
  const watchlistBonus = watchlistMatches.length * 9;
  const sourceBonus = Math.min(12, Math.round(Math.log2((topic?.topicDocumentSize ?? 0) + 1) * 3));
  const signalBonus = signals.length * 5;
  const directionBonus = topicDirection === "neutral" ? 0 : 4;
  return Math.round(clamp(directBonus + thematicBonus + watchlistBonus + sourceBonus + signalBonus + directionBonus, 0, 100));
}

function summarizePortfolioLinkage(topic, directHoldingMatches, thematicMatches, signals) {
  const directSummary = uniqueStrings(
    directHoldingMatches.map((item) => `${item.accountLabel ?? item.accountKey}의 ${item.name}`),
  );
  const thematicSummary = uniqueStrings(
    thematicMatches.map((item) => `${item.accountLabel ?? item.accountKey}의 ${item.category}`),
  );
  const signalLabels = uniqueStrings(signals.map((item) => item.label));

  const parts = [];
  if (directSummary.length > 0) {
    parts.push(`직접 보유 중인 ${directSummary.slice(0, 2).join(", ")}에 연결됩니다.`);
  }
  if (thematicSummary.length > 0) {
    parts.push(`계좌 테마 기준으로는 ${thematicSummary.slice(0, 3).join(", ")} 판단과 맞물립니다.`);
  }
  if (signalLabels.length > 0) {
    parts.push(`핵심 시그널은 ${signalLabels.join(", ")}입니다.`);
  }

  return parts.join(" ");
}

function buildDeepResearchQuestion(topic, signals, directHoldingMatches, thematicMatches) {
  const leadingSignal = signals[0]?.id ?? null;

  if (leadingSignal === "geopolitics-oil") {
    return "중동/유가 이슈가 단기 헤드라인인지, 실제 공급 차질과 가격 전이로 이어지는지 확인하세요.";
  }
  if (leadingSignal === "rates-fx") {
    return "금리·환율 변화가 위험자산 할인율과 현금파킹 매력도로 얼마나 번지는지 확인하세요.";
  }
  if (leadingSignal === "ai-power") {
    return "AI 인프라 뉴스가 실제 수주·실적과 ETF 편입 종목 모멘텀으로 이어지는지 검증하세요.";
  }
  if (leadingSignal === "defense") {
    return "방산 수요 확대가 실제 수주 공시와 마진 개선으로 연결되는지 확인하세요.";
  }
  if (leadingSignal === "nuclear") {
    return "원전/SMR 뉴스가 정책 이벤트인지, 실제 투자 집행과 실적 추정 상향으로 이어지는지 확인하세요.";
  }

  if (directHoldingMatches.length > 0) {
    return `${directHoldingMatches[0].name} 관련 원문과 후속 데이터가 실제 투자 판단을 바꿀 정도인지 재검증하세요.`;
  }

  if (thematicMatches.length > 0) {
    return `${thematicMatches[0].category} 테마가 일시 뉴스 플로우인지, 구조적 추세인지 구분하세요.`;
  }

  return `${compactText(topic?.title) || "해당 이슈"}가 리포트와 같은 방향인지, 반대로 앞서가는 신호인지 확인하세요.`;
}

function buildImpactEntries(topic, signals) {
  const textEvidence = uniqueStrings([
    compactText(topic?.summary),
    ...((topic?.subTopics ?? []).map((item) => compactText(item?.summary))),
    compactText(topic?.portfolioLinkage),
  ]).slice(0, 3);
  const numberEvidence = uniqueStrings([
    typeof topic?.quoteCount === "number" ? `인용 ${topic.quoteCount}건` : null,
    typeof topic?.topicDocumentSize === "number" ? `원문 ${topic.topicDocumentSize}건` : null,
    ...((topic?.keywordList ?? [])
      .filter((item) => typeof item?.fluctuationRate === "number" && Number.isFinite(item.fluctuationRate))
      .slice(0, 3)
      .map((item) => `${item.name} ${item.fluctuationRate > 0 ? "+" : ""}${item.fluctuationRate.toFixed(2)}%`)),
  ]);
  const channels = uniqueStrings([
    ...(topic?.uniqueSourceTypeList ?? []),
    ...signals.map((item) => item.label),
  ]);
  const riskTags = uniqueStrings(signals.flatMap((item) => item.riskTags ?? []));

  const directHoldingImpacts = (topic?.portfolioMatches?.directHoldings ?? [])
    .filter((item) => item.impactDirection && item.impactDirection !== "neutral")
    .map((item) => ({
      target: {
        type: "holding",
        code: item.code,
        accountKey: item.accountKey,
        name: item.name,
      },
      direction: item.impactDirection,
      strength: Number.parseFloat(clamp(0.46 + (topic.relevanceScore ?? 0) / 180, 0.35, 0.82).toFixed(3)),
      confidence: Number.parseFloat(clamp(0.58 + item.matchReasons.length * 0.05, 0.45, 0.88).toFixed(3)),
      horizon: signals.some((signal) => signal.horizon === "1m") ? "1m" : "1w",
      decayHalfLifeDays: signals.some((signal) => signal.horizon === "1m") ? 18 : 8,
      channels,
      regimeAssumptions: [],
      evidence: {
        snippets: textEvidence,
        numbers: numberEvidence,
      },
      riskTags,
    }));

  const thematicImpacts = (topic?.portfolioMatches?.thematicAccounts ?? [])
    .filter((item) => item.impactDirection && item.impactDirection !== "neutral")
    .map((item) => ({
      target: {
        type: "category",
        accountKey: item.accountKey,
        name: item.category,
      },
      direction: item.impactDirection,
      strength: Number.parseFloat(clamp(0.32 + (topic.relevanceScore ?? 0) / 260, 0.24, 0.68).toFixed(3)),
      confidence: Number.parseFloat(clamp(0.5 + item.matchReasons.length * 0.04, 0.38, 0.82).toFixed(3)),
      horizon: signals.some((signal) => signal.horizon === "1m") ? "1m" : "1w",
      decayHalfLifeDays: signals.some((signal) => signal.horizon === "1m") ? 14 : 7,
      channels,
      regimeAssumptions: [],
      evidence: {
        snippets: textEvidence,
        numbers: numberEvidence,
      },
      riskTags,
    }));

  return uniqueBy([...directHoldingImpacts, ...thematicImpacts], (item) =>
    [
      item.target.type,
      item.target.accountKey ?? "",
      item.target.code ?? "",
      item.target.name ?? "",
      item.direction,
    ].join("|"),
  );
}

function buildImpactReport(topic) {
  if (!Array.isArray(topic?.impactEntries) || topic.impactEntries.length === 0) {
    return null;
  }

  return {
    reportId: `marketvoice_${topic.numericId ?? topic.topicId}`,
    title: topic.title,
    broker: topic?.mainSource?.author ?? topic?.mainSource?.name ?? "Moneytoring",
    source: "moneytoring",
    publishedDate: topic.displayUpdatedAt ?? null,
    reportMeta: {
      report_type: "marketvoice",
      sector: topic.signalLabels?.[0] ?? "시황",
      themes: topic.signalLabels ?? [],
      key_numbers: uniqueStrings([
        typeof topic.topicDocumentSize === "number" ? `원문 ${topic.topicDocumentSize}건` : null,
        typeof topic.quoteCount === "number" ? `인용 ${topic.quoteCount}건` : null,
      ]),
    },
    impacts: topic.impactEntries,
  };
}

function buildAccountDigests(portfolio, topics) {
  return (portfolio?.accounts ?? []).map((account) => {
    const topTopics = topics
      .filter(
        (topic) =>
          (topic?.portfolioMatches?.directHoldings ?? []).some((item) => item.accountKey === account.key) ||
          (topic?.portfolioMatches?.thematicAccounts ?? []).some((item) => item.accountKey === account.key),
      )
      .slice(0, 4)
      .map((topic) => ({
        topicId: topic.topicId,
        title: topic.title,
        topicUrl: topic.topicUrl,
        relevanceScore: topic.relevanceScore,
        signalDirection: topic.signalDirection,
        portfolioLinkage: topic.portfolioLinkage,
        matchedNames: uniqueStrings([
          ...(topic?.portfolioMatches?.directHoldings ?? [])
            .filter((item) => item.accountKey === account.key)
            .map((item) => item.name),
        ]),
        matchedCategories: uniqueStrings([
          ...(topic?.portfolioMatches?.directHoldings ?? [])
            .filter((item) => item.accountKey === account.key)
            .map((item) => item.category),
          ...(topic?.portfolioMatches?.thematicAccounts ?? [])
            .filter((item) => item.accountKey === account.key)
            .map((item) => item.category),
        ]),
        sourceCount: topic.topicDocumentSize ?? 0,
        updatedAt: topic.displayUpdatedAt ?? null,
      }));

    return {
      accountKey: account.key,
      accountLabel: account.label,
      topTopics,
    };
  });
}

function buildSummary(topics, deepResearchCandidates) {
  const directHoldingTopics = topics.filter(
    (topic) => (topic?.portfolioMatches?.directHoldings ?? []).length > 0,
  ).length;
  const thematicAccountTopics = topics.filter(
    (topic) => (topic?.portfolioMatches?.thematicAccounts ?? []).length > 0,
  ).length;
  const watchlistTopics = topics.filter(
    (topic) => (topic?.portfolioMatches?.watchlist ?? []).length > 0,
  ).length;
  const highPriorityTopics = topics.filter((topic) => (topic?.relevanceScore ?? 0) >= 60).length;

  return {
    overview: `머니토링 ${topics.length}건 중 포트폴리오 직결 ${directHoldingTopics}건, 계좌 테마 연결 ${thematicAccountTopics}건, 관심종목 연결 ${watchlistTopics}건, 딥리서치 후보 ${deepResearchCandidates.length}건을 추렸습니다.`,
    directHoldingTopics,
    thematicAccountTopics,
    watchlistTopics,
    highPriorityTopics,
  };
}

function buildMarkdown(date, payload) {
  const lines = [
    `# Market Voice Linked (${date})`,
    "",
    `- 요약: ${payload?.summary?.overview ?? "요약 없음"}`,
    `- 상위 이슈 수: ${payload?.topics?.length ?? 0}`,
    `- 딥리서치 후보 수: ${payload?.deepResearchCandidates?.length ?? 0}`,
    "",
    "## 내 계좌 관련 상위 이슈",
  ];

  const highlightedTopics = (payload?.topics ?? []).slice(0, 8);
  if (highlightedTopics.length === 0) {
    lines.push("- 연결된 이슈가 없습니다.");
  } else {
    for (const topic of highlightedTopics) {
      const accountTags = uniqueStrings([
        ...(topic?.portfolioMatches?.directHoldings ?? []).map(
          (item) => `${item.accountLabel ?? item.accountKey}:${item.name}`,
        ),
        ...(topic?.portfolioMatches?.thematicAccounts ?? []).map(
          (item) => `${item.accountLabel ?? item.accountKey}:${item.category}`,
        ),
      ]);
      lines.push(`### ${topic.title}`);
      lines.push(`- 점수: ${topic.relevanceScore} / 방향: ${topic.signalDirection ?? "neutral"} / 링크: ${topic.topicUrl}`);
      if (accountTags.length > 0) {
        lines.push(`- 연결: ${accountTags.join(", ")}`);
      }
      lines.push(`- 포트폴리오 번역: ${topic.portfolioLinkage || topic.summary || "없음"}`);
      lines.push(`- 딥리서치 질문: ${topic.deepResearchQuestion}`);
      lines.push("");
    }
  }

  lines.push("## 계좌별 시황");
  for (const digest of payload?.accountDigests ?? []) {
    lines.push(`### ${digest.accountLabel} (${digest.accountKey})`);
    if ((digest?.topTopics ?? []).length === 0) {
      lines.push("- 연결된 시황 이슈 없음");
      continue;
    }
    for (const topic of digest.topTopics) {
      lines.push(`- ${topic.title} / ${topic.portfolioLinkage || "설명 없음"}`);
    }
    lines.push("");
  }

  lines.push("## 딥리서치 후보");
  if ((payload?.deepResearchCandidates ?? []).length === 0) {
    lines.push("- 없음");
  } else {
    for (const item of payload.deepResearchCandidates) {
      lines.push(`- ${item.title} / 이유: ${item.reason} / 질문: ${item.question}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const [portfolio, watchlist] = await Promise.all([
    readJson(`${ROOT_DIR}/data/portfolio/latest.json`, { accounts: [] }),
    readJson(`${ROOT_DIR}/config/watchlist.json`, {}),
  ]);

  const coverage = buildPortfolioMaps(portfolio, watchlist);
  const holdingProfiles = buildHoldingProfiles(coverage);
  const watchlistProfiles = buildWatchlistProfiles(watchlist);
  const themeProfiles = buildAccountThemeProfiles(portfolio);

  const topics = await fetchLatestTopics(DEFAULT_TOPIC_LIMIT);
  const detailedTopics = await Promise.all(
    topics.slice(0, DEFAULT_DETAIL_LIMIT).map(async (topic) => [topic.id, await fetchTopicDetail(topic.id)]),
  );
  const detailById = new Map(detailedTopics);

  const enrichedTopics = topics
    .map((topic) => {
      const detail = detailById.get(topic.id) ?? null;
      const haystack = buildTopicHaystacks(topic, detail);
      const signals = detectTopicSignals(haystack.text);
      const topicDirection = inferTopicDirection(haystack.text, topic.keywordList, signals);
      const directHoldings = buildDirectHoldingMatches(topic, haystack, holdingProfiles, signals, topicDirection);
      const thematicAccounts = buildThematicMatches(
        haystack,
        themeProfiles,
        directHoldings,
        signals,
        topicDirection,
      );
      const watchlistMatches = buildWatchlistMatches(haystack, watchlistProfiles, directHoldings);
      const relevanceScore = buildRelevanceScore(
        topic,
        directHoldings,
        thematicAccounts,
        watchlistMatches,
        signals,
        topicDirection,
      );
      const subTopics = (detail?.subTopicList ?? []).slice(0, 2).map((item) => ({
        id: item.id,
        title: compactText(item.title),
        summary: compactText(item.summary),
        updatedAt: item.displayUpdatedAt ?? item.displayCreatedAt ?? null,
        sourceOrigins: (item.sourceOriginList ?? []).slice(0, 3).map((source) => ({
          title: compactText(source.title),
          author: compactText(source.author),
          type: source.type,
          url: source.url,
        })),
      }));
      const portfolioLinkage = summarizePortfolioLinkage(topic, directHoldings, thematicAccounts, signals);
      const deepResearchQuestion = buildDeepResearchQuestion(topic, signals, directHoldings, thematicAccounts);

      const enrichedTopic = {
        topicId: topic.id,
        numericId: decodeMoneytoringNumericId(topic.id),
        title: compactText(topic.title),
        summary: compactText(topic.summary),
        topicUrl: buildMoneytoringTopicUrl(topic.id),
        displayUpdatedAt: topic.displayUpdatedAt ?? null,
        quoteCount: topic.quoteCount ?? 0,
        topicDocumentSize: topic.topicDocumentSize ?? 0,
        mainSource: topic.mainSource ?? null,
        uniqueSourceTypeList: topic.uniqueSourceTypeList ?? [],
        keywordList: (topic.keywordList ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          code: item.code,
          type: item.type,
          country: item.country,
          fluctuationRate: item.fluctuationRate,
        })),
        sourceInfo: detail?.displaySourceInfo ?? [],
        subTopics,
        signalDirection: topicDirection,
        signalLabels: signals.map((item) => item.label),
        relevanceScore,
        portfolioMatches: {
          directHoldings,
          thematicAccounts,
          watchlist: watchlistMatches,
        },
        portfolioLinkage,
        deepResearchQuestion,
      };

      enrichedTopic.impactEntries = buildImpactEntries(enrichedTopic, signals);
      return enrichedTopic;
    })
    .sort((left, right) => (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0));

  const deepResearchCandidates = enrichedTopics
    .filter(
      (topic) =>
        (topic?.relevanceScore ?? 0) >= 55 &&
        (
          (topic?.portfolioMatches?.directHoldings ?? []).length > 0 ||
          (topic?.portfolioMatches?.thematicAccounts ?? []).length > 0 ||
          (topic?.portfolioMatches?.watchlist ?? []).length > 0 ||
          (topic?.signalLabels ?? []).length > 0
        ),
    )
    .slice(0, 5)
    .map((topic) => ({
      topicId: topic.topicId,
      title: topic.title,
      topicUrl: topic.topicUrl,
      relevanceScore: topic.relevanceScore,
      reason: topic.portfolioLinkage || topic.summary,
      question: topic.deepResearchQuestion,
    }));

  const impactReports = enrichedTopics
    .map((topic) => buildImpactReport(topic))
    .filter(Boolean);
  const accountDigests = buildAccountDigests(portfolio, enrichedTopics);
  const summary = buildSummary(enrichedTopics, deepResearchCandidates);
  const runMeta = buildRunMetadata(args);

  const payload = {
    schemaVersion: 1,
    ...runMeta,
    provenance: {
      source: "moneytoring-graphql",
      endpoint: MONEYTORING_API_URL,
      topicLimit: DEFAULT_TOPIC_LIMIT,
      detailLimit: DEFAULT_DETAIL_LIMIT,
    },
    summary,
    topics: enrichedTopics,
    accountDigests,
    deepResearchCandidates,
    impactReports,
  };

  const paths = buildMarketVoicePaths(args.date);
  const jsonPath = args.output ?? paths.jsonPath;
  const markdownPath = args.markdown ?? paths.markdownPath;

  await writeJson(jsonPath, payload);
  await writeText(markdownPath, buildMarkdown(args.date, payload));
  console.log(jsonPath);
}

main().catch((error) => {
  console.error(`marketvoice 연동 수집 실패: ${error.message}`);
  process.exit(1);
});
