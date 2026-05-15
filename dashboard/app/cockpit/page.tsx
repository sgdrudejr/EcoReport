export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  CircleDashed,
  Eye,
  FileText,
  Gauge,
  Layers3,
  SearchCheck,
  ShieldCheck,
  TrendingUp,
  WalletCards,
  XCircle,
} from "lucide-react";

import {
  listRepoFiles,
  readRepoJsonFile,
} from "@/lib/repo-artifacts";

type Tone = "green" | "blue" | "amber" | "red" | "gray" | "slate";
type CockpitTab = "overview" | "rotation" | "watchlist" | "holdings" | "layers" | "evidence" | "artifacts";

type SourceSupport = {
  reports?: number;
  stockeasy?: number;
  marketvoice?: number;
  technical?: number;
  kisEtf?: number;
  news?: number;
  macro?: number;
  llm?: number;
};

type FundamentalView = {
  type?: string;
  basis?: string;
  score?: {
    overall?: number;
    label?: string;
    confidence?: number;
    valuation?: number | null;
    quality?: number | null;
    growth?: number | null;
    flow?: number | null;
    composition?: number | null;
  };
  metrics?: {
    per?: number | null;
    estimatedPer?: number | null;
    pbr?: number | null;
    roe?: number | null;
    roeEstimate?: number | null;
    eps?: number | null;
    annualEps?: number | null;
    epsGrowthPct?: number | null;
    estimatedEpsGrowthPct?: number | null;
    operatingMargin?: number | null;
    operatingMarginEstimate?: number | null;
    dividendYield?: number | null;
  } | null;
  market?: {
    price?: number | null;
    changePct?: number | null;
    volume?: number | null;
    marketCap?: number | null;
    nav?: number | null;
    navGapPct?: number | null;
    rank?: number | null;
  } | null;
  etf?: {
    ranking?: {
      rank?: number | null;
      changePct?: number | null;
      volume?: number | null;
      nav?: number | null;
      navGapPct?: number | null;
      navChangePct?: number | null;
    };
    sectors?: string[];
    keywords?: string[];
    topHoldingWeightPct?: number | null;
    concentrationTop5Pct?: number | null;
    holdings?: Array<{
      code?: string;
      name?: string;
      weightPct?: number | null;
      changePct?: number | null;
    }>;
  } | null;
  dataNeeds?: string[];
  errors?: string[];
};

type HealthCheck = {
  key?: string;
  label?: string;
  status?: "ok" | "warn" | "error" | string;
  detail?: string;
  path?: string | null;
};

type ActionItem = {
  id: string;
  accountKey?: string;
  accountLabel?: string;
  code?: string;
  name?: string;
  category?: string | null;
  label?: string;
  bucket?: string | null;
  tone?: Tone;
  score?: number;
  suggestedAmount?: number | null;
  reason?: string;
};

type EvidenceItem = {
  id: string;
  kind: "theme" | "security";
  code?: string | null;
  name?: string;
  theme?: string | null;
  label?: string;
  netScore?: number;
  sourceCount?: number;
  newSourceSupport?: number;
  existingSourceSupport?: number;
  support?: SourceSupport;
  supportSummary?: string;
  actionHint?: string;
  displayGroup?: string;
};

type HoldingCardView = {
  id: string;
  accountKey?: string;
  accountLabel?: string;
  code?: string;
  name?: string;
  category?: string | null;
  decision?: {
    bucket?: string | null;
    label?: string;
    tone?: Tone;
    priority?: number;
  };
  position?: {
    marketValue?: number;
    weight?: number;
    quantity?: number | null;
    profitLoss?: number;
    profitRate?: number;
  };
  scores?: {
    action?: number;
    consensus?: number;
    technical?: number;
    report?: number;
    factor?: number;
  };
  attractiveness?: {
    overall?: number;
    label?: string;
    tone?: Tone;
    components?: {
      quant?: number;
      technical?: number;
      technicalRaw?: number;
      fundamental?: number;
      evidence?: number;
      consensus?: number;
      riskPenalty?: number;
    };
    dataQuality?: {
      fundamentalBasis?: string;
      gaps?: string[];
    };
    drivers?: string[];
  };
  fundamental?: FundamentalView;
  sourceSupport?: SourceSupport;
  badges?: {
    reportCoverage?: string;
    externalCoverage?: string;
    technicalBias?: string | null;
    newEvidenceLabel?: string | null;
  };
  thesis?: string;
  addConditions?: string[];
  trimConditions?: string[];
  invalidationConditions?: string[];
  riskFlags?: string[];
  nextReview?: string | null;
};

type ThemeSignalView = {
  id: string;
  theme?: string;
  label?: string;
  netScore?: number;
  sourceCount?: number;
  support?: SourceSupport;
  supportSummary?: string;
  actionHint?: string;
};

type ConflictItem = {
  id: string;
  entityType?: string | null;
  entityId?: string | null;
  directions?: string[];
  sources?: string[];
  sourceSummary?: string;
  severity?: string;
};

type ActionBriefItem = {
  id?: string;
  lane?: "do" | "wait" | "avoid" | string;
  action?: string;
  tone?: Tone | string;
  urgency?: number;
  code?: string;
  name?: string;
  accountLabel?: string;
  category?: string | null;
  decisionLabel?: string;
  score?: number;
  attractiveness?: number;
  instruction?: string;
  because?: string;
  trigger?: string;
  avoid?: string;
};

type LayerImplication = {
  layer?: string;
  verdict?: string;
  soWhat?: string;
  action?: string;
};

type SellBriefItem = {
  id?: string;
  lane?: "sell" | "trim" | "stop" | "watch" | "hold" | string;
  action?: string;
  tone?: Tone | string;
  priority?: number;
  code?: string;
  name?: string;
  accountLabel?: string;
  category?: string | null;
  decisionLabel?: string;
  profitRate?: number | null;
  marketValue?: number | null;
  attractiveness?: number | null;
  size?: string;
  decision?: string;
  trigger?: string;
  reason?: string;
};

type QwenSellCoachItem = {
  code?: string | null;
  name?: string | null;
  accountLabel?: string | null;
  action?: string;
  confidence?: number;
  reason?: string;
  trigger?: string;
  webCheck?: string | null;
  sourceUrls?: string[];
};

type QwenBuyCoachItem = {
  code?: string | null;
  name?: string | null;
  action?: string;
  confidence?: number;
  reason?: string;
  trigger?: string;
};

type QwenResearchItem = {
  question?: string;
  why?: string;
  priority?: string;
};

type AccountStrategyTodoItem = {
  priority?: string;
  action?: string;
  accountLabel?: string | null;
  name?: string | null;
  reason?: string;
  condition?: string;
  doNot?: string;
};

type AccountStrategyWatchItem = {
  accountLabel?: string | null;
  name?: string | null;
  action?: string;
  reason?: string;
  trigger?: string;
};

type AccountStrategySectorItem = {
  sector?: string | null;
  view?: string | null;
  action?: string;
  reason?: string;
};

type StockPulseItem = {
  id?: string;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  type?: string | null;
  verdict?: string;
  urgency?: string;
  pulseScore?: number | null;
  oneLine?: string;
  doNow?: string;
  doNot?: string;
  nextCheck?: string;
  accounts?: Array<{
    accountKey?: string | null;
    accountLabel?: string | null;
    marketValue?: number | null;
    profitRate?: number | null;
    decision?: string | null;
  }>;
  position?: {
    marketValue?: number | null;
    profitLoss?: number | null;
    profitRate?: number | null;
  };
  market?: {
    price?: number | null;
    changePct?: number | null;
    volume?: number | null;
    volumeRatio?: number | null;
    navGapPct?: number | null;
    rank?: number | null;
  };
  technical?: {
    score?: number | null;
    signal?: string | null;
    reason?: string;
    rsi?: number | null;
    ma20?: number | null;
    ma60?: number | null;
    recentHighDistancePct?: number | null;
    rsVsBenchmark?: number | null;
    alerts?: string[];
  };
  fundamental?: {
    score?: number | null;
    label?: string | null;
    metrics?: FundamentalView["metrics"];
    etf?: {
      rank?: number | null;
      navGapPct?: number | null;
      concentrationTop5Pct?: number | null;
      topHoldings?: Array<{
        code?: string | null;
        name?: string | null;
        weightPct?: number | null;
        changePct?: number | null;
      }>;
    } | null;
  };
  alerts?: Array<{
    severity?: string;
    label?: string;
    detail?: string;
    tone?: Tone | string;
  }>;
  quickFactors?: string[];
  newsHits?: Array<{
    title?: string;
    direction?: string;
    confidence?: number | null;
    url?: string | null;
  }>;
  strategyMentions?: Array<{
    action?: string;
    reason?: string;
    trigger?: string;
  }>;
  missingSources?: string[];
  riskFlags?: string[];
};

type MarketLayer = {
  date?: string | null;
  collectedAt?: string | null;
  regime?: string | null;
  portfolioScore?: number | null;
  indices?: Array<{
    key?: string;
    name?: string;
    close?: number | null;
    changePct?: number | null;
    source?: string | null;
    tradedAt?: string | null;
  }>;
  macro?: Array<{
    key?: string;
    name?: string;
    close?: number | null;
    changePct?: number | null;
    source?: string | null;
    tradedAt?: string | null;
  }>;
};

type SectorLayerItem = {
  id?: string;
  category?: string;
  holdingCount?: number;
  stockCount?: number;
  etfCount?: number;
  marketValue?: number;
  averageAttractiveness?: number;
  topSecurities?: Array<{
    code?: string;
    name?: string;
    score?: number;
    held?: boolean;
  }>;
};

type SecurityLayerItem = {
  code?: string;
  name?: string;
  category?: string | null;
  held?: boolean;
  accounts?: string[];
  decisionLabel?: string | null;
  attractiveness?: number | null;
  score?: FundamentalView["score"] | null;
  market?: FundamentalView["market"];
  metrics?: FundamentalView["metrics"];
  etf?: {
    ranking?: {
      rank?: number | null;
      changePct?: number | null;
      volume?: number | null;
      nav?: number | null;
      navGapPct?: number | null;
      navChangePct?: number | null;
    };
    sectors?: string[];
    keywords?: string[];
    holdings?: Array<{
      code?: string;
      name?: string;
      weightPct?: number | null;
      changePct?: number | null;
    }>;
    topHoldingWeightPct?: number | null;
    concentrationTop5Pct?: number | null;
  } | null;
  dataNeeds?: string[];
};

type StockeasyEtfMatch = {
  code?: string;
  name?: string;
  category?: string | null;
  held?: boolean;
  score?: number | null;
  flowScore?: number | null;
  matchScore?: number;
  changePct?: number | null;
  rank?: number | null;
  navGapPct?: number | null;
  volume?: number | null;
  dataNeeds?: string[];
  reasons?: string[];
  topHoldings?: Array<{
    code?: string;
    name?: string;
    weightPct?: number | null;
    changePct?: number | null;
  }>;
};

type StockeasyStockMatch = {
  code?: string | null;
  name?: string;
  category?: string | null;
  held?: boolean;
  stockeasyScore?: number | null;
  score?: number | null;
  label?: string | null;
  matchScore?: number;
  changePct?: number | null;
  volume?: number | null;
  metrics?: {
    per?: number | null;
    pbr?: number | null;
    roe?: number | null;
    epsGrowthPct?: number | null;
    operatingMargin?: number | null;
  } | null;
  dataNeeds?: string[];
  reasons?: string[];
};

type StockeasyTrend = {
  direction?: string;
  label?: string;
  tone?: Tone | string;
  points?: number;
  previousDate?: string | null;
  scoreDelta?: number | null;
  signalDelta?: number | null;
  changeDelta?: number | null;
  rsDelta?: number | null;
  rankDelta?: number | null;
  spanScoreDelta?: number | null;
  recent?: Array<{
    date?: string;
    score?: number | null;
    signal?: number | null;
    changePct?: number | null;
    rsScore?: number | null;
    rank?: number | null;
  }>;
};

type StockeasySectorPulseItem = {
  id?: string;
  sector?: string;
  score?: number;
  rank?: number | null;
  rsScore?: number | null;
  rsSector?: string | null;
  signal?: number | null;
  changePct?: number | null;
  gapPct?: number | null;
  holdDays?: number | null;
  position?: string | null;
  label?: string;
  action?: string;
  tone?: Tone | string;
  trend?: StockeasyTrend;
  leaders?: Array<{
    name?: string;
    score?: number | null;
  }>;
  aliases?: string[];
  sourceRows?: number;
  matchedStocks?: StockeasyStockMatch[];
  matchedEtfs?: StockeasyEtfMatch[];
  implication?: string;
  buyQuestion?: string;
};

type StockeasyPulse = {
  source?: string;
  capturedAt?: string | null;
  sourceTradingDate?: string | null;
  updatedAtLabel?: string | null;
  marketSignal?: {
    short?: string | null;
    long?: string | null;
    kospi?: {
      statusLabel?: string;
      recommendedExposure?: string;
      distributionDays?: number;
    } | null;
    kosdaq?: {
      statusLabel?: string;
      recommendedExposure?: string;
      distributionDays?: number;
    } | null;
  };
  sectors?: StockeasySectorPulseItem[];
  etfRadar?: StockeasySectorPulseItem[];
  counts?: {
    sectorRows?: number;
    sectorCount?: number;
    rsRows?: number;
    etfCandidates?: number;
    etfGaps?: number;
    historyDays?: number;
  };
};

type RotationWatchItem = {
  theme?: string | null;
  sector?: string | null;
  subTheme?: string | null;
  layer?: string | null;
  definition?: string;
  status?: string;
  tone?: Tone | string;
  action?: string;
  currentDirection?: string | null;
  recentScore?: number | null;
  previousScore?: number | null;
  momentum?: number | null;
  mentions?: number | null;
  firstDate?: string | null;
  lastDate?: string | null;
  sources?: string[];
  accounts?: string[];
  rawThemes?: string[];
  reason?: string;
};

type RotationSectorItem = {
  sector?: string | null;
  status?: string;
  tone?: Tone | string;
  action?: string;
  recentScore?: number | null;
  previousScore?: number | null;
  momentum?: number | null;
  mentions?: number | null;
  firstDate?: string | null;
  lastDate?: string | null;
  themes?: Array<{
    theme?: string | null;
    subTheme?: string | null;
    status?: string | null;
    action?: string | null;
    momentum?: number | null;
    reason?: string;
  }>;
  note?: string;
};

