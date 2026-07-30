// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  type ControlProfileId,
  SEGA_GENESIS_3_BUTTON,
  SEGA_GENESIS_6_BUTTON,
  NES_PROFILE,
  SNES_PROFILE,
  CONTROL_PROFILES,
  EMULATOR_SHORTCUTS,
  controlSchemeForSystem,
  coreIdForSystem,
  normalizeSystemId,
  defaultProfileForSystem,
  getProfile,
  sixButtonVariant,
  standardGamepadLabel,
  buildEjsDefaultControls,
  mappingStorageKey,
  loadSavedMapping,
  saveMapping,
  clearSavedMapping,
} from "./control-profiles";

// ─── 1. Lion King resolves to systemId=segaMD, coreId=genesis_plus_gx ──

describe("system resolution — Lion King (Sega Genesis)", () => {
  it("normalizes Genesis / Mega Drive / MD / GEN to segaMD", () => {
    expect(normalizeSystemId("Genesis")).toBe("segaMD");
    expect(normalizeSystemId("Mega Drive")).toBe("segaMD");
    expect(normalizeSystemId("MD")).toBe("segaMD");
    expect(normalizeSystemId("GEN")).toBe("segaMD");
    expect(normalizeSystemId("segaMD")).toBe("segaMD");
  });

  it("resolves the segaMD core to genesis_plus_gx (NOT the system alias)", () => {
    expect(coreIdForSystem("segaMD")).toBe("genesis_plus_gx");
  });

  it("uses segaMD as the EmulatorJS control scheme for Genesis", () => {
    expect(controlSchemeForSystem("segaMD")).toBe("segaMD");
  });

  it("defaults Lion King to the 3-button profile", () => {
    const profile = defaultProfileForSystem("segaMD");
    expect(profile.profileId).toBe("sega-genesis-3-button");
    expect(profile.systemId).toBe("segaMD");
  });
});

// ─── 2. Genesis three-button controls contain A, B, C, Start, D-Pad ──

describe("Sega Genesis 3-button profile", () => {
  const labels = SEGA_GENESIS_3_BUTTON.controls.map((c) => c.label);

  it("contains A, B, C, Start", () => {
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels).toContain("C");
    expect(labels).toContain("Start");
  });

  it("contains the full D-Pad", () => {
    expect(labels).toContain("D-Pad Up");
    expect(labels).toContain("D-Pad Down");
    expect(labels).toContain("D-Pad Left");
    expect(labels).toContain("D-Pad Right");
  });

  it("does NOT contain six-button-only controls (X/Y/Z/Mode)", () => {
    expect(labels).not.toContain("X");
    expect(labels).not.toContain("Y");
    expect(labels).not.toContain("Z");
    expect(labels).not.toContain("Mode");
  });
});

// ─── 3. Generic BUTTON 1 / BUTTON 2 labels are never used for Genesis ──

describe("Sega Genesis labels are semantic, not generic", () => {
  it("never uses BUTTON 1 / BUTTON 2 in the visible profile", () => {
    for (const c of SEGA_GENESIS_3_BUTTON.controls) {
      expect(c.label).not.toMatch(/BUTTON\s*1/i);
      expect(c.label).not.toMatch(/BUTTON\s*2/i);
    }
    for (const c of SEGA_GENESIS_6_BUTTON.controls) {
      expect(c.label).not.toMatch(/BUTTON\s*1/i);
      expect(c.label).not.toMatch(/BUTTON\s*2/i);
    }
  });

  it("uses 'Sega Genesis' as the display name (not 'Master System')", () => {
    expect(SEGA_GENESIS_3_BUTTON.displayName).toBe("Sega Genesis");
    expect(SEGA_GENESIS_6_BUTTON.displayName).toBe("Sega Genesis");
  });
});

// ─── 4. Genesis six-button controls add X, Y, Z, Mode ───────────────

