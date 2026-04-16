"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FlaskConical, LayoutGrid, Layers3, Newspaper } from "lucide-react";

const links = [
  { href: "/", label: "실행 리포트", icon: LayoutGrid },
  { href: "/dashboard-test", label: "테스트 랩", icon: FlaskConical },
  { href: "/feedback-report", label: "피드백 리포트", icon: Activity },
  { href: "/market-news", label: "시황 뉴스", icon: Newspaper },
  { href: "/shadow-preview", label: "Shadow Preview", icon: Layers3 },
];

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MainNav() {
  const pathname = usePathname();

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
    </div>
  );
}
