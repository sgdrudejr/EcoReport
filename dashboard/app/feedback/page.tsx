import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Gauge, RefreshCcw, TrendingDown, TrendingUp } from "lucide-react";
import { loadFeedbackReportMarkdown, loadLatestFeedbackAnalysis } from "@/lib/feedback";

export const dynamic = "force-dynamic";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatSignedPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatSignedNumber(value: number | null | undefined, digits = 3) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function correlationTone(value: number | null | undefined) {
  if (typeof value !== "number") return "bg-slate-200";
  if (value >= 0.2) return "bg-emerald-500";
  if (value <= -0.15) return "bg-rose-500";
  return "bg-amber-400";
}

export default function FeedbackPage() {
  const analysis = loadLatestFeedbackAnalysis();
  const report = loadFeedbackReportMarkdown();

  if (!analysis) {
    return (
      <main className="feedback-page-shell-empty mx-auto w-full max-w-6xl px-4 pb-28 md:px-6 md:pb-16">
        <section className="glass-panel rounded-[2rem] px-6 py-8">
          <p className="section-kicker">Feedback</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950">성과 피드백이 아직 없습니다.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            `node scripts/build-feedback-snapshot.js`, `build-feedback-analysis.js`,
            `build-feedback-report.js`가 한 번 이상 실행되면 여기서 score-return
            상관관계와 가중치 제안을 볼 수 있습니다.
          </p>
        </section>
      </main>
    );
  }

  const primaryKey = `ret_${analysis.autoAdjustment?.primaryHorizonDays ?? 10}d`;
  const scoreCards = Object.entries(analysis.scoreReturnCorrelation ?? {});
  const factorRows = Object.entries(analysis.factorPredictivePower ?? {});
  const worstRows = analysis.worstMispredictions ?? [];
  const alerts = analysis.alerts ?? [];
  const buyStats = analysis.signalAccuracy?.[primaryKey]?.BUY ?? null;
  const trimStats =
    analysis.signalAccuracy?.[primaryKey]?.TRIM ??
    analysis.signalAccuracy?.[primaryKey]?.REDUCE ??
    null;
  const baseWeights = analysis.autoAdjustment?.baseWeights ?? {};
  const suggestedWeights = analysis.autoAdjustment?.suggestedWeights ?? {};
  const deltas = analysis.autoAdjustment?.deltas ?? {};

  return (
    <main className="feedback-page-shell mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-28 md:px-6 md:pb-16">
      <section className="glass-panel overflow-hidden rounded-[2rem]">
        <div className="grid gap-6 px-6 py-7 md:grid-cols-[1.3fr_0.7fr] md:px-8">
          <div>
            <p className="section-kicker">Feedback Loop</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 md:text-[2.5rem]">
              점수와 실제 수익률을 같은 화면에서 봅니다.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              {analysis.analysisDate} 기준으로 {analysis.snapshotCount ?? 0}일치
              스냅샷과 {analysis.positionCount ?? 0}개 포지션을 비교했습니다.
              아래 값은 대시보드 시각화용이면서 동시에 Stage 3 자동 가중치 조정의
              근거로도 쓰입니다.
            </p>
          </div>

          <div className="grid gap-3">
            <div className="glass-panel-soft rounded-[1.5rem] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Auto Adjust
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">
                {analysis.autoAdjustment?.enabled ? "ON" : "OFF"}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Primary horizon {analysis.autoAdjustment?.primaryHorizonDays ?? "-"}d
                · min samples {analysis.autoAdjustment?.minSamples ?? "-"}
              </p>
            </div>
            <div className="glass-panel-soft rounded-[1.5rem] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Signal Hit Rate
              </p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500">BUY</p>
                  <p className="text-xl font-semibold text-emerald-700">
                    {formatPercent(buyStats?.hitRate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">TRIM</p>
                  <p className="text-xl font-semibold text-rose-700">
                    {formatPercent(trimStats?.hitRate)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {scoreCards.map(([horizonKey, stat]) => (
          <article key={horizonKey} className="glass-panel-soft rounded-[1.6rem] p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">{horizonKey}</p>
              <Gauge className="size-4 text-slate-400" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-slate-950">
              {formatSignedNumber(stat?.correlation)}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              score-return correlation · samples {stat?.sampleCount ?? 0}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="glass-panel rounded-[1.9rem] px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="section-kicker">Factor Predictive Power</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                어떤 팩터가 실제 수익률을 설명했는지
              </h2>
            </div>
            <RefreshCcw className="size-5 text-slate-400" />
          </div>

          <div className="mt-6 space-y-4">
            {factorRows.map(([factorName, metrics]) => {
              const correlation = metrics?.[primaryKey]?.correlation ?? null;
              const sampleCount = metrics?.[primaryKey]?.sampleCount ?? 0;
              const width =
                typeof correlation === "number"
                  ? `${Math.min(100, Math.max(8, Math.abs(correlation) * 180))}%`
                  : "8%";

              return (
                <div key={factorName} className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{factorName}</p>
                      <p className="text-sm text-slate-500">
                        corr {formatSignedNumber(correlation)} · samples {sampleCount}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        Weight
                      </p>
                      <p className="text-sm font-medium text-slate-700">
                        {formatPercent(baseWeights[factorName])} →{" "}
                        <span className="text-slate-950">
                          {formatPercent(suggestedWeights[factorName])}
                        </span>
                        {"  "}
                        <span
                          className={joinClasses(
                            "ml-1 text-xs",
                            (deltas[factorName] ?? 0) >= 0
                              ? "text-emerald-700"
                              : "text-rose-700",
                          )}
                        >
                          {formatSignedPercent((deltas[factorName] ?? 0) * 100)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 h-2.5 rounded-full bg-slate-100">
                    <div
                      className={joinClasses(
                        "h-2.5 rounded-full",
                        correlationTone(correlation),
                      )}
                      style={{ width }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="glass-panel rounded-[1.9rem] px-6 py-6">
          <p className="section-kicker">Feedback Alerts</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            이번 주 경고와 관찰 포인트
          </h2>

          <div className="mt-6 space-y-3">
            {alerts.length > 0 ? (
              alerts.map((item, index) => (
                <div
                  key={`${item.factor}-${index}`}
                  className={joinClasses(
                    "rounded-[1.3rem] border px-4 py-4",
                    item.level === "warning"
                      ? "border-rose-200 bg-rose-50/90"
                      : "border-emerald-200 bg-emerald-50/80",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {item.level === "warning" ? (
                      <AlertTriangle className="mt-0.5 size-4 text-rose-600" />
                    ) : (
                      <TrendingUp className="mt-0.5 size-4 text-emerald-600" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.factor}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {item.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.3rem] border border-slate-200 bg-white/80 px-4 py-4 text-sm text-slate-600">
                아직 샘플이 적거나 뚜렷한 역방향 팩터가 없습니다.
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.3rem] border border-slate-200 bg-white/85 p-4">
              <div className="flex items-center gap-2 text-slate-500">
                <TrendingUp className="size-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.16em]">
                  BUY Avg
                </p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">
                {formatSignedPercent(buyStats?.avgReturnPct)}
              </p>
            </div>
            <div className="rounded-[1.3rem] border border-slate-200 bg-white/85 p-4">
              <div className="flex items-center gap-2 text-slate-500">
                <TrendingDown className="size-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.16em]">
                  TRIM Avg
                </p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">
                {formatSignedPercent(trimStats?.avgReturnPct)}
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <article className="glass-panel rounded-[1.9rem] px-6 py-6">
          <p className="section-kicker">Worst Calls</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            최악 오판 목록
          </h2>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 pr-4 text-left">날짜</th>
                  <th className="py-3 pr-4 text-left">종목</th>
                  <th className="py-3 pr-4 text-left">신호</th>
                  <th className="py-3 pr-4 text-right">점수</th>
                  <th className="py-3 pr-4 text-right">
                    {analysis.autoAdjustment?.primaryHorizonDays ?? 10}d 수익률
                  </th>
                  <th className="py-3 text-left">레짐</th>
                </tr>
              </thead>
              <tbody>
                {worstRows.slice(0, 10).map((item) => (
                  <tr key={`${item.date}-${item.code}-${item.accountKey}`} className="border-b border-slate-100">
                    <td className="py-3 pr-4 text-slate-500">{item.date ?? "-"}</td>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.code}</p>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">{item.signal ?? "-"}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-slate-900">
                      {item.actionScore ?? "-"}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-rose-700">
                      {formatSignedPercent(item.returnPct)}
                    </td>
                    <td className="py-3 text-slate-500">{item.regimeName ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="glass-panel rounded-[1.9rem] px-6 py-6">
          <p className="section-kicker">Operator Summary</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            마크다운 리포트
          </h2>
          <div className="prose prose-slate mt-6 max-w-none text-sm leading-7 text-slate-700">
            {report ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            ) : (
              <p>아직 생성된 `reports/feedback-summary.md`가 없습니다.</p>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
