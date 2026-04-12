"use client";

import { Children, type ReactNode, useMemo, useState } from "react";

import HorizontalTabRail from "@/components/HorizontalTabRail";

type RecommendationItemTab = {
  key: string;
  label: string;
  scoreLabel: string;
  targetLabel: string;
};

export default function RecommendationItemTabs({
  tabs,
  children,
}: {
  tabs: RecommendationItemTab[];
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
        stickyClassName="top-[calc(var(--desktop-nav-offset,5.25rem)+var(--recommendation-lane-height,84px)+8px)] z-20"
        frameLabel={null}
        frameClassName="relative rounded-xl border border-slate-200 bg-slate-50/80 p-0 shadow-none before:absolute before:-top-2 before:inset-x-0 before:h-2 before:border-x before:border-slate-200 before:bg-slate-50/80 before:content-['']"
        listClassName="pb-0"
        itemClassName="min-w-[12rem] rounded-[0.9rem] border px-3 py-2"
        selectedItemClassName="border-blue-300 bg-white text-slate-900 shadow-[0_2px_8px_rgba(59,130,246,0.12)]"
        unselectedItemClassName="border-slate-300 bg-slate-50 text-slate-600 hover:border-blue-200 hover:bg-blue-50/55 hover:backdrop-blur-md hover:text-slate-900"
        renderItem={(item) => (
          <div className="min-w-0">
            <span className="block truncate text-[10.5px] font-semibold leading-4">
              {item.label}
            </span>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] leading-4">
              <span className="font-semibold text-slate-700">{item.scoreLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="font-medium text-slate-500">{item.targetLabel}</span>
            </div>
          </div>
        )}
      />

      <div key={tabs[selectedIndex]?.key ?? tabs[0].key}>{childArray[selectedIndex] ?? null}</div>
    </div>
  );
}
