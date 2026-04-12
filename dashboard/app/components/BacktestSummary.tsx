type BacktestEngineArtifact = {
  generatedAt?: string | null;
  summary?: {
    dateRange?: {
      start?: string | null;
      end?: string | null;
      sessions?: number | null;
    } | null;
    latestPortfolioValue?: number | null;
    totalReturnPct?: number | null;
    annualizedReturnPct?: number | null;
    maxDrawdownPct?: number | null;
    winRatePct?: number | null;
    rebalanceCount?: number | null;
    totalTransactionCostPct?: number | null;
    totalTaxPaidPct?: number | null;
  } | null;
  rebalanceLog?: Array<{
    date?: string | null;
    selected?: Array<{
      code?: string | null;
      name?: string | null;
      actionScore?: number | null;
      weightPct?: number | null;
    }>;
  }> | null;
};

function formatMetric(value: number | null | undefined, suffix = "%") {
  if (value == null || Number.isNaN(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${suffix}`;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return new Intl.NumberFormat("ko-KR").format(Math.round(value));
}

export default function BacktestSummary({
  artifact,
}: {
  artifact: BacktestEngineArtifact | null;
}) {
  if (!artifact?.summary) {
    return null;
  }

  const latestPick = artifact.rebalanceLog?.at(-1);
  const metrics = [
    { label: "누적 수익", value: formatMetric(artifact.summary.totalReturnPct) },
    { label: "연환산", value: formatMetric(artifact.summary.annualizedReturnPct) },
    { label: "최대 낙폭", value: formatMetric(artifact.summary.maxDrawdownPct) },
    { label: "승률", value: formatMetric(artifact.summary.winRatePct) },
  ];

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white/80 px-6 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Backtest Engine
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            timeseries 기반 리플레이 결과
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {artifact.summary.dateRange?.start} ~ {artifact.summary.dateRange?.end} ·{" "}
            {artifact.summary.dateRange?.sessions ?? 0} sessions
          </p>
        </div>
        <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white">
          <p className="text-xs uppercase tracking-[0.18em] text-white/60">Latest Equity</p>
          <p className="mt-1 text-xl font-semibold">
            ₩{formatCurrency(artifact.summary.latestPortfolioValue)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{metric.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">{metric.value}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-3 py-1">
          rebalance {artifact.summary.rebalanceCount ?? 0}회
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1">
          cost {formatMetric(artifact.summary.totalTransactionCostPct)}
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1">
          tax {formatMetric(artifact.summary.totalTaxPaidPct)}
        </span>
      </div>

      {latestPick?.selected?.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {latestPick.selected.slice(0, 3).map((item) => (
            <article key={`${latestPick.date}-${item.code}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="font-medium text-slate-950">
                {item.name} <span className="text-slate-400">({item.code})</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                score {item.actionScore ?? "N/A"} · weight {formatMetric(item.weightPct, "")}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
