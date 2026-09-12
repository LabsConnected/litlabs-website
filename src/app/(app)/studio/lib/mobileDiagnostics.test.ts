/**
 * Regression: the real-phone diagnostic HUD (MobileDiagOverlay) must be
 * opt-in, never shown to ordinary users just because they're on a mobile
 * viewport.
 *
 * Before this fix, CommandStudio.tsx rendered the overlay behind
 * `isMobileLitt` alone (a pure viewport-width check), so it appeared for
 * every real mobile user in production — not just testers. This tests
 * the extracted decision function directly rather than mounting the full
 * CommandStudio component tree.
 */

import { describe, it, expect } from "vitest";
import { isMobileDiagEnabled } from "./mobileDiagnostics";

describe("isMobileDiagEnabled", () => {
  it("is false with no query param (the default for every ordinary user)", () => {
    expect(isMobileDiagEnabled(new URLSearchParams(""))).toBe(false);
  });

  it("is false for unrelated query params", () => {
    expect(isMobileDiagEnabled(new URLSearchParams("tool=chat&conversation=abc"))).toBe(false);
  });

  it("is true only with the explicit opt-in value", () => {
    expect(isMobileDiagEnabled(new URLSearchParams("mobileDiag=1"))).toBe(true);
  });

  it("is false for any other value of the flag (no fuzzy truthiness)", () => {
    expect(isMobileDiagEnabled(new URLSearchParams("mobileDiag=true"))).toBe(false);
    expect(isMobileDiagEnabled(new URLSearchParams("mobileDiag=0"))).toBe(false);
    expect(isMobileDiagEnabled(new URLSearchParams("mobileDiag="))).toBe(false);
  });
});
