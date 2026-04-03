"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

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
        setMessage("분석 실행 요청이 전송됐습니다.");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setMessage("네트워크 오류가 발생했습니다.");
    }
  }

  const labels = {
    idle: "🔄 분석 실행",
    loading: "전송 중…",
    ok: "✓ 전송 완료",
    error: "✕ 실패",
  };

  const colors = {
    idle: "bg-emerald-600 hover:bg-emerald-500",
    loading: "bg-zinc-700 cursor-not-allowed",
    ok: "bg-emerald-700",
    error: "bg-red-700",
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${colors[state]}`}
      >
        <RefreshCw size={14} className={state === "loading" ? "animate-spin" : ""} />
        {labels[state]}
      </button>
      {message && (
        <span
          className={`text-xs ${
            state === "error" ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
