"use client";

/**
 * BoardSettingsMenu — the Board Settings menu (spec Amendment 5,
 * Larry 2026-11-16): one place in the Studio board chrome where Larry
 * sets how the board behaves — panel open size, maximize behavior,
 * where new panels land, layout memory, default zoom + Ctrl+scroll,
 * and which panels the pill toolbar shows.
 *
 * Backed by useBoardSettingsStore (zustand + persist). The toolbar
 * visibility, Ctrl+scroll and default-zoom settings take effect in
 * StudioBoard immediately; the open-behavior settings are consumed by
 * the board layout store through the store's plain getter
 * (getBoardOpenBehavior) at integration time.
 *
 * Placement + sizing (Larry, 2026-11-17): this menu and its trigger
 * stay IN THE BOARD — the trigger lives in StudioBoard's pill toolbar,
 * not up in the site header by the project name (an earlier placement
 * he reversed). The surface is sized to its content: 360px wide
 * (clamped to the viewport on small windows, the same
 * w-[min(360px,calc(100vw-24px))] pattern as StudioShell's floating
 * inspector). overflow-y-auto remains ONLY as the fallback for
 * viewports too short to fit the content — it must not go back to a
 * small fixed cap (the old w-64 / max-h-[70vh] box forced scrolling
 * to find anything).
 *
 * Viewport fit (mockup port fix, 2026-11-18): the height cap used to
 * be a static calc(100vh - 96px), which assumed the trigger sits
 * within the top 96px of the viewport. The pill toolbar sits lower
 * than that, so the menu's bottom ran past the viewport edge and its
 * last rows (the Browser toolbar checkbox, Reset) were cut off with
 * no way to reach them — the board itself never scrolls. On open the
 * menu now measures its trigger: it takes exactly the space below
 * the trigger (12px viewport margin), and flips to open ABOVE the
 * trigger when the space below is tight and above is roomier. The
 * static class cap stays as the pre-measure fallback only.
 *
 * Viewport fit hardening (follow-up, 2026-11-18): the one-shot
 * trigger measurement still failed the live proof — the menu opened
 * past the bottom edge of a 1919x998 viewport with Deploy cut off
 * and Media / Browser / Reset unreachable. Three defects compounded:
 * (1) the flip test used a fixed 360px "tight" guess while this
 * menu's real content is ~950px tall, so "space below is
 * insufficient" was judged against the wrong number; (2) the fit was
 * computed once, at open, from the trigger's rect — never from the
 * menu's own rendered box, and never re-checked while the board's
 * layout settled around the toolbar, so a stale or pre-settle
 * measurement silently left a cap that overflowed; (3) the static
 * fallback cap (100vh - 96px) ignores the trigger's real anchor
 * position below the stacked app + Studio headers. The fit now
 * decides flipping from the menu's ACTUAL content height
 * (scrollHeight), caps the height to the space measured from the
 * menu's own rendered top (or bottom, when flipped) to the viewport
 * edge, and keeps re-fitting while the menu is open (a correction
 * pass after the fitted render, a ResizeObserver on the menu, and
 * the window resize listener) — the painted menu cannot extend past
 * the viewport edge, whatever the anchor measurement assumed.
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  BOARD_LAYOUT_MEMORY_OPTIONS,
  BOARD_NEW_PANEL_PLACEMENT_OPTIONS,
  BOARD_OPEN_SIZE_OPTIONS,
  BOARD_TOOLBAR_PANEL_IDS,
  BOARD_ZOOM_LEVELS,
  STUDIO_LAYOUT_MODE_OPTIONS,
  useBoardSettingsStore,
} from "../../stores/useBoardSettingsStore";
import { useStudioLayoutMode } from "../../stores/useStudioLayoutMode";
import { BOARD_ACCENT_VIOLET, boardDefinition } from "./board-types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <fieldset className="px-1 py-1.5">
      <legend
        className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: tokens.textMuted }}
      >
        {title}
      </legend>
      <div className="flex flex-col">{children}</div>
    </fieldset>
  );
}

function ChoiceRow({
  testId,
  label,
  checked,
  onChange,
  kind,
  name,
}: {
  testId: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  kind: "radio" | "checkbox";
  name?: string;
}) {
  const { tokens } = useTheme();
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[11px] font-medium hover:bg-black/5"
      style={{ color: tokens.text }}
    >
      <input
        type={kind}
        name={name}
        data-testid={testId}
        checked={checked}
        onChange={onChange}
        style={{ accentColor: BOARD_ACCENT_VIOLET }}
      />
      {label}
    </label>
  );
}

export default function BoardSettingsMenu() {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const settings = useBoardSettingsStore();
  const { layoutMode, setLayoutMode } = useStudioLayoutMode();
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Measured viewport fit for the open menu (see the header note):
  // maxHeight is the exact space in the chosen direction; flipped
  // renders the menu above its trigger instead of below it.
  const [menuFit, setMenuFit] = useState<{ maxHeight: number; flipped: boolean } | null>(null);

  // Compute the fit from BOTH rects: the trigger's (where the menu
  // anchors) and the menu's own rendered box (where it actually
  // paints). The anchor math proposes; the rendered box disposes —
  // the final cap never lets the painted menu cross the viewport
  // edge. Idempotent: re-running it on an already-correct fit is a
  // no-op, so the correction passes below settle instead of looping.
  const fitMenu = useCallback(() => {
    const wrap = wrapRef.current;
    const menu = menuRef.current;
    if (!wrap || !menu) return;
    const rect = wrap.getBoundingClientRect();
    const gap = 8; // the menu's 8px offset from the trigger
    const margin = 12; // breathing room at the viewport edge
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    // "Insufficient space below" is judged against the menu's real
    // content height (~950px of sections), not a fixed guess. When
    // the content height cannot be measured (0), fall back to the
    // original fixed threshold.
    const natural = menu.scrollHeight;
    const insufficient = natural > 0 ? natural > below : below < 360;
    const flipped = insufficient && above > below;
    const space = flipped ? above : below;
    let maxHeight = Math.max(200, Math.floor(space));
    // Rendered-box correction: cap to the space from the menu's own
    // rendered top (below placement — the top is the anchored edge)
    // or rendered bottom (flipped — the bottom is the anchored edge)
    // to the viewport's far edge. Skipped when the menu has no
    // measurable box yet (e.g. jsdom), where the anchor math rules.
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.height > 0) {
      const allowance = flipped
        ? menuRect.bottom - margin
        : window.innerHeight - margin - menuRect.top;
      if (allowance > 0) {
        maxHeight = Math.min(maxHeight, Math.floor(allowance));
      }
    }
    const next = { flipped, maxHeight };
    setMenuFit((prev) =>
      prev && prev.flipped === next.flipped && prev.maxHeight === next.maxHeight ? prev : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    fitMenu();
    window.addEventListener("resize", fitMenu);
    // The menu's content can change height while open (and the board
    // can settle around the toolbar after the first paint) — keep
    // the fit honest for as long as the menu is open.
    const observer =
      typeof ResizeObserver !== "undefined" && menuRef.current
        ? new ResizeObserver(fitMenu)
        : null;
    if (observer && menuRef.current) observer.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", fitMenu);
      observer?.disconnect();
    };
  }, [open, fitMenu ]);

  // Correction pass: once the fitted render has laid out, measure
  // again — if the first pass worked from a pre-settle anchor, this
  // is where the rendered box pulls the cap back inside the viewport.
  useLayoutEffect(() => {
    if (!open || !menuFit) return;
    fitMenu();
  }, [open, menuFit, fitMenu ]);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      {/* pointer-events-auto on the trigger and the menu: this
          component renders inside StudioBoard's pill toolbar, whose
          container is pointer-events-none (click-through, so panel
          drags at the top of the board are not swallowed) — controls
          opt back in individually. */}
      <button
        type="button"
        data-testid="board-settings-button"
        aria-expanded={open}
        className="pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
        style={{ color: tokens.text }}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={13} aria-hidden />
        Board settings
      </button>
      {open && (
        <div
          ref={menuRef}
          data-testid="board-settings-menu"
          data-placement={menuFit?.flipped ? "above" : "below"}
          className={`pointer-events-auto absolute right-0 ${menuFit?.flipped ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"} max-h-[calc(100vh-96px)] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-xl border p-1.5 shadow-lg`}
          style={{
            backgroundColor: tokens.surface,
            borderColor: tokens.border,
            ...(menuFit ? { maxHeight: menuFit.maxHeight } : {}),
          }}
        >
          <Section title="Studio layout">
            {STUDIO_LAYOUT_MODE_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                kind="radio"
                name="studio-layout-mode"
                testId={`board-settings-layout-${option.value}`}
                label={option.value === "board" ? "Board" : "Regular (classic)"}
                checked={layoutMode === option.value}
                onChange={() => setLayoutMode(option.value)}
              />
            ))}
            <p
              className="px-1 py-1 text-[11px] leading-snug"
              style={{ color: tokens.textMuted }}
            >
              The same switch lives in the Studio header, so you can flip back from either
              layout.
            </p>
          </Section>
          <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
          <Section title="Panel open size">
            {BOARD_OPEN_SIZE_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                kind="radio"
                name="board-open-size"
                testId={`board-settings-open-size-${option.value}`}
                label={option.label}
                checked={settings.openSize === option.value}
                onChange={() => settings.setOpenSize(option.value)}
              />
            ))}
          </Section>
          <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
          <Section title="Maximize">
            <ChoiceRow
              kind="checkbox"
              testId="board-settings-maximize-snap"
              label="Snap full when maximizing"
              checked={settings.maximizeSnapFull}
              onChange={() => settings.setMaximizeSnapFull(!settings.maximizeSnapFull)}
            />
            <ChoiceRow
              kind="checkbox"
              testId="board-settings-maximize-dblclick"
              label="Double-click header toggles maximize"
              checked={settings.maximizeDoubleClickHeader}
              onChange={() =>
                settings.setMaximizeDoubleClickHeader(!settings.maximizeDoubleClickHeader)
              }
            />
            <p
              data-testid="board-settings-maximized-note"
              className="px-1 py-1 text-[11px] leading-snug"
              style={{ color: tokens.textMuted }}
            >
              A maximized panel fills the whole board and cannot be dragged. Restore it first —
              use the restore button in its header — and then drag it where you want it.
            </p>
          </Section>
          <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
          <Section title="New panels">
            {BOARD_NEW_PANEL_PLACEMENT_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                kind="radio"
                name="board-new-panels"
                testId={`board-settings-new-panels-${option.value}`}
                label={option.label}
                checked={settings.newPanelPlacement === option.value}
                onChange={() => settings.setNewPanelPlacement(option.value)}
              />
            ))}
          </Section>
          <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
          <Section title="Layout memory">
            {BOARD_LAYOUT_MEMORY_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                kind="radio"
                name="board-layout-memory"
                testId={`board-settings-layout-memory-${option.value}`}
                label={option.label}
                checked={settings.layoutMemory === option.value}
                onChange={() => settings.setLayoutMemory(option.value)}
              />
            ))}
          </Section>
          <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
          <Section title="Zoom">
            <label
              className="flex items-center justify-between gap-2 px-1 py-1 text-[11px] font-medium"
              style={{ color: tokens.text }}
            >
              Default zoom
              <select
                data-testid="board-settings-default-zoom"
                aria-label="Default zoom level"
                className="rounded-md border bg-transparent px-1 py-0.5 text-[11px]"
                style={{ borderColor: tokens.border, color: tokens.text }}
                value={String(settings.defaultZoomPercent)}
                onChange={(e) => settings.setDefaultZoomPercent(Number(e.target.value))}
              >
                {BOARD_ZOOM_LEVELS.map((level) => (
                  <option key={level} value={String(level)}>
                    {level}%
                  </option>
                ))}
              </select>
            </label>
            <ChoiceRow
              kind="checkbox"
              testId="board-settings-ctrl-scroll"
              label="Ctrl+scroll zooms the board"
              checked={settings.ctrlScrollZoom}
              onChange={() => settings.setCtrlScrollZoom(!settings.ctrlScrollZoom)}
            />
          </Section>
          <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
          <Section title="Toolbar panels">
            {BOARD_TOOLBAR_PANEL_IDS.map((id) => (
              <ChoiceRow
                key={id}
                kind="checkbox"
                testId={`board-settings-toolbar-${id}`}
                label={boardDefinition(id).title}
                checked={settings.toolbarPanels[id]}
                onChange={() => settings.setToolbarPanelVisible(id, !settings.toolbarPanels[id])}
              />
            ))}
          </Section>
          <div className="my-1 h-px" style={{ backgroundColor: tokens.border }} />
          <button
            type="button"
            data-testid="board-settings-reset"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-black/5"
            style={{ color: tokens.text }}
            onClick={() => settings.resetBoardSettings()}
          >
            Reset board settings
          </button>
        </div>
      )}
    </div>
  );
}
