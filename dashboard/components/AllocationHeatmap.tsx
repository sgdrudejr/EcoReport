"use client";

export type AllocationHeatmapCell = {
  category: string;
  targetPct: number;
  currentPct: number;
  gapPct: number;
};

export type AllocationHeatmapRow = {
  accountKey: string;
  accountLabel: string;
  cells: AllocationHeatmapCell[];
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatGap(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%p`;
}

function cellTone(gapPct: number) {
  const absGap = Math.abs(gapPct);
  if (absGap < 0.02) {
    return {
      tone: "ok",
      className: "border-emerald-200 bg-emerald-50/90 text-emerald-800",
      dot: "bg-emerald-500",
      label: "OK",
    };
  }
  if (absGap <= 0.05) {
    return {
      tone: "watch",
      className: "border-amber-200 bg-amber-50/90 text-amber-800",
      dot: "bg-amber-500",
      label: "관찰",
    };
  }
  return {
    tone: "rebalance",
    className: "border-rose-200 bg-rose-50/90 text-rose-800",
    dot: "bg-rose-500",
    label: "리밸런싱",
  };
}

function strongestGapLabel(cells: AllocationHeatmapCell[]) {
  const top = [...cells].sort(
    (left, right) => Math.abs(right.gapPct) - Math.abs(left.gapPct),
  )[0];

  if (!top) return "표시할 배분 데이터 없음";
  if (Math.abs(top.gapPct) < 0.02) return "대체로 목표 배분 근처";
  return `${top.category} ${formatGap(top.gapPct)} 차이`;
}

export default function AllocationHeatmap({
  rows,
  categories,
}: {
  rows: AllocationHeatmapRow[];
  categories: string[];
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Allocation Heatmap
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">
            계좌 × 카테고리 배분 히트맵
          </h3>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 ring-1 ring-inset ring-slate-200">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          갭 &lt; 2%
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 ring-1 ring-inset ring-slate-200">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          갭 2~5%
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 ring-1 ring-inset ring-slate-200">
          <span className="h-2 w-2 rounded-full bg-rose-500" />
          갭 &gt; 5%
        </span>
      </div>

      {rows.length > 0 && categories.length > 0 ? (
        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto rounded-[1.2rem] border border-slate-200 bg-white">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">계좌</th>
                  {categories.map((category) => (
                    <th key={category} className="px-3 py-3 text-center">
                      {category}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((row) => (
                  <tr key={row.accountKey} className="align-top">
                    <td className="px-4 py-4">
                      <div>
                        <p className="font-semibold text-slate-900">{row.accountLabel}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {strongestGapLabel(row.cells)}
                        </p>
                      </div>
                    </td>
                    {categories.map((category) => {
                      const cell = row.cells.find((item) => item.category === category);
                      if (!cell) {
                        return (
                          <td key={`${row.accountKey}-${category}`} className="px-3 py-4">
                            <div className="rounded-[1rem] border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-center text-xs text-slate-400">
                              -
                            </div>
                          </td>
                        );
                      }

                      const tone = cellTone(cell.gapPct);
                      return (
                        <td key={`${row.accountKey}-${category}`} className="px-3 py-4">
                          <div
                            className={joinClasses(
                              "min-w-[120px] rounded-[1rem] border px-3 py-3",
                              tone.className,
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold">{tone.label}</span>
                              <span className={joinClasses("h-2.5 w-2.5 rounded-full", tone.dot)} />
                            </div>
                            <p className="mt-2 text-base font-semibold">
                              {formatGap(cell.gapPct)}
                            </p>
                            <p className="mt-1 text-[11px] leading-5 opacity-80">
                              목표 {formatPct(cell.targetPct)} / 현재 {formatPct(cell.currentPct)}
                            </p>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {rows.map((row) => {
              const top = [...row.cells].sort(
                (left, right) => Math.abs(right.gapPct) - Math.abs(left.gapPct),
              )[0];
              const tone = top ? cellTone(top.gapPct) : null;

              return (
                <div
                  key={`${row.accountKey}-summary`}
                  className="rounded-[1rem] border border-slate-200 bg-white px-4 py-4"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {row.accountLabel}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">
                    {top ? top.category : "데이터 없음"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {top ? `가장 큰 차이 ${formatGap(top.gapPct)}` : "목표 배분 정보 없음"}
                  </p>
                  {tone ? (
                    <span
                      className={joinClasses(
                        "mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium",
                        tone.className,
                      )}
                    >
                      {tone.label}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-[1.2rem] border border-dashed border-slate-200 bg-white/80 px-4 py-5 text-sm leading-7 text-slate-500">
          배분 히트맵에 표시할 계좌 또는 카테고리 데이터가 아직 없습니다.
        </div>
      )}
    </div>
  );
}
