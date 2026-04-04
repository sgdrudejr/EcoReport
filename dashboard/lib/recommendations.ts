import { loadLatestPortfolio, type PortfolioSnapshot } from "@/lib/portfolio";
import {
  listRepoDirectories,
  listRepoFiles,
  readRepoJsonFile,
} from "@/lib/repo-artifacts";

type WatchlistEntry = {
  code: string;
  name: string;
  account?: string;
};

type WatchlistConfig = {
  core_etf?: WatchlistEntry[];
  satellite_etf?: WatchlistEntry[];
  individual_stocks?: WatchlistEntry[];
};

type Stage1Extract = {
  id: string;
  title: string;
  themes?: string[];
  sentiment_score?: number | null;
  confidence?: number | string | null;
  portfolio_impacts_candidate?: Array<{
    target_code?: string;
    target_name?: string;
    account_key?: string;
    direction?: string;
    strength?: number;
    reason?: string;
  }>;
};

type Stage2Candidate = {
  code: string;
  name: string;
  stance?: string;
  target_accounts?: string[];
  confidence?: string;
  thesis?: string;
  risks?: string[];
  horizon?: string;
};

type Stage4AccountPlan = {
  key: string;
  label: string;
  stagedBuys?: Array<{
    code?: string;
    name?: string;
    suggestedAmount?: number;
  }>;
  candidateFromGap?: string | null;
};

type TechnicalScore = {
  code: string;
  name: string;
  score?: number | null;
  signal?: string | null;
  signal_reason?: string | null;
  change_pct?: number | null;
};

type Stage3Holding = {
  code: string;
  technicalBaseScore?: number | null;
  actionScore?: number | null;
  signal?: string | null;
  reportImpacts?: Array<{
    reportId?: string;
    title?: string;
    direction?: string;
    strength?: number;
    confidence?: number;
    reason?: string;
  }>;
};

type CandidateMeta = {
  code: string;
  name: string;
  lane: RecommendationLaneKey;
  kind: "ETF" | "STOCK";
  themes: string[];
  preferredAccounts: string[];
};

type ThemeSummary = {
  theme: string;
  mentions: number;
  avgSentiment: number;
  signalScore: number;
};

export type RecommendationLaneKey = "core" | "sector" | "stock";

export type RecommendationIdea = {
  code: string;
  name: string;
  lane: RecommendationLaneKey;
  kind: "ETF" | "STOCK";
  held: boolean;
  tag: "보강 후보" | "관찰 후보";
  score: number;
  technicalScore: number | null;
  reportScore: number;
  stage2Score: number | null;
  accountFitScore: number;
  signal: string | null;
  changePct: number | null;
  dominantTheme: string;
  themes: string[];
  targetAccounts: string[];
  rationale: string;
  reasons: string[];
  risks: string[];
};

export type RecommendationLane = {
  key: RecommendationLaneKey;
  title: string;
  description: string;
  items: RecommendationIdea[];
};

export type RecommendationBoard = {
  date: string | null;
  themeSummary: ThemeSummary[];
  highlightedThemes: string[];
  lanes: RecommendationLane[];
};