describe("Sega Genesis 6-button profile", () => {
  const labels = SEGA_GENESIS_6_BUTTON.controls.map((c) => c.label);

  it("adds X, Y, Z, Mode on top of the 3-button set", () => {
    expect(labels).toContain("X");
    expect(labels).toContain("Y");
    expect(labels).toContain("Z");
    expect(labels).toContain("Mode");
  });

  it("preserves A, B, C, Start, and D-Pad from the 3-button profile", () => {
    for (const base of SEGA_GENESIS_3_BUTTON.controls) {
      const match = SEGA_GENESIS_6_BUTTON.controls.find((c) => c.id === base.id);
      expect(match).toBeDefined();
      // The shared controls must keep identical emulator bindings + gamepad defaults.
      expect(match?.emulatorBinding).toBe(base.emulatorBinding);
      expect(match?.standardGamepadButton).toBe(base.standardGamepadButton);
      expect(match?.keyboardDefault).toBe(base.keyboardDefault);
    }
  });
});

// ─── 5. NES and SNES profiles remain unchanged ──────────────────────

describe("NES and SNES profiles are stable", () => {
  it("NES has A, B, Start, Select, D-Pad", () => {
    const labels = NES_PROFILE.controls.map((c) => c.label);
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels).toContain("Start");
    expect(labels).toContain("Select");
    expect(labels).toContain("D-Pad Up");
  });

  it("SNES has A, B, X, Y, L, R, Start, Select, D-Pad", () => {
    const labels = SNES_PROFILE.controls.map((c) => c.label);
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels).toContain("X");
    expect(labels).toContain("Y");
    expect(labels).toContain("L");
    expect(labels).toContain("R");
    expect(labels).toContain("Start");
    expect(labels).toContain("Select");
  });

  it("NES/SNES systemId + coreId are correct", () => {
    expect(NES_PROFILE.systemId).toBe("nes");
    expect(coreIdForSystem("nes")).toBe("fceumm");
    expect(SNES_PROFILE.systemId).toBe("snes");
    expect(coreIdForSystem("snes")).toBe("snes9x");
  });
});

// ─── 6 & 7. Saved mapping persistence + per-controller namespacing ──

describe("saved mapping persistence", () => {
  beforeEach(() => {
    // jsdom provides localStorage in the default env, but this file uses the
    // node env. Provide a minimal in-memory localStorage shim.
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    } as Storage;
  });

  it("namespaces mappings by user + systemId + controller", () => {
    const key1 = mappingStorageKey("u1", "segaMD", "gamepad-a");
    const key2 = mappingStorageKey("u1", "segaMD", "gamepad-b");
    const key3 = mappingStorageKey("u1", "nes", "gamepad-a");
    const key4 = mappingStorageKey("u2", "segaMD", "gamepad-a");
    expect(new Set([key1, key2, key3, key4]).size).toBe(4);
    expect(key1).toContain("segaMD");
    expect(key1).toContain("gamepad-a");
  });

  it("persists a remapped Genesis control across reload", () => {
    saveMapping("u1", "segaMD", "kb", { a: { keyboard: "k", gamepad: 2 } });
    const loaded = loadSavedMapping("u1", "segaMD", "kb");
    expect(loaded).not.toBeNull();
    expect(loaded?.a.keyboard).toBe("k");
    expect(loaded?.a.gamepad).toBe(2);
  });

  it("does NOT share Genesis mappings with NES", () => {
    saveMapping("u1", "segaMD", "kb", { a: { keyboard: "k", gamepad: 2 } });
    const nes = loadSavedMapping("u1", "nes", "kb");
    expect(nes).toBeNull();
  });

  it("gives different controllers separate saved profiles", () => {
    saveMapping("u1", "segaMD", "pad-a", { a: { keyboard: "k1", gamepad: 0 } });
    saveMapping("u1", "segaMD", "pad-b", { a: { keyboard: "k2", gamepad: 1 } });
    expect(loadSavedMapping("u1", "segaMD", "pad-a")?.a.keyboard).toBe("k1");
    expect(loadSavedMapping("u1", "segaMD", "pad-b")?.a.keyboard).toBe("k2");
  });

  it("returns null when no mapping exists (defaults apply)", () => {
    expect(loadSavedMapping("u1", "segaMD", "never")).toBeNull();
  });
});

