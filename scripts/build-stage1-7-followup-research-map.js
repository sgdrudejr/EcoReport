#!/usr/bin/env node
// Stage 1.7: 1차 산출물 이후 다시 살펴봐야 할 키워드/종목/계좌를 재인덱싱해
// 후속 Deep Research와 전략 재평가에 바로 쓸 수 있는 follow-up research map을 생성합니다.

import path from "node:path";

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  STRICT_ALIASES_BY_CODE,
  THEME_KEYWORDS_BY_CODE,
  buildRunMetadata,
  compactWhitespace,
  containsKeyword,
  extractNumericPhrases,
  headingScore,
  readJson,
  readText,
  splitParagraphs,
  truncate,
  writeJson,
  writeText,
  won,
} from "./lib/pipeline-utils.js";
import {
  parseRefinementArgs,
  previousRefinementRound,
  refinementArtifactPaths,
  refinementRoundSpec,
} from "./lib/refinement-rounds.js";

const MORNING_LETTER_PATTERN = /morning letter/i;

const THEME_KEYWORD_MAP = {
  "AI 인프라": ["AI", "AI 인프라", "데이터센터", "GPU", "냉각", "전력 수요"],
  "전력 인프라": ["전력", "전력기기", "변압기", "송배전", "전력 인프라"],
  방산: ["방산", "국방", "수주", "지정학", "미사일"],
  원자력: ["원자력", "원전", "SMR", "전력 안보"],
  "금/원자재": ["금", "골드", "원자재", "구리", "유가"],
  "금리/매크로": ["금리", "달러", "환율", "유가", "인플레이션", "호르무즈", "중동 휴전"],
  "에너지 안보": ["에너지 안보", "유가", "원유", "호르무즈", "LNG", "천연가스"],
};

function normalizeText(value) {
  return compactWhitespace(value ?? "");
}

function normalizeLoose(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣]+/gi, "");
}