const CODE_METADATA: Record<string, CandidateMeta> = {
  "360750": {
    code: "360750",
    name: "TIGER 미국S&P500",
    lane: "core",
    kind: "ETF",
    themes: ["미국 대형주", "코어 인덱스"],
    preferredAccounts: ["PENSION"],
  },
  "133690": {
    code: "133690",
    name: "TIGER 미국나스닥100",
    lane: "core",
    kind: "ETF",
    themes: ["AI 인프라", "미국 성장주"],
    preferredAccounts: ["PENSION"],
  },
  "458760": {
    code: "458760",
    name: "TIGER 미국배당+7%프리미엄다우존스",
    lane: "core",
    kind: "ETF",
    themes: ["배당", "미국 대형주"],
    preferredAccounts: ["ISA"],
  },
  "132030": {
    code: "132030",
    name: "KODEX 골드선물(H)",
    lane: "core",
    kind: "ETF",
    themes: ["금/원자재", "안전자산"],
    preferredAccounts: ["ISA", "PENSION"],
  },
  "423160": {
    code: "423160",
    name: "KODEX KOFR금리액티브",
    lane: "core",
    kind: "ETF",
    themes: ["금리/매크로", "현금파킹"],
    preferredAccounts: ["ISA", "PENSION", "TOSS"],
  },
  "2921050": {
    code: "2921050",
    name: "TIGER코리아TOP10",
    lane: "core",
    kind: "ETF",
    themes: ["국내 코어", "AI 인프라"],
    preferredAccounts: ["ISA"],
  },
  "487240": {
    code: "487240",
    name: "KODEX AI전력핵심설비",
    lane: "sector",
    kind: "ETF",
    themes: ["AI 인프라", "전력 인프라"],
    preferredAccounts: ["TOSS"],
  },
  "449450": {
    code: "449450",
    name: "PLUS K방산",
    lane: "sector",
    kind: "ETF",
    themes: ["방산"],
    preferredAccounts: ["TOSS", "ISA"],
  },
  "434730": {
    code: "434730",
    name: "HANARO 원자력iSelect",
    lane: "sector",
    kind: "ETF",
    themes: ["원자력"],
    preferredAccounts: ["TOSS"],
  },
  "005930": {
    code: "005930",
    name: "삼성전자",
    lane: "stock",
    kind: "STOCK",
    themes: ["HBM/메모리", "AI 인프라"],
    preferredAccounts: ["관찰"],
  },
  "000660": {
    code: "000660",
    name: "SK하이닉스",
    lane: "stock",
    kind: "STOCK",
    themes: ["HBM/메모리", "AI 인프라"],
    preferredAccounts: ["관찰"],
  },
  "267260": {
    code: "267260",
    name: "HD현대일렉트릭",
    lane: "stock",
    kind: "STOCK",
    themes: ["전력 인프라"],
    preferredAccounts: ["관찰"],
  },
  "010120": {
    code: "010120",
    name: "LS ELECTRIC",
    lane: "stock",
    kind: "STOCK",
    themes: ["전력 인프라"],
    preferredAccounts: ["관찰"],
  },
  "298040": {
    code: "298040",
    name: "효성중공업",
    lane: "stock",
    kind: "STOCK",
    themes: ["전력 인프라"],
    preferredAccounts: ["관찰"],
  },
  "064350": {
    code: "064350",
    name: "현대로템",
    lane: "stock",
    kind: "STOCK",
    themes: ["방산"],
    preferredAccounts: ["관찰"],
  },
  "047810": {
    code: "047810",
    name: "한국항공우주",
    lane: "stock",
    kind: "STOCK",
    themes: ["방산"],
    preferredAccounts: ["관찰"],
  },
};

function findLatestAnalysisDate(fileName: string, dateHint?: string) {
  if (
    dateHint &&
    readRepoJsonFile(`data/analysis-state/${dateHint}/${fileName}`)
  ) {
    return dateHint;
  }

  const dirs = listRepoDirectories("data/analysis-state").sort().reverse();
  for (const dir of dirs) {
    if (readRepoJsonFile(`data/analysis-state/${dir}/${fileName}`)) {
      return dir;
    }
  }

  return null;
}

function loadStage1(dateHint?: string) {
  const date = findLatestAnalysisDate("stage1-report-extracts-v2.json", dateHint);
  if (!date) return { date: dateHint ?? null, extracts: [] as Stage1Extract[] };
  const parsed = readRepoJsonFile<{
    date?: string;
    extracts?: Stage1Extract[];
  }>(`data/analysis-state/${date}/stage1-report-extracts-v2.json`);
  return {
    date: parsed?.date ?? date,
    extracts: parsed?.extracts ?? [],
  };
}

