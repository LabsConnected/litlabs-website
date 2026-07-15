"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  ReactNode,
} from "react";
import type { BackgroundMode } from "@/components/AnimatedBackground";

// Use layout effect on the client so CSS variables are applied before the
// first paint, avoiding a flash of the default volcanic palette.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Skin presets
export type SkinPreset =
  | "cyberpunk"
  | "retro"
  | "ocean"
  | "sunset"
  | "matrix"
  | "pink"
  | "synthwave"
  | "volcanic"
  | "gold"
  | "arctic"
  | "emerald"
  | "midnight"
  | "neon"
  | "blood"
  | "cosmic"
  | "miami"
  | "honeycomb";

// Theme mode
export type ThemeMode = "dark" | "light" | "system";

// Accent colors
export type AccentColor =
  | "neon-green"
  | "hot-pink"
  | "electric-blue"
  | "cyber-yellow"
  | "matrix-green"
  | "sunset-orange"
  | "ocean-blue"
  | "purple-haze";

// Theme structure
export interface Theme {
  mode: ThemeMode;
  skin: SkinPreset;
  accent: AccentColor;
  backgroundMode: BackgroundMode;
  customColors?: {
    bgColor?: string;
    textColor?: string;
    linkColor?: string;
    headerColor?: string;
    borderColor?: string;
    accentColor?: string;
    boxBg?: string;
  };
}

// Default dark skins
const darkSkins: Record<
  SkinPreset,
  {
    bgColor: string;
    textColor: string;
    linkColor: string;
    headerColor: string;
    borderColor: string;
    accentColor: string;
    boxBg: string;
  }
