#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT_DIR, relativePath);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function latestDate() {
  const dashboardDir = path.join(ROOT_DIR, "data", "dashboard");
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state");
  const dates = new Set();

  for (const [dir, matcher] of [
    [dashboardDir, /^(\d{4}-\d{2}-\d{2})-dashboard-view\.json$/],
    [analysisDir, /^(\d{4}-\d{2}-\d{2})$/],
  ]) {
    if (!(await exists(dir))) continue;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = entry.name;
      const match = name.match(matcher);
      if (match) dates.add(match[1]);
    }
  }

  return [...dates].sort().at(-1) ?? null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function pct(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${round(value, digits)}%`;
}

function won(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Math.round(Number(value) / 10000).toLocaleString("ko-KR")}만원`;
}

function text(value) {
  return String(value ?? "").trim();
}

function compact(value, limit = 180) {
  const normalized = text(value).replace(/\s+/g, " ");
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function toneFromScore(score) {
  if (score >= 72) return "green";
  if (score >= 56) return "blue";
  if (score >= 42) return "amber";
  return "red";
}

function verdictFromScore(score, hasConflict) {
  if (score >= 72 && !hasConflict) return "방향성 증명";
  if (score >= 56) return "조건부 증명";
  if (score >= 42) return "보류 검증";
  return "방향성 반박";
}

function sourceAvailable(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function exposureFromLabel(label) {
  const match = text(label).match(/(\d{1,3})\s*-\s*(\d{1,3})%/);
  if (!match) return null;
  return `${match[1]}-${match[2]}%`;
}

function marketPosture({ dashboard, stockeasySnapshot, decisionFeatures, ignoreStockeasy = false }) {
  const marketSignal = dashboard?.stockeasyPulse?.marketSignal ?? {};
  const rotation = dashboard?.rotationWatch?.summary ?? {};
  const account = dashboard?.accountStrategy ?? {};
  const strategies = ignoreStockeasy ? [] : array(stockeasySnapshot?.strategyRoom?.strategies);
  const riskOnCount = strategies.filter((item) => item?.bias === "risk-on").length;
  const shortSignal = ignoreStockeasy ? null : marketSignal?.short ?? stockeasySnapshot?.marketAnalysis?.marketSignal?.shortSignal ?? null;
  const longSignal = ignoreStockeasy ? null : marketSignal?.long ?? stockeasySnapshot?.marketAnalysis?.marketSignal?.longSignal ?? null;
  const themeSupport = array(decisionFeatures?.themeFeatures)
    .map((item) => Object.values(item?.support ?? {}).reduce((sum, value) => sum + Math.max(0, number(value)), 0))
    .sort((a, b) => b - a);
  const internalRiskOn = themeSupport.slice(0, 5).reduce((sum, value) => sum + value, 0) >= 1.8;

  let stance = rotation?.stance ?? account?.stance ?? "중립";
  if (String(stance).includes("보호") || String(account?.stance).includes("방어")) stance = "보호우선";
  else if (shortSignal === "G" && longSignal === "G" && riskOnCount >= 2) stance = "선별위험선호";
  else if (internalRiskOn) stance = "내부근거선별";

  return {
    stance,
    mode: rotation?.mode ?? dashboard?.portfolio?.regime ?? null,
    headline:
      rotation?.headline ??
      account?.headline ??
      "시장 신호와 계좌 실행 조건을 함께 확인해야 합니다.",
    nextAction: rotation?.nextAction ?? "계좌별 실행 조건을 먼저 확인합니다.",
    externalSignal: {
      short: shortSignal,
      long: longSignal,
      kospi: ignoreStockeasy ? null : marketSignal?.kospi ?? stockeasySnapshot?.marketAnalysis?.marketSignal?.kospi ?? null,
      kosdaq: ignoreStockeasy ? null : marketSignal?.kosdaq ?? stockeasySnapshot?.marketAnalysis?.marketSignal?.kosdaq ?? null,
      strategyBias: ignoreStockeasy ? null : stockeasySnapshot?.strategyRoom?.summary?.overallBias ?? null,
      riskOnCount,
      source: ignoreStockeasy ? "disabled" : sourceAvailable(stockeasySnapshot?.marketAnalysis) ? "stockeasy" : "unavailable",
    },
    internalSignal: {
      source: "ecoreport",
      topThemeSupport: round(themeSupport[0] ?? 0, 3),
      riskOn: internalRiskOn,
    },
  };
}

function radarAliases(name) {
  const normalized = text(name);
  const catalog = [
    ["전력", ["전력", "전력기기", "전력/에너지", "AI 인프라", "전력 인프라", "송배전", "변압기", "전선"]],
    ["반도체", ["반도체", "HBM", "메모리", "AI반도체", "전공정", "후공정", "소부장"]],
    ["방산", ["방산", "우주항공", "국방", "방위산업", "K방산"]],
    ["자동차", ["자동차", "전기차", "모빌리티", "전장"]],
    ["2차전지", ["2차전지", "배터리", "양극재", "소재"]],
    ["금", ["금", "원자재", "귀금속", "안전자산", "인플레이션 헤지"]],
    ["미국", ["미국", "S&P500", "나스닥", "빅테크", "메가테크"]],
    ["신재생", ["신재생", "태양광", "ESS", "에너지"]],
    ["원자력", ["원자력", "SMR", "소형모듈원자로"]],
    ["배당", ["배당", "커버드콜", "인컴", "방어"]],
  ];
  const hits = new Set([normalized]);
  for (const [needle, aliases] of catalog) {
    if (normalized.includes(needle) || aliases.some((alias) => normalized.includes(alias))) {
      aliases.forEach((alias) => hits.add(alias));
    }
  }
  return [...hits].filter(Boolean);
}

function normalizeRadarItem(item, source) {
  return {
    sector: item.sector,
    score: number(item.score),
    rsScore: number(item.rsScore),
    label: item.label ?? null,
    action: item.action ?? null,
    changePct: item.changePct ?? null,
    aliases: array(item.aliases).length > 0 ? array(item.aliases) : radarAliases(item.sector),
    leaders: array(item.leaders).slice(0, 6).map((leader) => ({
      name: leader.name,
      score: leader.score ?? null,
    })),
    matchedEtfs: array(item.matchedEtfs).slice(0, 5).map((etf) => ({
      code: etf.code ?? null,
      name: etf.name ?? null,
      held: Boolean(etf.held),
      score: etf.score ?? null,
      reasons: array(etf.reasons).slice(0, 5),
    })),
    sources: [source],
  };
}

function stockeasyRadar(dashboard, stockeasySnapshot, ignoreStockeasy = false) {
  if (ignoreStockeasy) return [];
  const pulseSectors = array(dashboard?.stockeasyPulse?.sectors).map((item) => normalizeRadarItem(item, "stockeasy_capture"));

  if (pulseSectors.length > 0) {
    return pulseSectors.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  return array(stockeasySnapshot?.stockAnalysis?.sectorRs)
    .slice()
    .sort((a, b) => number(b.score) - number(a.score))
    .slice(0, 10)
    .map((item) => ({
      sector: item.sector,
      score: number(item.score),
      rsScore: number(item.score),
      label: "RS 상위",
      action: "후보화",
      changePct: null,
      aliases: radarAliases(item.sector),
      leaders: [],
      matchedEtfs: [],
      sources: ["stockeasy_snapshot"],
    }));
}

function normalizedSectorRadar(normalizedStockeasy, ignoreStockeasy = false) {
  if (ignoreStockeasy) return [];
  return array(normalizedStockeasy?.observations)
    .filter((item) => item?.entityType === "sector" && item?.direction === "positive")
    .map((item) => ({
      sector: item.entityName,
      score: Math.round(number(item.strength) * 100),
      rsScore: Math.round(number(item.confidence) * 100),
      label: "정규화 신호",
      action: "후보화",
      changePct: item?.metadata?.changePct ?? null,
      aliases: radarAliases(item.entityName),
      leaders: [],
      matchedEtfs: [],
      sources: ["stockeasy_normalized"],
    }));
}

function ecoreportRadar({ dashboard, decisionFeatures, normalizedKisEtf, normalizedTechnical, rotationWatch }) {
  const items = [];
  for (const item of array(rotationWatch?.rotationTargets?.watch ?? dashboard?.rotationWatch?.rotationTargets?.watch)) {
    items.push({
      sector: item.sector,
      score: Math.min(100, Math.round(number(item.score))),
      rsScore: Math.round(number(item.confidence) * 100),
      label: item.verdict ?? "로테이션 감시",
      action: item.action ?? "조건대기",
      changePct: null,
      aliases: radarAliases(item.sector),
      leaders: [],
      matchedEtfs: array(item.representative).slice(0, 5).map((rep) => ({
        code: rep.code ?? null,
        name: rep.name ?? null,
        held: true,
        score: rep.score ?? null,
        reasons: [item.sector],
      })),
      sources: ["rotation_watch"],
    });
  }

  for (const item of array(rotationWatch?.portfolioImplications?.emergingThemes ?? dashboard?.rotationWatch?.portfolioImplications?.emergingThemes)) {
    items.push({
      sector: item.theme ?? item.sector,
      score: Math.min(100, Math.max(35, Math.round(55 + number(item.momentum) / 2))),
      rsScore: Math.min(100, Math.max(40, Math.round(Math.abs(number(item.momentum)) + 45))),
      label: item.status ?? "테마 부상",
      action: item.action ?? "후보화",
      changePct: null,
      aliases: radarAliases(`${item.theme ?? ""} ${item.sector ?? ""} ${item.subTheme ?? ""}`),
      leaders: [],
      matchedEtfs: [],
      sources: ["rotation_theme"],
    });
  }

  for (const item of array(decisionFeatures?.themeFeatures)) {
    const supportTotal = Object.values(item?.support ?? {}).reduce((sum, value) => sum + Math.max(0, number(value)), 0);
    if (supportTotal <= 0) continue;
    items.push({
      sector: item.theme,
      score: Math.min(100, Math.round(45 + supportTotal * 25 + Math.max(0, number(item.netScore)) * 100)),
      rsScore: Math.min(100, Math.round(45 + number(item.sourceCount) * 12)),
      label: item.sourceCount >= 2 ? "교차근거" : "단일근거",
      action: item.netScore >= 0 ? "후보화" : "관찰",
      changePct: null,
      aliases: radarAliases(item.theme),
      leaders: [],
      matchedEtfs: [],
      sources: ["decision_features"],
    });
  }

  for (const item of array(normalizedKisEtf?.observations).slice(0, 40)) {
    if (item?.direction !== "positive") continue;
    items.push({
      sector: item.entityName,
      score: Math.min(100, Math.round(number(item.strength) * 100)),
      rsScore: Math.min(100, Math.round(number(item.confidence) * 100)),
      label: "KIS ETF 상승",
      action: "ETF 후보",
      changePct: item?.metadata?.changePct ?? null,
      aliases: radarAliases(`${item.entityName} ${array(item.themes).join(" ")}`),
      leaders: [],
      matchedEtfs: [{
        code: item.securityCode ?? null,
        name: item.entityName,
        held: false,
        score: Math.round(number(item.strength) * 100),
        reasons: array(item.themes).slice(0, 5),
      }],
      sources: ["kis_etf"],
    });
  }

  for (const item of array(normalizedTechnical?.observations)) {
    if (!["positive", "neutral"].includes(item?.direction)) continue;
    const score = number(item?.metadata?.score, number(item.strength) * 100);
    if (score < 70) continue;
    items.push({
      sector: item.category ?? item.entityName,
      score: Math.min(100, Math.round(score)),
      rsScore: Math.min(100, Math.round(number(item.confidence) * 100)),
      label: item?.metadata?.signal ?? "기술 강세",
      action: number(item?.metadata?.rsi) >= 80 ? "과열주의" : "기술확인",
      changePct: item?.metadata?.changePct ?? null,
      aliases: radarAliases(`${item.category ?? ""} ${array(item.themes).join(" ")} ${item.entityName ?? ""}`),
      leaders: [{ name: item.entityName, score }],
      matchedEtfs: [{
        code: item.securityCode ?? null,
        name: item.entityName,
        held: Boolean(item?.metadata?.inPortfolio),
        score,
        reasons: array(item.themes).slice(0, 5),
      }],
      sources: ["technical"],
    });
  }

  return items;
}

function mergeRadarItems(items) {
  const byKey = new Map();
  for (const item of items.filter((entry) => text(entry?.sector))) {
    const key = text(item.sector).replace(/\s+/g, "").toLowerCase();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...item });
      continue;
    }
    prev.score = Math.max(number(prev.score), number(item.score));
    prev.rsScore = Math.max(number(prev.rsScore), number(item.rsScore));
    prev.aliases = [...new Set([...array(prev.aliases), ...array(item.aliases)])];
    prev.leaders = [...array(prev.leaders), ...array(item.leaders)].slice(0, 8);
    prev.matchedEtfs = [...array(prev.matchedEtfs), ...array(item.matchedEtfs)].slice(0, 8);
    prev.sources = [...new Set([...array(prev.sources), ...array(item.sources)])];
    if (!prev.label || prev.score <= item.score) prev.label = item.label;
    if (!prev.action || prev.score <= item.score) prev.action = item.action;
  }
  return [...byKey.values()].sort((a, b) => {
    const sourceBonus = array(b.sources).length - array(a.sources).length;
    return number(b.score) - number(a.score) || sourceBonus;
  });
}

