import { beforeEach, describe, expect, it } from "vitest";
import {
  POPUP_AREA_STORAGE_KEY,
  popupsAllowed,
  usePopupAreaStore,
} from "./usePopupAreaStore";

// The pop-up area's own switches (Larry, 2026-11-25): the area can
// be hidden in place, and "Auto pop-ups" decides whether LiTT-driven
// surfaces may appear uninvited. Both default ON/visible — the
// two-stage pop-out system starts from small peeks, not silence.

describe("usePopupAreaStore", () => {
  beforeEach(() => {
    localStorage.clear();
    usePopupAreaStore.setState({ areaVisible: true, autoPopups: true });
  });

  it("defaults to a visible area with auto pop-ups on", () => {
    const s = usePopupAreaStore.getState();
    expect(s.areaVisible).toBe(true);
    expect(s.autoPopups).toBe(true);
    expect(popupsAllowed()).toBe(true);
  });

  it("popupsAllowed is false when the area is hidden, even with auto pop-ups on", () => {
    usePopupAreaStore.getState().setAreaVisible(false);
    expect(popupsAllowed()).toBe(false);
  });

  it("popupsAllowed is false when auto pop-ups are off, even with the area visible", () => {
    usePopupAreaStore.getState().setAutoPopups(false);
    expect(popupsAllowed()).toBe(false);
    // The two switches are independent: the area itself stays visible.
    expect(usePopupAreaStore.getState().areaVisible).toBe(true);
  });

  it("persists both switches to localStorage", () => {
    usePopupAreaStore.getState().setAreaVisible(false);
    usePopupAreaStore.getState().setAutoPopups(false);
    const persisted = JSON.parse(localStorage.getItem(POPUP_AREA_STORAGE_KEY) as string);
    expect(persisted.state.areaVisible).toBe(false);
    expect(persisted.state.autoPopups).toBe(false);
  });
});
