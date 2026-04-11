"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LayoutGrid, Newspaper } from "lucide-react";

const links = [
  { href: "/", label: "대시보드", icon: LayoutGrid },
  { href: "/market-news", label: "시황 뉴스", icon: Newspaper },
  { href: "/feedback", label: "Feedback", icon: Activity },
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
  const [holdingsPreviewEnabled, setHoldingsPreviewEnabled] = useState(false);

  useEffect(() => {
    if (holdingsPreviewEnabled) {
      document.documentElement.dataset.holdingsPreview = "true";
    } else {
      delete document.documentElement.dataset.holdingsPreview;
    }

    return () => {
      delete document.documentElement.dataset.holdingsPreview;
    };
  }, [holdingsPreviewEnabled]);

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50 flex flex-col items-end gap-2">
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

      <label className="pointer-events-auto flex items-center gap-2 rounded-[1rem] border border-slate-200/80 bg-white/88 px-3 py-2 text-[11px] font-medium text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
        <span>보유종목 탭 테스트</span>
        <input
          type="checkbox"
          checked={holdingsPreviewEnabled}
          onChange={(event) => setHoldingsPreviewEnabled(event.target.checked)}
          className="size-3.5 rounded border-slate-300 accent-indigo-600"
        />
      </label>
    </div>
  );
}