> = {
  cyberpunk: {
    bgColor: "#0c0c14",
    textColor: "#d4d4e8",
    linkColor: "#5eead4",
    headerColor: "#7dd3fc",
    borderColor: "#334155",
    accentColor: "#38bdf8",
    boxBg: "#131320",
  },
  retro: {
    bgColor: "#141414",
    textColor: "#e8e6e1",
    linkColor: "#f0ab3c",
    headerColor: "#ffb347",
    borderColor: "#3d3529",
    accentColor: "#f4a460",
    boxBg: "#1c1c1c",
  },
  ocean: {
    bgColor: "#081c2e",
    textColor: "#c8e6f5",
    linkColor: "#67e8f9",
    headerColor: "#a5f3fc",
    borderColor: "#164e63",
    accentColor: "#22d3ee",
    boxBg: "#0f2538",
  },
  sunset: {
    bgColor: "#1e1510",
    textColor: "#f5dcc8",
    linkColor: "#fb923c",
    headerColor: "#fdba74",
    borderColor: "#4a2c1a",
    accentColor: "#f97316",
    boxBg: "#2a1e15",
  },
  matrix: {
    bgColor: "#0f1016",
    textColor: "#d1d5db",
    linkColor: "#a78bfa",
    headerColor: "#c4b5fd",
    borderColor: "#312e81",
    accentColor: "#8b5cf6",
    boxBg: "#16172b",
  },
  pink: {
    bgColor: "#1a1418",
    textColor: "#f0d5e0",
    linkColor: "#f472b6",
    headerColor: "#fbcfe8",
    borderColor: "#4a2035",
    accentColor: "#ec4899",
    boxBg: "#241a20",
  },
  synthwave: {
    bgColor: "#150d1f",
    textColor: "#e8d5f0",
    linkColor: "#e879f9",
    headerColor: "#f0abfc",
    borderColor: "#4c1d6b",
    accentColor: "#d946ef",
    boxBg: "#1e122e",
  },
  volcanic: {
    bgColor: "#1a1210",
    textColor: "#f0d8cc",
    linkColor: "#f87171",
    headerColor: "#fca5a5",
    borderColor: "#4a2520",
    accentColor: "#ef4444",
    boxBg: "#251a15",
  },
  gold: {
    bgColor: "#131210",
    textColor: "#f0e8d8",
    linkColor: "#fbbf24",
    headerColor: "#fcd34d",
    borderColor: "#3d3520",
    accentColor: "#f59e0b",
    boxBg: "#1c1912",
  },
  arctic: {
    bgColor: "#0f1720",
    textColor: "#d0e8f5",
    linkColor: "#7dd3fc",
    headerColor: "#bae6fd",
    borderColor: "#1e3a5f",
    accentColor: "#38bdf8",
    boxBg: "#152030",
  },
  emerald: {
    bgColor: "#0c1512",
    textColor: "#d0f0e0",
    linkColor: "#6ee7b7",
    headerColor: "#a7f3d0",
    borderColor: "#164e3a",
    accentColor: "#34d399",
    boxBg: "#131e18",
  },
  midnight: {
    bgColor: "#080a12",
    textColor: "#c7cee8",
    linkColor: "#60a5fa",
    headerColor: "#93c5fd",
    borderColor: "#1e293b",
    accentColor: "#3b82f6",
    boxBg: "#0f1220",
  },
  neon: {
    bgColor: "#0a0a0a",
    textColor: "#e0e0e0",
    linkColor: "#22d3ee",
    headerColor: "#67e8f9",
    borderColor: "#1a1a1a",
    accentColor: "#06b6d4",
    boxBg: "#141414",
  },
  blood: {
    bgColor: "#1a0f0f",
    textColor: "#f0d5d5",
    linkColor: "#f87171",
    headerColor: "#fca5a5",
    borderColor: "#3f1a1a",
    accentColor: "#dc2626",
    boxBg: "#241515",
  },
  cosmic: {
    bgColor: "#0f0e1a",
    textColor: "#d8d4f0",
    linkColor: "#a78bfa",
    headerColor: "#c4b5fd",
    borderColor: "#2e2a4a",
    accentColor: "#7c3aed",
    boxBg: "#16152a",
  },
  miami: {
    bgColor: "#0f1a1e",
    textColor: "#d0f0f5",
    linkColor: "#2dd4bf",
    headerColor: "#5eead4",
    borderColor: "#164e5a",
    accentColor: "#14b8a6",
    boxBg: "#15252a",
  },
  honeycomb: {
    bgColor: "#0d0a05",
    textColor: "#f5e6c8",
    linkColor: "#fbbf24",
    headerColor: "#fcd34d",
    borderColor: "#3d3220",
    accentColor: "#f59e0b",
    boxBg: "#1a1510",
  },
};

// Light mode variants — deep navy text for crisp daytime contrast
const lightSkins: Record<
  SkinPreset,
  {
    bgColor: string;
    textColor: string;
    linkColor: string;
    headerColor: string;
    borderColor: string;
    accentColor: string;
    boxBg: string;
  }
