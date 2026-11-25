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
 * syncs it with the `open` prop. All tab content slots stay mounted
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
  Folder,
  Globe,
  ListChecks,
  Maximize2,
  Minimize2,
  PanelBottom,
  ScanSearch,
  ShieldCheck,
  SquareTerminal,
  X,
} from "lucide-react";
import { useStudioContextOptional } from "../context/StudioContext";
import { SelectionInspectorPanel } from "./StudioInspector";

// Files is NOT a dock tab (Larry, 2026-11-13, reaffirmed by the
// production-hardening test): project files live in the LiTT panel's
// top-row Files tab (desktop + mobile sheet) and, in Regular, in the
// Code box's Files view. Checks and Approvals are not dock tabs
// either — their one home is the Code box's Run section. Rail
// consolidation (Larry, 2026-11-25) keeps them REACHABLE from the
// classic desktop dock through launcher entries: plain buttons in the
// dock strip (not tabs, no dock panes) that fire parent callbacks
// opening the real homes in the Code box — the dock never mounts a
// second copy of any of these surfaces. The shell and mobile mounts
// pass no launcher callbacks, so their docks are unchanged.
export type StudioDockTab =
  | "activity"
  | "terminal"
  | "inspector"
  | "media"
  | "browser";

export interface StudioDockProps {
  open: boolean;
  activeTab: StudioDockTab;
  onTabChange: (t: StudioDockTab) => void;
  onClose: () => void;
  onToggle: () => void;
  /** Controlled height in px (default 320) */
  height?: number;
  /** Fill the parent box instead of sizing to `height` — used by the
      mobile full-screen tool surface (2026-11-19 layout card). */
  fill?: boolean;
  onHeightChange: (h: number) => void;
  activityContent: ReactNode;
  /** Launcher entries (rail consolidation): when a callback is
      provided, the dock strip offers a button that asks the parent to
      open that surface in its real home (the Code box). These are NOT
      dock tabs — the dock renders no pane for them. */
  onOpenFiles?: () => void;
  onOpenChecks?: () => void;
  onOpenApprovals?: () => void;
  /** Keep mounted always (PTY stays alive) — rendered with display:none when inactive */
  terminalContent: ReactNode;
  inspectorContent: ReactNode;
  mediaContent: ReactNode;
  /** The embedded web browser (Regular layout's Browser home; in the
      shell this slot carries a jump panel to the board Browser panel,
      so the browser itself still exists exactly once). When
      `onBrowserLaunch` is set, this slot is not rendered at all —
      the Browser tab becomes a launcher for the side dock. */
  browserContent: ReactNode;
  /** Rail consolidation (Regular): when provided, the Browser tab is
      a launcher — clicking it opens the Browser side dock instead of
      selecting a bottom-dock pane. */
  onBrowserLaunch?: () => void;
  /** Highlights the Browser launcher tab while the side dock is open. */
  browserActive?: boolean;
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

const ACCENT = "var(--color-accent)";
const AMBER = "#e3b341";

type DockView = "collapsed" | "normal" | "maximized";

const DOCK_TABS: {
  id: StudioDockTab;
  label: string;
  icon: typeof Activity;
}[] = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "inspector", label: "Inspector", icon: ScanSearch },
  { id: "media", label: "Media", icon: Clapperboard },
  { id: "browser", label: "Browser", icon: Globe },
];

// Launcher entries for surfaces whose home is the Code box (Files
// view; Run section's Checks / Approvals). Rendered as plain buttons
// in the dock strip when the parent passes the matching callback —
// never as tabs, and the dock never renders their content.
const DOCK_LAUNCHERS: {
  target: "files" | "checks" | "approvals";
  label: string;
  icon: typeof Activity;
  callback: "onOpenFiles" | "onOpenChecks" | "onOpenApprovals";
}[] = [
  { target: "files", label: "Files", icon: Folder, callback: "onOpenFiles" },
  { target: "checks", label: "Checks", icon: ListChecks, callback: "onOpenChecks" },
  { target: "approvals", label: "Approvals", icon: ShieldCheck, callback: "onOpenApprovals" },
];

