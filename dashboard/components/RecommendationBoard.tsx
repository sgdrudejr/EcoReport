"use client";

import { useState } from "react";
import type { RecommendationBoard as RecommendationBoardData } from "@/lib/recommendations";

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function scoreClass(score: number) {
  if (score >= 75) return "text-emerald-300 border-emerald-500/30 bg-emerald-950/20";
  if (score >= 60) return "text-sky-300 border-sky-500/30 bg-sky-950/20";
  return "text-amber-300 border-amber-500/30 bg-amber-950/20";
}

function signalClass(signal: string | null) {
  if (signal === "BUY") return "text-emerald-300 border-emerald-500/30 bg-emerald-950/20";
  if (signal === "HOLD") return "text-zinc-300 border-zinc-700 bg-zinc-900";
  if (signal === "REDUCE") return "text-amber-300 border-amber-500/30 bg-amber-950/20";
  if (signal === "SELL") return "text-red-300 border-red-500/30 bg-red-950/20";
  return "text-zinc-400 border-zinc-800 bg-zinc-900";
}

function technicalBadgeLabel(signal: string | null, technicalScore: number | null) {
  if (signal && technicalScore != null) {
    return `기술 ${signal} · ${technicalScore}점`;
  }
  if (technicalScore != null) {
    return `기술 ${technicalScore}점`;
  }
  if (signal) {
    return `기술 ${signal}`;
  }
  return "기술 데이터 부족";
}

function formatShortDate(dateText: string) {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateText;
  return `${match[1].slice(2)}.${match[2]}.${match[3]}`;
}

export default function RecommendationBoard({
  board,
}: {
  board: RecommendationBoardData;
}) {
  const [selectedLaneKey, setSelectedLaneKey] = useState(board.lanes[0]?.key ?? "core");
  const activeLane =
    board.lanes.find((lane) => lane.key === selectedLaneKey) ?? board.lanes[0] ?? null;

  if (!activeLane) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            종목 추천
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Stage 1 리포트 테마, Stage 2 전략 후보, Stage 3 기술 점수를 함께 반영한
            아이디어입니다.
          </p>
        </div>
        {board.date && (
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
            종목추천 : 기준일 {formatShortDate(board.date)}
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="-mx-1 overflow-x-auto pb-2">
          <div className="flex gap-2 px-1">
            {board.lanes.map((lane) => {
              const isActive = lane.key === activeLane.key;
              return (
                <button
                  key={lane.key}
                  type="button"
                  onClick={() => setSelectedLaneKey(lane.key)}
                  className={`min-w-[150px] rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-emerald-500/60 bg-emerald-950/20 shadow-[0_0_0_1px_rgba(16,185,129,0.16)]"
                      : "border-zinc-800 bg-zinc-950"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-100">{lane.title}</p>
                    <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                      {lane.items.length}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">{activeLane.title}</h3>
                <p className="mt-1 text-sm text-zinc-500">{activeLane.description}</p>
              </div>
              <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-400">
                {activeLane.items.length}개
              </span>
          </div>

          {activeLane.items.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-6 text-sm text-zinc-500">
              현재 데이터 기준으로는 이 레인의 확신도 높은 후보가 아직 부족합니다. 리포트 영향도와 기술 점수가 더 쌓이면 자동으로 채워집니다.
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {activeLane.items.map((item) => {
                const change = formatSignedPercent(item.changePct);
                const themeAndAccountChips = [
                  ...item.themes.map((theme) => ({
                    key: `${item.code}-${theme}`,
                    label: theme,
                    className:
                      "rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300",
                  })),
                  ...item.targetAccounts.map((account) => ({
                    key: `${item.code}-${account}`,
                    label: account,
                    className:
                      "rounded-full border border-sky-500/30 bg-sky-950/20 px-2.5 py-1 text-xs text-sky-300",
                  })),
                ];
                return (
                  <article
                    key={`${activeLane.key}-${item.code}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-semibold text-zinc-100">
                            {item.name}
                          </h4>
                          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                            {item.code}
                          </span>
                          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                            {item.kind}
                          </span>
                          {item.held && (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-950/20 px-2 py-0.5 text-[11px] text-emerald-300">
                              현재 보유
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-zinc-300">{item.rationale}</p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-xs text-zinc-500">종합 점수</p>
                        <p className="mt-1 whitespace-nowrap text-2xl font-semibold leading-none tabular-nums text-zinc-100 sm:text-3xl">
                          {item.score}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs ${scoreClass(item.score)}`}
                      >
                        {item.tag}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs ${signalClass(item.signal)}`}
                      >
                        {technicalBadgeLabel(item.signal, item.technicalScore)}
                      </span>
                      <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300">
                        리포트 {item.reportScore}점
                      </span>
                      {item.stage2Score != null && (
                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300">
                          전략 {item.stage2Score}점
                        </span>
                      )}
                      {change && (
                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300">
                          등락 {change}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3">
                        <p className="text-xs text-zinc-500">추천 이유</p>
                        <ul className="mt-2 space-y-1.5 text-sm text-zinc-100">
                          {item.reasons.map((reason) => (
                            <li key={reason}>- {reason}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3">
                        <p className="text-xs text-zinc-500">테마 · 적합 계좌</p>
                        <div className="mt-2 flex max-h-[4.25rem] flex-wrap gap-2 overflow-hidden">
                          {themeAndAccountChips.length > 0 ? (
                            themeAndAccountChips.map((chip) => (
                              <span
                                key={chip.key}
                                className={chip.className}
                              >
                                {chip.label}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-zinc-500">계좌 적합성 데이터 부족</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {item.risks.length > 0 && (
                      <div className="mt-4 rounded-xl border border-red-950/40 bg-red-950/20 px-3 py-3">
                        <p className="text-xs text-red-200/70">유의할 점</p>
                        <ul className="mt-2 space-y-1 text-sm text-red-100">
                          {item.risks.map((risk) => (
                            <li key={risk}>- {risk}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
