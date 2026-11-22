"use client";

/**
 * LiTTMobileSheet — mobile (<1024px) access to LiTT.
 *
 * Reuses the exact same chatContent/liveContent the desktop LiTTPanel
 * uses. Only mounted while the sheet is open, so there is never a
 * second CommandComposer / LiTTLiveActivity instance alongside the
 * desktop rail.
 *
 * Geometry is driven by the Visual Viewport API so the sheet stays
 * pinned above the mobile keyboard instead of being covered by it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, FolderOpen, Component, Menu, Plus } from "lucide-react";
import { useVisualViewport } from "../../hooks/useVisualViewport";
import { mobileDiag } from "../../lib/mobileDiagnostics";
import type { LiTTTab } from "../LiTTPanel";

export interface LiTTMobileSheetProps {
  activeTab: LiTTTab;
  onTabChange: (tab: LiTTTab) => void;
  onClose: () => void;
  chatContent: ReactNode;
  liveContent: ReactNode;
  /** Files / Components surface (StudioProjectFiles) — when provided,
   *  the sheet's tab row gains Files and Components tabs beside Chat
   *  and Activity (Larry's placement decision, 2026-11-13). Both tabs
   *  show this one combined surface, mounted once. */
  filesContent?: ReactNode;
  /** Optional approval UI rendered full-width at the top of the sheet, above the tabs */
  approvalSlot?: ReactNode;
  /** Project context for the slim second header row (mobile density redesign) */
  projectName?: string | null;
  branch?: string | null;
  /** Opens the Tools sheet; when omitted, no tools button renders */
  onOpenTools?: () => void;
  /** Starts a fresh conversation; rendered as a New Chat button in the
   *  slim top bar while the Chat tab is showing (mobile layout card). */
  onNewChat?: () => void;
}

const MOBILE_BOTTOM_NAV_H = 0;

