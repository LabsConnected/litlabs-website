"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  ChevronRight,
  Coins,
  Crown,
  Film,
  FolderOpen,
  Hammer,
  Image as ImageIcon,
  MessageSquare,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useAppUser, useClerkAuth } from "@/hooks/useClerkAuth";
import { COLLAPSED_KEY, NAV_GROUPS, type NavGroup } from "@/lib/navigation";

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onCollapseChange?: () => void;
}

const QUICK_TOOLS = [
  { label: "Chat", href: "/studio?tool=chat", icon: MessageSquare, color: "#22d3ee" },
  { label: "Image", href: "/studio?tool=image", icon: ImageIcon, color: "#a78bfa" },
  { label: "Video", href: "/studio?tool=video", icon: Film, color: "#f472b6" },
  { label: "Audio", href: "/studio?tool=audio", icon: Music2, color: "#e879f9" },
  { label: "Build", href: "/studio?tool=builder", icon: Hammer, color: "#fb923c" },
  { label: "Terminal", href: "/studio?tool=terminal", icon: TerminalSquare, color: "#34d399" },
  { label: "Agents", href: "/agents", icon: Bot, color: "#c084fc" },
  { label: "Assets", href: "/gallery", icon: FolderOpen, color: "#2dd4bf" },
] as const;

