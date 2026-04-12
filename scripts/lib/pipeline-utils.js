import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { todayInSeoul } from "./trading-calendar.js";

function resolveRootDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ECOREPORT_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(moduleDir, "..", ".."),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      fsSync.existsSync(path.join(candidate, "config", "strategy.json")) &&
      fsSync.existsSync(path.join(candidate, "scripts"))
    ) {
      return candidate;
    }
  }

  return path.resolve(moduleDir, "..", "..");
}

export const ROOT_DIR = resolveRootDir();

// ─────────────────────────────────────────────────────────────────────────────
// Security Master: config/securities.json 을 Single Source of Truth로 사용.
// 이 파일을 직접 수정하지 말 것. 종목/카테고리 정보는 securities.json 에서만 관리.
// ─────────────────────────────────────────────────────────────────────────────
function loadSecuritiesSync() {
  const p = path.join(ROOT_DIR, "config", "securities.json");
  try {
    return JSON.parse(fsSync.readFileSync(p, "utf8"));
  } catch {
    return { securities: [], theme_category_rules: [] };
  }
}

const _sm = loadSecuritiesSync();

/** 전체 Security Master (raw JSON) */
export const SECURITIES_MASTER = _sm;

/** 코드 → Security 객체 빠른 조회 */
export const SECURITIES_BY_CODE = Object.fromEntries(
  (_sm.securities ?? []).map((s) => [s.code, s])
);

/**
 * 코드와 계좌 키로 카테고리 반환.
 * 기존 CATEGORY_BY_CODE[code]?.[accountKey] ?? CATEGORY_BY_CODE[code]?.default 를 대체.
 */
export function getCategory(code, accountKey) {
  const cats = SECURITIES_BY_CODE[code]?.categories ?? {};
  return (accountKey && cats[accountKey]) || cats.default || null;
}

/**
 * 카테고리 → 대표 종목명 (PREFERRED_LABEL_BY_CATEGORY 대체).
 * securities.json에서 해당 카테고리를 default로 갖는 첫 번째 종목명 반환.
 */
export function getPreferredLabel(category) {
  const sec = (_sm.securities ?? []).find(
    (s) => s.categories?.default === category || Object.values(s.categories ?? {}).includes(category)
  );
  return sec?.name ?? null;
}

// ─────────── Backward-Compatible exports (기존 import 코드 수정 불필요) ───────────
export const CATEGORY_BY_CODE = Object.fromEntries(
  (_sm.securities ?? [])
    .filter((s) => s.categories && Object.keys(s.categories).length > 0)
    .map((s) => [s.code, s.categories])
);

export const PREFERRED_LABEL_BY_CATEGORY = Object.fromEntries(
  (_sm.securities ?? []).flatMap((s) =>
    Object.values(s.categories ?? {}).map((cat) => [cat, s.name])
  )
);

export const HOLDING_TOPIC_HINTS = Object.fromEntries(
  (_sm.securities ?? [])
    .filter((s) => s.keywords?.topic_hints?.length > 0)
    .map((s) => [s.code, s.keywords.topic_hints])
);

// ─────────── New keyword helpers ───────────────────────────────────────────
/** 리포트 impact-map용 strict alias 목록 (코드 → alias[]) */
export const STRICT_ALIASES_BY_CODE = Object.fromEntries(
  (_sm.securities ?? [])
    .filter((s) => s.keywords?.aliases?.length > 0)
    .map((s) => [s.code, s.keywords.aliases])
);

/** 매크로 리포트 매칭 키워드 (Stage 1 macroSpecificMatches 대체) */
export const MACRO_KEYWORDS_BY_CODE = Object.fromEntries(
  (_sm.securities ?? [])
    .filter((s) => s.keywords?.macro?.length > 0)
    .map((s) => [s.code, s.keywords.macro])
);

