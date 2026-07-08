"use client";

import { useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";

function hexToRgb(hex: string) {
  const sanitized = hex.replace("#", "");
  const full =
    sanitized.length === 3
      ? sanitized
          .split("")
          .map((c) => c + c)
          .join("")
      : sanitized;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith("#")) {
    const { r, g, b } = hexToRgb(color);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (match) {
    return `rgba(${match[1]},${match[2]},${match[3]},${alpha})`;
  }
  return color;
}

function adjust(color: string, amount: number) {
  const { r, g, b } = hexToRgb(color);
  const clamp = (v: number) => Math.max(0, Math.min(255, v + amount));
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(clamp(r))}${toHex(clamp(g))}${toHex(clamp(b))}`;
}

export function useLitConsoleTheme() {
  const { resolvedColors } = useTheme();
  const {
    bgColor,
    boxBg,
    borderColor,
    accentColor,
    textColor,
    linkColor,
  } = resolvedColors;

  return useMemo(
    () => ({
      bg: bgColor,
      bgSecondary: adjust(boxBg, -12),
      bgPanel: boxBg,
      bgPanelHover: adjust(boxBg, 10),
      border: borderColor,
      borderSubtle: withAlpha(borderColor, 0.5),
      accentCyan: accentColor,
      accentOrange: "#ff7a1a",
      accentPurple: "#a855f7",
      success: "#22c55e",
      danger: "#ef4444",
      warning: "#f59e0b",
      text: textColor,
      textMuted: withAlpha(textColor, 0.65),
      textDim: withAlpha(textColor, 0.45),
      linkColor,
      fontMono: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      shadows: {
        panel: "0 0 0 1px rgba(37,37,56,0.6), 0 12px 48px rgba(0,0,0,0.4)",
        glowCyan: `0 0 24px ${withAlpha(accentColor, 0.18)}`,
        glowOrange: `0 0 24px ${withAlpha("#ff7a1a", 0.18)}`,
      },
    }),
    [bgColor, boxBg, borderColor, accentColor, textColor, linkColor]
  );
}
