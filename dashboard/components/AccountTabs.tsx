"use client";

import { Children, type ReactNode, useMemo, useState } from "react";
import HorizontalTabRail from "@/components/HorizontalTabRail";

type AccountTabItem = {
  key: string;
  label: string;
  status: string;
  profitRate: string;
  profitRateValue: number | null;
  score: string;
  scoreValue: number | null;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusClass(status: string) {
  if (status === "양호") {
    return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  if (status === "보강 필요") {
    return "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20";
  }
  if (status === "조정 필요") {
    return "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
  }
  return "bg-slate-900/5 text-slate-600 ring-1 ring-inset ring-slate-200";
}

function selectedStatusClass(status: string) {
  if (status === "양호") {
    return "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200";
  }
  if (status === "보강 필요") {
    return "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200";
  }
  if (status === "조정 필요") {
    return "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200";
  }
  return "bg-white text-slate-700 ring-1 ring-inset ring-slate-200";
}

function profitRateClass(value: number | null | undefined, isSelected: boolean) {
  if (typeof value !== "number" || Number.isNaN(value) || value === 0) {
    return isSelected
      ? "bg-white text-slate-700 ring-1 ring-inset ring-slate-200"
      : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
  }
  if (value > 0) {
    return isSelected
      ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200"
      : "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
  }
  return isSelected
    ? "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200"
    : "bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/20";
}

function scoreClass(value: number | null | undefined, isSelected: boolean) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return isSelected
      ? "bg-white text-slate-700 ring-1 ring-inset ring-slate-200"
      : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
  }
  if (value >= 85) {
    return isSelected
      ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
      : "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  if (value >= 70) {
    return isSelected
      ? "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200"
      : "bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/20";
  }
  if (value >= 55) {
    return isSelected
      ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"
      : "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20";
  }
  if (value >= 40) {
    return isSelected
      ? "bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200"
      : "bg-orange-500/10 text-orange-700 ring-1 ring-inset ring-orange-500/20";
  }
  return isSelected
    ? "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
    : "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
}

export default function AccountTabs({
  tabs,
  children,
}: {
  tabs: AccountTabItem[];
  children: ReactNode;
}) {
  const childArray = useMemo(() => Children.toArray(children), [children]);
  const [selectedKey, setSelectedKey] = useState(tabs[0]?.key ?? "");

  const selectedIndex = Math.max(
    0,
    tabs.findIndex((item) => item.key === selectedKey),
  );
  const activeChild = childArray[selectedIndex] ?? null;

  if (tabs.length === 0) return null;

  return (
    <div className="grid gap-4">
      <HorizontalTabRail
        items={tabs}
        getKey={(item) => item.key}
        selectedKey={tabs[selectedIndex]?.key ?? tabs[0].key}
        onSelect={setSelectedKey}
        sticky
        stickyClassName="top-2 z-30 md:top-[calc(var(--desktop-nav-offset,5.25rem)+var(--account-tabs-gap,0.25rem))]"
        frameLabel={null}
        frameClassName="rounded-[1.3rem] border-slate-200/90 bg-white/96 p-1.5 shadow-[0_16px_30px_rgba(15,23,42,0.08)]"
        listClassName="pb-0"
        itemClassName="min-w-[11.5rem] border px-3.5 py-2.5"
        selectedItemClassName="border-sky-200 bg-sky-50 text-slate-900 shadow-[0_12px_22px_rgba(59,130,246,0.12)]"
        unselectedItemClassName="border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        renderItem={(item, isSelected) => (
          <div className="min-w-0 space-y-1">
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-5">{item.label}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10.5px] leading-4">
              <span
                className={joinClasses(
                  "shrink-0 rounded-full px-1.5 py-0.5 font-semibold tracking-[-0.01em]",
                  profitRateClass(item.profitRateValue, isSelected),
                )}
              >
                {item.profitRate}
              </span>
              <span
                className={joinClasses(
                  "shrink-0 rounded-full px-1.5 py-0.5 font-semibold tracking-[-0.01em]",
                  scoreClass(item.scoreValue, isSelected),
                )}
              >
                {item.score}
              </span>
              <span
                className={joinClasses(
                  "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-4",
                  isSelected ? selectedStatusClass(item.status) : statusClass(item.status),
                )}
              >
                {item.status}
              </span>
            </div>
          </div>
        )}
      />

      <div key={tabs[selectedIndex]?.key ?? tabs[0].key}>{activeChild}</div>
    </div>
  );
}
