/**
 * LiTT Signature DARK mode (owner decision, 2026-11-14).
 *
 * Larry picked "make Dark work" over removing the option: the diagnosis
 * (THEME-MODE-DIAGNOSIS-2026-11-14.md) proved the toggle registered and
 * persisted, but darkSkins.signature held tokens identical to the light
 * table (the light-lock), so the screen could never change.
 *
 * Pins:
 *  - darkSkins.signature is a real dark variant in the Signature family;
 *    lightSkins.signature stays byte-for-byte the original design.
 *  - getResolvedColors: Signature + dark flips the surface/background
 *    tokens; Signature + light returns today's tokens unchanged; the
 *    signature-green identity pairing resolves its dark link/header/
 *    accent from the skin (not the light-only override table), while a
 *    foreign accent still overrides in dark as before.
 *  - "system" is real: it resolves from prefers-color-scheme both ways,
 *    and the provider follows live OS changes (mocked matchMedia) while
 *    the stored mode stays "system".
 *  - Other skins are untouched (cyberpunk dark spot-check, including its
 *    existing signature-green override behavior in dark).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import {
  ThemeProvider,
  useTheme,
  darkSkins,
  lightSkins,
  getResolvedColors,
  resolveEffectiveMode,
  type Theme,
} from "@/context/ThemeContext";

const LIGHT_SIGNATURE = {
  bgColor: "#FFFFFF",
  textColor: "#0E1510",
  linkColor: "#177A36",
  headerColor: "#0C5A26",
  borderColor: "#CFDEC4",
  accentColor: "#177A36",
  boxBg: "#FFFFFF",
};

// Charcoal retokenize (owner decision, 2026-11-14, later the same day):
// Larry rejected the first authored dark variant's near-black green
// surfaces ("the color with black throws off the color of everything")
// and picked neutral charcoal from a visual comparison. Green survives
// only as the voice — the Signature accent and the lifted link green,
// both unchanged from the first variant.
const DARK_SIGNATURE = {
  bgColor: "#15171B",
  textColor: "#F2F4F3",
  linkColor: "#5AD67E",
  headerColor: "#D7DBDE",
  borderColor: "#2E3238",
  accentColor: "#2FBF5A",
  boxBg: "#1F2228",
  textMuted: "#A8ADB5",
};

const theme = (over: Partial<Theme>): Theme => ({
  mode: "light",
  skin: "signature",
  accent: "signature-green",
  backgroundMode: "minimal",
  layoutStyle: "classic",
  ...over,
});

describe("Signature skin tables", () => {
  it("light table is byte-for-byte the original approved tokens", () => {
    expect(lightSkins.signature).toEqual(LIGHT_SIGNATURE);
  });

  it("dark table is an authored dark variant in the Signature family", () => {
    expect(darkSkins.signature).toEqual(DARK_SIGNATURE);
  });
});

describe("getResolvedColors — Signature", () => {
  it("dark returns dark tokens that differ from light on surface/background tokens", () => {
    const dark = getResolvedColors(theme({ mode: "dark" }));
    const light = getResolvedColors(theme({ mode: "light" }));
    for (const key of ["bgColor", "boxBg", "textColor", "borderColor"] as const) {
      expect(dark[key]).not.toBe(light[key]);
    }
    expect(dark.bgColor).toBe(DARK_SIGNATURE.bgColor);
    expect(dark.boxBg).toBe(DARK_SIGNATURE.boxBg);
    expect(dark.textColor).toBe(DARK_SIGNATURE.textColor);
    expect(dark.borderColor).toBe(DARK_SIGNATURE.borderColor);
  });

  it("light returns today's tokens unchanged", () => {
    const light = getResolvedColors(theme({ mode: "light" }));
    expect(light.bgColor).toBe(LIGHT_SIGNATURE.bgColor);
    expect(light.boxBg).toBe(LIGHT_SIGNATURE.boxBg);
    expect(light.textColor).toBe(LIGHT_SIGNATURE.textColor);
    expect(light.borderColor).toBe(LIGHT_SIGNATURE.borderColor);
    expect(light.linkColor).toBe(LIGHT_SIGNATURE.linkColor);
    expect(light.headerColor).toBe(LIGHT_SIGNATURE.headerColor);
    expect(light.accentColor).toBe(LIGHT_SIGNATURE.accentColor);
  });

  it("dark identity pairing (signature + signature-green) uses the skin's dark link/header/accent", () => {
    const dark = getResolvedColors(theme({ mode: "dark" }));
    expect(dark.linkColor).toBe(DARK_SIGNATURE.linkColor);
    expect(dark.headerColor).toBe(DARK_SIGNATURE.headerColor);
    expect(dark.accentColor).toBe(DARK_SIGNATURE.accentColor);
  });

  it("a foreign accent still overrides in Signature dark (identity exception stays scoped)", () => {
    const dark = getResolvedColors(
      theme({ mode: "dark", accent: "hot-pink" }),
    );
    expect(dark.bgColor).toBe(DARK_SIGNATURE.bgColor);
    expect(dark.linkColor).toBe("#f472b6");
    expect(dark.accentColor).toBe("#ec4899");
  });
});

describe("system mode resolution", () => {
  it("resolveEffectiveMode follows prefers-color-scheme only for system", () => {
    expect(resolveEffectiveMode("system", true)).toBe("dark");
    expect(resolveEffectiveMode("system", false)).toBe("light");
    expect(resolveEffectiveMode("dark", false)).toBe("dark");
    expect(resolveEffectiveMode("light", true)).toBe("light");
  });

  it("getResolvedColors resolves system both ways", () => {
    const sys = theme({ mode: "system" });
    expect(getResolvedColors(sys, true).bgColor).toBe(DARK_SIGNATURE.bgColor);
    expect(getResolvedColors(sys, false).bgColor).toBe(
      LIGHT_SIGNATURE.bgColor,
    );
    expect(getResolvedColors(sys, true).boxBg).toBe(DARK_SIGNATURE.boxBg);
    expect(getResolvedColors(sys, false).boxBg).toBe(LIGHT_SIGNATURE.boxBg);
  });
});

describe("other skins are untouched", () => {
  it("cyberpunk dark still resolves its own dark table", () => {
    const colors = getResolvedColors(
      theme({ mode: "dark", skin: "cyberpunk", accent: "electric-blue" }),
    );
    expect(colors.bgColor).toBe("#0c0c14");
    expect(colors.boxBg).toBe("#131320");
  });

  it("signature-green override behavior on other skins is preserved in dark", () => {
    const colors = getResolvedColors(
      theme({ mode: "dark", skin: "cyberpunk", accent: "signature-green" }),
    );
    // The identity exception is Signature-skin scoped: elsewhere the
    // accent override still wins exactly as before this change.
    expect(colors.headerColor).toBe("#0C5A26");
    expect(colors.linkColor).toBe("#177A36");
  });
});

/* ------------------------------------------------------------------ */
/*  Provider: system mode follows a live OS flip (mocked matchMedia)   */
/* ------------------------------------------------------------------ */