// ─── 8. Reset restores Sega defaults only ────────────────────────────

describe("reset restores defaults only", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    } as Storage;
  });

  it("clearSavedMapping removes only the targeted entry", () => {
    saveMapping("u1", "segaMD", "kb", { a: { keyboard: "k", gamepad: 2 } });
    saveMapping("u1", "nes", "kb", { a: { keyboard: "z", gamepad: 0 } });
    clearSavedMapping("u1", "segaMD", "kb");
    expect(loadSavedMapping("u1", "segaMD", "kb")).toBeNull();
    // NES mapping must survive a Sega reset.
    expect(loadSavedMapping("u1", "nes", "kb")).not.toBeNull();
  });
});

// ─── 9. Detected standard controller maps correctly ─────────────────

describe("standard gamepad label mapping", () => {
  it("maps Genesis A → Xbox X (west, button 2)", () => {
    const a = SEGA_GENESIS_3_BUTTON.controls.find((c) => c.id === "a");
    expect(a?.standardGamepadButton).toBe(2);
    expect(standardGamepadLabel(2)).toBe("Xbox X");
  });

  it("maps Genesis B → Xbox A (south, button 0)", () => {
    const b = SEGA_GENESIS_3_BUTTON.controls.find((c) => c.id === "b");
    expect(b?.standardGamepadButton).toBe(0);
    expect(standardGamepadLabel(0)).toBe("Xbox A");
  });

  it("maps Genesis C → Xbox B (east, button 1)", () => {
    const c = SEGA_GENESIS_3_BUTTON.controls.find((c) => c.id === "c");
    expect(c?.standardGamepadButton).toBe(1);
    expect(standardGamepadLabel(1)).toBe("Xbox B");
  });

  it("maps Start → Menu/Start (button 9)", () => {
    const start = SEGA_GENESIS_3_BUTTON.controls.find((c) => c.id === "start");
    expect(start?.standardGamepadButton).toBe(9);
    expect(standardGamepadLabel(9)).toBe("Menu / Start");
  });

  it("six-button: X → Xbox Y, Y → Left bumper, Z → Right bumper, Mode → View/Back", () => {
    const x = SEGA_GENESIS_6_BUTTON.controls.find((c) => c.id === "x");
    const y = SEGA_GENESIS_6_BUTTON.controls.find((c) => c.id === "y");
    const z = SEGA_GENESIS_6_BUTTON.controls.find((c) => c.id === "z");
    const mode = SEGA_GENESIS_6_BUTTON.controls.find((c) => c.id === "mode");
    expect(x?.standardGamepadButton).toBe(3);
    expect(standardGamepadLabel(3)).toBe("Xbox Y");
    expect(y?.standardGamepadButton).toBe(4);
    expect(standardGamepadLabel(4)).toBe("Left Bumper");
    expect(z?.standardGamepadButton).toBe(5);
    expect(standardGamepadLabel(5)).toBe("Right Bumper");
    expect(mode?.standardGamepadButton).toBe(8);
    expect(standardGamepadLabel(8)).toBe("View / Back");
  });
});

// ─── EmulatorJS binding verification ────────────────────────────────

