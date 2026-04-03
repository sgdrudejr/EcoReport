"use client";

import { useMemo, useState } from "react";
import { ImagePlus, Plus, Save, Trash2 } from "lucide-react";

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

type PreviewMap = Record<string, { name: string; url: string }[]>;

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

export default function PortfolioEditor({
  initialSnapshot,
}: {
  initialSnapshot: Snapshot;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [previews, setPreviews] = useState<PreviewMap>({});
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

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
    setSnapshot((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.key === accountKey ? updater(account) : account,
      ),
    }));
  }

  function handleScreenshotChange(accountKey: string, files: FileList | null) {
    const nextPreviews =
      files == null
        ? []
        : Array.from(files).map((file) => ({
            name: file.name,
            url: URL.createObjectURL(file),
          }));

    setPreviews((current) => ({
      ...current,
      [accountKey]: nextPreviews,
    }));

    updateAccount(accountKey, (account) => ({
      ...account,
      screenshots: nextPreviews.map((item) => item.name),
    }));
  }

  async function handleSave() {
    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch("/api/portfolio/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: {
            ...snapshot,
            date: new Date().toISOString().slice(0, 10),
            updatedAt: new Date().toISOString(),
            source: {
              ...snapshot.source,
              method: "screenshot_review",
            },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return;
      }

      setStatus("ok");
      setMessage("포트폴리오 스냅샷이 저장됐습니다. 잠시 후 배포에 반영됩니다.");
      setSnapshot((current) => ({
        ...current,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      }));
    } catch {
      setStatus("error");
      setMessage("네트워크 오류로 저장하지 못했습니다.");
    }
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
              계좌별 캡처를 올리고 숫자를 한 번 검토한 뒤 저장하세요.
              업로드한 이미지는 미리보기용이며 숫자 데이터만 저장됩니다.
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
                계좌 전체 요약 화면 + 보유 종목 화면을 캡처해서 올려두면
                검토가 쉬워집니다.
              </p>
            </div>
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
          </div>

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
