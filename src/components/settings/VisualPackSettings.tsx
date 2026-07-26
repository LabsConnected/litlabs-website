"use client";

import { useTheme, VISUAL_PACKS, type VisualPack } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import type { WallpaperId } from "@/lib/wallpapers";
import { Check } from "lucide-react";
import { useState, useCallback } from "react";

const PACK_PREVIEWS: Record<string, string> = {
  "honeycomb-core": "radial-gradient(ellipse at 50% 50%, #fbbf2415 0%, transparent 60%), radial-gradient(ellipse at 20% 80%, #f59e0b12 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, #d9770612 0%, transparent 50%), linear-gradient(180deg, #0d0a05 0%, #1a1510 100%)",
  "littree-forest": "radial-gradient(ellipse at 80% 80%, #22c55e20 0%, transparent 50%), radial-gradient(ellipse at 20% 20%, #16a34a20 0%, transparent 50%), linear-gradient(180deg, #0a1f0a 0%, #1a2f1a 50%, #0d1a0d 100%)",
  "cyber-lab": "repeating-linear-gradient(0deg, transparent, transparent 60px, #ff00ff08 60px, #ff00ff08 61px), repeating-linear-gradient(90deg, transparent, transparent 60px, #00ffff08 60px, #00ffff08 61px), linear-gradient(180deg, #1a0a1a 0%, #0d1a2e 50%, #0a0f1a 100%)",
  "retro-arcade": "radial-gradient(ellipse at 20% 80%, #fb923c40 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, #f472b640 0%, transparent 50%), linear-gradient(135deg, #2d1a12 0%, #4a2510 30%, #7c2d12 60%, #c2410c 100%)",
  "midnight-os": "linear-gradient(180deg, #080a12 0%, #0f1220 100%)",
  "terminal-pro": "linear-gradient(180deg, #001a00 0%, #000a00 100%)",
  "holo-command": "radial-gradient(circle at 72% 20%, #a855f735, transparent 36%), linear-gradient(145deg, #060914, #17102b 58%, #070914)",
  "cosmic-creator": "radial-gradient(circle at 25% 75%, #ec489940, transparent 38%), radial-gradient(circle at 75% 20%, #8b5cf640, transparent 38%), #080612",
  "arctic-focus": "radial-gradient(circle at 75% 10%, #38bdf825, transparent 42%), linear-gradient(160deg, #07131d, #0c2230)",
  "miami-night": "linear-gradient(155deg, #1a0828, #29103d 48%, #08213a), repeating-linear-gradient(90deg, transparent 0 28px, #ec489912 29px)",
};

function packMatchesTheme(pack: VisualPack, theme: ReturnType<typeof useTheme>["theme"]): boolean {
  return (
    pack.themeMode === theme.mode &&
    pack.skin === theme.skin &&
    pack.accent === theme.accent &&
    pack.backgroundMode === theme.backgroundMode &&
    pack.layoutStyle === theme.layoutStyle
  );
}

export function VisualPackSettings() {
  const { theme, applyVisualPack } = useTheme();
  const { updateProfile } = useProfile();
  const [previewing, setPreviewing] = useState<string | null>(null);

  const handleApply = useCallback((pack: VisualPack) => {
    applyVisualPack(pack.id);
    if (pack.wallpaperId) {
      updateProfile({
        wallpaper: pack.wallpaperId as WallpaperId,
        wallpaperOverlay: pack.overlayOpacity ?? 0.46,
        wallpaperBlur: pack.layoutStyle === "glass" ? 2 : 0,
        wallpaperFit: "cover",
      });
    }
  }, [applyVisualPack, updateProfile]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {VISUAL_PACKS.map((pack) => {
        const isActive = packMatchesTheme(pack, theme);
        const isPreviewing = previewing === pack.id;
        return (
          <button
            key={pack.id}
            type="button"
            onClick={() => handleApply(pack)}
            onMouseEnter={() => setPreviewing(pack.id)}
            onMouseLeave={() => setPreviewing(null)}
            className="group relative overflow-hidden rounded-2xl border p-4 text-left transition-all"
            style={{
              borderColor: isActive ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.08)",
              backgroundColor: isActive ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.02)",
            }}
          >
            {/* Thumbnail preview */}
            <div
              className="mb-3 h-20 w-full rounded-xl border border-white/5"
              style={{ background: PACK_PREVIEWS[pack.id] ?? "#0a0a0f" }}
            >
              <div className="flex h-full items-end gap-1.5 p-2">
                <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: pack.accent === "cyber-yellow" ? "#f59e0b" : pack.accent === "matrix-green" ? "#8b5cf6" : pack.accent === "electric-blue" ? "#3b82f6" : pack.accent === "sunset-orange" ? "#f97316" : pack.accent === "neon-green" ? "#06b6d4" : "#a855f7", opacity: 0.6 }} />
                <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.15)" }} />
                <div className="h-1.5 w-6 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />
              </div>
            </div>

            {/* Active badge */}
            {isActive && (
              <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                <Check size={10} className="pointer-events-none" />
                Active
              </span>
            )}

            {/* Pack info */}
            <div className="text-sm font-bold text-white/90">{pack.name}</div>
            <p className="mt-1 text-xs leading-5 text-white/40">{pack.description}</p>

            {/* Included settings */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-bold capitalize text-white/50">{pack.skin}</span>
              <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-bold capitalize text-white/50">{pack.layoutStyle}</span>
              {pack.effects?.glow && (
                <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/50">glow</span>
              )}
            </div>

            {/* Preview hint */}
            {isPreviewing && !isActive && (
              <div className="mt-2 text-[10px] font-bold text-white/30">Click to apply</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
