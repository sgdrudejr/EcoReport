"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BrainCircuit,
  LayoutGrid,
  PenSquare,
  RefreshCw,
  ScrollText,
  WalletCards,
} from "lucide-react";

const links = [
  { href: "/", label: "대시보드", mobileLabel: "홈", icon: LayoutGrid },
  { href: "/reports", label: "리포트", mobileLabel: "리포트", icon: ScrollText },
  { href: "/portfolio", label: "포트폴리오", mobileLabel: "자산", icon: WalletCards },
  { href: "/portfolio/update", label: "업데이트", mobileLabel: "업데이트", icon: RefreshCw },
  { href: "/manual-llm", label: "LLM 저장", mobileLabel: "AI 노트", icon: BrainCircuit },
];

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/portfolio") return pathname === "/portfolio";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MainNav() {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-50 hidden border-b border-slate-200/90 bg-white/96 backdrop-blur-2xl md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
              <PenSquare size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-[0.08em] text-slate-950">
                EcoReport
              </p>
              <p className="text-xs text-slate-500">
                White research dashboard
              </p>
            </div>
          </Link>

          <nav className="flex items-center gap-2">
            {links.map((link) => {
              const isActive = isActivePath(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={joinClasses(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+0.6rem)] md:hidden">
        <nav className="pointer-events-auto mx-auto max-w-xl rounded-[1.5rem] border border-slate-200/90 bg-white/96 p-1 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-2xl">
          <div className="grid grid-cols-5 gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = isActivePath(pathname, link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={joinClasses(
                    "flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-[1.05rem] px-2 text-[10.5px] font-medium transition",
                    isActive
                      ? "bg-slate-950 text-white shadow-[0_10px_18px_rgba(15,23,42,0.12)]"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  <Icon size={17} />
                  <span>{link.mobileLabel}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </>
  );
}
