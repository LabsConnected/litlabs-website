"use client";

/**
 * PhoneBottomNav — the single persistent bottom navigation for the
 * responsive Studio phone tier (<768px).
 *
 * Five entries: Chat, Preview, Files, Activity, More. Chat expands the
 * LiTT command layer (it is NOT a stage surface — per stage-surfaces.ts
 * "LiTT is NOT a surface"); Preview/Files/Activity drive the real
 * `openStageSurface`; More opens the More sheet. The stage itself is the
 * same StudioShell stage node — nothing is remounted or duplicated.
 *
 * - Minimum 44×44px touch targets (iOS HIG / Material).
 * - Respects iOS/Android safe areas via env(safe-area-inset-bottom).
 * - Lifts above the software keyboard using the visual-viewport bottom
 *   inset so the nav never sits under the keyboard.
 */

import { MessageSquare, Eye, FolderOpen, Activity, MoreHorizontal } from "lucide-react";
import { useVisualViewport } from "../../hooks/useVisualViewport";
import type { StudioStageSurface } from "../shell/stage-surfaces";

export type PhoneNavId = "chat" | "preview" | "files" | "activity" | "more";

const ITEMS: Array<{
  id: PhoneNavId;
  label: string;
  icon: typeof MessageSquare;
}> = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "more", label: "More", icon: MoreHorizontal },
];

export default function PhoneBottomNav({
  activeSurface,
  chatActive,
  onSelectSurface,
  onChat,
  onMore,
}: {
  /** The currently open stage surface (drives Preview/Files/Activity highlight). */
  activeSurface: StudioStageSurface;
  /** Whether the LiTT command layer is expanded (drives Chat highlight). */
  chatActive: boolean;
  /** Open a stage surface in the shared shell stage. */
  onSelectSurface: (surface: StudioStageSurface) => void;
  /** Expand the LiTT command layer. */
  onChat: () => void;
  /** Open the More sheet. */
  onMore: () => void;
}) {
  const vv = useVisualViewport();

  const isActive = (id: PhoneNavId) =>
    id === "chat" ? chatActive : activeSurface === id;

  const handleSelect = (id: PhoneNavId) => {
    if (id === "chat") return onChat();
    if (id === "more") return onMore();
    onSelectSurface(id);
  };

  return (
    <nav
      aria-label="Studio surfaces"
      data-testid="phone-bottom-nav"
      className="flex shrink-0 items-stretch border-t"
      style={{
        // Base dock height + safe-area + keyboard lift.
        height: `calc(60px + env(safe-area-inset-bottom) + ${vv.bottomInset}px)`,
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${vv.bottomInset}px)`,
        backgroundColor: "rgba(7,5,13,0.92)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelect(item.id)}
            className="relative flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 transition-colors active:scale-95"
            style={{ color: active ? "var(--color-accent)" : "var(--text-muted)" }}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            data-testid={`mobile-nav-${item.id}`}
          >
            {active && (
              <span
                className="absolute top-0 h-0.5 w-8 rounded-b-full"
                style={{
                  backgroundColor: "var(--color-accent)",
                  boxShadow: "0 0 8px var(--color-accent)",
                }}
                aria-hidden
              />
            )}
            <Icon
              size={22}
              strokeWidth={active ? 2.3 : 1.8}
              className="pointer-events-none"
              aria-hidden
            />
            <span className="pointer-events-none text-[10px] font-bold leading-none">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