> = {
  cyberpunk: {
    bgColor: "#f5f5fa",
    textColor: "#1a1a2e",
    linkColor: "#0ea5e9",
    headerColor: "#0284c7",
    borderColor: "#d1d5db",
    accentColor: "#0ea5e9",
    boxBg: "#ffffff",
  },
  retro: {
    bgColor: "#faf9f6",
    textColor: "#1a1a2e",
    linkColor: "#d97706",
    headerColor: "#b45309",
    borderColor: "#e5e0d8",
    accentColor: "#f59e0b",
    boxBg: "#ffffff",
  },
  ocean: {
    bgColor: "#f0f9ff",
    textColor: "#1a1a2e",
    linkColor: "#0284c7",
    headerColor: "#0369a1",
    borderColor: "#bae6fd",
    accentColor: "#0ea5e9",
    boxBg: "#ffffff",
  },
  sunset: {
    bgColor: "#fffaf5",
    textColor: "#1a1a2e",
    linkColor: "#ea580c",
    headerColor: "#c2410c",
    borderColor: "#fed7aa",
    accentColor: "#f97316",
    boxBg: "#ffffff",
  },
  matrix: {
    bgColor: "#f8f8fc",
    textColor: "#1a1a2e",
    linkColor: "#6366f1",
    headerColor: "#4f46e5",
    borderColor: "#c7d2fe",
    accentColor: "#818cf8",
    boxBg: "#ffffff",
  },
  pink: {
    bgColor: "#fdf2f8",
    textColor: "#1a1a2e",
    linkColor: "#db2777",
    headerColor: "#be185d",
    borderColor: "#fbcfe8",
    accentColor: "#ec4899",
    boxBg: "#ffffff",
  },
  synthwave: {
    bgColor: "#faf5ff",
    textColor: "#1a1a2e",
    linkColor: "#a855f7",
    headerColor: "#7e22ce",
    borderColor: "#e9d5ff",
    accentColor: "#c084fc",
    boxBg: "#ffffff",
  },
  volcanic: {
    bgColor: "#fff5f5",
    textColor: "#1a1a2e",
    linkColor: "#dc2626",
    headerColor: "#b91c1c",
    borderColor: "#fecaca",
    accentColor: "#ef4444",
    boxBg: "#ffffff",
  },
  gold: {
    bgColor: "#fdfbf7",
    textColor: "#1a1a2e",
    linkColor: "#ca8a04",
    headerColor: "#a16207",
    borderColor: "#fde68a",
    accentColor: "#eab308",
    boxBg: "#ffffff",
  },
  arctic: {
    bgColor: "#f0f9ff",
    textColor: "#1a1a2e",
    linkColor: "#0284c7",
    headerColor: "#0369a1",
    borderColor: "#bae6fd",
    accentColor: "#38bdf8",
    boxBg: "#ffffff",
  },
  emerald: {
    bgColor: "#f0fdf4",
    textColor: "#1a1a2e",
    linkColor: "#059669",
    headerColor: "#047857",
    borderColor: "#a7f3d0",
    accentColor: "#34d399",
    boxBg: "#ffffff",
  },
  midnight: {
    bgColor: "#f5f6ff",
    textColor: "#1a1a2e",
    linkColor: "#4f46e5",
    headerColor: "#4338ca",
    borderColor: "#c7d2fe",
    accentColor: "#6366f1",
    boxBg: "#ffffff",
  },
  neon: {
    bgColor: "#fafafa",
    textColor: "#1a1a2e",
    linkColor: "#0891b2",
    headerColor: "#0e7490",
    borderColor: "#e5e5e5",
    accentColor: "#06b6d4",
    boxBg: "#ffffff",
  },
  blood: {
    bgColor: "#fef2f2",
    textColor: "#1a1a2e",
    linkColor: "#dc2626",
    headerColor: "#b91c1c",
    borderColor: "#fecaca",
    accentColor: "#ef4444",
    boxBg: "#ffffff",
  },
  cosmic: {
    bgColor: "#f5f3ff",
    textColor: "#1a1a2e",
    linkColor: "#7c3aed",
    headerColor: "#6d28d9",
    borderColor: "#ddd6fe",
    accentColor: "#8b5cf6",
    boxBg: "#ffffff",
  },
  miami: {
    bgColor: "#f0fdfa",
    textColor: "#1a1a2e",
    linkColor: "#0d9488",
    headerColor: "#0f766e",
    borderColor: "#ccfbf1",
    accentColor: "#14b8a6",
    boxBg: "#ffffff",
  },
  honeycomb: {
    bgColor: "#fefce8",
    textColor: "#1a1510",
    linkColor: "#d97706",
    headerColor: "#b45309",
    borderColor: "#fde68a",
    accentColor: "#f59e0b",
    boxBg: "#ffffff",
  },
};

// Accent color overrides
const accentOverrides: Record<
  AccentColor,
  { linkColor: string; headerColor: string; accentColor: string }
