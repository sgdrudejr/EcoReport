"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ClipboardCheck,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import SectionJumpButton from "@/components/SectionJumpButton";
import type {
  AccountGuide,
  ExecutionGuideItem,
} from "@/lib/portfolio-guidance";

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR");

type PreflightSelection = {
  accountKey: string;
  code: string | null;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "가이드 확인";
  }

  return `${NUMBER_FORMATTER.format(value)}원`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(digits)}%`;
}

function normalizeAccountKey(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value.trim().toUpperCase();

  if (normalized === "ISA") return "ISA";
  if (normalized === "PENSION" || normalized === "연금저축".toUpperCase()) {
    return "PENSION";
  }
  if (normalized === "TOSS" || normalized === "토스증권".toUpperCase()) {
    return "TOSS";
  }
  if (
    normalized === "KIS_MAIN" ||
    normalized === "KIS" ||
    normalized === "한투 일반".toUpperCase() ||
    normalized === "한투증권".toUpperCase() ||
    normalized === "한국투자증권".toUpperCase()
  ) {
    return "KIS_MAIN";
  }

  return null;
}

function getExecutionLabel(kind: ExecutionGuideItem["kind"]) {
  if (kind === "trim") return "비중 축소";
  if (kind === "hold") return "유지";
  return "분할 매수";
}

function getExecutionTone(kind: ExecutionGuideItem["kind"]) {
  if (kind === "trim") {
    return "border-amber-500/25 bg-amber-500/12 text-amber-200";
  }
  if (kind === "hold") {
    return "border-white/8 bg-white/[0.03] text-zinc-300";
  }
  return "border-blue-500/25 bg-blue-500/12 text-blue-200";
}

function getExecutionItems(account: AccountGuide) {
  return [
    ...account.executionBuys,
    ...account.executionTrims,
    ...account.executionHolds,
  ].sort((left, right) => {
    return (right.suggestedAmount ?? 0) - (left.suggestedAmount ?? 0);
  });
}

function syncSelectionToUrl(nextSelection: PreflightSelection | null) {
  const url = new URL(window.location.href);

  if (!nextSelection) {
    url.searchParams.delete("actionAccount");
    url.searchParams.delete("actionCode");
    url.searchParams.delete("preflight");
  } else {
    url.searchParams.set("actionAccount", nextSelection.accountKey);
    if (nextSelection.code) {
      url.searchParams.set("actionCode", nextSelection.code);
    } else {
      url.searchParams.delete("actionCode");
    }
    url.searchParams.set("preflight", "1");
  }

  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function resolveSelection(
  plans: Array<{ account: AccountGuide; executionItems: ExecutionGuideItem[] }>,
  accountKey: string,
  code?: string | null,
) {
  const plan = plans.find((item) => item.account.key === accountKey);
  if (!plan) return null;

  const nextItem =
    plan.executionItems.find((item) => item.code === (code ?? null)) ??
    plan.executionItems[0] ??
    null;

  if (!nextItem) return null;

  return {
    accountKey,
    code: nextItem.code ?? null,
  } satisfies PreflightSelection;
}

function ActionPreflightSheet({
  account,
  item,
  onClose,
  onSelectItem,
}: {
  account: AccountGuide | null;
  item: ExecutionGuideItem | null;
  onClose: () => void;
  onSelectItem: (code: string | null) => void;
}) {
  useEffect(() => {
    if (!account || !item) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeydown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [account, item, onClose]);

  if (!account || !item) return null;

  const executionItems = getExecutionItems(account);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/18 px-3 py-6 backdrop-blur-[6px] md:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[1.8rem] border border-slate-200 bg-white/96 px-4 pb-6 pt-4 shadow-[0_24px_80px_rgba(15,23,42,0.12)] md:px-6 md:pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-14 rounded-full bg-zinc-700 md:hidden" />

        <div className="mt-4 flex items-start justify-between gap-3 md:mt-0">
          <div>
            <p className="section-kicker">Order Preflight</p>
            <h3 className="mt-2 text-2xl font-semibold text-zinc-50">
              {account.label} · {item.name}
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              실제 주문 전에 금액, 계좌 맥락, 대기 자금, 근거를 한 번 더 확인하는 단계입니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/8 bg-white/[0.03] p-2 text-zinc-400 transition hover:bg-white/[0.06]"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        {executionItems.length > 1 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {executionItems.map((candidate, index) => {
              const isSelected =
                (candidate.code ?? candidate.name) === (item.code ?? item.name);

              return (
                <button
                  key={`${account.key}-${candidate.kind}-${candidate.code ?? candidate.name}-${index}`}
                  type="button"
                  onClick={() => onSelectItem(candidate.code ?? null)}
                  className={joinClasses(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    isSelected
                      ? "border-blue-500/60 bg-blue-500/12 text-blue-200"
                      : "border-white/8 bg-white/[0.03] text-zinc-300 hover:border-white/15",
                  )}
                >
                  {candidate.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-[1.05fr,0.95fr]">
          <div className="rounded-[1.5rem] border border-blue-500/20 bg-blue-500/10 p-5">
            <div className="flex items-center gap-2">
              <Wallet size={16} className="text-blue-300" />
              <p className="text-sm font-medium text-zinc-100">권장 집행 금액</p>
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-zinc-50">
              {formatCurrency(item.suggestedAmount)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                <p className="text-[11px] text-zinc-500">이번 단계 예산</p>
                <p className="mt-1 text-base font-semibold text-zinc-100">
                  {formatCurrency(account.recommendedDeploy)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                <p className="text-[11px] text-zinc-500">대기 자금</p>
                <p className="mt-1 text-base font-semibold text-zinc-100">
                  {formatCurrency(account.reserveCash)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-sky-300" />
              <p className="text-sm font-medium text-zinc-100">실행 컨텍스트</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className={joinClasses(
                  "rounded-full border px-2.5 py-1 text-xs",
                  getExecutionTone(item.kind),
                )}
              >
                {getExecutionLabel(item.kind)}
              </span>
              <span className="rounded-full border border-white/8 bg-black/10 px-2.5 py-1 text-xs text-zinc-300">
                현금 {formatPercent(account.cashPct * 100)}
              </span>
              <span className="rounded-full border border-white/8 bg-black/10 px-2.5 py-1 text-xs text-zinc-300">
                목표 현금 {formatPercent(account.targetCashPct * 100)}
              </span>
              <span className="rounded-full border border-white/8 bg-black/10 px-2.5 py-1 text-xs text-zinc-300">
                운용 점수 {account.score}점
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-300">
              {item.reason ?? account.actionLine ?? account.note}
            </p>
            {account.executionReserveNote && (
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                {account.executionReserveNote}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-5">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-blue-300" />
              <p className="text-sm font-medium text-zinc-100">왜 지금인가</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-300">
              <li>- {account.actionLine ?? account.note}</li>
              <li>- {item.reason ?? "기술 점수와 현재 배분 상태를 함께 본 실행 후보입니다."}</li>
              <li>- {account.macroSummary ?? "현재 계좌 전략과 현금 비중 기준으로 정리된 실행 후보입니다."}</li>
            </ul>
          </div>

          <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-5">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={16} className="text-sky-300" />
              <p className="text-sm font-medium text-zinc-100">실행 전 체크</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-300">
              <li>- 최신 분석 실행 후 오늘 기준 리포트와 시장 날짜가 맞는지 확인합니다.</li>
              <li>- {account.label} 계좌의 이번 단계 예산 {formatCurrency(account.recommendedDeploy)} 범위 안에서만 접근합니다.</li>
              <li>- 1차 진입 후 1~2거래일 안에 눌림목 또는 방향 확인 뒤 재평가합니다.</li>
              <li>- 실행 전 계좌 캡처와 보유 금액이 최신 상태인지 다시 확인합니다.</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <SectionJumpButton
            targetId="strategy-overview"
            focusAccountKey={account.key}
            clearSearchParams={["actionAccount", "actionCode", "preflight"]}
            className="inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/12 px-4 py-2 text-sm text-indigo-100 transition hover:bg-indigo-500/20"
          >
            계좌 전략 보기
            <ArrowUpRight size={14} />
          </SectionJumpButton>
          <Link
            href="/portfolio/update"
            className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
          >
            포트 업데이트
            <ArrowUpRight size={14} />
          </Link>
          <Link
            href="/reports"
            className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/12 px-4 py-2 text-sm text-blue-100 transition hover:bg-blue-500/20"
          >
            근거 리포트 보기
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ActionPlaybook({
  accounts,
}: {
  accounts: AccountGuide[];
}) {
  const plans = useMemo(
    () =>
      accounts
        .map((account) => ({
          account,
          executionItems: getExecutionItems(account),
        }))
        .filter(
          (plan) =>
            plan.executionItems.length > 0 ||
            accountHasActionContext(plan.account),
        )
        .sort((left, right) => {
          return right.account.recommendedDeploy - left.account.recommendedDeploy;
        }),
    [accounts],
  );
  const [selection, setSelection] = useState<PreflightSelection | null>(null);

  const activePlan =
    selection != null
      ? plans.find((plan) => plan.account.key === selection.accountKey) ?? null
      : null;
  const activeItem =
    activePlan?.executionItems.find((item) => item.code === selection?.code) ??
    activePlan?.executionItems.find((item) => item.code == null && selection?.code == null) ??
    activePlan?.executionItems[0] ??
    null;

  function openPreflight(accountKey: string, code?: string | null) {
    const nextSelection = resolveSelection(plans, accountKey, code);
    if (!nextSelection) return;

    setSelection(nextSelection);
    syncSelectionToUrl(nextSelection);
  }

  function closePreflight() {
    setSelection(null);
    syncSelectionToUrl(null);
  }

  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const accountKey = normalizeAccountKey(params.get("actionAccount"));
      const code = params.get("actionCode");
      const shouldOpen = params.get("preflight") === "1";

      if (!accountKey || !shouldOpen) {
        setSelection(null);
        return;
      }

      const plan = plans.find((item) => item.account.key === accountKey);
      if (!plan || plan.executionItems.length === 0) {
        setSelection(null);
        return;
      }

      setSelection(resolveSelection(plans, accountKey, code));
    };

    const handlePreflight = (event: Event) => {
      const detail =
        event instanceof CustomEvent && typeof event.detail === "object" && event.detail
          ? (event.detail as {
              accountKey?: string | null;
              code?: string | null;
            })
          : null;

      const accountKey = normalizeAccountKey(detail?.accountKey);
      if (!accountKey) return;

      const nextSelection = resolveSelection(plans, accountKey, detail?.code ?? null);
      if (!nextSelection) return;

      setSelection(nextSelection);
      syncSelectionToUrl(nextSelection);
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener(
      "ecoreport:open-preflight",
      handlePreflight as EventListener,
    );

    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener(
        "ecoreport:open-preflight",
        handlePreflight as EventListener,
      );
    };
  }, [plans]);

  if (plans.length === 0) {
    return null;
  }

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-3">
        {plans.map((plan) => {
          const primaryItem = plan.executionItems[0] ?? null;

          return (
            <article
              key={plan.account.key}
              className="section-block"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="section-kicker">Execution Lane</p>
                  <h3 className="mt-2 text-lg font-semibold text-zinc-50">
                    {plan.account.label}
                  </h3>
                </div>
                <span
                  className={joinClasses(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    plan.account.status === "양호"
                      ? "border-blue-500/25 bg-blue-500/12 text-blue-200"
                      : plan.account.status === "보강 필요"
                        ? "border-amber-500/25 bg-amber-500/12 text-amber-200"
                        : "border-rose-500/25 bg-rose-500/12 text-rose-200",
                  )}
                >
                  {plan.account.status}
                </span>
              </div>

              <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                오늘 우선 후보
              </p>
              <p className="mt-2 text-xl font-semibold text-zinc-100">
                {primaryItem?.name ?? plan.account.candidates[0] ?? "유지 우선"}
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {primaryItem?.reason ?? plan.account.actionLine ?? plan.account.note}
              </p>

              <div className="mt-4 rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-3 py-3">
                <p className="text-xs text-zinc-500">이번 단계 집행 가능 금액</p>
                <p className="mt-2 text-lg font-semibold tabular-nums text-zinc-50">
                  {formatCurrency(plan.account.recommendedDeploy)}
                </p>
              </div>

              {plan.executionItems.length > 0 && (
                <div className="mt-4 space-y-2">
                  {plan.executionItems.slice(0, 3).map((item, index) => (
                    <div
                      key={`${plan.account.key}-${item.kind}-${item.code ?? item.name}-${index}`}
                      className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {item.name}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.reason ?? "현재 계좌 배분 기준으로 정리된 실행 후보"}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={joinClasses(
                              "inline-flex rounded-full border px-2 py-0.5 text-[11px]",
                              getExecutionTone(item.kind),
                            )}
                          >
                            {getExecutionLabel(item.kind)}
                          </span>
                          <p className="mt-2 text-sm font-semibold tabular-nums text-zinc-100">
                            {formatCurrency(item.suggestedAmount)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {primaryItem && (
                  <button
                    type="button"
                    onClick={() => openPreflight(plan.account.key, primaryItem.code)}
                    className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/12 px-4 py-2 text-sm text-blue-100 transition hover:bg-blue-500/20"
                  >
                    주문 프리플로우
                  </button>
                )}
                <SectionJumpButton
                  targetId="strategy-overview"
                  focusAccountKey={plan.account.key}
                  clearSearchParams={["actionAccount", "actionCode", "preflight"]}
                  className="inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/12 px-4 py-2 text-sm text-indigo-100 transition hover:bg-indigo-500/20"
                >
                  계좌 전략 열기
                  <ArrowUpRight size={14} />
                </SectionJumpButton>
              </div>
            </article>
          );
        })}
      </div>

      <ActionPreflightSheet
        account={activePlan?.account ?? null}
        item={activeItem}
        onClose={closePreflight}
        onSelectItem={(code) => {
          if (!activePlan) return;
          openPreflight(activePlan.account.key, code);
        }}
      />
    </>
  );
}

function accountHasActionContext(account: AccountGuide) {
  return Boolean(
    account.actionLine ||
      account.executionBuys.length > 0 ||
      account.executionTrims.length > 0 ||
      account.executionHolds.length > 0,
  );
}
