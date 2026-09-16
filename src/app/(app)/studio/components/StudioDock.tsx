"use client";

/**
 * StudioDock — intelligent bottom dock for the Studio workspace.
 *
 * Replaces the old left ContextDrawer + bottom StudioDrawer + inspector
 * hosting with a single bottom panel. Interaction model mirrors
 * StudioDrawer's (collapsed 44px tab strip / normal / maximized views,
 * drag-to-resize, sessionStorage persistence, Escape handling).
 *
 * Controlled by the parent: tab state, height, and open state all come in
 * as props; the dock owns only its view (collapsed/normal/maximized) and
 * syncs it with the `open` prop. All five tab content slots stay mounted
 * always; inactive ones render with display:none so the terminal PTY and
 * other tab state survive tab switches.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Clapperboard,
  FolderOpen,
  Maximize2,
  Minimize2,
  ScanSearch,
  SquareTerminal,
  X,
} from "lucide-react";

export type StudioDockTab =
  | "activity"
  | "files"
  | "terminal"
  | "inspector"
  | "media";

export interface StudioDockProps {
  open: boolean;
  activeTab: StudioDockTab;
  onTabChange: (t: StudioDockTab) => void;
  onClose: () => void;
  onToggle: () => void;
  /** Controlled height in px (default 320) */
  height?: number;
  onHeightChange: (h: number) => void;
  activityContent: ReactNode;
  filesContent: ReactNode;
  /** Keep mounted always (PTY stays alive) — rendered with display:none when inactive */
  terminalContent: ReactNode;
  inspectorContent: ReactNode;
  mediaContent: ReactNode;
  /** True while an agent run is in flight — pulses the Activity tab */
  activityPulse?: boolean;
  /** True when a terminal command failed — badges the Terminal tab */
  terminalBadge?: boolean;
}

const COLLAPSED_HEIGHT = 44;
const DOCK_MIN = 180;
const DOCK_DEFAULT = 320;
const DOCK_MAX_DVH = 65;
const HEIGHT_STORAGE_KEY = "studio-dock-height";
const OPEN_STORAGE_KEY = "studio-dock-open";

const CYAN = "#22d3ee";
const AMBER = "#e3b341";

type DockView = "collapsed" | "normal" | "maximized";

const DOCK_TABS: {
  id: StudioDockTab;
  label: string;
  icon: typeof Activity;
}[] = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "inspector", label: "Inspector", icon: ScanSearch },
  { id: "media", label: "Media", icon: Clapperboard },
];

