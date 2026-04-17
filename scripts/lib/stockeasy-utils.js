import path from "node:path";

import {
  ROOT_DIR,
  buildPortfolioMaps,
  normalizeLooseName,
  normalizeText,
  readJson,
} from "./pipeline-utils.js";

function sanitizeNonNegativeCount(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.round(Math.abs(value)));
}

function stockeasyStrategyBias(strategy) {
  const buys = sanitizeNonNegativeCount(strategy?.todayBuyCount) ?? 0;
  const exits = sanitizeNonNegativeCount(strategy?.todayExitCount) ?? 0;
  const pulseScore =
    (strategy?.dayDeltaPct ?? 0) * 0.6 +
    (strategy?.weekDeltaPct ?? 0) * 0.35 +
    buys * 4 -
    exits * 3;

  if (pulseScore >= 10) return "risk-on";
  if (pulseScore <= -4) return "cooling";
  return "selective";
}

function stockeasyStrategyBiasLabel(bias) {
  switch (bias) {
    case "risk-on":
      return "공격 열림";
    case "cooling":
      return "과열 식힘";
    default:
      return "선별 대응";
  }
}

function includesKeyword(target, keyword) {
  return normalizeText(target).includes(normalizeText(keyword));
}

function buildSnapshotPath(date) {
  return path.join(ROOT_DIR, "data", "external", "stockeasy", date, "snapshot.json");
}

export async function loadStockeasySnapshot(date) {
  const snapshot = await readJson(buildSnapshotPath(date), null);
  return snapshot?.source === "stockeasy" ? snapshot : null;
}

async function loadStockeasyEtfMap() {
  return readJson(path.join(ROOT_DIR, "data", "reference", "stockeasy-theme-etf-map.json"), {
    etfs: [],
  });
}

