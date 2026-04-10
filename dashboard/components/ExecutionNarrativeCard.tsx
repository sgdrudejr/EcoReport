"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

type HighlightSpec = {
  token: string;
  tone: "negative" | "neutral" | "positive" | "defensive" | "other";
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function shorten(value: string, limit = 120) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightClassName(tone: HighlightSpec["tone"]) {
  if (tone === "negative") {
    return "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20";
  }
  if (tone === "neutral") {
    return "bg-amber-400/15 text-amber-800 ring-1 ring-inset ring-amber-400/30";
  }
  if (tone === "positive") {
    return "bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/20";
  }
  if (tone === "defensive") {
    return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20";
  }
  return "bg-slate-900/5 text-slate-700 ring-1 ring-inset ring-slate-200";
}

function renderHighlightedText(
  text: string | null | undefined,
  highlights: HighlightSpec[] | undefined,
) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const tokens = (highlights ?? [])
    .filter((item) => item.token && item.token.length >= 2)
    .sort((left, right) => right.token.length - left.token.length);

  if (tokens.length === 0) {
    return normalized;
  }

  const pattern = new RegExp(
    `(${tokens.map((item) => escapeRegExp(item.token)).join("|")})`,
    "g",
  );
  const tokenMap = new Map(tokens.map((item) => [item.token, item]));

  return normalized.split(pattern).map((part, index) => {
    const highlight = tokenMap.get(part);
    if (!highlight) {
      return part;
    }

    return (
      <span
        key={`${highlight.token}-${index}`}
        className={joinClasses(
          "mx-px inline-block rounded-[0.45rem] px-1.5 py-px align-baseline text-[0.92em] font-medium leading-[1.2]",
          highlightClassName(highlight.tone),
        )}
      >
        {highlight.token}
      </span>
    );
  });
}

export default function ExecutionNarrativeCard({
  text,
  tone,
  highlights,
}: {
  text: string;
  tone: "buy" | "trim" | "hold";
  highlights?: HighlightSpec[];
}) {
  const [open, setOpen] = useState(false);
  const normalized = normalizeText(text);
  const preview = useMemo(() => shorten(normalized, 112), [normalized]);
  const canExpand =
    normalized.length > preview.length || normalized.includes("...") || normalized.includes("…");

  const popupTone =
    tone === "buy"
      ? "border-emerald-200 bg-white text-slate-700"
      : tone === "trim"
        ? "border-rose-200 bg-white text-slate-700"
        : "border-slate-200 bg-white text-slate-700";

  return (
    <div className="relative">
      <p className="mt-1 leading-6">{renderHighlightedText(preview, highlights)}</p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-2 inline-flex items-center rounded-full border border-current/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-current transition hover:bg-white"
        >
          {open ? "접기" : "더보기"}
        </button>
      ) : null}

      {open ? (
        <div
          className={joinClasses(
            "absolute inset-x-0 top-full z-20 mt-2 rounded-[1.15rem] border p-4 shadow-[0_18px_34px_rgba(15,23,42,0.12)]",
            popupTone,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              상세 메모
            </p>
            <button
              type="button"
              aria-label="닫기"
              onClick={() => setOpen(false)}
              className="rounded-full border border-slate-200 bg-slate-50 p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            >
              <X size={14} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            {renderHighlightedText(normalized, highlights)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