> = {
  "neon-green": {
    linkColor: "#22d3ee",
    headerColor: "#67e8f9",
    accentColor: "#06b6d4",
  },
  "hot-pink": {
    linkColor: "#f472b6",
    headerColor: "#fbcfe8",
    accentColor: "#ec4899",
  },
  "electric-blue": {
    linkColor: "#60a5fa",
    headerColor: "#93c5fd",
    accentColor: "#3b82f6",
  },
  "cyber-yellow": {
    linkColor: "#fbbf24",
    headerColor: "#fcd34d",
    accentColor: "#f59e0b",
  },
  "matrix-green": {
    linkColor: "#a78bfa",
    headerColor: "#c4b5fd",
    accentColor: "#8b5cf6",
  },
  "sunset-orange": {
    linkColor: "#fb923c",
    headerColor: "#fdba74",
    accentColor: "#f97316",
  },
  "ocean-blue": {
    linkColor: "#38bdf8",
    headerColor: "#7dd3fc",
    accentColor: "#0ea5e9",
  },
  "purple-haze": {
    linkColor: "#c084fc",
    headerColor: "#ddd6fe",
    accentColor: "#a855f7",
  },
};

// Default theme
const defaultTheme: Theme = {
  mode: "dark",
  skin: "volcanic",
  accent: "sunset-orange",
  backgroundMode: "constellation",
};

// Context
interface ThemeContextType {
  theme: Theme;
  resolvedColors: {
    bgColor: string;
    textColor: string;
    textMuted: string;
    linkColor: string;
    headerColor: string;
    borderColor: string;
    accentColor: string;
    boxBg: string;
    success: string;
    warning: string;
  };
  tokens: {
    background: string;
    surface: string;
    surfaceElevated: string;
    border: string;
    text: string;
    textMuted: string;
    textInverse: string;
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    danger: string;
    focus: string;
  };
  setMode: (mode: ThemeMode) => void;
  setSkin: (skin: SkinPreset) => void;
  setAccent: (accent: AccentColor) => void;
  setBackgroundMode: (mode: BackgroundMode) => void;
  setCustomColors: (colors: {
    bgColor?: string;
    textColor?: string;
    linkColor?: string;
    headerColor?: string;
    borderColor?: string;
    accentColor?: string;
    boxBg?: string;
  }) => void;
  resetTheme: () => void;
}

