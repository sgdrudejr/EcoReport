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
  if (value == null || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

function getStatusClass(status: AccountGuide["status"]) {
  if (status === "양호") return "border-emerald-900/60 bg-emerald-950/30 text-emerald-300";
  if (status === "보강 필요") return "border-amber-900/60 bg-amber-950/30 text-amber-300";
  return "border-red-900/60 bg-red-950/30 text-red-300";
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-red-400"
        : "text-zinc-100";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function InfoBlock({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4">
      <p className="text-xs text-zinc-500">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-zinc-100">
        {items.length > 0 ? items.map((item) => <li key={item}>- {item}</li>) : <li>- 내용 없음</li>}
      </ul>
    </div>
  );
}

function DesktopSelector({
  accounts,
  selectedKey,
  onSelect,
}: {
  accounts: AccountGuide[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="hidden md:grid md:grid-cols-3 gap-3">
      {accounts.map((account) => {
        const isSelected = account.key === selectedKey;
        const toneClass =
          account.holdingsProfitLoss > 0
            ? "text-emerald-400"
            : account.holdingsProfitLoss < 0
              ? "text-red-400"
              : "text-zinc-300";

        return (
          <button
            key={account.key}
            type="button"
            onClick={() => onSelect(account.key)}
            className={`rounded-2xl border p-4 text-left transition ${
              isSelected
                ? "border-emerald-500/60 bg-emerald-950/20 shadow-[0_0_0_1px_rgba(16,185,129,0.16)]"
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

            <div className="mt-4 flex items-end justify-between gap-3">
              <p className="text-3xl font-semibold tabular-nums text-zinc-100">{account.score}점</p>
              <div className="text-right text-xs text-zinc-500">
                <p>이번 단계 투입</p>
                <p className="mt-1 font-medium text-zinc-300">{account.recommendedDeploy.toLocaleString()}원</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-zinc-500">보유 손익</p>
                <p className={`mt-1 font-medium ${toneClass}`}>{formatSignedCurrency(account.holdingsProfitLoss)}</p>
              </div>
              <div>
                <p className="text-zinc-500">보유 수익률</p>
                <p className={`mt-1 font-medium ${toneClass}`}>{formatSignedPercent(account.holdingsProfitRate)}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
              <span>배분 {account.allocationScore}점</span>
              <span>기술 {account.technicalScore != null ? `${account.technicalScore}점` : "-"}</span>
              {account.reportScore != null && <span>리포트 {account.reportScore}점</span>}
              {account.riskPenaltyTotal != null && <span>패널티 {account.riskPenaltyTotal}점</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MobileSelector({
  accounts,
  selectedKey,
  onSelect,
}: {
  accounts: AccountGuide[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="md:hidden -mx-4 overflow-x-auto px-4">
      <div className="flex gap-3 pb-1">
        {accounts.map((account) => {
          const isSelected = account.key === selectedKey;
          return (
            <button
              key={account.key}
              type="button"
              onClick={() => onSelect(account.key)}
              className={`min-w-[220px] rounded-2xl border px-4 py-3 text-left ${
                isSelected
                  ? "border-emerald-500/60 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-900"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-zinc-100">{account.label}</p>
                <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(account.status)}`}>
                  {account.score}점
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{account.status} · 이번 단계 {account.recommendedDeploy.toLocaleString()}원</p>
              <p className="mt-2 text-sm text-zinc-300">
                보유 손익 {formatSignedCurrency(account.holdingsProfitLoss)} · {formatSignedPercent(account.holdingsProfitRate)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PortfolioGuidanceTabs({ accounts }: { accounts: AccountGuide[] }) {
  const [selectedKey, setSelectedKey] = useState(accounts[0]?.key ?? "");

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.key === selectedKey) ?? accounts[0] ?? null,
    [accounts, selectedKey],
  );

  if (!selectedAccount) return null;

  const holdingsTone =
    selectedAccount.holdingsProfitLoss > 0
      ? "good"
      : selectedAccount.holdingsProfitLoss < 0
        ? "bad"
        : "default";

  return (
    <div className="space-y-4">
      <DesktopSelector accounts={accounts} selectedKey={selectedAccount.key} onSelect={setSelectedKey} />
      <MobileSelector accounts={accounts} selectedKey={selectedAccount.key} onSelect={setSelectedKey} />

      <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-4 md:p-6 space-y-4">
        <div className="grid gap-4 md:grid-cols-[1.3fr,0.7fr] md:items-start">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold text-zinc-100">{selectedAccount.label}</h3>
              <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(selectedAccount.status)}`}>
                {selectedAccount.status}
              </span>
            </div>
            <p className="text-sm text-zinc-400">{selectedAccount.note}</p>

            {(selectedAccount.macroSummary || selectedAccount.actionLine) && (
              <div className="rounded-2xl border border-emerald-900/40 bg-emerald-950/10 px-4 py-4">
                <p className="text-xs uppercase tracking-wide text-emerald-300">매크로 → 자산군 → 계좌 액션</p>
                {selectedAccount.macroSummary && (
                  <p className="mt-2 text-sm leading-6 text-zinc-100">{selectedAccount.macroSummary}</p>
                )}
                {selectedAccount.assetFocus.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedAccount.assetFocus.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-sky-900/50 bg-sky-950/20 px-2.5 py-1 text-xs text-sky-300"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
                {selectedAccount.actionLine && (
                  <p className="mt-3 text-sm font-medium leading-6 text-zinc-100">{selectedAccount.actionLine}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="운용 점수" value={`${selectedAccount.score}점`} />
            <MetricCard label="리스크 패널티" value={selectedAccount.riskPenaltyTotal != null ? `-${selectedAccount.riskPenaltyTotal}점` : "-"} tone={selectedAccount.riskPenaltyTotal && selectedAccount.riskPenaltyTotal > 0 ? "bad" : "default"} />
            <MetricCard label="이번 단계 투입" value={`${selectedAccount.recommendedDeploy.toLocaleString()}원`} />
            <MetricCard label="대기 자금" value={`${selectedAccount.reserveCash.toLocaleString()}원`} />
            <MetricCard label="보유 손익" value={formatSignedCurrency(selectedAccount.holdingsProfitLoss)} tone={holdingsTone} />
            <MetricCard label="보유 수익률" value={formatSignedPercent(selectedAccount.holdingsProfitRate)} tone={holdingsTone} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="배분 점수" value={`${selectedAccount.allocationScore}점`} />
          <MetricCard label="기술 점수" value={selectedAccount.technicalScore != null ? `${selectedAccount.technicalScore}점` : "-"} />
          <MetricCard label="리포트 점수" value={selectedAccount.reportScore != null ? `${selectedAccount.reportScore}점` : "-"} />
          <MetricCard label="리포트 커버리지" value={selectedAccount.reportCoverageScore != null ? `${selectedAccount.reportCoverageScore}%` : "-"} />
          <MetricCard label="레짐 적합도" value={selectedAccount.regimeFitScore != null ? `${selectedAccount.regimeFitScore}점` : "-"} />
          <MetricCard label="Stage 2 bias" value={selectedAccount.stage2Bias ?? "-"} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4">
              <h4 className="text-sm font-medium text-zinc-200">현재 배분 vs 목표</h4>
              <div className="mt-4 space-y-3">
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
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-2 bg-zinc-500/80" style={{ width: categoryBarWidth(category.currentPct) }} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>현재 {formatPercent(category.currentPct * 100)}</span>
                      <span>목표 {formatPercent(category.targetPct * 100)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <InfoBlock title="왜 이 점수인가" items={selectedAccount.scoreDrivers} />
            <InfoBlock title="점수를 올리려면" items={selectedAccount.improvementActions} />
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoBlock title="거시 근거" items={selectedAccount.macroDrivers} />
              <InfoBlock title="액션 포인트" items={selectedAccount.actionPoints} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <InfoBlock
                title="기술 상위 신호"
                items={
                  selectedAccount.topSignals.length > 0
                    ? selectedAccount.topSignals
                    : ["보유 종목 기술 신호 데이터가 아직 부족합니다."]
                }
              />
              <InfoBlock
                title="리포트 근거"
                items={
                  selectedAccount.evidenceNotes.length > 0
                    ? selectedAccount.evidenceNotes
                    : ["직접 연결된 리포트 근거가 아직 부족합니다."]
                }
              />
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4">
              <h4 className="text-sm font-medium text-zinc-200">실행 체크리스트</h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
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
                    현재 {formatPercent(selectedAccount.cashPct * 100)} / 목표 {formatPercent(selectedAccount.targetCashPct * 100)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">데이터 커버리지</p>
                  <p className="mt-1 text-sm text-zinc-100">
                    기술 {selectedAccount.techCoverage != null ? formatPercent(selectedAccount.techCoverage * 100) : "-"} / 리포트 {selectedAccount.impactCoverage != null ? formatPercent(selectedAccount.impactCoverage * 100) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">점수 반영 비중</p>
                  <p className="mt-1 text-sm text-zinc-100">
                    {selectedAccount.effectiveWeights
                      ? `배분 ${formatPercent((selectedAccount.effectiveWeights.allocation ?? 0) * 100)} / 기술 ${formatPercent((selectedAccount.effectiveWeights.tech ?? 0) * 100)} / 리포트 ${formatPercent((selectedAccount.effectiveWeights.report ?? 0) * 100)} / 레짐 ${formatPercent((selectedAccount.effectiveWeights.regime ?? 0) * 100)} / Stage2 ${formatPercent((selectedAccount.effectiveWeights.stage2 ?? 0) * 100)}`
                      : "-"}
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm text-zinc-300">
                오늘 1차 진입 후 1~2거래일 안에 눌림목 또는 방향 확인 시 2차, 이후 재평가합니다.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
