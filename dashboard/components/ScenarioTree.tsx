import type { ResearchScenarioBranch } from "@/lib/research";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function branchTone(label: string) {
  if (/(main|base|기준|메인)/i.test(label)) {
    return {
      card: "border-sky-500/20 bg-sky-950/12",
      badge: "border-sky-500/30 bg-sky-950/25 text-sky-200",
      accent: "text-sky-200",
    };
  }

  if (/(risk|bear|down|하방|리스크)/i.test(label)) {
    return {
      card: "border-rose-500/20 bg-rose-950/12",
      badge: "border-rose-500/30 bg-rose-950/25 text-rose-200",
      accent: "text-rose-200",
    };
  }

  return {
    card: "border-white/8 bg-white/[0.03]",
    badge: "border-zinc-700 bg-zinc-900 text-zinc-300",
    accent: "text-zinc-100",
  };
}

export default function ScenarioTree({
  branches,
  title = "3-6개월 핵심 시나리오 트리",
  description = "예상과 다르게 흘러가더라도 바로 대응할 수 있게, 기본 경로와 Plan B를 같이 잡아둡니다.",
}: {
  branches: ResearchScenarioBranch[];
  title?: string;
  description?: string;
}) {
  if (branches.length === 0) return null;

  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4 md:p-5">
      <div>
        <p className="section-kicker">Scenario Tree</p>
        <h3 className="mt-2 text-lg font-semibold text-zinc-50">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {branches.map((branch) => {
          const tone = branchTone(branch.label);

          return (
            <article
              key={branch.id}
              className={joinClasses("rounded-[1.35rem] border p-4", tone.card)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Scenario
                  </p>
                  <h4 className={joinClasses("mt-2 text-base font-semibold", tone.accent)}>
                    {branch.label}
                  </h4>
                </div>
                {branch.probabilityLabel && (
                  <span
                    className={joinClasses(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      tone.badge,
                    )}
                  >
                    {branch.probabilityLabel}
                  </span>
                )}
              </div>

              {branch.narrative && (
                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    전개
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-200">
                    {branch.narrative}
                  </p>
                </div>
              )}

              {branch.response && (
                <div className="mt-4 rounded-[1rem] border border-white/8 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    대응
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-100">
                    {branch.response}
                  </p>
                </div>
              )}

              {branch.checkpoints.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    체크포인트
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {branch.checkpoints.map((checkpoint) => (
                      <span
                        key={`${branch.id}-${checkpoint}`}
                        className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300"
                      >
                        {checkpoint}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
