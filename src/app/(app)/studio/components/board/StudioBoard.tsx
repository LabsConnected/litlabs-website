"use client";

/**
 * StudioBoard — the board IS Studio (board-only rebuild, 2026-11-14,
 * BOARD-BLUEPRINT.md).
 *
 * A dotted infinite-feel canvas that fills the whole Studio window,
 * edge to edge: panels keep absolute board positions inside a pan/zoom
 * world layer; the user pans by dragging the background, zooms with
 * Ctrl + mouse wheel (or the toolbar's — % + control), summons panels
 * from the ONE compact pill toolbar floating over the board, tidies,
 * zooms out to the overview, and saves named layout presets.
 *
 * Summoning is a user action only — the board never opens or moves a
 * panel on its own, with one guard: when the window shrinks, panels
 * stranded off-canvas are clamped back within reach (Larry's
 * reachability rule replacing the old right-edge strip defect).
 *
 * Panels render their real systems through `renderPanel`; without it,
 * each panel shows an honest slot stating what binds there. No fake
 * systems are rendered.
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ClipboardCheck,
  Code2,
  FolderOpen,
  Gamepad2,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Rocket,
  Settings as SettingsIcon,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useBoardLayoutStore } from "../../stores/useBoardLayoutStore";
import {
  BOARD_TOOLBAR_PANEL_IDS,
  useBoardSettingsStore,
} from "../../stores/useBoardSettingsStore";
import {
  BOARD_PANEL_STATUS_COLORS,
  useBoardPanelStatusStore,
  type BoardPanelStatus,
} from "../../stores/useBoardPanelStatusStore";
import { useExecutionStore } from "../../stores/useExecutionStore";
import {
  TERMINAL_LOG_KIND_COLORS,
  useTerminalLogStore,
} from "../../stores/useTerminalLogStore";
import BoardPanel from "./BoardPanel";
import BoardSettingsMenu from "./BoardSettingsMenu";
import { visiblePanels } from "./board-layout";
import {
  BOARD_ACCENT_VIOLET,
  BOARD_PANEL_IDS,
  boardDefinition,
  boardScopeKey,
  type BoardPanelId,
  type BoardProjectType,
} from "./board-types";

const PANEL_ICONS: Record<BoardPanelId, LucideIcon> = {
  chat: MessageSquare,
  preview: Monitor,
  code: Code2,
  terminal: SquareTerminal,
  files: FolderOpen,
  health: ClipboardCheck,
  deploy: Rocket,
  media: ImageIcon,
  browser: Globe,
  activity: Activity,
  world: Gamepad2,
};

/**
 * The pill toolbar: exactly these nine toggles, in this order. The
 * Inspector entry is retired (Amendments 2–3, Larry 2026-11-16): its
 * keepers — approvals, changes, plans — live in the chat panel's Jobs
 * tab, so the toolbar no longer summons an Inspector window.
 */
const TOOLBAR_PANELS: BoardPanelId[] = BOARD_TOOLBAR_PANEL_IDS;

/**
 * Panels that live in the Layout menu rather than the pill itself.
 * Plan and Canvas & Design used to sit here — the board's scrollable
 * strip (Amendment 4, Larry 2026-11-16): they move inside the Code
 * box, so they leave this menu. Activity stays (it is its own panel
 * by standing rule) and World stays (Larry has not decided its home
 * yet — do not move or remove it).
 */
const MENU_PANELS: BoardPanelId[] = ["activity", "world"];

export const BOARD_MIN_SCALE = 0.25;
export const BOARD_MAX_SCALE = 2;

/** Ctrl+wheel zoom step: exponential so it feels even at every scale. */
export function zoomScale(current: number, deltaY: number): number {
  const next = current * Math.exp(-deltaY * 0.0015);
  return Math.min(BOARD_MAX_SCALE, Math.max(BOARD_MIN_SCALE, next));
}

export interface StudioBoardProps {
  userId: string;
  projectId: string;
  projectType?: BoardProjectType;
  /** Binding hook: render the real system for a panel. */
  renderPanel?: (id: BoardPanelId) => ReactNode;
}

