"use client";

import { Children, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

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

export default function RecommendationTabs({
  tabs,
  children,
}: {
  tabs: RecommendationTabItem[];
  children: ReactNode;
}) {
  const childArray = useMemo(() => Children.toArray(children), [children]);
  const [selectedKey, setSelectedKey] = useState(tabs[0]?.key ?? "");
  const stickyShellRef = useRef<HTMLDivElement | null>(null);

  const selectedIndex = Math.max(
    0,
    tabs.findIndex((item) => item.key === selectedKey),
  );
  const activeChild = childArray[selectedIndex] ?? null;

  useEffect(() => {
    const element = stickyShellRef.current;
    if (!element) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--recommendation-lane-height",
        `${element.getBoundingClientRect().height}px`,
      );
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  if (tabs.length === 0) return null;

  return (
    <div className="grid gap-0">
      <div
        ref={stickyShellRef}
        className="sticky sticky-nav-primary z-20"
      >
        <HorizontalTabRail
          items={tabs}
          getKey={(item) => item.key}
          selectedKey={tabs[selectedIndex]?.key ?? tabs[0].key}
          onSelect={setSelectedKey}
          frameLabel={null}
          frameClassName="rounded-xl border border-slate-200 bg-slate-50/80 p-1.5 shadow-none"
          listClassName="pb-0"
          itemClassName="min-w-[11rem] border px-3 py-2.5"
          selectedItemClassName="border-blue-300 bg-white text-slate-900 shadow-[0_2px_8px_rgba(59,130,246,0.14)]"
          unselectedItemClassName="border-slate-300 bg-slate-50 text-slate-600 hover:border-blue-200 hover:bg-blue-50/55 hover:text-slate-800"
          renderItem={(item, isSelected) => (
            <div className="min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold leading-5">{item.label}</span>
                <span
                  className={joinClasses(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-4 ring-1 ring-inset",
                    isSelected
                      ? "bg-white text-slate-700 ring-blue-200"
                      : "bg-slate-100 text-slate-600 ring-slate-200",
                  )}
                >
                  {item.count}
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
      </div>

      <div key={tabs[selectedIndex]?.key ?? tabs[0].key}>{activeChild}</div>
    </div>
  );
}