function buildRadar(context) {
  const stockeasy = stockeasyRadar(context.dashboard, context.stockeasySnapshot, context.ignoreStockeasy);
  const normalized = normalizedSectorRadar(context.normalizedStockeasy, context.ignoreStockeasy);
  const internal = ecoreportRadar(context);
  const items = mergeRadarItems([...stockeasy, ...normalized, ...internal]).slice(0, 16);
  const sourceCounts = {};
  for (const item of items) {
    for (const source of array(item.sources)) sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }
  return {
    label: stockeasy.length > 0 ? "hybrid_with_stockeasy" : "ecoreport_independent",
    stockeasyDependent: stockeasy.length > 0 || normalized.length > 0,
    sourceCounts,
    items,
  };
}

function keywordSet(item) {
  return new Set(
    [
      item?.sector,
      item?.category,
      item?.name,
      ...array(item?.aliases),
      ...array(item?.reasons),
      ...array(item?.leaders).map((leader) => leader?.name),
    ]
      .map((value) => text(value).replace(/\s+/g, "").toLowerCase())
      .filter(Boolean),
  );
}

function sectorMatchScore(holding, sector) {
  const holdingTokens = keywordSet({
    sector: holding?.category,
    category: holding?.category,
    name: holding?.name,
    aliases: [
      ...(holding?.fundamental?.etf?.keywords ?? []),
      ...(holding?.fundamental?.etf?.sectors ?? []),
      ...(holding?.attractiveness?.drivers ?? []),
    ],
  });
  const sectorTokens = keywordSet({ ...sector, leaders: [] });
  if (holdingTokens.size === 0 || sectorTokens.size === 0) return 0;

  let score = 0;
  for (const h of holdingTokens) {
    for (const s of sectorTokens) {
      if (h === s) score += 4;
      else if (h.length >= 3 && s.length >= 3 && (h.includes(s) || s.includes(h))) score += 2;
    }
  }
  return Math.min(12, score);
}

