import fs from "fs";
import path from "path";
import {
  getAccountHoldingsProfitLoss,
  getAccountHoldingsProfitRate,
  getAccountHoldingsValue,
  type PortfolioAccount,
  type PortfolioSnapshot,
} from "@/lib/portfolio";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const STRATEGY_FILE = path.join(REPO_ROOT, "config", "strategy.json");
const TECHNICAL_DIR = path.join(REPO_ROOT, "data", "technical");

type StrategyAccountKey = "ISA" | "연금저축" | "토스증권";

type StrategyAllocation = {
  name?: string;
  period?: { start: string; end: string };
  accounts?: Record<
    StrategyAccountKey,
    {
      cash?: number;
      target_allocation?: Record<string, number>;
    }
  >;
  dca_plan?: {
    total_tranches?: number;
    completed?: number;
    schedule?: Array<{
      tranche?: number;
      pct?: number;
      target_date?: string;
      status?: string;
    }>;
  };
};

export type CategoryGuide = {
  category: string;
  currentAmount: number;
  currentPct: number;
  targetPct: number;
  gapPct: number;
  gapAmount: number;
  action: "보강 필요" | "비중 축소" | "유지";
  preferredLabel?: string;
};

export type AccountGuide = {
  key: string;
  label: string;
  score: number;
  allocationScore: number;
  technicalScore: number | null;
  reportCoverageScore: number | null;
  stage2Bias: string | null;
  status: "양호" | "보강 필요" | "조정 필요";
  totalAssets: number;
  holdingsValue: number;
  holdingsProfitLoss: number;
  holdingsProfitRate: number | null;
  cashValue: number;
  cashPct: number;
  targetCashPct: number;
  recommendedDeploy: number;
  reserveCash: number;
  note: string;
  candidates: string[];
  categories: CategoryGuide[];
  topSignals: string[];
  scoreDrivers: string[];
  improvementActions: string[];
};

export type PortfolioGuide = {
  score: number;
  totalAssets: number;
  totalCash: number;
  totalCashPct: number;
  nextTranchePct: number;
  globalStatus: "양호" | "보강 필요" | "조정 필요";
  globalActions: string[];
  incompleteCount: number;
  accounts: AccountGuide[];
};

const TARGET_LABEL_BY_CODE: Record<
  string,
  { default: string; ISA?: string; PENSION?: string; TOSS?: string }
> = {
  "458760": { default: "배당/커버드콜", ISA: "배당/커버드콜" },
  "132030": { default: "금", ISA: "금", PENSION: "금" },
  "360750": { default: "미국인덱스", ISA: "미국인덱스", PENSION: "S&P500" },
  "133690": { default: "나스닥100", PENSION: "나스닥100" },
  "423160": { default: "현금파킹", ISA: "현금파킹", PENSION: "현금파킹", TOSS: "현금파킹" },
  "487240": { default: "전력기기", TOSS: "전력기기" },
  "449450": { default: "방산", TOSS: "방산" },
  "434730": { default: "원자력", TOSS: "원자력" },
};

const PREFERRED_LABEL_BY_CATEGORY: Record<string, string> = {
  "배당/커버드콜": "TIGER 미국배당+7%프리미엄다우존스",
  금: "KODEX 골드선물(H)",
  미국인덱스: "TIGER 미국S&P500",
  "S&P500": "TIGER 미국S&P500",
  나스닥100: "TIGER 미국나스닥100",
  현금파킹: "KODEX KOFR금리액티브",
  전력기기: "KODEX AI전력핵심설비",
  방산: "PLUS K방산",
  원자력: "HANARO 원자력iSelect",
};

function readStrategy(): StrategyAllocation | null {
  if (!fs.existsSync(STRATEGY_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8")) as StrategyAllocation;
  } catch {
    return null;
  }
}

function readLatestTechnical(dateHint?: string) {
  try {
    const preferredPath = dateHint ? path.join(TECHNICAL_DIR, `${dateHint}.json`) : null;
    if (preferredPath && fs.existsSync(preferredPath)) {
      return JSON.parse(fs.readFileSync(preferredPath, "utf8"));
    }

    const files = fs
      .readdirSync(TECHNICAL_DIR)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) {
      return null;
    }

    return JSON.parse(fs.readFileSync(path.join(TECHNICAL_DIR, files[0]), "utf8"));
  } catch {
    return null;
  }
}

