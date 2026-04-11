"use client";

import { type ReactNode } from "react";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function HorizontalTabRail<T>({
  items,
  getKey,
  selectedKey,
  onSelect,
  renderItem,
  sticky = false,
  stickyClassName,
  frameLabel,
  frameClassName,
  listClassName,
  itemClassName,
  selectedItemClassName,
  unselectedItemClassName,
}: {
  items: T[];
  getKey: (item: T) => string;
  selectedKey: string;
  onSelect: (key: string) => void;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  sticky?: boolean;
  stickyClassName?: string;
  frameLabel?: string | null;
  frameClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  selectedItemClassName?: string;
  unselectedItemClassName?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className={joinClasses(
        sticky && "sticky top-2 z-20 -mx-2 px-2",
        stickyClassName,
      )}
    >
      <div
        className={joinClasses(
          "rounded-xl border border-slate-200 bg-slate-50/70 p-1.5 shadow-none",
          frameClassName,
        )}
      >
        {frameLabel ? (
          <div className="mb-2 px-1 text-[11px] uppercase tracking-wide text-slate-500">
            {frameLabel}
          </div>
        ) : null}

        <div
          role="tablist"
          className={joinClasses(
            "-mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden touch-pan-x [overscroll-behavior-x:contain] [scroll-snap-type:x_proximity]",
            listClassName,
          )}
          style={{
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-x pinch-zoom",
          }}
        >
          <div className="flex min-w-max gap-2 px-1">
            {items.map((item) => {
              const key = getKey(item);
              const isSelected = key === selectedKey;

              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={(event) => {
                    onSelect(key);
                    event.currentTarget.scrollIntoView({
                      behavior: "smooth",
                      block: "nearest",
                      inline: "center",
                    });
                  }}
                  className={joinClasses(
                    "shrink-0 snap-start rounded-2xl border px-4 py-3 text-left transition select-none",
                    itemClassName,
                    isSelected ? selectedItemClassName : unselectedItemClassName,
                  )}
                  style={{ touchAction: "manipulation" }}
                >
                  {renderItem(item, isSelected)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
