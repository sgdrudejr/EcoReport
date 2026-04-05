"use client";

import { useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

export default function TriggerButton() {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  async function handleClick() {
    setState("loading");
    try {
      const res = await fetch("/api/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setState("error");
        setMessage(data.error ?? "오류가 발생했습니다.");
      } else {
        setState("ok");
        const runDate = typeof data.run_date === "string" ? data.run_date : null;
        const effectiveDate =
          typeof data.effective_market_date === "string"
            ? data.effective_market_date
            : null;
        setMessage(
          runDate && effectiveDate && runDate !== effectiveDate
            ? `분석 실행 요청 전송 완료 · 실행일 ${runDate} / 기준 거래일 ${effectiveDate}`
            : effectiveDate
              ? `분석 실행 요청 전송 완료 · 기준 거래일 ${effectiveDate}`
              : "분석 실행 요청이 전송됐습니다.",
        );
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setMessage("네트워크 오류가 발생했습니다.");
    }
  }

  const labels = {
    idle: "분석 실행",
    loading: "전송 중",
    ok: "전송 완료",
    error: "전송 실패",
  };

  const colors = {
    idle:
      "border-emerald-400/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.28),rgba(15,23,42,0.94))] text-white hover:border-emerald-300/35 hover:shadow-[0_18px_45px_rgba(16,185,129,0.18)]",
    loading:
      "cursor-not-allowed border-white/10 bg-[linear-gradient(135deg,rgba(39,39,42,0.92),rgba(15,23,42,0.94))] text-zinc-200",
    ok:
      "border-emerald-400/20 bg-[linear-gradient(135deg,rgba(5,150,105,0.32),rgba(15,23,42,0.94))] text-white",
    error:
      "border-red-400/20 bg-[linear-gradient(135deg,rgba(185,28,28,0.32),rgba(15,23,42,0.94))] text-white",
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:items-end">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className={`group relative w-full overflow-hidden rounded-[1.4rem] border px-4 py-3 text-left transition sm:w-auto sm:min-w-[13.5rem] ${colors[state]}`}
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_58%)] opacity-70 transition-opacity group-hover:opacity-100" />
        <span className="relative flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10">
            <RefreshCw size={16} className={state === "loading" ? "animate-spin" : ""} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[11px] uppercase tracking-[0.2em] text-white/55">
              <Sparkles size={11} />
              analysis
            </span>
            <span className="mt-1 block text-sm font-semibold">{labels[state]}</span>
          </span>
        </span>
      </button>
      {message && (
        <p
          className={`text-xs ${
            state === "error" ? "text-red-300" : "text-emerald-200"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
