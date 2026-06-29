"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import {
  LayoutDashboard,
  Zap,
  Sparkles,
  ShoppingBag,
  Bot,
  Gamepad2,
  Settings,
  User,
  Terminal,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/studio", label: "Studio", icon: Zap },
  { href: "/gallery", label: "Gallery", icon: Sparkles },
  { href: "/agent", label: "Jarvis", icon: Bot },
  { href: "/agents", label: "Agents", icon: Terminal },
  { href: "/marketplace", label: "Market", icon: ShoppingBag },
  { href: "/games", label: "Play", icon: Gamepad2 },
];

const secondaryItems = [
  { href: "/profile", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/";
    }
    return pathname?.startsWith(path);
  };

  return (
    <aside
      className="hidden lg:flex flex-col w-64 h-screen sticky top-0 border-r"
      style={{
        backgroundColor: `${T.bgColor}95`,
        borderColor: `${T.borderColor}40`,
      }}
    >
      <div className="flex-1 py-6 px-4">
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    backgroundColor: active ? `${T.accentColor}15` : "transparent",
                    color: active ? T.accentColor : T.textColor,
                    border: active ? `1px solid ${T.accentColor}30` : "1px solid transparent",
                  }}
                >
                  <Icon size={18} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="py-6 px-4 border-t" style={{ borderColor: `${T.borderColor}30` }}>
        <nav className="space-y-2">
          {secondaryItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all opacity-70 hover:opacity-100"
                  style={{
                    color: active ? T.accentColor : T.textMuted,
                  }}
                >
                  <Icon size={16} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