export default function StudioDock({
  open,
  activeTab,
  onTabChange,
  onClose,
  onToggle,
  height = DOCK_DEFAULT,
  onHeightChange,
  activityContent,
  filesContent,
  terminalContent,
  inspectorContent,
  mediaContent,
  activityPulse = false,
  terminalBadge = false,
}: StudioDockProps) {
  // Internal view is the source of truth for rendering. The `open` prop
  // drives it only on CHANGES (tracked via prevOpen) so a parent that
  // updates its own state asynchronously can't clobber a tab-click that
  // just opened the dock internally. Initial state follows the `open` prop.
  const [view, setView] = useState<DockView>(() => (open ? "normal" : "collapsed"));
  const prevOpenRef = useRef(open);

  // Keep a ref of the controlled height so drag handlers never go stale.
  // Updated in an effect (never during render) per react-hooks/refs.
  const heightRef = useRef(height);
  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  const clampHeight = useCallback((h: number) => {
    const max = Math.round(window.innerHeight * (DOCK_MAX_DVH / 100));
    return Math.max(DOCK_MIN, Math.min(max, h));
  }, []);

  // Sync internal view with the controlled open prop — only when the
  // prop itself changes, so internal opens (tab click on the collapsed
  // strip) survive until the parent's state catches up.
  useEffect(() => {
    if (open === prevOpenRef.current) return;
    prevOpenRef.current = open;
    if (open) {
      setView((v) => (v === "collapsed" ? "normal" : v));
    } else {
      setView("collapsed");
    }
  }, [open]);

  // Persist height + open state under the dock's own keys.
  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_STORAGE_KEY, view !== "collapsed" ? "true" : "false");
      sessionStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
    } catch {
      /* noop */
    }
  }, [view, height]);

  const handleClose = useCallback(() => {
    setView("collapsed");
    onClose();
  }, [onClose]);

  const handleMaximize = useCallback(() => {
    setView((v) => (v === "maximized" ? "normal" : "maximized"));
  }, []);

  const handleTabClick = useCallback(
    (t: StudioDockTab) => {
      onTabChange(t);
      if (view === "collapsed") {
        setView("normal");
        onToggle();
      }
    },
    [view, onTabChange, onToggle],
  );

  // Escape collapses when maximized. No global keyboard shortcuts here —
  // the parent wires the ⌘J toggle.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input/textarea/contentEditable
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      // Don't intercept if xterm has focus
      const activeEl = document.activeElement;
      if (activeEl?.closest(".xterm")) return;

      if (e.key === "Escape" && view === "maximized") {
        e.preventDefault();
        setView("collapsed");
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, onClose]);

  // Drag-to-resize from the top edge handle.
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.resizeGrip !== "true") return;
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = heightRef.current;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const delta = startYRef.current - e.clientY;
      onHeightChange(clampHeight(startHeightRef.current + delta));
    },
    [clampHeight, onHeightChange],
  );

  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }, []);

  const effectiveHeight =
    view === "collapsed"
      ? COLLAPSED_HEIGHT
      : view === "maximized"
        ? "calc(100dvh - 120px)"
        : height;

  const contents: Record<StudioDockTab, ReactNode> = {
    activity: activityContent,
    files: filesContent,
    terminal: terminalContent,
    inspector: inspectorContent,
    media: mediaContent,
  };

  return (
    <div
      data-testid="studio-dock"
      data-open={open ? "true" : "false"}
      className="flex shrink-0 flex-col rounded-none border-t"
      style={{
        backgroundColor: "rgba(16,12,26,0.92)",
        borderColor: "rgba(255,255,255,0.07)",
        height: effectiveHeight,
        transition: view === "collapsed" ? "height 0.15s ease" : undefined,
      }}
      onPointerDown={onHandlePointerDown}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onPointerCancel={onHandlePointerUp}
    >
      {/* Resize handle — only visible when expanded */}
      {view !== "collapsed" && (
        <div
          data-resize-grip="true"
          className="group flex shrink-0 cursor-row-resize items-center justify-center py-0.5 transition hover:bg-white/5"
          style={{ touchAction: "none" }}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize dock"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onHeightChange(clampHeight(height + 32));
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              onHeightChange(clampHeight(height - 32));
            }
          }}
        >
          <div
            data-resize-grip="true"
            className="h-0.5 w-8 rounded-full bg-white/15 transition group-hover:bg-white/30"
          />
        </div>
      )}

      {/* Tab strip header — always visible */}
      <div
        className="flex shrink-0 items-center justify-between"
        style={{ height: COLLAPSED_HEIGHT, backgroundColor: "#0d0916" }}
      >
        {/* Left: tabs — scrolls horizontally on phones so all tabs are
            reachable at 390px; desktop keeps the static strip. */}
        <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden pl-2 sm:overflow-visible" role="tablist" aria-label="Studio dock tabs">
          {DOCK_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-testid={`dock-tab-${t.id}`}
                aria-label={t.label}
                aria-selected={isActive}
                onClick={() => handleTabClick(t.id)}
                className="flex h-full items-center gap-1.5 px-2.5 text-[11px] font-bold transition"
                style={{
                  color: isActive ? CYAN : "var(--text-muted)",
                  borderBottom:
                    isActive && view !== "collapsed"
                      ? `2px solid ${CYAN}`
                      : "2px solid transparent",
                }}
              >
                <Icon size={13} className="pointer-events-none" />
                {t.label}
                {t.id === "activity" && activityPulse && (
                  <span
                    data-testid="dock-activity-pulse"
                    className="h-1.5 w-1.5 animate-pulse rounded-full"
                    style={{ backgroundColor: CYAN }}
                    aria-label="Activity in progress"
                  />
                )}
                {t.id === "terminal" && terminalBadge && (
                  <span
                    data-testid="dock-terminal-badge"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: AMBER }}
                    aria-label="Terminal command failed"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Right: controls — only when expanded */}
        {view !== "collapsed" && (
          <div className="flex h-full shrink-0 items-center gap-1 pr-2">
            <button
              type="button"
              onClick={handleMaximize}
              className="grid h-7 w-7 place-items-center rounded-none transition hover:bg-white/8"
              style={{ color: "var(--text-muted)" }}
              aria-label={view === "maximized" ? "Restore" : "Maximize"}
              title={view === "maximized" ? "Restore (Esc)" : "Maximize"}
            >
              {view === "maximized" ? (
                <Minimize2 size={13} className="pointer-events-none" />
              ) : (
                <Maximize2 size={13} className="pointer-events-none" />
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="grid h-7 w-7 place-items-center rounded-none transition hover:bg-white/8"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close dock"
              title="Close"
              data-testid="dock-close"
            >
              <X size={13} className="pointer-events-none" />
            </button>
          </div>
        )}
      </div>

      {/* Content area — only when expanded; all slots stay mounted */}
      {view !== "collapsed" && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {DOCK_TABS.map((t) => (
            <div
              key={t.id}
              data-testid={`dock-content-${t.id}`}
              className="h-full"
              style={{ display: activeTab === t.id ? undefined : "none" }}
            >
              {contents[t.id] ?? (
                <div
                  className="flex h-full items-center justify-center text-[12px] font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t.id === "terminal"
                    ? "Workspace ready · Terminal session not started"
                    : t.id === "media"
                      ? "Media not loaded"
                      : "No activity yet"}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
