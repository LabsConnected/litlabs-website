/**
 * PR-G regression: the product's default accent must be the J1 canonical lime.
 *
 * The ThemeContext default theme previously shipped `accent: "purple-haze"`,
 * which painted every theme-driven surface (cookie consent, docs, admin,
 * marketplace legends, focus rings via tokens.focus) violet — contradicting
 * the J1 lime decision (PRIMARY_ACCENT_DECISION = lime, decided 2026-09-16).
 * These tests pin the default so it cannot quietly drift back.
 */
import { describe, it, expect } from "vitest";
import {
  ACCENT_MAP,
  accentOverrides,
  defaultTheme,
} from "@/context/ThemeContext";
import { brand } from "@/lib/design/litt-tokens";

describe("PR-G: default product accent is J1 lime", () => {
  it("default theme selects the lime accent", () => {
    expect(defaultTheme.accent).toBe("lime");
  });

  it("lime accent override resolves accentColor to the J1 lime candidate", () => {
    expect(accentOverrides["lime"].accentColor).toBe(brand.primary.DEFAULT);
  });

  it("ACCENT_MAP lime entry matches the J1 lime candidate", () => {
    expect(ACCENT_MAP["lime"].hex).toBe(brand.primary.DEFAULT);
  });

  it("default is not the legacy purple-haze accent", () => {
    expect(defaultTheme.accent).not.toBe("purple-haze");
  });

  it("user-selectable legacy accents still exist (choice preserved)", () => {
    for (const key of ["purple-haze", "ocean-blue", "sunset-orange"] as const) {
      expect(accentOverrides[key].accentColor).toBeTruthy();
      expect(ACCENT_MAP[key].hex).toBeTruthy();
    }
  });
});