/** 테마/섹터 키워드 (Stage 3 codeThemeKeywords 대체) */
export const THEME_KEYWORDS_BY_CODE = Object.fromEntries(
  (_sm.securities ?? [])
    .filter((s) => s.keywords?.theme?.length > 0)
    .map((s) => [s.code, s.keywords.theme])
);

/** Stage 1 테마/섹터 트리거 (thematicMatches 대체) */
export const THEMATIC_TRIGGERS_BY_CODE = Object.fromEntries(
  (_sm.securities ?? [])
    .filter((s) => s.thematic_triggers)
    .map((s) => [s.code, s.thematic_triggers])
);

/** Impact-map THEME_CATEGORY_RULES */
export const THEME_CATEGORY_RULES = _sm.theme_category_rules ?? [];

export function parseDateArgs(argv) {
  const defaultRunDate = todayInSeoul();
  const args = {
    date: defaultRunDate,
    runDate: defaultRunDate,
    effectiveMarketDate: null,
    runId: process.env.ECOREPORT_RUN_ID?.trim() || null,
    output: null,
    markdown: null,
    briefing: null,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--run-date" && argv[index + 1]) {
      args.runDate = argv[index + 1];
      index += 1;
    } else if (token === "--effective-market-date" && argv[index + 1]) {
      args.effectiveMarketDate = argv[index + 1];
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--run-id" && argv[index + 1]) {
      args.runId = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (token === "--markdown" && argv[index + 1]) {
      args.markdown = argv[index + 1];
      index += 1;
    } else if (token === "--briefing" && argv[index + 1]) {
      args.briefing = argv[index + 1];
      index += 1;
    } else if (token === "--force") {
      args.force = true;
    }
  }

  if (!args.effectiveMarketDate) {
    args.effectiveMarketDate = args.date;
  }

  return args;
}

export function createGeneratedAt() {
  return new Date().toISOString();
}

export function buildRunMetadata(args, overrides = {}) {
  return {
    date: overrides.date ?? args.date,
    runDate: overrides.runDate ?? args.runDate,
    effectiveMarketDate: overrides.effectiveMarketDate ?? args.effectiveMarketDate,
    runId: overrides.runId ?? args.runId ?? null,
    generatedAt: overrides.generatedAt ?? createGeneratedAt(),
  };
}

export function buildContractMetadata({
  version = "1.0",
  stage,
  generatedAt = createGeneratedAt(),
} = {}) {
  return {
    version,
    stage,
    generatedAt,
  };
}

export function withContract(payload, contract) {
  return {
    ...payload,
    _contract: buildContractMetadata(contract),
  };
}

