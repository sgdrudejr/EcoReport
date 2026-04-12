type GhostEntry = {
  date?: string;
  accountLabel?: string;
  code?: string;
  name?: string;
  suggestedAmount?: number | null;
  suggestedScore?: number | null;
  reason?: string | null;
};

export default function GhostPortfolio({
  entries,
}: {
  entries: GhostEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
        Ghost Portfolio
      </p>
      <h3 className="mt-2 text-xl font-semibold text-slate-900">
        미실행 추천주 추적
      </h3>
      <div className="mt-4 space-y-3">
        {entries.slice(0, 8).map((entry, index) => (
          <article key={`${entry.date}-${entry.code}-${index}`} className="rounded-2xl border border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900">
                  {entry.name} <span className="text-slate-400">({entry.code})</span>
                </p>
                <p className="text-sm text-slate-500">
                  {entry.date} · {entry.accountLabel} · score {entry.suggestedScore ?? "-"}
                </p>
              </div>
              <div className="text-right text-sm text-slate-600">
                <p>{entry.suggestedAmount?.toLocaleString() ?? "-"}원</p>
              </div>
            </div>
            {entry.reason ? <p className="mt-2 text-sm text-slate-600">{entry.reason}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
