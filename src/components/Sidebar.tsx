"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/social", label: "Social Hub", icon: "👥" },
  { href: "/agent-chat", label: "AI Chat", icon: "⚡" },
  { href: "/marketplace", label: "Bot Forge", icon: "◉" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 border-r border-cyber-border bg-cyber-surface p-4 hidden lg:block">
      <nav className="space-y-1">
        {ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname === item.href
                ? "bg-cyber-surface-2 text-neon-cyan font-medium"
                : "text-text-secondary hover:bg-cyber-surface-2 hover:text-text-primary"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
