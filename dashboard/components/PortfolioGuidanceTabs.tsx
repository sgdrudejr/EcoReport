"use client";

import { useMemo, useState } from "react";
import type { AccountGuide } from "@/lib/portfolio-guidance";

function categoryBarWidth(value: number) {
  return `${Math.max(0, Math.min(100, value * 100))}%`;
}

function formatSignedCurrency(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}원`;
}

function formatSignedPercent(value: number | null) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(digits)}%`;
}

function getStatusClass(status: AccountGuide["status"]) {
  if (status === "양호") {
    return "bg-emerald-950/40 text-emerald-300 border-emerald-900/50";
  }
  if (status === "보강 필요") {
    return "bg-amber-950/40 text-amber-300 border-amber-900/50";
  }
  return "bg-red-950/40 text-red-300 border-red-900/50";
}

export default function PortfolioGuidanceTabs({
  accounts,
}: {
  accounts: AccountGuide[];
}) {
  const [selectedKey, setSelectedKey] = useState(accounts[0]?.key ?? "");

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.key === selectedKey) ?? accounts[0] ?? null,
    [accounts, selectedKey],
  );

  if (!selectedAccount) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {accounts.map((account) => {
          const isSelected = account.key === selectedAccount.key;
          const holdingsProfitClass =
            account.holdingsProfitLoss > 0
              ? "text-emerald-400"
              : account.holdingsProfitLoss < 0
                ? "text-red-400"
                : "text-zinc-300";

          return (
            <button
              key={account.key}
              type="button"
              onClick={() => setSelectedKey(account.key)}
              className={`rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? "border-emerald-500/60 bg-emerald-950/20 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]"
                  : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{account.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">계좌별 운용 점수</p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(account.status)}`}>
                  {account.status}
                </span>
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                <p className="text-3xl font-semibold tabular-nums text-zinc-100">
                  {account.score}점
                </p>
                <div className="text-right text-xs text-zinc-500">
                  <p>이번 단계 투입</p>
                  <p className="mt-1 font-medium text-zinc-300">
                    {account.recommendedDeploy.toLocaleString()}원
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-zinc-500">보유 손익</p>
                  <p className={`mt-1 font-medium ${holdingsProfitClass}`}>
                    {formatSignedCurrency(account.holdingsProfitLoss)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">보유 수익률</p>
                  <p className={`mt-1 font-medium ${holdingsProfitClass}`}>
                    {formatSignedPercent(account.holdingsProfitRate)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                <span>배분 {account.allocationScore}점</span>
                <span>·</span>
                <span>
                  기술 {account.technicalScore != null ? `${account.technicalScore}점` : "-"}
                </span>
                {account.reportCoverageScore != null && (
                  <>
                    <span>·</span>
                    <span>리포트 {account.reportCoverageScore}점</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-zinc-100">{selectedAccount.label}</h3>
              <span
                className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(selectedAccount.status)}`}
              >
                {selectedAccount.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">{selectedAccount.note}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500">운용 점수</p>
            <p className="text-2xl font-semibold tabular-nums text-zinc-100">
              {selectedAccount.score}점
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">이번 단계 투입</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
              {selectedAccount.recommendedDeploy.toLocaleString()}원
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">대기 자금</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
              {selectedAccount.reserveCash.toLocaleString()}원
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">보유 손익</p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                selectedAccount.holdingsProfitLoss > 0
                  ? "text-emerald-400"
                  : selectedAccount.holdingsProfitLoss < 0
                    ? "text-red-400"
                    : "text-zinc-100"
              }`}
            >
              {formatSignedCurrency(selectedAccount.holdingsProfitLoss)}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">보유 수익률</p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                (selectedAccount.holdingsProfitRate ?? 0) > 0
                  ? "text-emerald-400"
                  : (selectedAccount.holdingsProfitRate ?? 0) < 0
                    ? "text-red-400"
                    : "text-zinc-100"
              }`}
            >
              {formatSignedPercent(selectedAccount.holdingsProfitRate)}
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">배분 점수</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
              {selectedAccount.allocationScore}점
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">기술 점수</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
              {selectedAccount.technicalScore != null ? `${selectedAccount.technicalScore}점` : "-"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">리포트 점수</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
              {selectedAccount.reportCoverageScore != null
                ? `${selectedAccount.reportCoverageScore}점`
                : "-"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs text-zinc-500">Stage 2 bias</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
              {selectedAccount.stage2Bias ?? "-"}
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-zinc-200">현재 배분 vs 목표</h4>
            {selectedAccount.categories.map((category) => (
              <div key={`${selectedAccount.key}-${category.category}`} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-200">{category.category}</span>
                  <span
                    className={
                      category.action === "보강 필요"
                        ? "text-amber-300"
                        : category.action === "비중 축소"
                          ? "text-red-300"
                          : "text-zinc-400"
                    }
                  >
                    {category.action}
                  </span>
                </div>
                <div className="rounded-full bg-zinc-800 h-2 overflow-hidden">
                  <div
                    className="bg-zinc-500/80 h-2"
                    style={{ width: categoryBarWidth(category.currentPct) }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>현재 {formatPercent(category.currentPct * 100)}</span>
                  <span>목표 {formatPercent(category.targetPct * 100)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-zinc-200">실행 가이드</h4>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
              <div>
                <p className="text-xs text-zinc-500">왜 이 점수인가</p>
                <ul className="mt-1 space-y-1 text-sm text-zinc-100">
                  {selectedAccount.scoreDrivers.map((driver) => (
                    <li key={driver}>- {driver}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs text-zinc-500">점수를 올리려면</p>
                <ul className="mt-1 space-y-1 text-sm text-zinc-100">
                  {selectedAccount.improvementActions.length > 0 ? (
                    selectedAccount.improvementActions.map((action) => (
                      <li key={action}>- {action}</li>
                    ))
                  ) : (
                    <li>- 현재는 급한 수정 없이 유지가 적절합니다.</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="text-xs text-zinc-500">기술 상위 신호</p>
                <p className="mt-1 text-sm text-zinc-100">
                  {selectedAccount.topSignals.length > 0
                    ? selectedAccount.topSignals.join(", ")
                    : "보유 종목 기술 신호 데이터가 아직 부족합니다."}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">우선 후보</p>
                <p className="mt-1 text-sm text-zinc-100">
                  {selectedAccount.candidates.length > 0
                    ? selectedAccount.candidates.join(", ")
                    : "현재는 신규 보강보다 유지 우선"}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">현금 비중</p>
                <p className="mt-1 text-sm text-zinc-100">
                  현재 {formatPercent(selectedAccount.cashPct * 100)} / 목표{" "}
                  {formatPercent(selectedAccount.targetCashPct * 100)}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">실행 리듬</p>
                <p className="mt-1 text-sm text-zinc-100">
                  오늘 1차 진입 후 1~2거래일 안에 눌림목 또는 방향 확인 시 2차, 이후 재평가합니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
