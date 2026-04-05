"use client";

import { useEffect, useState } from "react";

export type FloatingSectionIndexItem = {
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
      className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 transition-all duration-200 md:px-6 ${
        isMobile
          ? "bottom-[calc(env(safe-area-inset-bottom,0px)+5.6rem)]"
          : "bottom-4"
      } ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <div className="pointer-events-auto w-full max-w-[34rem] rounded-[1.35rem] border border-zinc-800/80 bg-zinc-950/95 p-2 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
        >
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
                className={`flex min-h-[3.8rem] flex-col items-center justify-center rounded-xl px-2 py-2 text-center text-[11px] leading-tight transition ${
                  isActive
                    ? "bg-emerald-950/40 text-emerald-300"
                    : "text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <span>{item.label}</span>
                {item.secondaryLabel ? (
                  <span className="mt-0.5">{item.secondaryLabel}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
