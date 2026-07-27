"use client";

import { useState, useCallback, useRef } from "react";
import { useProfile } from "@/context/ProfileContext";
import {
  WALLPAPERS,
  getWallpaperById,
  getAvailableCategories,
  WALLPAPER_FALLBACK_GRADIENT,
  type WallpaperId,
  type WallpaperCategory,
  type WallpaperEffect,
} from "@/lib/wallpapers";
import { Check, Upload, X, Sparkles } from "lucide-react";
import Link from "next/link";

const EFFECTS: { id: WallpaperEffect; label: string }[] = [
  { id: "none", label: "None" },
  { id: "constellation", label: "Constellation" },
  { id: "nebula", label: "Nebula" },
  { id: "waves", label: "Waves" },
  { id: "minimal", label: "Minimal" },
  { id: "holo", label: "Holo" },
];

export function WallpaperSection() {
  const { profile, updateProfile } = useProfile();
  const [category, setCategory] = useState<WallpaperCategory>("all");
  const overlayOpacity = profile.wallpaperOverlay;
  const blurPx = profile.wallpaperBlur;
  const fit = profile.wallpaperFit;
  const effect = profile.wallpaperEffect ?? "none";
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categories = getAvailableCategories();

  const wallpapers = category === "all"
    ? WALLPAPERS.filter((w) => w.id !== "custom")
    : WALLPAPERS.filter((w) =>
        w.id !== "custom" &&
        (w.category === category || (w.categories?.includes(category) ?? false))
      );

  const handleSelect = useCallback((id: WallpaperId) => {
    const wp = getWallpaperById(id);
    updateProfile({
      wallpaper: id,
      customWallpaperUrl: null,
      // Apply the wallpaper's default effect when switching, if it has one
      ...(wp.defaultEffect ? { wallpaperEffect: wp.defaultEffect } : {}),
    });
  }, [updateProfile]);

  const handleRemove = useCallback(() => {
    updateProfile({ wallpaper: "mesh", customWallpaperUrl: null });
  }, [updateProfile]);

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null);

    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
      setUploadError("Only JPG, PNG, and WebP files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File too large. Maximum size is 10 MB.");
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        updateProfile({ wallpaper: "custom", customWallpaperUrl: dataUrl });
        setUploading(false);
      };
      reader.onerror = () => {
        setUploadError("Failed to read file.");
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setUploadError("Upload failed.");
      setUploading(false);
    }
  }, [updateProfile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const activeWallpaper = getWallpaperById(profile.wallpaper);
  const isCustom = profile.wallpaper === "custom" && profile.customWallpaperUrl;

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className="rounded-lg border px-3 py-1.5 text-xs font-bold capitalize transition-all"
            style={{
              borderColor: category === cat ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.06)",
              backgroundColor: category === cat ? "rgba(245,158,11,0.08)" : "transparent",
              color: category === cat ? "#f59e0b" : "rgba(255,255,255,0.5)",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Wallpaper gallery */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {wallpapers.map((wp) => {
          const isActive = profile.wallpaper === wp.id;
          const previewFailed = failedPreviews.has(wp.id);
          return (
            <button
              key={wp.id}
              type="button"
              onClick={() => handleSelect(wp.id)}
              className="group relative aspect-video overflow-hidden rounded-xl border transition-all"
              style={{
                borderColor: isActive ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.06)",
              }}
            >
              {/* Preview layer — uses CSS background. If the wallpaper has
                  a real image asset and it fails, fall back to gradient. */}
              <div
                className="absolute inset-0"
                style={{
                  background: previewFailed
                    ? WALLPAPER_FALLBACK_GRADIENT
                    : wp.preview,
                }}
                onError={() => {
                  // Mark this preview as failed so we show the fallback
                  // gradient instead of a broken-image icon.
                  if (wp.hasAsset && !previewFailed) {
                    setFailedPreviews((prev) => new Set(prev).add(wp.id));
                  }
                }}
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
              {wp.premium && (
                <span
                  className="absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                  style={{
                    backgroundColor: "rgba(139,92,246,0.8)",
                    color: "#fff",
                  }}
                >
                  PREMIUM
                </span>
              )}
              {isActive && (
                <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(245,158,11,0.2)" }}>
                  <Check size={12} className="text-amber-400" />
                </span>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-2">
                <div className="text-[11px] font-bold text-white/90">{wp.name}</div>
                <div className="text-[9px] text-white/40">{wp.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom wallpaper upload */}
      <div
        className="rounded-xl border border-dashed border-white/10 p-4 transition-all hover:border-white/20"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white/80">Custom wallpaper</div>
            <p className="text-[10px] text-white/40">Drag and drop or browse — JPG, PNG, WebP up to 10 MB</p>
            {uploadError && <p className="mt-1 text-[10px] text-red-400">{uploadError}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all disabled:opacity-40"
              style={{ borderColor: "rgba(245,158,11,0.2)", color: "#f59e0b" }}
            >
              <Upload size={12} className="pointer-events-none" />
              {uploading ? "Uploading…" : "Browse"}
            </button>
            {isCustom && (
              <button
                type="button"
                onClick={handleRemove}
                className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-3 py-2 text-xs font-bold text-red-300 transition-all hover:bg-red-400/10"
              >
                <X size={12} className="pointer-events-none" />
                Remove
              </button>
            )}
          </div>
        </div>
        {isCustom && (
          <div className="mt-3 aspect-video overflow-hidden rounded-lg border border-white/5" style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,${overlayOpacity}), rgba(0,0,0,${overlayOpacity + 0.2})), url(${profile.customWallpaperUrl})`,
            backgroundSize: fit,
            backgroundPosition: "center",
            filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
          }} />
        )}
      </div>

      {/* Generate with Spark */}
      <Link
        href="/studio?tool=image&intent=wallpaper"
        className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs font-bold text-amber-300 transition-all hover:bg-amber-400/10"
      >
        <Sparkles size={14} className="pointer-events-none" />
        Generate wallpaper with Spark
      </Link>

      {/* Wallpaper controls */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Fit mode */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Fit mode</span>
          <div className="mt-1.5 flex gap-2">
            {(["cover", "contain", "fill"] as const).map((f) => (
              <button
                key={f}
                type="button"
              onClick={() => updateProfile({ wallpaperFit: f })}
                className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize transition-all"
                style={{
                  borderColor: fit === f ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.06)",
                  backgroundColor: fit === f ? "rgba(245,158,11,0.06)" : "transparent",
                  color: fit === f ? "#f59e0b" : "rgba(255,255,255,0.5)",
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Background effect */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Background effect</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {EFFECTS.map((eff) => (
              <button
                key={eff.id}
                type="button"
                onClick={() => updateProfile({ wallpaperEffect: eff.id })}
                className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize transition-all"
                style={{
                  borderColor: effect === eff.id ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.06)",
                  backgroundColor: effect === eff.id ? "rgba(245,158,11,0.06)" : "transparent",
                  color: effect === eff.id ? "#f59e0b" : "rgba(255,255,255,0.5)",
                }}
              >
                {eff.label}
              </button>
            ))}
          </div>
        </div>

        {/* Overlay darkness */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Overlay darkness: {Math.round(overlayOpacity * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.05}
            value={overlayOpacity}
            onChange={(e) => updateProfile({ wallpaperOverlay: Number(e.target.value) })}
            className="mt-2 w-full accent-amber-500"
          />
        </div>

        {/* Blur */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Background blur: {blurPx}px
          </span>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={blurPx}
            onChange={(e) => updateProfile({ wallpaperBlur: Number(e.target.value) })}
            className="mt-2 w-full accent-amber-500"
          />
        </div>

        {/* Active wallpaper info */}
        <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Active</div>
            <div className="text-xs font-bold text-white/80">{isCustom ? "Custom upload" : activeWallpaper.name}</div>
          </div>
          {!isCustom && profile.wallpaper !== "mesh" && (
            <button
              type="button"
              onClick={handleRemove}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-white/50 transition-all hover:text-white/80"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
