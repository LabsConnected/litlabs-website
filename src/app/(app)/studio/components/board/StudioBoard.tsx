"use client";

/**
 * StudioBoard — the board surface for the right side of Studio (plan §2 B2).
 *
 * A dotted infinite-feel canvas: panels keep absolute board positions
 * inside a pan/zoom world layer; the user pans by dragging the
 * background, summons panels from the toolbar (user action only — the
 * board never opens or moves a panel on its own), tidies, zooms out to
 * the overview, and saves named layout presets.
 *
 * B2 scope: the surface + chrome. Real panel bindings land in B3 — until
 * a caller passes `renderPanel`, each panel shows an honest slot stating
 * what will bind there. No fake systems are rendered.
 *
 * Rendering this component at all is the toggle: CommandStudio mounts it
 * only when the per-user board toggle is ON (default OFF), so the fixed
 * stage layout is untouched while the board is off.
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTheme } from "@/context/ThemeContext";
import { useBoardLayoutStore } from "../../stores/useBoardLayoutStore";
import BoardPanel from "./BoardPanel";
import { visiblePanels } from "./board-layout";
import {
  BOARD_PANEL_IDS,
  BOARD_PANEL_INVENTORY,
  boardDefinition,
  boardScopeKey,
  type BoardPanelId,
  type BoardProjectType,
} from "./board-types";

export interface StudioBoardProps {
  userId: string;
  projectId: string;
  projectType?: BoardProjectType;
  /** B3 binding hook: render the real system for a panel. */
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
  const panSession = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    ensureScope(userId, projectId, projectType);
  }, [ensureScope, userId, projectId, projectType]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const minimized = BOARD_PANEL_IDS.map((id) => layout.panels[id]).filter(
    (p) => p.open && p.minimized,
  );
  const presetNames = Object.keys(layout.presets).sort();
  const toolbarButton =
    "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-black/5";

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

      {/* Toolbar — summoning is a user action; nothing here auto-fires. */}
      <div
        data-board-chrome
        className="absolute left-3 top-3 z-[9999] flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1.5 rounded-xl border px-2 py-1.5 shadow-md"
        style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
      >
        {BOARD_PANEL_INVENTORY.map((def) => (
          <button
            key={def.id}
            type="button"
            data-testid={`board-summon-${def.id}`}
            className={toolbarButton}
            style={{
              borderColor: tokens.border,
              backgroundColor: layout.panels[def.id].open ? tokens.surfaceElevated : undefined,
            }}
            onClick={() => summon(def.id)}
          >
            {def.title}
          </button>
        ))}
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: tokens.border }} />
        <button
          type="button"
          data-testid="board-tidy"
          className={toolbarButton}
          style={{ borderColor: tokens.border }}
          onClick={() => store.getState().tidy(scope, visibleArea)}
        >
          Tidy
        </button>
        <button
          type="button"
          data-testid="board-overview"
          className={toolbarButton}
          style={{ borderColor: tokens.border }}
          aria-pressed={layout.overviewReturnViewport !== null}
          onClick={() => store.getState().toggleOverview(scope, area)}
        >
          {layout.overviewReturnViewport ? "Exit overview" : "Overview"}
        </button>
        <button
          type="button"
          data-testid="board-reset"
          className={toolbarButton}
          style={{ borderColor: tokens.border }}
          onClick={() => store.getState().resetLayout(scope)}
        >
          Reset layout
        </button>
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: tokens.border }} />
        <input
          data-testid="board-preset-name"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          placeholder="Preset name"
          className="w-24 rounded-md border px-1.5 py-1 text-[11px]"
          style={{ borderColor: tokens.border, backgroundColor: tokens.background }}
        />
        <button
          type="button"
          data-testid="board-preset-save"
          className={toolbarButton}
          style={{ borderColor: tokens.border }}
          onClick={() => {
            if (presetName.trim()) {
              store.getState().savePreset(scope, presetName);
              setPresetName("");
            }
          }}
        >
          Save preset
        </button>
        {presetNames.map((name) => (
          <span key={name} className="flex items-center gap-0.5">
            <button
              type="button"
              data-testid={`board-preset-apply-${name}`}
              className={toolbarButton}
              style={{ borderColor: tokens.border }}
              onClick={() => store.getState().applyPreset(scope, name)}
            >
              {name}
            </button>
            <button
              type="button"
              data-testid={`board-preset-delete-${name}`}
              aria-label={`Delete preset ${name}`}
              className="rounded-md px-1 text-[11px]"
              onClick={() => store.getState().deletePreset(scope, name)}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Minimize tray (B4 home): restore returns the panel's exact rect. */}
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
              style={{ borderColor: tokens.border }}
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