function loadStage2(dateHint?: string) {
  const date = findLatestAnalysisDate("stage2-strategy-options.json", dateHint);
  if (!date) return { date: dateHint ?? null, candidates: [] as Stage2Candidate[] };
  const parsed = readRepoJsonFile<{
    date?: string;
    candidate_scores?: Stage2Candidate[];
  }>(`data/analysis-state/${date}/stage2-strategy-options.json`);
  return {
    date: parsed?.date ?? date,
    candidates: parsed?.candidate_scores ?? [],
  };
}

function loadStage3(dateHint?: string) {
  const date = findLatestAnalysisDate("stage3-quant-scores.json", dateHint);
  if (!date) return { date: dateHint ?? null, holdings: {} as Record<string, Stage3Holding> };
  const parsed = readRepoJsonFile<{
    date?: string;
    holdings?: Record<string, Stage3Holding>;
  }>(`data/analysis-state/${date}/stage3-quant-scores.json`);
  return {
    date: parsed?.date ?? date,
    holdings: parsed?.holdings ?? {},
  };
}

function loadStage4(dateHint?: string) {
  const date = findLatestAnalysisDate("stage4-execution-plan.json", dateHint);
  if (!date) return { date: dateHint ?? null, accountPlans: [] as Stage4AccountPlan[] };
  const parsed = readRepoJsonFile<{
    date?: string;
    accountPlans?: Stage4AccountPlan[];
  }>(`data/analysis-state/${date}/stage4-execution-plan.json`);
  return {
    date: parsed?.date ?? date,
    accountPlans: parsed?.accountPlans ?? [],
  };
}

function loadLatestTechnical(dateHint?: string) {
  if (dateHint) {
    const preferred = readRepoJsonFile<{
      date?: string;
      scores?: Record<string, TechnicalScore>;
    }>(`data/technical/${dateHint}.json`);
    if (preferred) {
      return preferred;
    }
  }

  const file = listRepoFiles("data/technical")
    .filter((entry) => /^\d{4}-\d{2}-\d{2}\.json$/.test(entry))
    .sort()
    .reverse()[0];

  if (!file) return null;
  return readRepoJsonFile<{ date?: string; scores?: Record<string, TechnicalScore> }>(
    `data/technical/${file}`,
  );
}

function loadWatchlistUniverse() {
  const config = readRepoJsonFile<WatchlistConfig>("config/watchlist.json");
  const result = new Map<string, CandidateMeta>();

  for (const entry of config?.core_etf ?? []) {
    result.set(entry.code, {
      ...(CODE_METADATA[entry.code] ?? {
        code: entry.code,
        name: entry.name,
        lane: "core",
        kind: "ETF",
        themes: [],
        preferredAccounts: [],
      }),
      name: entry.name,
    });
  }

  for (const entry of config?.satellite_etf ?? []) {
    result.set(entry.code, {
      ...(CODE_METADATA[entry.code] ?? {
        code: entry.code,
        name: entry.name,
        lane: "sector",
        kind: "ETF",
        themes: [],
        preferredAccounts: [],
      }),
      name: entry.name,
    });
  }

  for (const entry of config?.individual_stocks ?? []) {
    result.set(entry.code, {
      ...(CODE_METADATA[entry.code] ?? {
        code: entry.code,
        name: entry.name,
        lane: "stock",
        kind: "STOCK",
        themes: [],
        preferredAccounts: [],
      }),
      name: entry.name,
    });
  }

  for (const [code, meta] of Object.entries(CODE_METADATA)) {
    if (!result.has(code)) {
      result.set(code, meta);
    }
  }

  return [...result.values()];
}

function normalizeAccountLabel(account: string) {
  if (account === "PENSION") return "연금저축";
  if (account === "TOSS") return "토스증권";
  return account;
}

function normalizeConfidence(value?: string | number | null) {
  if (typeof value === "number") return clamp(value, 0, 1);
  if (value === "HIGH") return 1;
  if (value === "MEDIUM") return 0.6;
  if (value === "LOW") return 0.3;
  return 0.5;
}