function uniqueStrings(items) {
  return [...new Set(items.map((item) => normalizeText(item)).filter(Boolean))];
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

function keywordLengthScore(keyword) {
  const normalized = normalizeText(keyword);
  if (!normalized) return 0;
  if (/^[a-z0-9&+./ -]+$/i.test(normalized)) return normalized.length;
  return normalized.replace(/\s+/g, "").length;
}

function sanitizeKeywords(items, { minLength = 2 } = {}) {
  return uniqueStrings(items).filter((item) => keywordLengthScore(item) >= minLength);
}

function topicKeywordSets(topic) {
  const primaryKeywords = sanitizeKeywords(topic?.primaryKeywords ?? topic?.keywords ?? [], { minLength: 2 });
  const primaryNormalized = new Set(primaryKeywords.map((item) => normalizeLoose(item)));
  const secondaryKeywords = sanitizeKeywords(topic?.secondaryKeywords ?? [], { minLength: 2 }).filter(
    (item) => !primaryNormalized.has(normalizeLoose(item)),
  );

  return {
    primaryKeywords,
    secondaryKeywords,
  };
}

function sumThemeCounts(stage1) {
  const counts = new Map();
  for (const extract of stage1?.extracts ?? []) {
    for (const theme of extract?.themes ?? []) {
      const current = counts.get(theme) ?? 0;
      counts.set(theme, current + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function findMatchingExtracts(stage1, code, name, extraKeywords = []) {
  const security = code ? SECURITIES_BY_CODE[code] : null;
  const aliases = [
    name,
    security?.name,
    ...(code ? STRICT_ALIASES_BY_CODE[code] ?? [] : []),
    ...(security?.keywords?.topic_hints ?? []),
    ...extraKeywords,
  ];
  const normalizedAliases = uniqueStrings(aliases).map((item) => normalizeLoose(item));

  return (stage1?.extracts ?? []).filter((extract) => {
    const haystack = normalizeLoose(
      [
        extract?.ticker,
        extract?.company_name,
        extract?.title,
        extract?.key_thesis,
        ...(extract?.key_points ?? []),
        ...(extract?.what_changed ?? []),
        ...(extract?.themes ?? []),
      ]
        .filter(Boolean)
        .join("\n"),
    );

    if (code && extract?.related_holdings_in_my_portfolio?.some((item) => item?.code === code)) {
      return true;
    }

    return normalizedAliases.some((alias) => alias && haystack.includes(alias));
  });
}

function buildSecurityKeywordProfile(code, name, category) {
  const security = code ? SECURITIES_BY_CODE[code] : null;
  const primary = sanitizeKeywords(
    [
      name,
      security?.name,
      ...(code ? STRICT_ALIASES_BY_CODE[code] ?? [] : []),
    ],
    { minLength: 3 },
  );
  const secondary = sanitizeKeywords(
    [
      category,
      ...(security?.keywords?.topic_hints ?? []),
      ...(code ? THEME_KEYWORDS_BY_CODE[code] ?? [] : []),
      ...(security?.keywords?.macro ?? []),
    ],
    { minLength: 2 },
  ).filter((item) => !primary.some((keyword) => normalizeLoose(keyword) === normalizeLoose(item)));

  return {
    primary: primary.slice(0, 8),
    secondary: secondary.slice(0, 10),
    all: uniqueStrings([...primary, ...secondary]).slice(0, 14),
  };
}

function buildAccountKeywordProfile(plan) {
  const primary = sanitizeKeywords(
    [
      plan?.topGap?.category,
      plan?.candidateFromGap,
      plan?.macroCommentary?.actionLine,
    ],
    { minLength: 2 },
  );
  const secondary = sanitizeKeywords(
    [
      ...(plan?.macroCommentary?.assetFocus ?? []),
      ...(THEME_KEYWORD_MAP[plan?.topGap?.category] ?? []),
    ],
    { minLength: 2 },
  ).filter((item) => !primary.some((keyword) => normalizeLoose(keyword) === normalizeLoose(item)));

  return {
    primary: primary.slice(0, 8),
    secondary: secondary.slice(0, 8),
    all: uniqueStrings([...primary, ...secondary]).slice(0, 12),
  };
}

function buildMacroKeywordProfile(theme, extraKeywords = []) {
  const primary = sanitizeKeywords([theme, ...extraKeywords], { minLength: 2 });
  return {
    primary: primary.slice(0, 8),
    secondary: [],
    all: primary.slice(0, 8),
  };
}

function buildTopicTextFromExtract(extract) {
  return [
    extract?.title,
    extract?.key_thesis,
    ...(extract?.key_points ?? []).slice(0, 4),
    ...(extract?.what_changed ?? []).slice(0, 3),
    ...(extract?.catalysts ?? []).slice(0, 3),
    ...(extract?.risks ?? []).slice(0, 3),
    ...(extract?.bull_case ?? []).slice(0, 2),
    ...(extract?.bear_case ?? []).slice(0, 2),
    ...(extract?.evidence_notes ?? []).slice(0, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildExtractExcerpt(extract) {
  return truncate(
    [
      extract?.key_thesis,
      ...(extract?.what_changed ?? []).slice(0, 1),
      ...(extract?.key_points ?? []).slice(0, 1),
    ]
      .filter(Boolean)
      .join("\n"),
    240,
  );
}

function matchKeywords(text, keywords) {
  return keywords.filter((keyword) => containsKeyword(text, keyword));
}

function isSecurityTopicLinkedToExtract(topic, extract) {
  if (topic.scope !== "security") return false;
  return (extract?.related_holdings_in_my_portfolio ?? []).some((item) =>
    (topic.targetCodes ?? []).includes(item?.code),
  );
}

function reportTypePenalty(reportType, title) {
  let penalty = 0;
  if (reportType === "strategy") penalty += 4;
  if (reportType === "macro") penalty += 2;
  if (MORNING_LETTER_PATTERN.test(title ?? "")) penalty += 8;
  return penalty;
}

function buildTopicQuestions(topic, round = 2) {
  if (round >= 3) {
    if (topic.scope === "security") {
      return [
        `${topic.label}의 매수·보유·축소 판단을 실제로 바꾸는 이벤트와 가격 구조를 1~2개로 더 좁힙니다.`,
        `${topic.label} thesis가 틀릴 때 가장 먼저 무너질 가정, 그리고 더 나은 대체재가 있는지 확인합니다.`,
        `${topic.label}을 지금 바로 집행하지 않는다면 무엇을 기다려야 하는지, 계좌 역할 기준으로 정리합니다.`,
      ];
    }

    if (topic.scope === "account") {
      return [
        `${topic.label}에서 지금 늘릴 자산과 줄일 자산을 마지막으로 분리하고, 우선순위를 다시 확인합니다.`,
        `${topic.label}의 계좌 운용 판단을 바꾸는 체크포인트와 무효화 조건을 더 구체적으로 남깁니다.`,
      ];
    }

    return [
      `${topic.label}이 레짐을 실제로 바꾸는 변수인지, 아니면 아직 headline 수준인지 마지막으로 검증합니다.`,
      `${topic.label}과 연결된 헤지 자산, 반대 포지션, 대체 시나리오를 같이 정리합니다.`,
    ];
  }

  if (topic.scope === "security") {
    return [
      `${topic.label}의 현재 논리가 여전히 유효한지, 최근 리포트 기준으로 무엇이 강화되고 무엇이 약해졌는지 정리합니다.`,
      `${topic.label}을 추가매수/보유/축소로 가르는 핵심 체크포인트 1~2개를 다시 확인합니다.`,
      `${topic.label}이 계좌 안에서 맡는 역할과 더 나은 대체재가 있는지 비교합니다.`,
    ];
  }

  if (topic.scope === "account") {
    return [
      `${topic.label}에서 지금 가장 먼저 보강하거나 줄여야 할 자산군이 무엇인지 다시 확인합니다.`,
      `${topic.label} 운용 원칙을 흔들 수 있는 매크로 변수와 이벤트를 다시 확인합니다.`,
    ];
  }

  return [
    `${topic.label}와 관련된 핵심 리포트 문장과 데이터 포인트를 다시 추립니다.`,
    `${topic.label}이 실제 자금 배치 우선순위를 바꿀 정도로 강한지, 아니면 관찰 단계인지 다시 구분합니다.`,
  ];
}

function buildMacroTopics(stage1, stage4) {
  const topThemes = sumThemeCounts(stage1)
    .filter(([theme]) => Boolean(theme))
    .slice(0, 4)
    .map(([theme, count]) => {
      const keywordProfile = buildMacroKeywordProfile(theme, THEME_KEYWORD_MAP[theme] ?? []);
      return {
        id: `theme-${normalizeLoose(theme)}`,
        scope: "macro",
        label: theme,
        priority: 58 + Math.min(count, 6) * 4,
        reason: `오늘 리포트에서 ${count}건 이상 반복 등장한 주제라, 단순 headlines가 아니라 실제 자금 배치 우선순위와 연결되는지 다시 봐야 합니다.`,
        keywords: keywordProfile.all,
        primaryKeywords: keywordProfile.primary,
        secondaryKeywords: keywordProfile.secondary,
        accountKeys: uniqueStrings((stage4?.accountPlans ?? []).flatMap((plan) => plan?.key ?? [])),
        targetCodes: [],
        sourceSignals: [`Stage 1 themes ${count}건`],
      };
    });

  const explicitMacro = [
    (() => {
      const keywordProfile = buildMacroKeywordProfile("중동 휴전", [
        "호르무즈",
        "유가",
        "WTI",
        "달러",
        "환율",
        "인플레이션",
      ]);
      return {
        id: "macro-middle-east",
        scope: "macro",
        label: "중동 휴전 / 유가 / 달러",
        priority: 88,
        reason: "이번 사이클의 레짐 해석과 방어 자산 판단을 가장 크게 흔드는 축이라 후속 확인이 필요합니다.",
        keywords: keywordProfile.all,
        primaryKeywords: keywordProfile.primary,
        secondaryKeywords: keywordProfile.secondary,
        accountKeys: ["ISA", "PENSION", "TOSS", "KIS_MAIN"],
        targetCodes: [],
        sourceSignals: ["레짐 핵심 변수", "방어 자산/헤지 판단"],
      };
    })(),
  ];

  return uniqueBy([...explicitMacro, ...topThemes], (item) => item.id).slice(0, 5);
}

function buildPlanTopics(stage1, stage4) {
  const topics = [];

  for (const plan of stage4?.accountPlans ?? []) {
    if (plan?.topGap?.category) {
      const keywordProfile = buildAccountKeywordProfile(plan);
      topics.push({
        id: `account-${normalizeLoose(plan.key)}-${normalizeLoose(plan.topGap.category)}`,
        scope: "account",
        label: `${plan.label} · ${plan.topGap.category}`,
        priority: 74,
        reason: `${plan.label}에서 가장 비어 있는 카테고리 갭이 ${plan.topGap.category} (${won(
          plan.topGap.gapAmount,
        )})이어서, 이 갭을 메우는 논리가 아직 충분히 두꺼운지 다시 확인해야 합니다.`,
        keywords: keywordProfile.all,
        primaryKeywords: keywordProfile.primary,
        secondaryKeywords: keywordProfile.secondary,
        accountKeys: [plan.key],
        targetCodes: [],
        sourceSignals: [
          `top gap ${plan.topGap.category}`,
          plan?.macroCommentary?.actionLine ?? null,
        ].filter(Boolean),
      });
    }

    for (const bucket of ["stagedBuys", "trims", "holds"]) {
      for (const item of (plan?.[bucket] ?? []).slice(0, bucket === "holds" ? 1 : 2)) {
        const code = item?.code ?? null;
        const matchingExtracts = findMatchingExtracts(stage1, code, item?.name ?? null, [
          plan?.topGap?.category,
        ]);
        const categoryHint =
          SECURITIES_BY_CODE[code ?? ""]?.categories?.default ??
          plan?.topGap?.category ??
          null;
        const keywordProfile = buildSecurityKeywordProfile(code, item?.name ?? null, categoryHint);
        const priorityBase = bucket === "stagedBuys" ? 92 : bucket === "trims" ? 83 : 66;
        topics.push({
          id: `security-${normalizeLoose(plan.key)}-${normalizeLoose(code ?? item?.name ?? "unknown")}-${bucket}`,
          scope: "security",
          label: item?.name ?? code ?? "Unknown",
          priority:
            priorityBase +
            (typeof item?.suggestedAmount === "number" ? Math.min(Math.round(item.suggestedAmount / 500000), 8) : 0) +
            Math.min(matchingExtracts.length, 4),
          reason:
            item?.reason ??
            `${plan.label}에서 ${bucket === "stagedBuys" ? "실행 후보" : bucket === "trims" ? "축소 후보" : "보유 유지"}로 남아 있어, 실제 근거를 더 두껍게 확인해야 합니다.`,
          keywords: keywordProfile.all,
          primaryKeywords: keywordProfile.primary,
          secondaryKeywords: keywordProfile.secondary,
          accountKeys: [plan.key],
          targetCodes: code ? [code] : [],
          sourceSignals: uniqueStrings([
            bucket === "stagedBuys" ? "실행 후보" : bucket === "trims" ? "축소 후보" : "보유 유지",
            item?.reason,
            plan?.macroCommentary?.actionLine,
          ]).slice(0, 3),
          directExtractCount: matchingExtracts.length,
        });
      }
    }
  }

  return topics;
}

function topicMatchesPriorTopic(topic, priorTopic) {
  if (!priorTopic) return false;
  if (normalizeLoose(topic.label) === normalizeLoose(priorTopic.label)) return true;

  const topicCodes = new Set(topic.targetCodes ?? []);
  const priorCodes = new Set(priorTopic.targetCodes ?? []);
  if ([...topicCodes].some((code) => priorCodes.has(code))) return true;

  const topicKeywords = uniqueStrings(topic.keywords ?? []).map((item) => normalizeLoose(item));
  const priorKeywords = new Set(uniqueStrings(priorTopic.keywords ?? []).map((item) => normalizeLoose(item)));
  return topicKeywords.some((keyword) => keyword && priorKeywords.has(keyword));
}

function findPriorTopic(topic, priorMap) {
  return (priorMap?.topics ?? []).find((candidate) => topicMatchesPriorTopic(topic, candidate)) ?? null;
}

function textSignalScore(topic, text) {
  const normalizedText = normalizeLoose(text);
  if (!normalizedText) return 0;

  const keywords = uniqueStrings([
    topic.label,
    ...(topic.keywords ?? []).slice(0, 8),
    ...(topic.targetCodes ?? []),
  ]).map((item) => normalizeLoose(item));

  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (normalizedText.includes(keyword)) {
      score += 2;
    }
  }
  return score;
}

function scoreTopicForRound(topic, round, context) {
  let score = topic.priority;

  if (round < 3) {
    return score;
  }

  const priorTopic = findPriorTopic(topic, context.priorMap);
  if (priorTopic) {
    score += 14;
    score += Math.max(0, 6 - Math.max(0, priorTopic.evidence?.length ?? 0)) * 2;
    score += (priorTopic.gaps ?? []).length * 5;
  } else if (topic.scope === "macro") {
    score -= 12;
  }

  score += textSignalScore(topic, context.researchBacklog);
  score += textSignalScore(topic, context.decisionJournal);
  score += textSignalScore(topic, context.priorResponse);
  score += textSignalScore(topic, context.operatingRules) > 0 ? 2 : 0;

  if (topic.scope === "security" && (topic.sourceSignals ?? []).some((item) => /실행 후보|축소 후보/.test(item))) {
    score += 6;
  }

  if (topic.scope === "security" && (topic.directExtractCount ?? 0) === 0) {
    score += 4;
  }

  if ((topic.evidence ?? []).length < 2) {
    score += 4;
  }

  return score;
}

async function loadReportTexts(index) {
  return Promise.all(
    (index ?? []).map(async (report) => {
      const resolvedText =
        report?.full_text_path != null
          ? await readText(path.join(ROOT_DIR, report.full_text_path), report.extracted_text ?? "")
          : report.extracted_text ?? "";

      return {
        ...report,
        resolvedText,
        paragraphs: splitParagraphs(resolvedText),
      };
    }),
  );
}

function rankExtract(topic, extract) {
  const sourceText = buildTopicTextFromExtract(extract);
  if (!sourceText) return null;

  const { primaryKeywords, secondaryKeywords } = topicKeywordSets(topic);
  const primaryHits = matchKeywords(sourceText, primaryKeywords);
  const secondaryHits = matchKeywords(sourceText, secondaryKeywords);
  const portfolioLinked = isSecurityTopicLinkedToExtract(topic, extract);
  const reportType = extract?.report_type ?? null;

  if (topic.scope === "security" && !portfolioLinked && primaryHits.length === 0) {
    return null;
  }
  if (topic.scope === "security" && primaryHits.length === 0 && portfolioLinked && secondaryHits.length < 2) {
    return null;
  }

  let score = primaryHits.length * 14 + secondaryHits.length * 5 + headingScore(sourceText);
  if (portfolioLinked) score += 12;
  if (reportType === "industry") score += 6;
  if (reportType === "macro" && topic.scope === "macro") score += 5;
  if (reportType === "macro" && topic.scope === "security") score -= 2;
  score -= reportTypePenalty(reportType, extract?.title);

  return {
    sourceType: "extract",
    reportType,
    reportId: extract?.id ?? null,
    title: extract?.title ?? "Untitled extract",
    broker: extract?.broker ?? null,
    matchedKeywords: uniqueStrings([...primaryHits, ...secondaryHits]).slice(0, 5),
    score,
    excerpt: buildExtractExcerpt(extract),
    isPortfolioLinked: portfolioLinked,
    isDirectSecurityMatch: primaryHits.length > 0,
  };
}

function rankParagraph(topic, report, paragraph) {
  const sourceText = [report?.title, paragraph].filter(Boolean).join("\n");
  const { primaryKeywords, secondaryKeywords } = topicKeywordSets(topic);
  const primaryHits = matchKeywords(sourceText, primaryKeywords);
  const secondaryHits = matchKeywords(sourceText, secondaryKeywords);
  if (topic.scope === "security" && primaryHits.length === 0) return null;
  if (topic.scope !== "security" && primaryHits.length === 0 && secondaryHits.length === 0) return null;

  let score =
    primaryHits.length * 12 +
    secondaryHits.length * 4 +
    headingScore(paragraph) +
    Math.min(extractNumericPhrases(paragraph, 6).length, 4);
  if (paragraph.length >= 80 && paragraph.length <= 520) score += 4;
  if (paragraph.length > 900) score -= 5;
  if (topic.scope === "security" && topic.targetCodes.some((code) => report?.ticker === code)) score += 6;
  if (topic.scope === "macro" && report?.category === "경제분석") score += 5;
  if (topic.scope === "account" && topic.accountKeys.includes(report?.account_key)) score += 4;
  if (report?.category === "경제분석" && topic.scope === "security") score -= 3;
  if (MORNING_LETTER_PATTERN.test(report?.title ?? "")) score -= 8;

  return {
    sourceType: "report",
    reportType: report?.category ?? null,
    reportId: report.id,
    title: report.title,
    broker: report.broker ?? null,
    matchedKeywords: uniqueStrings([...primaryHits, ...secondaryHits]).slice(0, 5),
    score,
    excerpt: truncate(paragraph, 240),
    isPortfolioLinked: false,
    isDirectSecurityMatch: primaryHits.length > 0,
  };
}

function collectExtractEvidenceForTopic(topic, stage1) {
  return (stage1?.extracts ?? [])
    .map((extract) => rankExtract(topic, extract))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, topic.scope === "security" ? 3 : 4);
}

function collectParagraphEvidenceForTopic(topic, reports) {
  const evidence = [];

  for (const report of reports) {
    const ranked = (report.paragraphs ?? [])
      .map((paragraph) => rankParagraph(topic, report, paragraph))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score)[0];

    if (ranked) {
      evidence.push(ranked);
    }
  }

  return evidence.sort((left, right) => right.score - left.score).slice(0, 4);
}

function collectEvidenceForTopic(topic, reports, stage1) {
  const extractEvidence = collectExtractEvidenceForTopic(topic, stage1);
  const seenTitles = new Set(extractEvidence.map((item) => item.title));
  const paragraphEvidence = collectParagraphEvidenceForTopic(topic, reports).filter(
    (item) => !seenTitles.has(item.title),
  );

  return uniqueBy(
    [...extractEvidence, ...paragraphEvidence],
    (item) => `${item.sourceType}:${item.title}:${item.excerpt}`,
  )
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

function buildDynamicLessons(topics, stage4, round = 2) {
  const avoid = [
    "직접 연결 리포트가 얕은 종목을 카테고리 서사만으로 고확신 매수처럼 포장하지 않습니다.",
    "Morning Letter 표나 수급 테이블만으로 종목 thesis를 만들지 않습니다.",
    "계좌 역할과 무관한 추천, stage2 같은 메타 용어, 말줄임표 사유는 사용자 화면과 질문지에서 배제합니다.",
    "좋은 이야기만 반복하지 말고 무효화 조건과 보류 조건을 반드시 같이 남깁니다.",
  ];

  const improve = [
    "후속 질문은 전반 요약이 아니라 계좌·종목·카테고리별 세부 체크포인트로 쪼개서 묻습니다.",
    "실행 금액이 큰 후보일수록 최근 리포트 근거와 보완해야 할 빈틈을 별도로 추적합니다.",
    "보유 유지 자산도 추가매수와 분리해서 유지 이유와 재판단 조건을 기록합니다.",
  ];

  if (round >= 3) {
    avoid.push("3차 세부화에서는 새 테마를 억지로 늘리지 않고 이미 살아남은 후보의 실행 조건과 무효화 조건만 더 날카롭게 만듭니다.");
    improve.push("마지막 라운드에서는 정확한 진입 신호보다 계좌 역할, 대체재, 헷지 관계, 재판단 조건을 더 선명하게 남깁니다.");
  }

  for (const topic of topics) {
    if (topic.scope === "security" && (topic.directExtractCount ?? 0) === 0) {
      avoid.push(`${topic.label}: 직접 연결 리포트가 부족하므로 계좌/카테고리 근거만으로 고확신 격상 금지.`);
    }
    if ((topic.evidence ?? []).length === 0) {
      improve.push(`${topic.label}: 오늘 수집 리포트에서 직접 근거가 얕아 2차 딥리서치 질문으로 보강 필요.`);
    }
    if (
      topic.scope === "security" &&
      (topic.evidence ?? []).length > 0 &&
      (topic.evidence ?? []).every((item) => !item.isDirectSecurityMatch && !item.isPortfolioLinked)
    ) {
      improve.push(`${topic.label}: 직접 종목 근거보다 테마/매크로 근거 비중이 높아 재검증 질문을 우선 배치합니다.`);
    }
  }

  if ((stage4?.accountPlans ?? []).some((plan) => (plan?.holds ?? []).some((item) => String(item?.reason ?? "").includes("...")))) {
    avoid.push("보유·관망 사유는 말줄임표로 끝내지 않고 유지 이유와 재판단 조건을 완결된 문장으로 남깁니다.");
  }

  return {
    avoid: uniqueStrings(avoid),
    improve: uniqueStrings(improve),
  };
}

function buildFollowUpQueries(topics, round = 2) {
  const reportReindexQueries = topics.map((topic) => ({
    topic: topic.label,
    query: uniqueStrings(topic.keywords).slice(0, 6).join(" / "),
  }));

  const deepResearchQuestions = topics.map((topic) => ({
    topic: topic.label,
    questions: buildTopicQuestions(topic, round),
  }));

  return {
    reportReindexQueries,
    deepResearchQuestions,
  };
}

function buildFollowUpGapSummary(topic, round = 2) {
  const evidence = topic?.evidence ?? [];
  const directSecurityEvidence = evidence.filter((item) => item.isDirectSecurityMatch);
  const extractEvidence = evidence.filter((item) => item.sourceType === "extract");

  if (round >= 3 && topic.scope === "security" && evidence.length > 0 && evidence.length <= 2) {
    return [
      "마지막 세부화 단계에서도 직접 evidence가 얇아, 지금은 확신보다 대체재·무효화 조건을 더 분명히 남겨야 합니다.",
    ];
  }

  if (topic.scope === "security" && directSecurityEvidence.length === 0) {
    return [
      "직접 종목 alias evidence가 약해, 2차 딥리서치에서 논리 검증과 대체재 비교를 우선 보강해야 합니다.",
    ];
  }

  if (topic.scope === "security" && extractEvidence.length === 0) {
    return ["리포트 원문 재검색은 있었지만 Stage 1 extract 수준의 정제 근거가 부족합니다."];
  }

  if (evidence.length <= 1) {
    return ["직접 evidence가 한 건뿐이라 단일 근거 과적합을 경계해야 합니다."];
  }

  return [];
}

function formatEvidenceLine(item) {
  const typeLabel = item.sourceType === "extract" ? "extract" : "report";
  const reportType = item.reportType ? ` / ${item.reportType}` : "";
  return `- ${item.title} (${item.broker ?? "브로커 미상"}) / ${typeLabel}${reportType} / score ${item.score}: ${item.excerpt} [키워드: ${item.matchedKeywords.join(", ")}]`;
}

function topicMarkdown(topic, round = 2) {
  const evidenceLines =
    (topic.evidence ?? []).length > 0
      ? topic.evidence.map((item) => formatEvidenceLine(item))
      : ["- 오늘 수집 리포트 기준 직접 근거가 약합니다."];

  return [
    `### ${topic.label}`,
    "",
    `- scope: ${topic.scope}`,
    `- priority: ${topic.priority}`,
    `- why_now: ${topic.reason}`,
    `- account: ${(topic.accountKeys ?? []).join(", ") || "N/A"}`,
    `- keywords: ${(topic.keywords ?? []).join(" / ") || "N/A"}`,
    "",
    "질문:",
    ...buildTopicQuestions(topic, round).map((item) => `- ${item}`),
    ...(topic.gaps ?? []).length > 0 ? ["", "보강 필요:", ...(topic.gaps ?? []).map((item) => `- ${item}`)] : [],
    "",
    "재인덱싱 evidence:",
    ...evidenceLines,
    "",
  ].join("\n");
}

async function main() {
  const args = parseRefinementArgs(process.argv.slice(2));
  const spec = refinementRoundSpec(args.round);
  const paths = refinementArtifactPaths({ date: args.date, round: args.round });
  const priorRound = previousRefinementRound(args.round);
  const priorPaths = priorRound
    ? refinementArtifactPaths({ date: args.date, round: priorRound })
    : null;
  const runMeta = buildRunMetadata(args);

  const [
    stage1,
    stage2,
    stage3,
    stage4,
    reportIndex,
    richBriefing,
    deepResearch,
    priorMap,
    priorResponse,
    operatingRules,
    researchBacklog,
    decisionJournal,
  ] = await Promise.all([
    readJson(path.join(paths.analysisDir, "stage1-report-extracts-v2.json"), null),
    readJson(path.join(paths.analysisDir, "stage2-strategy-options.json"), null),
    readJson(path.join(paths.analysisDir, "stage3-quant-scores.json"), null),
    readJson(path.join(paths.analysisDir, "stage4-execution-plan.json"), null),
    readJson(path.join(ROOT_DIR, "data", "reports", args.date, "index.json"), []),
    readText(path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-gemini-briefing-rich.md`), ""),
    readText(path.join(paths.manualKitDir, "09-stage1-5-gemini-deep-research-response.md"), ""),
    priorPaths ? readJson(priorPaths.mapJson, null) : null,
    priorPaths ? readText(priorPaths.response, "") : "",
    readText(path.join(ROOT_DIR, "knowledge", "wiki", "memory", "operating-rules.md"), ""),
    readText(path.join(ROOT_DIR, "knowledge", "wiki", "memory", "research-backlog.md"), ""),
    readText(path.join(ROOT_DIR, "knowledge", "wiki", "memory", "decision-journal.md"), ""),
  ]);

  if (!stage1) {
    throw new Error(`Stage 1 extract가 없습니다: ${path.join(paths.analysisDir, "stage1-report-extracts-v2.json")}`);
  }

  if (!stage4) {
    throw new Error(`Stage 4 plan이 없습니다: ${path.join(paths.analysisDir, "stage4-execution-plan.json")}`);
  }

  const reports = await loadReportTexts(reportIndex);
  const context = {
    priorMap,
    priorResponse,
    operatingRules,
    researchBacklog,
    decisionJournal,
  };

  const candidateTopics = uniqueBy(
    [...buildMacroTopics(stage1, stage4), ...buildPlanTopics(stage1, stage4)]
      .sort(
        (left, right) =>
          scoreTopicForRound(right, args.round, context) - scoreTopicForRound(left, args.round, context),
      )
      .slice(0, Math.max(spec.topicLimit * 2, 12)),
    (item) => item.id,
  ).map((topic) => {
    const evidence = collectEvidenceForTopic(topic, reports, stage1);
    const directExtractCount =
      topic.scope === "security"
        ? findMatchingExtracts(stage1, topic.targetCodes?.[0] ?? null, topic.label, topic.keywords).length
        : null;

    return {
      ...topic,
      evidence,
      directExtractCount,
      gaps: buildFollowUpGapSummary({ ...topic, evidence }, args.round),
      questions: buildTopicQuestions(topic, args.round),
      priority: scoreTopicForRound({ ...topic, evidence, directExtractCount }, args.round, context),
    };
  });

  const topics = candidateTopics
    .sort((left, right) => right.priority - left.priority)
    .slice(0, spec.topicLimit);

  const lessons = buildDynamicLessons(topics, stage4, args.round);
  const followUpPrompts = buildFollowUpQueries(topics, args.round);
  const payload = {
    date: runMeta.date,
    runDate: runMeta.runDate,
    effectiveMarketDate: runMeta.effectiveMarketDate,
    runId: runMeta.runId,
    generatedAt: runMeta.generatedAt,
    round: spec.round,
    label: spec.label,
    summary: {
      reportCount: Array.isArray(reportIndex) ? reportIndex.length : 0,
      topicCount: topics.length,
      evidenceRichTopicCount: topics.filter((topic) => (topic.evidence ?? []).length >= 2).length,
      lowEvidenceTopicCount: topics.filter((topic) => (topic.evidence ?? []).length < 2).length,
      stage1ReportCount: stage1?.reportCount ?? (stage1?.extracts ?? []).length ?? 0,
      richBriefingAvailable: Boolean(normalizeText(richBriefing)),
      deepResearchAvailable: Boolean(normalizeText(deepResearch)),
      stage3Available: Boolean(stage3),
      stage2Available: Boolean(stage2),
      priorRoundAvailable: Boolean(priorMap || normalizeText(priorResponse)),
    },
    topics,
    lessons,
    followUpPrompts,
  };

  const markdown = [
    `# ${spec.stageKey.toUpperCase()} ${spec.label} Research Map (${args.date})`,
    "",
    "## Snapshot",
    "",
    `- refinement_round: ${spec.round}`,
    `- purpose: ${spec.purpose}`,
    `- report_count: ${payload.summary.reportCount}`,
    `- focus_topics: ${payload.summary.topicCount}`,
    `- evidence_rich_topics: ${payload.summary.evidenceRichTopicCount}`,
    `- low_evidence_topics: ${payload.summary.lowEvidenceTopicCount}`,
    `- rich_briefing_available: ${payload.summary.richBriefingAvailable ? "yes" : "no"}`,
    `- deep_research_available: ${payload.summary.deepResearchAvailable ? "yes" : "no"}`,
    `- stage2_available: ${payload.summary.stage2Available ? "yes" : "no"}`,
    `- prior_round_available: ${payload.summary.priorRoundAvailable ? "yes" : "no"}`,
    "",
    "## No-Go Rules",
    "",
    ...payload.lessons.avoid.map((item) => `- ${item}`),
    "",
    "## Improve Next",
    "",
    ...payload.lessons.improve.map((item) => `- ${item}`),
    "",
    "## Priority Topics",
    "",
    ...payload.topics.map((topic) => topicMarkdown(topic, args.round)),
    "## Follow-up Deep Research Questions",
    "",
    ...payload.followUpPrompts.deepResearchQuestions.flatMap((item) => [
      `### ${item.topic}`,
      ...item.questions.map((question) => `- ${question}`),
      "",
    ]),
    "## Report Reindex Queries",
    "",
    ...payload.followUpPrompts.reportReindexQueries.map(
      (item) => `- ${item.topic}: ${item.query}`,
    ),
    "",
  ].join("\n");

  await writeJson(paths.mapJson, payload);
  await writeText(paths.mapMarkdown, `${markdown}\n`);

  console.log(paths.mapJson);
  console.log(paths.mapMarkdown);
}

main().catch((error) => {
  console.error(`refinement research map 생성 실패: ${error.message}`);
  process.exit(1);
});
