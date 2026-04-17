type IntradayState = {
  updatedAt?: string | null;
  alerts?: {
    triggers?: Array<{
      name?: string | null;
      triggered?: boolean;
      detail?: string | null;
      actual?: number | string | null;
    }>;
  } | null;
  overlay?: {
    updates?: Array<{
      code?: string | null;
      name?: string | null;
      baseActionScore?: number | null;
      intradayActionScore?: number | null;
      delta?: number | null;
    }>;
  } | null;
};

export default function IntradayAlertBanner({
  intradayState,
}: {
  intradayState: IntradayState | null;
}) {
  const fired = (intradayState?.alerts?.triggers ?? []).filter((item) => item.triggered);
  const updates = intradayState?.overlay?.updates ?? [];

  if (fired.length === 0 && updates.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/80 px-6 py-5">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">
        Intraday Monitor
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">
          장중 경보와 단건 재점수 오버레이
        </h2>
        <span className="text-xs text-slate-500">
          {intradayState?.updatedAt ?? "N/A"}
        </span>
      </div>

      {fired.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {fired.slice(0, 4).map((trigger) => (
            <span
              key={`${trigger.name}-${trigger.detail}`}
              className="rounded-full border border-rose-200 bg-white px-3 py-1 text-sm text-rose-700"
            >
              {trigger.name}
            </span>
          ))}
        </div>
      ) : null}

      {updates.length > 0 ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {updates.slice(0, 3).map((update) => (
            <article key={`${update.code}-${update.name}`} className="rounded-2xl border border-white/80 bg-white px-4 py-3">
              <p className="font-medium text-slate-900">
                {update.name} <span className="text-slate-400">({update.code})</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {update.baseActionScore} → {update.intradayActionScore}
              </p>
              <p className={`mt-1 text-sm font-medium ${((update.delta ?? 0) < 0) ? "text-rose-600" : "text-emerald-600"}`}>
                {update.delta != null && update.delta > 0 ? "+" : ""}
                {update.delta ?? 0}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
