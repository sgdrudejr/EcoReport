import { readRepoJsonFile } from "@/lib/repo-artifacts";
import type { StockeasySnapshot } from "@/lib/stockeasy";

type StockeasyEtfMapEntry = {
  code: string;
  name: string;
  sectors?: string[];
  keywords?: string[];
  stocks?: string[];
  rationale?: string | null;
};

type StockeasyEtfMap = {
  version: number;
  source?: string;
  updatedAt?: string;
  etfs: StockeasyEtfMapEntry[];
};

export type StockeasyEtfCandidate = {
  code: string;
  name: string;
  finalScore: number;
  status: "candidate" | "watch";
  matchedThemes: string[];
  matchedSectors: string[];
  matchedStocks: string[];
  matchedHeadlines: string[];
  reason: string;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesKeyword(target: string, keyword: string) {
  return target.includes(normalize(keyword));
}

function loadStockeasyEtfMap() {
  return readRepoJsonFile<StockeasyEtfMap>("data/reference/stockeasy-theme-etf-map.json");
}

export function deriveStockeasyEtfCandidates(snapshot: StockeasySnapshot | null | undefined) {
  const map = loadStockeasyEtfMap();
  if (!snapshot || !map?.etfs?.length) return [];

  const sectors = snapshot.stockAnalysis?.sectorRs ?? [];
  const leaders = snapshot.stockAnalysis?.stockLeaders ?? [];
  const themes = snapshot.marketThemes?.themes ?? [];
  const headlines = (snapshot.home?.topTimeline ?? [])
    .map((item) => item.headline)
    .filter((headline): headline is string => Boolean(headline));

  const normalizedHeadlines = headlines.map((item) => normalize(item));

  const candidates = map.etfs
    .map<StockeasyEtfCandidate | null>((etf) => {
      const matchedSectors = sectors.filter((sector) =>
        (etf.sectors ?? []).some((alias) => normalize(alias) === normalize(sector.sector)),
      );
      const matchedThemes = themes.filter((theme) =>
        (etf.sectors ?? []).some((alias) => includesKeyword(theme.name, alias)) ||
        (etf.keywords ?? []).some((keyword) => includesKeyword(theme.name, keyword)),
      );
      const matchedStocks = leaders.filter((leader) =>
        (etf.stocks ?? []).some((stockName) => normalize(stockName) === normalize(leader.name)),
      );
      const matchedThemeStocks = matchedThemes.flatMap((theme) => theme.leaders ?? []);
      const matchedThemeStockNames = matchedThemeStocks
        .filter((leader) =>
          (etf.stocks ?? []).some((stockName) => normalize(stockName) === normalize(leader.name)),
        )
        .map((leader) => leader.name);
      const matchedHeadlines = headlines.filter((headline, index) =>
        (etf.keywords ?? []).some((keyword) => includesKeyword(normalizedHeadlines[index], keyword)),
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

      const reasonBits = [
        matchedThemes.length ? `테마 ${matchedThemes.map((item) => item.name).join(", ")}` : null,
        matchedSectors.length
          ? `섹터 ${matchedSectors.map((item) => `${item.sector} ${item.score}`).join(", ")}`
          : null,
        [...matchedStocks.map((item) => item.name), ...matchedThemeStockNames].length
          ? `대표 종목 ${[...new Set([...matchedStocks.map((item) => item.name), ...matchedThemeStockNames])]
              .slice(0, 4)
              .join(", ")}`
          : null,
        matchedHeadlines.length ? `시황 키워드 ${matchedHeadlines.slice(0, 2).join(" / ")}` : null,
      ].filter(Boolean);

      return {
        code: etf.code,
        name: etf.name,
        finalScore,
        status: finalScore >= 55 ? "candidate" : "watch",
        matchedThemes: matchedThemes.map((item) => item.name),
        matchedSectors: matchedSectors.map((item) => item.sector),
        matchedStocks: [...new Set([...matchedStocks.map((item) => item.name), ...matchedThemeStockNames])],
        matchedHeadlines: matchedHeadlines.slice(0, 2),
        reason: reasonBits.join(" · ") || etf.rationale || "외부 강세축과 연결되는 ETF 후보입니다.",
      };
    })
    .filter((item): item is StockeasyEtfCandidate => Boolean(item))
    .sort((left, right) => right.finalScore - left.finalScore);

  return candidates;
}
