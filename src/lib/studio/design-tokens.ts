/**
 * LiTTree Design Tokens — Tailwind class mappings for the Studio design system.
 *
 * Vibe: Premium, Creative, Futuristic, Dark Mode default.
 * Colors: Deep atmospheric dark + Primary Purple + Neon Cyan accents.
 * Surfaces: Glassmorphism with subtle borders.
 */

export const studioTokens = {
  // Backgrounds
  bg: {
    base: "bg-[#07050a]",
    surface: "bg-[#0d0a12]",
    elevated: "bg-[#13101a]",
    hover: "hover:bg-white/[0.03]",
  },
  // Borders
  border: {
    subtle: "border-white/5",
    default: "border-white/10",
    accent: "border-[#8b5cf6]/30",
  },
  // Text
  text: {
    primary: "text-white",
    secondary: "text-white/60",
    tertiary: "text-white/40",
    accent: "text-[#8b5cf6]",
    neon: "text-[#25f4ff]",
  },
  // Accents
  accent: {
    purple: "#8b5cf6",
    neon: "#25f4ff",
    green: "#39ff14",
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
    info: "#3b82f6",
  },
  // Surfaces (glassmorphism)
  surface: {
    glass: "bg-white/[0.02] backdrop-blur-xl border border-white/5",
    glassHover: "bg-white/[0.04] backdrop-blur-xl border border-white/10",
    glassElevated: "bg-white/[0.06] backdrop-blur-2xl border border-white/10",
  },
  // Typography
  font: {
    display: "font-sans",
    ui: "font-sans",
    mono: "font-mono",
  },
  // Z-index hierarchy
  z: {
    canvas: 10,
    dock: 20,
    inspector: 30,
    panels: 40,
    modals: 50,
    commandBar: 100,
    tooltips: 200,
  },
  // Sizing
  topBar: "h-16",
  leftRailMin: "min-w-[240px]",
  rightPanelMin: "min-w-[320px]",
  bottomDockMin: "min-h-[200px]",
} as const;

export type StudioTokens = typeof studioTokens;
