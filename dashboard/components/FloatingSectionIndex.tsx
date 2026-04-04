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
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (items.length === 0) return;

    const update = () => {
      const scrollY = window.scrollY;
      setIsVisible(scrollY > 240);

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
      className={`pointer-events-none fixed bottom-4 left-4 z-40 transition-all duration-200 ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <div className="pointer-events-auto rounded-2xl border border-zinc-800/80 bg-zinc-950/92 p-2 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          Index
        </div>
        <div className="flex flex-col gap-1.5">
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
                className={`rounded-xl px-3 py-2 text-left text-xs transition ${
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
