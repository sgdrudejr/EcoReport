"use client";

export type HoldingCluster = {
  id: number;
  avgCorrelation?: number | null;
  warning?: string | null;
  holdings: Array<{
    code?: string | null;
    name?: string | null;
    accountKey?: string | null;
    accountLabel?: string | null;
  }>;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatCorrelation(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "미집계";
  return value.toFixed(2);
}

function correlationTone(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "border-slate-200 bg-slate-50 text-slate-500";
  }
  if (value >= 0.85) {
    return "border-rose-200 bg-rose-50/90 text-rose-800";
  }
  if (value >= 0.75) {
    return "border-amber-200 bg-amber-50/90 text-amber-800";
  }
  return "border-emerald-200 bg-emerald-50/90 text-emerald-800";
}

export default function ClusterMap({
  clusters,
}: {
  clusters: HoldingCluster[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Correlation Clusters
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">
            보유 종목 상관관계 클러스터
          </h3>
        </div>
      </div>

      {clusters.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {clusters.map((cluster) => (
            <div
              key={cluster.id}
              className="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_30px_rgba(15,23,42,0.04)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Cluster {cluster.id}
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-950">
                    평균 상관 {formatCorrelation(cluster.avgCorrelation)}
                  </p>
                </div>
                <span
                  className={joinClasses(
                    "rounded-full border px-2.5 py-1 text-xs font-medium",
                    correlationTone(cluster.avgCorrelation),
                  )}
                >
                  {cluster.warning ?? "고상관 묶음"}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {cluster.holdings.map((holding) => (
                  <div
                    key={`${cluster.id}-${holding.accountKey}-${holding.code}-${holding.name}`}
                    className="rounded-[1rem] border border-slate-200 bg-slate-50/80 px-3 py-3"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {holding.name ?? holding.code ?? "미상"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {holding.accountLabel ?? holding.accountKey ?? "-"}
                      {holding.code ? ` · ${holding.code}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-sm leading-7 text-slate-500">
          현재 기준으로 상관관계 0.7 이상 클러스터가 없습니다.
        </div>
      )}
    </div>
  );
}
