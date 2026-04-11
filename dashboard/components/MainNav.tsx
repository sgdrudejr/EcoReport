"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BrainCircuit,
  LayoutGrid,
  PenSquare,
  RefreshCw,
  ScrollText,
  WalletCards,
} from "lucide-react";

const links = [
  { href: "/", label: "대시보드 Test", mobileLabel: "테스트", icon: LayoutGrid },
  { href: "/dashboard", label: "기존 대시보드", mobileLabel: "기존", icon: ScrollText },
  { href: "/feedback", label: "Feedback", mobileLabel: "피드백", icon: Activity },
  { href: "/portfolio", label: "포트폴리오", mobileLabel: "자산", icon: WalletCards },
  { href: "/portfolio/update", label: "업데이트", mobileLabel: "업데이트", icon: RefreshCw },
  { href: "/manual-llm", label: "LLM 저장", mobileLabel: "AI 노트", icon: BrainCircuit },
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
