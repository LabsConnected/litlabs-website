"use client";

import { useState, useCallback, useRef } from "react";
import { useProfile } from "@/context/ProfileContext";
import {
  getWallpaperById,
  getLittOriginals,
  getAmbientWallpapers,
  WALLPAPER_FALLBACK_GRADIENT,
  type WallpaperId,
  type WallpaperEffect,
  type Wallpaper,
} from "@/lib/wallpapers";
import { Check, Upload, X, Sparkles, ChevronRight } from "lucide-react";
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
  const overlayOpacity = profile.wallpaperOverlay;
  const blurPx = profile.wallpaperBlur;
  const fit = profile.wallpaperFit;
  const effect = profile.wallpaperEffect ?? "none";
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set());
  const [ambientOpen, setAmbientOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const littOriginals = getLittOriginals();
  const ambientWallpapers = getAmbientWallpapers();

  const handleSelect = useCallback((id: WallpaperId) => {
    const wp = getWallpaperById(id);
    updateProfile({
      wallpaper: id,
      customWallpaperUrl: null,
      // Apply the wallpaper's default effect and fit when switching
      ...(wp.defaultEffect ? { wallpaperEffect: wp.defaultEffect } : {}),
      ...(wp.defaultFit ? { wallpaperFit: wp.defaultFit } : {}),
      ...(typeof wp.defaultOverlay === "number" ? { wallpaperOverlay: wp.defaultOverlay } : {}),
      ...(typeof wp.defaultBlur === "number" ? { wallpaperBlur: wp.defaultBlur } : {}),
    });
  }, [updateProfile]);

  const handleRemove = useCallback(() => {
    updateProfile({ wallpaper: "mesh", customWallpaperUrl: null });
  }, [updateProfile]);

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null);

    if (!file.type.match(/^image\/(jpeg|png|webp|avif)$/)) {
      setUploadError("Only JPG, PNG, WebP, and AVIF files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File too large. Maximum size is 10 MB.");
      return;
    }

    setUploading(true);
    try {
      // Upload to server for durable storage — not just FileReader base64
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "wallpaper");
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.url || data.fallback) {
        // Server returned a base64 fallback — use it as a temporary preview
        // but warn that it won't persist across devices
        updateProfile({ wallpaper: "custom", customWallpaperUrl: data.url });
        setUploadError("Stored locally only. Cloud storage not configured — wallpaper won't sync across devices.");
      } else {
        updateProfile({ wallpaper: "custom", customWallpaperUrl: data.url });
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
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
    <div className="space-y-5">
      {/* ── LiTT Originals — large cinematic cards ───────────────────── */}
      <div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: "#a855f7" }}>
              LiTT Originals
            </div>
            <div className="mt-1 text-sm font-bold text-white/80">
              Cinematic scenes built for your workspace
            </div>
          </div>
          <div className="hidden text-[10px] text-white/40 sm:block">
            Premium collection
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {littOriginals.map((wp) => (
            <WallpaperCard
              key={wp.id}
              wp={wp}
              isActive={profile.wallpaper === wp.id}
              previewFailed={failedPreviews.has(wp.id)}
              onSelect={handleSelect}
              onPreviewFailed={(id) =>
                setFailedPreviews((prev) => new Set(prev).add(id))
              }
              large
            />
          ))}
        </div>
      </div>

      {/* ── My Wallpapers — custom uploads ───────────────────────────── */}
      <div
        className="rounded-xl border border-dashed border-white/10 p-4 transition-all hover:border-white/20"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white/80">My Wallpapers</div>
            <p className="text-[10px] text-white/40">
              Drag and drop or browse — JPG, PNG, WebP, AVIF up to 10 MB
            </p>
            {uploadError && (
              <p className="mt-1 text-[10px] text-red-400">{uploadError}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
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
          <div
            className="mt-3 aspect-video overflow-hidden rounded-lg border border-white/5"
            style={{
              backgroundImage: `linear-gradient(rgba(0,0,0,${overlayOpacity}), rgba(0,0,0,${overlayOpacity + 0.2})), url(${profile.customWallpaperUrl})`,
              backgroundSize: fit,
              backgroundPosition: "center",
              filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
            }}
          />
        )}
      </div>

      {/* ── Generate with Spark ──────────────────────────────────────── */}
      <Link
        href="/studio?tool=image&intent=wallpaper"
        className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs font-bold text-amber-300 transition-all hover:bg-amber-400/10"
      >
        <Sparkles size={14} className="pointer-events-none" />
        Generate wallpaper with Spark
      </Link>

      {/* ── Ambient & Minimal — collapsed by default ─────────────────── */}
      <details
        className="group rounded-xl border border-white/8"
        style={{ backgroundColor: "rgba(255,255,255,0.02)" }}
        open={ambientOpen}
        onToggle={(e) => setAmbientOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-black text-white/50 transition hover:text-white/70">
          <ChevronRight
            size={14}
            className="pointer-events-none transition group-open:rotate-90"
          />
          Ambient &amp; minimal styles
          <span className="font-normal opacity-60">({ambientWallpapers.length})</span>
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-white/5 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {ambientWallpapers.map((wp) => (
            <WallpaperCard
              key={wp.id}
              wp={wp}
              isActive={profile.wallpaper === wp.id}
              previewFailed={failedPreviews.has(wp.id)}
              onSelect={handleSelect}
              onPreviewFailed={(id) =>
                setFailedPreviews((prev) => new Set(prev).add(id))
              }
            />
          ))}
        </div>
      </details>

      {/* ── Wallpaper controls ───────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Fit mode */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Fit mode
          </span>
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
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Background effect
          </span>
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
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              Active
            </div>
            <div className="text-xs font-bold text-white/80">
              {isCustom ? "Custom upload" : activeWallpaper.name}
            </div>
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

/* ── Reusable wallpaper card ─────────────────────────────────────────── */

interface WallpaperCardProps {
  wp: Wallpaper;
  isActive: boolean;
  previewFailed: boolean;
  onSelect: (id: WallpaperId) => void;
  onPreviewFailed: (id: string) => void;
  large?: boolean;
}

function WallpaperCard({ wp, isActive, previewFailed, onSelect, onPreviewFailed, large }: WallpaperCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(wp.id)}
      aria-pressed={isActive}
      className="group relative overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5"
      style={{
        borderColor: isActive ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.06)",
        boxShadow: isActive ? "0 0 0 1px rgba(168,85,247,0.3), 0 8px 24px rgba(168,85,247,0.1)" : undefined,
      }}
    >
      {/* Preview layer — uses CSS background. If the wallpaper has
          a real image asset and it fails, fall back to gradient. */}
      <div
        className={large ? "relative h-40" : "relative h-20"}
        style={{
          background: previewFailed
            ? wp.gradientFallback || WALLPAPER_FALLBACK_GRADIENT
            : wp.preview,
        }}
        onError={() => {
          if (wp.hasAsset && !previewFailed) {
            onPreviewFailed(wp.id);
          }
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

      {/* Premium badge */}
      {wp.premium && (
        <span
          className="absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
          style={{ backgroundColor: "rgba(139,92,246,0.8)", color: "#fff" }}
        >
          PREMIUM
        </span>
      )}

      {/* Active check */}
      {isActive && (
        <span
          className={`absolute flex items-center justify-center rounded-full bg-black/60 text-white backdrop-blur ${
            large ? "right-3 top-3 h-6 w-6" : "right-2 top-2 h-5 w-5"
          }`}
        >
          <Check size={large ? 14 : 12} className="pointer-events-none" />
        </span>
      )}

      {/* Label */}
      <div className={`absolute inset-x-0 bottom-0 ${large ? "p-3" : "p-2"}`}>
        <div className={`${large ? "text-sm" : "text-[11px]"} font-bold text-white/90`}>
          {wp.name}
        </div>
        {large && (
          <div className="mt-0.5 text-[10px] text-white/60">{wp.description}</div>
        )}
      </div>
    </button>
  );
}
