"use client";

import { useEffect, useState } from "react";

export type FloatingSectionIndexItem = {
  number: string;
  id: string;
  label: string;
  secondaryLabel?: string;
};

export default function FloatingSectionIndex({
  items,
}: {
  items: FloatingSectionIndexItem[];
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [visibleItems, setVisibleItems] = useState(items);

  useEffect(() => {
    if (items.length === 0) return;

    const update = () => {
      const mobileViewport = window.innerWidth < 768;
      setIsVisible(!mobileViewport);
      const existingItems = items.filter((item) => document.getElementById(item.id));
      setVisibleItems(existingItems);

      const offset = 160;
      let currentId = existingItems[0]?.id ?? null;

      for (const item of existingItems) {
        const section = document.getElementById(item.id);
        if (!section) continue;
        if (section.getBoundingClientRect().top <= offset) {
          currentId = item.id;
        }
      }

      setActiveId(currentId);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  if (visibleItems.length === 0) return null;

  return (
    <div
      className={`pointer-events-none fixed bottom-5 right-5 z-40 hidden transition-all duration-200 md:block ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <div className="pointer-events-auto group inline-flex flex-col items-end rounded-[1.35rem] border border-white/20 bg-white/10 p-2.5 text-right shadow-[0_16px_38px_rgba(15,23,42,0.12)] transition-colors duration-200 hover:bg-white/80">
        <div className="mb-2 px-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-900/40 transition-colors duration-200 group-hover:text-slate-900/80">
            Section Index
          </p>
        </div>
        <div className="grid justify-items-end gap-1.5">
          {visibleItems.map((item) => {
            const isActive = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  const section = document.getElementById(item.id);
                  if (!section) return;
                  section.scrollIntoView({ behavior: "smooth", block: "start" });
                  setActiveId(item.id);
                }}
                className={`flex w-auto max-w-full flex-col items-end rounded-[1rem] px-3 py-2.5 text-right text-[11px] leading-tight transition duration-200 ${
                  isActive
                    ? "bg-indigo-500/14 text-slate-900/80 shadow-[0_0_0_1px_rgba(99,102,241,0.18)]"
                    : "text-slate-900/40 hover:-translate-x-0.5 hover:bg-white/24 hover:text-slate-900/80 hover:shadow-[0_8px_18px_rgba(15,23,42,0.10)] group-hover:text-slate-900/80"
                }`}
                title={item.label}
              >
                <div className="flex items-center justify-end gap-2">
                  <span className="font-medium">
                    {item.label}
                  </span>
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                      isActive
                        ? "border-indigo-500/40 bg-indigo-500/12 text-slate-900/80"
                        : "border-slate-900/15 bg-white/20 text-slate-900/40 group-hover:text-slate-900/80"
                    }`}
                  >
                    {item.number}
                  </span>
                </div>
                {item.secondaryLabel ? (
                  <span className="mt-0.5 text-slate-900/40 transition-colors duration-200 group-hover:text-slate-900/80">
                    {item.secondaryLabel}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