export default function StudioDock({
  open,
  activeTab,
  onTabChange,
  onClose,
  onToggle,
  height = DOCK_DEFAULT,
  fill = false,
  onHeightChange,
  activityContent,
  onOpenFiles,
  onOpenChecks,
  onOpenApprovals,
  terminalContent,
  inspectorContent,
  mediaContent,
  browserContent,
  onBrowserLaunch,
  browserActive = false,
  activityPulse = false,
  terminalBadge = false,
}: StudioDockProps) {
  // F1 slice C — the inspector tab is contextual on the active Studio
  // selection. Optional hook: the dock also renders in tests without a
  // provider, where the selection is simply absent.
  const studioSelection = useStudioContextOptional();
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
      // Browser launcher mode: the tab opens the side dock; it never
      // becomes the dock's active pane and never expands the dock.
      if (t === "browser" && onBrowserLaunch) {
        onBrowserLaunch();
        return;
      }
      onTabChange(t);
      if (view === "collapsed") {
        setView("normal");
        onToggle();
      }
    },
    [view, onTabChange, onToggle, onBrowserLaunch],
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
      : fill
        ? "100%"
        : view === "maximized"
          ? "calc(100dvh - 120px)"
          : height;

  // In Browser launcher mode the browser pane is not part of the dock
  // at all; every dock tab is a real dock pane.
  const visibleTabs = DOCK_TABS;
  const paneTabs = visibleTabs.filter(
    (t) => !(t.id === "browser" && onBrowserLaunch),
  );
  // Launcher entries the parent wired up (classic desktop Regular):
  // Files / Checks / Approvals stay reachable from the dock strip
  // without becoming dock tabs — clicking one asks the parent to open
  // the surface in its Code-box home.
  const launcherCallbacks: Record<string, (() => void) | undefined> = {
    onOpenFiles,
    onOpenChecks,
    onOpenApprovals,
  };
  const visibleLaunchers = DOCK_LAUNCHERS.filter(
    (l) => launcherCallbacks[l.callback] !== undefined,
  );
  // If the controlled active tab names a pane that does not exist in
  // this mount (e.g. "browser" in launcher mode), fall back to the
  // first real pane so the content area is never blank.
  const effectiveActiveTab = paneTabs.some((t) => t.id === activeTab)
    ? activeTab
    : (paneTabs[0]?.id ?? activeTab);

  const contents: Record<StudioDockTab, ReactNode> = {
    activity: activityContent,
    terminal: terminalContent,
    // F1 slice C — the Inspector tab is contextual: the active Studio
    // selection (from StudioContext, any surface) renders above the
    // parent-provided inspector content, with provenance, Ask LiTT /
    // Reveal in Code actions, and a clear affordance. With no selection
    // the panel shows an honest empty state — never fake content.
    // useStudioContextOptional keeps the dock renderable outside a
    // provider (tests, standalone mounts).
    inspector: (
      <div className="flex h-full min-h-0 flex-col">
        <SelectionInspectorPanel
          selection={studioSelection?.selection ?? null}
          projectId={studioSelection?.projectId ?? null}
          onClear={
            studioSelection ? () => studioSelection.setSelection(null) : undefined
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">{inspectorContent}</div>
      </div>
    ),
    media: mediaContent,
    browser: browserContent,
  };

  return (
    <div
      data-testid="studio-dock"
      data-open={open ? "true" : "false"}
      className="flex shrink-0 flex-col rounded-none border-t"
      style={{
        backgroundColor: "var(--studio-surface)",
        borderColor: "var(--studio-border)",
        height: effectiveHeight,
        transition: view === "collapsed" ? "height 0.15s ease" : undefined,
      }}
      onPointerDown={onHandlePointerDown}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onPointerCancel={onHandlePointerUp}
    >
      {/* Resize handle — only visible when expanded and not fill-mode
          (the mobile full-screen surface has nothing to resize). */}
      {!fill && view !== "collapsed" && (
        <div
          data-resize-grip="true"
          className="group flex shrink-0 cursor-row-resize items-center justify-center py-0.5 transition hover:bg-black/5"
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
            className="h-0.5 w-8 rounded-full bg-black/15 transition group-hover:bg-black/30"
          />
        </div>
      )}

      {/* Collapsed state is intentionally one quiet entry point. The
          contextual tabs appear only after the developer drawer opens. */}
      <div
        className="flex shrink-0 items-center justify-between"
        style={{ height: COLLAPSED_HEIGHT, backgroundColor: "var(--studio-surface)" }}
      >
        {view === "collapsed" ? (
          <button
            type="button"
            onClick={() => { setView("normal"); onToggle(); }}
            className="flex h-full items-center gap-2 px-3 text-[11px] font-bold transition hover:bg-black/5"
            style={{ color: "var(--text-muted)" }}
            aria-label="Open developer tools"
            data-testid="dock-collapsed-toggle"
          >
            <PanelBottom size={13} className="pointer-events-none" style={{ color: ACCENT }} />
            Developer tools
            {activityPulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: ACCENT }} aria-label="Activity in progress" />}
            {terminalBadge && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: AMBER }} aria-label="Terminal command failed" />}
          </button>
        ) : (
          <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden pl-2 sm:overflow-visible" role="tablist" aria-label="Studio dock tabs">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const isActive =
                t.id === "browser" && onBrowserLaunch
                  ? browserActive
                  : effectiveActiveTab === t.id;
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
                    color: isActive ? ACCENT : "var(--text-muted)",
                    borderBottom: isActive ? `2px solid ${ACCENT}` : "2px solid transparent",
                  }}
                >
                  <Icon size={13} className="pointer-events-none" />
                  {t.label}
                  {t.id === "activity" && activityPulse && <span data-testid="dock-activity-pulse" className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: ACCENT }} aria-label="Activity in progress" />}
                  {t.id === "terminal" && terminalBadge && <span data-testid="dock-terminal-badge" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: AMBER }} aria-label="Terminal command failed" />}
                </button>
              );
            })}
            {/* Launcher entries — NOT tabs: they open Files / Checks /
                Approvals in their Code-box home via the parent's
                callbacks and never select a dock pane. */}
            {visibleLaunchers.map((l) => {
              const Icon = l.icon;
              return (
                <button
                  key={l.target}
                  type="button"
                  data-testid={`dock-open-${l.target}`}
                  aria-label={`Open ${l.label} in Code`}
                  onClick={() => launcherCallbacks[l.callback]?.()}
                  className="flex h-full items-center gap-1.5 px-2.5 text-[11px] font-bold transition hover:bg-black/5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Icon size={13} className="pointer-events-none" />
                  {l.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Right: controls — only when expanded */}
        {view !== "collapsed" && (
          <div className="flex h-full shrink-0 items-center gap-1 pr-2">
            <button
              type="button"
              onClick={handleMaximize}
              className="grid h-7 w-7 place-items-center rounded-lg transition hover:bg-black/5"
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
              className="grid h-7 w-7 place-items-center rounded-lg transition hover:bg-black/5"
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
          {paneTabs.map((t) => (
            <div
              key={t.id}
              data-testid={`dock-content-${t.id}`}
              className="h-full"
              style={{ display: effectiveActiveTab === t.id ? undefined : "none" }}
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
                      : t.id === "browser"
                        ? "Browser not loaded"
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
