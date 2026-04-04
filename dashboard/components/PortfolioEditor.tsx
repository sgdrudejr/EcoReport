"use client";

import { useMemo, useState } from "react";
import { ImagePlus, Plus, Save, Sparkles, Trash2 } from "lucide-react";

type Holding = {
  id?: string;
  code?: string;
  name: string;
  quantity?: number | null;
  avgPrice?: number | null;
  currentPrice?: number | null;
  marketValue?: number | null;
  purchaseValue?: number | null;
  profitLoss?: number | null;
  profitRate?: number | null;
  note?: string | null;
};

type Account = {
  key: string;
  label: string;
  accountNumber?: string | null;
  evaluationAmount?: number | null;
  cashAvailable?: number | null;
  settlementCash?: number | null;
  principal?: number | null;
  profitLoss?: number | null;
  profitRate?: number | null;
  screenshots?: string[];
  incomplete?: boolean;
  holdings: Holding[];
};

type Snapshot = {
  date: string;
  updatedAt: string;
  source: {
    method: string;
    reviewer?: string | null;
    note?: string | null;
  };
  accounts: Account[];
};

type PreviewItem = { name: string; url: string };
type PreviewMap = Record<string, PreviewItem[]>;
type FileMap = Record<string, File[]>;
type ExtractState = "idle" | "extracting" | "ok" | "error";

type ExtractedHolding = {
  code?: string | null;
  name: string;
  quantity?: number | null;
  avgPrice?: number | null;
  currentPrice?: number | null;
  marketValue?: number | null;
  purchaseValue?: number | null;
  profitLoss?: number | null;
  profitRate?: number | null;
  note?: string | null;
};

type ExtractedAccount = {
  accountNumber?: string | null;
  evaluationAmount?: number | null;
  cashAvailable?: number | null;
  settlementCash?: number | null;
  principal?: number | null;
  profitLoss?: number | null;
  profitRate?: number | null;
  incomplete?: boolean;
  holdings?: ExtractedHolding[];
  warnings?: string[];
};

type BatchExtractedAccount = {
  accountKey: string;
  accountLabel?: string | null;
  screenshots?: string[];
  extraction?: ExtractedAccount;
};

type PersistResult = {
  ok: boolean;
  error?: string;
};

function formatNumberInput(value?: number | null) {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  return String(value);
}

