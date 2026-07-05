"use client";

import { useTheme } from "@/context/ThemeContext";

interface PlatformTabsProps {
  selected: string | "all";
  onChange: (platform: string) => void;
  counts?: Record<string, number>;
}

const PLATFORMS = [
  "Facebook",
  "Instagram",
  "LinkedIn",
  "X",
  "TikTok",
  "Reddit",
  "Bluesky",
];

export default function PlatformTabs({
  selected,
  onChange,
  counts = {},
}: PlatformTabsProps) {
  const { resolvedColors: T } = useTheme();
  const tabs = ["all", ...PLATFORMS];

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-1"
      style={{ scrollbarColor: `${T.borderColor}40 transparent` }}
    >
      {tabs.map((platform) => {
        const active = selected.toLowerCase() === platform.toLowerCase();
        const count = counts[platform.toLowerCase()] ?? 0;
        return (
          <button
            key={platform}
            onClick={() => onChange(platform)}
            className="relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap"
            style={{
              backgroundColor: active ? `${T.accentColor}18` : `${T.boxBg}80`,
              color: active ? T.accentColor : T.textMuted,
              border: `1px solid ${active ? T.accentColor + "40" : T.borderColor + "30"}`,
            }}
          >
            {platform === "all" ? "All" : platform}
            {count > 0 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: active
                    ? T.accentColor
                    : T.borderColor + "40",
                  color: active ? T.bgColor : T.textMuted,
                }}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
