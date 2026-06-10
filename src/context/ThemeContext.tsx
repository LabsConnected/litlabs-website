"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import type { BackgroundMode } from "@/components/AnimatedBackground";

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
  | "miami";

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
const darkSkins: Record<SkinPreset, { bgColor: string; textColor: string; linkColor: string; headerColor: string; borderColor: string; accentColor: string; boxBg: string }> = {
  cyberpunk: {
    bgColor: "#0a0a0f",
    textColor: "#c8e6c9",
    linkColor: "#00d4ff",
    headerColor: "#00e5ff",
    borderColor: "#d946ef",
    accentColor: "#fbbf24",
    boxBg: "#0f172a",
  },
  retro: {
    bgColor: "#000000",
    textColor: "#ffffff",
    linkColor: "#00ff00",
    headerColor: "#ff00ff",
    borderColor: "#ff0099",
    accentColor: "#00ffff",
    boxBg: "#1a1a1a",
  },
  ocean: {
    bgColor: "#001f3f",
    textColor: "#7FDBFF",
    linkColor: "#39CCCC",
    headerColor: "#01FF70",
    borderColor: "#2ECC40",
    accentColor: "#FFDC00",
    boxBg: "#003366",
  },
  sunset: {
    bgColor: "#2c1810",
    textColor: "#ffd4a3",
    linkColor: "#ff6b6b",
    headerColor: "#ff8c42",
    borderColor: "#ff4757",
    accentColor: "#ffa502",
    boxBg: "#3d2418",
  },
  matrix: {
    bgColor: "#000000",
    textColor: "#86efac",
    linkColor: "#22c55e",
    headerColor: "#16a34a",
    borderColor: "#15803d",
    accentColor: "#4ade80",
    boxBg: "#0a1a0a",
  },
  pink: {
    bgColor: "#2d1b2e",
    textColor: "#ffb6c1",
    linkColor: "#ff69b4",
    headerColor: "#ff1493",
    borderColor: "#ff69b4",
    accentColor: "#ff9ff3",
    boxBg: "#3d2440",
  },
  synthwave: {
    bgColor: "#1a0b2e",
    textColor: "#f5d0fe",
    linkColor: "#ff2e97",
    headerColor: "#00e5ff",
    borderColor: "#9d4edd",
    accentColor: "#ffb800",
    boxBg: "#2a1245",
  },
  volcanic: {
    bgColor: "#1a0a06",
    textColor: "#ffd9c0",
    linkColor: "#ff5722",
    headerColor: "#ff9100",
    borderColor: "#e64a19",
    accentColor: "#ffc400",
    boxBg: "#2b1109",
  },
  gold: {
    bgColor: "#0d0d0d",
    textColor: "#f5e6c8",
    linkColor: "#ffd700",
    headerColor: "#ffcc33",
    borderColor: "#bfa14a",
    accentColor: "#fff3b0",
    boxBg: "#1a1710",
  },
  arctic: {
    bgColor: "#0a1620",
    textColor: "#d6f5ff",
    linkColor: "#38bdf8",
    headerColor: "#7dd3fc",
    borderColor: "#0ea5e9",
    accentColor: "#e0f2fe",
    boxBg: "#0f2233",
  },
  emerald: {
    bgColor: "#04140d",
    textColor: "#c8f7dd",
    linkColor: "#10b981",
    headerColor: "#34d399",
    borderColor: "#059669",
    accentColor: "#6ee7b7",
    boxBg: "#0a2419",
  },
  midnight: {
    bgColor: "#070a16",
    textColor: "#c7d2fe",
    linkColor: "#818cf8",
    headerColor: "#a5b4fc",
    borderColor: "#4f46e5",
    accentColor: "#e0e7ff",
    boxBg: "#10142a",
  },
  neon: {
    bgColor: "#000000",
    textColor: "#e0e0e0",
    linkColor: "#ff00ff",
    headerColor: "#22c55e",
    borderColor: "#ff00ff",
    accentColor: "#00ffff",
    boxBg: "#0a0a0a",
  },
  blood: {
    bgColor: "#1a0505",
    textColor: "#ffcccc",
    linkColor: "#ff3333",
    headerColor: "#ff0000",
    borderColor: "#660000",
    accentColor: "#ff4444",
    boxBg: "#2a0a0a",
  },
  cosmic: {
    bgColor: "#0a0a1e",
    textColor: "#e0e0ff",
    linkColor: "#b084ff",
    headerColor: "#00d4ff",
    borderColor: "#6b4c9a",
    accentColor: "#ff6b9d",
    boxBg: "#141430",
  },
  miami: {
    bgColor: "#1a0a2e",
    textColor: "#ffd4e5",
    linkColor: "#ff2d95",
    headerColor: "#00f5ff",
    borderColor: "#ff2d95",
    accentColor: "#00f5ff",
    boxBg: "#2a1245",
  },
};