export async function deriveStockeasyEtfCandidates(snapshot) {
  const map = await loadStockeasyEtfMap();
  if (!snapshot || !Array.isArray(map?.etfs) || map.etfs.length === 0) {
    return [];
  }

  const sectors = snapshot.stockAnalysis?.sectorRs ?? [];
  const leaders = snapshot.stockAnalysis?.stockLeaders ?? [];
  const themes = snapshot.marketThemes?.themes ?? [];
  const headlines = (snapshot.home?.topTimeline ?? [])
    .map((item) => item?.headline)
    .filter(Boolean);

  return map.etfs
    .map((etf) => {
      const matchedSectors = sectors.filter((sector) =>
        (etf.sectors ?? []).some((alias) => normalizeText(alias) === normalizeText(sector.sector)),
      );
      const matchedThemes = themes.filter((theme) =>
        (etf.sectors ?? []).some((alias) => includesKeyword(theme.name, alias)) ||
        (etf.keywords ?? []).some((keyword) => includesKeyword(theme.name, keyword)),
      );
      const matchedStocks = leaders.filter((leader) =>
        (etf.stocks ?? []).some((stockName) => normalizeText(stockName) === normalizeText(leader.name)),
      );
      const matchedThemeStocks = matchedThemes.flatMap((theme) => theme.leaders ?? []);
      const matchedThemeStockNames = matchedThemeStocks
        .filter((leader) =>
          (etf.stocks ?? []).some((stockName) => normalizeText(stockName) === normalizeText(leader.name)),
        )
        .map((leader) => leader.name);
      const matchedHeadlines = headlines.filter((headline) =>
        (etf.keywords ?? []).some((keyword) => includesKeyword(headline, keyword)),
      );

      const sectorScore = matchedSectors.reduce(
        (total, sector) => total + Math.max(0, 36 - (sector.rank - 1) * 5) + Math.round(sector.score / 8),
        0,
      );
      const themeScore = matchedThemes.reduce(
        (total, theme) => total + Math.max(0, 28 - ((theme.rank ?? 6) - 1) * 4),
        0,
      );
      const stockScore = matchedStocks.reduce(
        (total, leader) =>
          total +
          Math.max(0, Math.round((leader.rs ?? 0) / 2.5)) +
          Math.max(0, Math.round((leader.changePct ?? 0) * 1.6)),
        0,
      );
      const headlineScore = Math.min(24, matchedHeadlines.length * 8);
      const finalScore = Math.max(0, Math.min(99, sectorScore + themeScore + stockScore + headlineScore));

      if (finalScore <= 0) return null;

      return {
        code: etf.code,
        name: etf.name,
        finalScore,
        status: finalScore >= 55 ? "candidate" : "watch",
        matchedThemes: matchedThemes.map((item) => item.name),
        matchedSectors: matchedSectors.map((item) => item.sector),
        matchedStocks: [...new Set([...matchedStocks.map((item) => item.name), ...matchedThemeStockNames])],
        matchedHeadlines: matchedHeadlines.slice(0, 2),
        reason:
          [
            matchedThemes.length ? `테마 ${matchedThemes.map((item) => item.name).join(", ")}` : null,
            matchedSectors.length
              ? `섹터 ${matchedSectors.map((item) => `${item.sector} ${item.score}`).join(", ")}`
              : null,
            matchedStocks.length ? `대표 종목 ${matchedStocks.map((item) => item.name).slice(0, 4).join(", ")}` : null,
            matchedHeadlines.length ? `시황 ${matchedHeadlines.slice(0, 2).join(" / ")}` : null,
            etf.rationale ?? null,
          ]
            .filter(Boolean)
            .join(" · "),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.finalScore - left.finalScore);
}

function leaderMatchesHolding(leader, holding) {
  if (!leader || !holding) return false;
  if (leader.code && holding.code && String(leader.code) === String(holding.code)) {
    return true;
  }

  return normalizeLooseName(leader.name) === normalizeLooseName(holding.name);
}

function formatExposureLine(label, block) {
  if (!block) return `- ${label}: 데이터 없음`;
  return [
    `- ${label}: ${block.statusLabel ?? "N/A"}`,
    `노출 ${block.recommendedExposure ?? "N/A"}`,
    `분산일 ${block.distributionDays ?? "N/A"}`,
    `FTD ${block.lastFollowThroughDay ?? "N/A"}`,
  ].join(" / ");
}

function formatStrategyPulse(strategy) {
  const bias = stockeasyStrategyBias(strategy);
  return {
    ...strategy,
    todayBuyCount: sanitizeNonNegativeCount(strategy.todayBuyCount),
    todayExitCount: sanitizeNonNegativeCount(strategy.todayExitCount),
    holdingCount: sanitizeNonNegativeCount(strategy.holdingCount),
    bias,
    biasLabel: stockeasyStrategyBiasLabel(bias),
  };
}

function formatAccountBridgeLines(portfolio, watchlist, leaders, etfCandidates) {
  const accounts = portfolio?.accounts ?? [];
  if (accounts.length === 0) {
    return ["- 최신 포트폴리오 계좌 데이터가 없어 계좌별 연결은 생략합니다."];
  }

  const portfolioMaps = buildPortfolioMaps(portfolio, watchlist);
  const lines = [];

  for (const account of accounts) {
    const holdings = account?.holdings ?? [];
    const matchedLeaders = leaders.filter((leader) =>
      holdings.some((holding) => leaderMatchesHolding(leader, holding)),
    );
    const candidateEtfs = etfCandidates.filter((candidate) => {
      const matchedStock = holdings.some((holding) =>
        (candidate.matchedStocks ?? []).some(
          (name) => normalizeLooseName(name) === normalizeLooseName(holding.name),
        ),
      );
      const matchedWatch = (candidate.code && portfolioMaps.watchByCode.has(candidate.code)) || false;
      return matchedStock || matchedWatch;
    });

    lines.push(`### ${account.label ?? account.key ?? "계좌"} (${account.key ?? "N/A"})`);
    lines.push(
      matchedLeaders.length > 0
        ? `- 외부 강세 종목 교집합: ${matchedLeaders
            .slice(0, 4)
            .map((item) => `${item.name}(${item.code})`)
            .join(", ")}`
        : "- 외부 강세 종목 교집합: 직접 일치 없음",
    );
    lines.push(
      candidateEtfs.length > 0
        ? `- 번역 ETF 후보: ${candidateEtfs
            .slice(0, 2)
            .map((item) => `${item.name}(${item.code}) ${item.finalScore}점`)
            .join(", ")}`
        : "- 번역 ETF 후보: 직접 연결 없음",
    );
  }

  return lines;
}

export async function formatStockeasyForPrompt({
  date,
  portfolio = null,
  watchlist = null,
  maxSectors = 5,
  maxThemes = 4,
  maxLeaders = 6,
  maxStrategies = 3,
  maxTimeline = 4,
} = {}) {
  const snapshot = await loadStockeasySnapshot(date);
  if (!snapshot) {
    return "- StockEasy snapshot이 없습니다.";
  }

  const topSectors = (snapshot.stockAnalysis?.sectorRs ?? []).slice(0, maxSectors);
  const topThemes = (snapshot.marketAnalysis?.themeBoard?.themes ?? snapshot.marketThemes?.themes ?? []).slice(
    0,
    maxThemes,
  );
  const topLeaders = (
    snapshot.stockAnalysis?.promisingSectorTop100?.length
      ? snapshot.stockAnalysis?.promisingSectorTop100
      : snapshot.stockAnalysis?.stockLeaders ?? []
  ).slice(0, maxLeaders);
  const strategyPulse = (snapshot.strategyRoom?.strategies ?? [])
    .slice(0, maxStrategies)
    .map(formatStrategyPulse);
  const topTimeline = (snapshot.home?.topTimeline ?? []).slice(0, maxTimeline);
  const etfCandidates = (await deriveStockeasyEtfCandidates(snapshot)).slice(0, 4);
  const sectorPulse = (snapshot.marketAnalysis?.sectors?.rows ?? []).slice(0, 5);
  const leadingPulse = (snapshot.marketAnalysis?.leadingSectors?.rows ?? []).slice(0, 5);
  const industryReports = (snapshot.stockAnalysis?.reports?.industry?.rows ?? []).slice(0, 5);

  const lines = [
    "## StockEasy 메타",
    `- 외부 기준일: ${snapshot.sourceTradingDate ?? snapshot.captureDate ?? "N/A"} (${snapshot.sourceTradingDateLabel ?? "라벨 없음"})`,
    `- 수집 시각: ${snapshot.capturedAt ?? "N/A"}`,
    `- 시장 업데이트: ${snapshot.marketSignal?.updatedAtLabel ?? snapshot.marketThemes?.updatedAtLabel ?? "N/A"}`,
    "",
    "## 시장신호 / 타임라인",
    `- 단기/장기 신호: ${snapshot.marketSignal?.shortSignal ?? "N/A"} / ${snapshot.marketSignal?.longSignal ?? "N/A"}`,
    formatExposureLine("코스피", snapshot.marketSignal?.kospi),
    formatExposureLine("코스닥", snapshot.marketSignal?.kosdaq),
  ];

  if (topTimeline.length > 0) {
    lines.push(
      `- 장중 타임라인: ${topTimeline.map((item) => `${item.time ?? "--"} ${item.headline ?? ""}`).join(" / ")}`,
    );
  }

  lines.push("", "## 강한 섹터 / 테마 / 종목");
  lines.push(
    topSectors.length > 0
      ? `- 상위 섹터 RS: ${topSectors.map((item) => `${item.sector} ${item.score}`).join(", ")}`
      : "- 상위 섹터 RS: 없음",
  );
  lines.push(
    sectorPulse.length > 0
      ? `- 시장분석 섹터: ${sectorPulse
          .map((item) => `${item.sector} ${item.position ?? "N/A"} / ${item.signal ?? "N/A"} / ${item.leaderLabel ?? "-"}`)
          .join(" / ")}`
      : "- 시장분석 섹터: 없음",
  );
  lines.push(
    leadingPulse.length > 0
      ? `- 추세유지: ${leadingPulse
          .map((item) => `${item.sector} ${item.holdDays ?? "N/A"}일 / ${item.returnPct ?? "N/A"}% / ${item.leaderLabel ?? "-"}`)
          .join(" / ")}`
      : "- 추세유지: 없음",
  );
  lines.push(
    topThemes.length > 0
      ? `- 테마보드 상위: ${topThemes
          .map((theme) => {
            const leaders = (theme.leaders ?? []).slice(0, 2).map((item) => item.name).join(", ");
            return `${theme.name}${leaders ? ` (${leaders})` : ""}`;
          })
          .join(" / ")}`
      : "- 테마보드 상위: 없음",
  );
  lines.push(
    topLeaders.length > 0
      ? `- 유망 섹터 종합RS: ${topLeaders
          .map((item) => `${item.name}(${item.code}) ${item.sector ?? "-"} RS ${item.rs ?? "-"}`)
          .join(" / ")}`
      : "- 유망 섹터 종합RS: 없음",
  );
  lines.push(
    industryReports.length > 0
      ? `- 산업리포트: ${industryReports
          .map((item) => `${item.sector ?? "기타"} / ${item.broker ?? "N/A"} / ${item.title ?? "N/A"}`)
          .join(" / ")}`
      : "- 산업리포트: 없음",
  );

  lines.push("", "## 전략실 Pulse");
  if (strategyPulse.length === 0) {
    lines.push("- 전략실 스냅샷 없음");
  } else {
    for (const strategy of strategyPulse) {
      lines.push(
        `- ${strategy.name}: ${strategy.biasLabel} / 스타일 ${strategy.style ?? "N/A"} / 일간 ${strategy.dayDeltaPct ?? "N/A"}% / 주간 ${strategy.weekDeltaPct ?? "N/A"}% / today buy ${strategy.todayBuyCount ?? "N/A"} / today exit ${strategy.todayExitCount ?? "N/A"}`,
      );
      if (strategy.description) {
        lines.push(`  설명: ${strategy.description}`);
      }
    }
  }

  lines.push("", "## 한국 상장 ETF 번역 후보");
  lines.push(
    etfCandidates.length > 0
      ? etfCandidates
          .map(
            (item) =>
              `- ${item.name}(${item.code}) ${item.finalScore}점 / ${item.status} / ${item.reason}`,
          )
          .join("\n")
      : "- 번역 ETF 후보 없음",
  );

  lines.push("", "## 계좌 연결 힌트");
  lines.push(...formatAccountBridgeLines(portfolio, watchlist, topLeaders, etfCandidates));
  lines.push(
    "",
    "## 활용 지침",
    "- 이 레이어는 외부 모멘텀/테마 확인용이다. 내부 리포트·딥리서치와 충돌하면 맹신하지 말고 검증 우선으로 내려라.",
    "- 다만 내부 논리와 StockEasy 강세축이 겹치면 계좌별 실행 우선순위와 설명 밀도를 높이는 데 적극 활용하라.",
  );

  return lines.join("\n");
}