function parseNumberInput(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function createHolding(): Holding {
  return {
    name: "",
    code: "",
    quantity: null,
    avgPrice: null,
    currentPrice: null,
    marketValue: null,
    purchaseValue: null,
    profitLoss: null,
    profitRate: null,
    note: "",
  };
}

function preferValue<T>(current: T | null | undefined, next: T | null | undefined) {
  return next == null || next === "" ? current : next;
}

function holdingKey(holding: { code?: string | null; name?: string | null }) {
  if (holding.code) return `code:${holding.code}`;
  return `name:${(holding.name ?? "").trim().toLowerCase()}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function fileIdentity(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function buildPreviews(files: File[]) {
  return files.map((file) => ({
    name: file.name,
    url: URL.createObjectURL(file),
  }));
}

function mergeFiles(current: File[], next: File[]) {
  const merged = new Map<string, File>();

  for (const file of current) {
    merged.set(fileIdentity(file), file);
  }

  for (const file of next) {
    merged.set(fileIdentity(file), file);
  }

  return [...merged.values()];
}

function mergePreviews(current: PreviewItem[], next: PreviewItem[]) {
  const merged = new Map<string, PreviewItem>();

  for (const preview of current) {
    merged.set(preview.name, preview);
  }

  for (const preview of next) {
    merged.set(preview.name, preview);
  }

  return [...merged.values()];
}

function mergeExtractedHoldings(current: Holding[], extracted: ExtractedHolding[]) {
  const merged = new Map<string, Holding>();

  for (const holding of current) {
    merged.set(holdingKey(holding), { ...holding });
  }

  for (const holding of extracted) {
    const name = holding.name?.trim();
    if (!name) continue;

    const normalized: Holding = {
      code: holding.code?.trim() || undefined,
      name,
      quantity: holding.quantity ?? null,
      avgPrice: holding.avgPrice ?? null,
      currentPrice: holding.currentPrice ?? null,
      marketValue: holding.marketValue ?? null,
      purchaseValue: holding.purchaseValue ?? null,
      profitLoss: holding.profitLoss ?? null,
      profitRate: holding.profitRate ?? null,
      note: holding.note ?? null,
    };

    const key = holdingKey(normalized);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, normalized);
      continue;
    }

    merged.set(key, {
      ...existing,
      code: preferValue(existing.code, normalized.code) ?? undefined,
      name: preferValue(existing.name, normalized.name) ?? existing.name,
      quantity: preferValue(existing.quantity, normalized.quantity) ?? null,
      avgPrice: preferValue(existing.avgPrice, normalized.avgPrice) ?? null,
      currentPrice: preferValue(existing.currentPrice, normalized.currentPrice) ?? null,
      marketValue: preferValue(existing.marketValue, normalized.marketValue) ?? null,
      purchaseValue: preferValue(existing.purchaseValue, normalized.purchaseValue) ?? null,
      profitLoss: preferValue(existing.profitLoss, normalized.profitLoss) ?? null,
      profitRate: preferValue(existing.profitRate, normalized.profitRate) ?? null,
      note: preferValue(existing.note, normalized.note) ?? null,
    });
  }

  return [...merged.values()];
}

function mergeAccountWithExtraction(account: Account, extracted: ExtractedAccount): Account {
  const extractedHoldings = extracted.holdings ?? [];

  return {
    ...account,
    accountNumber: preferValue(account.accountNumber, extracted.accountNumber) ?? null,
    evaluationAmount: preferValue(account.evaluationAmount, extracted.evaluationAmount) ?? null,
    cashAvailable: preferValue(account.cashAvailable, extracted.cashAvailable) ?? null,
    settlementCash: preferValue(account.settlementCash, extracted.settlementCash) ?? null,
    principal: preferValue(account.principal, extracted.principal) ?? null,
    profitLoss: preferValue(account.profitLoss, extracted.profitLoss) ?? null,
    profitRate: preferValue(account.profitRate, extracted.profitRate) ?? null,
    incomplete:
      typeof extracted.incomplete === "boolean"
        ? extracted.incomplete
        : (account.incomplete ?? true),
    holdings:
      extractedHoldings.length > 0
        ? mergeExtractedHoldings(account.holdings, extractedHoldings)
        : account.holdings,
  };
}

function mergeAccountScreenshots(account: Account, screenshots: string[]) {
  if (screenshots.length === 0) {
    return account;
  }

  return {
    ...account,
    screenshots: uniqueStrings([...(account.screenshots ?? []), ...screenshots]),
  };
}

function updateAccountInSnapshot(
  snapshot: Snapshot,
  accountKey: string,
  updater: (account: Account) => Account,
) {
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((account) =>
      account.key === accountKey ? updater(account) : account,
    ),
  };
}

function buildAssignedFileMap(
  files: File[],
  accounts: BatchExtractedAccount[],
  knownAccountKeys: Set<string>,
) {
  const fileByName = new Map(files.map((file) => [file.name, file]));
  const grouped: FileMap = {};

  for (const account of accounts) {
    if (!knownAccountKeys.has(account.accountKey)) {
      continue;
    }

    const assignedFiles = (account.screenshots ?? [])
      .map((name) => fileByName.get(name))
      .filter((file): file is File => Boolean(file));

    if (assignedFiles.length === 0) {
      continue;
    }

    grouped[account.accountKey] = mergeFiles(
      grouped[account.accountKey] ?? [],
      assignedFiles,
    );
  }

  return grouped;
}

function buildPreviewMapFromFiles(fileMap: FileMap) {
  const previews: PreviewMap = {};

  for (const [accountKey, files] of Object.entries(fileMap)) {
    previews[accountKey] = buildPreviews(files);
  }

  return previews;
}

function mergeFileMaps(current: FileMap, next: FileMap) {
  const merged = { ...current };

  for (const [accountKey, files] of Object.entries(next)) {
    merged[accountKey] = mergeFiles(merged[accountKey] ?? [], files);
  }

  return merged;
}

function mergePreviewMaps(current: PreviewMap, next: PreviewMap) {
  const merged = { ...current };

  for (const [accountKey, previews] of Object.entries(next)) {
    merged[accountKey] = mergePreviews(merged[accountKey] ?? [], previews);
  }

  return merged;
}

function buildSaveSuccessMessage(payload: {
  warning?: string | null;
  githubSynced?: boolean;
}) {
  if (payload.warning) {
    return `포트폴리오 스냅샷이 저장됐습니다. ${payload.warning}`;
  }

  return payload.githubSynced
    ? "포트폴리오 스냅샷이 로컬 파일과 GitHub에 저장됐습니다."
    : "포트폴리오 스냅샷이 로컬 파일에 저장됐습니다.";
}

export default function PortfolioEditor({
  initialSnapshot,
}: {
  initialSnapshot: Snapshot;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [previews, setPreviews] = useState<PreviewMap>({});
  const [selectedFiles, setSelectedFiles] = useState<FileMap>({});
  const [batchPreviews, setBatchPreviews] = useState<PreviewItem[]>([]);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchState, setBatchState] = useState<ExtractState>("idle");
  const [batchMessage, setBatchMessage] = useState("");
  const [autoSaveAfterExtract, setAutoSaveAfterExtract] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [extractStateByAccount, setExtractStateByAccount] = useState<
    Record<string, ExtractState>
  >({});
  const [extractMessageByAccount, setExtractMessageByAccount] = useState<
    Record<string, string>
  >({});

  const totalPortfolioValue = useMemo(
    () =>
      snapshot.accounts.reduce(
        (sum, account) => sum + (account.evaluationAmount ?? 0),
        0,
      ),
    [snapshot.accounts],
  );

  function updateAccount(
    accountKey: string,
    updater: (account: Account) => Account,
  ) {
    setSnapshot((current) => updateAccountInSnapshot(current, accountKey, updater));
  }

  function handleScreenshotChange(accountKey: string, files: FileList | null) {
    const nextFiles = files == null ? [] : Array.from(files);
    const nextPreviews = buildPreviews(nextFiles);

    setPreviews((current) => ({
      ...current,
      [accountKey]: nextPreviews,
    }));
    setSelectedFiles((current) => ({
      ...current,
      [accountKey]: nextFiles,
    }));
    setExtractMessageByAccount((current) => ({
      ...current,
      [accountKey]: "",
    }));
    setExtractStateByAccount((current) => ({
      ...current,
      [accountKey]: "idle",
    }));

    updateAccount(accountKey, (account) => ({
      ...account,
      screenshots: nextPreviews.map((item) => item.name),
    }));
  }

  function handleBatchScreenshotChange(files: FileList | null) {
    const nextFiles = files == null ? [] : Array.from(files);
    const nextPreviews = buildPreviews(nextFiles);

    setBatchFiles(nextFiles);
    setBatchPreviews(nextPreviews);
    setBatchState("idle");
    setBatchMessage("");
  }

  async function persistSnapshot(
    nextSnapshot: Snapshot,
    successPrefix?: string,
  ): Promise<PersistResult> {
    const snapshotToSave = {
      ...nextSnapshot,
      date: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
      source: {
        ...nextSnapshot.source,
        method: "screenshot_review",
      },
    };

    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch("/api/portfolio/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: snapshotToSave,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMessage = data.error ?? "저장에 실패했습니다.";
        setStatus("error");
        setMessage(errorMessage);
        return { ok: false, error: errorMessage };
      }

      const successMessage = buildSaveSuccessMessage(data);
      setStatus("ok");
      setMessage(successPrefix ? `${successPrefix} ${successMessage}` : successMessage);
      setSnapshot((current) => ({
        ...current,
        date: snapshotToSave.date,
        updatedAt: data.updatedAt ?? snapshotToSave.updatedAt,
        source: {
          ...current.source,
          method: snapshotToSave.source.method,
        },
      }));

      return { ok: true };
    } catch {
      const errorMessage = "네트워크 오류로 저장하지 못했습니다.";
      setStatus("error");
      setMessage(errorMessage);
      return { ok: false, error: errorMessage };
    }
  }

  async function handleExtract(account: Account) {
    const files = selectedFiles[account.key] ?? [];
    if (files.length === 0) {
      setExtractStateByAccount((current) => ({
        ...current,
        [account.key]: "error",
      }));
      setExtractMessageByAccount((current) => ({
        ...current,
        [account.key]: "먼저 이 계좌의 캡처 이미지를 업로드해 주세요.",
      }));
      return;
    }

    setExtractStateByAccount((current) => ({
      ...current,
      [account.key]: "extracting",
    }));
    setExtractMessageByAccount((current) => ({
      ...current,
      [account.key]: "",
    }));

    try {
      const formData = new FormData();
      formData.append("accountKey", account.key);
      formData.append("accountLabel", account.label);
      for (const file of files) {
        formData.append("files", file, file.name);
      }

      const response = await fetch("/api/portfolio/extract", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        setExtractStateByAccount((current) => ({
          ...current,
          [account.key]: "error",
        }));
        setExtractMessageByAccount((current) => ({
          ...current,
          [account.key]: payload.error ?? "이미지 추출에 실패했습니다.",
        }));
        return;
      }

      const screenshotNames = files.map((file) => file.name);
      const nextSnapshot = updateAccountInSnapshot(snapshot, account.key, (current) =>
        mergeAccountScreenshots(
          mergeAccountWithExtraction(current, payload.extraction ?? {}),
          screenshotNames,
        ),
      );

      setSnapshot(nextSnapshot);

      const warnings =
        Array.isArray(payload.extraction?.warnings) &&
        payload.extraction.warnings.length > 0
          ? ` 주의: ${payload.extraction.warnings.join(" / ")}`
          : "";

      let nextMessage = `${payload.model ?? "Gemini"}가 ${payload.screenshotCount ?? files.length}장 이미지에서 숫자와 보유 종목을 읽어 반영했습니다.${warnings}`;

      if (autoSaveAfterExtract) {
        const saveResult = await persistSnapshot(
          nextSnapshot,
          "OCR 추출 결과를 자동 저장했습니다.",
        );
        nextMessage = saveResult.ok
          ? `${nextMessage} 자동 저장까지 완료했습니다.`
          : `${nextMessage} 자동 저장은 실패했습니다: ${saveResult.error}`;
      }

      setExtractStateByAccount((current) => ({
        ...current,
        [account.key]: "ok",
      }));
      setExtractMessageByAccount((current) => ({
        ...current,
        [account.key]: nextMessage,
      }));
    } catch {
      setExtractStateByAccount((current) => ({
        ...current,
        [account.key]: "error",
      }));
      setExtractMessageByAccount((current) => ({
        ...current,
        [account.key]: "네트워크 오류로 이미지 추출을 완료하지 못했습니다.",
      }));
    }
  }

  async function handleBatchExtract() {
    if (batchFiles.length === 0) {
      setBatchState("error");
      setBatchMessage("먼저 여러 계좌 캡처 이미지를 업로드해 주세요.");
      return;
    }

    setBatchState("extracting");
    setBatchMessage("");

    try {
      const formData = new FormData();
      for (const file of batchFiles) {
        formData.append("files", file, file.name);
      }

      const response = await fetch("/api/portfolio/extract/batch", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        setBatchState("error");
        setBatchMessage(payload.error ?? "이미지 분류에 실패했습니다.");
        return;
      }

      const accountKeys = new Set(snapshot.accounts.map((account) => account.key));
      const extractedAccounts = Array.isArray(payload.accounts)
        ? (payload.accounts as BatchExtractedAccount[])
        : [];
      const recognizedAccounts = extractedAccounts.filter((item) =>
        accountKeys.has(item.accountKey),
      );
      const unknownScreenshots = extractedAccounts
        .filter((item) => item.accountKey === "UNKNOWN")
        .flatMap((item) => item.screenshots ?? []);

      if (recognizedAccounts.length === 0) {
        const warnings =
          Array.isArray(payload.warnings) && payload.warnings.length > 0
            ? ` 주의: ${payload.warnings.join(" / ")}`
            : "";
        setBatchState("error");
        setBatchMessage(
          `Gemini가 ${payload.screenshotCount ?? batchFiles.length}장 이미지를 읽었지만 ISA/연금/TOSS로 확실히 분류하지 못했습니다.${warnings}`,
        );
        return;
      }

      let nextSnapshot = snapshot;
      for (const accountResult of recognizedAccounts) {
        nextSnapshot = updateAccountInSnapshot(
          nextSnapshot,
          accountResult.accountKey,
          (current) =>
            mergeAccountScreenshots(
              mergeAccountWithExtraction(current, accountResult.extraction ?? {}),
              accountResult.screenshots ?? [],
            ),
        );
      }

      setSnapshot(nextSnapshot);

      const assignedFileMap = buildAssignedFileMap(
        batchFiles,
        recognizedAccounts,
        accountKeys,
      );
      const assignedPreviewMap = buildPreviewMapFromFiles(assignedFileMap);

      setSelectedFiles((current) => mergeFileMaps(current, assignedFileMap));
      setPreviews((current) => mergePreviewMaps(current, assignedPreviewMap));

      setExtractStateByAccount((current) => {
        const next = { ...current };
        for (const accountResult of recognizedAccounts) {
          next[accountResult.accountKey] = "ok";
        }
        return next;
      });

      setExtractMessageByAccount((current) => {
        const next = { ...current };
        for (const accountResult of recognizedAccounts) {
          const warnings =
            Array.isArray(accountResult.extraction?.warnings) &&
            accountResult.extraction.warnings.length > 0
              ? ` 주의: ${accountResult.extraction.warnings.join(" / ")}`
              : "";
          next[accountResult.accountKey] =
            `일괄 자동 분류로 ${(accountResult.screenshots ?? []).length}장 캡처를 반영했습니다.${warnings}`;
        }
        return next;
      });

      const summary = recognizedAccounts
        .map((accountResult) => {
          const label =
            snapshot.accounts.find((account) => account.key === accountResult.accountKey)
              ?.label ?? accountResult.accountKey;
          const screenshotCount = (accountResult.screenshots ?? []).length;
          const holdingCount = accountResult.extraction?.holdings?.length ?? 0;
          return `${label} ${screenshotCount}장 / 종목 ${holdingCount}개`;
        })
        .join(", ");

      const warnings =
        Array.isArray(payload.warnings) && payload.warnings.length > 0
          ? ` 주의: ${payload.warnings.join(" / ")}`
          : "";
      const unknownMessage =
        unknownScreenshots.length > 0
          ? ` 자동 배정하지 못한 이미지: ${uniqueStrings(unknownScreenshots).join(", ")}.`
          : "";

      let nextMessage = `${payload.model ?? "Gemini"}가 ${payload.screenshotCount ?? batchFiles.length}장 이미지를 자동 분류해 ${summary}로 반영했습니다.${unknownMessage}${warnings}`;

      if (autoSaveAfterExtract) {
        const saveResult = await persistSnapshot(
          nextSnapshot,
          "일괄 추출 결과를 자동 저장했습니다.",
        );
        nextMessage = saveResult.ok
          ? `${nextMessage} 자동 저장까지 완료했습니다.`
          : `${nextMessage} 자동 저장은 실패했습니다: ${saveResult.error}`;
      }

      setBatchState("ok");
      setBatchMessage(nextMessage);
    } catch {
      setBatchState("error");
      setBatchMessage("네트워크 오류로 이미지 분류를 완료하지 못했습니다.");
    }
  }

  async function handleSave() {
    await persistSnapshot(snapshot);
  }

  return (
    <div className="space-y-6">
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              포트폴리오 업데이트
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              계좌별로 캡처를 올리거나, 여러 장을 한 번에 올려 ISA/연금/TOSS로
              자동 분류할 수 있습니다. 추출 후에는 값만 빠르게 검토하고 바로
              저장하면 됩니다.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500">현재 총 평가금액</p>
            <p className="text-xl font-semibold tabular-nums">
              {totalPortfolioValue.toLocaleString()}원
            </p>
          </div>
        </div>

        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <label className="text-sm text-zinc-300">
            검토 메모
            <textarea
              value={snapshot.source.note ?? ""}
              onChange={(event) =>
                setSnapshot((current) => ({
                  ...current,
                  source: { ...current.source, note: event.target.value },
                }))
              }
              rows={3}
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
              placeholder="예: 2026-04-03 장마감 후 캡처 기준"
            />
          </label>
          <label className="text-sm text-zinc-300">
            검토자
            <input
              value={snapshot.source.reviewer ?? ""}
              onChange={(event) =>
                setSnapshot((current) => ({
                  ...current,
                  source: { ...current.source, reviewer: event.target.value },
                }))
              }
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
              placeholder="예: seo"
            />
          </label>
        </div>

        <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-medium text-zinc-100">
                여러 계좌 캡처 일괄 업로드
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                계좌 전체 요약 화면과 보유 종목 화면을 한 번에 넣으면 Gemini가
                ISA, 연금저축, 토스증권으로 자동 배정해 각 카드에 반영합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 cursor-pointer hover:border-zinc-500">
                <ImagePlus size={16} />
                여러 이미지 업로드
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) =>
                    handleBatchScreenshotChange(event.target.files)
                  }
                />
              </label>
              <button
                type="button"
                onClick={handleBatchExtract}
                disabled={batchState === "extracting"}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300 hover:border-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles size={16} />
                {batchState === "extracting"
                  ? "자동 분류 중..."
                  : "자동 분류 + 숫자 추출"}
              </button>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={autoSaveAfterExtract}
              onChange={(event) => setAutoSaveAfterExtract(event.target.checked)}
            />
            추출이 끝나면 바로 저장
          </label>

          {batchMessage && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                batchState === "error"
                  ? "border-red-900/70 bg-red-950/30 text-red-300"
                  : batchState === "ok"
                    ? "border-emerald-900/70 bg-emerald-950/30 text-emerald-300"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300"
              }`}
            >
              {batchMessage}
            </div>
          )}

          {batchPreviews.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {batchPreviews.map((preview) => (
                <div
                  key={`batch-${preview.name}`}
                  className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900"
                >
                  <img
                    src={preview.url}
                    alt={preview.name}
                    className="w-full h-36 object-cover"
                  />
                  <div className="px-3 py-2 text-xs text-zinc-400 truncate">
                    {preview.name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {snapshot.accounts.map((account) => (
        <section
          key={account.key}
          className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">
                {account.label}
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                개별 계좌로 다시 추출하고 싶으면 여기서 직접 캡처를 추가로
                올린 뒤 재실행할 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 cursor-pointer hover:border-zinc-500">
                <ImagePlus size={16} />
                캡처 업로드
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) =>
                    handleScreenshotChange(account.key, event.target.files)
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => handleExtract(account)}
                disabled={extractStateByAccount[account.key] === "extracting"}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300 hover:border-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles size={16} />
                {extractStateByAccount[account.key] === "extracting"
                  ? "추출 중..."
                  : "이미지에서 숫자 추출"}
              </button>
            </div>
          </div>

          <p className="text-xs text-zinc-500">
            Gemini OCR은 현재 업로드한 캡처만 읽습니다. 저장 시 원본 이미지
            파일 자체를 서버에 보관하지는 않고, 캡처 파일명만 메모처럼
            남깁니다.
          </p>

          {extractMessageByAccount[account.key] && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                extractStateByAccount[account.key] === "error"
                  ? "border-red-900/70 bg-red-950/30 text-red-300"
                  : extractStateByAccount[account.key] === "ok"
                    ? "border-emerald-900/70 bg-emerald-950/30 text-emerald-300"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300"
              }`}
            >
              {extractMessageByAccount[account.key]}
            </div>
          )}

          {(previews[account.key]?.length ?? 0) > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {previews[account.key].map((preview) => (
                <div
                  key={`${account.key}-${preview.name}`}
                  className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950"
                >
                  <img
                    src={preview.url}
                    alt={preview.name}
                    className="w-full h-44 object-cover"
                  />
                  <div className="px-3 py-2 text-xs text-zinc-400 truncate">
                    {preview.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(previews[account.key]?.length ?? 0) === 0 &&
            (account.screenshots?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                <p className="text-xs font-medium text-zinc-400">
                  저장된 캡처 파일명
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(account.screenshots ?? []).map((name) => (
                    <span
                      key={`${account.key}-${name}`}
                      className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { key: "accountNumber", label: "계좌번호" },
              { key: "evaluationAmount", label: "총 평가금액" },
              { key: "cashAvailable", label: "예수금 / 매수가능금액" },
              { key: "settlementCash", label: "예수금(D+2)" },
              { key: "principal", label: "매수금액 / 출납원리금" },
              { key: "profitLoss", label: "손익" },
              { key: "profitRate", label: "수익률(%)" },
            ].map((field) => (
              <label key={field.key} className="text-sm text-zinc-300">
                {field.label}
                <input
                  value={
                    field.key === "accountNumber"
                      ? account.accountNumber ?? ""
                      : formatNumberInput(
                          account[field.key as keyof Account] as
                            | number
                            | null
                            | undefined,
                        )
                  }
                  onChange={(event) =>
                    updateAccount(account.key, (current) => ({
                      ...current,
                      [field.key]:
                        field.key === "accountNumber"
                          ? event.target.value
                          : parseNumberInput(event.target.value),
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                />
              </label>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={account.incomplete ?? false}
              onChange={(event) =>
                updateAccount(account.key, (current) => ({
                  ...current,
                  incomplete: event.target.checked,
                }))
              }
            />
            이 계좌는 캡처가 부분적이라 일부 종목이 누락될 수 있음
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-zinc-200">보유 종목</h4>
              <button
                type="button"
                onClick={() =>
                  updateAccount(account.key, (current) => ({
                    ...current,
                    holdings: [...current.holdings, createHolding()],
                  }))
                }
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500"
              >
                <Plus size={16} />
                종목 추가
              </button>
            </div>

            {account.holdings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
                아직 입력된 보유 종목이 없습니다.
              </div>
            ) : (
              <div className="space-y-4">
                {account.holdings.map((holding, index) => (
                  <div
                    key={`${account.key}-holding-${index}`}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-medium text-zinc-200">
                        종목 {index + 1}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          updateAccount(account.key, (current) => ({
                            ...current,
                            holdings: current.holdings.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                        className="inline-flex items-center gap-2 text-xs text-red-400 hover:text-red-300"
                      >
                        <Trash2 size={14} />
                        삭제
                      </button>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        ["name", "종목명"],
                        ["code", "종목코드"],
                        ["quantity", "수량"],
                        ["avgPrice", "평균단가"],
                        ["currentPrice", "현재가"],
                        ["marketValue", "평가금액"],
                        ["purchaseValue", "매수금액"],
                        ["profitLoss", "손익"],
                        ["profitRate", "수익률(%)"],
                        ["note", "메모"],
                      ].map(([fieldKey, label]) => (
                        <label key={fieldKey} className="text-sm text-zinc-300">
                          {label}
                          <input
                            value={
                              fieldKey === "name" ||
                              fieldKey === "code" ||
                              fieldKey === "note"
                                ? (holding[fieldKey as keyof Holding] as
                                    | string
                                    | undefined
                                    | null) ?? ""
                                : formatNumberInput(
                                    holding[fieldKey as keyof Holding] as
                                      | number
                                      | null
                                      | undefined,
                                  )
                            }
                            onChange={(event) =>
                              updateAccount(account.key, (current) => ({
                                ...current,
                                holdings: current.holdings.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        [fieldKey]:
                                          fieldKey === "name" ||
                                          fieldKey === "code" ||
                                          fieldKey === "note"
                                            ? event.target.value
                                            : parseNumberInput(
                                                event.target.value,
                                              ),
                                      }
                                    : item,
                                ),
                              }))
                            }
                            className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ))}

      <div className="flex items-center justify-between gap-4">
        <p
          className={`text-sm ${
            status === "error"
              ? "text-red-400"
              : status === "ok"
                ? "text-emerald-400"
                : "text-zinc-500"
          }`}
        >
          {message ||
            "저장하면 data/portfolio/latest.json 이 갱신되고, 이후 분석이 이 스냅샷을 읽습니다."}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={status === "saving"}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-700"
        >
          <Save size={16} />
          {status === "saving" ? "저장 중..." : "포트폴리오 저장"}
        </button>
      </div>
    </div>
  );
}