export async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function readText(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, payload) {
  await ensureDir(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function writeText(filePath, payload) {
  await ensureDir(filePath);
  await fs.writeFile(filePath, payload, "utf8");
}

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLooseName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.\.\./g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function buildSecurityLookups() {
  const exact = new Map();
  const loose = new Map();

  function add(name, code) {
    if (!name || !code) return;
    exact.set(normalizeText(name), code);
    const looseKey = normalizeLooseName(name);
    if (looseKey) {
      loose.set(looseKey, code);
    }
  }

  for (const security of _sm.securities ?? []) {
    add(security.name, security.code);
    for (const alias of security.keywords?.aliases ?? []) {
      add(alias, security.code);
    }
  }

  return { exact, loose };
}

const SECURITY_LOOKUPS = buildSecurityLookups();

export function resolveSecurityCode(nameOrCode) {
  if (!nameOrCode) return null;
  const token = String(nameOrCode).trim();
  if (!token) return null;
  if (SECURITIES_BY_CODE[token]) return token;

  const exact = SECURITY_LOOKUPS.exact.get(normalizeText(token));
  if (exact) return exact;

  const looseKey = normalizeLooseName(token);
  const loose = SECURITY_LOOKUPS.loose.get(looseKey);
  if (loose) return loose;

  for (const [candidate, code] of SECURITY_LOOKUPS.loose.entries()) {
    if (!candidate || !looseKey) continue;
    if (candidate.startsWith(looseKey) || looseKey.startsWith(candidate)) {
      return code;
    }
  }

  return null;
}

export function resolveSecurityCodeFromCandidates(...values) {
  for (const value of values) {
    const resolved = resolveSecurityCode(value);
    if (resolved) return resolved;
  }
  return null;
}

export function enrichPortfolioWithSecurityCodes(portfolio) {
  if (!portfolio || !Array.isArray(portfolio.accounts)) {
    return portfolio;
  }

  return {
    ...portfolio,
    accounts: portfolio.accounts.map((account) => ({
      ...account,
      holdings: (account.holdings ?? []).map((holding) => {
        const resolvedCode = resolveSecurityCodeFromCandidates(holding.code, holding.name);
        return resolvedCode ? { ...holding, code: resolvedCode } : { ...holding };
      }),
    })),
  };
}

export function compactWhitespace(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isBoilerplateParagraph(value) {
  const text = compactWhitespace(value);
  const normalized = normalizeText(text);
  if (!text || text.length < 20) return true;
  const patterns = [
    /본 조사분석자료/,
    /투자자의 판단과 책임/,
    /정확성이나 완전성을 보장/,
    /법적 책임소재/,
    /동 자료는/,
    /당사는 .* 보장할 수 없/,
    /자료:.*증권/,
    /page\s+\d+/i,
    /eugene research center/i,
    /리서치센터가 신뢰할 수 있는 자료/i,
  ];
  if (patterns.some((pattern) => pattern.test(text))) return true;

  const hangulChars = (text.match(/[가-힣]/g) ?? []).length;
  const alphaNumChars = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const meaningfulChars = hangulChars + alphaNumChars;
  if (meaningfulChars < Math.max(10, text.length * 0.2)) return true;

  const lineLikeNoise =
    (text.match(/[│■•□▪▫]/g) ?? []).length >= 8 ||
    (text.match(/\d+%/g) ?? []).length >= 10 ||
    (text.match(/\b\d{1,3}(?:,\d{3})+\b/g) ?? []).length >= 10;
  if (lineLikeNoise && text.length < 500) return true;

  return false;
}

export function truncate(value, limit = 220) {
  const text = String(value ?? "").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function splitParagraphs(value) {
  return compactWhitespace(value)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20)
    .filter((item) => !/^(자료:|source:|page\s+\d+|\d+\s*│)/i.test(item))
    .filter((item) => !isBoilerplateParagraph(item));
}

export function containsKeyword(text, keyword) {
  return normalizeText(text).includes(normalizeText(keyword));
}

export function safePct(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Number.parseFloat(value.toFixed(2));
}

export function won(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function pct(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(2)}%`;
}

export function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

export function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function buildPortfolioMaps(portfolio, watchlist) {
  const normalizedPortfolio = enrichPortfolioWithSecurityCodes(portfolio);
  const holdingsByCode = new Map();
  const holdingsByName = new Map();
  const accountsByKey = new Map();
  const watchByCode = new Map();
  const watchByName = new Map();

  for (const account of normalizedPortfolio?.accounts ?? []) {
    accountsByKey.set(account.key, account);
    for (const holding of account.holdings ?? []) {
      const enriched = {
        ...holding,
        accountKey: account.key,
        accountLabel: account.label,
      };
      if (holding.code) holdingsByCode.set(String(holding.code), enriched);
      if (holding.name) holdingsByName.set(normalizeText(holding.name), enriched);
    }
  }

  for (const item of [
    ...(watchlist?.core_etf ?? []),
    ...(watchlist?.satellite_etf ?? []),
    ...(watchlist?.individual_stocks ?? []),
  ]) {
    const enriched = { ...item };
    if (item.code) watchByCode.set(String(item.code), enriched);
    if (item.name) watchByName.set(normalizeText(item.name), enriched);
  }

  return {
    holdingsByCode,
    holdingsByName,
    accountsByKey,
    watchByCode,
    watchByName,
  };
}

export function categoryForHolding(accountKey, code) {
  if (!code) return "기타";
  const mapping = CATEGORY_BY_CODE[code];
  if (!mapping) return "기타";
  if (mapping[accountKey]) return mapping[accountKey];
  return mapping.default;
}

export function extractNumericPhrases(text, limit = 12) {
  const patterns = [
    /\b\d+(?:\.\d+)?%/g,
    /\b\d+(?:\.\d+)?bp\b/gi,
    /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:원|달러|USD|억원|조원|억|조)?/g,
    /\$\d+(?:\.\d+)?(?:bn|mn|b|m)?/gi,
    /\b\d+(?:\.\d+)?(?:배|배럴|톤|GW|Tbps|Gbps|년|개월)\b/g,
  ];

  const matches = new Set();
  for (const pattern of patterns) {
    const found = text.match(pattern) ?? [];
    for (const item of found) {
      matches.add(item.trim());
      if (matches.size >= limit) {
        return [...matches];
      }
    }
  }

  return [...matches];
}

export function headingScore(text) {
  const normalized = normalizeText(text);
  const keywords = [
    "요약",
    "summary",
    "결론",
    "투자 포인트",
    "투자포인트",
    "시사점",
    "전망",
    "전략",
    "핵심",
    "top picks",
    "체크포인트",
    "outlook",
  ];
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? 8 : 0), 0);
}

export function sectorFromText(title, text) {
  const haystack = normalizeText(`${title}\n${text}`);
  const sectorMap = [
    { sector: "매크로", keywords: ["금리", "환율", "유가", "물가", "fomc", "연준", "재정적자", "경제분석"] },
    { sector: "반도체", keywords: ["반도체", "hbm", "dram", "낸드", "cpo", "패키징"] },
    { sector: "전력기기", keywords: ["전력", "변압기", "전력기기", "송배전", "데이터센터 전력"] },
    { sector: "방산", keywords: ["방산", "방위", "미사일", "nato", "국방"] },
    { sector: "원자력", keywords: ["원자력", "원전", "smr", "원자로"] },
    { sector: "금", keywords: ["gold", "금가격", "금 선물", "귀금속", "온스"] },
    { sector: "AI/인프라", keywords: ["ai", "gpu", "데이터센터", "광트랜시버", "실리콘 포토닉스"] },
  ];

  for (const { sector, keywords } of sectorMap) {
    if (keywords.some((keyword) => haystack.includes(normalizeText(keyword)))) {
      return sector;
    }
  }

  return "기타";
}

export function themesFromText(title, text) {
  const haystack = normalizeText(`${title}\n${text}`);
  const themeMap = [
    ["HBM/메모리", ["hbm", "dram", "낸드", "메모리"]],
    ["AI 인프라", ["ai", "gpu", "데이터센터", "cpo", "광트랜시버"]],
    ["전력 인프라", ["전력", "변압기", "송배전"]],
    ["방산", ["방산", "국방", "미사일", "nato"]],
    ["원자력", ["원자력", "원전", "smr"]],
    ["금/원자재", ["금 ", "gold", "원유", "유가", "원자재"]],
    ["금리/매크로", ["금리", "fomc", "연준", "환율", "재정적자"]],
  ];

  return themeMap
    .filter(([, keywords]) => keywords.some((keyword) => haystack.includes(normalizeText(keyword))))
    .map(([theme]) => theme);
}

// HOLDING_TOPIC_HINTS 는 위(line 85)에서 securities.json 기반으로 자동 생성됩니다.

export function reportTypeFromMeta(report, text) {
  if (report.category === "경제분석") return "macro";
  if (report.category === "산업분석") return "industry";
  if (report.category === "종목분석") return "stock";
  if (report.category === "투자전략" || report.category === "시황정보") return "strategy";
  if (themesFromText(report.title, text).length > 0) return "theme";
  return "strategy";
}