export default function LiTTMobileSheet({
  activeTab,
  onTabChange,
  onClose,
  chatContent,
  liveContent,
  filesContent,
  approvalSlot,
  projectName,
  branch,
  onOpenTools,
  onNewChat,
}: LiTTMobileSheetProps) {
  const vv = useVisualViewport();
  const contentRef = useRef<HTMLDivElement>(null);
  const [safeBottom, setSafeBottom] = useState(0);

  // Read the bottom safe-area once (env() cannot be read directly in JS).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:-9999px;padding-bottom:env(safe-area-inset-bottom);";
    document.body.appendChild(probe);
    const computed = window.getComputedStyle(probe);
    const pb = parseInt(computed.paddingBottom || "0", 10);
    setSafeBottom(Number.isFinite(pb) ? pb : 0);
    document.body.removeChild(probe);
  }, []);

  const bottomInset = Math.max(0, Math.round(vv.bottomInset));
  // Chat-first mobile layout (2026-11-19 card): the bottom work-surface
  // dock is retired on the phone — the sheet owns the full height down
  // to the safe area, staying pinned above the on-screen keyboard.
  //
  // Mobile gap fix (Larry, 2026-11-20): the sheet must span the VISUAL
  // viewport, not the layout viewport. When the Android keyboard opens,
  // Chrome scrolls the visual viewport over the layout viewport to keep
  // the focused composer visible, so vv.offsetTop grows > 0. A sheet
  // anchored at layout top:0 with height vv.height then ends
  // offsetTop pixels ABOVE the visual viewport's bottom edge, leaving a
  // band of dimmed backdrop + underlying workspace (media cards) showing
  // between the composer and the keyboard. Anchor the sheet's top at
  // vv.offsetTop so its bottom edge lands exactly on the visual
  // viewport's bottom edge — flush above the keyboard, nothing behind
  // or below the composer.
  const topOffset = Math.max(0, Math.round(vv.offsetTop));
  const MIN_SHEET_HEIGHT = 150;
  // While the keyboard is open it covers the bottom safe area, so the
  // safe-area inset is only subtracted when the keyboard is closed.
  const rawSheetHeight =
    Math.round(vv.height) + MOBILE_BOTTOM_NAV_H - (bottomInset > 0 ? 0 : safeBottom);
  // Never let the sheet render at (near-)0px — a bad viewport reading
  // should degrade to "small but usable", not "invisible/unusable".
  const sheetHeight = Math.max(MIN_SHEET_HEIGHT, rawSheetHeight);

  const loggedDegenerateRef = useRef(false);
  useEffect(() => {
    const degenerate = rawSheetHeight < MIN_SHEET_HEIGHT;
    if (degenerate && !loggedDegenerateRef.current) {
      loggedDegenerateRef.current = true;
      mobileDiag("viewport", "degenerate_sheet_height", {
        vvHeight: Math.round(vv.height),
        vvWidth: Math.round(vv.width),
        rawSheetHeight,
      });
    } else if (!degenerate) {
      loggedDegenerateRef.current = false;
    }
  }, [rawSheetHeight, vv.height, vv.width]);

  // When the keyboard opens, make sure the focused input (composer) is
  // scrolled into view inside the sheet's scrollable content area.
  useEffect(() => {
    if (!contentRef.current) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [vv.bottomInset, vv.height]);

  // Escape closes the sheet (same pattern as StudioDock's maximized Esc handling).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop covers the full viewport (including the bottom-nav strip the
          sheet stops above) so there is always a tappable region to dismiss.
          pointerdown closes immediately — the old onClick-only backdrop sat
          entirely behind the opaque sheet and could never receive taps. */}
      <div
        className="fixed inset-0 z-[10020] bg-black/55"
        onPointerDown={onClose}
        onClick={onClose}
        aria-label="Close LiTT"
        data-testid="litt-mobile-backdrop"
      />
      <div
        className="fixed inset-x-0 z-[10021] flex min-h-0 min-w-0 flex-col overflow-hidden border-t"
        style={{
          top: `${topOffset}px`,
          height: `${sheetHeight}px`,
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
        }}
        data-testid="litt-mobile-sheet"
        role="dialog"
        aria-label="LiTT assistant"
        aria-modal="true"
      >
        {approvalSlot && (
          <div className="w-full shrink-0" data-testid="litt-mobile-approval-slot">
            {approvalSlot}
          </div>
        )}

        {/* Slim top bar (mobile layout card, 2026-11-19): project name on
            the left, New Chat + one menu button on the right — no rows of
            icons. Chat is the home surface, so the Chat tab shows none of
            the sub-surface tabs; they appear only while a sub-surface
            (Live / Files / Components) is open, with a Back to chat. */}
        <div
          className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "var(--studio-surface)",
          }}
          data-testid="litt-mobile-topbar"
        >
          {activeTab === "chat" ? (
            <span
              className="min-w-0 flex-1 truncate px-1 text-[12px] font-bold"
              style={{ color: "var(--text-primary)" }}
              data-testid="litt-mobile-project-name"
            >
              {projectName ?? "LiTT"}
              {projectName && branch ? " · " : null}
              {branch}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onTabChange("chat")}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-bold transition active:scale-95"
              style={{ color: "var(--litt-primary)" }}
              aria-label="Back to chat"
              data-testid="litt-mobile-back-to-chat"
            >
              <span aria-hidden>‹</span>
              <span className="pointer-events-none">Chat</span>
            </button>
          )}
          <div className="flex-1" />
          {activeTab === "chat" && onNewChat && (
            <button
              type="button"
              onClick={onNewChat}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-bold transition active:scale-95"
              style={{
                borderColor: "color-mix(in srgb, var(--litt-primary) 40%, transparent)",
                color: "var(--litt-primary)",
                backgroundColor: "color-mix(in srgb, var(--litt-primary) 8%, transparent)",
              }}
              aria-label="New chat"
              data-testid="litt-mobile-new-chat"
            >
              <Plus size={14} className="pointer-events-none" aria-hidden />
              <span className="pointer-events-none">New Chat</span>
            </button>
          )}
          {onOpenTools && (
            <button
              type="button"
              onClick={onOpenTools}
              className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg transition hover:bg-black/5"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Menu"
              data-testid="litt-mobile-tools-button"
            >
              <Menu size={20} className="pointer-events-none" aria-hidden />
            </button>
          )}
        </div>

        {/* Sub-surface tabs — only while a non-chat tab is open, so the
            chat home stays free of icon rows. */}
        {activeTab !== "chat" && (
          <div
            className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1"
            style={{
              borderColor: "var(--studio-border)",
              backgroundColor: "var(--studio-surface)",
            }}
          >
            <button
              type="button"
              onClick={() => onTabChange("live")}
              className="flex min-h-11 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
              style={{
                color: activeTab === "live" ? "var(--color-accent)" : "var(--text-muted)",
                backgroundColor: activeTab === "live" ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
              }}
              aria-pressed={activeTab === "live"}
              data-testid="litt-mobile-tab-live"
            >
              <Activity size={12} className="pointer-events-none" />
              Activity
            </button>
            {filesContent ? (
              <>
                <button
                  type="button"
                  onClick={() => onTabChange("files")}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
                  style={{
                    color: activeTab === "files" ? "var(--color-accent)" : "var(--text-muted)",
                    backgroundColor: activeTab === "files" ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
                  }}
                  aria-pressed={activeTab === "files"}
                  data-testid="litt-mobile-tab-files"
                >
                  <FolderOpen size={12} className="pointer-events-none" />
                  Files
                </button>
                <button
                  type="button"
                  onClick={() => onTabChange("components")}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
                  style={{
                    color: activeTab === "components" ? "var(--color-accent)" : "var(--text-muted)",
                    backgroundColor: activeTab === "components" ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
                  }}
                  aria-pressed={activeTab === "components"}
                  data-testid="litt-mobile-tab-components"
                >
                  <Component size={12} className="pointer-events-none" />
                  Components
                </button>
              </>
            ) : null}
          </div>
        )}

        {/* Chat-bar cleanup (Larry, 2026-11-20): no build-status strip
            in the sheet header — the chat screen holds nothing extra.
            Run status lives in the Build status sheet, opened from the
            Tools sheet's "Build status" row. */}

        <div
          ref={contentRef}
          className="relative min-h-0 flex-1 overflow-hidden overscroll-contain"
          data-testid="litt-mobile-sheet-content"
        >
          <div
            className="absolute inset-0 flex min-w-0 flex-col overflow-hidden"
            style={{
              visibility: activeTab === "chat" ? "visible" : "hidden",
              pointerEvents: activeTab === "chat" ? "auto" : "none",
            }}
            data-active={activeTab === "chat"}
            data-testid="litt-mobile-chat-panel"
          >
            {chatContent}
          </div>
          <div
            className="absolute inset-0 flex min-w-0 flex-col overflow-hidden"
            style={{
              visibility: activeTab === "live" ? "visible" : "hidden",
              pointerEvents: activeTab === "live" ? "auto" : "none",
            }}
            data-active={activeTab === "live"}
            data-testid="litt-mobile-live-panel"
          >
            {liveContent}
          </div>
          {filesContent ? (
            <div
              className="absolute inset-0 flex min-w-0 flex-col overflow-hidden"
              style={{
                visibility: activeTab === "files" || activeTab === "components" ? "visible" : "hidden",
                pointerEvents: activeTab === "files" || activeTab === "components" ? "auto" : "none",
              }}
              data-active={activeTab === "files" || activeTab === "components"}
              data-testid="litt-mobile-files-panel"
            >
              {filesContent}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
