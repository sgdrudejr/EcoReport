"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BrainCircuit,
  LayoutGrid,
  Newspaper,
  PenSquare,
  RefreshCw,
  ScrollText,
  WalletCards,
} from "lucide-react";

const links = [
  { href: "/dashboard-test", label: "대시보드 Test", mobileLabel: "테스트", icon: LayoutGrid },
  { href: "/market-news", label: "시황 뉴스", mobileLabel: "뉴스", icon: Newspaper },
  { href: "/dashboard", label: "기존 대시보드", mobileLabel: "기존", icon: ScrollText },
  { href: "/portfolio", label: "포트폴리오", mobileLabel: "자산", icon: WalletCards },
  { href: "/portfolio/update", label: "업데이트", mobileLabel: "업데이트", icon: RefreshCw },
  { href: "/manual-llm", label: "LLM 저장", mobileLabel: "AI 노트", icon: BrainCircuit },
];

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard-test") return pathname === "/" || pathname === "/dashboard-test";
  if (href === "/portfolio") return pathname === "/portfolio";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MainNav() {
  const pathname = usePathname();
  const [isCondensed, setIsCondensed] = useState(false);

  useEffect(() => {
    const updateNavState = () => {
      const nextCondensed = window.scrollY > 28;
      setIsCondensed((current) => (current === nextCondensed ? current : nextCondensed));
      document.documentElement.style.setProperty(
        "--desktop-nav-offset",
        nextCondensed ? "4.15rem" : "5.25rem",
      );
      document.documentElement.style.setProperty(
        "--account-tabs-gap",
        "0.25rem",
      );
    };

    updateNavState();
    window.addEventListener("scroll", updateNavState, { passive: true });
    window.addEventListener("resize", updateNavState);

    return () => {
      window.removeEventListener("scroll", updateNavState);
      window.removeEventListener("resize", updateNavState);
      document.documentElement.style.setProperty("--desktop-nav-offset", "5.25rem");
      document.documentElement.style.setProperty("--account-tabs-gap", "0.25rem");
    };
  }, []);

  return (
    <>
      <header
        className={joinClasses(
          "sticky top-0 z-50 hidden border-b border-slate-200 bg-white backdrop-blur-2xl transition-all duration-300 md:block",
          isCondensed ? "shadow-[0_8px_20px_rgba(15,23,42,0.07)]" : "",
        )}
      >
        <div
          className={joinClasses(
            "mx-auto flex max-w-7xl items-center justify-between px-6 transition-all duration-300",
            isCondensed ? "gap-4 py-2.5" : "gap-6 py-4",
          )}
        >
          <Link href="/dashboard-test" className={joinClasses("flex items-center transition-all duration-300", isCondensed ? "gap-2.5" : "gap-3")}>
            <div
              className={joinClasses(
                "flex items-center justify-center bg-indigo-600 text-white transition-all duration-300",
                isCondensed
                  ? "size-8 rounded-xl shadow-[0_5px_14px_rgba(99,102,241,0.28)]"
                  : "size-10 rounded-2xl shadow-[0_9px_20px_rgba(99,102,241,0.3)]",
              )}
            >
              <PenSquare size={isCondensed ? 15 : 18} />
            </div>
            <div>
              <p
                className={joinClasses(
                  "font-semibold tracking-[0.08em] text-slate-950 transition-all duration-300",
                  isCondensed ? "text-[13px]" : "text-sm",
                )}
              >
                EcoReport
              </p>
              <p
                className={joinClasses(
                  "overflow-hidden text-slate-500 transition-all duration-300",
                  isCondensed ? "max-h-0 text-[11px] opacity-0" : "max-h-5 text-xs opacity-100",
                )}
              >
                White research dashboard
              </p>
            </div>
          </Link>

          <nav className={joinClasses("flex items-center transition-all duration-300", isCondensed ? "gap-1.5" : "gap-2")}>
            {links.map((link) => {
              const isActive = isActivePath(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={joinClasses(
                    "rounded-full border font-medium transition-all duration-300",
                    isCondensed ? "px-3.5 py-1.5 text-[13px]" : "px-4 py-2 text-sm",
                    isActive
                      ? "border-indigo-600 bg-indigo-600 text-white"
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
          <div className="grid grid-cols-6 gap-1">
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
                      ? "bg-indigo-600 text-white shadow-[0_8px_16px_rgba(99,102,241,0.28)]"
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
