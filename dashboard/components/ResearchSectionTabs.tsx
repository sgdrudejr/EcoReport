"use client";

import { useState } from "react";
import HorizontalTabRail from "@/components/HorizontalTabRail";
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
  if (tone === "rose") return "border-rose-500/30 bg-rose-500/12 text-rose-200";
  if (tone === "sky") return "border-sky-500/30 bg-sky-500/12 text-sky-200";
  if (tone === "emerald") return "border-blue-500/30 bg-blue-500/12 text-blue-200";
  if (tone === "amber") return "border-amber-500/30 bg-amber-500/12 text-amber-200";
  if (tone === "fuchsia") return "border-indigo-500/30 bg-indigo-500/12 text-indigo-200";
  return "border-white/8 bg-white/[0.03] text-zinc-300";
}

function getSectionTone(title: string) {
  if (title.includes("핵심")) {
    return "text-blue-200";
  }
  if (title.includes("거시") || title.includes("매크로")) {
    return "text-amber-200";
  }
  if (title.includes("섹터") || title.includes("성장")) {
    return "text-sky-200";
  }
  if (title.includes("포트폴리오") || title.includes("시사점")) {
    return "text-indigo-200";
  }
  return "text-zinc-100";
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
      <HorizontalTabRail
        items={sections}
        getKey={(section) => section.id}
        selectedKey={activeSection.id}
        onSelect={setSelectedSectionId}
        sticky
        itemClassName="min-w-[168px]"
        selectedItemClassName="border-blue-500/60 bg-blue-500/12 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
        unselectedItemClassName="border-white/8 bg-white/[0.03]"
        renderItem={(section) => (
          <>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">
              {section.label}
            </p>
            <p className="mt-1 line-clamp-2 text-sm font-medium text-zinc-100">
              {section.title}
            </p>
          </>
        )}
      />

      <section id={activeSection.id} className="section-block">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              {activeSection.label}
            </p>
            <h3 className={`mt-1 text-xl font-semibold ${getSectionTone(activeSection.title)}`}>
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
          <div className="mt-4 border-t border-white/8 pt-4">
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