type ChangeListener = (e: { matches: boolean }) => void;

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<ChangeListener>();
  const mq = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: ChangeListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: ChangeListener) =>
      listeners.delete(cb),
    addListener: (cb: ChangeListener) => listeners.add(cb),
    removeListener: (cb: ChangeListener) => listeners.delete(cb),
    dispatchEvent: () => true,
    onchange: null,
  };
  const original = window.matchMedia;
  window.matchMedia = (() => mq) as unknown as typeof window.matchMedia;
  return {
    flip(next: boolean) {
      matches = next;
      for (const cb of [...listeners]) cb({ matches: next });
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

function BgProbe() {
  const { resolvedColors } = useTheme();
  return createElement("div", { "data-testid": "bg" }, resolvedColors.bgColor);
}

describe("ThemeProvider — system follows the OS live", () => {
  let media: ReturnType<typeof installMatchMedia>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "litlabs-theme",
      JSON.stringify(theme({ mode: "system" })),
    );
  });

  afterEach(() => {
    media?.restore();
    localStorage.clear();
  });

  it("renders dark under a dark OS, then flips to light when the OS flips", async () => {
    media = installMatchMedia(true);
    render(
      createElement(ThemeProvider, null, createElement(BgProbe)),
    );
    await waitFor(() =>
      expect(screen.getByTestId("bg").textContent).toBe(
        DARK_SIGNATURE.bgColor,
      ),
    );

    act(() => media.flip(false));
    await waitFor(() =>
      expect(screen.getByTestId("bg").textContent).toBe(
        LIGHT_SIGNATURE.bgColor,
      ),
    );

    act(() => media.flip(true));
    await waitFor(() =>
      expect(screen.getByTestId("bg").textContent).toBe(
        DARK_SIGNATURE.bgColor,
      ),
    );

    // Stored semantics unchanged: the saved mode is still "system".
    const stored = JSON.parse(localStorage.getItem("litlabs-theme") ?? "{}");
    expect(stored.mode).toBe("system");
  });

  it("renders light under a light OS", async () => {
    media = installMatchMedia(false);
    render(
      createElement(ThemeProvider, null, createElement(BgProbe)),
    );
    await waitFor(() =>
      expect(screen.getByTestId("bg").textContent).toBe(
        LIGHT_SIGNATURE.bgColor,
      ),
    );
  });
});
