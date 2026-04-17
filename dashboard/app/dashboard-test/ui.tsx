import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";

export function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const KRW_FORMATTER = new Intl.NumberFormat("ko-KR");

export function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `₩${KRW_FORMATTER.format(Math.round(value))}`;
}

export function formatSignedPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatRatioPercent(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatCount(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return KRW_FORMATTER.format(value);
}

export function compactText(text: string | null | undefined, maxLength = 96) {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function statusTone(status: string | null | undefined) {
  if (status === "ok") {
    return {
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: CheckCircle2,
    };
  }

  if (status === "warn") {
    return {
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: AlertTriangle,
    };
  }

  return {
    className: "border-slate-200 bg-slate-50 text-slate-600",
    icon: CircleDashed,
  };
}

export function StatusChip({
  label,
  status,
}: {
  label: string;
  status: string | null | undefined;
}) {
  const tone = statusTone(status);
  const Icon = tone.icon;

  return (
    <span
      className={joinClasses(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]",
        tone.className,
      )}
    >
      <Icon size={12} />
      <span>{label}</span>
    </span>
  );
}

export function DashboardTestHeader({
  current,
  title,
  description,
}: {
  current: "home" | "execution" | "status" | "feedback";
  title: string;
  description: string;
}) {
  const links = [
    { href: "/dashboard-test", label: "테스트 홈", key: "home" },
    { href: "/dashboard-test/execution", label: "실행", key: "execution" },
    { href: "/dashboard-test/status", label: "현황", key: "status" },
    { href: "/dashboard-test/feedback", label: "피드백", key: "feedback" },
  ] as const;

  return (
    <section className="glass-panel rounded-2xl px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-3xl">
          <p className="section-kicker">Dashboard Test V2</p>
          <h1 className="mt-1.5 text-[1.4rem] font-semibold tracking-tight text-slate-950">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-[1.75] text-slate-600">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={joinClasses(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                current === link.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950",
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MetricCard({
  kicker,
  value,
  detail,
}: {
  kicker: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="glass-panel-soft rounded-[1.4rem] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {kicker}
      </p>
      <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </article>
  );
}

export function SectionCard({
  kicker,
  title,
  children,
  className,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={joinClasses("glass-panel rounded-2xl px-6 py-6", className)}>
      <p className="section-kicker">{kicker}</p>
      <h2 className="mt-2 text-[1.2rem] font-semibold tracking-tight text-slate-950">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="glass-panel rounded-2xl px-6 py-8">
      <p className="section-kicker">Dashboard Test</p>
      <h1 className="mt-2 text-[1.35rem] font-semibold tracking-tight text-slate-950">{title}</h1>
      <p className="mt-3 max-w-2xl text-[14px] leading-[1.75] text-slate-600">{description}</p>
    </section>
  );
}
