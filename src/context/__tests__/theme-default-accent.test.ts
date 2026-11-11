/**
 * PR-G regression: the product's default accent must not drift to an
 * unapproved accent.
 *
 * The ThemeContext default theme previously shipped `accent: "purple-haze"`,
 * which painted every theme-driven surface (cookie consent, docs, admin,
 * marketplace legends, focus rings via tokens.focus) violet — contradicting
 * the J1 lime decision (PRIMARY_ACCENT_DECISION = lime, decided 2026-09-16).
 *
 * SUPERSEDED IN PART (2026-11-10, Larry's standing design order): the
 * default theme is now the LiTT Signature pack, whose accent is
 * "signature-green" (deep green #177A36; lime survives as the highlight
 * family — see theme-default-signature.test.ts). The J1 lime token
 * itself is unchanged and remains selectable; these tests now pin the
 * default to signature-green and keep the lime-token integrity checks.
 */
import { describe, it, expect } from "vitest";
import {
  ACCENT_MAP,
  accentOverrides,
  defaultTheme,
} from "@/context/ThemeContext";
import { brand } from "@/lib/design/litt-tokens";

describe("PR-G: default product accent is the approved Signature green", () => {
  it("default theme selects the signature-green accent", () => {
    expect(defaultTheme.accent).toBe("signature-green");
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
