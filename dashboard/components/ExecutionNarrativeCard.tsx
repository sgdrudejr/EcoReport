"use client";

import { useMemo, useState } from "react";

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
    return "bg-rose-50/70 text-rose-700 decoration-rose-300/90";
  }
  if (tone === "neutral") {
    return "bg-amber-50/80 text-amber-800 decoration-amber-300/90";
  }
  if (tone === "positive") {
    return "bg-sky-50/80 text-sky-700 decoration-sky-300/90";
  }
  if (tone === "defensive") {
    return "bg-emerald-50/80 text-emerald-700 decoration-emerald-300/90";
  }
  return "bg-slate-100/80 text-slate-700 decoration-slate-300";
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
          "mx-[1px] inline rounded-[0.35rem] px-[0.18em] py-[0.02em] align-baseline text-[0.98em] font-medium underline decoration-2 underline-offset-[0.18em] [box-decoration-break:clone]",
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

  return (
    <div className="relative">
      <p className="mt-1 text-[14px] leading-[1.66]">
        {renderHighlightedText(open ? normalized : preview, highlights)}
      </p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-2 inline-flex items-center rounded-full border border-current/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-current transition hover:bg-white"
        >
          {open ? "접기" : "더보기"}
        </button>
      ) : null}
    </div>
  );
}