// Light mode variants
const lightSkins: Record<SkinPreset, { bgColor: string; textColor: string; linkColor: string; headerColor: string; borderColor: string; accentColor: string; boxBg: string }> = {
  cyberpunk: {
    bgColor: "#f0f0ff",
    textColor: "#1a1a2e",
    linkColor: "#ff0080",
    headerColor: "#0066ff",
    borderColor: "#6600cc",
    accentColor: "#ff00ff",
    boxBg: "#ffffff",
  },
  retro: {
    bgColor: "#ffffff",
    textColor: "#1a1a1a",
    linkColor: "#0088ff",
    headerColor: "#ff0088",
    borderColor: "#ff00aa",
    accentColor: "#00aaff",
    boxBg: "#f5f5f5",
  },
  ocean: {
    bgColor: "#f0f8ff",
    textColor: "#003366",
    linkColor: "#0077be",
    headerColor: "#005500",
    borderColor: "#008855",
    accentColor: "#ffaa00",
    boxBg: "#ffffff",
  },
  sunset: {
    bgColor: "#fff5ee",
    textColor: "#5c3a21",
    linkColor: "#e64a19",
    headerColor: "#d84315",
    borderColor: "#bf360c",
    accentColor: "#ff6f00",
    boxBg: "#ffffff",
  },
  matrix: {
    bgColor: "#f5f5f5",
    textColor: "#1a3a1a",
    linkColor: "#00aa00",
    headerColor: "#006600",
    borderColor: "#00aa00",
    accentColor: "#00ff00",
    boxBg: "#ffffff",
  },
  pink: {
    bgColor: "#fff0f5",
    textColor: "#4a2040",
    linkColor: "#e91e8c",
    headerColor: "#c2185b",
    borderColor: "#e91e8c",
    accentColor: "#ff4081",
    boxBg: "#ffffff",
  },
  synthwave: {
    bgColor: "#fdf2ff",
    textColor: "#4a1d6e",
    linkColor: "#d6217f",
    headerColor: "#0891b2",
    borderColor: "#9d4edd",
    accentColor: "#d97706",
    boxBg: "#ffffff",
  },
  volcanic: {
    bgColor: "#fff5f0",
    textColor: "#5c1e0a",
    linkColor: "#e64a19",
    headerColor: "#d84315",
    borderColor: "#bf360c",
    accentColor: "#f57f17",
    boxBg: "#ffffff",
  },
  gold: {
    bgColor: "#fffdf5",
    textColor: "#3d3416",
    linkColor: "#b8860b",
    headerColor: "#9a7209",
    borderColor: "#bfa14a",
    accentColor: "#d4af37",
    boxBg: "#ffffff",
  },
  arctic: {
    bgColor: "#f0f9ff",
    textColor: "#0c4a6e",
    linkColor: "#0284c7",
    headerColor: "#0369a1",
    borderColor: "#0ea5e9",
    accentColor: "#38bdf8",
    boxBg: "#ffffff",
  },
  emerald: {
    bgColor: "#f0fdf4",
    textColor: "#064e3b",
    linkColor: "#059669",
    headerColor: "#047857",
    borderColor: "#10b981",
    accentColor: "#34d399",
    boxBg: "#ffffff",
  },
  midnight: {
    bgColor: "#f5f6ff",
    textColor: "#1e1b4b",
    linkColor: "#4f46e5",
    headerColor: "#4338ca",
    borderColor: "#6366f1",
    accentColor: "#818cf8",
    boxBg: "#ffffff",
  },
  neon: {
    bgColor: "#ffffff",
    textColor: "#1a1a1a",
    linkColor: "#cc00cc",
    headerColor: "#009900",
    borderColor: "#ff00ff",
    accentColor: "#00cccc",
    boxBg: "#f5f5f5",
  },
  blood: {
    bgColor: "#fff5f5",
    textColor: "#5c1e1e",
    linkColor: "#cc0000",
    headerColor: "#990000",
    borderColor: "#ff9999",
    accentColor: "#ff4444",
    boxBg: "#ffffff",
  },
  cosmic: {
    bgColor: "#f0f0ff",
    textColor: "#2a1a5c",
    linkColor: "#7c3aed",
    headerColor: "#0891b2",
    borderColor: "#a78bfa",
    accentColor: "#ec4899",
    boxBg: "#ffffff",
  },
  miami: {
    bgColor: "#fff0f5",
    textColor: "#4a1d3e",
    linkColor: "#d946ef",
    headerColor: "#0891b2",
    borderColor: "#f472b6",
    accentColor: "#22d3ee",
    boxBg: "#ffffff",
  },
};

