"use client";

import { useMemo } from "react";

export type FeedbackAnalysis = {
  generatedAt?: string;
  snapshotDates?: string[];
  sampleSize?: number;
  scoreReturnCorrelation?: {
    actionScore_vs_ret5d?: number | null;
    actionScore_vs_ret10d?: number | null;
    actionScore_vs_ret20d?: number | null;
  } | null;
  signalHitRates?: {
    buy_hit_5d?: number | null;
    hold_hit_5d?: number | null;
    trim_negative_5d?: number | null;
  } | null;
  factorCorrelations?: Record<
    string,
    {
      vs_ret5d?: number | null;
      vs_ret10d?: number | null;
      count?: number | null;
    }
  > | null;
  regimeAccuracy?: Record<
    string,
    {
      count?: number | null;
      avgReturn5d?: number | null;
      scoreCorr5d?: number | null;
      buyHitRate?: number | null;
    }
  > | null;
  worstMispredictions?: {
    highScoreLosers?: Array<{
      date?: string | null;
      code?: string | null;
      name?: string | null;
      score?: number | null;
      worstReturn?: number | null;
      bestReturn?: number | null;
      period?: string | null;
    }>;
    lowScoreWinners?: Array<{
      date?: string | null;
      code?: string | null;
      name?: string | null;
      score?: number | null;
      worstReturn?: number | null;
      bestReturn?: number | null;
      period?: string | null;
    }>;
  } | null;
  weightSuggestions?: Array<{
    factor?: string | null;
    correlation_5d?: number | null;
    suggestion?: string | null;
  }> | null;
  sourceAccuracy?:
    | Array<{
        source?: string | null;
        sampleSize?: number | null;
        buyHitRate?: number | null;
        avgReturn5d?: number | null;
        note?: string | null;
      }>
    | Record<
        string,
        {
          sampleSize?: number | null;
          buyHitRate?: number | null;
          avgReturn5d?: number | null;
          note?: string | null;
        }
      >
    | null;
  researchSourceAccuracy?:
    | Array<{
        source?: string | null;
        sampleSize?: number | null;
        buyHitRate?: number | null;
        avgReturn5d?: number | null;
        note?: string | null;
      }>
    | Record<
        string,
        {
          sampleSize?: number | null;
          buyHitRate?: number | null;
          avgReturn5d?: number | null;
          note?: string | null;
        }
      >
    | null;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatRatioAsPercent(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || Number.isNaN(value)) return "미집계";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "미집계";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatSignedCorrelation(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "미집계";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function correlationTone(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return {
      dot: "bg-slate-300",
      text: "text-slate-500",
      fill: "bg-slate-300/70",
      badge: "bg-slate-100 text-slate-500",
    };
  }
  if (value >= 0.15) {
    return {
      dot: "bg-emerald-500",
      text: "text-emerald-700",
      fill: "bg-emerald-500/80",
      badge: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-500/20",
    };
  }
  if (value <= -0.15) {
    return {
      dot: "bg-rose-500",
      text: "text-rose-700",
      fill: "bg-rose-500/80",
      badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-500/20",
    };
  }
  return {
    dot: "bg-amber-500",
    text: "text-amber-700",
    fill: "bg-amber-500/80",
    badge: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-500/20",
  };
}

function signalTone(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "border-slate-200 bg-slate-50 text-slate-500";
  }
  if (value >= 0.6) {
    return "border-emerald-200 bg-emerald-50/90 text-emerald-700";
  }
  if (value >= 0.35) {
    return "border-amber-200 bg-amber-50/90 text-amber-700";
  }
  return "border-rose-200 bg-rose-50/90 text-rose-700";
}

function formatRegimeLabel(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "SIDEWAYS") return "횡보";
  if (normalized === "BULL" || normalized === "BULLISH") return "상승";
  if (normalized === "BEAR" || normalized === "BEARISH") return "하락";
  if (normalized === "HIGH_VOL") return "고변동";
  return value;
}

function normalizeResearchSources(analysis: FeedbackAnalysis | null) {
  const raw = analysis?.researchSourceAccuracy ?? analysis?.sourceAccuracy;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => ({
      source: item.source ?? "미상",
      sampleSize: item.sampleSize ?? null,
      buyHitRate: item.buyHitRate ?? null,
      avgReturn5d: item.avgReturn5d ?? null,
      note: item.note ?? null,
    }));
  }
  return Object.entries(raw).map(([source, value]) => ({
    source,
    sampleSize: value?.sampleSize ?? null,
    buyHitRate: value?.buyHitRate ?? null,
    avgReturn5d: value?.avgReturn5d ?? null,
    note: value?.note ?? null,
  }));
}

