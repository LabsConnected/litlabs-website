"use client";

import { useTheme } from "@/context/ThemeContext";

export default function ColorByNumberTool() {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6"
      style={{ color: T.textColor }}
    >
      <p className="text-sm" style={{ color: T.textMuted }}>
        Color by Number — coming soon
      </p>
    </div>
  );
}
