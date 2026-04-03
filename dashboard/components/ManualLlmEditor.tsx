"use client";

import { useMemo, useState } from "react";
import { Bot, FileJson, Save, Sparkles } from "lucide-react";

type PromptSection = {
  label: string;
  kind: "synthesis" | "advisory";
  description: string;
  promptPath: string | null;
  targetPath: string | null;
  initialContent: string;
  commandHint: string;
};

type QueueItem = {
  id: string;
  rank: number;
  title: string;
  broker: string;
  date: string;
  category: string;
  priorityLabel: string;
  priorityScore: number;
  reasons: string[];
  promptPath: string;
  existingSummary: string;
};

type SaveState = "idle" | "saving" | "ok" | "error";

function StatusBanner({
  state,
  message,
}: {
  state: SaveState;
  message: string;
}) {
  if (!message) return null;

  const className =
    state === "ok"
      ? "border-emerald-900/70 bg-emerald-950/30 text-emerald-300"
      : state === "error"
        ? "border-red-900/70 bg-red-950/30 text-red-300"
        : "border-zinc-800 bg-zinc-900 text-zinc-300";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${className}`}>
      {message}
    </div>
  );
}

export default function ManualLlmEditor({
  synthesis,
  advisory,
  queueItems,
  queueDate,
}: {
  synthesis: PromptSection;
  advisory: PromptSection;
  queueItems: QueueItem[];
  queueDate: string | null;
}) {
  const [synthesisDraft, setSynthesisDraft] = useState(synthesis.initialContent);
  const [advisoryDraft, setAdvisoryDraft] = useState(advisory.initialContent);
  const [selectedReportId, setSelectedReportId] = useState<string>(
    queueItems[0]?.id ?? "",
  );
  const [reportDrafts, setReportDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(queueItems.map((item) => [item.id, item.existingSummary])),
  );

  const [synthesisStatus, setSynthesisStatus] = useState<SaveState>("idle");
  const [synthesisMessage, setSynthesisMessage] = useState("");
  const [advisoryStatus, setAdvisoryStatus] = useState<SaveState>("idle");
  const [advisoryMessage, setAdvisoryMessage] = useState("");
  const [reportStatus, setReportStatus] = useState<SaveState>("idle");
  const [reportMessage, setReportMessage] = useState("");

  const selectedReport = useMemo(
    () => queueItems.find((item) => item.id === selectedReportId) ?? null,
    [queueItems, selectedReportId],
  );

  async function saveMarkdownSection(
    section: PromptSection,
    content: string,
    setStatus: (value: SaveState) => void,
    setMessage: (value: string) => void,
  ) {
    if (!section.targetPath) {
      setStatus("error");
      setMessage("저장 대상 파일 경로를 찾지 못했습니다.");
      return;
    }

    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch("/api/manual-llm/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: section.kind,
          targetPath: section.targetPath,
          content,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(payload.error ?? "저장에 실패했습니다.");
        return;
      }

      setStatus("ok");
      setMessage(`${section.label} 저장 완료. 잠시 후 배포에 반영됩니다.`);
    } catch {
      setStatus("error");
      setMessage("네트워크 오류로 저장하지 못했습니다.");
    }
  }

  async function saveReportSummary() {
    if (!selectedReport || !queueDate) {
      setReportStatus("error");
      setReportMessage("저장할 리포트를 선택하세요.");
      return;
    }

    const content = reportDrafts[selectedReport.id] ?? "";
    if (!content.trim()) {
      setReportStatus("error");
      setReportMessage("리포트 요약 JSON을 붙여넣으세요.");
      return;
    }

    try {
      JSON.parse(content);
    } catch {
      setReportStatus("error");
      setReportMessage("리포트 요약은 유효한 JSON이어야 합니다.");
      return;
    }

    setReportStatus("saving");
    setReportMessage("");

    try {
      const response = await fetch("/api/manual-llm/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "report-summary",
          date: queueDate,
          reportId: selectedReport.id,
          reportMeta: {
            rank: selectedReport.rank,
            title: selectedReport.title,
            broker: selectedReport.broker,
            category: selectedReport.category,
            priorityLabel: selectedReport.priorityLabel,
            priorityScore: selectedReport.priorityScore,
            reasons: selectedReport.reasons,
            promptPath: selectedReport.promptPath,
          },
          content,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setReportStatus("error");
        setReportMessage(payload.error ?? "리포트 요약 저장에 실패했습니다.");
        return;
      }

      setReportStatus("ok");
      setReportMessage(
        `${selectedReport.id} 요약 저장 완료. 이후 종합 시황 생성에서 우선 사용됩니다.`,
      );
    } catch {
      setReportStatus("error");
      setReportMessage("네트워크 오류로 저장하지 못했습니다.");
    }
  }

  const sectionCardClass =
    "rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 text-emerald-400" size={18} />
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              GPT 응답 저장
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              ChatGPT 웹으로 프롬프트를 보낸 뒤, 답변을 아래에 붙여넣고
              저장하세요. 저장된 결과는 다음 브리핑과 종합 시황 생성에서 바로
              재사용됩니다.
            </p>
          </div>
        </div>
      </section>

      {[synthesis, advisory].map((section) => {
        const draft =
          section.kind === "synthesis" ? synthesisDraft : advisoryDraft;
        const setDraft =
          section.kind === "synthesis" ? setSynthesisDraft : setAdvisoryDraft;
        const status =
          section.kind === "synthesis" ? synthesisStatus : advisoryStatus;
        const message =
          section.kind === "synthesis" ? synthesisMessage : advisoryMessage;
        const setStatus =
          section.kind === "synthesis" ? setSynthesisStatus : setAdvisoryStatus;
        const setMessage =
          section.kind === "synthesis"
            ? setSynthesisMessage
            : setAdvisoryMessage;

        return (
          <section key={section.kind} className={sectionCardClass}>
            <div className="flex items-start gap-3">
              <Bot className="mt-0.5 text-zinc-400" size={18} />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-zinc-100">
                  {section.label}
                </h3>
                <p className="text-sm text-zinc-500">{section.description}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs text-zinc-500">프롬프트 파일</p>
                <p className="mt-1 break-all text-sm text-zinc-200">
                  {section.promptPath ?? "없음"}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs text-zinc-500">저장 대상 파일</p>
                <p className="mt-1 break-all text-sm text-zinc-200">
                  {section.targetPath ?? "없음"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs text-zinc-500">실행 명령</p>
              <code className="mt-2 block whitespace-pre-wrap rounded-lg bg-zinc-950 text-sm text-zinc-200">
                {section.commandHint}
              </code>
            </div>

            <label className="block text-sm text-zinc-300">
              GPT 응답 붙여넣기
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={14}
                className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none"
                placeholder={`${section.label} 응답을 붙여넣으세요`}
              />
            </label>

            <div className="flex items-center justify-between gap-3">
              <StatusBanner state={status} message={message} />
              <button
                type="button"
                onClick={() =>
                  saveMarkdownSection(section, draft, setStatus, setMessage)
                }
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
              >
                <Save size={16} />
                저장
              </button>
            </div>
          </section>
        );
      })}

      <section className={sectionCardClass}>
        <div className="flex items-start gap-3">
          <FileJson className="mt-0.5 text-sky-400" size={18} />
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-zinc-100">
              개별 PDF 요약 저장
            </h3>
            <p className="text-sm text-zinc-500">
              리포트별 JSON 응답을 붙여넣으면
              <code className="mx-1 rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-300">
                manual-compressed.json
              </code>
              으로 누적 저장됩니다.
            </p>
          </div>
        </div>

        {queueItems.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
            오늘 생성된 리포트 요약 큐가 없습니다.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-zinc-300">
                저장할 리포트
                <select
                  value={selectedReportId}
                  onChange={(event) => setSelectedReportId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                >
                  {queueItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.rank} {item.id} · {item.title}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs text-zinc-500">저장 대상 파일</p>
                <p className="mt-1 break-all text-sm text-zinc-200">
                  {queueDate
                    ? `data/reports/${queueDate}/manual-compressed.json`
                    : "없음"}
                </p>
              </div>
            </div>

            {selectedReport && (
              <>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-100">
                      {selectedReport.title}
                    </p>
                    <span className="rounded-full bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
                      {selectedReport.priorityLabel} ·{" "}
                      {selectedReport.priorityScore}점
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {selectedReport.broker} · {selectedReport.category}
                  </p>
                  <p className="text-xs text-zinc-500 break-all">
                    프롬프트 파일: {selectedReport.promptPath}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedReport.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>

                <label className="block text-sm text-zinc-300">
                  GPT JSON 응답 붙여넣기
                  <textarea
                    value={reportDrafts[selectedReport.id] ?? ""}
                    onChange={(event) =>
                      setReportDrafts((current) => ({
                        ...current,
                        [selectedReport.id]: event.target.value,
                      }))
                    }
                    rows={16}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-sm text-zinc-100 outline-none"
                    placeholder='{"broker":"...","title":"..."}'
                  />
                </label>
              </>
            )}

            <div className="flex items-center justify-between gap-3">
              <StatusBanner state={reportStatus} message={reportMessage} />
              <button
                type="button"
                onClick={saveReportSummary}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black hover:bg-sky-400"
              >
                <Save size={16} />
                JSON 저장
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
