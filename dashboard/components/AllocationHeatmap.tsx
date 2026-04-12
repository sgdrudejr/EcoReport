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
        <div className="mt-4">
          <div className="rounded-[1.2rem] border border-slate-200 bg-white">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">카테고리</th>
                  {rows.map((row) => (
                    <th key={row.accountKey} className="px-3 py-3 text-center">
                      {row.accountLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {categories.map((category) => (
                  <tr key={category} className="align-top">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-900">{category}</p>
                    </td>
                    {rows.map((row) => {
                      const cell = row.cells.find((item) => item.category === category);
                      if (!cell) {
                        return (
                          <td key={`${category}-${row.accountKey}`} className="px-3 py-4">
                            <div className="rounded-[1rem] border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-center text-xs text-slate-400">
                              -
                            </div>
                          </td>
                        );
                      }

                      const tone = cellTone(cell.gapPct);
                      return (
                        <td key={`${category}-${row.accountKey}`} className="px-3 py-4">
                          <div
                            className={joinClasses(
                              "min-w-[96px] rounded-[1rem] border px-3 py-3",
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
        </div>
      ) : (
        <div className="mt-4 rounded-[1.2rem] border border-dashed border-slate-200 bg-white/80 px-4 py-5 text-sm leading-7 text-slate-500">
          배분 히트맵에 표시할 계좌 또는 카테고리 데이터가 아직 없습니다.
        </div>
      )}
    </div>
  );
}
