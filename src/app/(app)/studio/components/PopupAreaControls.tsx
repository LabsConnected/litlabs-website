"use client";

/**
 * PopupAreaControls — the chrome of the Regular layout's right-side
 * pop-up area (Larry's design rulings, 2026-11-25).
 *
 * Two pieces, both living ON the area itself (never in Settings):
 *
 *   - PopupAreaChrome: the bar across the top of the open area,
 *     carrying the area's own "Auto pop-ups" ON/OFF switch and the
 *     one-click Hide control.
 *   - PopupAreaRestoreTab: the slim right-edge tab that is the
 *     area's only footprint while hidden — one click brings the
 *     area (and whatever surface was open in it) back.
 *
 * State lives in usePopupAreaStore; these components are pure
 * presentations of it.
 */

import { EyeOff, Sparkles } from "lucide-react";
import { usePopupAreaStore } from "../stores/usePopupAreaStore";

export function PopupAreaChrome() {
  const autoPopups = usePopupAreaStore((s) => s.autoPopups);
  const setAutoPopups = usePopupAreaStore((s) => s.setAutoPopups);
  const setAreaVisible = usePopupAreaStore((s) => s.setAreaVisible);

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5"
      style={{
        borderColor: "var(--studio-border)",
        backgroundColor: "var(--studio-surface)",
      }}
      data-testid="popup-area-chrome"
    >
      <span
        className="text-[10px] font-black uppercase tracking-[0.14em]"
        style={{ color: "var(--text-secondary)" }}
      >
        Pop-ups
      </span>
      <div className="flex-1" />
      <span
        className="text-[10px] font-bold"
        style={{ color: "var(--text-muted)" }}
        id="popup-area-auto-label"
      >
        Auto pop-ups
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={autoPopups}
        aria-labelledby="popup-area-auto-label"
        data-testid="popup-area-auto-switch"
        onClick={() => setAutoPopups(!autoPopups)}
        className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{
          backgroundColor: autoPopups ? "var(--color-accent)" : "rgba(0,0,0,0.25)",
        }}
        title={
          autoPopups
            ? "Auto pop-ups on — LiTT can open pop-ups here as it works"
            : "Auto pop-ups off — nothing opens here unless you open it"
        }
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: autoPopups ? 18 : 2 }}
          aria-hidden
        />
      </button>
      <button
        type="button"
        onClick={() => setAreaVisible(false)}
        className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-black/5"
        style={{ color: "var(--text-muted)" }}
        aria-label="Hide pop-up area"
        title="Hide the pop-up area"
        data-testid="popup-area-hide"
      >
        <EyeOff size={13} className="pointer-events-none" />
      </button>
    </div>
  );
}

export function PopupAreaRestoreTab() {
  const setAreaVisible = usePopupAreaStore((s) => s.setAreaVisible);

  return (
    <button
      type="button"
      onClick={() => setAreaVisible(true)}
      className="flex w-9 shrink-0 flex-col items-center gap-2 border-l py-3 transition-colors hover:bg-black/5"
      style={{
        borderColor: "var(--studio-border)",
        backgroundColor: "var(--studio-surface)",
        color: "var(--text-secondary)",
      }}
      aria-label="Show pop-up area"
      title="Show the pop-up area"
      data-testid="popup-area-restore-tab"
    >
      <Sparkles size={15} className="pointer-events-none" />
      <span
        className="text-[10px] font-black uppercase tracking-[0.18em]"
        style={{ writingMode: "vertical-rl" }}
      >
        Pop-ups
      </span>
    </button>
  );
}