// Helper: produce a muted variant with safe contrast for small text.
// We lighten the base text color toward white so it never drops below ~4.5:1
// on the matching dark background.
function mixMuted(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#c4c4d4";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const mix = (v: number) => Math.round(v + (235 - v) * 0.45);
  const to2 = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const getResolvedColors = (t: Theme) => {
    // Get base skin based on mode
    const baseSkins = t.mode === "light" ? lightSkins : darkSkins;
    const skinColors = baseSkins[t.skin];

    // Apply custom colors if set
    const custom = t.customColors || {};

    // Apply accent override if not custom
    const accent = custom.accentColor ? null : accentOverrides[t.accent];

    return {
      bgColor: custom.bgColor || skinColors.bgColor,
      textColor: custom.textColor || skinColors.textColor,
      textMuted: mixMuted(custom.textColor || skinColors.textColor),
      linkColor: accent?.linkColor || custom.linkColor || skinColors.linkColor,
      headerColor:
        accent?.headerColor || custom.headerColor || skinColors.headerColor,
      borderColor: custom.borderColor || skinColors.borderColor,
      accentColor:
        accent?.accentColor || custom.accentColor || skinColors.accentColor,
      boxBg: custom.boxBg || skinColors.boxBg,
      success: "#25e08a",
      warning: "#ffb020",
    };
  };

  const resolvedColors = getResolvedColors(theme);
  const semanticTokens = {
    background: resolvedColors.bgColor,
    surface: resolvedColors.boxBg,
    surfaceElevated: resolvedColors.boxBg,
    border: resolvedColors.borderColor,
    text: resolvedColors.textColor,
    textMuted: resolvedColors.textMuted,
    textInverse: resolvedColors.bgColor,
    primary: resolvedColors.accentColor,
    secondary: resolvedColors.linkColor,
    success: resolvedColors.success,
    warning: resolvedColors.warning,
    danger: "#ef4444",
    focus: resolvedColors.accentColor,
  };
  const tokens = { ...resolvedColors, ...semanticTokens };

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Load stored theme after hydration to avoid server/client mismatch
  useEffect(() => {
    const stored = localStorage.getItem("litlabs-theme");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Theme;
      if (parsed && typeof parsed === "object") {
        setTheme((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore corrupted stored theme
    }
  }, []);

  // Apply CSS variables synchronously before the browser paints so the
  // ThemeContext palette takes effect immediately (and before any stored theme
  // is loaded). This is intentionally not gated by `mounted`.
  useIsomorphicLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const colors = getResolvedColors(theme);
    root.style.setProperty("--bg-color", colors.bgColor);
    root.style.setProperty("--text-color", colors.textColor);
    root.style.setProperty("--link-color", colors.linkColor);
    root.style.setProperty("--header-color", colors.headerColor);
    root.style.setProperty("--border-color", colors.borderColor);
    root.style.setProperty("--accent-color", colors.accentColor);
    root.style.setProperty("--box-bg", colors.boxBg);
    // Sync data-theme attribute so the :root[data-theme="light"]
    // overrides in globals.css activate for legacy CSS-only components.
    // Also handle the "system" mode by reading prefers-color-scheme.
    const isLight =
      theme.mode === "light" ||
      (theme.mode === "system" &&
        typeof window !== "undefined" &&
        !!window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches);
    if (isLight) {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
    // Keep the browser chrome (mobile address bar, splash) in sync.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", colors.bgColor);
    }
  }, [theme]);

  // Save to localStorage on change
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("litlabs-theme", JSON.stringify(theme));
    }
  }, [theme, mounted]);

  const setMode = (mode: ThemeMode) => {
    setTheme((prev) => ({ ...prev, mode }));
  };

  const setSkin = (skin: SkinPreset) => {
    setTheme((prev) => ({ ...prev, skin }));
  };

  const setAccent = (accent: AccentColor) => {
    setTheme((prev) => ({ ...prev, accent }));
  };

  const setBackgroundMode = (backgroundMode: BackgroundMode) => {
    setTheme((prev) => ({ ...prev, backgroundMode }));
  };

  const setCustomColors = (colors: {
    bgColor?: string;
    textColor?: string;
    linkColor?: string;
    headerColor?: string;
    borderColor?: string;
    accentColor?: string;
    boxBg?: string;
  }) => {
    setTheme((prev) => ({
      ...prev,
      customColors: { ...prev.customColors, ...colors },
    }));
  };

  const resetTheme = () => {
    setTheme(defaultTheme);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedColors,
        tokens,
        setMode,
        setSkin,
        setAccent,
        setBackgroundMode,
        setCustomColors,
        resetTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

export const ACCENT_MAP: Record<AccentColor, { hex: string }> = {
  "neon-green": { hex: "#06b6d4" },
  "hot-pink": { hex: "#ec4899" },
  "electric-blue": { hex: "#3b82f6" },
  "cyber-yellow": { hex: "#f59e0b" },
  "matrix-green": { hex: "#8b5cf6" },
  "sunset-orange": { hex: "#f97316" },
  "ocean-blue": { hex: "#0ea5e9" },
  "purple-haze": { hex: "#a855f7" },
};

export { darkSkins, lightSkins, accentOverrides };

/* ------------------------------------------------------------------ */
/*  Global CRT Toggle — single source of truth for scanline overlay    */
/* ------------------------------------------------------------------ */
export function useCrtToggle() {
  const [crtEnabled, setCrtEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const val = localStorage.getItem("crt_global_scanlines");
    return val === null ? true : val === "true";
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggleCrt = useCallback(
    (next?: boolean) => {
      const nextVal = next !== undefined ? next : !crtEnabled;
      setCrtEnabled(nextVal);
      localStorage.setItem("crt_global_scanlines", String(nextVal));
    },
    [crtEnabled],
  );

  return { crtEnabled: hydrated ? crtEnabled : true, toggleCrt };
}
