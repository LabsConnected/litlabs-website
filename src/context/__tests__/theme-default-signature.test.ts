/**
 * Default theme = LiTT Signature (Larry's standing design order,
 * 2026-11-10): the white-into-green Signature look is what the signed-in
 * app renders BY DEFAULT. Before this change, defaultTheme was a dark
 * theme (mode "dark", skin "volcanic", backgroundMode "nebula") and the
 * Signature pack was only a selectable preset — so every account that
 * had not explicitly picked it rendered dark, which is exactly the
 * "my theme is not right" complaint.
 *
 * Pins:
 *  - defaultTheme IS the Signature combination, field-for-field equal
 *    to the litt-signature visual pack's settings.
 *  - resolveInitialTheme: no stored value → Signature default.
 *  - a stored theme that merely REPEATS a former factory default (the
 *    save effect persisted it for users who never chose anything) is
 *    NOT an explicit choice → resolves to the Signature default. This
 *    extends the migration precedent already in ThemeContext.
 *  - any other stored theme (a real user choice, or anything carrying
 *    customColors) wins unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  VISUAL_PACKS,
  defaultTheme,
  resolveInitialTheme,
  type Theme,
} from "@/context/ThemeContext";

const pack = VISUAL_PACKS.find((p) => p.id === "litt-signature");

describe("default theme is LiTT Signature", () => {
  it("defaultTheme carries the Signature combination", () => {
    expect(defaultTheme.mode).toBe("light");
    expect(defaultTheme.skin).toBe("signature");
    expect(defaultTheme.accent).toBe("signature-green");
    expect(defaultTheme.backgroundMode).toBe("minimal");
    expect(defaultTheme.layoutStyle).toBe("classic");
  });

  it("defaultTheme matches the litt-signature pack field-for-field", () => {
    expect(pack).toBeDefined();
    expect(defaultTheme.mode).toBe(pack?.themeMode);
    expect(defaultTheme.skin).toBe(pack?.skin);
    expect(defaultTheme.accent).toBe(pack?.accent);
    expect(defaultTheme.backgroundMode).toBe(pack?.backgroundMode);
    expect(defaultTheme.layoutStyle).toBe(pack?.layoutStyle);
  });
});

describe("resolveInitialTheme", () => {
  it("no stored value → the Signature default", () => {
    expect(resolveInitialTheme(null)).toEqual(defaultTheme);
  });

  it("unparseable stored value → the Signature default", () => {
    expect(resolveInitialTheme("{not json")).toEqual(defaultTheme);
  });

  it("the pre-Signature factory default (dark/volcanic/lime/nebula) is not an explicit choice → Signature", () => {
    const legacy: Theme = {
      mode: "dark",
      skin: "volcanic",
      accent: "lime",
      backgroundMode: "nebula",
      layoutStyle: "glass",
    };
    expect(resolveInitialTheme(JSON.stringify(legacy))).toEqual(defaultTheme);
  });

  it("the older factory default (dark/volcanic/sunset-orange/constellation) still migrates → Signature", () => {
    const legacy: Theme = {
      mode: "dark",
      skin: "volcanic",
      accent: "sunset-orange",
      backgroundMode: "constellation",
      layoutStyle: "glass",
    };
    expect(resolveInitialTheme(JSON.stringify(legacy))).toEqual(defaultTheme);
  });

  it("a genuinely chosen stored theme wins unchanged", () => {
    const chosen: Theme = {
      mode: "dark",
      skin: "arctic",
      accent: "ocean-blue",
      backgroundMode: "minimal",
      layoutStyle: "minimal",
    };
    expect(resolveInitialTheme(JSON.stringify(chosen))).toEqual(chosen);
  });

  it("a stored theme carrying customColors wins even on the legacy combination", () => {
    const customized: Theme = {
      mode: "dark",
      skin: "volcanic",
      accent: "lime",
      backgroundMode: "nebula",
      layoutStyle: "glass",
      customColors: { accentColor: "#ff00aa" },
    };
    expect(resolveInitialTheme(JSON.stringify(customized))).toEqual(customized);
  });
});
