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
 */

import { useState, type ReactNode } from "react";
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

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        data-testid="board-settings-button"
        aria-expanded={open}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
        style={{ color: tokens.text }}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={13} aria-hidden />
        Board settings
      </button>
      {open && (
        <div
          data-testid="board-settings-menu"
          className="absolute right-0 top-[calc(100%+8px)] max-h-[70vh] w-64 overflow-y-auto rounded-xl border p-1.5 shadow-lg"
          style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
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