function buildActualHoldingKeys(portfolio) {
  const keys = new Set();
  for (const account of array(portfolio?.accounts)) {
    for (const holding of array(account?.holdings)) {
      if (account?.key && holding?.code) keys.add(`${account.key}:${holding.code}`);
    }
  }
  return keys;
}

function accountRows(dashboard, sectors, portfolio) {
  const accountMeta = new Map(array(dashboard?.portfolio?.accounts).map((account) => [account.accountKey, account]));
  const byAccount = new Map();
  const actualHoldingKeys = buildActualHoldingKeys(portfolio);

  for (const holding of array(dashboard?.holdings)) {
    if (!holding?.accountKey) continue;
    const rows = byAccount.get(holding.accountKey) ?? [];
    rows.push(holding);
    byAccount.set(holding.accountKey, rows);
  }

  return [...byAccount.entries()].map(([accountKey, holdings]) => {
    const meta = accountMeta.get(accountKey) ?? {};
    const totalValue = number(meta.totalValue) || holdings.reduce((sum, item) => sum + number(item?.position?.marketValue), 0);
    const buckets = {};
    for (const item of holdings) {
      const bucket = item?.decision?.bucket ?? "UNKNOWN";
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }

    const matchedHoldings = holdings
      .map((holding) => {
        const matches = sectors
          .map((sector) => ({ sector, score: sectorMatchScore(holding, sector) }))
          .filter((match) => match.score > 0)
          .sort((a, b) => b.score - a.score);
        return {
          holding,
          bestSector: matches[0]?.sector ?? null,
          matchScore: matches[0]?.score ?? 0,
        };
      })
      .filter((item) => {
        const key = `${item.holding?.accountKey}:${item.holding?.code}`;
        return item.matchScore > 0 && actualHoldingKeys.has(key) && number(item.holding?.position?.marketValue) > 0;
      });

    const matchedExposure = matchedHoldings.reduce(
      (sum, item) => sum + number(item.holding?.position?.marketValue),
      0,
    );
    const protectCount = holdings.filter((item) =>
      ["HOLD_PROTECT", "TRIM_REVIEW"].includes(item?.decision?.bucket),
    ).length;
    const blockedCount = holdings.filter((item) => item?.decision?.bucket === "BLOCKED_BUY").length;
    const watchCount = holdings.filter((item) => String(item?.decision?.bucket ?? "").includes("WATCH")).length;
    const supportValues = holdings.flatMap((item) => Object.values(item?.sourceSupport ?? {}).map((value) => number(value)));
    const evidenceScore =
      supportValues.length > 0
        ? Math.min(100, Math.round((supportValues.reduce((sum, value) => sum + Math.max(0, value), 0) / supportValues.length) * 220))
        : 0;
    const matchScore = Math.min(100, Math.round((matchedExposure / Math.max(1, totalValue)) * 120));
    const actionScore = Math.max(0, 100 - protectCount * 12 - blockedCount * 4 + watchCount * 3);
    const stageScore = number(meta.stage4Score, dashboard?.portfolio?.score ?? 0);
    const proofScore = Math.max(
      0,
      Math.min(100, Math.round(stageScore * 0.32 + evidenceScore * 0.22 + matchScore * 0.28 + actionScore * 0.18)),
    );
    const hasConflict = protectCount > 0 || blockedCount > holdings.length / 2;
    const topMatches = matchedHoldings
      .sort((a, b) => number(b.holding?.position?.marketValue) - number(a.holding?.position?.marketValue))
      .slice(0, 5)
      .map((item) => ({
        code: item.holding.code,
        name: item.holding.name,
        category: item.holding.category ?? null,
        marketValue: number(item.holding?.position?.marketValue),
        profitRate: item.holding?.position?.profitRate ?? null,
        decision: item.holding?.decision?.label ?? null,
        sector: item.bestSector?.sector ?? null,
        sectorScore: item.bestSector?.score ?? null,
      }));

    const redFlags = holdings
      .filter((item) => array(item?.riskFlags).length > 0 || ["TRIM_REVIEW", "BLOCKED_BUY"].includes(item?.decision?.bucket))
      .slice(0, 7)
      .map((item) => ({
        code: item.code,
        name: item.name,
        decision: item?.decision?.label ?? null,
        flags: array(item?.riskFlags).slice(0, 3),
        reason: compact(item?.trimConditions?.[0] ?? item?.addConditions?.[0] ?? item?.thesis, 140),
      }));

    return {
      accountKey,
      accountLabel: meta.accountLabel ?? holdings[0]?.accountLabel ?? accountKey,
      totalValue,
      cash: number(meta.cash),
      stage4Score: meta.stage4Score ?? null,
      deployBudget: meta.deployBudget ?? null,
      proofScore,
      tone: toneFromScore(proofScore),
      verdict: verdictFromScore(proofScore, hasConflict),
      buckets,
      matchedExposure,
      matchedExposurePct: round((matchedExposure / Math.max(1, totalValue)) * 100, 1),
      topThemes: array(meta.topThemes).slice(0, 6),
      topRisks: array(meta.topRisks).slice(0, 6),
      proof: [
        `자체 레이더와 겹치는 노출 ${won(matchedExposure)} (${round((matchedExposure / Math.max(1, totalValue)) * 100, 1)}%)`,
        `Stage4 계좌 점수 ${meta.stage4Score ?? "-"} / 실행 예산 ${won(meta.deployBudget)}`,
        protectCount > 0
          ? `수익보호·감량검토 ${protectCount}건이 있어 신규확대보다 방어 검증 우선`
          : `보호/감량 플래그가 낮아 방향성 검증 부담이 작음`,
        blockedCount > 0
          ? `매수제외 ${blockedCount}건: 방향은 맞아도 가격·근거·검증 조건이 아직 미통과`
          : `매수 차단 플래그 없음`,
      ],
      topMatches,
      redFlags,
    };
  });
}

