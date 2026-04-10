"use client";

import { Children, type ReactNode, useMemo, useState } from "react";

import HorizontalTabRail from "@/components/HorizontalTabRail";

type RecommendationTabItem = {
  key: string;
  label: string;
  count: number;
  subtitle: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function tabTone(key: string, isSelected: boolean) {
  if (key === "core") {
    return isSelected
      ? "border-slate-950 text-slate-950"
      : "border-transparent text-slate-500 hover:text-slate-900";
  }
  if (key === "sector") {
    return isSelected
      ? "border-sky-700 text-sky-800"
      : "border-transparent text-slate-500 hover:text-sky-900";
  }
  return isSelected
    ? "border-emerald-700 text-emerald-800"
    : "border-transparent text-slate-500 hover:text-emerald-900";
}

export default function RecommendationTabs({
  tabs,
  children,
}: {
  tabs: RecommendationTabItem[];
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
        frameLabel={null}
        frameClassName="border-b border-slate-200/80 bg-transparent p-0 shadow-none"
        listClassName="pb-0"
        itemClassName="min-w-[10rem] border-0 bg-transparent p-0 shadow-none"
        selectedItemClassName="border-0 bg-transparent shadow-none"
        unselectedItemClassName="border-0 bg-transparent shadow-none"
        renderItem={(item, isSelected) => (
          <div
            className={joinClasses(
              "min-w-0 space-y-1 border-b-2 px-1 pb-3 pt-1",
              tabTone(item.key, isSelected),
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold leading-5">{item.label}</span>
              <span
                className={joinClasses(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-4",
                  isSelected
                    ? "bg-slate-900/5 text-slate-700 ring-1 ring-inset ring-slate-200"
                    : "bg-slate-900/5 text-slate-600 ring-1 ring-inset ring-slate-200",
                )}
              >
                {item.count}개
              </span>
            </div>
            <p
              className={joinClasses(
                "truncate text-[11px] leading-4",
                isSelected ? "text-slate-600" : "text-slate-400",
              )}
            >
              {item.subtitle}
            </p>
          </div>
        )}
      />

      <div key={tabs[selectedIndex]?.key ?? tabs[0].key}>{activeChild}</div>
    </div>
  );
}
