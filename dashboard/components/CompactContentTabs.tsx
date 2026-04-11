"use client";

import { Children, type ReactNode, useMemo, useState } from "react";

import HorizontalTabRail from "@/components/HorizontalTabRail";

type CompactContentTab = {
  key: string;
  label: string;
  subtitle?: string;
  badge?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function CompactContentTabs({
  tabs,
  children,
}: {
  tabs: CompactContentTab[];
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
        frameClassName="rounded-xl border border-slate-200 bg-slate-50/70 p-1.5 shadow-none"
        listClassName="pb-0"
        itemClassName="min-w-[10.5rem] border px-3 py-2.5"
        selectedItemClassName="border-indigo-200 bg-white text-slate-900 shadow-[0_2px_10px_rgba(99,102,241,0.12)]"
        unselectedItemClassName="border-transparent bg-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-800"
        renderItem={(item, isSelected) => (
          <div className="min-w-0 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold leading-5">{item.label}</span>
              {item.badge ? (
                <span
                  className={joinClasses(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-4",
                    isSelected
                      ? "bg-slate-900/5 text-slate-700 ring-1 ring-inset ring-slate-200"
                      : "bg-slate-900/5 text-slate-500 ring-1 ring-inset ring-slate-200",
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </div>
            {item.subtitle ? (
              <p
                className={joinClasses(
                  "truncate text-[11px] leading-4",
                  isSelected ? "text-slate-600" : "text-slate-400",
                )}
              >
                {item.subtitle}
              </p>
            ) : null}
          </div>
        )}
      />

      <div key={tabs[selectedIndex]?.key ?? tabs[0].key}>{activeChild}</div>
    </div>
  );
}
