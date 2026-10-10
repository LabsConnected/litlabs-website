"use client";

import Link from "next/link";
import {
  Activity,
  Bot,
  Eye,
  FolderOpen,
  Home,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  Network,
  Shapes,
} from "lucide-react";
import type { StudioDestination } from "../lib/studio-destinations";

interface NavItem {
  id: StudioDestination;
  label: string;
  icon: typeof LayoutGrid;
}

const NAV_ITEMS: NavItem[] = [
  { id: "studio", label: "Studio", icon: LayoutGrid },
  { id: "create", label: "Create", icon: Shapes },
  { id: "assets", label: "Assets", icon: FolderOpen },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "missions", label: "Missions", icon: Network },
  { id: "more", label: "More", icon: MoreHorizontal },
];

export type MobileStudioSurface = "chat" | "preview" | "files" | "activity" | "more";

/* ── Mobile bottom tab bar — work surfaces, not app destinations ── */
export function MobileCommandNav({
  active,
  onSelect,
  surface,
  onSelectSurface,
}: {
  active: StudioDestination;
  onSelect: (dest: StudioDestination) => void;
  /** When provided, mobile is the shared work surface dock. */
  surface?: MobileStudioSurface | null;
  onSelectSurface?: (surface: MobileStudioSurface) => void;
}) {
  const surfaceItems: { id: MobileStudioSurface; label: string; icon: typeof MessageSquare }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "preview", label: "Preview", icon: Eye },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "more", label: "More", icon: MoreHorizontal },
  ];

  return (
    <nav
      aria-label="Studio navigation"
      className="flex md:hidden shrink-0 items-stretch border-t"
      style={{
        height: "calc(var(--studio-mobile-bottom-h) + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
        backgroundColor: "rgba(7,5,13,0.85)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {onSelectSurface ? surfaceItems.map((item) => {
        const Icon = item.icon;
        const isActive = surface === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectSurface(item.id)}
            className="relative flex min-h-10 flex-1 flex-col items-center justify-center gap-1 transition-colors"
            style={{ color: isActive ? "var(--color-accent)" : "var(--text-muted)" }}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            {isActive && <span className="absolute top-0 h-0.5 w-8 rounded-b-full" style={{ backgroundColor: "var(--color-accent)", boxShadow: "0 0 8px var(--color-accent)" }} aria-hidden />}
            <Icon size={20} strokeWidth={isActive ? 2.3 : 1.8} className="pointer-events-none" />
            <span className="text-[10px] font-bold">{item.label}</span>
          </button>
        );
      }) : (
        <>
          <Link href="/dashboard" className="flex flex-1 flex-col items-center justify-center gap-1 transition-colors" style={{ color: "var(--text-muted)" }} aria-label="Go to dashboard">
            <Home size={20} strokeWidth={1.8} className="pointer-events-none" />
            <span className="text-[10px] font-bold">Home</span>
          </Link>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors" style={{ color: isActive ? "var(--color-accent)" : "var(--text-muted)" }} aria-label={item.label} aria-current={isActive ? "page" : undefined}>
                {isActive && <span className="absolute top-0 h-0.5 w-8 rounded-b-full" style={{ backgroundColor: "var(--color-accent)", boxShadow: "0 0 8px var(--color-accent)" }} aria-hidden />}
                <Icon size={20} strokeWidth={isActive ? 2.3 : 1.8} className="pointer-events-none" />
                <span className="text-[10px] font-bold">{item.label}</span>
              </button>
            );
          })}
        </>
      )}
    </nav>
  );
}
