"use client";

import { Children, type ReactNode, useMemo, useState } from "react";
import HorizontalTabRail from "@/components/HorizontalTabRail";

type HoldingTabItem = {
  key: string;
  label: string;
  code?: string | null;
  profitRate: string;
  profitRateValue: number | null;
  profitLoss: string;
  profitLossValue: number | null;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function metricClass(value: number | null | undefined, emphasis: "strong" | "soft") {
  if (typeof value !== "number" || Number.isNaN(value) || value === 0) {
    return emphasis === "strong" ? "text-slate-700" : "text-slate-500";
  }
  if (value > 0) {
    return emphasis === "strong" ? "text-rose-700" : "text-rose-600";
  }
  return emphasis === "strong" ? "text-sky-700" : "text-sky-600";
}

export default function HoldingTabs({
  tabs,
  children,
}: {
  tabs: HoldingTabItem[];
  children: ReactNode;
}) {
  const childArray = useMemo(() => Children.toArray(children), [children]);
  const [selectedKey, setSelectedKey] = useState(tabs[0]?.key ?? "");

  if (tabs.length === 0) return null;

  const selectedIndex = Math.max(
    0,
    tabs.findIndex((item) => item.key === selectedKey),
  );

  return (
    <div className="grid gap-4">
      <HorizontalTabRail
        items={tabs}
        getKey={(item) => item.key}
        selectedKey={tabs[selectedIndex]?.key ?? tabs[0].key}
        onSelect={setSelectedKey}
        sticky
        stickyClassName="top-[calc(var(--desktop-nav-offset,5.25rem)+var(--account-tabs-gap,0.25rem)+var(--account-tabs-sticky-height,88px)+4px)] z-20"
        frameLabel={null}
        frameClassName="p-0 shadow-none"
        listClassName="pb-0"
        itemClassName="min-w-[12.5rem] rounded-[0.9rem] border px-3 py-2"
        selectedItemClassName="border-blue-300 bg-white text-slate-900 shadow-[0_2px_8px_rgba(59,130,246,0.12)]"
        unselectedItemClassName="border-slate-300 bg-slate-50 text-slate-600 hover:border-blue-200 hover:bg-blue-50/55 hover:backdrop-blur-md hover:text-slate-900"
        renderItem={(item, isSelected) => (
          <div className="min-w-0">
            <span className="block truncate text-[10.5px] font-semibold leading-4">
              {item.label}
            </span>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] leading-4">
              <span
                className={joinClasses(
                  "font-semibold",
                  metricClass(item.profitRateValue, isSelected ? "strong" : "soft"),
                )}
              >
                {item.profitRate}
              </span>
              <span className="text-slate-300">/</span>
              <span
                className={joinClasses(
                  "font-medium",
                  metricClass(item.profitLossValue, isSelected ? "strong" : "soft"),
                )}
              >
                {item.profitLoss}
              </span>
            </div>
          </div>
        )}
      />

      <div key={tabs[selectedIndex]?.key ?? tabs[0].key}>{childArray[selectedIndex] ?? null}</div>
    </div>
  );
}