type RotationSectorDeliberation = {
  sector?: string | null;
  verdict?: string;
  tone?: Tone | string;
  confidence?: number | null;
  question?: string;
  finalAnswer?: string;
  bullScore?: number | null;
  bearScore?: number | null;
  rotation?: {
    status?: string | null;
    action?: string | null;
    recentScore?: number | null;
    momentum?: number | null;
    note?: string;
  };
  stockeasy?: {
    available?: boolean;
    label?: string | null;
    detail?: string;
    latest?: {
      date?: string | null;
      sourceTradingDate?: string | null;
      sector?: string | null;
      changePct?: number | null;
      signal?: number | null;
      rsScore?: number | null;
      leaders?: Array<{ name?: string; score?: number | null }>;
    } | null;
  };
  sourceConsensus?: {
    available?: boolean;
    label?: string | null;
    detail?: string;
    netScore?: number | null;
    sourceCount?: number | null;
    supportSummary?: string;
    confidence?: number | null;
    conflictCount?: number | null;
    missingSources?: string[];
    topItems?: Array<{
      name?: string | null;
      type?: string | null;
      netScore?: number | null;
      supportSummary?: string;
      label?: string | null;
    }>;
    evidence?: string[];
  } | null;
  transitionTrigger?: {
    label?: string | null;
    tone?: Tone | string;
    summary?: string;
    entryChecklist?: string[];
    exitChecklist?: string[];
  } | null;
  chartTriggers?: {
    available?: boolean;
    label?: string | null;
    detail?: string;
    entryTriggers?: string[];
    exitTriggers?: string[];
    watchTriggers?: string[];
    items?: Array<{
      code?: string | null;
      name?: string | null;
      score?: number | null;
      rsi?: number | null;
      entry?: string[];
      exit?: string[];
    }>;
  } | null;
  newsTriggers?: {
    available?: boolean;
    label?: string | null;
    detail?: string;
    positive?: number | null;
    negative?: number | null;
    headlines?: Array<{
      title?: string;
      direction?: string;
      source?: string | null;
      publishedAt?: string | null;
      url?: string | null;
    }>;
  } | null;
  technical?: {
    available?: boolean;
    label?: string | null;
    avgScore?: number | null;
    avgRsi?: number | null;
    avgProfit?: number | null;
    overheatCount?: number | null;
    detail?: string;
    items?: Array<{
      code?: string | null;
      name?: string | null;
      category?: string | null;
      verdict?: string | null;
      score?: number | null;
      rsi?: number | null;
      profitRate?: number | null;
      reason?: string;
    }>;
  };
  exposure?: {
    weightPct?: number | null;
    holdingCount?: number | null;
    categories?: string[];
    risk?: string | null;
  } | null;
  themes?: Array<{
    theme?: string | null;
    subTheme?: string | null;
    status?: string | null;
    momentum?: number | null;
    action?: string | null;
  }>;
  bullCase?: string[];
  bearCase?: string[];
  nextChecks?: string[];
};

type RotationWatch = {
  status?: string;
  generatedAt?: string | null;
  lookbackDays?: number | null;
  includedDates?: string[];
  summary?: {
    headline?: string;
    mode?: string | null;
    stance?: string | null;
    latestMacroSummary?: string;
    nextAction?: string;
  };
  marketTrend?: {
    mode?: string | null;
    currentRegime?: string | null;
    previousRegime?: string | null;
    regimeChanged?: boolean;
    confidence?: number | null;
    portfolioScore?: number | null;
    scoreDelta?: number | null;
    currentRsi?: number | null;
    marketScore?: number | null;
    overheatDays?: number | null;
    observedDays?: number | null;
    alerts?: string[];
    riskTriggers?: string[];
  };
  rotationTargets?: {
    summary?: {
      answer?: string;
      currentAction?: string;
      switchRule?: string;
    };
    watch?: Array<{
      sector?: string | null;
      priority?: string | null;
      action?: string | null;
      verdict?: string | null;
      tone?: Tone | string;
      score?: number | null;
      confidence?: number | null;
      whyWatch?: string;
      switchWhen?: string;
      invalidation?: string;
      evidence?: string[];
      sourceConsensus?: {
        label?: string | null;
        detail?: string;
        sourceCount?: number | null;
        supportSummary?: string;
        netScore?: number | null;
      } | null;
      transitionTrigger?: {
        label?: string | null;
        tone?: Tone | string;
        summary?: string;
        entryChecklist?: string[];
        exitChecklist?: string[];
        chart?: {
          label?: string | null;
          detail?: string;
          entryTriggers?: string[];
          exitTriggers?: string[];
        } | null;
        news?: {
          label?: string | null;
          detail?: string;
          headlines?: Array<{ title?: string; direction?: string }>;
        } | null;
      } | null;
      representative?: Array<{
        code?: string | null;
        name?: string | null;
        verdict?: string | null;
        rsi?: number | null;
        score?: number | null;
        profitRate?: number | null;
      }>;
    }>;
    excluded?: Array<{
      sector?: string | null;
      verdict?: string | null;
      action?: string | null;
      invalidation?: string;
    }>;
  };
  transitionTriggerBoard?: {
    summary?: string;
    rows?: Array<{
      sector?: string | null;
      label?: string | null;
      tone?: Tone | string;
      verdict?: string | null;
      action?: string | null;
      summary?: string;
      entryChecklist?: string[];
      exitChecklist?: string[];
      chart?: {
        label?: string | null;
        detail?: string;
        entryTriggers?: string[];
        exitTriggers?: string[];
      } | null;
      news?: {
        label?: string | null;
        detail?: string;
        headlines?: Array<{ title?: string; direction?: string }>;
      } | null;
    }>;
  };
  sectorRotation?: RotationSectorItem[];
  sectorDeliberations?: RotationSectorDeliberation[];
  stockeasySectorUniverse?: Array<{
    sector?: string | null;
    signal?: number | null;
    changePct?: number | null;
    holdDays?: number | null;
    gapPct?: number | null;
    rsScore?: number | null;
    rsRank?: number | null;
    leaders?: Array<{ name?: string; score?: number | null }>;
    sourcePanels?: string[];
  }>;
  themeRotation?: RotationWatchItem[];
  portfolioImplications?: {
    stance?: string | null;
    crowdedExposures?: Array<{
      category?: string | null;
      marketValue?: number | null;
      weightPct?: number | null;
      holdingCount?: number | null;
      risk?: string | null;
      names?: string[];
    }>;
    reduceFirst?: Array<{
      code?: string | null;
      name?: string | null;
      category?: string | null;
      verdict?: string;
      urgency?: string;
      profitRate?: number | null;
      rsi?: number | null;
      trigger?: string;
      doNot?: string;
    }>;
    emergingSectors?: RotationSectorItem[];
    emergingThemes?: RotationWatchItem[];
    weakeningThemes?: RotationWatchItem[];
    roleGaps?: Array<{
      accountKey?: string | null;
      accountLabel?: string | null;
      gapCategory?: string | null;
      gapAmount?: number | null;
      candidate?: string | null;
      noAction?: boolean;
      reason?: string;
    }>;
    rules?: string[];
  };
  conceptGuide?: Array<{
    term?: string | null;
    layer?: string | null;
    meaning?: string;
    examples?: string[];
  }>;
  scenarioPlaybook?: Array<{
    scenario?: string;
    trigger?: string;
    action?: string;
    firstMoves?: string[];
  }>;
  weeklyChecklist?: string[];
  dataNeeds?: string[];
  artifacts?: Record<string, string>;
};

type SearchParams = Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>;

type DashboardView = {
  meta?: {
    date?: string;
    runDate?: string;
    effectiveMarketDate?: string;
    runId?: string | null;
    generatedAt?: string;
    version?: string;
  };
  health?: {
    overallStatus?: "ok" | "warn" | "error" | string;
    checks?: HealthCheck[];
    warnings?: HealthCheck[];
    blockers?: HealthCheck[];
    counts?: Record<string, number>;
  };
  sourceCoverage?: {
    reports?: number;
    stockeasy?: number;
    marketvoice?: number;
    technical?: number;
    kisEtf?: number;
    news?: number;
    fundamentals?: number;
    activeSources?: string[];
  };
  portfolio?: {
    score?: number;
    regime?: string | null;
    attractiveness?: {
      average?: number;
      highCount?: number;
      conditionalCount?: number;
      cautionCount?: number;
    };
    accounts?: Array<{
      accountKey?: string;
      accountLabel?: string;
      totalValue?: number;
      cash?: number;
      holdingCount?: number;
      stage4Score?: number;
      deployBudget?: number;
      noAction?: boolean;
      noActionReason?: string;
      topThemes?: string[];
      topRisks?: string[];
    }>;
  };
  actionBoard?: {
    immediateBuys?: ActionItem[];
    conditionalBuys?: ActionItem[];
    blockedBuys?: ActionItem[];
    trimOrProtect?: ActionItem[];
    watch?: ActionItem[];
    holds?: ActionItem[];
  };
  newEvidence?: {
    reinforcedThemes?: EvidenceItem[];
    reinforcedSecurities?: EvidenceItem[];
    newWatchCandidates?: EvidenceItem[];
    conflicts?: ConflictItem[];
  };
  decisionBrief?: {
    stance?: string;
    headline?: string;
    counts?: {
      do?: number;
      wait?: number;
      avoid?: number;
      buy?: number;
      protect?: number;
    };
    lanes?: {
      do?: ActionBriefItem[];
      wait?: ActionBriefItem[];
      avoid?: ActionBriefItem[];
    };
    actionQueue?: ActionBriefItem[];
    layerImplications?: LayerImplication[];
  };
  sellBrief?: {
    headline?: string;
    counts?: {
      sellNow?: number;
      trim?: number;
      stop?: number;
      watch?: number;
      hold?: number;
    };
    lanes?: {
      sellNow?: SellBriefItem[];
      trim?: SellBriefItem[];
      stop?: SellBriefItem[];
      watch?: SellBriefItem[];
      hold?: SellBriefItem[];
    };
    queue?: SellBriefItem[];
  };
  qwenCoach?: {
    status?: string;
    headline?: string;
    provider?: string;
    model?: string | null;
    requestedModel?: string | null;
    webSearch?: boolean;
    searchStrategy?: string | null;
    forcedSearch?: boolean;
    generatedAt?: string | null;
    sellCoach?: QwenSellCoachItem[];
    buyCoach?: QwenBuyCoachItem[];
    riskWarnings?: string[];
    researchBacklog?: QwenResearchItem[];
    searchedQueries?: string[];
    error?: string | null;
  } | null;
  accountStrategy?: {
    status?: string;
    headline?: string;
    stance?: string;
    provider?: string;
    model?: string | null;
    requestedModel?: string | null;
    webSearch?: boolean;
    searchStrategy?: string | null;
    forcedSearch?: boolean;
    generatedAt?: string | null;
    confidence?: number | null;
    artifact?: string | null;
    todayDo?: AccountStrategyTodoItem[];
    todayDoNot?: string[];
    sellWatch?: AccountStrategyWatchItem[];
    buyWatch?: AccountStrategyWatchItem[];
    sectorView?: AccountStrategySectorItem[];
    weeklyChecklist?: string[];
    missingData?: string[];
    riskWarnings?: string[];
    validationWarnings?: string[];
    error?: string | null;
  } | null;
  stockPulse?: {
    status?: string;
    generatedAt?: string | null;
    sourceStatus?: Record<string, string>;
    counts?: {
      activeHoldings?: number;
      highUrgency?: number;
      mediumUrgency?: number;
      missingNews?: number;
      missingDart?: number;
    };
    summary?: {
      headline?: string;
      nextAction?: string;
    };
    items?: StockPulseItem[];
    artifacts?: {
      stockPulse?: string;
      perSecurityDir?: string;
    };
  } | null;
  rotationWatch?: RotationWatch | null;
  stockeasyPulse?: StockeasyPulse | null;
  analysisLayers?: {
    market?: MarketLayer;
    themes?: ThemeSignalView[];
    sectors?: SectorLayerItem[];
    etfs?: SecurityLayerItem[];
    stocks?: SecurityLayerItem[];
  };
  holdings?: HoldingCardView[];
  attractivenessRanking?: Array<{
    id: string;
    accountKey?: string;
    accountLabel?: string;
    code?: string;
    name?: string;
    category?: string | null;
    decisionLabel?: string;
    attractiveness?: HoldingCardView["attractiveness"];
    riskFlags?: string[];
  }>;
  themes?: ThemeSignalView[];
  conflicts?: ConflictItem[];
  artifacts?: {
    dashboardView?: string;
    finalHtml?: string;
    executionPlanTable?: string;
    sourceSupplement?: string;
    qwenCoach?: string;
    accountStrategy?: string;
    stockPulse?: string;
    rotationWatch?: string;
    stockeasySnapshot?: string;
  };
};

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR");

function loadDashboardView(): DashboardView | null {
  const latest = readRepoJsonFile<DashboardView>("data/dashboard/latest-dashboard-view.json");
  if (latest) return latest;

  const candidate = listRepoFiles("data/dashboard")
    .filter((file) => /^\d{4}-\d{2}-\d{2}-dashboard-view\.json$/.test(file))
    .sort()
    .reverse()[0];

  if (!candidate) return null;
  return readRepoJsonFile<DashboardView>(`data/dashboard/${candidate}`);
}

function formatCount(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return NUMBER_FORMATTER.format(Math.round(value));
}

function formatWon(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(0)}만`;
  return formatCount(value);
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatPlainPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

function formatMultiple(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}x`;
}