// Accent color overrides
const accentOverrides: Record<AccentColor, { linkColor: string; headerColor: string; accentColor: string }> = {
  "neon-green": { linkColor: "#22c55e", headerColor: "#22c55e", accentColor: "#34d399" },
  "hot-pink": { linkColor: "#ff0080", headerColor: "#ff0080", accentColor: "#ff1493" },
  "electric-blue": { linkColor: "#00aaff", headerColor: "#00aaff", accentColor: "#00ffff" },
  "cyber-yellow": { linkColor: "#ffff00", headerColor: "#ffff00", accentColor: "#ffcc00" },
  "matrix-green": { linkColor: "#10b981", headerColor: "#10b981", accentColor: "#6ee7b7" },
  "sunset-orange": { linkColor: "#ff6b35", headerColor: "#ff6b35", accentColor: "#ff9500" },
  "ocean-blue": { linkColor: "#0088cc", headerColor: "#0088cc", accentColor: "#00bbff" },
  "purple-haze": { linkColor: "#aa00ff", headerColor: "#aa00ff", accentColor: "#dd44ff" },
};

// Default theme
const defaultTheme: Theme = {
  mode: "dark",
  skin: "cyberpunk",
  accent: "electric-blue",
  backgroundMode: "constellation",
};

// Context
interface ThemeContextType {
  theme: Theme;
  resolvedColors: { bgColor: string; textColor: string; textMuted: string; linkColor: string; headerColor: string; borderColor: string; accentColor: string; boxBg: string; success: string; warning: string };
  setMode: (mode: ThemeMode) => void;
  setSkin: (skin: SkinPreset) => void;
  setAccent: (accent: AccentColor) => void;
  setBackgroundMode: (mode: BackgroundMode) => void;
  setCustomColors: (colors: { bgColor?: string; textColor?: string; linkColor?: string; headerColor?: string; borderColor?: string; accentColor?: string; boxBg?: string }) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("litlabs-theme");
    if (stored) {
      try {
        setTheme(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse theme", e);
      }
    }
    setMounted(true);
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("litlabs-theme", JSON.stringify(theme));
      // Apply CSS variables
      const root = document.documentElement;
      const colors = getResolvedColors(theme);
      root.style.setProperty("--bg-color", colors.bgColor);
      root.style.setProperty("--text-color", colors.textColor);
      root.style.setProperty("--link-color", colors.linkColor);
      root.style.setProperty("--header-color", colors.headerColor);
      root.style.setProperty("--border-color", colors.borderColor);
      root.style.setProperty("--accent-color", colors.accentColor);
      root.style.setProperty("--box-bg", colors.boxBg);
    }
  }, [theme, mounted]);

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
      textMuted: "#8a8aa3",
      linkColor: accent?.linkColor || custom.linkColor || skinColors.linkColor,
      headerColor: accent?.headerColor || custom.headerColor || skinColors.headerColor,
      borderColor: custom.borderColor || skinColors.borderColor,
      accentColor: accent?.accentColor || custom.accentColor || skinColors.accentColor,
      boxBg: custom.boxBg || skinColors.boxBg,
      success: "#25e08a",
      warning: "#ffb020",
    };
  };

  const resolvedColors = getResolvedColors(theme);

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

  const setCustomColors = (colors: { bgColor?: string; textColor?: string; linkColor?: string; headerColor?: string; borderColor?: string; accentColor?: string; boxBg?: string }) => {
    setTheme((prev) => ({ ...prev, customColors: { ...prev.customColors, ...colors } }));
  };

  const resetTheme = () => {
    setTheme(defaultTheme);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedColors,
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
  "neon-green": { hex: "#00ff41" },
  "hot-pink": { hex: "#ff0080" },
  "electric-blue": { hex: "#00ffff" },
  "cyber-yellow": { hex: "#ffff00" },
  "matrix-green": { hex: "#00ff00" },
  "sunset-orange": { hex: "#ff6b35" },
  "ocean-blue": { hex: "#0088cc" },
  "purple-haze": { hex: "#aa00ff" },
};

export { darkSkins, lightSkins, accentOverrides };

/* ------------------------------------------------------------------ */
/*  Global CRT Toggle — single source of truth for scanline overlay    */
/* ------------------------------------------------------------------ */
export function useCrtToggle() {
  const [crtEnabled, setCrtEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const val = localStorage.getItem("crt_global_scanlines");
    setCrtEnabled(val === null ? true : val === "true");
    setHydrated(true);
  }, []);

  const toggleCrt = useCallback((next?: boolean) => {
    const nextVal = next !== undefined ? next : !crtEnabled;
    setCrtEnabled(nextVal);
    localStorage.setItem("crt_global_scanlines", String(nextVal));
  }, [crtEnabled]);

  return { crtEnabled: hydrated ? crtEnabled : true, toggleCrt };
}