function SidebarContent({
  collapsed,
  onClose,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onClose?: () => void;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { balance } = useWallet();
  const { isSignedIn } = useClerkAuth();
  const { user } = useAppUser();
  const [plan, setPlan] = useState("free");

  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    let current = true;
    fetch(`/api/users/${user.id}/plan`)
      .then((response) => (response.ok ? response.json() : { plan: "free" }))
      .then((data) => {
        if (current && data.plan) setPlan(data.plan);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [isSignedIn, user?.id]);

  const activeHref = useCallback(
    (href: string) => {
      const [path, query] = href.split("?");
      if (pathname !== path) return false;
      if (!query) return true;
      const params = new URLSearchParams(query);
      return Array.from(params.entries()).every(
        ([key, value]) => searchParams.get(key) === value,
      );
    },
    [pathname, searchParams],
  );

  const activeGroup = (group: NavGroup) =>
    pathname === group.href ||
    (group.href !== "/dashboard" && pathname.startsWith(`${group.href}/`)) ||
    group.items.some(
      (item) =>
        item.href &&
        (group.label === "Studio" || !item.href.startsWith("/studio")) &&
        activeHref(item.href),
    );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header
        className="flex h-14 shrink-0 items-center border-b px-3"
        style={{ borderColor: `${T.borderColor}22` }}
      >
        <Link href="/dashboard" onClick={onClose} aria-label="LiTTree-LabStudios dashboard" className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border"
            style={{ backgroundColor: `${T.accentColor}14`, borderColor: `${T.accentColor}35`, color: T.accentColor, boxShadow: `inset 0 0 18px ${T.accentColor}20` }}
          >
            <Zap size={17} />
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <b className="block truncate bg-gradient-to-r from-white via-violet-200 to-fuchsia-400 bg-clip-text text-[11px] font-black tracking-[.035em] text-transparent">LiTTree-LabStudios</b>
              <span className="block text-[7px] font-bold uppercase tracking-[.2em]" style={{ color: T.textMuted }}>Creative AI platform</span>
            </span>
          )}
        </Link>
        {onToggleCollapse && !onClose && (
          <button onClick={onToggleCollapse} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/5" style={{ color: T.textMuted }} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/5" style={{ color: T.textMuted }} aria-label="Close navigation"><X size={16} /></button>
        )}
      </header>

      <div className="sidebar-scroll flex-1 overflow-y-auto px-2.5 pb-3">
        {!collapsed && <LiTTAgentCard onClose={onClose} T={T} />}

        <SectionLabel collapsed={collapsed}>Quick access</SectionLabel>
        <div className={collapsed ? "grid gap-1.5" : "grid grid-cols-4 gap-1.5"}>
          {QUICK_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const active = activeHref(tool.href);
            return (
              <Link
                key={tool.label}
                href={tool.href}
                onClick={onClose}
                title={tool.label}
                className={`relative flex min-h-12 flex-col items-center justify-center rounded-xl border transition-all hover:-translate-y-px ${collapsed ? "mx-auto w-11" : ""}`}
                style={{
                  backgroundColor: active ? `${tool.color}18` : `${T.boxBg}70`,
                  borderColor: active ? `${tool.color}60` : `${T.borderColor}18`,
                  color: tool.color,
                  boxShadow: active ? `0 0 18px ${tool.color}20` : "none",
                }}
              >
                <Icon size={15} />
                {!collapsed && <span className="mt-1 truncate text-[7px] font-bold" style={{ color: T.textMuted }}>{tool.label}</span>}
              </Link>
            );
          })}
        </div>

        <SectionLabel collapsed={collapsed}>Main navigation</SectionLabel>
        <nav className="space-y-1">
          {NAV_GROUPS.map((group) => {
            const active = activeGroup(group);
            return (
              <Link
                key={group.label}
                href={group.href}
                onClick={onClose}
                title={group.label}
                className={`group relative flex h-10 items-center rounded-xl border transition-all ${collapsed ? "mx-auto w-11 justify-center" : "gap-2.5 px-3"}`}
                style={{
                  background: active ? `linear-gradient(90deg, ${group.accent}28, ${group.accent}08, transparent)` : "transparent",
                  borderColor: active ? `${group.accent}38` : "transparent",
                  color: active ? T.textColor : T.textMuted,
                  boxShadow: active ? `inset 2px 0 0 ${group.accent}` : "none",
                }}
              >
                <group.icon size={16} style={{ color: group.accent }} />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold">{group.label}</span>
                    {group.label === "Marketplace" && <span className="rounded-full border px-1.5 py-0.5 text-[7px] font-black" style={{ borderColor: `${group.accent}35`, color: group.accent }}>NEW</span>}
                    <ChevronRight size={12} className="opacity-25 transition-transform group-hover:translate-x-0.5 group-hover:opacity-70" />
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        {!collapsed && <CreditsCard balance={balance} plan={plan} T={T} />}
      </div>

      <SystemStatus collapsed={collapsed} T={T} />
    </div>
  );
}

function LiTTAgentCard({ onClose, T }: { onClose?: () => void; T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <section className="relative mt-3 overflow-hidden rounded-2xl border p-2" style={{ borderColor: `${T.accentColor}38`, backgroundColor: `${T.boxBg}bb` }}>
      <div className="relative h-24 overflow-hidden rounded-xl border bg-cover bg-center" style={{ borderColor: `${T.borderColor}20`, backgroundImage: "linear-gradient(to top, rgba(5,6,12,.95), rgba(5,6,12,.08)), url('/api/artwork/void-entity')" }}>
        <span className="absolute left-2 top-2 rounded-full border bg-black/65 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-violet-200" style={{ borderColor: `${T.accentColor}45` }}>LiTT</span>
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-emerald-400/25 bg-black/65 px-1.5 py-0.5 text-[7px] font-black uppercase text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Online</span>
        <div className="absolute inset-x-2 bottom-2">
          <b className="block text-[10px] text-white">Your AI building partner</b>
          <span className="text-[7px] text-white/55">Project-aware · voice · vision · code</span>
        </div>
      </div>
      <div className="mt-2 flex h-5 items-end gap-[2px] overflow-hidden rounded-lg border bg-black/25 px-2 py-1" style={{ borderColor: `${T.borderColor}18` }}>
        {Array.from({ length: 30 }).map((_, index) => (
          <span key={index} className="w-[2px] rounded-full" style={{ height: `${22 + ((index * 19) % 72)}%`, opacity: 0.45 + ((index * 7) % 45) / 100, background: `linear-gradient(${T.accentColor}, ${T.linkColor})` }} />
        ))}
      </div>
      <Link href="/studio?tool=chat" onClick={onClose} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[8px] font-black uppercase tracking-[.12em] transition-colors hover:bg-white/5" style={{ borderColor: `${T.accentColor}35`, backgroundColor: `${T.accentColor}12`, color: T.headerColor }}>
        <Sparkles size={10} /> Ask LiTT anything
      </Link>
    </section>
  );
}

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return <div className={`mb-1.5 mt-4 text-[8px] font-black uppercase tracking-[.2em] ${collapsed ? "text-center" : "px-1"}`} style={{ color: "rgba(255,255,255,.32)" }}>{collapsed ? "•••" : children}</div>;
}

function CreditsCard({ balance, plan, T }: { balance: number; plan: string; T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <section className="relative mt-4 overflow-hidden rounded-2xl border p-3" style={{ borderColor: `${T.accentColor}35`, background: `radial-gradient(circle at 90% 20%, ${T.accentColor}24, transparent 35%), ${T.boxBg}` }}>
      <div className="text-[8px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>Credits & plan</div>
      <div className="mt-2 flex items-end justify-between">
        <div><b className="text-lg text-white">{balance.toLocaleString()} <span className="text-[10px]" style={{ color: T.accentColor }}>LBC</span></b><div className="text-[8px] capitalize" style={{ color: T.textMuted }}>{plan} plan</div></div>
        <Coins size={24} style={{ color: `${T.accentColor}bb` }} />
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full w-[72%] rounded-full" style={{ background: `linear-gradient(90deg, ${T.accentColor}, ${T.linkColor})` }} /></div>
      <Link href="/wallet" className="mt-2.5 flex items-center justify-center gap-1.5 rounded-xl border py-2 text-[9px] font-black" style={{ borderColor: `${T.accentColor}35`, backgroundColor: `${T.accentColor}14`, color: T.headerColor }}><Crown size={11} /> Manage credits</Link>
    </section>
  );
}

function SystemStatus({ collapsed, T }: { collapsed: boolean; T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="shrink-0 border-t p-2.5" style={{ borderColor: `${T.borderColor}20` }}>
      <Link href="/settings" className={`flex items-center rounded-xl border border-emerald-400/10 bg-emerald-400/[.035] ${collapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2"}`}>
        <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-400/10"><ShieldCheck size={14} className="text-emerald-400" /><span className="absolute right-0 top-0 h-2 w-2 rounded-full border-2 border-[#080910] bg-emerald-400" /></span>
        {!collapsed && <span className="min-w-0"><b className="block text-[8px] uppercase tracking-wider" style={{ color: T.textMuted }}>System status</b><span className="block truncate text-[8px] font-bold text-emerald-400">All systems operational</span></span>}
      </Link>
    </div>
  );
}

export default function Sidebar({
  collapsed: externalCollapsed,
  onCollapseChange,
}: SidebarProps) {
  const { resolvedColors: T } = useTheme();
  const [internalCollapsed, setInternalCollapsed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  const collapsed = externalCollapsed ?? internalCollapsed;
  const toggleCollapse = () => {
    if (onCollapseChange) return onCollapseChange();
    setInternalCollapsed((current) => {
      const next = !current;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };
  const shellStyle = {
    background: `linear-gradient(180deg, ${T.bgColor}fc, #07060d 60%, ${T.bgColor}fc)`,
    borderColor: `${T.borderColor}24`,
    boxShadow: "18px 0 60px rgba(0,0,0,.28)",
  };

  return (
    <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r transition-[width] duration-300 md:flex ${collapsed ? "w-[72px]" : "w-[280px]"}`} style={shellStyle}>
      <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} />
    </aside>
  );
}
