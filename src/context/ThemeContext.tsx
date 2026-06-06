"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

// Skin presets
export type SkinPreset = "cyberpunk" | "retro" | "ocean" | "sunset" | "matrix" | "pink";

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
    textColor: "#00ff41",
    linkColor: "#ff0080",
    headerColor: "#00ffff",
    borderColor: "#ff00ff",
    accentColor: "#ffff00",
    boxBg: "#1a0a2e",
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
    textColor: "#00ff00",
    linkColor: "#00cc00",
    headerColor: "#008800",
    borderColor: "#00ff00",
    accentColor: "#00aa00",
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
};

// Accent color overrides
const accentOverrides: Record<AccentColor, { linkColor: string; headerColor: string; accentColor: string }> = {
  "neon-green": { linkColor: "#00ff41", headerColor: "#00ff41", accentColor: "#00ff41" },
  "hot-pink": { linkColor: "#ff0080", headerColor: "#ff0080", accentColor: "#ff1493" },
  "electric-blue": { linkColor: "#00aaff", headerColor: "#00aaff", accentColor: "#00ffff" },
  "cyber-yellow": { linkColor: "#ffff00", headerColor: "#ffff00", accentColor: "#ffcc00" },
  "matrix-green": { linkColor: "#00ff00", headerColor: "#00ff00", accentColor: "#88ff88" },
  "sunset-orange": { linkColor: "#ff6b35", headerColor: "#ff6b35", accentColor: "#ff9500" },
  "ocean-blue": { linkColor: "#0088cc", headerColor: "#0088cc", accentColor: "#00bbff" },
  "purple-haze": { linkColor: "#aa00ff", headerColor: "#aa00ff", accentColor: "#dd44ff" },
};

// Default theme
const defaultTheme: Theme = {
  mode: "dark",
  skin: "cyberpunk",
  accent: "neon-green",
};

// Context
interface ThemeContextType {
  theme: Theme;
  resolvedColors: { bgColor: string; textColor: string; textMuted: string; linkColor: string; headerColor: string; borderColor: string; accentColor: string; boxBg: string; success: string; warning: string };
  setMode: (mode: ThemeMode) => void;
  setSkin: (skin: SkinPreset) => void;
  setAccent: (accent: AccentColor) => void;
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

export { darkSkins, lightSkins, accentOverrides };