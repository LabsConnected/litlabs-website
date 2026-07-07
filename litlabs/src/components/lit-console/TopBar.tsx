"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  Cpu,
  Zap,
  Settings,
  Terminal,
  Circle,
  Home,
  Bot,
  Wand2,
  ShoppingBag,
  Image,
  Menu,
  X,
} from "lucide-react";
import { LC } from "./lit-console-theme";

interface TopBarProps {
  projectName: string;
  agentName: string;
  modelName: string;
  status: string;
}

const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/studio?tool=chat", label: "Console", icon: Terminal },
  { href: "/studio", label: "Studio", icon: Wand2 },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/gallery", label: "Gallery", icon: Image },
  { href: "/marketplace", label: "Market", icon: ShoppingBag },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function TopBar({
  projectName,
  agentName,
  modelName,
  status,
}: TopBarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const online =
    status.toLowerCase() === "online" || status.toLowerCase() === "connected";

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header
      className="flex h-[52px] w-full shrink-0 items-center justify-between px-3"
      style={{
        backgroundColor: LC.bgPanel,
        borderBottom: `1px solid ${LC.border}`,
      }}
    >
      {/* Brand + nav */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden rounded-md p-1.5 transition-colors hover:bg-white/5"
          style={{ color: LC.textMuted }}
          aria-label="Open navigation"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link href="/" className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-black"
            style={{
              background: "linear-gradient(135deg, #6366f1, #00f5ff)",
              color: "#fff",
            }}
          >
            L
          </div>
          <span
            className="hidden text-sm font-semibold tracking-wide sm:inline"
            style={{ color: LC.text }}
          >
            LiTTree OS
          </span>
        </Link>

        <div
          className="mx-2 hidden h-5 w-px md:block"
          style={{ backgroundColor: LC.border }}
        />

        <nav className="hidden items-center gap-0.5 md:flex">
          {navLinks.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors"
                style={{
                  color: active ? LC.accentCyan : LC.textMuted,
                  backgroundColor: active
                    ? `${LC.accentCyan}15`
                    : "transparent",
                }}
              >
                <Icon size={13} />
                <span className="hidden lg:inline">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile dropdown nav */}
        {menuOpen && (
          <div
            className="absolute left-3 right-3 top-12 z-50 rounded-lg border p-2 shadow-xl md:hidden"
            style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
          >
            {navLinks.map((link) => {
              const active = isActive(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold transition-colors"
                  style={{
                    color: active ? LC.accentCyan : LC.text,
                    backgroundColor: active
                      ? `${LC.accentCyan}15`
                      : "transparent",
                  }}
                >
                  <Icon size={14} />
                  {link.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Context chips */}
      <div className="hidden items-center gap-2 sm:flex">
        <button
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
        >
          <Layers size={14} style={{ color: LC.accentCyan }} />
          {projectName}
        </button>
        <button
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
        >
          <Cpu size={14} style={{ color: LC.accentOrange }} />
          {agentName}
        </button>
        <button
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
        >
          <Zap size={14} style={{ color: LC.success }} />
          {modelName}
        </button>
      </div>

      {/* Status + settings */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{
            color: LC.text,
            border: `1px solid ${LC.border}`,
            backgroundColor: LC.bgSecondary,
          }}
        >
          <Circle
            size={6}
            fill={online ? LC.success : LC.danger}
            stroke="none"
            style={{ opacity: online ? 1 : 0.7 }}
          />
          <span className="hidden sm:inline">{status}</span>
        </div>
        <Link
          href="/settings"
          className="rounded-md p-1.5 transition-colors hover:bg-white/5"
          style={{ color: LC.textMuted }}
        >
          <Settings size={18} />
        </Link>
      </div>
    </header>
  );
}
