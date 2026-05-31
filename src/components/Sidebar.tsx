"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/marketplace", label: "Forge", icon: "🔧" },
  { href: "/gallery", label: "Gallery", icon: "🏛" },
  { href: "/builder", label: "Builder", icon: "🛠" },
  { href: "/agent-chat", label: "Chat", icon: "⚡" },
  { href: "/social", label: "Feed", icon: "👥" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r border-white/10 bg-white/[0.02] p-3 hidden md:flex flex-col shrink-0 h-[calc(100vh-56px)] sticky top-14">
      <nav className="flex-1 space-y-1">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="pt-3 mt-3 border-t border-white/10">
        <Link
          href="/settings"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            pathname === "/settings"
              ? "bg-white/10 text-white"
              : "text-zinc-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <span className="text-base">⚙</span>
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