export default function StudioBoard({
  userId,
  projectId,
  projectType = "website",
  renderPanel,
}: StudioBoardProps) {
  const { tokens } = useTheme();
  const scope = boardScopeKey(userId, projectId);
  // Board settings (Amendment 5): the toolbar shows only the panels
  // Larry left on in Board Settings. Ctrl+scroll and the default zoom
  // are read fresh from the same store where they are used.
  const toolbarPanels = useBoardSettingsStore((s) => s.toolbarPanels);
  const ensureScope = useBoardLayoutStore((s) => s.ensureScope);
  const layout = useBoardLayoutStore((s) => s.scopes[scope] ?? null);
  const store = useBoardLayoutStore;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [presetName, setPresetName] = useState("");
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  // Phone layout (Studio Finish Spec, Larry 2026-11-14): below 768px
  // the board is NOT the desktop board shrunk — panels stack full
  // width in one scroll column and a bottom nav (Chat · Preview ·
  // Files · More) jumps between them. Panels stay mounted, so drafts,
  // scroll and preview state survive switching.
  const [narrow, setNarrow] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  // Board background context menu (Kimi wiring item 10): viewport
  // coordinates of the right-click, or null when closed.
  const [boardMenu, setBoardMenu] = useState<{ x: number; y: number } | null>(null);
  // Phone terminal peek strip (Kimi wiring item 12): the terminal's
  // most recent real log line, from the shared terminal log store.
  const lastTerminalLog = useTerminalLogStore((s) =>
    s.entries.length > 0 ? s.entries[s.entries.length - 1] : null,
  );

  useEffect(() => {
    if (!boardMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBoardMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardMenu]);
  const worldRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOffline(!window.navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  const panSession = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    ensureScope(userId, projectId, projectType);
  }, [ensureScope, userId, projectId, projectType]);

  // The board element only exists once the scope layout does, so the
  // DOM effects below key off its first appearance.
  const hasLayout = layout !== null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width === lastSizeRef.current.width && height === lastSizeRef.current.height) return;
      const shrank =
        lastSizeRef.current.width > 0 &&
        (width < lastSizeRef.current.width || height < lastSizeRef.current.height);
      lastSizeRef.current = { width, height };
      setContainerSize({ width, height });
      // Reachability guard (user rule): when the window shrinks, rescue
      // panels that would strand off-canvas. Growing never moves a panel.
      if (shrank && width > 0 && height > 0) {
        const state = store.getState();
        const current = state.scopes[scope];
        if (current) {
          const scale = current.viewport.scale || 1;
          state.clampPanels(scope, {
            width: Math.round(width / scale),
            height: Math.round(height / scale),
          });
        }
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scope, store, hasLayout]);

  // Ctrl + mouse-wheel zoom (Larry's board rule). Native listener with
  // passive:false — React's wheel handling cannot reliably preventDefault,
  // and the page must not scroll/zoom under the gesture. Trackpad pinch
  // arrives as ctrl+wheel in browsers, so it zooms too.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Board Settings toggle (Amendment 5): with Ctrl+scroll zoom
      // off, the gesture is left alone entirely — no zoom, and the
      // page keeps its normal scroll behavior.
      if (!useBoardSettingsStore.getState().ctrlScrollZoom) return;
      event.preventDefault();
      const state = store.getState();
      const current = state.scopes[scope];
      if (!current) return;
      const rect = el.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const { panX, panY, scale } = current.viewport;
      const nextScale = zoomScale(scale || 1, event.deltaY);
      if (nextScale === scale) return;
      // Keep the board point under the cursor under the cursor.
      const boardX = (cursorX - panX) / (scale || 1);
      const boardY = (cursorY - panY) / (scale || 1);
      state.setViewport(scope, {
        scale: nextScale,
        panX: Math.round(cursorX - boardX * nextScale),
        panY: Math.round(cursorY - boardY * nextScale),
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scope, store, hasLayout]);

  // Default zoom (Board Settings, Amendment 5): a board that still
  // sits at the untouched seed viewport starts at Larry's chosen
  // default zoom. A viewport he has panned or zoomed himself — which
  // is what the persisted layout holds — is never overridden.
  const zoomSeededForScope = useRef<string | null>(null);
  useEffect(() => {
    if (!layout) return;
    if (zoomSeededForScope.current === scope) return;
    zoomSeededForScope.current = scope;
    const percent = useBoardSettingsStore.getState().defaultZoomPercent;
    if (percent === 100) return;
    const v = layout.viewport;
    if (v.panX === 0 && v.panY === 0 && (v.scale || 1) === 1) {
      store.getState().setViewport(scope, { panX: 0, panY: 0, scale: percent / 100 });
    }
  }, [layout, scope, store]);

  // Kimi wiring item 2: panel header statuses. These two store hooks
  // must stay ABOVE the layout early return — hooks cannot appear after
  // a conditional return. The chat status derives from the execution
  // store (the same source the chat panel reads); every other panel
  // publishes its own status into the panel-status store. Nothing is
  // blended into an aggregate.
  const panelStatuses = useBoardPanelStatusStore((s) => s.statuses);
  const chatRunning = useExecutionStore((s) => s.isRunning);

  if (!layout) return null;
  const { viewport } = layout;
  const area = {
    width: Math.max(containerSize.width, 1),
    height: Math.max(containerSize.height, 1),
  };
  // Panel coordinates live in the unscaled board space; maximize fills the
  // visible container, expressed in board coordinates.
  const visibleArea = {
    width: Math.round(area.width / (viewport.scale || 1)),
    height: Math.round(area.height / (viewport.scale || 1)),
  };
  // The visible REGION (origin + size) in board coordinates — what
  // maximize snaps to (spec §4b + mapping §7). The origin is the part
  // the old size-only area missed: under pan, the visible top-left is
  // (-panX/scale, -panY/scale), not (0, 0), so a size-only maximize
  // landed at the board origin, potentially off-screen, with drag
  // disabled while maximized.
  const visibleRegion = {
    x: Math.round(-viewport.panX / (viewport.scale || 1)),
    y: Math.round(-viewport.panY / (viewport.scale || 1)),
    width: visibleArea.width,
    height: visibleArea.height,
  };

  const onBackgroundPointerDown = (event: ReactPointerEvent) => {
    // No pan gesture in the phone stack — the column scrolls instead.
    if (narrow) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-panel-id]") || target.closest("[data-board-chrome]")) return;
    // Pointer capture for the same reason as BoardPanel's drag sessions:
    // a pan that crosses the Preview iframe otherwise stops receiving
    // pointermove in this document and leaks its session on pointerup.
    const captureTarget = event.currentTarget as HTMLElement;
    if (typeof captureTarget.setPointerCapture === "function") {
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        // Non-active pointer / jsdom — window listeners still apply.
      }
    }
    panSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: viewport.panX,
      panY: viewport.panY,
    };
    const onMove = (move: PointerEvent) => {
      const session = panSession.current;
      if (!session || move.pointerId !== session.pointerId) return;
      store.getState().setViewport(scope, {
        ...viewport,
        panX: session.panX + (move.clientX - session.startX),
        panY: session.panY + (move.clientY - session.startY),
      });
    };
    const onEnd = (up: PointerEvent) => {
      if (up.pointerId !== panSession.current?.pointerId) return;
      panSession.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (typeof captureTarget.hasPointerCapture === "function") {
        try {
          if (captureTarget.hasPointerCapture(up.pointerId)) {
            captureTarget.releasePointerCapture(up.pointerId);
          }
        } catch {
          // Capture already gone (browser releases it on pointerup).
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const summon = (id: BoardPanelId) => {
    const panel = layout.panels[id];
    if (!panel.open) store.getState().openPanel(scope, id);
    else if (panel.minimized) store.getState().restorePanel(scope, id);
    else store.getState().bringToFront(scope, id);
  };

  /** Phone bottom-nav jump: summon the panel if needed, then scroll
   *  it into view in the stack. Panels are never unmounted by a jump,
   *  so their internal state (composer draft, preview, scroll inside
   *  the panel) survives. */
  const jumpToPanel = (id: BoardPanelId) => {
    summon(id);
    setMobileSheetOpen(false);
    window.setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-panel-id="${id}"]`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  };

  const setScale = (nextScale: number) => {
    const clamped = Math.min(BOARD_MAX_SCALE, Math.max(BOARD_MIN_SCALE, nextScale));
    // Zoom toward the center of the visible board.
    const centerX = area.width / 2;
    const centerY = area.height / 2;
    const boardX = (centerX - viewport.panX) / (viewport.scale || 1);
    const boardY = (centerY - viewport.panY) / (viewport.scale || 1);
    store.getState().setViewport(scope, {
      scale: clamped,
      panX: Math.round(centerX - boardX * clamped),
      panY: Math.round(centerY - boardY * clamped),
    });
  };

  const minimized = BOARD_PANEL_IDS.map((id) => layout.panels[id]).filter(
    (p) => p.open && p.minimized,
  );
  // Panel header status dots (Kimi wiring item 2): the store hooks
  // live above the layout early return; here we only derive values.
  const chatStatus: BoardPanelStatus | null = chatRunning
    ? { tone: "working", label: "LiTT is working", pulse: true }
    : null;
  const statusForPanel = (id: BoardPanelId): BoardPanelStatus | null =>
    id === "chat" ? chatStatus : panelStatuses[id] ?? null;
  // The frontmost visible panel carries the emphasis ring/shadow.
  const visibleNow = visiblePanels(layout);
  const frontPanelId =
    visibleNow.length > 0
      ? visibleNow.reduce((front, p) => (p.z > front.z ? p : front), visibleNow[0]).id
      : null;
  const presetNames = Object.keys(layout.presets).sort();
  const zoomPercent = Math.round((viewport.scale || 1) * 100);
  const menuButton =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-black/5";

  const renderSummonButton = (id: BoardPanelId) => {
    const def = boardDefinition(id);
    const Icon = PANEL_ICONS[id];
    const open = layout.panels[id].open && !layout.panels[id].minimized;
    // Live indicators (Kimi wiring item 11): the panel's OWN published
    // status as a dot on the toolbar button — visible while the panel
    // is closed or behind others — plus its count badge when it
    // publishes one (failed checks, changed files). A panel that has
    // published nothing shows neither: unknown stays unknown.
    const status = statusForPanel(id);
    return (
      <button
        key={id}
        type="button"
        data-testid={`board-summon-${id}`}
        aria-pressed={open}
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
        style={
          open
            ? { backgroundColor: BOARD_ACCENT_VIOLET, color: "#FFFFFF" }
            : { color: tokens.text }
        }
        onClick={() => summon(id)}
      >
        <span className="relative flex">
          <Icon size={13} aria-hidden />
          {status && !(status.badge && status.badge > 0) && (
            <span
              data-testid={`board-summon-dot-${id}`}
              title={status.label}
              className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${status.pulse ? "animate-pulse" : ""}`}
              style={{ backgroundColor: BOARD_PANEL_STATUS_COLORS[status.tone] }}
            />
          )}
        </span>
        {def.title}
        {status?.badge != null && status.badge > 0 && (
          <span
            data-testid={`board-summon-badge-${id}`}
            title={status.label}
            className="rounded-full px-1.5 py-px text-[9px] font-bold tabular-nums"
            style={
              status.tone === "error"
                ? { backgroundColor: "#EF4444", color: "#FFFFFF" }
                : open
                  ? { backgroundColor: "rgba(255,255,255,0.22)", color: "#FFFFFF" }
                  : { backgroundColor: tokens.surfaceElevated, color: tokens.textMuted }
            }
          >
            {status.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      data-testid="studio-board"
      className="relative h-full w-full overflow-hidden"
      style={{
        backgroundColor: tokens.background,
        color: tokens.text,
        backgroundImage: `radial-gradient(circle, ${tokens.border} 1px, transparent 1px)`,
        backgroundSize: `${24 * viewport.scale}px ${24 * viewport.scale}px`,
        backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
      }}
      onPointerDown={onBackgroundPointerDown}
      onContextMenu={(event) => {
        // Board background menu (Kimi wiring item 10): only the bare
        // board summons it — right-clicks on panels and chrome keep
        // their native behavior. Desktop only; the phone stack has no
        // right-click and its More sheet covers the same ground.
        if (narrow) return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-panel-id]") || target.closest("[data-board-chrome]")) return;
        event.preventDefault();
        setBoardMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {/* World layer — panels live in board coordinates under pan/zoom.
          On the phone the same panels render as one full-width stack
          in a scroll column (no transform, no absolute geometry). */}
      <div
        ref={worldRef}
        className={
          narrow
            ? "absolute inset-0 flex flex-col gap-3 overflow-y-auto p-3 pb-24"
            : "absolute left-0 top-0 h-full w-full"
        }
        style={
          narrow
            ? undefined
            : {
                transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`,
                transformOrigin: "0 0",
              }
        }
      >
        {visiblePanels(layout).map((panel) => {
          const PanelIcon = PANEL_ICONS[panel.id];
          return (
          <BoardPanel
            key={panel.id}
            id={panel.id}
            title={boardDefinition(panel.id).title}
            rect={panel.rect}
            zIndex={panel.z}
            maximized={panel.maximized}
            stacked={narrow}
            icon={<PanelIcon size={13} />}
            status={statusForPanel(panel.id)}
            front={panel.id === frontPanelId}
            scale={viewport.scale}
            onRectChange={(id, rect) => store.getState().setPanelRect(scope, id, rect)}
            onBringToFront={(id) => store.getState().bringToFront(scope, id)}
            onMinimize={(id) => store.getState().minimizePanel(scope, id)}
            onToggleMaximize={(id) => store.getState().toggleMaximize(scope, id, visibleRegion)}
            onClose={(id) => store.getState().closePanel(scope, id)}
          >
            {renderPanel ? (
              renderPanel(panel.id)
            ) : (
              <div
                data-testid={`board-panel-slot-${panel.id}`}
                className="flex h-full items-center justify-center p-4 text-center text-xs"
                style={{ color: tokens.textMuted }}
              >
                {boardDefinition(panel.id).bindingNote}
              </div>
            )}
          </BoardPanel>
          );
        })}
      </div>

      {/* Empty-board state (Kimi wiring item 10): every panel closed
          and nothing minimized to restore. Pointer-events stay off so
          the message never blocks pan or the background menu. */}
      {visibleNow.length === 0 && minimized.length === 0 && (
        <div
          data-board-chrome
          data-testid="board-empty-state"
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
        >
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: tokens.text }}>
              No panels on the board
            </p>
            <p className="mt-1 text-xs" style={{ color: tokens.textMuted }}>
              {narrow
                ? "Open the More menu below to add panels."
                : "Use the toolbar above — or right-click anywhere on the board — to open panels."}
            </p>
          </div>
        </div>
      )}

      {/* ONE compact pill toolbar floating over the board (mockup),
          CENTERED in the board's top bar area — left-1/2 with a -50%
          self-translate, never docked to either edge. Hidden on the
          phone — the bottom nav + More sheet own that job there
          (Finish Spec). */}
      <div
        data-board-chrome
        data-testid="board-toolbar"
        className={`absolute left-1/2 top-3 z-[9999] max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 rounded-full border px-1.5 py-1 shadow-md ${narrow ? "hidden" : "flex"}`}
        style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
      >
        {/* The horizontal scroll region wraps ONLY the summon row.
            It must never contain the Layout or Board Settings menus:
            a scroll container clips its absolutely-positioned
            descendants to its own box, and overflow-x:auto forces
            overflow-y to compute to auto as well — when this pill
            itself carried overflow-x-auto, both menus collapsed into
            it as a ~35px strip showing one row at a time (live
            defect, 2026-11-17). The menus stay direct children of
            the pill, outside any scroll container, so their popovers
            render at content size below the toolbar. min-w-0 lets
            this row actually shrink (and scroll) instead of pushing
            the pill past its max-width. */}
        <div
          data-testid="board-toolbar-scroll"
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
        >
          {TOOLBAR_PANELS.filter((id) => toolbarPanels[id]).map(renderSummonButton)}
        </div>
        <span className="mx-1 h-4 w-px shrink-0" style={{ backgroundColor: tokens.border }} />
        <div className="relative shrink-0">
          <button
            type="button"
            data-testid="board-layout-menu"
            aria-expanded={layoutMenuOpen}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{ color: tokens.text }}
            onClick={() => setLayoutMenuOpen((open) => !open)}
          >
            <LayoutGrid size={13} aria-hidden />
            Layout
          </button>
          {layoutMenuOpen && (
            <div
              data-testid="board-layout-menu-popover"
              className="absolute right-0 top-[calc(100%+8px)] w-52 rounded-xl border p-1.5 shadow-lg"
              style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
            >
              {MENU_PANELS.map((id) => {
                const def = boardDefinition(id);
                const Icon = PANEL_ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    data-testid={`board-summon-${id}`}
                    className={menuButton}
                    style={{ color: tokens.text }}
                    onClick={() => {
                      summon(id);
                      setLayoutMenuOpen(false);
                    }}
                  >
                    <Icon size={13} aria-hidden />
                    {def.title}
                  </button>
                );
              })}
              <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
              <button
                type="button"
                data-testid="board-tidy"
                className={menuButton}
                style={{ color: tokens.text }}
                onClick={() => store.getState().tidy(scope, visibleArea)}
              >
                Tidy
              </button>
              <button
                type="button"
                data-testid="board-overview"
                className={menuButton}
                style={{ color: tokens.text }}
                aria-pressed={layout.overviewReturnViewport !== null}
                onClick={() => store.getState().toggleOverview(scope, area)}
              >
                {layout.overviewReturnViewport ? "Exit overview" : "Overview"}
              </button>
              <button
                type="button"
                data-testid="board-reset"
                className={menuButton}
                style={{ color: tokens.text }}
                onClick={() => store.getState().resetLayout(scope)}
              >
                Reset layout
              </button>
              <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
              <div className="flex items-center gap-1 px-1 py-1">
                <input
                  data-testid="board-preset-name"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name"
                  className="w-full min-w-0 rounded-md border px-1.5 py-1 text-[11px]"
                  style={{ borderColor: tokens.border, backgroundColor: tokens.background, color: tokens.text }}
                />
                <button
                  type="button"
                  data-testid="board-preset-save"
                  className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
                  style={{ borderColor: tokens.border, color: tokens.text }}
                  onClick={() => {
                    if (presetName.trim()) {
                      store.getState().savePreset(scope, presetName);
                      setPresetName("");
                    }
                  }}
                >
                  Save
                </button>
              </div>
              {presetNames.map((name) => (
                <span key={name} className="flex items-center gap-0.5 px-1">
                  <button
                    type="button"
                    data-testid={`board-preset-apply-${name}`}
                    className={menuButton}
                    style={{ color: tokens.text }}
                    onClick={() => store.getState().applyPreset(scope, name)}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    data-testid={`board-preset-delete-${name}`}
                    aria-label={`Delete preset ${name}`}
                    className="rounded-md px-1 text-[11px]"
                    style={{ color: tokens.textMuted }}
                    onClick={() => store.getState().deletePreset(scope, name)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Board Settings (Amendment 5): how the board behaves — open
            size, maximize, placement, layout memory, zoom, and which
            panels this toolbar shows. */}
        <BoardSettingsMenu />
        <span className="mx-1 h-4 w-px shrink-0" style={{ backgroundColor: tokens.border }} />
        {/* Zoom control — "— 100% +" (mockup), plus preset levels. */}
        <div className="flex shrink-0 items-center gap-0.5" data-testid="board-zoom-control">
          <button
            type="button"
            data-testid="board-zoom-out"
            aria-label="Zoom out"
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs"
            style={{ color: tokens.text }}
            onClick={() => setScale((viewport.scale || 1) - 0.1)}
          >
            —
          </button>
          <select
            data-testid="board-zoom-select"
            aria-label="Zoom level"
            className="bg-transparent text-[11px] font-medium"
            style={{ color: tokens.text }}
            value={layout.overviewReturnViewport ? "fit" : String(zoomPercent)}
            onChange={(e) => {
              if (e.target.value === "fit") {
                if (!layout.overviewReturnViewport) store.getState().toggleOverview(scope, area);
              } else {
                if (layout.overviewReturnViewport) store.getState().toggleOverview(scope, area);
                setScale(Number(e.target.value) / 100);
              }
            }}
          >
            <option value="fit">Fit</option>
            {[50, 75, 100, 125, 150, 200].map((pct) => (
              <option key={pct} value={String(pct)}>
                {pct}%
              </option>
            ))}
            {![50, 75, 100, 125, 150, 200].includes(zoomPercent) && (
              <option value={String(zoomPercent)}>{zoomPercent}%</option>
            )}
          </select>
          <span data-testid="board-zoom-label" className="min-w-9 text-center text-[11px] font-medium">
            {zoomPercent}%
          </span>
          <button
            type="button"
            data-testid="board-zoom-in"
            aria-label="Zoom in"
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs"
            style={{ color: tokens.text }}
            onClick={() => setScale((viewport.scale || 1) + 0.1)}
          >
            +
          </button>
        </div>
      </div>

      {/* Offline state (Finish Spec): honest, specific, and it does
          not block the board — layouts persist on this device. */}
      {offline && (
        <div
          data-board-chrome
          data-testid="board-offline-banner"
          role="status"
          className="absolute left-1/2 top-3 z-[9999] w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-full border px-3.5 py-2 text-center text-[11px] font-semibold shadow-md"
          style={{ backgroundColor: tokens.surfaceElevated, borderColor: tokens.border, color: tokens.text }}
        >
          You are offline — the board still works and saves on this device; LiTT needs a connection to build.
        </div>
      )}

      {/* Minimize tray: restore returns the panel's exact rect. */}
      {minimized.length > 0 && (
        <div
          data-board-chrome
          data-testid="board-tray"
          className={`absolute left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2 py-1.5 shadow-md ${narrow ? "bottom-24" : "bottom-3"}`}
          style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
        >
          {minimized.map((panel) => (
            <button
              key={panel.id}
              type="button"
              data-testid={`board-tray-restore-${panel.id}`}
              className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium hover:bg-black/5 max-md:min-h-[44px] max-md:px-3.5"
              style={{ borderColor: tokens.border, color: tokens.text }}
              onClick={() => store.getState().restorePanel(scope, panel.id)}
            >
              {boardDefinition(panel.id).title}
            </button>
          ))}
        </div>
      )}

      {/* Board background context menu (Kimi wiring item 10): summon
          any closed/minimized panel, or reset the layout. Rendered at
          the right-click point, clamped inside the viewport; the
          transparent backdrop closes it on any outside press. */}
      {boardMenu && !narrow && (
        <>
          <div
            data-board-chrome
            className="fixed inset-0 z-[9998]"
            onPointerDown={() => setBoardMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setBoardMenu(null);
            }}
          />
          <div
            data-board-chrome
            data-testid="board-context-menu"
            role="menu"
            aria-label="Board menu"
            className="fixed z-[9999] w-52 overflow-hidden rounded-xl border py-1 shadow-xl"
            style={{
              left: Math.max(4, Math.min(boardMenu.x, (typeof window !== "undefined" ? window.innerWidth : 320) - 216)),
              top: Math.max(4, Math.min(boardMenu.y, (typeof window !== "undefined" ? window.innerHeight : 480) - 360)),
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
            }}
          >
            <div
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider"
              style={{ color: tokens.textMuted }}
            >
              Open panel
            </div>
            {BOARD_PANEL_IDS.filter((id) => !layout.panels[id].open || layout.panels[id].minimized).map(
              (id) => {
                const def = boardDefinition(id);
                const Icon = PANEL_ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    data-testid={`board-context-open-${id}`}
                    className={menuButton}
                    style={{ color: tokens.text }}
                    onClick={() => {
                      summon(id);
                      setBoardMenu(null);
                    }}
                  >
                    <Icon size={13} aria-hidden />
                    {def.title}
                  </button>
                );
              },
            )}
            {BOARD_PANEL_IDS.every((id) => layout.panels[id].open && !layout.panels[id].minimized) && (
              <p className="px-3 py-1.5 text-[11px]" style={{ color: tokens.textMuted }}>
                All panels are open.
              </p>
            )}
            <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
            <button
              type="button"
              role="menuitem"
              data-testid="board-context-reset"
              className={menuButton}
              style={{ color: tokens.text }}
              onClick={() => {
                store.getState().resetLayout(scope);
                setBoardMenu(null);
              }}
            >
              Reset layout
            </button>
          </div>
        </>
      )}

      {/* Phone bottom navigation — Chat · Preview · Files · More
          (Finish Spec). Targets are 56px tall, the bar respects the
          bottom safe area, and the More sheet carries every remaining
          panel plus Settings (its phone home). */}
      {narrow && (
        <>
          {mobileSheetOpen && (
            <div
              data-board-chrome
              data-testid="board-mobile-more-sheet"
              className="absolute inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[9999] rounded-2xl border p-2 shadow-xl"
              style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
            >
              <div className="grid grid-cols-2 gap-1">
                {BOARD_PANEL_IDS.map((id) => {
                  const def = boardDefinition(id);
                  const Icon = PANEL_ICONS[id];
                  const open = layout.panels[id].open && !layout.panels[id].minimized;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={`board-mobile-more-${id}`}
                      aria-pressed={open}
                      className="flex items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold"
                      style={
                        open
                          ? { backgroundColor: BOARD_ACCENT_VIOLET, color: "#FFFFFF", minHeight: 48 }
                          : { color: tokens.text, minHeight: 48 }
                      }
                      onClick={() => jumpToPanel(id)}
                    >
                      <Icon size={15} aria-hidden />
                      {def.title}
                    </button>
                  );
                })}
              </div>
              <div className="my-1.5 h-px" style={{ backgroundColor: tokens.border }} />
              <a
                href="/settings"
                data-testid="board-mobile-more-settings"
                className="flex items-center gap-2 rounded-xl px-3 text-xs font-semibold"
                style={{ color: tokens.text, minHeight: 48 }}
              >
                <SettingsIcon size={15} aria-hidden />
                Settings
              </a>
            </div>
          )}
          {/* Terminal peek strip (Kimi wiring item 12): while the
              terminal panel is open in the phone stack, its latest
              real log line stays visible above the nav — colored by
              kind — and tapping it jumps to the terminal. It renders
              only when the terminal has actually emitted a line. */}
          {layout.panels.terminal.open && lastTerminalLog && !mobileSheetOpen && (
            <button
              type="button"
              data-board-chrome
              data-testid="board-terminal-peek"
              className="absolute inset-x-0 z-[9998] flex items-center gap-2 border-t px-3 py-1.5 text-left"
              style={{
                bottom: "calc(56px + env(safe-area-inset-bottom))",
                backgroundColor: tokens.surfaceElevated,
                borderColor: tokens.border,
              }}
              onClick={() => jumpToPanel("terminal")}
            >
              <SquareTerminal
                size={12}
                className="shrink-0"
                style={{ color: TERMINAL_LOG_KIND_COLORS[lastTerminalLog.kind] }}
                aria-hidden
              />
              <span
                className="min-w-0 flex-1 truncate font-mono text-[10px]"
                style={{ color: TERMINAL_LOG_KIND_COLORS[lastTerminalLog.kind] }}
              >
                {lastTerminalLog.text}
              </span>
              <span className="shrink-0 text-[9px] tabular-nums" style={{ color: tokens.textMuted }}>
                {lastTerminalLog.time}
              </span>
            </button>
          )}
          <nav
            data-board-chrome
            data-testid="board-mobile-nav"
            aria-label="LiTT Studio panels"
            className="absolute inset-x-0 bottom-0 z-[9999] flex items-stretch border-t"
            style={{
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {(
              [
                ["chat", "Chat", MessageSquare],
                ["preview", "Static View", Monitor],
                ["files", "Files", FolderOpen],
              ] as [BoardPanelId, string, LucideIcon][]
            ).map(([id, label, Icon]) => {
              // Phone live indicators (Kimi wiring item 11): the same
              // per-panel published statuses as the desktop toolbar —
              // a dot (chat running, preview working), or the count
              // badge when the panel publishes one (files changed).
              const status = statusForPanel(id);
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`board-mobile-nav-${id}`}
                  className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold"
                  style={{ color: tokens.text, minHeight: 56 }}
                  onClick={() => jumpToPanel(id)}
                >
                  <span className="relative flex">
                    <Icon size={20} aria-hidden />
                    {status && status.badge != null && status.badge > 0 ? (
                      <span
                        data-testid={`board-mobile-nav-badge-${id}`}
                        title={status.label}
                        className="absolute -right-2.5 -top-1.5 rounded-full px-1 text-[8px] font-bold tabular-nums"
                        style={
                          status.tone === "error"
                            ? { backgroundColor: "#EF4444", color: "#FFFFFF" }
                            : { backgroundColor: tokens.surfaceElevated, color: tokens.textMuted }
                        }
                      >
                        {status.badge}
                      </span>
                    ) : status ? (
                      <span
                        data-testid={`board-mobile-nav-dot-${id}`}
                        title={status.label}
                        className={`absolute -right-1.5 -top-1 h-2 w-2 rounded-full ${status.pulse ? "animate-pulse" : ""}`}
                        style={{ backgroundColor: BOARD_PANEL_STATUS_COLORS[status.tone] }}
                      />
                    ) : null}
                  </span>
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              data-testid="board-mobile-nav-more"
              aria-expanded={mobileSheetOpen}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold"
              style={{ color: mobileSheetOpen ? BOARD_ACCENT_VIOLET : tokens.text, minHeight: 56 }}
              onClick={() => setMobileSheetOpen((open) => !open)}
            >
              <span className="relative flex">
                <MoreHorizontal size={20} aria-hidden />
                {/* More carries an error dot when ANY panel has
                    published an error (item 11) — the panels behind
                    the sheet should not fail silently. */}
                {!mobileSheetOpen &&
                  Object.values(panelStatuses).some((s) => s?.tone === "error") && (
                    <span
                      data-testid="board-mobile-nav-more-error-dot"
                      className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full"
                      style={{ backgroundColor: "#EF4444" }}
                    />
                  )}
              </span>
              More
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
