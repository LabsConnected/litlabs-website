import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  BOARD_SETTINGS_STORAGE_KEY,
  useBoardSettingsStore,
} from "./useBoardSettingsStore";
import {
  STUDIO_LAYOUT_MODE_LEGACY_KEY,
  readLegacyClassicOverride,
  resolveStudioLayoutMode,
  useStudioLayoutMode,
} from "./useStudioLayoutMode";

const store = useBoardSettingsStore;

beforeEach(() => {
  localStorage.clear();
  store.getState().resetBoardSettings();
  // resetBoardSettings persists the defaults (layoutMode: null) — the
  // state every test below starts from.
});

describe("resolveStudioLayoutMode (pure resolution)", () => {
  it("an explicit choice always wins over the legacy key", () => {
    expect(resolveStudioLayoutMode("board", true)).toBe("board");
    expect(resolveStudioLayoutMode("classic", false)).toBe("classic");
  });

  it("never chosen + legacy classic → classic (the escape hatch survives)", () => {
    expect(resolveStudioLayoutMode(null, true)).toBe("classic");
  });

  it("never chosen + no legacy override → classic, Regular is the default (Larry, 2026-11-22)", () => {
    expect(resolveStudioLayoutMode(null, false)).toBe("classic");
  });

  it("an explicit Board choice survives as the saved opt-in", () => {
    expect(resolveStudioLayoutMode("board", false)).toBe("board");
  });
});

describe("readLegacyClassicOverride", () => {
  it("is true only for the exact 'classic' value", () => {
    expect(readLegacyClassicOverride()).toBe(false);
    localStorage.setItem(STUDIO_LAYOUT_MODE_LEGACY_KEY, "classic");
    expect(readLegacyClassicOverride()).toBe(true);
    localStorage.setItem(STUDIO_LAYOUT_MODE_LEGACY_KEY, "board");
    expect(readLegacyClassicOverride()).toBe(false);
  });
});

describe("useStudioLayoutMode", () => {
  it("defaults to Regular (classic) with nothing stored anywhere", () => {
    const { result } = renderHook(() => useStudioLayoutMode());
    expect(result.current.layoutMode).toBe("classic");
    expect(result.current.layoutModeChosen).toBeNull();
  });

  it("honors the legacy escape hatch: classic with no explicit choice", () => {
    localStorage.setItem(STUDIO_LAYOUT_MODE_LEGACY_KEY, "classic");
    const { result } = renderHook(() => useStudioLayoutMode());
    expect(result.current.layoutMode).toBe("classic");
    expect(result.current.layoutModeChosen).toBeNull();
  });

  it("flipping to Regular persists the choice AND syncs the legacy key", () => {
    const { result } = renderHook(() => useStudioLayoutMode());
    act(() => result.current.setLayoutMode("classic"));
    expect(result.current.layoutMode).toBe("classic");
    expect(result.current.layoutModeChosen).toBe("classic");
    expect(store.getState().layoutMode).toBe("classic");
    expect(localStorage.getItem(STUDIO_LAYOUT_MODE_LEGACY_KEY)).toBe("classic");
    const persisted = JSON.parse(
      localStorage.getItem(BOARD_SETTINGS_STORAGE_KEY) as string,
    );
    expect(persisted.state.layoutMode).toBe("classic");
  });

  it("flipping back to Board clears the legacy key and wins over it", () => {
    localStorage.setItem(STUDIO_LAYOUT_MODE_LEGACY_KEY, "classic");
    const { result } = renderHook(() => useStudioLayoutMode());
    expect(result.current.layoutMode).toBe("classic");
    act(() => result.current.setLayoutMode("board"));
    expect(result.current.layoutMode).toBe("board");
    expect(localStorage.getItem(STUDIO_LAYOUT_MODE_LEGACY_KEY)).toBeNull();
  });

  it("a choice persisted in a previous session is honored on the next mount", () => {
    store.getState().setLayoutMode("classic");
    const { result } = renderHook(() => useStudioLayoutMode());
    expect(result.current.layoutMode).toBe("classic");
    expect(result.current.layoutModeChosen).toBe("classic");
  });
});
