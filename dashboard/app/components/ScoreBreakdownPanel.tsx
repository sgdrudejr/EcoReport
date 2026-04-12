type BreakdownPosition = {
  code?: string | null;
  name?: string | null;
  scoreDecomposition?: {
    alphaScore?: number | null;
    riskGate?: number | null;
    executionConfidence?: number | null;
    taxAdvantage?: number | null;
    clusterPenalty?: number | null;
  } | null;
};

const METRICS = [
  { key: "alphaScore", label: "Alpha" },
  { key: "riskGate", label: "Risk Gate" },
  { key: "executionConfidence", label: "Confidence" },
  { key: "taxAdvantage", label: "Tax +" },
] as const;

export default function ScoreBreakdownPanel({
  positions,
}: {
  positions: BreakdownPosition[];
}) {
  const items = positions.slice(0, 6);
  if (items.length === 0) return null;

  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
        Score Decomposition
      </p>
      <div className="mt-4 space-y-4">
        {items.map((item) => (
          <article key={item.code ?? item.name} className="rounded-2xl border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">{item.name}</p>
              <span className="text-sm text-slate-500">{item.code}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              {METRICS.map((metric) => (
                <div key={metric.key} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {metric.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {item.scoreDecomposition?.[metric.key] ?? "-"}
                  </p>
                </div>
              ))}
            </div>
            {item.scoreDecomposition?.clusterPenalty ? (
              <p className="mt-3 text-sm text-rose-600">
                Cluster penalty {item.scoreDecomposition.clusterPenalty}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
