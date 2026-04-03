import Link from "next/link";

const links = [
  { href: "/", label: "대시보드" },
  { href: "/reports", label: "리포트" },
  { href: "/portfolio", label: "포트폴리오" },
  { href: "/portfolio/update", label: "업데이트" },
];

export default function MainNav() {
  return (
    <nav className="border-b border-zinc-900 bg-zinc-950/90 backdrop-blur">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4 overflow-x-auto">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors whitespace-nowrap"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
