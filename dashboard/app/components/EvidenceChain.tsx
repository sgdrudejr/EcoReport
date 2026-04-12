type Stage3Position = {
  code?: string | null;
  name?: string | null;
  actionScore?: number | null;
  scoreDecomposition?: {
    alphaScore?: number | null;
    riskGate?: number | null;
    executionConfidence?: number | null;
    clusterPenalty?: number | null;
  } | null;
};

function signed(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

export default function EvidenceChain({
  currentDate,
  previousDate,
  current,
  previous,
}: {
  currentDate: string | null;
  previousDate: string | null;
  current: Record<string, Stage3Position>;
  previous: Record<string, Stage3Position> | null;
}) {
  const changes = Object.entries(current)
    .map(([key, item]) => {
      const prior = previous?.[key];
      const currentScore = item.actionScore ?? 0;
      const previousScore = prior?.actionScore ?? 0;
      return {
        key,
        name: item.name ?? item.code ?? key,
        delta: currentScore - previousScore,
        alphaDelta:
          (item.scoreDecomposition?.alphaScore ?? 0) -
          (prior?.scoreDecomposition?.alphaScore ?? 0),
        riskDelta:
          (item.scoreDecomposition?.riskGate ?? 0) -
          (prior?.scoreDecomposition?.riskGate ?? 0),
        confidenceDelta:
          (item.scoreDecomposition?.executionConfidence ?? 0) -
          (prior?.scoreDecomposition?.executionConfidence ?? 0),
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 3);

  if (!previousDate || changes.length === 0) {
    return null;
  }

  return (
    <section className="rounded-[1.75rem] border border-amber-200 bg-amber-50/80 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
        Evidence Chain
      </p>
      <h3 className="mt-2 text-xl font-semibold text-slate-900">
        어제 대비 변화 원인 Top 3
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        {previousDate} 대비 {currentDate} 기준 actionScore 변화가 큰 포지션입니다.
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {changes.map((change) => (
          <article key={change.key} className="rounded-2xl border border-white/70 bg-white px-4 py-3">
            <p className="font-medium text-slate-900">{change.name}</p>
            <p className="mt-1 text-sm text-slate-600">
              score {signed(change.delta)} · alpha {signed(change.alphaDelta)} · risk gate{" "}
              {signed(change.riskDelta)} · confidence {signed(change.confidenceDelta)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
