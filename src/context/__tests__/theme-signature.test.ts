/**
 * LiTT Signature theme: the approved homepage design (true white worked
 * into deep green, lime accents, glow) registered as a selectable
 * Settings → Appearance quick preset.
 *
 * Pins:
 *  - the pack exists in VISUAL_PACKS (what Appearance renders) with the
 *    approved design's settings,
 *  - the "signature" skin carries the mockup tokens in the LIGHT map —
 *    the theme was originally light-locked in both maps (the phone
 *    dark-mode incident Larry hit), but the owner decision of 2026-11-14
 *    superseded the lock: the dark map now carries an authored dark
 *    variant (see theme-signature-dark.test.ts) while the light tokens
 *    below stay exactly as approved,
 *  - selection coherence: the pack's fields are the exact combination
 *    VisualPackSettings uses to mark a pack Active, and applyVisualPack
 *    persists them through the standard litlabs-theme flow.
 */
import { describe, it, expect } from "vitest";
import {
  ACCENT_MAP,
  VISUAL_PACKS,
  accentOverrides,
  darkSkins,
  lightSkins,
} from "@/context/ThemeContext";

const pack = VISUAL_PACKS.find((p) => p.id === "litt-signature");

describe("LiTT Signature visual pack", () => {
  it("is registered in VISUAL_PACKS for Settings → Appearance", () => {
    expect(pack).toBeDefined();
    expect(pack?.name).toBe("LiTT Signature");
  });

  it("applies the approved homepage design settings", () => {
    expect(pack?.themeMode).toBe("light");
    expect(pack?.skin).toBe("signature");
    expect(pack?.accent).toBe("signature-green");
    expect(pack?.backgroundMode).toBe("minimal");
    expect(pack?.layoutStyle).toBe("classic");
    expect(pack?.effects?.glow).toBe(true);
  });

  it("carries the mockup tokens (true white, deep green, lime family)", () => {
    expect(lightSkins.signature.bgColor).toBe("#FFFFFF");
    expect(lightSkins.signature.boxBg).toBe("#FFFFFF");
    expect(lightSkins.signature.textColor).toBe("#0E1510");
    expect(lightSkins.signature.accentColor).toBe("#177A36");
    expect(lightSkins.signature.headerColor).toBe("#0C5A26");
    expect(lightSkins.signature.borderColor).toBe("#CFDEC4");
  });

  it("is no longer light-locked: dark map holds a real dark variant (2026-11-14)", () => {
    expect(darkSkins.signature).not.toEqual(lightSkins.signature);
    expect(darkSkins.signature.bgColor).not.toBe("#FFFFFF");
  });

  it("signature-green accent resolves to the mockup green family", () => {
    expect(accentOverrides["signature-green"].accentColor).toBe("#177A36");
    expect(accentOverrides["signature-green"].headerColor).toBe("#0C5A26");
    expect(ACCENT_MAP["signature-green"].hex).toBe("#177A36");
  });

  it("does not disturb the existing packs", () => {
    for (const id of ["honeycomb-core", "littree-forest", "midnight-os"]) {
      expect(VISUAL_PACKS.some((p) => p.id === id)).toBe(true);
    }
  });
});
