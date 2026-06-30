"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import {
  LayoutDashboard,
  Zap,
  ShoppingBag,
  Bot,
  Gamepad2,
  Settings,
  User,
  Terminal,
  ImageIcon,
  Music,
  Radio,
  MessageSquare,
  X,
  Mic,
  Clapperboard,
} from "lucide-react";

const GROUP_ACCENT: Record<string, string> = {
  Core: "#00f0ff",
  Creative: "#ff00a0",
  Community: "#8b5cf6",
  System: "#666688",
};

const NAV_GROUPS = [
  {
    label: "Core",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/agent-chat", label: "Jarvis", icon: Bot },
      { href: "/studio", label: "Studio", icon: Zap },
    ],
  },
  {
    label: "Creative",
    items: [
      { href: "/gallery", label: "Gallery", icon: ImageIcon },
      { href: "/dashboard?app=music", label: "Music", icon: Music, appId: "music" },
      { href: "/dashboard?app=radio", label: "Radio", icon: Radio, appId: "radio" },
      { href: "/dashboard?app=audio-tools", label: "Audio Studio", icon: Mic, appId: "audio-tools" },
      { href: "/dashboard?app=watch", label: "Watch", icon: Clapperboard, appId: "watch" },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "/social", label: "Social", icon: MessageSquare },
      { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
      { href: "/games", label: "Games", icon: Gamepad2 },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/agents", label: "Agents", icon: Terminal },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/profile", label: "Profile", icon: User },
    ],
  },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();

  const isActive = (href: string, appId?: string) => {
    const path = href.split("?")[0];
    if (appId) {
      return pathname === "/dashboard" && searchParams.get("app") === appId;
    }
    if (path === "/dashboard") return pathname === "/dashboard" && !searchParams.get("app");
    return pathname?.startsWith(path);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Close button — mobile only */}
      {onClose && (
        <div className="flex items-center justify-between px-4 py-3 lg:hidden border-b" style={{ borderColor: `${T.borderColor}30` }}>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Menu</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" style={{ color: T.textMuted }}>
            <X size={16} />
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
        {NAV_GROUPS.map((group) => {
          const accent = GROUP_ACCENT[group.label];
          return (
            <div key={group.label}>
              {/* Group label — shown on lg+ (full sidebar) and in mobile drawer; hidden on md icon-rail */}
              <div
                className="hidden lg:block px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest"
                style={{ color: accent + "cc" }}
              >
                {group.label}
              </div>
              {/* Drawer only (injected via absolute overlay, bypasses md breakpoint) */}
              {!!onClose && (
                <div
                  className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: accent + "cc" }}
                >
                  {group.label}
                </div>
              )}

              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href, (item as { appId?: string }).appId);
                  return (
                    <Link key={item.href} href={item.href} onClick={onClose}>
                      <div
                        className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group"
                        style={{
                          backgroundColor: active ? `${accent}12` : "transparent",
                          color: active ? accent : T.textMuted,
                        }}
                      >
                        {/* Left accent bar */}
                        {active && (
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                            style={{ backgroundColor: accent }}
                          />
                        )}
                        <Icon
                          size={17}
                          style={{ color: active ? accent : T.textMuted, flexShrink: 0 }}
                          className="transition-colors group-hover:opacity-100"
                        />
                        {/* Label — hidden on md icon rail, shown on lg+ and drawer */}
                        <span className="hidden lg:block md:hidden truncate">{item.label}</span>
                        <span className="lg:hidden block truncate">{item.label}</span>

                        {/* Tooltip on icon-rail (md only) */}
                        <span
                          className="hidden md:block lg:hidden absolute left-14 z-50 px-2 py-1 rounded text-[10px] font-bold opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity"
                          style={{
                            backgroundColor: T.boxBg,
                            border: `1px solid ${T.borderColor}40`,
                            color: T.textColor,
                          }}
                        >
                          {item.label}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const { resolvedColors: T } = useTheme();

  const sidebarBase = {
    backgroundColor: `${T.bgColor}f0`,
    borderColor: `${T.borderColor}30`,
  };

  return (
    <>
      {/* Desktop: full sidebar (lg+) */}
      <aside
        className="hidden lg:flex flex-col w-64 h-screen sticky top-0 border-r shrink-0"
        style={sidebarBase}
      >
        <SidebarContent />
      </aside>

      {/* Tablet: icon rail (md only) */}
      <aside
        className="hidden md:flex lg:hidden flex-col w-16 h-screen sticky top-0 border-r shrink-0"
        style={sidebarBase}
      >
        <SidebarContent />
      </aside>

      {/* Mobile: slide-out drawer overlay (< md) */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Drawer panel */}
          <aside
            className="relative flex flex-col w-72 h-full border-r shadow-2xl"
            style={sidebarBase}
          >
            <SidebarContent onClose={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}