function buildSummary({ posture, accounts }) {
  const avgProof =
    accounts.length > 0 ? Math.round(accounts.reduce((sum, account) => sum + account.proofScore, 0) / accounts.length) : 0;
  const strong = accounts.filter((account) => account.proofScore >= 56).length;
  const weak = accounts.filter((account) => account.proofScore < 42).length;
  const direction =
    posture.stance === "보호우선"
      ? "보유 수익 보호와 신규매수 차단 조건 검증"
      : posture.stance === "선별위험선호"
        ? "강한 섹터만 조건부 분할 후보화"
        : "중립 관찰과 계좌별 근거 보강";

  return {
    proofScore: avgProof,
    tone: toneFromScore(avgProof),
    verdict: verdictFromScore(avgProof, weak > strong),
    direction,
    accountCount: accounts.length,
    strongAccountCount: strong,
    weakAccountCount: weak,
  };
}

function buildMarkdown(proof) {
  const external = proof.market.externalSignal ?? {};
  const lines = [
    `# StockPilot Proof ${proof.date}`,
    "",
    `- 결론: ${proof.summary.verdict}`,
    `- 투자 방향: ${proof.summary.direction}`,
    `- 평균 증명 점수: ${proof.summary.proofScore}`,
    `- 시장 자세: ${proof.market.stance} / ${proof.market.mode ?? "-"}`,
    `- 다음 행동: ${proof.market.nextAction}`,
    "",
    "## 시장 레이더",
    "",
    `- 레이더 모드: ${proof.radar.label}`,
    `- StockEasy 의존 여부: ${proof.radar.stockeasyDependent ? "일부 사용" : "미사용/독립모드"}`,
    `- 외부 단기/장기: ${external.short ?? "-"} / ${external.long ?? "-"}`,
    `- 외부 전략 Bias: ${external.strategyBias ?? "-"} (risk-on ${external.riskOnCount ?? 0}개)`,
    `- KOSPI: ${external.kospi?.statusLabel ?? "-"} / 권장 ${external.kospi?.recommendedExposure ?? "-"}`,
    `- KOSDAQ: ${external.kosdaq?.statusLabel ?? "-"} / 권장 ${external.kosdaq?.recommendedExposure ?? "-"}`,
    "",
    "## 강한 섹터",
    "",
    ...proof.radar.items.slice(0, 8).map((sector) => `- ${sector.sector}: 점수 ${sector.score}, RS ${sector.rsScore}, ${sector.label ?? "-"} / ${sector.action ?? "-"} / sources=${array(sector.sources).join("+")}`),
    "",
    "## 계좌별 증명",
    "",
  ];

  for (const account of proof.accounts) {
    lines.push(`### ${account.accountLabel}`);
    lines.push("");
    lines.push(`- 판정: ${account.verdict} (${account.proofScore}점)`);
    lines.push(`- 자체 레이더 겹침: ${won(account.matchedExposure)} (${pct(account.matchedExposurePct)})`);
    lines.push(`- 실행 예산: ${won(account.deployBudget)} / 현금 ${won(account.cash)}`);
    for (const item of account.proof) lines.push(`- ${item}`);
    if (account.topMatches.length > 0) {
      lines.push("");
      lines.push("대표 겹침:");
      for (const item of account.topMatches) {
        lines.push(`- ${item.name}: ${item.sector} / ${item.decision ?? "-"} / 손익 ${pct(item.profitRate)}`);
      }
    }
    if (account.redFlags.length > 0) {
      lines.push("");
      lines.push("주의 플래그:");
      for (const item of account.redFlags.slice(0, 4)) {
        lines.push(`- ${item.name}: ${item.decision ?? "-"} / ${item.reason}`);
      }
    }
    lines.push("");
  }

  lines.push("## 산출물");
  lines.push("");
  for (const [key, value] of Object.entries(proof.artifacts)) {
    lines.push(`- ${key}: \`${value}\``);
  }
  lines.push("");
  lines.push("> StockEasy가 사라지거나 유료화되어도 EcoReport normalized/KIS ETF/기술/로테이션 데이터만으로 독립 레이더를 계속 생성하도록 설계했습니다.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeJson(relativePath, data) {
  const filePath = path.join(ROOT_DIR, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(relativePath, data) {
  const filePath = path.join(ROOT_DIR, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

async function main() {
  const args = parseArgs(process.argv);
  const date = args.date ?? (await latestDate());
  const ignoreStockeasy = Boolean(args["ignore-stockeasy"] ?? args.independent);
  if (!date) {
    throw new Error("No analysis date found.");
  }

  const dashboard = await readJson(`data/dashboard/${date}-dashboard-view.json`, {});
  const stockeasySnapshot = ignoreStockeasy ? {} : await readJson(`data/external/stockeasy/${date}/snapshot.json`, {});
  const portfolio = await readJson("data/portfolio/latest.json", {});
  const stage4 = await readJson(`data/analysis-state/${date}/stage4-execution-plan.json`, {});
  const rotationWatch = await readJson(`data/analysis-state/${date}/rotation-watch.json`, {});
  const stockPulse = await readJson(`data/stock-pulse/${date}/stock-pulse.json`, {});
  const decisionFeatures = await readJson(`data/features/${date}/decision-features.json`, {});
  const normalizedStockeasy = ignoreStockeasy ? {} : await readJson(`data/normalized/${date}/stockeasy.normalized.json`, {});
  const normalizedKisEtf = await readJson(`data/normalized/${date}/kis_etf.normalized.json`, {});
  const normalizedTechnical = await readJson(`data/normalized/${date}/technical.normalized.json`, {});

  const mergedDashboard = {
    ...dashboard,
    stockeasyPulse: ignoreStockeasy ? null : dashboard.stockeasyPulse,
    rotationWatch: dashboard.rotationWatch ?? rotationWatch,
  };
  const posture = marketPosture({ dashboard: mergedDashboard, stockeasySnapshot, decisionFeatures, ignoreStockeasy });
  const radar = buildRadar({
    dashboard: mergedDashboard,
    stockeasySnapshot,
    decisionFeatures,
    normalizedStockeasy,
    normalizedKisEtf,
    normalizedTechnical,
    rotationWatch: mergedDashboard.rotationWatch ?? rotationWatch,
    ignoreStockeasy,
  });
  const accounts = accountRows(mergedDashboard, radar.items, portfolio);
  const summary = buildSummary({ posture, accounts });
  const generatedAt = new Date().toISOString();

  const proof = {
    version: "stockpilot-proof.v0.2",
    date,
    generatedAt,
    summary,
    market: posture,
    radar,
    stockeasySectors: radar.items,
    accounts,
    sourceStatus: {
      dashboardView: Boolean(dashboard?.meta),
      portfolioAccounts: array(portfolio?.accounts).length,
      stockeasySnapshot: !ignoreStockeasy && Boolean(stockeasySnapshot?.marketAnalysis || stockeasySnapshot?.strategyRoom),
      stockeasyOptional: true,
      independentMode: ignoreStockeasy || !sourceAvailable(stockeasySnapshot),
      stage4AccountPlans: array(stage4?.accountPlans).length,
      rotationWatch: Boolean(rotationWatch?.summary ?? dashboard?.rotationWatch?.summary),
      stockPulse: Boolean(stockPulse?.summary ?? dashboard?.stockPulse),
      decisionFeatures: Boolean(decisionFeatures?.themeFeatures),
      normalizedKisEtf: array(normalizedKisEtf?.observations).length,
      normalizedTechnical: array(normalizedTechnical?.observations).length,
    },
    artifacts: {
      dashboardView: `data/dashboard/${date}-dashboard-view.json`,
      stockeasySnapshot: `data/external/stockeasy/${date}/snapshot.json`,
      decisionFeatures: `data/features/${date}/decision-features.json`,
      normalizedKisEtf: `data/normalized/${date}/kis_etf.normalized.json`,
      normalizedTechnical: `data/normalized/${date}/technical.normalized.json`,
      portfolio: "data/portfolio/latest.json",
      stage4: `data/analysis-state/${date}/stage4-execution-plan.json`,
      rotationWatch: `data/analysis-state/${date}/rotation-watch.json`,
      stockPulse: `data/stock-pulse/${date}/stock-pulse.json`,
    },
    disclaimer:
      "Independent account-direction proof built from owned/public observations. StockEasy is optional; private APIs, protected UI, and protected content are not required.",
  };

  const jsonPath = ignoreStockeasy
    ? `data/stockpilot-proof/${date}/account-direction-proof-independent.json`
    : `data/stockpilot-proof/${date}/account-direction-proof.json`;
  const latestPath = ignoreStockeasy
    ? "data/stockpilot-proof/latest-account-direction-proof-independent.json"
    : "data/stockpilot-proof/latest-account-direction-proof.json";
  const markdownPath = ignoreStockeasy
    ? `reports/daily/${date}-stockpilot-proof-independent.md`
    : `reports/daily/${date}-stockpilot-proof.md`;

  await writeJson(jsonPath, proof);
  await writeJson(latestPath, proof);
  await writeText(markdownPath, buildMarkdown(proof));

  console.log(
    JSON.stringify(
      {
        status: "ok",
        date,
        proofScore: summary.proofScore,
        verdict: summary.verdict,
        radarMode: radar.label,
        radarSources: radar.sourceCounts,
        json: jsonPath,
        markdown: markdownPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