function readStage3Analysis(dateHint?: string) {
  const analysisDir = path.join(REPO_ROOT, "data", "analysis-state");
  try {
    const preferredPath = dateHint
      ? path.join(analysisDir, dateHint, "stage3-quant-scores.json")
      : null;
    if (preferredPath && fs.existsSync(preferredPath)) {
      return JSON.parse(fs.readFileSync(preferredPath, "utf8"));
    }

    const datedDirs = fs
      .readdirSync(analysisDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const datedDir of datedDirs) {
      const candidate = path.join(analysisDir, datedDir, "stage3-quant-scores.json");
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, "utf8"));
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeStrategyAccountKey(account: PortfolioAccount): StrategyAccountKey | null {
  if (account.key === "ISA") return "ISA";
  if (account.key === "PENSION") return "연금저축";
  if (account.key === "TOSS") return "토스증권";
  return null;
}

function getCategoryForHolding(account: PortfolioAccount, code?: string | null) {
  if (!code) return "기타";
  const mapping = TARGET_LABEL_BY_CODE[code];
  if (!mapping) return "기타";
  if (account.key === "ISA" && mapping.ISA) return mapping.ISA;
  if (account.key === "PENSION" && mapping.PENSION) return mapping.PENSION;
  if (account.key === "TOSS" && mapping.TOSS) return mapping.TOSS;
  return mapping.default;
}

function getNextTranchePct(strategy: StrategyAllocation | null) {
  const pending =
    strategy?.dca_plan?.schedule?.find((item) => item.status !== "done" && item.status !== "completed") ??
    null;
  return pending?.pct ?? 0.25;
}

function getAccountTotalAssets(account: PortfolioAccount) {
  const holdingsValue = getAccountHoldingsValue(account);
  const cashValue = account.cashAvailable ?? 0;
  return Math.max(account.evaluationAmount ?? 0, holdingsValue + cashValue);
}

function categorizeAccount(
  account: PortfolioAccount,
  targetAllocation: Record<string, number>,
) {
  const holdingsByCategory = new Map<string, number>();

  for (const holding of account.holdings) {
    const category = getCategoryForHolding(account, holding.code);
    const current = holdingsByCategory.get(category) ?? 0;
    holdingsByCategory.set(category, current + (holding.marketValue ?? 0));
  }

  const totalAssets = getAccountTotalAssets(account);
  const holdingsValue = getAccountHoldingsValue(account);
  const inferredCash = Math.max(totalAssets - holdingsValue, 0);
  const cashValue = Math.max(account.cashAvailable ?? inferredCash, inferredCash);

  if (targetAllocation["현금파킹"] != null) {
    holdingsByCategory.set("현금파킹", cashValue);
  }

  const categories = new Set([
    ...Object.keys(targetAllocation),
    ...holdingsByCategory.keys(),
  ]);

  return {
    totalAssets,
    holdingsValue,
    cashValue,
    categories: [...categories].map((category) => {
      const currentAmount = holdingsByCategory.get(category) ?? 0;
      const currentPct = totalAssets > 0 ? currentAmount / totalAssets : 0;
      const targetPct = targetAllocation[category] ?? 0;
      const gapPct = targetPct - currentPct;
      const gapAmount = gapPct * totalAssets;

      return {
        category,
        currentAmount,
        currentPct,
        targetPct,
        gapPct,
        gapAmount,
        action:
          gapPct > 0.03 ? "보강 필요" : gapPct < -0.03 ? "비중 축소" : "유지",
        preferredLabel: PREFERRED_LABEL_BY_CATEGORY[category],
      } satisfies CategoryGuide;
    }),
  };
}

function getAccountScore(categoryGuides: CategoryGuide[], incomplete?: boolean) {
  const diff = categoryGuides.reduce(
    (sum, category) => sum + Math.abs(category.currentPct - category.targetPct),
    0,
  );
  let score = Math.round((1 - diff / 2) * 100);
  score = Math.max(0, Math.min(100, score));

  if (incomplete) {
    score = Math.max(0, score - 8);
  }

  return score;
}

function getTechnicalScoreForAccount(
  account: PortfolioAccount,
  technicalMap: Record<string, any> | null,
) {
  if (!technicalMap) {
    return {
      technicalScore: null,
      topSignals: [],
    };
  }

  const scoredHoldings = account.holdings
    .map((holding) => {
      const technical = holding.code ? technicalMap[holding.code] : null;
      if (!technical || typeof technical.score !== "number") {
        return null;
      }

      return {
        name: holding.name,
        weight: holding.marketValue ?? 0,
        score: technical.score,
        signal: technical.signal,
        signalReason: technical.signal_reason,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (scoredHoldings.length === 0) {
    return {
      technicalScore: null,
      topSignals: [],
    };
  }

  const totalWeight = scoredHoldings.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
  const weightedScore =
    totalWeight > 0
      ? scoredHoldings.reduce((sum, item) => sum + item.score * Math.max(item.weight, 0), 0) / totalWeight
      : scoredHoldings.reduce((sum, item) => sum + item.score, 0) / scoredHoldings.length;

  const topSignals = scoredHoldings
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => `${item.name} ${item.score}점 (${item.signal})`);

  return {
    technicalScore: Math.round(weightedScore),
    topSignals,
  };
}

function mergeScores(allocationScore: number, technicalScore: number | null, incomplete?: boolean) {
  let score =
    technicalScore == null
      ? allocationScore
      : Math.round(allocationScore * 0.6 + technicalScore * 0.4);

  if (incomplete) {
    score = Math.max(0, score - 5);
  }

  return Math.max(0, Math.min(100, score));
}

function getStatusFromScore(score: number): AccountGuide["status"] {
  if (score >= 75) return "양호";
  if (score >= 55) return "보강 필요";
  return "조정 필요";
}

function buildAccountNote(
  account: PortfolioAccount,
  score: number,
  technicalScore: number | null,
  recommendedDeploy: number,
  topShortfalls: CategoryGuide[],
  cashPct: number,
  targetCashPct: number,
) {
  if (account.incomplete) {
    return "부분 캡처 기준이라 가이드는 참고용입니다. 보유 누락분 확인 후 저장하면 정밀도가 올라갑니다.";
  }

  if (recommendedDeploy > 0 && topShortfalls.length > 0) {
    const top = topShortfalls[0];
    if (technicalScore != null && technicalScore < 45) {
      return `현금 비중은 높지만 기술 점수(${technicalScore}점)가 낮습니다. ${top.category} 보강은 가능하되, 추격보다는 분할 접근이 적절합니다.`;
    }

    return `현금 비중이 목표보다 높습니다. 이번 단계에서는 ${top.category} 중심으로 ${recommendedDeploy.toLocaleString()}원까지 나눠서 배치하는 편이 적절합니다.`;
  }

  if (cashPct < targetCashPct - 0.05) {
    return "현금 여유가 목표보다 낮습니다. 추가 진입보다 현재 보유분 유지와 대기 자금 복원이 우선입니다.";
  }

  if (technicalScore != null && technicalScore < 40) {
    return `배분은 크게 나쁘지 않지만 보유 기술 점수(${technicalScore}점)가 약합니다. 신규 확대보다 현재 보유분 점검이 우선입니다.`;
  }

  if (score >= 75) {
    return "현재 배분이 목표 범위에 비교적 근접합니다. 급하게 늘리기보다 기존 포지션 관리가 우선입니다.";
  }

  return "목표 배분과의 괴리가 남아 있습니다. 가장 부족한 자산부터 순서대로 보강하는 방식이 안정적입니다.";
}

function buildScoreDrivers(
  account: PortfolioAccount,
  allocationScore: number,
  technicalScore: number | null,
  reportCoverageScore: number | null,
  cashPct: number,
  targetCashPct: number,
  categories: CategoryGuide[],
) {
  const drivers: string[] = [];

  if (account.incomplete) {
    drivers.push("부분 캡처 계좌라 보유 누락 가능성이 있어 보수적으로 감점됐습니다.");
  }

  drivers.push(`배분 점수 ${allocationScore}점: 목표 배분과의 괴리를 기반으로 계산됩니다.`);

  if (technicalScore != null) {
    drivers.push(`기술 점수 ${technicalScore}점: RSI, MACD, 이평선, 변동성 신호를 합산한 보유 종목 가중 평균입니다.`);
  } else {
    drivers.push("기술 점수 데이터가 아직 부족해 배분 점수 비중이 더 크게 반영됐습니다.");
  }

  if (reportCoverageScore != null) {
    drivers.push(`리포트 커버리지 ${reportCoverageScore}점: 최근 리포트와 직접 연결된 보유 종목 비중입니다.`);
  }

  if (cashPct > targetCashPct + 0.05) {
    drivers.push(
      `현금 비중이 목표보다 ${formatPctPoint((cashPct - targetCashPct) * 100)}p 높아 점수가 눌리고 있습니다.`,
    );
  }

  const biggestGap = categories
    .filter((category) => category.category !== "현금파킹")
    .sort((left, right) => Math.abs(right.gapPct) - Math.abs(left.gapPct))[0];

  if (biggestGap && biggestGap.gapPct > 0.03) {
    drivers.push(
      `${biggestGap.category} 비중이 목표보다 ${formatPctPoint(biggestGap.gapPct * 100)}p 부족합니다.`,
    );
  }

  return drivers.slice(0, 5);
}

function buildImprovementActions(
  account: PortfolioAccount,
  categories: CategoryGuide[],
  technicalScore: number | null,
  cashPct: number,
  targetCashPct: number,
) {
  const actions: string[] = [];

  const shortfalls = categories
    .filter((category) => category.category !== "현금파킹" && category.gapPct > 0.03)
    .sort((left, right) => right.gapAmount - left.gapAmount)
    .slice(0, 3);

  for (const category of shortfalls) {
    actions.push(
      `${category.category}을 ${Math.max(category.gapAmount, 0).toLocaleString()}원 보강하면 배분 점수가 개선됩니다.`,
    );
  }

  if (cashPct > targetCashPct + 0.05) {
    actions.push(
      `현금을 ${formatPctPoint((cashPct - targetCashPct) * 100)}p 줄이고 목표 자산군으로 옮기면 총점이 올라갑니다.`,
    );
  }

  if (technicalScore != null && technicalScore < 50) {
    actions.push("기술 점수가 약한 종목은 추가 매수보다 보유 점검 또는 교체 검토가 유리합니다.");
  }

  if (account.incomplete) {
    actions.push("누락된 보유 종목을 먼저 입력하면 기술·배분 점수가 정확해집니다.");
  }

  return actions.slice(0, 5);
}

function formatPctPoint(value: number) {
  const rounded = Number.parseFloat(value.toFixed(1));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function buildPortfolioGuide(snapshot: PortfolioSnapshot): PortfolioGuide | null {
  const strategy = readStrategy();
  if (!strategy?.accounts) {
    return null;
  }

  const technical = readLatestTechnical(snapshot.date);
  const technicalMap = technical?.scores ?? null;
  const stage3 = readStage3Analysis(snapshot.date);

  const nextTranchePct = getNextTranchePct(strategy);

  const accounts = snapshot.accounts
    .map((account): AccountGuide | null => {
      const strategyKey = normalizeStrategyAccountKey(account);
      if (!strategyKey) return null;

      const targetAllocation =
        strategy.accounts?.[strategyKey]?.target_allocation ?? {};
      const { totalAssets, holdingsValue, cashValue, categories } = categorizeAccount(
        account,
        targetAllocation,
      );
      const fallbackAllocationScore = getAccountScore(categories, false);
      const { technicalScore: fallbackTechnicalScore, topSignals } = getTechnicalScoreForAccount(account, technicalMap);
      const stage3Account = stage3?.accounts?.[account.key] ?? null;
      const allocationScore = stage3Account?.allocationScore ?? fallbackAllocationScore;
      const technicalScore = stage3Account?.holdingsScore ?? fallbackTechnicalScore;
      const reportCoverageScore = stage3Account?.reportCoverageScore ?? null;
      const score =
        stage3Account?.totalScore ??
        mergeScores(allocationScore, technicalScore, account.incomplete);
      const targetCashPct = targetAllocation["현금파킹"] ?? 0;
      const cashPct = totalAssets > 0 ? cashValue / totalAssets : 0;
      const topShortfalls = categories
        .filter((category) => category.gapAmount > totalAssets * 0.03)
        .sort((left, right) => right.gapAmount - left.gapAmount)
        .slice(0, 3);
      const deployCeiling = Math.max(
        Math.min(cashValue, totalAssets * nextTranchePct),
        0,
      );
      const recommendedDeploy =
        cashPct > targetCashPct + 0.05
          ? Math.round(
              Math.min(
                deployCeiling,
                topShortfalls
                  .filter((category) => category.category !== "현금파킹")
                  .reduce((sum, category) => sum + Math.max(category.gapAmount, 0), 0),
              ),
            )
          : 0;
      const reserveCash = Math.max(cashValue - recommendedDeploy, 0);
      const candidates = topShortfalls
        .filter((category) => category.category !== "현금파킹")
        .map((category) => category.preferredLabel ?? category.category)
        .slice(0, 3);

      return {
        key: account.key,
        label: account.label,
        score,
        allocationScore,
        technicalScore,
        status: getStatusFromScore(score),
        totalAssets,
        holdingsValue,
        holdingsProfitLoss: getAccountHoldingsProfitLoss(account),
        holdingsProfitRate: getAccountHoldingsProfitRate(account),
        cashValue,
        cashPct,
        targetCashPct,
        recommendedDeploy,
        reserveCash,
        note: buildAccountNote(
          account,
          score,
          technicalScore,
          recommendedDeploy,
          topShortfalls,
          cashPct,
          targetCashPct,
        ),
        candidates,
        categories: categories.sort((left, right) => right.targetPct - left.targetPct),
        topSignals,
        reportCoverageScore,
        stage2Bias: stage3Account?.stage2Bias ?? null,
        scoreDrivers: buildScoreDrivers(
          account,
          allocationScore,
          technicalScore,
          reportCoverageScore,
          cashPct,
          targetCashPct,
          categories,
        ),
        improvementActions: buildImprovementActions(
          account,
          categories,
          technicalScore,
          cashPct,
          targetCashPct,
        ),
      };
    })
    .filter((account): account is AccountGuide => account !== null);

  const totalAssets = accounts.reduce((sum, account) => sum + account.totalAssets, 0);
  const totalCash = accounts.reduce((sum, account) => sum + account.cashValue, 0);
  const weightedScore =
    totalAssets > 0
      ? accounts.reduce((sum, account) => sum + account.score * account.totalAssets, 0) / totalAssets
      : 0;
  const globalActions = accounts
    .flatMap((account) =>
      account.categories
        .filter((category) => category.action === "보강 필요" && category.category !== "현금파킹")
        .sort((left, right) => right.gapAmount - left.gapAmount)
        .slice(0, 1)
        .map(
          (category) =>
            `${account.label}: ${category.category} ${Math.max(category.gapAmount, 0).toLocaleString()}원 보강`,
        ),
    )
    .slice(0, 4);
  const score = Math.round(weightedScore);

  return {
    score: stage3?.portfolio?.totalScore ?? score,
    totalAssets,
    totalCash,
    totalCashPct: totalAssets > 0 ? totalCash / totalAssets : 0,
    nextTranchePct,
    globalStatus: getStatusFromScore(stage3?.portfolio?.totalScore ?? score),
    globalActions,
    incompleteCount: snapshot.accounts.filter((account) => account.incomplete).length,
    accounts,
  };
}
