import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export const CATEGORY_BY_CODE = {
  "458760": { default: "배당/커버드콜", ISA: "배당/커버드콜" },
  "132030": { default: "금", ISA: "금", PENSION: "금" },
  "360750": { default: "미국인덱스", ISA: "미국인덱스", PENSION: "S&P500" },
  "133690": { default: "나스닥100", PENSION: "나스닥100" },
  "423160": { default: "현금파킹", ISA: "현금파킹", PENSION: "현금파킹", TOSS: "현금파킹" },
  "487240": { default: "전력기기", TOSS: "전력기기" },
  "449450": { default: "방산", TOSS: "방산" },
  "434730": { default: "원자력", TOSS: "원자력" },
};

export const PREFERRED_LABEL_BY_CATEGORY = {
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

export function parseDateArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    output: null,
    markdown: null,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (token === "--markdown" && argv[index + 1]) {
      args.markdown = argv[index + 1];
      index += 1;
    } else if (token === "--force") {
      args.force = true;
    }
  }

  return args;
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
  const holdingsByCode = new Map();
  const holdingsByName = new Map();
  const accountsByKey = new Map();
  const watchByCode = new Map();
  const watchByName = new Map();

  for (const account of portfolio?.accounts ?? []) {
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

export const HOLDING_TOPIC_HINTS = {
  "423160": ["kofr", "금리", "단기채", "현금", "채권", "유동성"],
  "458760": ["배당", "커버드콜", "미국배당", "다우존스", "인컴"],
  "360750": ["s&p500", "s&p 500", "미국지수", "미국증시", "미국 주식"],
  "133690": ["나스닥", "nasdaq", "기술주", "미국 빅테크"],
  "132030": ["gold", "금", "귀금속", "인플레이션 헤지"],
  "487240": ["전력", "변압기", "송배전", "ai 인프라", "데이터센터 전력"],
  "449450": ["방산", "국방", "미사일", "방위산업", "nato"],
  "434730": ["원자력", "원전", "smr", "원자로"],
  "2921050": ["코리아 top10", "국내 코어", "코스피", "대형주"],
};

export function reportTypeFromMeta(report, text) {
  if (report.category === "경제분석") return "macro";
  if (report.category === "산업분석") return "industry";
  if (report.category === "종목분석") return "stock";
  if (report.category === "투자전략" || report.category === "시황정보") return "strategy";
  if (themesFromText(report.title, text).length > 0) return "theme";
  return "strategy";
}
