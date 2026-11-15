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
  ListChecks,
  MessageSquare,
  Monitor,
  Palette,
  Rocket,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useBoardLayoutStore } from "../../stores/useBoardLayoutStore";
import BoardPanel from "./BoardPanel";
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
  inspector: SlidersHorizontal,
  deploy: Rocket,
  media: ImageIcon,
  browser: Globe,
  plan: ListChecks,
  canvas: Palette,
  activity: Activity,
  world: Gamepad2,
};

/** The mockup's pill toolbar: exactly these ten toggles, in this order. */
const TOOLBAR_PANELS: BoardPanelId[] = [
  "chat",
  "preview",
  "code",
  "terminal",
  "files",
  "health",
  "inspector",
  "deploy",
  "media",
  "browser",
];

/** Panels that live in the Layout menu rather than the pill itself. */
const MENU_PANELS: BoardPanelId[] = ["plan", "canvas", "activity", "world"];

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
  const ensureScope = useBoardLayoutStore((s) => s.ensureScope);
  const layout = useBoardLayoutStore((s) => s.scopes[scope] ?? null);
  const store = useBoardLayoutStore;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [presetName, setPresetName] = useState("");
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
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

  const onBackgroundPointerDown = (event: ReactPointerEvent) => {
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
  const presetNames = Object.keys(layout.presets).sort();
  const zoomPercent = Math.round((viewport.scale || 1) * 100);
  const menuButton =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-black/5";

  const renderSummonButton = (id: BoardPanelId) => {
    const def = boardDefinition(id);
    const Icon = PANEL_ICONS[id];
    const open = layout.panels[id].open && !layout.panels[id].minimized;
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
        <Icon size={13} aria-hidden />
        {def.title}
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
    >
      {/* World layer — panels live in board coordinates under pan/zoom. */}
      <div
        className="absolute left-0 top-0 h-full w-full"
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {visiblePanels(layout).map((panel) => (
          <BoardPanel
            key={panel.id}
            id={panel.id}
            title={boardDefinition(panel.id).title}
            rect={panel.rect}
            zIndex={panel.z}
            maximized={panel.maximized}
            scale={viewport.scale}
            onRectChange={(id, rect) => store.getState().setPanelRect(scope, id, rect)}
            onBringToFront={(id) => store.getState().bringToFront(scope, id)}
            onMinimize={(id) => store.getState().minimizePanel(scope, id)}
            onToggleMaximize={(id) => store.getState().toggleMaximize(scope, id, visibleArea)}
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
        ))}
      </div>

      {/* ONE compact pill toolbar floating over the board (mockup). */}
      <div
        data-board-chrome
        className="absolute left-1/2 top-3 z-[9999] flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full border px-1.5 py-1 shadow-md"
        style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
      >
        {TOOLBAR_PANELS.map(renderSummonButton)}
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

      {/* Minimize tray: restore returns the panel's exact rect. */}
      {minimized.length > 0 && (
        <div
          data-board-chrome
          data-testid="board-tray"
          className="absolute bottom-3 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2 py-1.5 shadow-md"
          style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
        >
          {minimized.map((panel) => (
            <button
              key={panel.id}
              type="button"
              data-testid={`board-tray-restore-${panel.id}`}
              className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium hover:bg-black/5"
              style={{ borderColor: tokens.border, color: tokens.text }}
              onClick={() => store.getState().restorePanel(scope, panel.id)}
            >
              {boardDefinition(panel.id).title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
