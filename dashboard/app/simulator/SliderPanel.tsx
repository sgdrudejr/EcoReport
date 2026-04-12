"use client";

type SliderPanelProps = {
  riskTolerance: number;
  factorTilt: number;
  reportTilt: number;
  onChange: (next: {
    riskTolerance?: number;
    factorTilt?: number;
    reportTilt?: number;
  }) => void;
};

function SliderRow({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between text-sm font-medium text-slate-700">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <input
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function SliderPanel(props: SliderPanelProps) {
  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
        What-If Controls
      </p>
      <div className="mt-5 space-y-5">
        <SliderRow
          label="리스크 허용도"
          value={props.riskTolerance}
          onChange={(value) => props.onChange({ riskTolerance: value })}
        />
        <SliderRow
          label="팩터 가중치"
          value={props.factorTilt}
          onChange={(value) => props.onChange({ factorTilt: value })}
        />
        <SliderRow
          label="리포트 가중치"
          value={props.reportTilt}
          onChange={(value) => props.onChange({ reportTilt: value })}
        />
      </div>
    </section>
  );
}
