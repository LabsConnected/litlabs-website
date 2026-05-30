"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard", label: "Terminal", icon: "◈" },
  { href: "/marketplace", label: "Bot Forge", icon: "🔧" },
  { href: "/gallery", label: "Champions", icon: "🏛" },
  { href: "/builder", label: "Forge Agent", icon: "🛠" },
  { href: "/agent-chat", label: "Neural Link", icon: "⚡" },
  { href: "/social", label: "The Matrix", icon: "👥" },
];

const FOOTER_ITEMS = [
  { href: "/settings", label: "System Config", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();
  
  return (
    <aside className="w-64 border-r border-white/5 bg-black/40 p-4 hidden md:flex flex-col shrink-0 h-[calc(100vh-64px)] sticky top-16">
      <div className="text-[10px] font-bold text-text-muted tracking-[0.2em] mb-6 px-3 uppercase">
        Navigation_Core
      </div>
      
      <nav className="flex-1 space-y-2">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-all duration-300 group ${
                isActive
                  ? "bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 shadow-[0_0_20px_rgba(0,242,254,0.05)]"
                  : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
              }`}
            >
              <span className={`text-xl transition-transform group-hover:scale-110 ${isActive ? "opacity-100" : "opacity-50"}`}>
                {item.icon}
              </span>
              <span className="font-medium tracking-tight">{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1 h-1 rounded-full bg-neon-cyan animate-pulse" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="pt-4 mt-4 border-t border-white/5 space-y-2">
        {FOOTER_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-all ${
              pathname === item.href
                ? "bg-white/10 text-text-primary border border-white/10"
                : "text-text-secondary hover:bg-white/5"
            }`}
          >
            <span className="text-xl opacity-50">{item.icon}</span>
            <span className="font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
}