function directionToNumber(direction?: string | null) {
  if (direction === "positive") return 1;
  if (direction === "negative") return -1;
  if (direction === "mixed") return -0.2;
  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildThemeSummary(extracts: Stage1Extract[]) {
  const themeMap = new Map<
    string,
    { mentions: number; sentimentSum: number; positive: number; negative: number }
  >();

  for (const extract of extracts) {
    const sentiment = extract.sentiment_score ?? 0;
    for (const theme of extract.themes ?? []) {
      const current = themeMap.get(theme) ?? {
        mentions: 0,
        sentimentSum: 0,
        positive: 0,
        negative: 0,
      };
      current.mentions += 1;
      current.sentimentSum += sentiment;
      if (sentiment > 0) current.positive += 1;
      if (sentiment < 0) current.negative += 1;
      themeMap.set(theme, current);
    }
  }

  return [...themeMap.entries()]
    .map(([theme, value]) => {
      const avgSentiment = value.mentions > 0 ? value.sentimentSum / value.mentions : 0;
      const signalScore = clamp(
        Math.round(50 + Math.min(value.mentions, 10) * 2 + avgSentiment * 25),
        0,
        100,
      );

      return {
        theme,
        mentions: value.mentions,
        avgSentiment,
        signalScore,
      } satisfies ThemeSummary;
    })
    .sort((left, right) => {
      if (right.signalScore !== left.signalScore) {
        return right.signalScore - left.signalScore;
      }
      return right.mentions - left.mentions;
    });
}

function stage2StanceScore(candidate?: Stage2Candidate) {
  if (!candidate) return null;

  const confidenceMultiplier = normalizeConfidence(candidate.confidence);
  const base =
    candidate.stance === "buy"
      ? 80
      : candidate.stance === "hold"
        ? 58
        : candidate.stance === "trim"
          ? 34
          : candidate.stance === "sell"
            ? 20
            : 50;

  return clamp(Math.round(base + (confidenceMultiplier - 0.5) * 18), 0, 100);
}

function buildHeldCodeSet(portfolio: PortfolioSnapshot | null) {
  const held = new Set<string>();
  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings) {
      if (holding.code) {
        held.add(holding.code);
      }
    }
  }
  return held;
}

function buildStage4BuyMap(accountPlans: Stage4AccountPlan[]) {
  const buyMap = new Map<string, string[]>();

  for (const plan of accountPlans) {
    for (const stagedBuy of plan.stagedBuys ?? []) {
      if (!stagedBuy.code) continue;
      const current = buyMap.get(stagedBuy.code) ?? [];
      if (!current.includes(plan.label)) {
        current.push(plan.label);
      }
      buyMap.set(stagedBuy.code, current);
    }
  }

  return buyMap;
}

function getPrimaryTheme(themes: string[], themeScores: Map<string, ThemeSummary>) {
  const ranked = [...themes].sort((left, right) => {
    return (themeScores.get(right)?.signalScore ?? 50) - (themeScores.get(left)?.signalScore ?? 50);
  });
  return ranked[0] ?? "기타";
}

function selectDiverseIdeas(candidates: RecommendationIdea[], limit: number) {
  const selected: RecommendationIdea[] = [];
  const themeUsage = new Map<string, number>();

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const used = themeUsage.get(candidate.dominantTheme) ?? 0;
    if (used > 0) continue;
    selected.push(candidate);
    themeUsage.set(candidate.dominantTheme, used + 1);
  }

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (selected.some((item) => item.code === candidate.code)) continue;
    selected.push(candidate);
  }

  return selected;
}

function laneThreshold(key: RecommendationLaneKey) {
  if (key === "core") return 52;
  if (key === "sector") return 50;
  return 54;
}

