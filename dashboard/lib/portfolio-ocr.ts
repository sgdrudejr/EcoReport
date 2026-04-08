export const MAX_TOTAL_IMAGE_BYTES = 18 * 1024 * 1024;
export const GEMINI_PORTFOLIO_MODEL =
  process.env.GEMINI_PORTFOLIO_MODEL || "gemini-2.5-flash";
export const GEMINI_PORTFOLIO_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PORTFOLIO_MODEL}:generateContent`;

const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type PortfolioAccountKey = "ISA" | "PENSION" | "TOSS" | "KIS_MAIN" | "UNKNOWN";

export type ExtractedHolding = {
  code: string | null;
  name: string;
  quantity: number | null;
  avgPrice: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  purchaseValue: number | null;
  profitLoss: number | null;
  profitRate: number | null;
  note: string | null;
};

export type ExtractedAccount = {
  accountNumber: string | null;
  evaluationAmount: number | null;
  cashAvailable: number | null;
  settlementCash: number | null;
  principal: number | null;
  profitLoss: number | null;
  profitRate: number | null;
  incomplete: boolean;
  holdings: ExtractedHolding[];
  warnings: string[];
};

export type BatchExtractedAccount = {
  accountKey: PortfolioAccountKey;
  accountLabel: string | null;
  screenshots: string[];
  extraction: ExtractedAccount;
};

export type BatchExtraction = {
  accounts: BatchExtractedAccount[];
  warnings: string[];
};

function guessMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return null;
}

export function normalizeMimeType(file: File) {
  const explicit = file.type?.trim().toLowerCase();
  if (explicit && SUPPORTED_MIME_TYPES.has(explicit)) {
    return explicit;
  }
  return guessMimeType(file.name);
}

export function normalizeString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/,/g, "")
    .replace(/원|주|%|KRW/gi, "")
    .replace(/[^\d.+-]/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeScreenshotNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));
}

function holdingIdentity(holding: Pick<ExtractedHolding, "code" | "name">) {
  if (holding.code) return `code:${holding.code}`;
  return `name:${holding.name.trim().toLowerCase()}`;
}

function mergeHoldings(holdings: ExtractedHolding[]) {
  const merged = new Map<string, ExtractedHolding>();

  for (const holding of holdings) {
    const name = normalizeString(holding.name);
    if (!name) continue;

    const normalized: ExtractedHolding = {
      code: normalizeString(holding.code),
      name,
      quantity: normalizeNumber(holding.quantity),
      avgPrice: normalizeNumber(holding.avgPrice),
      currentPrice: normalizeNumber(holding.currentPrice),
      marketValue: normalizeNumber(holding.marketValue),
      purchaseValue: normalizeNumber(holding.purchaseValue),
      profitLoss: normalizeNumber(holding.profitLoss),
      profitRate: normalizeNumber(holding.profitRate),
      note: normalizeString(holding.note),
    };

    const key = holdingIdentity(normalized);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, normalized);
      continue;
    }

    merged.set(key, {
      code: normalized.code ?? existing.code,
      name: normalized.name || existing.name,
      quantity: normalized.quantity ?? existing.quantity,
      avgPrice: normalized.avgPrice ?? existing.avgPrice,
      currentPrice: normalized.currentPrice ?? existing.currentPrice,
      marketValue: normalized.marketValue ?? existing.marketValue,
      purchaseValue: normalized.purchaseValue ?? existing.purchaseValue,
      profitLoss: normalized.profitLoss ?? existing.profitLoss,
      profitRate: normalized.profitRate ?? existing.profitRate,
      note: normalized.note ?? existing.note,
    });
  }

  return [...merged.values()];
}

export function normalizeExtraction(value: unknown): ExtractedAccount {
  const maybe =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    accountNumber: normalizeString(maybe.accountNumber),
    evaluationAmount: normalizeNumber(maybe.evaluationAmount),
    cashAvailable: normalizeNumber(maybe.cashAvailable),
    settlementCash: normalizeNumber(maybe.settlementCash),
    principal: normalizeNumber(maybe.principal),
    profitLoss: normalizeNumber(maybe.profitLoss),
    profitRate: normalizeNumber(maybe.profitRate),
    incomplete: normalizeBoolean(maybe.incomplete, true),
    holdings: mergeHoldings(
      Array.isArray(maybe.holdings)
        ? (maybe.holdings as ExtractedHolding[])
        : [],
    ),
    warnings: normalizeWarnings(maybe.warnings),
  };
}

export function normalizeAccountKey(value: unknown): PortfolioAccountKey {
  const normalized = normalizeString(value)?.toUpperCase();
  if (!normalized) return "UNKNOWN";
  if (normalized === "ISA") return "ISA";
  if (normalized === "PENSION" || normalized === "연금저축") return "PENSION";
  if (normalized === "TOSS" || normalized === "토스" || normalized === "토스증권") {
    return "TOSS";
  }
  if (
    normalized === "KIS_MAIN" ||
    normalized === "KIS" ||
    normalized === "한투" ||
    normalized === "한투 일반" ||
    normalized === "한투증권" ||
    normalized === "한국투자증권"
  ) {
    return "KIS_MAIN";
  }
  return "UNKNOWN";
}

function mergeExtractionValues(
  current: ExtractedAccount,
  next: ExtractedAccount,
): ExtractedAccount {
  return {
    accountNumber: next.accountNumber ?? current.accountNumber,
    evaluationAmount: next.evaluationAmount ?? current.evaluationAmount,
    cashAvailable: next.cashAvailable ?? current.cashAvailable,
    settlementCash: next.settlementCash ?? current.settlementCash,
    principal: next.principal ?? current.principal,
    profitLoss: next.profitLoss ?? current.profitLoss,
    profitRate: next.profitRate ?? current.profitRate,
    incomplete: next.incomplete || current.incomplete,
    holdings: mergeHoldings([...(current.holdings ?? []), ...(next.holdings ?? [])]),
    warnings: [...new Set([...(current.warnings ?? []), ...(next.warnings ?? [])])],
  };
}

export function normalizeBatchExtraction(value: unknown): BatchExtraction {
  const maybe =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const warnings = normalizeWarnings(maybe.warnings);
  const accountsValue = Array.isArray(maybe.accounts) ? maybe.accounts : [];
  const merged = new Map<PortfolioAccountKey, BatchExtractedAccount>();

  for (const item of accountsValue) {
    const current =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const accountKey = normalizeAccountKey(current.accountKey);
    const accountLabel = normalizeString(current.accountLabel);
    const screenshots = normalizeScreenshotNames(current.screenshots);
    const extraction = normalizeExtraction(current.extraction);

    const existing = merged.get(accountKey);
    if (!existing) {
      merged.set(accountKey, {
        accountKey,
        accountLabel,
        screenshots,
        extraction,
      });
      continue;
    }

    merged.set(accountKey, {
      accountKey,
      accountLabel: accountLabel ?? existing.accountLabel,
      screenshots: [...new Set([...existing.screenshots, ...screenshots])],
      extraction: mergeExtractionValues(existing.extraction, extraction),
    });
  }

  return {
    accounts: [...merged.values()],
    warnings,
  };
}

export function buildSingleAccountPrompt({
  accountKey,
  accountLabel,
  fileNames,
}: {
  accountKey: string;
  accountLabel: string;
  fileNames: string[];
}) {
  return [
    "You are extracting structured portfolio data from Korean brokerage screenshots.",
    `The target account is ${accountLabel} (${accountKey}).`,
    `The uploaded screenshots are: ${fileNames.join(", ")}.`,
    "Return only what is visibly readable in the screenshots.",
    "Do not infer hidden holdings, hidden totals, or missing rows.",
    "If a value is not visible or ambiguous, return null.",
    "If the screenshots look partial, cropped, or likely miss some holdings, set incomplete to true.",
    "Normalize money and prices to plain numbers in KRW without commas or units.",
    "Normalize percentages to human-readable percent numbers like 33.07, not 0.3307.",
    "Keep accountNumber as a string with any visible separators.",
    "For holdings, include only rows that are actually visible.",
    "If the same holding appears in multiple screenshots, combine the visible fields.",
    "Use warnings for uncertainty, cropped screens, blurry text, or likely omissions.",
  ].join("\n");
}

export function buildBatchPrompt(fileNames: string[]) {
  return [
    "You are classifying and extracting Korean brokerage screenshots for a portfolio tracker.",
    "Possible account keys are exactly: ISA, PENSION, TOSS, KIS_MAIN, UNKNOWN.",
    "ISA means Korean ISA accounts, PENSION means pension savings or retirement accounts such as 연금저축, TOSS means Toss Securities screens, and KIS_MAIN means Korea Investment & Securities screens such as 한국투자증권 or 한투.",
    "Classify each screenshot into one of those account keys using visible clues only.",
    "Then combine screenshots belonging to the same account and extract the visible account totals and holdings.",
    `The uploaded screenshot file names are: ${fileNames.join(", ")}.`,
    "Use the exact screenshot filenames in the screenshots array for each account.",
    "If a screenshot cannot be confidently assigned, put it under UNKNOWN.",
    "Do not invent rows or hidden holdings.",
    "If a value is not visible or ambiguous, return null.",
    "If screenshots appear partial, cropped, or likely omit holdings, set incomplete to true.",
    "Normalize currency and prices to plain KRW numbers without commas or units.",
    "Normalize percentages to percent numbers like 12.34, not 0.1234.",
    "If multiple screenshots belong to the same account, merge them.",
    "Use warnings for blur, crop, uncertain classification, or likely omissions.",
  ].join("\n");
}

export function singleAccountResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      accountNumber: { type: ["string", "null"] },
      evaluationAmount: { type: ["number", "null"] },
      cashAvailable: { type: ["number", "null"] },
      settlementCash: { type: ["number", "null"] },
      principal: { type: ["number", "null"] },
      profitLoss: { type: ["number", "null"] },
      profitRate: { type: ["number", "null"] },
      incomplete: { type: "boolean" },
      holdings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: ["string", "null"] },
            name: { type: "string" },
            quantity: { type: ["number", "null"] },
            avgPrice: { type: ["number", "null"] },
            currentPrice: { type: ["number", "null"] },
            marketValue: { type: ["number", "null"] },
            purchaseValue: { type: ["number", "null"] },
            profitLoss: { type: ["number", "null"] },
            profitRate: { type: ["number", "null"] },
            note: { type: ["string", "null"] },
          },
          required: [
            "code",
            "name",
            "quantity",
            "avgPrice",
            "currentPrice",
            "marketValue",
            "purchaseValue",
            "profitLoss",
            "profitRate",
            "note",
          ],
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "accountNumber",
      "evaluationAmount",
      "cashAvailable",
      "settlementCash",
      "principal",
      "profitLoss",
      "profitRate",
      "incomplete",
      "holdings",
      "warnings",
    ],
  };
}

export function batchResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      accounts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            accountKey: { type: "string" },
            accountLabel: { type: ["string", "null"] },
            screenshots: {
              type: "array",
              items: { type: "string" },
            },
            extraction: singleAccountResponseJsonSchema(),
          },
          required: ["accountKey", "accountLabel", "screenshots", "extraction"],
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["accounts", "warnings"],
  };
}

export function extractTextFromGeminiResponse(payload: unknown) {
  const maybe =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const candidates = Array.isArray(maybe.candidates) ? maybe.candidates : [];

  const texts = candidates.flatMap((candidate) => {
    const content =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>).content
        : null;
    const parts =
      content && typeof content === "object"
        ? (content as Record<string, unknown>).parts
        : null;

    return Array.isArray(parts)
      ? parts
          .map((part) =>
            part && typeof part === "object"
              ? normalizeString((part as Record<string, unknown>).text)
              : null,
          )
          .filter((item): item is string => Boolean(item))
      : [];
  });

  return texts.join("\n").trim();
}

export function parseGeminiJson(text: string) {
  const direct = text.trim();
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      // fall through
    }
  }

  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) {
    return JSON.parse(fenced);
  }

  throw new Error("Gemini 응답에서 JSON을 파싱하지 못했습니다.");
}

export async function fileToInlinePart(file: File) {
  const mimeType = normalizeMimeType(file);
  if (!mimeType) {
    throw new Error(`지원하지 않는 이미지 형식입니다: ${file.name}`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  return {
    inline_data: {
      mime_type: mimeType,
      data: bytes.toString("base64"),
    },
  };
}
