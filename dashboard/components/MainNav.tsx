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
      <header className="sticky top-0 z-50 hidden border-b border-white/6 bg-zinc-950/75 backdrop-blur-2xl md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 shadow-[0_10px_30px_rgba(16,185,129,0.15)]">
              <PenSquare size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-[0.18em] text-zinc-100">
                ECOREPORT
              </p>
              <p className="text-xs text-zinc-500">
                Portfolio intelligence cockpit
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
                    "rounded-full border px-4 py-2 text-sm transition-colors",
                    isActive
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                      : "border-white/0 text-zinc-400 hover:border-white/8 hover:bg-white/5 hover:text-zinc-100",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:hidden">
        <nav className="pointer-events-auto mx-auto max-w-xl rounded-[1.6rem] border border-white/10 bg-zinc-950/86 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <div className="grid grid-cols-5 gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = isActivePath(pathname, link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={joinClasses(
                    "flex min-h-[4.1rem] flex-col items-center justify-center gap-1 rounded-[1.1rem] px-2 text-[11px] font-medium transition",
                    isActive
                      ? "bg-emerald-400/12 text-emerald-200"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
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