function pickLaneIdeas(
  key: RecommendationLaneKey,
  candidates: RecommendationIdea[],
  limit: number,
) {
  const threshold = laneThreshold(key);
  const primary = candidates.filter((candidate) => candidate.score >= threshold);
  const selected = selectDiverseIdeas(primary, limit);

  if (selected.length >= limit) {
    return selected;
  }

  const backup = candidates.filter(
    (candidate) =>
      !selected.some((item) => item.code === candidate.code) &&
      (candidate.targetAccounts.length > 0 ||
        candidate.stage2Score != null ||
        candidate.reportScore >= 65 ||
        candidate.technicalScore != null),
  );

  return selectDiverseIdeas([...selected, ...backup], limit).slice(0, limit);
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function loadRecommendationBoard(dateHint?: string): RecommendationBoard | null {
  const portfolio = loadLatestPortfolio();
  const heldCodes = buildHeldCodeSet(portfolio);
  const stage1 = loadStage1(dateHint);
  const stage2 = loadStage2(stage1.date ?? dateHint);
  const stage3 = loadStage3(stage2.date ?? stage1.date ?? dateHint);
  const stage4 = loadStage4(stage3.date ?? stage2.date ?? stage1.date ?? dateHint);
  const technical = loadLatestTechnical(stage3.date ?? stage2.date ?? stage1.date ?? dateHint);
  const universe = loadWatchlistUniverse();

  const themeSummary = buildThemeSummary(stage1.extracts);
  const themeScoreMap = new Map(themeSummary.map((item) => [item.theme, item]));
  const stage2Map = new Map(stage2.candidates.map((item) => [item.code, item]));
  const stage4BuyMap = buildStage4BuyMap(stage4.accountPlans);

  const ideas = universe
    .map((meta) => {
      const technicalItem = technical?.scores?.[meta.code] ?? null;
      const stage3Holding = stage3.holdings?.[meta.code] ?? null;
      const stage2Candidate = stage2Map.get(meta.code);
      const technicalScore =
        technicalItem?.score ??
        stage3Holding?.technicalBaseScore ??
        null;
      const stage2Score = stage2StanceScore(stage2Candidate);
      const themeScores = meta.themes
        .map((theme) => themeScoreMap.get(theme)?.signalScore ?? 50);
      const reportThemeScore =
        themeScores.length > 0
          ? Math.round(themeScores.reduce((sum, value) => sum + value, 0) / themeScores.length)
          : 50;

      const directImpacts = stage1.extracts.flatMap((extract) =>
        (extract.portfolio_impacts_candidate ?? [])
          .filter((impact) => impact.target_code === meta.code)
          .map((impact) => ({
            title: extract.title,
            value:
              directionToNumber(impact.direction) *
              (impact.strength ?? 0.4) *
              normalizeConfidence(extract.confidence),
          })),
      );
      const directImpactRaw = directImpacts.reduce((sum, item) => sum + item.value, 0);
      const directImpactScore =
        directImpacts.length > 0
          ? clamp(Math.round(50 + directImpactRaw * 25), 0, 100)
          : null;

      const reportScore =
        directImpactScore == null
          ? reportThemeScore
          : Math.round(reportThemeScore * 0.65 + directImpactScore * 0.35);

      const targetAccounts = [
        ...(stage4BuyMap.get(meta.code) ?? []),
        ...((stage2Candidate?.target_accounts ?? []).map(normalizeAccountLabel)),
        ...meta.preferredAccounts.map(normalizeAccountLabel),
      ].filter((value, index, array) => value && array.indexOf(value) === index);

      const accountFitScore = stage4BuyMap.has(meta.code)
        ? 82
        : stage2Candidate?.target_accounts?.length
          ? 70
          : meta.preferredAccounts.length > 0
            ? 60
            : 50;

      const weights =
        stage2Score == null
          ? { technical: 0.58, report: 0.3, stage2: 0, fit: 0.12 }
          : { technical: 0.48, report: 0.22, stage2: 0.2, fit: 0.1 };

      const laneBonus =
        meta.lane === "core"
          ? 3
          : meta.lane === "sector"
            ? 2
            : 0;

      const totalRaw =
        (technicalScore ?? 45) * weights.technical +
        reportScore * weights.report +
        accountFitScore * weights.fit +
        (stage2Score ?? 0) * weights.stage2 +
        laneBonus;

      const signalPenalty =
        technicalItem?.signal === "SELL"
          ? 10
          : technicalItem?.signal === "REDUCE"
            ? 6
            : 0;

      const score = clamp(Math.round(totalRaw - signalPenalty), 0, 100);
      const dominantTheme = getPrimaryTheme(meta.themes, themeScoreMap);
      const thesis =
        stage2Candidate?.thesis ??
        (meta.themes.length > 0
          ? `${meta.themes.join(" · ")} 흐름에서 리포트 언급 강도와 기술 점수가 함께 받쳐주는 후보입니다.`
          : "기술 점수와 포트폴리오 적합도를 함께 고려한 관찰 후보입니다.");

      const reasons = [
        `리포트 테마 ${dominantTheme} 신호 ${reportScore}점`,
        `기술 점수 ${technicalScore != null ? `${technicalScore}점` : "데이터 부족"}${
          technicalItem?.signal ? ` · ${technicalItem.signal}` : ""
        }`,
        stage2Candidate
          ? `Stage 2 ${stage2Candidate.stance ?? "hold"} · ${stage2Candidate.confidence ?? "MEDIUM"}`
          : "Stage 2 명시 후보는 아니지만 리포트/기술 점수로 선별",
      ];

      if (targetAccounts.length > 0) {
        reasons.push(`적합 계좌: ${targetAccounts.join(", ")}`);
      }

      if (formatSignedPercent(technicalItem?.change_pct ?? null)) {
        reasons.push(`최근 등락 ${formatSignedPercent(technicalItem?.change_pct ?? null)}`);
      }

      const risks = [
        ...(stage2Candidate?.risks ?? []),
        ...(technicalItem?.signal === "SELL" || technicalItem?.signal === "REDUCE"
          ? ["기술 추세는 아직 보수적이라 분할 접근이 필요합니다."]
          : []),
      ].slice(0, 2);

      return {
        code: meta.code,
        name: meta.name,
        lane: meta.lane,
        kind: meta.kind,
        held: heldCodes.has(meta.code),
        tag: score >= 60 ? "보강 후보" : "관찰 후보",
        score,
        technicalScore,
        reportScore,
        stage2Score,
        accountFitScore,
        signal: technicalItem?.signal ?? stage3Holding?.signal ?? null,
        changePct: technicalItem?.change_pct ?? null,
        dominantTheme,
        themes: meta.themes,
        targetAccounts,
        rationale: thesis,
        reasons,
        risks,
      } satisfies RecommendationIdea;
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (right.technicalScore ?? 0) - (left.technicalScore ?? 0);
    });

  if (ideas.length === 0) {
    return null;
  }

  const lanes = [
    {
      key: "core",
      title: "코어 ETF",
      description: "계좌의 중심 비중을 채우는 안정적 코어 자산입니다.",
      items: pickLaneIdeas(
        "core",
        ideas.filter((idea) => idea.lane === "core"),
        3,
      ),
    },
    {
      key: "sector",
      title: "섹터 ETF",
      description: "리포트 강세 테마를 전술적으로 반영하는 위성 자산입니다.",
      items: pickLaneIdeas(
        "sector",
        ideas.filter((idea) => idea.lane === "sector"),
        3,
      ),
    },
    {
      key: "stock",
      title: "개별주",
      description: "테마 강도와 기술 신호가 함께 받쳐주는 단일 종목 후보입니다.",
      items: pickLaneIdeas(
        "stock",
        ideas.filter((idea) => idea.lane === "stock"),
        4,
      ),
    },
  ] satisfies RecommendationLane[];

  return {
    date: stage4.date ?? stage3.date ?? stage2.date ?? stage1.date ?? technical?.date ?? null,
    themeSummary: themeSummary.slice(0, 6),
    highlightedThemes: themeSummary.slice(0, 4).map((item) => item.theme),
    lanes,
  };
}
