"use client";

/**
 * usePopupAreaStore — the right-side pop-up area's own controls
 * (Larry's design rulings, 2026-11-25).
 *
 * The pop-up area is where on-demand surfaces land in the Regular
 * layout (today: the Browser side dock and its free pop-out). Two
 * switches live ON the area itself — never buried in Settings:
 *
 *   - `areaVisible`: one click hides the whole area; a slim edge tab
 *     is all that remains, and one click on it brings the area back.
 *     Hiding is a view choice — an open surface stays open
 *     underneath and reappears exactly as it was.
 *   - `autoPopups`: while ON, LiTT-driven surfaces may appear
 *     uninvited (small first — the two-stage pop-out rule). While
 *     OFF, nothing appears uninvited: intent-driven opens are
 *     held, and the user opens everything manually. A direct user
 *     click on a surface's own launcher always opens it — asking
 *     is asking.
 *
 * Persisted to localStorage like the board settings, so the choice
 * survives reload.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const POPUP_AREA_STORAGE_KEY = "litt-studio-popup-area-v1";

export interface PopupAreaState {
  /** The right-side pop-up area is shown (its on-area toggle). */
  areaVisible: boolean;
  /** LiTT-driven surfaces may open uninvited (small peek first). */
  autoPopups: boolean;
  setAreaVisible: (visible: boolean) => void;
  setAutoPopups: (on: boolean) => void;
}

export const usePopupAreaStore = create<PopupAreaState>()(
  persist(
    (set) => ({
      areaVisible: true,
      autoPopups: true,
      setAreaVisible: (visible) => set({ areaVisible: Boolean(visible) }),
      setAutoPopups: (on) => set({ autoPopups: Boolean(on) }),
    }),
    {
      name: POPUP_AREA_STORAGE_KEY,
      partialize: (s) => ({ areaVisible: s.areaVisible, autoPopups: s.autoPopups }),
    },
  ),
);

/**
 * Plain hook-free gate for intent routers: may a LiTT-driven surface
 * open itself in the pop-up area right now? True only when the area
 * is visible AND auto pop-ups are on.
 */
export function popupsAllowed(): boolean {
  const s = usePopupAreaStore.getState();
  return s.areaVisible && s.autoPopups;
}
