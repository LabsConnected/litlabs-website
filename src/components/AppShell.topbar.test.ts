import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STUDIO_TOP_BAR_COLORS, topBarColorsFor } from "./AppShell";

/**
 * Wave-3 Finding 1 — chrome clash (Larry's screenshot, 2026-11-10).
 *
 * The Studio page content is light-locked by the `.studio-shell` token
 * scope in globals.css (approved design: the Studio frame does not flip
 * dark with the visual pack). The AppShell top bar renders OUTSIDE that
 * scope and colors itself from the account theme's resolvedColors, so
 * under any dark preset it painted a black bar over the light Studio.
 * On Studio routes the bar must carry the Studio palette explicitly —
 * the same pattern the portaled Studio menus already use — while every
 * other route keeps following the active theme untouched.
 */

const DARK_THEME = {
  bgColor: "#07050d",
  textColor: "#f4f1ea",
  textMuted: "#8f8a9e",
  linkColor: "#a78bfa",
  headerColor: "#f4f1ea",
  borderColor: "#2b2440",
  accentColor: "#8b5cf6",
  boxBg: "#120d24",
  success: "#25e08a",
  warning: "#ffb020",
};

describe("topBarColorsFor", () => {
  it("leaves non-Studio routes on the active theme, untouched (same object)", () => {
    expect(topBarColorsFor(DARK_THEME, false)).toBe(DARK_THEME);
  });

  it("carries the Studio palette on Studio routes", () => {
    const T = topBarColorsFor(DARK_THEME, true);
    expect(T.bgColor).toBe("#ffffff");
    expect(T.textColor).toBe("#0e1510");
    expect(T.textMuted).toBe("#63745f");
    expect(T.accentColor).toBe("#177a36");
    expect(T.borderColor).toBe("#cfdec4");
    expect(T.boxBg).toBe("#ffffff");
  });

  it("preserves theme keys the Studio palette does not define", () => {
    const T = topBarColorsFor(DARK_THEME, true);
    expect(T.success).toBe(DARK_THEME.success);
    expect(T.warning).toBe(DARK_THEME.warning);
  });
});

describe("Studio top-bar palette stays in lockstep with the design tokens", () => {
  const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
  const shellBlock = css.slice(css.indexOf(".studio-shell {"), css.indexOf("}", css.indexOf(".studio-shell {")));

  function token(name: string): string {
    const match = shellBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) throw new Error(`token ${name} not found in .studio-shell block`);
    return match[1].toLowerCase();
  }

  it("mirrors the .studio-shell token values in globals.css", () => {
    expect(STUDIO_TOP_BAR_COLORS.bgColor?.toLowerCase()).toBe(token("--studio-surface"));
    expect(STUDIO_TOP_BAR_COLORS.borderColor?.toLowerCase()).toBe(token("--studio-border"));
    expect(STUDIO_TOP_BAR_COLORS.textColor?.toLowerCase()).toBe(token("--text-primary"));
    expect(STUDIO_TOP_BAR_COLORS.textMuted?.toLowerCase()).toBe(token("--text-muted"));
    expect(STUDIO_TOP_BAR_COLORS.accentColor?.toLowerCase()).toBe(token("--color-accent"));
    expect(STUDIO_TOP_BAR_COLORS.boxBg?.toLowerCase()).toBe(token("--studio-elevated"));
  });

  it("the TopBar actually resolves its colors through topBarColorsFor", () => {
    const source = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");
    expect(source).toContain("topBarColorsFor(resolvedColors, isStudio)");
    // The identity dock must receive the same effective colors, or the
    // account menu would keep painting the account theme over Studio.
    expect(source).toContain("<IdentityDock T={T} />");
  });
});
