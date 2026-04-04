"use client";

import { useEffect, useState } from "react";

export type FloatingSectionIndexItem = {
  id: string;
  label: string;
};

export default function FloatingSectionIndex({
  items,
}: {
  items: FloatingSectionIndexItem[];
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (items.length === 0) return;

    const update = () => {
      const mobileViewport = window.innerWidth < 768;
      const scrollY = window.scrollY;
      setIsMobile(mobileViewport);
      setIsVisible(scrollY > (mobileViewport ? 96 : 240));

      const offset = 160;
      let currentId = items[0]?.id ?? null;

      for (const item of items) {
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

  if (items.length === 0) return null;

  return (
    <div
      className={`pointer-events-none fixed z-40 transition-all duration-200 md:bottom-4 md:left-4 ${
        isMobile
          ? "bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] left-3 right-3"
          : "bottom-4 left-4"
      } ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <div className="pointer-events-auto w-fit max-w-full rounded-2xl border border-zinc-800/80 bg-zinc-950 p-2 shadow-[0_12px_30px_rgba(0,0,0,0.35)] md:bg-zinc-950/92 md:backdrop-blur">
        <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          Index
        </div>
        <div className={`flex gap-1.5 ${isMobile ? "overflow-x-auto pb-1" : "flex-col"}`}>
          {items.map((item) => {
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
                className={`shrink-0 rounded-xl px-3 py-2 text-left text-xs transition ${
                  isActive
                    ? "bg-emerald-950/40 text-emerald-300"
                    : "text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
