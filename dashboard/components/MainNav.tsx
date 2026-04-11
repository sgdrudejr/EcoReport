"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Newspaper } from "lucide-react";
import { useExperimentalUi } from "@/components/ExperimentalUiProvider";

const links = [
  { href: "/", label: "대시보드", icon: LayoutGrid },
  { href: "/market-news", label: "시황 뉴스", icon: Newspaper },
];

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname === "/dashboard-test";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MainNav() {
  const pathname = usePathname();
  const { enabled, setEnabled } = useExperimentalUi();

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50 flex flex-col items-end">
      <nav className="pointer-events-auto flex flex-col items-stretch gap-1.5 rounded-[1.35rem] border border-slate-200/80 bg-white/88 p-1.5 shadow-[0_14px_30px_rgba(15,23,42,0.09)]">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = isActivePath(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={joinClasses(
                "inline-flex items-center justify-between gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition",
                isActive
                  ? "bg-indigo-600 text-white shadow-[0_8px_16px_rgba(99,102,241,0.22)]"
                  : "text-slate-600 hover:bg-white hover:text-slate-950",
              )}
            >
              <Icon size={15} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
      <label className="pointer-events-auto mt-2 flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/92 px-3 py-2 text-sm font-medium text-slate-700 shadow-[0_14px_30px_rgba(15,23,42,0.09)]">
        <span>테스트 UI</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
        />
      </label>
    </div>
  );
}
