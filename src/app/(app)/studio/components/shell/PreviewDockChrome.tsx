"use client";

/**
 * PreviewDockChrome — the placement dropdown rendered in the preview
 * toolbar (and in the float/chat host chrome). Same affordance family as
 * ChatDockSwitcher: a compact button that opens a glass menu listing all
 * placement modes plus Reset Layout.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutPanelLeft, RotateCcw } from "lucide-react";
import { PREVIEW_DOCK_OPTIONS, type PreviewPlacement } from "../../lib/preview-dock";

interface PreviewDockChromeProps {
  placement: PreviewPlacement;
  onChange: (placement: PreviewPlacement) => void;
  onResetLayout?: () => void;
}

export default function PreviewDockChrome({ placement, onChange, onResetLayout }: PreviewDockChromeProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = PREVIEW_DOCK_OPTIONS.find((o) => o.value === placement) ?? PREVIEW_DOCK_OPTIONS[0];

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center" data-testid="preview-dock-switcher">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-bold transition hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label={`Preview placement: ${active.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Move preview"
        data-testid="preview-dock-menu-button"
      >
        <LayoutPanelLeft size={12} className="pointer-events-none" />
        <span className="max-w-[92px] truncate">{active.label}</span>
        <ChevronDown size={11} className="pointer-events-none" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Preview placement"
          className="glass-shell absolute right-0 top-full z-[400] mt-1 w-56 overflow-hidden rounded-lg border py-1 shadow-2xl"
          style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}
          data-testid="preview-dock-menu"
        >
          {PREVIEW_DOCK_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={placement === opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start px-3 py-1.5 text-left transition hover:bg-white/8"
              data-testid={`preview-dock-opt-${opt.value}`}
            >
              <span
                className="text-[11px] font-bold"
                style={{ color: placement === opt.value ? "var(--color-accent)" : "var(--text-main)" }}
              >
                {opt.label}
              </span>
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                {opt.hint}
              </span>
            </button>
          ))}
          {onResetLayout && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onResetLayout();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-[10px] font-bold transition hover:bg-white/8"
              style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
              data-testid="preview-dock-reset"
            >
              <RotateCcw size={11} className="pointer-events-none" />
              Reset layout
            </button>
          )}
        </div>
      )}
    </div>
  );
}
