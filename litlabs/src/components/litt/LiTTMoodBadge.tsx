"use client";

import { LiTTMood } from "@/lib/ai/litt-router";
import { LITT, LITT_MOOD_COLORS } from "./litt-theme";

const MOOD_LABELS: Record<LiTTMood, string> = {
  happy: "Happy",
  excited: "Excited",
  focused: "Focused",
  thinking: "Thinking",
  wink: "Wink",
  cheeky: "Cheeky",
  love: "Love",
  surprised: "Surprised",
  sleepy: "Sleepy",
};

interface LiTTMoodBadgeProps {
  mood: LiTTMood;
}

export function LiTTMoodBadge({ mood }: LiTTMoodBadgeProps) {
  const { color, glow } = LITT_MOOD_COLORS[mood] ?? LITT_MOOD_COLORS.happy;
  return (
    <span
      style={{
        color,
        backgroundColor: `${color}20`,
        border: `1px solid ${color}`,
        fontFamily: LITT.fontMono,
        boxShadow: `0 0 12px ${glow}`,
      }}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      {MOOD_LABELS[mood]}
    </span>
  );
}