function CorrelationGauge({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const tone = correlationTone(value);
  const position =
    typeof value === "number" && !Number.isNaN(value)
      ? Math.max(0, Math.min(100, (value + 1) * 50))
      : 50;

  return (
    <div className="rounded-[1.15rem] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {label}
          </p>
          <p className={joinClasses("mt-2 text-lg font-semibold", tone.text)}>
            {formatSignedCorrelation(value)}
          </p>
        </div>
        <span className={joinClasses("rounded-full px-2.5 py-1 text-[11px] font-medium", tone.badge)}>
          {typeof value === "number" && value > 0
            ? "양의 상관"
            : typeof value === "number" && value < 0
              ? "음의 상관"
              : "중립"}
        </span>
      </div>
      <div className="mt-4">
        <div className="relative h-2 rounded-full bg-slate-100">
          <div className="absolute inset-y-[-3px] left-1/2 w-px -translate-x-1/2 bg-slate-300" />
          {typeof value === "number" && !Number.isNaN(value) ? (
            <div
              className={joinClasses(
                "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm",
                tone.dot,
              )}
              style={{ left: `${position}%` }}
            />
          ) : null}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span>-1.0</span>
          <span>0</span>
          <span>+1.0</span>
        </div>
      </div>
    </div>
  );
}

export default function FeedbackPanel({
  analysis,
  fileName,
}: {
  analysis: FeedbackAnalysis | null;
  fileName?: string | null;
}) {
  const factorRows = useMemo(
    () =>
      Object.entries(analysis?.factorCorrelations ?? {}).map(([factor, value]) => ({
        factor,
        correlation: value?.vs_ret5d ?? null,
        count: value?.count ?? null,
        suggestion:
          analysis?.weightSuggestions?.find((item) => item.factor === factor)?.suggestion ?? null,
      })),
    [analysis],
  );

  const regimeRows = useMemo(
    () =>
      Object.entries(analysis?.regimeAccuracy ?? {}).map(([regime, value]) => ({
        regime,
        count: value?.count ?? null,
        avgReturn5d: value?.avgReturn5d ?? null,
        scoreCorr5d: value?.scoreCorr5d ?? null,
        buyHitRate: value?.buyHitRate ?? null,
      })),
    [analysis],
  );

  const researchSources = useMemo(() => normalizeResearchSources(analysis), [analysis]);
  const topLoser = analysis?.worstMispredictions?.highScoreLosers?.[0] ?? null;
  const topWinner = analysis?.worstMispredictions?.lowScoreWinners?.[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
            Test UI
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            샘플 {analysis?.sampleSize ?? 0}건
          </span>
          {fileName ? (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
              {fileName}
            </span>
          ) : null}
        </div>
      </div>

      {analysis ? (
        <div className="space-y-5">
          <div className="grid grid-cols-[1.45fr_1fr] gap-4">
            <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Score vs Return
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">
                    점수-수익률 상관 게이지
                  </h3>
                </div>
                <p className="text-xs text-slate-500">
                  생성 {analysis.generatedAt ? analysis.generatedAt.slice(0, 16).replace("T", " ") : "미상"}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <CorrelationGauge
                  label="5일"
                  value={analysis.scoreReturnCorrelation?.actionScore_vs_ret5d}
                />
                <CorrelationGauge
                  label="10일"
                  value={analysis.scoreReturnCorrelation?.actionScore_vs_ret10d}
                />
                <CorrelationGauge
                  label="20일"
                  value={analysis.scoreReturnCorrelation?.actionScore_vs_ret20d}
                />
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Signal Hit Rate
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-950">시그널 적중률</h3>
              <div className="mt-4 grid gap-3">
                {[
                  {
                    label: "BUY",
                    value: analysis.signalHitRates?.buy_hit_5d,
                    description: "5일 뒤 플러스 수익 비율",
                  },
                  {
                    label: "HOLD",
                    value: analysis.signalHitRates?.hold_hit_5d,
                    description: "보유 유지 판단 적중률",
                  },
                  {
                    label: "TRIM",
                    value: analysis.signalHitRates?.trim_negative_5d,
                    description: "축소 후 음수 수익 회피율",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={joinClasses(
                      "rounded-[1rem] border px-4 py-3",
                      signalTone(item.value),
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{item.label}</span>
                      <span className="text-lg font-semibold">
                        {formatRatioAsPercent(item.value)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-6 opacity-80">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1.2fr_0.8fr] gap-4">
            <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Factor Predictiveness
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-950">
                팩터 예측력 바 차트
              </h3>
              <div className="mt-4 space-y-3">
                {factorRows.length > 0 ? (
                  factorRows.map((row) => {
                    const tone = correlationTone(row.correlation);
                    const width =
                      typeof row.correlation === "number" && !Number.isNaN(row.correlation)
                        ? `${Math.max(6, Math.min(100, Math.abs(row.correlation) * 100))}%`
                        : "0%";

                    return (
                      <div
                        key={row.factor}
                        className="rounded-[1rem] border border-slate-200 bg-slate-50/70 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{row.factor}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              표본 {row.count ?? 0}건
                              {row.suggestion ? ` · ${row.suggestion}` : ""}
                            </p>
                          </div>
                          <span className={joinClasses("text-sm font-semibold", tone.text)}>
                            {formatSignedCorrelation(row.correlation)}
                          </span>
                        </div>
                        <div className="mt-3 h-2.5 rounded-full bg-slate-200">
                          <div
                            className={joinClasses("h-2.5 rounded-full", tone.fill)}
                            style={{ width }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[1rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-sm text-slate-500">
                    아직 팩터 상관 분석 결과가 없습니다.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Worst Misses
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-950">최악 오판 알림</h3>
              <div className="mt-4 space-y-3">
                {topLoser ? (
                  <div className="rounded-[1rem] border border-rose-200 bg-rose-50/85 px-4 py-4 text-sm text-rose-800">
                    <p className="font-semibold">고점수였지만 하락한 케이스</p>
                    <p className="mt-2 leading-6">
                      {topLoser.date} · {topLoser.name ?? topLoser.code ?? "미상"} · 점수{" "}
                      {topLoser.score ?? "-"} · 수익률{" "}
                      {formatSignedPercent(topLoser.worstReturn ?? topLoser.bestReturn)}
                    </p>
                  </div>
                ) : null}
                {topWinner ? (
                  <div className="rounded-[1rem] border border-amber-200 bg-amber-50/90 px-4 py-4 text-sm text-amber-800">
                    <p className="font-semibold">저점수였지만 상승한 케이스</p>
                    <p className="mt-2 leading-6">
                      {topWinner.date} · {topWinner.name ?? topWinner.code ?? "미상"} · 점수{" "}
                      {topWinner.score ?? "-"} · 수익률{" "}
                      {formatSignedPercent(topWinner.bestReturn ?? topWinner.worstReturn)}
                    </p>
                  </div>
                ) : null}
                {!topLoser && !topWinner ? (
                  <div className="rounded-[1rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-sm text-slate-500">
                    현재 저장된 중대 오판 사례가 없습니다.
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Regime Accuracy
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-950">레짐별 정확도</h3>
              <div className="mt-4 overflow-hidden rounded-[1rem] border border-slate-200">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">레짐</th>
                      <th className="px-4 py-3">표본</th>
                      <th className="px-4 py-3">평균 5일</th>
                      <th className="px-4 py-3">BUY 적중</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                    {regimeRows.length > 0 ? (
                      regimeRows.map((row) => (
                        <tr key={row.regime}>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {formatRegimeLabel(row.regime)}
                          </td>
                          <td className="px-4 py-3">{row.count ?? "-"}</td>
                          <td className="px-4 py-3">{formatSignedPercent(row.avgReturn5d)}</td>
                          <td className="px-4 py-3">{formatRatioAsPercent(row.buyHitRate)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-5 text-slate-500">
                          아직 레짐별 정확도 데이터가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Research Sources
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-950">
                리서치 소스 정확도
              </h3>
              {researchSources.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-[1rem] border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">소스</th>
                        <th className="px-4 py-3">표본</th>
                        <th className="px-4 py-3">BUY 적중</th>
                        <th className="px-4 py-3">평균 5일</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                      {researchSources.map((item) => (
                        <tr key={item.source}>
                          <td className="px-4 py-3 font-medium text-slate-900">{item.source}</td>
                          <td className="px-4 py-3">{item.sampleSize ?? "-"}</td>
                          <td className="px-4 py-3">{formatRatioAsPercent(item.buyHitRate)}</td>
                          <td className="px-4 py-3">{formatSignedPercent(item.avgReturn5d)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-4 rounded-[1rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-sm leading-7 text-slate-500">
                  F6 백단 연결 전이라 소스별 적중률은 아직 비어 있습니다. 스키마가 들어오면 이 표가 그대로 채워지도록 준비만 해뒀습니다.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-6 text-sm leading-7 text-slate-500">
          `data/feedback/analysis`의 최신 JSON을 찾지 못했습니다. 피드백 분석 파일이 생성되면 이 섹션에 바로 렌더링됩니다.
        </div>
      )}
    </div>
  );
}