describe("EmulatorJS 4.2.3 internal bindings (verified against vendored source)", () => {
  it("segaMD bindings match the segaMD branch in emulator.js", () => {
    // From emulator.js segaMD branch: A=1, B=0, C=8, X=10, Y=9, Z=11,
    // Mode=2, Start=3, D-Pad=4/5/6/7.
    const byId = Object.fromEntries(SEGA_GENESIS_6_BUTTON.controls.map((c) => [c.id, c.emulatorBinding]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(0);
    expect(byId.c).toBe(8);
    expect(byId.x).toBe(10);
    expect(byId.y).toBe(9);
    expect(byId.z).toBe(11);
    expect(byId.mode).toBe(2);
    expect(byId.start).toBe(3);
    expect(byId.up).toBe(4);
    expect(byId.down).toBe(5);
    expect(byId.left).toBe(6);
    expect(byId.right).toBe(7);
  });
});

// ─── EJS_defaultControls builder ────────────────────────────────────

describe("buildEjsDefaultControls", () => {
  it("produces a player-0 object with keyboard defaults", () => {
    const dc = buildEjsDefaultControls(SEGA_GENESIS_3_BUTTON);
    expect(dc[0]).toBeDefined();
    // B has emulatorBinding 0 and keyboardDefault "x"
    expect(dc[0][0]).toEqual({ value: "x", value2: "BUTTON_2" });
    // A has emulatorBinding 1 and keyboardDefault "z"
    expect(dc[0][1]).toEqual({ value: "z", value2: "BUTTON_4" });
    // Start has emulatorBinding 3 and keyboardDefault "enter"
    expect(dc[0][3]).toEqual({ value: "enter", value2: "START" });
  });
});

// ─── 3/6-button switching preserves shared controls ─────────────────

describe("3-button ↔ 6-button switching", () => {
  it("sixButtonVariant returns the 6-button profile from the 3-button one", () => {
    expect(sixButtonVariant(SEGA_GENESIS_3_BUTTON)?.profileId).toBe("sega-genesis-6-button");
  });

  it("sixButtonVariant returns the 3-button profile from the 6-button one", () => {
    expect(sixButtonVariant(SEGA_GENESIS_6_BUTTON)?.profileId).toBe("sega-genesis-3-button");
  });

  it("has no six-button variant for non-Sega profiles", () => {
    expect(sixButtonVariant(NES_PROFILE)).toBeNull();
    expect(sixButtonVariant(SNES_PROFILE)).toBeNull();
  });
});

// ─── Emulator shortcuts are present and separate ────────────────────

describe("emulator shortcuts section", () => {
  it("includes the required shortcuts", () => {
    const labels = EMULATOR_SHORTCUTS.map((s) => s.label);
    expect(labels).toContain("Quick Save");
    expect(labels).toContain("Quick Load");
    expect(labels).toContain("Change State Slot");
    expect(labels).toContain("Fast Forward");
    expect(labels).toContain("Slow Motion");
    expect(labels).toContain("Rewind");
  });

  it("shortcuts are NOT part of any controller profile controls", () => {
    for (const profile of Object.values(CONTROL_PROFILES)) {
      for (const shortcut of EMULATOR_SHORTCUTS) {
        expect(profile.controls.find((c) => c.label === shortcut.label)).toBeUndefined();
      }
    }
  });
});

// ─── Registry integrity ─────────────────────────────────────────────

describe("control profile registry", () => {
  it("every profile is reachable by id", () => {
    const ids: ControlProfileId[] = [
      "sega-genesis-3-button",
      "sega-genesis-6-button",
      "sega-master-system",
      "sega-game-gear",
      "nes",
      "snes",
      "game-boy",
      "gba",
    ];
    for (const id of ids) {
      expect(getProfile(id).profileId).toBe(id);
    }
  });

  it("every profile's systemId resolves to a valid coreId", () => {
    for (const profile of Object.values(CONTROL_PROFILES)) {
      expect(coreIdForSystem(profile.systemId)).toBeTruthy();
    }
  });
});

// ─── Other Sega systems are not collapsed into segaMD ───────────────

describe("Sega system separation", () => {
  it("Master System is segaMS, not segaMD", () => {
    expect(normalizeSystemId("Master System")).toBe("segaMS");
    expect(coreIdForSystem("segaMS")).toBe("genesis_plus_gx");
    expect(controlSchemeForSystem("segaMS")).toBe("segaMS");
  });

  it("Game Gear is segaGG, not segaMD", () => {
    expect(normalizeSystemId("Game Gear")).toBe("segaGG");
    expect(controlSchemeForSystem("segaGG")).toBe("segaGG");
  });

  it("Sega CD is segaCD, not segaMD", () => {
    expect(normalizeSystemId("Sega CD")).toBe("segaCD");
    expect(controlSchemeForSystem("segaCD")).toBe("segaCD");
  });

  it("32X is sega32x with picodrive core", () => {
    expect(normalizeSystemId("32X")).toBe("sega32x");
    expect(coreIdForSystem("sega32x")).toBe("picodrive");
  });
});