function formatWeight(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function securityScore(item: SecurityLayerItem) {
  return Number(item.score?.overall ?? item.attractiveness ?? 0);
}

function uniqueByCode(items: SecurityLayerItem[]) {
  const byCode = new Map<string, SecurityLayerItem>();
  for (const item of items) {
    const code = item.code ?? item.name ?? "";
    if (!code) continue;
    const existing = byCode.get(code);
    if (!existing || securityScore(item) > securityScore(existing)) byCode.set(code, item);
  }
  return [...byCode.values()];
}

function candidateAction(item: SecurityLayerItem) {
  if ((item.dataNeeds ?? []).length > 0) return "자료보강";
  if (Number(item.market?.changePct ?? 0) >= 8) return "눌림대기";
  if (securityScore(item) >= 75) return "우선관찰";
  if (securityScore(item) >= 65) return "조건검토";
  return "관찰유지";
}

function candidateTone(item: SecurityLayerItem) {
  const action = candidateAction(item);
  if (action === "우선관찰") return "green";
  if (action === "조건검토") return "blue";
  if (action === "눌림대기" || action === "자료보강") return "amber";
  return "slate";
}

function buyTrigger(item: SecurityLayerItem) {
  if ((item.dataNeeds ?? []).length > 0) return `${shortNeedLabel(item.dataNeeds?.[0] ?? "자료필요")} 후 재평가`;
  if (Number(item.market?.changePct ?? 0) >= 8) return "급등 진정 후 거래대금 유지";
  if (item.etf) return "NAV 괴리 안정 + 구성 상위종목 확인";
  if (item.metrics?.estimatedEpsGrowthPct && item.metrics.estimatedEpsGrowthPct > 40) return "실적 성장 유지 + 과열 없는 눌림";
  if (item.metrics?.roe && item.metrics.roe > 20) return "ROE 유지 + 밸류에이션 부담 완화";
  return "리포트/기술/수급 중 2개 이상 동시 확인";
}

function sectorSignal(sector: SectorLayerItem) {
  const unheld = (sector.topSecurities ?? []).filter((item) => !item.held);
  const top = unheld[0];
  if (!top) return "후보없음";
  if (Number(top.score ?? 0) >= 75) return "강한후보";
  if (Number(top.score ?? 0) >= 65) return "조건후보";
  return "관찰후보";
}

function shortNeedLabel(value: string) {
  const labels: Record<string, string> = {
    ETF_NAV_MISSING: "NAV필요",
    ETF_VOLUME_MISSING: "거래필요",
    ETF_COMPOSITION_MISSING: "구성필요",
    NAVER_FETCH_FAILED: "수집실패",
    NAVER_CODE_UNSUPPORTED: "코드확인",
    SECURITY_TYPE_UNKNOWN: "분류필요",
    STOCK_PER_MISSING: "PER필요",
    STOCK_PBR_MISSING: "PBR필요",
    STOCK_ROE_MISSING: "ROE필요",
    STOCK_EPSGROWTHPCT_MISSING: "EPS필요",
    STOCK_OPERATINGMARGIN_MISSING: "마진필요",
    FUNDAMENTAL_SNAPSHOT_MISSING: "기본필요",
    FUNDAMENTAL_DETAIL_MISSING: "상세필요",
  };
  return labels[value] ?? value.replace(/^STOCK_|_MISSING$/g, "").slice(0, 7);
}

function toneClass(tone: Tone | string | undefined) {
  switch (tone) {
    case "green":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "blue":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "red":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "gray":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function labelTone(label: string | null | undefined) {
  if (label === "강화확인") return "green";
  if (label === "보완확인") return "blue";
  if (label === "신규관찰") return "amber";
  if (label === "충돌점검" || label === "감속점검" || label === "단독경계") return "red";
  if (label === "매력높음" || label === "매력있음") return "green";
  if (label === "조건매력") return "blue";
  if (label === "과열주의") return "amber";
  if (label === "주의필요") return "red";
  return "slate";
}

function qwenActionTone(action: string | null | undefined) {
  if (/전량|손절|금지|경고/.test(action ?? "")) return "red";
  if (/부분|익절|대기|관찰/.test(action ?? "")) return "amber";
  if (/분할|유지/.test(action ?? "")) return "green";
  return labelTone(action);
}

function strategyPriorityTone(priority: string | null | undefined) {
  if (/높|긴급|최우선/.test(priority ?? "")) return "red";
  if (/중|보통/.test(priority ?? "")) return "amber";
  if (/낮/.test(priority ?? "")) return "slate";
  return "blue";
}

function strategyStanceTone(stance: string | null | undefined) {
  if (/공격|확대|매수/.test(stance ?? "")) return "green";
  if (/방어|보호|축소/.test(stance ?? "")) return "amber";
  if (/위험|중단/.test(stance ?? "")) return "red";
  return "blue";
}

function stockPulseVerdictTone(verdict: string | null | undefined) {
  if (/손절|추격금지|금지/.test(verdict ?? "")) return "red";
  if (/익절|감량|보강/.test(verdict ?? "")) return "amber";
  if (/보유|유지/.test(verdict ?? "")) return "green";
  return "blue";
}

function urgencyTone(urgency: string | null | undefined) {
  if (urgency === "높음") return "red";
  if (urgency === "중간") return "amber";
  if (urgency === "낮음") return "slate";
  return "blue";
}

function statusTone(status: string | undefined) {
  if (status === "ok") return "green";
  if (status === "warn") return "amber";
  if (status === "error") return "red";
  return "slate";
}

const COCKPIT_TABS: Array<{ id: CockpitTab; label: string; shortLabel: string }> = [
  { id: "overview", label: "요약", shortLabel: "요약" },
  { id: "rotation", label: "로테이션", shortLabel: "전환" },
  { id: "watchlist", label: "관심후보", shortLabel: "후보" },
  { id: "holdings", label: "보유/매도", shortLabel: "보유" },
  { id: "layers", label: "5단분석", shortLabel: "분석" },
  { id: "evidence", label: "근거/리스크", shortLabel: "근거" },
  { id: "artifacts", label: "산출물", shortLabel: "파일" },
];

function normalizeTab(value: string | string[] | undefined): CockpitTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return COCKPIT_TABS.some((item) => item.id === tab) ? (tab as CockpitTab) : "overview";
}

function TabNav({ activeTab }: { activeTab: CockpitTab }) {
  return (
    <nav className="sticky top-3 z-20 rounded-[8px] border border-slate-200 bg-white/95 p-1 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="grid grid-cols-3 gap-1 md:grid-cols-7">
        {COCKPIT_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/cockpit?tab=${tab.id}`}
              className={`inline-flex min-h-10 items-center justify-center rounded-[7px] px-3 text-sm font-semibold transition ${
                active
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              <span className="md:hidden">{tab.shortLabel}</span>
              <span className="hidden md:inline">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function sourceEntries(support: SourceSupport | undefined) {
  return [
    ["리포트", support?.reports ?? 0],
    ["StockEasy", support?.stockeasy ?? 0],
    ["Market", support?.marketvoice ?? 0],
    ["기술", support?.technical ?? 0],
    ["KIS", support?.kisEtf ?? 0],
    ["뉴스", support?.news ?? 0],
  ] as const;
}

function SourceBars({ support }: { support?: SourceSupport }) {
  return (
    <div className="grid gap-2">
      {sourceEntries(support).map(([label, value]) => (
        <div key={label} className="grid grid-cols-[72px_1fr_38px] items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">{label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <span
              className="block h-full rounded-full bg-slate-800"
              style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
            />
          </span>
          <span className="text-right text-[11px] tabular-nums text-slate-500">
            {value > 0 ? value.toFixed(2) : "-"}
          </span>
        </div>
      ))}
    </div>
  );
}

function scoreTone(score: number | null | undefined) {
  if (typeof score !== "number" || Number.isNaN(score)) return "slate";
  if (score >= 75) return "green";
  if (score >= 62) return "blue";
  if (score >= 45) return "amber";
  return "red";
}

function ScoreBar({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const score = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-slate-700">{value ?? "-"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${
            scoreTone(score) === "green"
              ? "bg-emerald-500"
              : scoreTone(score) === "blue"
                ? "bg-sky-500"
                : scoreTone(score) === "amber"
                  ? "bg-amber-500"
                  : "bg-rose-500"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function Pill({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: Tone | string;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass(tone)}`}>
      {label}
    </span>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "slate",
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <span className={`rounded-full border p-1.5 ${toneClass(tone)}`}>
          <Icon size={15} />
        </span>
      </div>
      <p className="mt-3 text-[1.55rem] font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[13px] leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function ActionColumn({
  title,
  items,
  tone,
}: {
  title: string;
  items: ActionItem[];
  tone: Tone;
}) {
  return (
    <section className="min-h-[220px] rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
        <Pill label={`${items.length}건`} tone={tone} />
      </div>
      <div className="mt-4 grid gap-3">
        {items.slice(0, 5).map((item) => (
          <article key={item.id} className="rounded-[8px] border border-slate-100 bg-slate-50/80 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{item.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {item.accountLabel} · {item.code}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{item.score}</span>
            </div>
            {item.reason ? <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-slate-600">{item.reason}</p> : null}
          </article>
        ))}
        {items.length === 0 ? (
          <div className="flex h-[150px] items-center justify-center rounded-[8px] border border-dashed border-slate-200 text-sm text-slate-400">
            없음
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EvidenceCard({ item }: { item: EvidenceItem }) {
  const name = item.kind === "theme" ? item.theme : item.name;
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-slate-950">{name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {item.code ? `${item.code} · ` : ""}
            신규 {item.newSourceSupport?.toFixed(2)} / 기존 {item.existingSourceSupport?.toFixed(2)}
          </p>
        </div>
        <Pill label={item.label ?? "확인"} tone={labelTone(item.label)} />
      </div>
      <p className="mt-3 text-[13px] leading-6 text-slate-600">{item.supportSummary}</p>
      <div className="mt-4">
        <SourceBars support={item.support} />
      </div>
    </article>
  );
}

function AttractivenessRow({
  item,
}: {
  item: NonNullable<DashboardView["attractivenessRanking"]>[number];
}) {
  const attr = item.attractiveness;
  const components = attr?.components ?? {};
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-slate-950">{item.name}</p>
            <Pill label={attr?.label ?? "확인"} tone={attr?.tone ?? labelTone(attr?.label)} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {item.accountLabel} · {item.code} · {item.decisionLabel ?? "판정없음"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[1.35rem] font-semibold tracking-tight text-slate-950">{attr?.overall ?? "-"}</p>
          <p className="text-[11px] text-slate-500">매력도</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-3">
        <ScoreBar label="퀀트" value={components.quant} />
        <ScoreBar label="기술" value={components.technical} />
        <ScoreBar label="기본" value={components.fundamental} />
        <ScoreBar label="근거" value={components.evidence} />
        <ScoreBar label="합의" value={components.consensus} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(attr?.drivers ?? []).slice(0, 4).map((driver) => (
          <Pill key={driver} label={driver} tone="slate" />
        ))}
        {attr?.dataQuality?.fundamentalBasis ? (
          <Pill label={`기본 ${attr.dataQuality.fundamentalBasis}`} tone="gray" />
        ) : null}
      </div>
    </article>
  );
}

function HoldingCard({ holding }: { holding: HoldingCardView }) {
  const profitTone = Number(holding.position?.profitRate ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700";
  const attr = holding.attractiveness;
  const components = attr?.components ?? {};

  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-slate-950">{holding.name}</h3>
            {holding.badges?.newEvidenceLabel ? (
              <Pill label={holding.badges.newEvidenceLabel} tone={labelTone(holding.badges.newEvidenceLabel)} />
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {holding.accountLabel} · {holding.code} · {holding.category ?? "미분류"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Pill label={holding.decision?.label ?? "확인"} tone={holding.decision?.tone} />
          <p className="mt-2 text-[11px] font-semibold text-slate-500">
            매력 {attr?.overall ?? "-"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <div className="rounded-[8px] bg-slate-50 px-2 py-2">
          <p className="text-[11px] text-slate-500">점수</p>
          <p className="text-sm font-semibold text-slate-950">{holding.scores?.action ?? "-"}</p>
        </div>
        <div className="rounded-[8px] bg-slate-50 px-2 py-2">
          <p className="text-[11px] text-slate-500">비중</p>
          <p className="text-sm font-semibold text-slate-950">{formatWeight(holding.position?.weight)}</p>
        </div>
        <div className="rounded-[8px] bg-slate-50 px-2 py-2">
          <p className="text-[11px] text-slate-500">손익</p>
          <p className={`text-sm font-semibold ${profitTone}`}>{formatPercent(holding.position?.profitRate)}</p>
        </div>
        <div className="rounded-[8px] bg-slate-50 px-2 py-2">
          <p className="text-[11px] text-slate-500">평가</p>
          <p className="text-sm font-semibold text-slate-950">{formatWon(holding.position?.marketValue)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {attr?.label ? <Pill label={attr.label} tone={attr.tone ?? labelTone(attr.label)} /> : null}
        <Pill label={holding.badges?.reportCoverage ?? "근거없음"} />
        <Pill label={holding.badges?.externalCoverage ?? "리포트밖"} />
        {holding.badges?.technicalBias ? <Pill label={holding.badges.technicalBias} tone="amber" /> : null}
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2">
        <ScoreBar label="퀀트" value={components.quant} />
        <ScoreBar label="기술" value={components.technical} />
        <ScoreBar label="기본" value={components.fundamental} />
        <ScoreBar label="근거" value={components.evidence} />
        <ScoreBar label="합의" value={components.consensus} />
      </div>

      {holding.fundamental?.type === "stock" ? (
        <div className="mt-4 grid grid-cols-5 gap-1.5">
          <MiniMetric label="PER" value={formatMultiple(holding.fundamental.metrics?.estimatedPer ?? holding.fundamental.metrics?.per ?? null)} />
          <MiniMetric label="PBR" value={formatMultiple(holding.fundamental.metrics?.pbr ?? null)} />
          <MiniMetric label="ROE" value={formatPlainPercent(holding.fundamental.metrics?.roe ?? null)} tone="green" />
          <MiniMetric label="EPS" value={formatPercent(holding.fundamental.metrics?.epsGrowthPct ?? null, 0)} tone="blue" />
          <MiniMetric label="OPM" value={formatPlainPercent(holding.fundamental.metrics?.operatingMargin ?? null)} tone="amber" />
        </div>
      ) : null}

      {holding.fundamental?.type === "etf" ? (
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          <MiniMetric label="ETF점수" value={`${holding.fundamental.score?.overall ?? "-"}점`} tone="blue" />
          <MiniMetric label="거래" value={formatCount(holding.fundamental.market?.volume ?? null)} />
          <MiniMetric label="NAV" value={formatPlainPercent(holding.fundamental.market?.navGapPct ?? null, 2)} tone="amber" />
          <MiniMetric label="Top5" value={formatPlainPercent(holding.fundamental.etf?.concentrationTop5Pct ?? null, 0)} />
        </div>
      ) : null}

      <NeedPills items={holding.fundamental?.dataNeeds} />

      {holding.thesis ? <p className="mt-4 line-clamp-3 text-[13px] leading-6 text-slate-600">{holding.thesis}</p> : null}

      <details className="mt-3 rounded-[8px] border border-slate-100 bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">조건·위험·공백</summary>
        <div className="mt-3 grid gap-2 text-[12px] leading-5 text-slate-600">
          {(attr?.drivers ?? []).slice(0, 4).map((item) => (
            <p key={`driver-${item}`}>매력: {item}</p>
          ))}
          {(attr?.dataQuality?.gaps ?? []).slice(0, 3).map((item) => (
            <p key={`gap-${item}`}>공백: {item}</p>
          ))}
          {(holding.addConditions ?? []).slice(0, 2).map((item) => (
            <p key={`add-${item}`}>매수: {item}</p>
          ))}
          {(holding.trimConditions ?? []).slice(0, 2).map((item) => (
            <p key={`trim-${item}`}>감량: {item}</p>
          ))}
          {(holding.riskFlags ?? []).slice(0, 3).map((item) => (
            <p key={`risk-${item}`}>위험: {item}</p>
          ))}
        </div>
      </details>
    </article>
  );
}

function MiniMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: Tone | string;
}) {
  return (
    <div className={`rounded-[8px] border px-2.5 py-2 ${toneClass(tone)}`}>
      <p className="text-[10px] font-semibold text-current/70">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function NeedPills({ items }: { items?: string[] }) {
  const needs = (items ?? []).slice(0, 3);
  if (needs.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {needs.map((item) => (
        <Pill key={item} label={shortNeedLabel(item)} tone="amber" />
      ))}
    </div>
  );
}

function stockeasyMarketText(pulse?: StockeasyPulse | null) {
  const kospi = pulse?.marketSignal?.kospi;
  const kosdaq = pulse?.marketSignal?.kosdaq;
  const kospiText = kospi?.recommendedExposure ? `KOSPI ${kospi.recommendedExposure}` : kospi?.statusLabel ?? "KOSPI -";
  const kosdaqText = kosdaq?.recommendedExposure ? `KOSDAQ ${kosdaq.recommendedExposure}` : kosdaq?.statusLabel ?? "KOSDAQ -";
  return `${kospiText} · ${kosdaqText}`;
}

function stockeasySelectedRows(pulse?: StockeasyPulse | null, limit = 20) {
  const radarRows = pulse?.etfRadar ?? [];
  const selectedRows = new Map<string, StockeasySectorPulseItem>();
  for (const row of radarRows.slice(0, 14)) selectedRows.set(row.id ?? row.sector ?? String(selectedRows.size), row);
  for (const row of radarRows.filter((item) => item.action === "ETF공백").slice(0, 5)) {
    selectedRows.set(row.id ?? row.sector ?? String(selectedRows.size), row);
  }
  for (const row of radarRows.filter((item) => item.label === "눌림유지").slice(0, 5)) {
    selectedRows.set(row.id ?? row.sector ?? String(selectedRows.size), row);
  }
  return [...selectedRows.values()].slice(0, limit);
}

function trendDeltaText(value: number | null | undefined, suffix = "점") {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function TrendPill({ trend }: { trend?: StockeasyTrend }) {
  if (!trend) return <Pill label="기록부족" tone="slate" />;
  return <Pill label={trend.label ?? "횡보"} tone={trend.tone ?? "slate"} />;
}

function TrendMiniLine({ trend }: { trend?: StockeasyTrend }) {
  const recent = (trend?.recent ?? []).slice(-6);
  if (recent.length === 0) return null;
  return (
    <div className="mt-2 flex items-end gap-1">
      {recent.map((point) => (
        <div
          key={point.date}
          className="w-2 rounded-t bg-slate-300"
          style={{ height: `${Math.max(8, Math.min(28, Number(point.score ?? 0) / 3))}px` }}
          title={`${point.date}: ${point.score ?? "-"}점`}
        />
      ))}
    </div>
  );
}

function StockEasyEtfMatchList({ matches }: { matches?: StockeasyEtfMatch[] }) {
  const items = (matches ?? []).slice(0, 3);
  if (items.length === 0) {
    return (
      <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
        전용 ETF 미포착
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        <div key={`${item.code ?? item.name}-${index}`} className="rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold text-slate-950">{item.name ?? "-"}</p>
            <Pill label={item.held ? "보유중" : "미보유"} tone={item.held ? "slate" : "green"} />
            <Pill label={`매칭 ${item.matchScore ?? "-"}`} tone="blue" />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {item.code ?? "-"} · 점수 {item.score ?? "-"} · 등락 {formatPercent(item.changePct ?? null)}
            {item.rank ? ` · ${item.rank}위` : ""}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-slate-600">
            {(item.reasons ?? []).slice(0, 4).join(" / ") || "구성 겹침 확인"}
          </p>
          {(item.dataNeeds ?? []).length > 0 ? <NeedPills items={item.dataNeeds} /> : null}
        </div>
      ))}
    </div>
  );
}

function StockEasyStockDetailTable({ stocks }: { stocks?: StockeasyStockMatch[] }) {
  const rows = (stocks ?? []).slice(0, 7);
  if (rows.length === 0) {
    return <p className="text-[13px] text-slate-500">종목 상세 수집이 아직 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
        <thead className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <tr>
            <th className="py-2 pr-3">종목</th>
            <th className="py-2 pr-3">상태</th>
            <th className="py-2 pr-3 text-right">SE</th>
            <th className="py-2 pr-3 text-right">기본</th>
            <th className="py-2 pr-3 text-right">PER</th>
            <th className="py-2 pr-3 text-right">PBR</th>
            <th className="py-2 pr-3 text-right">ROE</th>
            <th className="py-2 pr-3 text-right">EPS</th>
            <th className="py-2 text-right">등락</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((item, index) => (
            <tr key={`${item.code ?? item.name}-${index}`} className="align-top">
              <td className="py-2.5 pr-3">
                <p className="font-semibold text-slate-950">{item.name ?? "-"}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{item.code ?? "코드보강"} · {item.category ?? "미분류"}</p>
              </td>
              <td className="py-2.5 pr-3">
                <div className="flex flex-wrap gap-1.5">
                  <Pill label={item.held ? "보유중" : "후보"} tone={item.held ? "slate" : "green"} />
                  {item.label ? <Pill label={item.label} tone={labelTone(item.label)} /> : null}
                </div>
                {(item.dataNeeds ?? []).length > 0 ? <NeedPills items={item.dataNeeds} /> : null}
              </td>
              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-slate-700">{item.stockeasyScore ?? "-"}</td>
              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-slate-900">{item.score ?? "-"}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatMultiple(item.metrics?.per ?? null)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatMultiple(item.metrics?.pbr ?? null)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatPlainPercent(item.metrics?.roe ?? null)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatPercent(item.metrics?.epsGrowthPct ?? null, 0)}</td>
              <td className={`py-2.5 text-right font-semibold tabular-nums ${Number(item.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {formatPercent(item.changePct ?? null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockEasyEtfDetailCards({ etfs }: { etfs?: StockeasyEtfMatch[] }) {
  const rows = (etfs ?? []).slice(0, 4);
  if (rows.length === 0) {
    return (
      <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
        전용 ETF 후보가 약합니다. 이 섹터는 개별 종목형 접근이나 ETF 데이터 보강이 먼저입니다.
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((item, index) => (
        <article key={`${item.code ?? item.name}-${index}`} className="rounded-[8px] border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-950">{item.name ?? "-"}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {item.code ?? "-"} · 매칭 {item.matchScore ?? "-"} · 점수 {item.score ?? "-"} · 등락 {formatPercent(item.changePct ?? null)}
              </p>
            </div>
            <Pill label={item.held ? "보유중" : "미보유"} tone={item.held ? "slate" : "green"} />
          </div>
          <p className="mt-2 text-[12px] leading-5 text-slate-600">
            {(item.reasons ?? []).slice(0, 5).join(" / ") || "구성 겹침 확인"}
          </p>
          <div className="mt-3 grid gap-1.5">
            {(item.topHoldings ?? []).slice(0, 5).map((holding) => (
              <div key={`${item.code}-${holding.code ?? holding.name}`} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate text-slate-700">{holding.name ?? "-"}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {formatPlainPercent(holding.weightPct ?? null)} · {formatPercent(holding.changePct ?? null)}
                </span>
              </div>
            ))}
          </div>
          {(item.dataNeeds ?? []).length > 0 ? <NeedPills items={item.dataNeeds} /> : null}
        </article>
      ))}
    </div>
  );
}

function StockEasySectorDetailPanel({ pulse }: { pulse?: StockeasyPulse | null }) {
  const rows = stockeasySelectedRows(pulse, 14);
  if (!pulse || rows.length === 0) return null;

  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-kicker">Sector Drilldown</p>
          <h2 className="mt-1 text-[1.05rem] font-semibold text-slate-950">섹터별 종목/ETF 상세</h2>
          <p className="mt-2 max-w-[820px] text-[13px] leading-6 text-slate-500">
            각 섹터를 열면 StockEasy 리더 종목, 기본지표, ETF 구성 상위종목을 같이 비교합니다.
          </p>
        </div>
        <Pill label={`${rows.length}개`} tone="blue" />
      </div>

      <div className="grid gap-2">
        {rows.map((row, index) => (
          <details
            key={row.id ?? row.sector}
            open={index < 2 || row.action === "ETF공백"}
            className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-slate-950">{row.sector ?? "-"}</p>
                    <Pill label={row.action ?? "관찰"} tone={row.tone ?? "slate"} />
                    <Pill label={row.label ?? "확인"} tone="slate" />
                    <TrendPill trend={row.trend} />
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500">
                    점수 {row.score ?? "-"} · 전일대비 {trendDeltaText(row.trend?.scoreDelta)} · 등락 {formatPercent(row.changePct ?? null)} · 종목 {(row.matchedStocks ?? []).length} · ETF {(row.matchedEtfs ?? []).length}
                  </p>
                  <TrendMiniLine trend={row.trend} />
                </div>
                <p className="text-[12px] font-semibold text-slate-600">{row.buyQuestion ?? "매수 조건 확인"}</p>
              </div>
            </summary>

            <div className="mt-4 grid gap-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">종목 후보</h3>
                  <Pill label={`${(row.matchedStocks ?? []).length}개`} tone="green" />
                </div>
                <StockEasyStockDetailTable stocks={row.matchedStocks} />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">ETF 후보와 구성</h3>
                  <Pill label={`${(row.matchedEtfs ?? []).length}개`} tone="amber" />
                </div>
                <StockEasyEtfDetailCards etfs={row.matchedEtfs} />
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function StockEasyEtfRadarPanel({ pulse }: { pulse?: StockeasyPulse | null }) {
  if (!pulse) return null;
  const rows = stockeasySelectedRows(pulse, 20);

  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-kicker">StockEasy ETF Radar</p>
          <h2 className="mt-1 text-[1.05rem] font-semibold text-slate-950">테마 ETF 물색판</h2>
          <p className="mt-2 max-w-[820px] text-[13px] leading-6 text-slate-500">
            StockEasy 섹터/주도섹터 신호를 ETF 구성종목, 키워드, 수급 점수와 매칭했습니다. 전용 ETF가 안 잡히는 섹터는 보강 후보로 따로 남깁니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill label={`단기 ${pulse.marketSignal?.short ?? "-"}`} tone="green" />
          <Pill label={`장기 ${pulse.marketSignal?.long ?? "-"}`} tone="green" />
          <Pill label={`섹터 ${pulse.counts?.sectorCount ?? rows.length}`} tone="blue" />
          <Pill label={`ETF ${pulse.counts?.etfCandidates ?? 0}`} tone="amber" />
        </div>
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-4">
        <MiniMetric label="시장노출" value={stockeasyMarketText(pulse)} tone="green" />
        <MiniMetric label="원자료" value={`${pulse.counts?.sectorRows ?? 0}행 / RS ${pulse.counts?.rsRows ?? 0}`} tone="blue" />
        <MiniMetric label="추세기록" value={`${pulse.counts?.historyDays ?? 0}일`} tone="slate" />
        <MiniMetric label="ETF 공백" value={`${pulse.counts?.etfGaps ?? 0}개 보강`} tone={(pulse.counts?.etfGaps ?? 0) > 0 ? "amber" : "green"} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="py-2 pr-3">섹터</th>
              <th className="py-2 pr-3">판정</th>
              <th className="py-2 pr-3">추세</th>
              <th className="py-2 pr-3 text-right">점수</th>
              <th className="py-2 pr-3 text-right">등락</th>
              <th className="py-2 pr-3">주도종목</th>
              <th className="py-2 pr-3">ETF 후보</th>
              <th className="py-2">다음 판단</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id ?? row.sector} className="align-top">
                <td className="py-3 pr-3">
                  <p className="font-semibold text-slate-950">{row.sector ?? "-"}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    RS {row.rsScore ?? "-"}{row.rank ? ` · ${row.rank}위` : ""} · 신호 {row.signal ?? "-"}
                  </p>
                </td>
                <td className="py-3 pr-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Pill label={row.action ?? "관찰"} tone={row.tone ?? "slate"} />
                    <Pill label={row.label ?? "확인"} tone="slate" />
                  </div>
                </td>
                <td className="py-3 pr-3">
                  <TrendPill trend={row.trend} />
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    점수 {trendDeltaText(row.trend?.scoreDelta)} · 신호 {trendDeltaText(row.trend?.signalDelta, "")}
                  </p>
                  <TrendMiniLine trend={row.trend} />
                </td>
                <td className="py-3 pr-3 text-right font-semibold tabular-nums text-slate-900">{row.score ?? "-"}</td>
                <td className={`py-3 pr-3 text-right font-semibold tabular-nums ${Number(row.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {formatPercent(row.changePct ?? null)}
                </td>
                <td className="py-3 pr-3 text-slate-700">
                  {(row.leaders ?? []).slice(0, 4).map((leader) => `${leader.name} ${leader.score ?? "-"}`).join(" / ") || "리더확인"}
                </td>
                <td className="py-3 pr-3">
                  <StockEasyEtfMatchList matches={row.matchedEtfs} />
                </td>
                <td className="py-3 text-slate-600">
                  <p className="leading-5">{row.implication ?? "ETF 구성과 수급 동시 확인"}</p>
                  <p className="mt-2 text-[12px] font-semibold text-slate-900">{row.buyQuestion ?? "매수 조건 확인"}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WatchSectorsTable({ sectors }: { sectors?: SectorLayerItem[] }) {
  const rows = (sectors ?? [])
    .map((sector) => ({
      ...sector,
      unheld: (sector.topSecurities ?? []).filter((item) => !item.held),
    }))
    .filter((sector) => sector.unheld.length > 0)
    .sort((left, right) => Number(right.unheld[0]?.score ?? 0) - Number(left.unheld[0]?.score ?? 0))
    .slice(0, 8);

  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="section-kicker">Sector Watch</p>
          <h2 className="mt-1 text-[1.05rem] font-semibold text-slate-950">아직 덜 산 섹터</h2>
        </div>
        <Pill label={`${rows.length}개`} tone="blue" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="py-2 pr-3">섹터</th>
              <th className="py-2 pr-3">상태</th>
              <th className="py-2 pr-3 text-right">보유</th>
              <th className="py-2 pr-3 text-right">평균</th>
              <th className="py-2 pr-3">미보유 후보</th>
              <th className="py-2">매수 고민 포인트</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((sector) => (
              <tr key={sector.id ?? sector.category} className="align-top">
                <td className="py-3 pr-3 font-semibold text-slate-950">{sector.category}</td>
                <td className="py-3 pr-3">
                  <Pill label={sectorSignal(sector)} tone={sectorSignal(sector) === "강한후보" ? "green" : "blue"} />
                </td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{sector.holdingCount ?? 0}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{sector.averageAttractiveness ?? "-"}</td>
                <td className="py-3 pr-3 text-slate-700">
                  {sector.unheld.slice(0, 3).map((item) => `${item.name} ${item.score ?? "-"}`).join(" / ")}
                </td>
                <td className="py-3 text-slate-500">
                  {Number(sector.holdingCount ?? 0) > 0 ? "기존 보유와 중복노출 확인" : "신규 섹터 편입 타이밍 확인"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WatchStocksTable({ stocks }: { stocks?: SecurityLayerItem[] }) {
  const rows = uniqueByCode((stocks ?? []).filter((item) => !item.held))
    .sort((left, right) => securityScore(right) - securityScore(left))
    .slice(0, 10);

  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="section-kicker">Stock Watch</p>
          <h2 className="mt-1 text-[1.05rem] font-semibold text-slate-950">미보유 종목</h2>
        </div>
        <Pill label={`${rows.length}개`} tone="green" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="py-2 pr-3">종목</th>
              <th className="py-2 pr-3">판정</th>
              <th className="py-2 pr-3 text-right">점수</th>
              <th className="py-2 pr-3 text-right">PER</th>
              <th className="py-2 pr-3 text-right">PBR</th>
              <th className="py-2 pr-3 text-right">ROE</th>
              <th className="py-2 pr-3 text-right">EPS</th>
              <th className="py-2 pr-3 text-right">등락</th>
              <th className="py-2">매수 조건</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((item) => (
              <tr key={item.code} className="align-top">
                <td className="py-3 pr-3">
                  <p className="font-semibold text-slate-950">{item.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{item.code} · {item.category ?? "미분류"}</p>
                </td>
                <td className="py-3 pr-3"><Pill label={candidateAction(item)} tone={candidateTone(item)} /></td>
                <td className="py-3 pr-3 text-right font-semibold tabular-nums text-slate-900">{securityScore(item)}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{formatMultiple(item.metrics?.estimatedPer ?? item.metrics?.per ?? null)}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{formatMultiple(item.metrics?.pbr ?? null)}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{formatPlainPercent(item.metrics?.roe ?? null)}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{formatPercent(item.metrics?.estimatedEpsGrowthPct ?? item.metrics?.epsGrowthPct ?? null, 0)}</td>
                <td className={`py-3 pr-3 text-right font-semibold tabular-nums ${Number(item.market?.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(item.market?.changePct ?? null)}</td>
                <td className="py-3 text-slate-500">{buyTrigger(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WatchEtfsTable({ etfs }: { etfs?: SecurityLayerItem[] }) {
  const rows = uniqueByCode((etfs ?? []).filter((item) => !item.held))
    .sort((left, right) => securityScore(right) - securityScore(left))
    .slice(0, 10);

  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="section-kicker">ETF Watch</p>
          <h2 className="mt-1 text-[1.05rem] font-semibold text-slate-950">미보유 ETF</h2>
        </div>
        <Pill label={`${rows.length}개`} tone="amber" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="py-2 pr-3">ETF</th>
              <th className="py-2 pr-3">판정</th>
              <th className="py-2 pr-3 text-right">점수</th>
              <th className="py-2 pr-3 text-right">순위</th>
              <th className="py-2 pr-3 text-right">등락</th>
              <th className="py-2 pr-3 text-right">거래량</th>
              <th className="py-2 pr-3 text-right">NAV</th>
              <th className="py-2 pr-3">구성/테마</th>
              <th className="py-2">매수 조건</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((item) => (
              <tr key={item.code} className="align-top">
                <td className="py-3 pr-3">
                  <p className="font-semibold text-slate-950">{item.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{item.code} · {item.category ?? "미분류"}</p>
                </td>
                <td className="py-3 pr-3"><Pill label={candidateAction(item)} tone={candidateTone(item)} /></td>
                <td className="py-3 pr-3 text-right font-semibold tabular-nums text-slate-900">{securityScore(item)}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{item.market?.rank ? `${item.market.rank}위` : "-"}</td>
                <td className={`py-3 pr-3 text-right font-semibold tabular-nums ${Number(item.market?.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(item.market?.changePct ?? null)}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{formatCount(item.market?.volume ?? null)}</td>
                <td className="py-3 pr-3 text-right tabular-nums text-slate-700">{formatPlainPercent(item.market?.navGapPct ?? null, 2)}</td>
                <td className="py-3 pr-3 text-slate-600">
                  {(item.etf?.keywords ?? item.etf?.sectors ?? []).slice(0, 3).join(" / ") || "구성확인"}
                </td>
                <td className="py-3 text-slate-500">{buyTrigger(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function rotationTone(value: string | null | undefined): Tone {
  if (/하락|위험|감량|약화|과열/.test(value ?? "")) return "red";
  if (/전환|보호|대기|횡보/.test(value ?? "")) return "amber";
  if (/상승|강화|부상|회복/.test(value ?? "")) return "green";
  return "slate";
}

function RotationWatchPanel({ rotation }: { rotation?: DashboardView["rotationWatch"] }) {
  if (!rotation) {
    return (
      <section className="rounded-[8px] border border-slate-200 bg-white p-5">
        <p className="section-kicker">Rotation Watch</p>
        <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">3주 로테이션 감지판 없음</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          `npm run features:rotation-watch -- --date &lt;date&gt;` 실행 후 dashboard view를 다시 만들면 채워집니다.
        </p>
      </section>
    );
  }

  const market = rotation.marketTrend ?? {};
  const implications = rotation.portfolioImplications ?? {};
  const rotationTargets = rotation.rotationTargets ?? {};
  const targetWatch = rotationTargets.watch ?? [];
  const targetExcluded = rotationTargets.excluded ?? [];
  const transitionTriggerRows = rotation.transitionTriggerBoard?.rows ?? [];
  const sectorRotation = rotation.sectorRotation ?? [];
  const sectorDeliberations = rotation.sectorDeliberations ?? [];
  const sectorUniverse = rotation.stockeasySectorUniverse ?? [];
  const topThemes = rotation.themeRotation ?? [];
  const reduceFirst = implications.reduceFirst ?? [];
  const scenarios = rotation.scenarioPlaybook ?? [];

  return (
    <section className="grid gap-4">
      <div className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Rotation Watch</p>
            <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">3주 로테이션 감지판</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{rotation.summary?.headline}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Pill label={rotation.summary?.mode ?? market.mode ?? "모드확인"} tone={rotationTone(rotation.summary?.mode ?? market.mode)} />
            <Pill label={rotation.summary?.stance ?? implications.stance ?? "대응확인"} tone={rotationTone(rotation.summary?.stance ?? implications.stance)} />
            <Pill label={`${rotation.includedDates?.length ?? 0}일`} tone="blue" />
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricTile
            icon={TrendingUp}
            label="Regime"
            value={market.currentRegime ?? "-"}
            detail={`직전 ${market.previousRegime ?? "-"} / 신뢰 ${formatPlainPercent(market.confidence ? market.confidence * 100 : null, 0)}`}
            tone={rotationTone(market.mode)}
          />
          <MetricTile
            icon={Gauge}
            label="RSI"
            value={market.currentRsi != null ? String(market.currentRsi) : "-"}
            detail={`과열 ${market.overheatDays ?? 0}/${market.observedDays ?? 0}일 / 점수 ${market.marketScore ?? "-"}`}
            tone={Number(market.currentRsi ?? 0) >= 75 ? "red" : "slate"}
          />
          <MetricTile
            icon={WalletCards}
            label="Portfolio"
            value={`${market.portfolioScore ?? "-"}점`}
            detail={`3주 변화 ${market.scoreDelta != null ? String(market.scoreDelta) : "-"}`}
            tone={Number(market.scoreDelta ?? 0) < -5 ? "amber" : "slate"}
          />
          <MetricTile
            icon={AlertTriangle}
            label="Triggers"
            value={`${market.riskTriggers?.length ?? 0}개`}
            detail={(market.riskTriggers ?? [])[0] ?? "하락장 트리거 감시"}
            tone={(market.riskTriggers?.length ?? 0) > 0 ? "amber" : "green"}
          />
        </div>
      </div>

      <section className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Next Rotation</p>
            <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">앞으로 유심히 볼 섹터</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{rotationTargets.summary?.answer}</p>
          </div>
          <Pill label={rotationTargets.summary?.currentAction ?? "조건대기"} tone="amber" />
        </div>
        <p className="mt-3 rounded-[8px] border border-amber-100 bg-amber-50 px-3 py-2 text-[13px] leading-5 text-amber-800">
          {rotationTargets.summary?.switchRule}
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {targetWatch.slice(0, 6).map((item) => (
            <article key={`${item.sector}-${item.priority}`} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-950">{item.sector}</h3>
                <div className="flex flex-wrap gap-1.5">
                  <Pill label={item.priority ?? "관찰"} tone={item.priority === "1순위" ? "green" : item.priority === "2순위" ? "amber" : "slate"} />
                  <Pill label={item.action ?? "조건대기"} tone={item.tone ?? rotationTone(item.action)} />
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-slate-600">{item.whyWatch}</p>
              <p className="mt-2 text-[12px] leading-5 text-blue-700">
                교차검증: {item.sourceConsensus?.label ?? "확인중"} · {item.sourceConsensus?.supportSummary ?? item.sourceConsensus?.detail ?? "리포트/뉴스/ETF/기술 보강 필요"}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-slate-700">
                트리거: {item.transitionTrigger?.label ?? "감시"} · {item.transitionTrigger?.chart?.label ?? "차트확인"} / {item.transitionTrigger?.news?.label ?? "뉴스확인"}
              </p>
              <p className="mt-2 text-[12px] leading-5 text-emerald-700">전환: {item.switchWhen}</p>
              <p className="mt-1 text-[11px] leading-5 text-rose-700">무효: {item.invalidation}</p>
              {(item.representative ?? []).length ? (
                <p className="mt-2 text-[11px] font-semibold text-slate-500">
                  {(item.representative ?? []).slice(0, 2).map((rep) => `${rep.name} RSI ${rep.rsi ?? "-"}`).join(" · ")}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Trigger Board</p>
            <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">전환 트리거 보드</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {rotation.transitionTriggerBoard?.summary ?? "차트, 뉴스, 교차소스가 함께 맞는지 확인합니다."}
            </p>
          </div>
          <Pill label={`${transitionTriggerRows.length}개`} tone="blue" />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left text-sm">
            <thead className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">트리거</th>
                <th className="py-2 pr-3">섹터</th>
                <th className="py-2 pr-3">차트</th>
                <th className="py-2 pr-3">뉴스</th>
                <th className="py-2 pr-3">들어갈 조건</th>
                <th className="py-2">막는 조건</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transitionTriggerRows.slice(0, 8).map((item) => (
                <tr key={`${item.sector}-${item.label}`} className="align-top">
                  <td className="py-2 pr-3"><Pill label={item.label ?? "감시"} tone={item.tone ?? rotationTone(item.label)} /></td>
                  <td className="py-2 pr-3 font-semibold text-slate-950">{item.sector}</td>
                  <td className="max-w-[190px] py-2 pr-3 text-[12px] leading-5 text-slate-700">
                    <span className="font-semibold text-slate-900">{item.chart?.label ?? "-"}</span>
                    <br />
                    {item.chart?.entryTriggers?.slice(0, 3).join(" · ") || item.chart?.detail || "-"}
                  </td>
                  <td className="max-w-[190px] py-2 pr-3 text-[12px] leading-5 text-slate-700">
                    <span className="font-semibold text-slate-900">{item.news?.label ?? "-"}</span>
                    <br />
                    {item.news?.headlines?.[0]?.title ?? item.news?.detail ?? "-"}
                  </td>
                  <td className="max-w-[250px] py-2 pr-3 text-[12px] leading-5 text-emerald-700">
                    {(item.entryChecklist ?? []).slice(0, 3).join(" / ") || "-"}
                  </td>
                  <td className="max-w-[250px] py-2 text-[12px] leading-5 text-rose-700">
                    {(item.exitChecklist ?? []).slice(0, 3).join(" / ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[8px] border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Emerging Sectors</p>
              <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">신규·강화 섹터 후보</h2>
            </div>
            <Pill label={`${sectorRotation.length}개`} tone="green" />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3">섹터</th>
                  <th className="py-2 pr-3">하위테마</th>
                  <th className="py-2 pr-3">변화</th>
                  <th className="py-2">판단</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sectorRotation.slice(0, 7).map((item) => (
                  <tr key={`${item.sector}-${item.status}`}>
                    <td className="py-2 pr-3"><Pill label={item.status ?? "관찰"} tone={item.tone ?? rotationTone(item.status)} /></td>
                    <td className="py-2 pr-3 font-semibold text-slate-950">{item.sector}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      <div className="flex flex-wrap gap-1.5">
                        {(item.themes ?? []).slice(0, 3).map((theme) => (
                          <Pill key={`${item.sector}-${theme.theme}`} label={theme.theme ?? "테마"} tone={rotationTone(theme.status)} />
                        ))}
                      </div>
                    </td>
                    <td className={`py-2 pr-3 tabular-nums ${Number(item.momentum ?? 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {item.momentum ?? "-"}
                    </td>
                    <td className="py-2 text-[12px] leading-5 text-slate-500">{item.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[8px] border border-slate-200 bg-white p-5">
          <p className="section-kicker">Do Not Rotate Yet</p>
          <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">지금 전환 제외</h2>
          <div className="mt-4 grid gap-3">
            {targetExcluded.slice(0, 6).map((item) => (
              <article key={`${item.sector}-${item.verdict}`} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">{item.sector}</h3>
                  <Pill label={item.verdict ?? "제외"} tone="red" />
                </div>
                <p className="mt-2 text-[12px] leading-5 text-slate-600">{item.invalidation}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Sector Deliberation</p>
            <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">섹터 자기질문</h2>
          </div>
          <Pill label={`${sectorDeliberations.length}개`} tone="blue" />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">판정</th>
                <th className="py-2 pr-3">섹터</th>
                <th className="py-2 pr-3">질문</th>
                <th className="py-2 pr-3">교차검증</th>
                <th className="py-2 pr-3">상승 근거</th>
                <th className="py-2 pr-3">하방 의심</th>
                <th className="py-2">대표 기술</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sectorDeliberations.slice(0, 8).map((item) => (
                <tr key={`${item.sector}-${item.verdict}`} className="align-top">
                  <td className="py-2 pr-3"><Pill label={item.verdict ?? "관찰"} tone={item.tone ?? rotationTone(item.verdict)} /></td>
                  <td className="py-2 pr-3 font-semibold text-slate-950">{item.sector}</td>
                  <td className="max-w-[190px] py-2 pr-3 text-[12px] leading-5 text-slate-600">{item.question}</td>
                  <td className="max-w-[220px] py-2 pr-3 text-[12px] leading-5 text-blue-700">
                    {item.sourceConsensus?.label ?? "확인중"} · {item.sourceConsensus?.supportSummary ?? item.sourceConsensus?.detail ?? "외부소스 부족"}
                  </td>
                  <td className="max-w-[230px] py-2 pr-3 text-[12px] leading-5 text-emerald-700">{(item.bullCase ?? [])[0]}</td>
                  <td className="max-w-[230px] py-2 pr-3 text-[12px] leading-5 text-rose-700">{(item.bearCase ?? [])[0]}</td>
                  <td className="py-2 text-[12px] leading-5 text-slate-600">
                    {item.technical?.available ? `${item.technical.label ?? "기술"} · RSI ${item.technical.avgRsi ?? "-"} · 점수 ${item.technical.avgScore ?? "-"}` : item.stockeasy?.detail ?? "자료보강"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {sectorDeliberations.slice(0, 4).map((item) => (
            <article key={`${item.sector}-answer`} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-950">{item.sector}</h3>
                <Pill label={item.verdict ?? "관찰"} tone={item.tone ?? rotationTone(item.verdict)} />
                <Pill label={`확신 ${formatPlainPercent((item.confidence ?? 0) * 100, 0)}`} tone="slate" />
              </div>
              <p className="mt-2 text-[12px] leading-5 text-slate-600">{item.finalAnswer}</p>
              <p className="mt-2 text-[11px] leading-5 text-slate-600">
                전환트리거: {item.transitionTrigger?.label ?? "감시"} · 차트 {item.chartTriggers?.label ?? "-"} · 뉴스 {item.newsTriggers?.label ?? "-"}
              </p>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                교차검증: {item.sourceConsensus?.detail ?? "외부소스 부족"} · StockEasy 베이스: {item.stockeasy?.detail ?? "자료없음"} · 노출 {formatPlainPercent(item.exposure?.weightPct ?? null, 1)}
              </p>
            </article>
          ))}
        </div>
      </section>

      {sectorUniverse.length ? (
        <section className="rounded-[8px] border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-kicker">StockEasy Universe</p>
              <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">StockEasy 베이스 레이더</h2>
            </div>
            <Pill label={`${sectorUniverse.length}개`} tone="slate" />
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {sectorUniverse.slice(0, 12).map((item) => (
              <div key={item.sector} className="rounded-[8px] border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{item.sector}</span>
                  <span className="text-xs font-semibold tabular-nums text-slate-500">RS {item.rsScore ?? "-"}</span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  등락 {formatPlainPercent(item.changePct, 2)} · 신호 {item.signal ?? "-"} · {(item.leaders ?? []).map((leader) => leader.name).slice(0, 2).join(" / ") || "대표 확인"}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.85fr]">
        <section className="rounded-[8px] border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Theme Rotation</p>
              <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">주도권 변화</h2>
            </div>
            <Pill label={`${topThemes.length}개`} tone="blue" />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3">섹터</th>
                  <th className="py-2 pr-3">테마</th>
                  <th className="py-2 pr-3">최근</th>
                  <th className="py-2 pr-3">변화</th>
                  <th className="py-2 pr-3">액션</th>
                  <th className="py-2">이유</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topThemes.slice(0, 10).map((item) => (
                  <tr key={`${item.theme}-${item.status}-${item.lastDate}`}>
                    <td className="py-2 pr-3"><Pill label={item.status ?? "관찰"} tone={item.tone ?? rotationTone(item.status)} /></td>
                    <td className="max-w-[120px] py-2 pr-3 text-slate-600">{item.sector ?? "-"}</td>
                    <td className="max-w-[160px] py-2 pr-3 font-semibold text-slate-900">{item.theme}</td>
                    <td className="py-2 pr-3 tabular-nums text-slate-700">{item.recentScore ?? "-"}</td>
                    <td className={`py-2 pr-3 tabular-nums ${Number(item.momentum ?? 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>{item.momentum ?? "-"}</td>
                    <td className="py-2 pr-3 text-slate-700">{item.action}</td>
                    <td className="py-2 text-[12px] leading-5 text-slate-500">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[8px] border border-slate-200 bg-white p-5">
          <p className="section-kicker">Protect First</p>
          <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">먼저 보호할 보유</h2>
          <div className="mt-4 grid gap-3">
            {reduceFirst.slice(0, 6).map((item) => (
              <article key={`${item.code}-${item.verdict}`} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{item.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.category} · RSI {item.rsi ?? "-"}</p>
                  </div>
                  <Pill label={item.verdict ?? "확인"} tone={stockPulseVerdictTone(item.verdict)} />
                </div>
                <p className="mt-2 text-[12px] leading-5 text-slate-600">{item.trigger}</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">손익 {formatPercent(item.profitRate, 1)}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[8px] border border-slate-200 bg-white p-5">
          <p className="section-kicker">Exposure</p>
          <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">집중 노출</h2>
          <div className="mt-4 grid gap-2">
            {(implications.crowdedExposures ?? []).slice(0, 8).map((item) => (
              <div key={item.category ?? "category"} className="grid grid-cols-[112px_1fr_64px] items-center gap-3 rounded-[8px] border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="truncate text-sm font-semibold text-slate-800">{item.category}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white">
                  <span className="block h-full rounded-full bg-slate-800" style={{ width: `${Math.max(0, Math.min(100, item.weightPct ?? 0))}%` }} />
                </span>
                <span className="text-right text-xs font-semibold tabular-nums text-slate-600">{formatPlainPercent(item.weightPct, 1)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[8px] border border-slate-200 bg-white p-5">
          <p className="section-kicker">Scenario Playbook</p>
          <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">국면별 행동</h2>
          <div className="mt-4 grid gap-3">
            {scenarios.map((item) => (
              <article key={item.scenario} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">{item.scenario}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(item.firstMoves ?? []).slice(0, 3).map((move) => (
                      <Pill key={move} label={move} tone="slate" />
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-slate-600">{item.action}</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">트리거: {item.trigger}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Weekly Checklist</p>
            <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">이번 주 확인할 것</h2>
          </div>
          <Pill label={`${rotation.weeklyChecklist?.length ?? 0}개`} tone="amber" />
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {(rotation.weeklyChecklist ?? []).map((item) => (
            <p key={item} className="rounded-[8px] border border-slate-100 bg-slate-50 px-3 py-2 text-[13px] leading-5 text-slate-600">
              {item}
            </p>
          ))}
        </div>
      </section>
    </section>
  );
}

function WatchlistPanel({
  layers,
  stockeasyPulse,
}: {
  layers?: DashboardView["analysisLayers"];
  stockeasyPulse?: StockeasyPulse | null;
}) {
  return (
    <section className="grid gap-4">
      <div className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-kicker">Buy Radar</p>
            <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">아직 안 산 관심후보</h2>
            <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-slate-500">
              보유종목과 별개로 다음 매수 때 고민할 섹터, 종목, ETF입니다. 급등 항목은 바로 매수가 아니라 조건 확인으로 둡니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill label={`주식 ${uniqueByCode((layers?.stocks ?? []).filter((item) => !item.held)).length}`} tone="green" />
            <Pill label={`ETF ${uniqueByCode((layers?.etfs ?? []).filter((item) => !item.held)).length}`} tone="amber" />
          </div>
        </div>
      </div>
      <StockEasyEtfRadarPanel pulse={stockeasyPulse} />
      <StockEasySectorDetailPanel pulse={stockeasyPulse} />
      <WatchSectorsTable sectors={layers?.sectors} />
      <WatchStocksTable stocks={layers?.stocks} />
      <WatchEtfsTable etfs={layers?.etfs} />
    </section>
  );
}

function ActionBriefCard({ item, compact = false }: { item: ActionBriefItem; compact?: boolean }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill label={item.action ?? "확인"} tone={item.tone ?? labelTone(item.action)} />
            {item.decisionLabel ? <Pill label={item.decisionLabel} tone="slate" /> : null}
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-slate-950">{item.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {item.accountLabel ?? "-"} · {item.code ?? "-"} · 매력 {item.attractiveness ?? "-"}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">{item.score ?? "-"}</span>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-slate-700">{item.instruction}</p>
      {!compact ? (
        <div className="mt-3 grid gap-1.5 text-[12px] leading-5 text-slate-500">
          <p>
            <span className="font-semibold text-slate-700">근거</span> {item.because}
          </p>
          <p>
            <span className="font-semibold text-slate-700">조건</span> {item.trigger}
          </p>
          <p>
            <span className="font-semibold text-slate-700">금지</span> {item.avoid}
          </p>
        </div>
      ) : null}
    </article>
  );
}

function ActionLane({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items?: ActionBriefItem[];
  tone: Tone;
  empty: string;
}) {
  const laneItems = items ?? [];
  return (
    <section className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <Pill label={`${laneItems.length}건`} tone={tone} />
      </div>
      <div className="mt-3 grid gap-2">
        {laneItems.slice(0, 3).map((item) => (
          <ActionBriefCard key={item.id ?? `${item.code}-${item.action}`} item={item} compact />
        ))}
        {laneItems.length === 0 ? (
          <div className="flex h-[112px] items-center justify-center rounded-[8px] border border-dashed border-slate-200 bg-white text-sm text-slate-400">
            {empty}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DecisionBriefPanel({ brief }: { brief?: DashboardView["decisionBrief"] }) {
  if (!brief) return null;
  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">So What</p>
          <h2 className="mt-1 text-[1.35rem] font-semibold tracking-tight text-slate-950">오늘 결론</h2>
          <p className="mt-2 max-w-[680px] text-[14px] leading-6 text-slate-600">{brief.headline}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Pill label={brief.stance ?? "확인"} tone={brief.stance === "보호우선" ? "amber" : brief.stance === "분할실행" ? "green" : "blue"} />
          <Pill label={`실행 ${brief.counts?.do ?? 0}`} tone="amber" />
          <Pill label={`금지 ${brief.counts?.avoid ?? 0}`} tone="gray" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <ActionLane title="오늘 할 일" items={brief.lanes?.do} tone="amber" empty="즉시 실행 없음" />
        <ActionLane title="조건 대기" items={brief.lanes?.wait} tone="blue" empty="대기 없음" />
        <ActionLane title="하지 말 것" items={brief.lanes?.avoid} tone="gray" empty="금지 없음" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-950">종목별 다음 행동</h3>
            <Pill label={`${brief.actionQueue?.length ?? 0}개`} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {(brief.actionQueue ?? []).slice(0, 6).map((item) => (
              <ActionBriefCard key={item.id ?? `${item.code}-${item.action}`} item={item} />
            ))}
          </div>
        </div>
        <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
          <h3 className="text-sm font-semibold text-slate-950">왜 이렇게</h3>
          <div className="mt-3 grid gap-2">
            {(brief.layerImplications ?? []).map((item) => (
              <div key={item.layer} className="rounded-[8px] border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-500">{item.layer}</p>
                  <Pill label={item.action ?? "확인"} tone="slate" />
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-950">{item.verdict}</p>
                <p className="mt-1 text-[12px] leading-5 text-slate-500">{item.soWhat}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SellBriefCard({ item, compact = false }: { item: SellBriefItem; compact?: boolean }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill label={item.action ?? "확인"} tone={item.tone ?? labelTone(item.action)} />
            <Pill label={item.size ?? "0%"} tone="slate" />
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-slate-950">{item.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {item.accountLabel ?? "-"} · {item.code ?? "-"} · {formatWon(item.marketValue ?? null)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-sm font-semibold tabular-nums ${Number(item.profitRate ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {formatPercent(item.profitRate ?? null)}
          </p>
          <p className="text-[11px] text-slate-500">손익</p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-slate-700">{item.decision}</p>
      {!compact ? (
        <div className="mt-3 grid gap-1.5 text-[12px] leading-5 text-slate-500">
          <p>
            <span className="font-semibold text-slate-700">근거</span> {item.reason}
          </p>
          <p>
            <span className="font-semibold text-slate-700">매도조건</span> {item.trigger}
          </p>
        </div>
      ) : null}
    </article>
  );
}

function SellLane({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items?: SellBriefItem[];
  tone: Tone;
  empty: string;
}) {
  const laneItems = items ?? [];
  return (
    <section className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <Pill label={`${laneItems.length}건`} tone={tone} />
      </div>
      <div className="mt-3 grid gap-2">
        {laneItems.slice(0, 3).map((item) => (
          <SellBriefCard key={item.id ?? `${item.code}-${item.action}`} item={item} compact />
        ))}
        {laneItems.length === 0 ? (
          <div className="flex h-[112px] items-center justify-center rounded-[8px] border border-dashed border-slate-200 bg-white text-sm text-slate-400">
            {empty}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SellBriefPanel({ brief }: { brief?: DashboardView["sellBrief"] }) {
  if (!brief) return null;
  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Sell Desk</p>
          <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">매도 판단판</h2>
          <p className="mt-2 max-w-[720px] text-[14px] leading-6 text-slate-600">{brief.headline}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Pill label={`전량 ${brief.counts?.sellNow ?? 0}`} tone={(brief.counts?.sellNow ?? 0) > 0 ? "red" : "green"} />
          <Pill label={`익절 ${brief.counts?.trim ?? 0}`} tone="amber" />
          <Pill label={`손절 ${brief.counts?.stop ?? 0}`} tone={(brief.counts?.stop ?? 0) > 0 ? "red" : "slate"} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <SellLane title="지금 매도" items={brief.lanes?.sellNow} tone="red" empty="전량매도 없음" />
        <SellLane title="일부 익절" items={brief.lanes?.trim} tone="amber" empty="익절감시 없음" />
        <SellLane title="손절 감시" items={brief.lanes?.stop} tone="red" empty="손절감시 없음" />
      </div>

      <div className="mt-4 rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-950">매도 우선순위</h3>
          <Pill label={`${brief.queue?.length ?? 0}개`} />
        </div>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {(brief.queue ?? []).slice(0, 6).map((item) => (
            <SellBriefCard key={item.id ?? `${item.code}-${item.action}`} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function QwenSellCoachCard({ item }: { item: QwenSellCoachItem }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill label={item.action ?? "확인"} tone={qwenActionTone(item.action)} />
            <Pill label={`${item.confidence ?? 0}점`} tone="slate" />
            {item.webCheck ? <Pill label={item.webCheck} tone={item.webCheck === "확인" ? "green" : "gray"} /> : null}
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-slate-950">{item.name ?? item.code ?? "-"}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {item.accountLabel ?? "-"} · {item.code ?? "-"}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-slate-700">{item.reason}</p>
      <p className="mt-2 text-[12px] leading-5 text-slate-500">
        <span className="font-semibold text-slate-700">조건</span> {item.trigger}
      </p>
      {(item.sourceUrls ?? []).length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(item.sourceUrls ?? []).slice(0, 2).map((url, index) => (
            <a
              key={url}
              href={url}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-50"
              target="_blank"
              rel="noreferrer"
            >
              출처 {index + 1}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function QwenBuyCoachCard({ item }: { item: QwenBuyCoachItem }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill label={item.action ?? "확인"} tone={qwenActionTone(item.action)} />
        <Pill label={`${item.confidence ?? 0}점`} tone="slate" />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-slate-950">{item.name ?? item.code ?? "-"}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{item.code ?? "-"}</p>
      <p className="mt-3 text-[13px] leading-5 text-slate-700">{item.reason}</p>
      <p className="mt-2 text-[12px] leading-5 text-slate-500">
        <span className="font-semibold text-slate-700">조건</span> {item.trigger}
      </p>
    </article>
  );
}

function QwenCoachPanel({ coach }: { coach?: DashboardView["qwenCoach"] }) {
  if (!coach) return null;
  const failed = coach.status === "failed";
  const sellItems = coach.sellCoach ?? [];
  const buyItems = coach.buyCoach ?? [];
  const backlog = coach.researchBacklog ?? [];
  return (
    <section className={`rounded-[8px] border bg-white p-5 ${failed ? "border-rose-200" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Qwen Research</p>
          <h2 className="mt-1 flex items-center gap-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            <BrainCircuit className="h-5 w-5 text-sky-700" />
            Qwen 보강 판단
          </h2>
          <p className="mt-2 max-w-[760px] text-[14px] leading-6 text-slate-600">
            {failed ? coach.error ?? "Qwen 보강 생성에 실패했습니다." : coach.headline}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Pill label={coach.status ?? "unknown"} tone={failed ? "red" : "green"} />
          <Pill label={coach.model ?? "qwen"} tone="blue" />
          <Pill label={coach.webSearch ? `웹 ${coach.searchStrategy ?? "on"}` : "웹 off"} tone={coach.webSearch ? "green" : "gray"} />
        </div>
      </div>

      {!failed ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr_0.9fr]">
          <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-950">매도 2차검증</h3>
              <Pill label={`${sellItems.length}건`} tone="amber" />
            </div>
            <div className="grid gap-2">
              {sellItems.slice(0, 4).map((item) => (
                <QwenSellCoachCard key={`${item.accountLabel}-${item.code}-${item.action}`} item={item} />
              ))}
              {sellItems.length === 0 ? (
                <div className="flex h-[108px] items-center justify-center rounded-[8px] border border-dashed border-slate-200 bg-white text-sm text-slate-400">
                  매도 보강 없음
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-950">매수 반론</h3>
              <Pill label={`${buyItems.length}건`} tone="blue" />
            </div>
            <div className="grid gap-2">
              {buyItems.slice(0, 4).map((item) => (
                <QwenBuyCoachCard key={`${item.code}-${item.action}`} item={item} />
              ))}
              {buyItems.length === 0 ? (
                <div className="flex h-[108px] items-center justify-center rounded-[8px] border border-dashed border-slate-200 bg-white text-sm text-slate-400">
                  매수 보강 없음
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-950">
                <SearchCheck className="h-4 w-4 text-sky-700" />
                자료보강 큐
              </h3>
              <Pill label={`${backlog.length}건`} tone="slate" />
            </div>
            <div className="grid gap-2">
              {backlog.slice(0, 4).map((item, index) => (
                <div key={`${item.question}-${index}`} className="rounded-[8px] border border-slate-100 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-5 text-slate-950">{item.question}</p>
                    <Pill label={item.priority ?? "중간"} tone={item.priority === "높음" ? "red" : "slate"} />
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-slate-500">{item.why}</p>
                </div>
              ))}
              {(coach.riskWarnings ?? []).slice(0, 3).map((warning, index) => (
                <div key={`${warning}-${index}`} className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[12px] leading-5 text-amber-800">
                  {warning}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AccountStrategyTodoCard({ item, index }: { item: AccountStrategyTodoItem; index: number }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill label={item.action ?? "확인"} tone={qwenActionTone(item.action)} />
            <Pill label={item.priority ?? "중간"} tone={strategyPriorityTone(item.priority)} />
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-slate-950">{item.name ?? `전략 ${index + 1}`}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{item.accountLabel ?? "계좌 전체"}</p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-slate-700">{item.reason}</p>
      <div className="mt-3 grid gap-1.5 text-[12px] leading-5 text-slate-500">
        <p>
          <span className="font-semibold text-slate-700">조건</span> {item.condition}
        </p>
        <p>
          <span className="font-semibold text-slate-700">금지</span> {item.doNot}
        </p>
      </div>
    </article>
  );
}

function AccountStrategyWatchCard({ item, index }: { item: AccountStrategyWatchItem; index: number }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill label={item.action ?? "확인"} tone={qwenActionTone(item.action)} />
        {item.accountLabel ? <Pill label={item.accountLabel} tone="slate" /> : null}
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-slate-950">{item.name ?? `대상 ${index + 1}`}</p>
      <p className="mt-2 text-[13px] leading-5 text-slate-700">{item.reason}</p>
      <p className="mt-2 text-[12px] leading-5 text-slate-500">
        <span className="font-semibold text-slate-700">조건</span> {item.trigger}
      </p>
    </article>
  );
}

function AccountStrategyTextList({
  title,
  items,
  tone = "slate",
  empty,
}: {
  title: string;
  items?: string[];
  tone?: Tone;
  empty: string;
}) {
  const rows = items ?? [];
  return (
    <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <Pill label={`${rows.length}건`} tone={tone} />
      </div>
      <div className="grid gap-2">
        {rows.slice(0, 5).map((item, index) => (
          <p key={`${title}-${index}`} className="rounded-[8px] border border-slate-100 bg-white px-3 py-2 text-[12px] leading-5 text-slate-600">
            {item}
          </p>
        ))}
        {rows.length === 0 ? (
          <div className="flex h-[84px] items-center justify-center rounded-[8px] border border-dashed border-slate-200 bg-white text-sm text-slate-400">
            {empty}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AccountStrategyPanel({
  strategy,
  compact = false,
}: {
  strategy?: DashboardView["accountStrategy"];
  compact?: boolean;
}) {
  if (!strategy) return null;
  const failed = strategy.status === "failed";
  const todayDo = strategy.todayDo ?? [];
  const sellWatch = strategy.sellWatch ?? [];
  const buyWatch = strategy.buyWatch ?? [];
  const sectorView = strategy.sectorView ?? [];
  const warningCount = (strategy.riskWarnings ?? []).length + (strategy.validationWarnings ?? []).length;

  return (
    <section className={`rounded-[8px] border bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)] ${failed ? "border-rose-200" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Account AI</p>
          <h2 className="mt-1 flex items-center gap-2 text-[1.3rem] font-semibold tracking-tight text-slate-950">
            <WalletCards className="h-5 w-5 text-slate-700" />
            최종 계좌전략
          </h2>
          <p className="mt-2 max-w-[800px] text-[14px] leading-6 text-slate-600">
            {failed ? strategy.error ?? "Qwen 계좌전략 생성에 실패했습니다." : strategy.headline}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Pill label={strategy.stance ?? "확인"} tone={strategyStanceTone(strategy.stance)} />
          <Pill label={strategy.status ?? "unknown"} tone={failed ? "red" : "green"} />
          <Pill label={strategy.model ?? "qwen"} tone="blue" />
          <Pill label={strategy.webSearch ? "웹검색" : "웹off"} tone={strategy.webSearch ? "green" : "gray"} />
          {typeof strategy.confidence === "number" ? <Pill label={`신뢰 ${strategy.confidence}`} tone="slate" /> : null}
        </div>
      </div>

      {!failed ? (
        <>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-950">오늘 할 일</h3>
                <Pill label={`${todayDo.length}건`} tone="amber" />
              </div>
              <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-1">
                {todayDo.slice(0, compact ? 3 : 5).map((item, index) => (
                  <AccountStrategyTodoCard key={`${item.accountLabel}-${item.name}-${item.action}-${index}`} item={item} index={index} />
                ))}
                {todayDo.length === 0 ? (
                  <div className="flex h-[120px] items-center justify-center rounded-[8px] border border-dashed border-slate-200 bg-white text-sm text-slate-400">
                    실행 없음
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3">
              <AccountStrategyTextList title="하지 말 것" items={strategy.todayDoNot} tone="red" empty="금지 없음" />
              {!compact ? <AccountStrategyTextList title="리스크 경고" items={strategy.riskWarnings} tone={warningCount > 0 ? "amber" : "green"} empty="경고 없음" /> : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-950">매도 감시</h3>
                <Pill label={`${sellWatch.length}건`} tone="amber" />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {sellWatch.slice(0, compact ? 4 : 6).map((item, index) => (
                  <AccountStrategyWatchCard key={`${item.accountLabel}-${item.name}-${item.action}-${index}`} item={item} index={index} />
                ))}
              </div>
            </div>

            <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-950">매수 후보</h3>
                <Pill label={`${buyWatch.length}건`} tone="blue" />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {buyWatch.slice(0, compact ? 4 : 6).map((item, index) => (
                  <AccountStrategyWatchCard key={`${item.name}-${item.action}-${index}`} item={item} index={index} />
                ))}
              </div>
            </div>
          </div>

          {!compact ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">섹터 결론</h3>
                  <Pill label={`${sectorView.length}개`} tone="blue" />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {sectorView.slice(0, 8).map((item, index) => (
                    <div key={`${item.sector}-${index}`} className="rounded-[8px] border border-slate-100 bg-white p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill label={item.action ?? "확인"} tone={qwenActionTone(item.action)} />
                        <Pill label={item.view ?? "확인"} tone="slate" />
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{item.sector}</p>
                      <p className="mt-1 text-[12px] leading-5 text-slate-500">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <AccountStrategyTextList title="이번 주 확인" items={strategy.weeklyChecklist} tone="green" empty="체크 없음" />
                <AccountStrategyTextList title="보강 필요" items={strategy.missingData} tone="amber" empty="보강 없음" />
              </div>
            </div>
          ) : null}

          {(strategy.validationWarnings ?? []).length > 0 ? (
            <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[12px] leading-5 text-amber-800">
              {(strategy.validationWarnings ?? []).join(" / ")}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function StockPulseMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className={`rounded-[8px] border px-2.5 py-2 ${toneClass(tone)}`}>
      <p className="text-[10px] font-semibold text-current/70">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StockPulseCard({ item }: { item: StockPulseItem }) {
  const alerts = item.alerts ?? [];
  const metrics = item.fundamental?.metrics;
  const topEtfHoldings = item.fundamental?.etf?.topHoldings ?? [];
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill label={item.verdict ?? "확인"} tone={stockPulseVerdictTone(item.verdict)} />
            <Pill label={item.urgency ?? "낮음"} tone={urgencyTone(item.urgency)} />
            <Pill label={`${item.pulseScore ?? 0}점`} tone={scoreTone(item.pulseScore ?? null)} />
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-slate-950">{item.name ?? item.code ?? "-"}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {item.code ?? "-"} · {item.category ?? "미분류"} · {(item.accounts ?? []).map((account) => account.accountLabel).filter(Boolean).join("/")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-sm font-semibold tabular-nums ${Number(item.market?.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {formatPercent(item.market?.changePct ?? null)}
          </p>
          <p className="text-[11px] text-slate-500">{formatWon(item.market?.price ?? null)}</p>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-5 text-slate-700">{item.doNow}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <StockPulseMetric label="손익" value={formatPercent(item.position?.profitRate ?? null)} tone={Number(item.position?.profitRate ?? 0) >= 0 ? "green" : "red"} />
        <StockPulseMetric label="RSI" value={item.technical?.rsi != null ? String(item.technical.rsi) : "-"} tone={Number(item.technical?.rsi ?? 0) >= 70 ? "amber" : "slate"} />
        <StockPulseMetric label="거래량" value={item.market?.volumeRatio != null ? `${item.market.volumeRatio}x` : formatCount(item.market?.volume ?? null)} tone={Number(item.market?.volumeRatio ?? 0) >= 2 ? "blue" : "slate"} />
        <StockPulseMetric label="기술" value={item.technical?.score != null ? `${item.technical.score}` : "-"} tone={scoreTone(item.technical?.score ?? null) as Tone} />
      </div>

      <div className="mt-3 grid gap-2">
        {alerts.slice(0, 3).map((alert, index) => (
          <div key={`${alert.label}-${index}`} className={`rounded-[8px] border px-3 py-2 text-[12px] leading-5 ${toneClass(alert.tone ?? "slate")}`}>
            <span className="font-semibold">{alert.label}</span> {alert.detail}
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 text-[12px] leading-5 text-slate-500">
        <p>
          <span className="font-semibold text-slate-700">금지</span> {item.doNot}
        </p>
        <p>
          <span className="font-semibold text-slate-700">확인</span> {item.nextCheck}
        </p>
      </div>

      {metrics ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill label={`PER ${metrics.per ?? metrics.estimatedPer ?? "-"}`} tone="slate" />
          <Pill label={`PBR ${metrics.pbr ?? "-"}`} tone="slate" />
          <Pill label={`ROE ${formatPlainPercent(metrics.roe ?? metrics.roeEstimate ?? null)}`} tone="slate" />
          <Pill label={`EPS ${formatPlainPercent(metrics.epsGrowthPct ?? metrics.estimatedEpsGrowthPct ?? null)}`} tone="slate" />
        </div>
      ) : null}

      {topEtfHoldings.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topEtfHoldings.slice(0, 3).map((holding) => (
            <Pill key={`${holding.code}-${holding.name}`} label={`${holding.name ?? holding.code} ${formatPlainPercent(holding.weightPct ?? null)}`} tone="blue" />
          ))}
        </div>
      ) : null}

      {(item.missingSources ?? []).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(item.missingSources ?? []).slice(0, 3).map((source) => (
            <Pill key={source} label={source} tone="amber" />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function StockPulsePanel({ pulse }: { pulse?: DashboardView["stockPulse"] }) {
  if (!pulse) return null;
  const items = pulse.items ?? [];
  const urgentItems = items.filter((item) => item.urgency === "높음" || item.urgency === "중간").slice(0, 8);
  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Stock Pulse</p>
          <h2 className="mt-1 flex items-center gap-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            <Activity className="h-5 w-5 text-rose-600" />
            개별주 속보판
          </h2>
          <p className="mt-2 max-w-[760px] text-[14px] leading-6 text-slate-600">{pulse.summary?.headline}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Pill label={pulse.status ?? "unknown"} tone={pulse.status === "ok" ? "green" : "amber"} />
          <Pill label={`긴급 ${pulse.counts?.highUrgency ?? 0}`} tone={(pulse.counts?.highUrgency ?? 0) > 0 ? "red" : "green"} />
          <Pill label={`중간 ${pulse.counts?.mediumUrgency ?? 0}`} tone={(pulse.counts?.mediumUrgency ?? 0) > 0 ? "amber" : "slate"} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-950">우선 확인</h3>
            <Pill label={`${urgentItems.length}개`} tone="amber" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="py-2 pr-3">종목</th>
                  <th className="py-2 pr-3">판정</th>
                  <th className="py-2 pr-3 text-right">손익</th>
                  <th className="py-2 pr-3 text-right">등락</th>
                  <th className="py-2 pr-3 text-right">RSI</th>
                  <th className="py-2">확인</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {urgentItems.map((item) => (
                  <tr key={item.id ?? item.code}>
                    <td className="py-2 pr-3">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      <p className="text-[11px] text-slate-500">{item.code} · {item.category}</p>
                    </td>
                    <td className="py-2 pr-3"><Pill label={item.verdict ?? "확인"} tone={stockPulseVerdictTone(item.verdict)} /></td>
                    <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${Number(item.position?.profitRate ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(item.position?.profitRate ?? null)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${Number(item.market?.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(item.market?.changePct ?? null)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{item.technical?.rsi ?? "-"}</td>
                    <td className="py-2 text-slate-500">{(item.alerts ?? [])[0]?.label ?? item.nextCheck}</td>
                  </tr>
                ))}
                {urgentItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="h-[96px] text-center text-sm text-slate-400">긴급 확인 없음</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[8px] border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-950">소스 상태</h3>
            <Pill label={`${items.length}개`} tone="slate" />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {Object.entries(pulse.sourceStatus ?? {}).map(([key, value]) => (
              <div key={key} className="rounded-[8px] border border-slate-100 bg-white p-3">
                <p className="text-[11px] font-semibold text-slate-500">{key}</p>
                <p className={`mt-1 text-sm font-semibold ${value === "ok" ? "text-emerald-700" : value === "missing" || value === "not_configured" ? "text-amber-700" : "text-slate-700"}`}>{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-5 text-slate-500">{pulse.summary?.nextAction}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.slice(0, 8).map((item) => (
          <StockPulseCard key={item.id ?? item.code ?? item.name} item={item} />
        ))}
      </div>
    </section>
  );
}

function LayerSummaryTile({
  icon: Icon,
  title,
  value,
  detail,
  tone = "slate",
}: {
  icon: typeof ShieldCheck;
  title: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">{title}</p>
        <span className={`rounded-full border p-1.5 ${toneClass(tone)}`}>
          <Icon size={14} />
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500">{detail}</p>
    </article>
  );
}

function MarketLayerPanel({ market }: { market?: MarketLayer }) {
  const rows = [...(market?.indices ?? []), ...(market?.macro ?? [])].slice(0, 8);
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-kicker">1. Market</p>
          <h3 className="mt-1 text-[1rem] font-semibold text-slate-950">시황</h3>
        </div>
        <Pill label={market?.regime ?? "확인"} tone="blue" />
      </div>
      <div className="mt-3 grid gap-2">
        {rows.map((item) => (
          <div key={item.key ?? item.name} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
              <p className="text-[11px] text-slate-500">{item.source ?? "source"}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCount(item.close ?? null)}</p>
              <p className={`text-[11px] font-semibold ${Number(item.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {formatPercent(item.changePct ?? null)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function ThemeLayerPanel({ themes }: { themes?: ThemeSignalView[] }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-kicker">2. Theme</p>
          <h3 className="mt-1 text-[1rem] font-semibold text-slate-950">테마</h3>
        </div>
        <Pill label={`${themes?.length ?? 0}개`} tone="green" />
      </div>
      <div className="mt-3 grid gap-2">
        {(themes ?? []).slice(0, 6).map((theme) => (
          <div key={theme.id} className="border-b border-slate-100 py-2 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">{theme.theme}</p>
              <Pill label={theme.label ?? "확인"} tone={labelTone(theme.label)} />
            </div>
            <p className="mt-1 truncate text-[11px] text-slate-500">{theme.supportSummary}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function SectorLayerPanel({ sectors }: { sectors?: SectorLayerItem[] }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-kicker">3. Sector</p>
          <h3 className="mt-1 text-[1rem] font-semibold text-slate-950">섹터</h3>
        </div>
        <Pill label={`${sectors?.length ?? 0}개`} tone="slate" />
      </div>
      <div className="mt-3 grid gap-2">
        {(sectors ?? []).slice(0, 6).map((sector) => (
          <div key={sector.id ?? sector.category} className="border-b border-slate-100 py-2 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">{sector.category}</p>
              <span className="text-xs font-semibold tabular-nums text-slate-600">
                {sector.averageAttractiveness ?? "-"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              보유 {sector.holdingCount ?? 0} · ETF {sector.etfCount ?? 0} · 주식 {sector.stockCount ?? 0}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

function EtfLayerPanel({ etfs }: { etfs?: SecurityLayerItem[] }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-kicker">4. ETF</p>
          <h3 className="mt-1 text-[1rem] font-semibold text-slate-950">ETF별</h3>
        </div>
        <Pill label={`${etfs?.length ?? 0}개`} tone="blue" />
      </div>
      <div className="mt-3 grid gap-3">
        {(etfs ?? []).slice(0, 5).map((item) => (
          <div key={item.code} className="rounded-[8px] border border-slate-100 bg-slate-50/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{item.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {item.code} · {item.category ?? "미분류"}
                </p>
              </div>
              <Pill label={item.score?.label ?? "수집필요"} tone={scoreTone(item.score?.overall)} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <MiniMetric label="순위" value={item.market?.rank ? `${item.market.rank}위` : "-"} tone="blue" />
              <MiniMetric label="거래" value={formatCount(item.market?.volume ?? null)} />
              <MiniMetric label="NAV" value={formatPlainPercent(item.market?.navGapPct ?? null, 2)} tone="amber" />
              <MiniMetric label="Top5" value={formatPlainPercent(item.etf?.concentrationTop5Pct ?? null, 0)} />
            </div>
            <p className="mt-2 truncate text-[11px] text-slate-500">
              {(item.etf?.holdings ?? [])
                .slice(0, 3)
                .map((holding) => `${holding.name} ${formatPlainPercent(holding.weightPct ?? null, 1)}`)
                .join(" / ") || "구성 수집필요"}
            </p>
            <NeedPills items={item.dataNeeds} />
          </div>
        ))}
      </div>
    </article>
  );
}

function StockLayerPanel({ stocks }: { stocks?: SecurityLayerItem[] }) {
  return (
    <article className="rounded-[8px] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-kicker">5. Stock</p>
          <h3 className="mt-1 text-[1rem] font-semibold text-slate-950">개별종목</h3>
        </div>
        <Pill label={`${stocks?.length ?? 0}개`} tone="green" />
      </div>
      <div className="mt-3 grid gap-3">
        {(stocks ?? []).slice(0, 5).map((item) => (
          <div key={item.code} className="rounded-[8px] border border-slate-100 bg-slate-50/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{item.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {item.code} · {item.category ?? "미분류"}
                </p>
              </div>
              <Pill label={item.score?.label ?? "수집필요"} tone={scoreTone(item.score?.overall)} />
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              <MiniMetric label="PER" value={formatMultiple(item.metrics?.estimatedPer ?? item.metrics?.per ?? null)} />
              <MiniMetric label="PBR" value={formatMultiple(item.metrics?.pbr ?? null)} />
              <MiniMetric label="ROE" value={formatPlainPercent(item.metrics?.roe ?? null)} tone="green" />
              <MiniMetric label="EPS" value={formatPercent(item.metrics?.epsGrowthPct ?? null, 0)} tone="blue" />
              <MiniMetric label="OPM" value={formatPlainPercent(item.metrics?.operatingMargin ?? null)} tone="amber" />
            </div>
            <NeedPills items={item.dataNeeds} />
          </div>
        ))}
      </div>
    </article>
  );
}

function ThemeRow({ theme }: { theme: ThemeSignalView }) {
  return (
    <article className="grid grid-cols-[140px_90px_1fr] items-center gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">{theme.theme}</p>
        <p className="mt-0.5 text-xs text-slate-500">소스 {theme.sourceCount ?? 0}개</p>
      </div>
      <Pill label={theme.label ?? "확인"} tone={labelTone(theme.label)} />
      <SourceBars support={theme.support} />
    </article>
  );
}

function ConflictRow({ conflict }: { conflict: ConflictItem }) {
  return (
    <article className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">
          {conflict.entityId} <span className="text-slate-400">/ {conflict.entityType}</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">{conflict.sourceSummary}</p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
        {(conflict.directions ?? []).map((direction) => (
          <Pill key={direction} label={direction} tone={direction === "negative" ? "red" : direction === "positive" ? "green" : "slate"} />
        ))}
      </div>
    </article>
  );
}

export default async function CockpitPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = await Promise.resolve(searchParams ?? {});
  const activeTab = normalizeTab(params.tab);
  const view = loadDashboardView();

  if (!view) {
    return (
      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-6 pb-12 pt-6">
        <section className="rounded-[8px] border border-slate-200 bg-white p-8">
          <p className="section-kicker">Decision Cockpit</p>
          <h1 className="mt-2 text-[1.5rem] font-semibold text-slate-950">대시보드 데이터가 없습니다</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            `npm run features:dashboard-view -- --date 2026-05-04` 실행 후 다시 열면 됩니다.
          </p>
        </section>
      </main>
    );
  }

  const coverage = view.sourceCoverage ?? {};
  const activeSources = coverage.activeSources ?? [];
  const healthTone = statusTone(view.health?.overallStatus);
  const actionBoard = view.actionBoard ?? {};
  const warnings = (view.health?.warnings ?? []).length;
  const blockers = (view.health?.blockers ?? []).length;
  const conflicts = view.conflicts ?? [];
  const holdings = view.holdings ?? [];
  const attractivenessRanking = view.attractivenessRanking ?? [];
  const themes = view.themes ?? [];
  const accounts = view.portfolio?.accounts ?? [];
  const reinforcedThemes = view.newEvidence?.reinforcedThemes ?? [];
  const reinforcedSecurities = view.newEvidence?.reinforcedSecurities ?? [];
  const newWatchCandidates = view.newEvidence?.newWatchCandidates ?? [];
  const layers = view.analysisLayers ?? {};
  const decisionBrief = view.decisionBrief;
  const sellBrief = view.sellBrief;
  const qwenCoach = view.qwenCoach;
  const accountStrategy = view.accountStrategy;
  const stockPulse = view.stockPulse;
  const rotationWatch = view.rotationWatch;

  const analysisSection = (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="section-kicker">Analysis Layers</p>
          <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">5단 분석 레이어</h2>
        </div>
        <Pill label={`기본 ${coverage.fundamentals ?? 0}개`} tone="blue" />
      </div>
      <div className="mb-3 grid gap-3 md:grid-cols-5">
        <LayerSummaryTile icon={Activity} title="시황" value={layers.market?.regime ?? "-"} detail={`${layers.market?.indices?.length ?? 0} index / ${layers.market?.macro?.length ?? 0} macro`} tone="blue" />
        <LayerSummaryTile icon={TrendingUp} title="테마" value={`${layers.themes?.length ?? 0}개`} detail={(layers.themes ?? [])[0]?.theme ?? "theme"} tone="green" />
        <LayerSummaryTile icon={Layers3} title="섹터" value={`${layers.sectors?.length ?? 0}개`} detail={(layers.sectors ?? [])[0]?.category ?? "sector"} tone="slate" />
        <LayerSummaryTile icon={BarChart3} title="ETF" value={`${layers.etfs?.length ?? 0}개`} detail={(layers.etfs ?? [])[0]?.name ?? "composition"} tone="amber" />
        <LayerSummaryTile icon={Gauge} title="종목" value={`${layers.stocks?.length ?? 0}개`} detail={(layers.stocks ?? [])[0]?.name ?? "fundamental"} tone="green" />
      </div>
      <div className="grid gap-3 xl:grid-cols-5">
        <MarketLayerPanel market={layers.market} />
        <ThemeLayerPanel themes={layers.themes} />
        <SectorLayerPanel sectors={layers.sectors} />
        <EtfLayerPanel etfs={layers.etfs} />
        <StockLayerPanel stocks={layers.stocks} />
      </div>
    </section>
  );

  const attractivenessSection = (
    <section className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
      <div className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Attractiveness</p>
            <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">종목 매력도 랭킹</h2>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-500">
            <Gauge size={17} />
          </span>
        </div>
        <div className="mt-4 grid gap-3">
          {attractivenessRanking.slice(0, 6).map((item) => (
            <AttractivenessRow key={item.id} item={item} />
          ))}
        </div>
      </div>

      <div className="rounded-[8px] border border-slate-200 bg-white p-5">
        <p className="section-kicker">Score Frame</p>
        <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">매력도 구성</h2>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[8px] bg-emerald-50 p-3">
              <p className="text-[11px] font-semibold text-emerald-700">높음</p>
              <p className="mt-1 text-lg font-semibold text-emerald-900">{view.portfolio?.attractiveness?.highCount ?? 0}</p>
            </div>
            <div className="rounded-[8px] bg-sky-50 p-3">
              <p className="text-[11px] font-semibold text-sky-700">조건</p>
              <p className="mt-1 text-lg font-semibold text-sky-900">{view.portfolio?.attractiveness?.conditionalCount ?? 0}</p>
            </div>
            <div className="rounded-[8px] bg-rose-50 p-3">
              <p className="text-[11px] font-semibold text-rose-700">주의</p>
              <p className="mt-1 text-lg font-semibold text-rose-900">{view.portfolio?.attractiveness?.cautionCount ?? 0}</p>
            </div>
          </div>
          <div className="rounded-[8px] border border-slate-100 bg-slate-50 p-4">
            <div className="grid gap-3">
              <ScoreBar label="퀀트" value={24} />
              <ScoreBar label="기술" value={24} />
              <ScoreBar label="기본" value={22} />
              <ScoreBar label="근거" value={18} />
              <ScoreBar label="합의" value={12} />
            </div>
            <p className="mt-4 text-[12px] leading-5 text-slate-500">
              과열, 직접근거 부족, 실행 차단은 감점으로 반영됩니다.
            </p>
          </div>
        </div>
      </div>
    </section>
  );

  const actionSection = (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="section-kicker">Action Board</p>
          <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">오늘의 실행판</h2>
        </div>
        <Link href="/" className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-950">
          <FileText size={14} />
          리포트
        </Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        <ActionColumn title="바로매수" items={actionBoard.immediateBuys ?? []} tone="green" />
        <ActionColumn title="조건매수" items={actionBoard.conditionalBuys ?? []} tone="blue" />
        <ActionColumn title="수익보호" items={actionBoard.trimOrProtect ?? []} tone="amber" />
        <ActionColumn title="관찰" items={actionBoard.watch ?? []} tone="amber" />
        <ActionColumn title="매수제외" items={actionBoard.blockedBuys ?? []} tone="gray" />
      </div>
    </section>
  );

  const holdingsSection = (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-kicker">Holdings</p>
          <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">보유종목 판단 카드</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {accounts.map((account) => (
            <Pill key={account.accountKey} label={`${account.accountLabel ?? account.accountKey} ${account.holdingCount ?? 0}개`} />
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {holdings.slice(0, 12).map((holding, index) => (
          <HoldingCard key={`${holding.id}-${holding.decision?.bucket ?? "decision"}-${index}`} holding={holding} />
        ))}
      </div>
    </section>
  );

  const evidenceCardsSection = (
    <section>
      <div className="mb-3">
        <p className="section-kicker">New Evidence</p>
        <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">5월4일 새 보강 근거</h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <TrendingUp size={15} />
            테마 강화
          </div>
          <div className="grid gap-3">
            {reinforcedThemes.slice(0, 4).map((item) => (
              <EvidenceCard key={item.id} item={item} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <BadgeCheck size={15} />
            종목 보강
          </div>
          <div className="grid gap-3">
            {reinforcedSecurities.slice(0, 4).map((item) => (
              <EvidenceCard key={item.id} item={item} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Eye size={15} />
            신규 관찰
          </div>
          <div className="grid gap-3">
            {newWatchCandidates.slice(0, 4).map((item) => (
              <EvidenceCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );

  const themeConflictSection = (
    <section className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
      <div className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Theme Radar</p>
            <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">소스별 테마 지지</h2>
          </div>
          <BarChart3 className="text-slate-400" size={18} />
        </div>
        <div className="mt-4">
          {themes.slice(0, 10).map((theme) => (
            <ThemeRow key={theme.id} theme={theme} />
          ))}
        </div>
      </div>

      <div className="rounded-[8px] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Conflict Queue</p>
            <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">충돌 점검</h2>
          </div>
          {conflicts.length > 0 ? <AlertTriangle className="text-amber-500" size={18} /> : <CircleDashed className="text-slate-400" size={18} />}
        </div>
        <div className="mt-4">
          {conflicts.slice(0, 10).map((conflict) => (
            <ConflictRow key={conflict.id} conflict={conflict} />
          ))}
          {conflicts.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">
              충돌 없음
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );

  const artifactsSection = (
    <section className="rounded-[8px] border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-kicker">Artifacts</p>
          <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-950">연결 산출물</h2>
        </div>
        <XCircle className="text-slate-300" size={18} />
      </div>
      <div className="mt-4 grid gap-2 text-[13px] leading-6 text-slate-600 md:grid-cols-2">
        {Object.entries(view.artifacts ?? {}).map(([key, value]) => (
          <p key={key} className="rounded-[8px] bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-800">{key}</span>
            <br />
            <code className="text-[12px] text-slate-500">{value}</code>
          </p>
        ))}
      </div>
    </section>
  );

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 pb-12 pt-6">
      <section className="rounded-[8px] border border-slate-200 bg-white px-6 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="section-kicker">Decision Cockpit</p>
            <h1 className="mt-2 text-[1.65rem] font-semibold tracking-tight text-slate-950">
              {view.meta?.date} 매매 판단판
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-slate-500">
              Run {view.meta?.runId ?? "-"} · {view.meta?.version ?? "v1"}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Pill label={`Health ${view.health?.overallStatus ?? "-"}`} tone={healthTone} />
            <Pill label={`Warnings ${warnings}`} tone={warnings > 0 ? "amber" : "green"} />
            <Pill label={`Blockers ${blockers}`} tone={blockers > 0 ? "red" : "green"} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricTile
          icon={ShieldCheck}
          label="System"
          value={view.health?.overallStatus ?? "-"}
          detail={`${view.health?.checks?.length ?? 0} checks / ${blockers} blockers`}
          tone={healthTone as Tone}
        />
        <MetricTile
          icon={Layers3}
          label="Sources"
          value={`${activeSources.length}개`}
          detail={`reports ${coverage.reports ?? 0}, KIS ${coverage.kisEtf ?? 0}, 기본 ${coverage.fundamentals ?? 0}`}
          tone="blue"
        />
        <MetricTile
          icon={WalletCards}
          label="Portfolio"
          value={`${view.portfolio?.score ?? "-"}점`}
          detail={`평균매력 ${view.portfolio?.attractiveness?.average ?? "-"} / ${accounts.length} accounts`}
          tone="slate"
        />
        <MetricTile
          icon={AlertTriangle}
          label="Conflicts"
          value={`${conflicts.length}건`}
          detail={`신규 소스 포함 충돌 큐`}
          tone={conflicts.length > 0 ? "amber" : "green"}
        />
      </section>

      <TabNav activeTab={activeTab} />

      {activeTab === "overview" ? (
        <>
          <RotationWatchPanel rotation={rotationWatch} />
          <AccountStrategyPanel strategy={accountStrategy} />
          <DecisionBriefPanel brief={decisionBrief} />
          <SellBriefPanel brief={sellBrief} />
          <QwenCoachPanel coach={qwenCoach} />
          {actionSection}
        </>
      ) : null}

      {activeTab === "rotation" ? <RotationWatchPanel rotation={rotationWatch} /> : null}

      {activeTab === "watchlist" ? (
        <>
          <AccountStrategyPanel strategy={accountStrategy} compact />
          <WatchlistPanel layers={layers} stockeasyPulse={view.stockeasyPulse} />
        </>
      ) : null}

      {activeTab === "holdings" ? (
        <>
          <StockPulsePanel pulse={stockPulse} />
          <SellBriefPanel brief={sellBrief} />
          {attractivenessSection}
          {holdingsSection}
        </>
      ) : null}

      {activeTab === "layers" ? analysisSection : null}

      {activeTab === "evidence" ? (
        <>
          <QwenCoachPanel coach={qwenCoach} />
          {evidenceCardsSection}
          {themeConflictSection}
        </>
      ) : null}

      {activeTab === "artifacts" ? artifactsSection : null}
    </main>
  );
}
