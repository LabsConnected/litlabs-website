"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/social", label: "Social", icon: "👥" },
  { href: "/agent-chat", label: "AI Chat", icon: "⚡" },
  { href: "/marketplace", label: "Bot Forge", icon: "◉" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function Navbar({ onLogout, user }: { onLogout: () => void; user?: any }) {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-cyber-border bg-cyber-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/dashboard" className="font-heading text-lg font-bold tracking-wider text-neon-cyan text-glow-cyan">
          LITLABS
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(item => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  pathname === item.href
                    ? "bg-cyber-surface-2 text-neon-cyan"
                    : "text-text-secondary hover:bg-cyber-surface-2 hover:text-text-primary"
                }`}
              >
                {item.icon} {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-muted hidden sm:block">{user?.email}</span>
          <button onClick={onLogout} className="text-xs text-text-muted hover:text-neon-cyan transition-colors font-code">
            LOGOUT
          </button>
        </div>
      </div>
      {/* Mobile nav */}
      <div className="flex overflow-x-auto border-t border-cyber-border px-2 py-1.5 md:hidden">
        {NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              pathname === item.href ? "text-neon-cyan bg-cyber-surface-2" : "text-text-secondary"
            }`}
          >
            {item.icon} {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
