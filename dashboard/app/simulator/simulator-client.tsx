"use client";

import { useState } from "react";

import SliderPanel from "./SliderPanel";
import {
  simulatePositions,
  type SimulatorControls,
  type SimulatorPosition,
} from "./SimulatorEngine";

export default function SimulatorClient({
  date,
  positions,
}: {
  date: string | null;
  positions: SimulatorPosition[];
}) {
  const [controls, setControls] = useState<SimulatorControls>({
    riskTolerance: 50,
    factorTilt: 50,
    reportTilt: 50,
  });

  const simulated = simulatePositions(positions, controls).slice(0, 12);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SliderPanel
          riskTolerance={controls.riskTolerance}
          factorTilt={controls.factorTilt}
          reportTilt={controls.reportTilt}
          onChange={(next) => setControls((current) => ({ ...current, ...next }))}
        />

        <section className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Scenario Output
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            What-If Simulator
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            기준 스냅샷: {date ?? "N/A"} · Stage 3 점수의 브라우저용 서브셋으로 재계산합니다.
          </p>

          <div className="mt-6 space-y-3">
            {simulated.map((position) => (
              <article
                key={position.code}
                className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {position.name} <span className="text-slate-400">({position.code})</span>
                  </p>
                  <p className="text-sm text-slate-500">
                    현재 {position.actionScore} → 시뮬레이션 {position.simulatedScore}
                  </p>
                </div>
                <div
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    position.delta >= 0
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {position.delta >= 0 ? "+" : ""}
                  {position.delta}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
