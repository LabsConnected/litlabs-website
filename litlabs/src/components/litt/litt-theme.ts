/** LiTT mascot visual theme — pulled from the official mascot sheet. */

export const LITT = {
  bg: "#08080c",
  bgSecondary: "#0c0c14",
  bgPanel: "#0f0f14",
  bgPanelHover: "#15151c",
  border: "#252538",
  borderSubtle: "#1a1a24",
  neonGreen: "#a3f546",
  neonGreenDim: "#6fc926",
  neonGreenGlow: "rgba(163,245,70,0.35)",
  accentCyan: "#a3f546",
  accentOrange: "#ff9f43",
  success: "#22c55e",
  danger: "#ef4444",
  white: "#f5f5f7",
  gray: "#8b8b9e",
  dim: "#5a5a6e",
  textDim: "#5a5a6e",
  text: "#f8fafc",
  textMuted: "#a1a1b3",
  fontMono: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
} as const;

export const LITT_SHADOW = {
  glowGreen: "0 0 32px rgba(163,245,70,0.25)",
  panel: "0 0 0 1px rgba(37,37,56,0.6), 0 12px 48px rgba(0,0,0,0.4)",
} as const;

export const LITT_MOOD_COLORS: Record<
  import("@/lib/ai/litt-router").LiTTMood,
  { color: string; glow: string }
> = {
  happy: { color: "#a3f546", glow: "rgba(163,245,70,0.45)" },
  excited: { color: "#f5e946", glow: "rgba(245,233,70,0.45)" },
  focused: { color: "#46d1f5", glow: "rgba(70,209,245,0.45)" },
  thinking: { color: "#8b8b9e", glow: "rgba(139,139,158,0.35)" },
  wink: { color: "#e879f9", glow: "rgba(232,121,249,0.45)" },
  cheeky: { color: "#ff9f43", glow: "rgba(255,159,67,0.45)" },
  love: { color: "#ff6b8a", glow: "rgba(255,107,138,0.45)" },
  surprised: { color: "#46d1f5", glow: "rgba(70,209,245,0.45)" },
  sleepy: { color: "#a78bfa", glow: "rgba(167,139,250,0.35)" },
};
