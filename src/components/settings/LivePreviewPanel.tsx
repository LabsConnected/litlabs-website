"use client";

import { useTheme, type LayoutStyle } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { getWallpaperById } from "@/lib/wallpapers";
import { Check } from "lucide-react";

const LAYOUT_LABELS: Record<LayoutStyle, string> = {
  classic: "Classic",
  glass: "Glass",
  honeycomb: "Honeycomb",
  minimal: "Minimal",
  terminal: "Terminal",
  arcade: "Arcade",
};

export function LivePreviewPanel() {
  const { theme, resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const wallpaper = getWallpaperById(profile.wallpaper);
  const isCustom = profile.wallpaper === "custom" && profile.customWallpaperUrl;

  const isHoneycomb = theme.layoutStyle === "honeycomb";
  const isGlass = theme.layoutStyle === "glass";
  const isMinimal = theme.layoutStyle === "minimal";
  const isTerminal = theme.layoutStyle === "terminal";
  const isArcade = theme.layoutStyle === "arcade";

  const cardRadius = isHoneycomb ? "rounded-2xl" : isTerminal ? "rounded-md" : "rounded-xl";
  const cardBorder = isGlass ? "border-white/10 backdrop-blur-sm" : isTerminal ? "border-green-500/20" : "border-white/8";
  const cardBg = isGlass ? "bg-white/5" : isTerminal ? "bg-black/50" : "bg-white/3";

  const honeycombBg = isHoneycomb
    ? "repeating-conic-gradient(from 30deg at 50% 50%, rgba(245,158,11,0.04) 0deg 60deg, transparent 60deg 120deg)"
    : undefined;

  return (
    <div className="sticky top-8 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black text-white/90">Live Preview</h3>
        <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-bold text-white/50">
          {LAYOUT_LABELS[theme.layoutStyle]}
        </span>
      </div>

      {/* Preview frame */}
      <div
        className="relative overflow-hidden rounded-2xl border border-white/8"
        style={{
          backgroundColor: T.bgColor,
          backgroundImage: isCustom
            ? `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(${profile.customWallpaperUrl})`
            : wallpaper.fullStyle.backgroundImage as string || undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Honeycomb pattern overlay */}
        {honeycombBg && (
          <div className="absolute inset-0 opacity-40" style={{ background: honeycombBg }} />
        )}

        <div className="relative p-4 space-y-3" style={{ minHeight: 320 }}>
          {/* Sample top bar */}
          <div
            className={`flex items-center justify-between ${cardRadius} border ${cardBorder} ${cardBg} px-3 py-2`}
          >
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-md" style={{ backgroundColor: T.accentColor, opacity: 0.8 }} />
              <span className="text-xs font-bold" style={{ color: T.headerColor }}>LiTTree OS</span>
            </div>
            <div className="flex gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: T.accentColor, opacity: 0.5 }} />
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: T.accentColor, opacity: 0.3 }} />
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: T.accentColor, opacity: 0.2 }} />
            </div>
          </div>

          {/* Sample sidebar + content */}
          <div className="flex gap-3">
            {/* Sidebar */}
            <div className={`w-16 shrink-0 space-y-2 ${cardRadius} border ${cardBorder} ${cardBg} p-2`}>
              <div className="h-2 w-full rounded-full" style={{ backgroundColor: T.accentColor, opacity: 0.4 }} />
              <div className="h-2 w-full rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)" }} />
              <div className="h-2 w-full rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
              <div className="h-2 w-2/3 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 space-y-2">
              {/* Sample card */}
              <div className={`${cardRadius} border ${cardBorder} ${cardBg} p-3`}>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-6 w-6 rounded-lg" style={{ backgroundColor: T.accentColor, opacity: 0.15 }}>
                    <div className="flex h-full items-center justify-center">
                      <Check size={12} style={{ color: T.accentColor }} />
                    </div>
                  </div>
                  <span className="text-xs font-bold" style={{ color: T.textColor }}>Sample Card</span>
                </div>
                <p className="text-[10px] leading-4" style={{ color: T.textMuted }}>
                  This is how your cards will look with the current theme and layout.
                </p>
              </div>

              {/* Sample button + badge */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`${cardRadius} border px-3 py-1.5 text-[10px] font-bold transition-all`}
                  style={{
                    borderColor: `${T.accentColor}40`,
                    backgroundColor: `${T.accentColor}10`,
                    color: T.accentColor,
                  }}
                >
                  Action Button
                </button>
                <span
                  className={`${cardRadius} px-2 py-1 text-[9px] font-bold`}
                  style={{
                    backgroundColor: `${T.accentColor}15`,
                    color: T.accentColor,
                  }}
                >
                  Active
                </span>
              </div>

              {/* Sample text lines */}
              <div className="space-y-1.5 pt-1">
                <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />
                <div className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
                <div className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.04)" }} />
              </div>
            </div>
          </div>

          {/* Layout-specific decoration */}
          {isArcade && (
            <div className="flex gap-1 pt-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-1 flex-1 rounded-full" style={{ backgroundColor: T.accentColor, opacity: 0.2 + i * 0.1 }} />
              ))}
            </div>
          )}
          {isTerminal && (
            <div className="font-mono text-[9px]" style={{ color: `${T.accentColor}80` }}>
              $ litt --status: ready
            </div>
          )}
          {isMinimal && <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.04)" }} />}
        </div>
      </div>

      {/* Current settings summary */}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
          <span className="text-white/40">Skin</span>
          <div className="font-bold capitalize text-white/70">{theme.skin}</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
          <span className="text-white/40">Accent</span>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: T.accentColor }} />
            <span className="font-bold text-white/70">{theme.accent.replace(/-/g, " ")}</span>
          </div>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
          <span className="text-white/40">Mode</span>
          <div className="font-bold capitalize text-white/70">{theme.mode}</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
          <span className="text-white/40">Background</span>
          <div className="font-bold capitalize text-white/70">{theme.backgroundMode}</div>
        </div>
      </div>
    </div>
  );
}
