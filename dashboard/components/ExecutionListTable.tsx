"use client";

import { useMemo, useState } from "react";
import { useExperimentalUi } from "@/components/ExperimentalUiProvider";
import HorizontalTabRail from "@/components/HorizontalTabRail";

type ExecutionRow = {
  key: string;
  kind: "buy" | "trim" | "hold";
  accountKeys: string[];
  accounts: string[];
  name: string;
  code: string | null;
  amountLabel: string;
  reason: string;
  hitRateBadge?: string | null;
  confidenceLevel?: "high" | "medium" | "low" | null;
};

type ExecutionAccountFilter = {
  key: string;
  label: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function executionKindLabel(kind: ExecutionRow["kind"]) {
  if (kind === "buy") return "매수";
  if (kind === "trim") return "매도";
  return "보유";
}

function executionKindClassName(kind: ExecutionRow["kind"]) {
  if (kind === "buy") {
    return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  if (kind === "trim") {
    return "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
  }
  return "bg-slate-900/5 text-slate-600 ring-1 ring-inset ring-slate-200";
}

function confidenceBadgeClassName(level: ExecutionRow["confidenceLevel"]) {
  if (level === "high") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  if (level === "low") {
    return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-500/20";
  }
  return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-500/20";
}

export default function ExecutionListTable({
  rows,
  accounts,
  bodyCopyClass,
  bodyNoteMutedClass,
}: {
  rows: ExecutionRow[];
  accounts: ExecutionAccountFilter[];
  bodyCopyClass: string;
  bodyNoteMutedClass: string;
}) {
  const [selectedAccountKey, setSelectedAccountKey] = useState("all");
  const { enabled: experimentalUiEnabled } = useExperimentalUi();

  const tabs = useMemo(
    () => [
      { key: "all", label: "전체" },
      ...accounts.map((account) => ({
        key: account.key,
        label: account.label,
      })),
    ],
    [accounts],
  );

  const filteredRows = useMemo(() => {
    if (selectedAccountKey === "all") {
      return rows;
    }

    return rows.filter((row) => row.accountKeys.includes(selectedAccountKey));
  }, [rows, selectedAccountKey]);

  const filteredSummary = useMemo(
    () => ({
      total: filteredRows.length,
      buy: filteredRows.filter((item) => item.kind === "buy").length,
      trim: filteredRows.filter((item) => item.kind === "trim").length,
      hold: filteredRows.filter((item) => item.kind === "hold").length,
    }),
    [filteredRows],
  );

  const selectedLabel =
    tabs.find((tab) => tab.key === selectedAccountKey)?.label ?? "전체";

  return (
    <div className="space-y-3">
      <HorizontalTabRail
        items={tabs}
        getKey={(item) => item.key}
        selectedKey={selectedAccountKey}
        onSelect={setSelectedAccountKey}
        frameLabel="실행 리스트 보기"
        frameClassName="border-slate-200 bg-slate-50/80"
        itemClassName="min-w-[88px] px-3 py-2.5"
        selectedItemClassName="border-slate-900 bg-slate-900 text-white shadow-none"
        unselectedItemClassName="border-slate-200 bg-white text-slate-600 hover:border-slate-300"
        renderItem={(item, isSelected) => {
          const count =
            item.key === "all"
              ? rows.length
              : rows.filter((row) => row.accountKeys.includes(item.key)).length;

          return (
            <div className="flex items-center justify-between gap-2">
              <span className={joinClasses("text-sm font-medium", isSelected && "text-white")}>
                {item.label}
              </span>
              <span
                className={joinClasses(
                  "rounded-full px-2 py-0.5 text-[11px]",
                  isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500",
                )}
              >
                {count}
              </span>
            </div>
          );
        }}
      />

      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-medium text-white">
          {selectedLabel} {filteredSummary.total}건
        </span>
        {filteredSummary.buy > 0 ? (
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/20">
            매수 {filteredSummary.buy}
          </span>
        ) : null}
        {filteredSummary.trim > 0 ? (
          <span className="rounded-full bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-500/20">
            매도 {filteredSummary.trim}
          </span>
        ) : null}
        {filteredSummary.hold > 0 ? (
          <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            보유 {filteredSummary.hold}
          </span>
        ) : null}
      </div>

      {filteredRows.length > 0 ? (
        <div className="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white">
          <div className="max-h-[26rem] overflow-x-hidden overflow-y-auto">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "54%" }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50 backdrop-blur">
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                  <th className="px-4 py-3">실행 계좌</th>
                  <th className="px-4 py-3">실행 종목</th>
                  <th className="px-4 py-3">실행 금액</th>
                  <th className="px-4 py-3">실행을 위한 구체적인 이유</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.map((row) => (
                  <tr key={row.key} className="align-top">
                    <td className="px-4 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        {row.accounts.map((accountLabel) => (
                          <span
                            key={`${row.key}-${accountLabel}`}
                            className="w-fit max-w-full rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
                          >
                            {accountLabel}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="min-w-0 space-y-2">
                        <span
                          className={joinClasses(
                            "inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium",
                            executionKindClassName(row.kind),
                          )}
                        >
                          {executionKindLabel(row.kind)}
                        </span>
                        {experimentalUiEnabled && row.hitRateBadge ? (
                          <div>
                            <span
                              className={joinClasses(
                                "inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium",
                                confidenceBadgeClassName(row.confidenceLevel),
                              )}
                            >
                              {row.hitRateBadge}
                            </span>
                          </div>
                        ) : null}
                        <div className="min-w-0">
                          <p className="break-keep text-sm font-semibold text-slate-900">
                            {row.name}
                          </p>
                          {row.code ? (
                            <p className="mt-1 text-xs text-slate-400">{row.code}</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-slate-900">
                      {row.amountLabel}
                    </td>
                    <td className="px-4 py-4">
                      <p className={joinClasses(bodyCopyClass, "text-slate-700")}>
                        {row.reason}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div
          className={joinClasses(
            "rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5",
            bodyNoteMutedClass,
            "text-slate-500",
          )}
        >
          {selectedLabel} 기준으로는 아직 표시할 실행 항목이 없습니다.
        </div>
      )}
    </div>
  );
}
