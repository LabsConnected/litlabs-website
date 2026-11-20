"use client";

/**
 * MobileStudioTopBar — the slim phone top bar (mobile layout card,
 * 2026-11-19).
 *
 * Chat is the home surface: project name on the left, New Chat + one
 * menu button on the right — no rows of icons. When a tool surface is
 * open instead of chat, the bar leads with a prominent Back to chat.
 *
 * Rendered only below the lg breakpoint (the mobile viewport tier is
 * <1024px); the desktop CommandStudioHeader takes over at lg and up.
 */

import { ChevronLeft, Menu, Plus } from "lucide-react";
import StudioProjectPicker from "./StudioProjectPicker";

export interface MobileStudioTopBarProps {
  projectId: string | null;
  projectName: string | null;
  onProjectSelect?: (projectId: string) => void;
  onCreateProject?: () => void;
  onDeleteProject?: (projectId: string) => void;
  onProjectRenamed?: (projectId: string, name: string) => void;
  /** True while the LiTT chat sheet is the visible surface. */
  chatOpen: boolean;
  /** Label of the open tool surface when chat is closed. */
  surfaceLabel?: string;
  onBackToChat?: () => void;
  onNewChat?: () => void;
  onOpenMenu?: () => void;
  /** A run is in flight — surfaced as a small working dot by the menu. */
  busy?: boolean;
}

const BAR_STYLE = {
  backgroundColor: "var(--studio-surface)",
  borderColor: "var(--studio-border)",
} as const;

export default function MobileStudioTopBar({
  projectId,
  projectName,
  onProjectSelect,
  onCreateProject,
  onDeleteProject,
  onProjectRenamed,
  chatOpen,
  surfaceLabel,
  onBackToChat,
  onNewChat,
  onOpenMenu,
  busy,
}: MobileStudioTopBarProps) {
  return (
    <header
      className="flex h-[var(--studio-header-h)] shrink-0 items-center gap-1 border-b px-2"
      style={BAR_STYLE}
      data-testid="mobile-studio-topbar"
    >
      {chatOpen ? (
        <div className="min-w-0 flex-1">
          <StudioProjectPicker
            projectId={projectId}
            projectName={projectName}
            onSelect={(id) => onProjectSelect?.(id)}
            onCreateProject={onCreateProject}
            onDeleteProject={onDeleteProject}
            onProjectRenamed={onProjectRenamed}
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={onBackToChat}
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-bold transition active:scale-95"
            style={{ color: "var(--litt-primary)" }}
            aria-label="Back to chat"
            data-testid="mobile-back-to-chat"
          >
            <ChevronLeft size={18} className="pointer-events-none" aria-hidden />
            <span className="pointer-events-none">Back to chat</span>
          </button>
          {surfaceLabel && (
            <span
              className="min-w-0 truncate text-[11px] font-bold"
              style={{ color: "var(--text-muted)" }}
              data-testid="mobile-surface-label"
            >
              {surfaceLabel}
            </span>
          )}
        </div>
      )}

      {chatOpen && onNewChat && (
        <button
          type="button"
          onClick={onNewChat}
          disabled={busy}
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-bold transition active:scale-95 disabled:opacity-40"
          style={{
            borderColor: "color-mix(in srgb, var(--litt-primary) 40%, transparent)",
            color: "var(--litt-primary)",
            backgroundColor: "color-mix(in srgb, var(--litt-primary) 8%, transparent)",
          }}
          aria-label="New chat"
          title="Start a new chat"
          data-testid="mobile-new-chat"
        >
          <Plus size={14} className="pointer-events-none" aria-hidden />
          <span className="pointer-events-none">New Chat</span>
        </button>
      )}

      {onOpenMenu && (
        <button
          type="button"
          onClick={onOpenMenu}
          className="relative grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg transition hover:bg-black/5"
          style={{ color: "var(--text-secondary)" }}
          aria-label="Menu"
          title="Menu"
          data-testid="mobile-studio-menu"
        >
          <Menu size={20} className="pointer-events-none" aria-hidden />
          {busy && (
            <span
              className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: "var(--litt-primary)" }}
              data-testid="mobile-menu-busy-dot"
              aria-hidden
            />
          )}
        </button>
      )}
    </header>
  );
}
