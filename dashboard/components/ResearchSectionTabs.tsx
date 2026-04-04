"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type SectionTag = {
  label: string;
  tone: "rose" | "sky" | "emerald" | "amber" | "fuchsia" | "zinc";
};

export type ResearchSectionTabItem = {
  id: string;
  label: string;
  title: string;
  body: string;
  tags: SectionTag[];
  actionPoints: string[];
};

function researchTagClass(tone: SectionTag["tone"]) {
  if (tone === "rose") return "border-rose-500/30 bg-rose-950/20 text-rose-300";
  if (tone === "sky") return "border-sky-500/30 bg-sky-950/20 text-sky-300";
  if (tone === "emerald") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (tone === "amber") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  if (tone === "fuchsia") return "border-fuchsia-500/30 bg-fuchsia-950/20 text-fuchsia-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getSectionTone(title: string) {
  if (title.includes("핵심")) {
    return "border-sky-900/50 bg-sky-950/20";
  }
  if (title.includes("거시") || title.includes("매크로")) {
    return "border-amber-900/50 bg-amber-950/20";
  }
  if (title.includes("섹터") || title.includes("성장")) {
    return "border-emerald-900/50 bg-emerald-950/20";
  }
  if (title.includes("포트폴리오") || title.includes("시사점")) {
    return "border-fuchsia-900/50 bg-fuchsia-950/20";
  }
  return "border-zinc-800 bg-zinc-950/70";
}

export default function ResearchSectionTabs({
  sections,
}: {
  sections: ResearchSectionTabItem[];
}) {
  const [selectedSectionId, setSelectedSectionId] = useState(sections[0]?.id ?? "");

  const activeSection =
    sections.find((section) => section.id === selectedSectionId) ?? sections[0] ?? null;

  if (!activeSection) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-2 z-20 -mx-2 px-2">
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/92 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="-mx-1 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-2 px-1">
              {sections.map((section) => {
                const isActive = section.id === activeSection.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setSelectedSectionId(section.id)}
                    className={`min-w-[168px] rounded-2xl border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-emerald-500/60 bg-emerald-950/20 shadow-[0_0_0_1px_rgba(16,185,129,0.16)]"
                        : "border-zinc-800 bg-zinc-950"
                    }`}
                  >
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                      {section.label}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm font-medium text-zinc-100">
                      {section.title}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <section
        id={activeSection.id}
        className={`rounded-2xl border p-5 ${getSectionTone(activeSection.title)}`}
      >
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              {activeSection.label}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-zinc-100">
              {activeSection.title}
            </h3>
          </div>
          {activeSection.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {activeSection.tags.map((tag) => (
                <span
                  key={`${activeSection.id}-${tag.label}`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${researchTagClass(tag.tone)}`}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-li:text-zinc-300">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {activeSection.body}
          </ReactMarkdown>
        </div>

        {activeSection.actionPoints.length > 0 && (
          <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-xs text-zinc-500">체크할 포인트</p>
            <ul className="mt-2 space-y-1.5 text-sm text-zinc-100">
              {activeSection.actionPoints.map((point) => (
                <li key={point}>- {point}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
