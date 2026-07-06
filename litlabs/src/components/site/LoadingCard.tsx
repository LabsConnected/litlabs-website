"use client";

import { useTheme } from "@/context/ThemeContext";

export function LoadingCard() {
  const { resolvedColors: T } = useTheme();

  return (
    <div
      className="flex h-32 items-center justify-center rounded-2xl border"
      style={{
        backgroundColor: `${T.borderColor}10`,
        borderColor: `${T.borderColor}20`,
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: T.accentColor, borderTopColor: "transparent" }}
        />
        <span className="text-xs" style={{ color: T.textMuted }}>
          Loading...
        </span>
      </div>
    </div>
  );
}
