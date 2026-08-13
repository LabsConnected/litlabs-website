"use client";

/**
 * AssetsPanel — Context Drawer Assets tab.
 *
 * Lists real StudioAsset records from the Asset Lake facade.
 * Backed by GET /api/assets — no placeholder, no fake data.
 *
 * Selecting an asset updates StudioContext.activeAssetId.
 * Empty state is truthful.
 */

import { useEffect, useState, useCallback } from "react";
import { useStudioContext } from "@/app/studio/context/StudioContext";
import type { StudioAsset } from "@/lib/assets/types";
import { FileImage, FileVideo, FileAudio, FileMusic, FileCode, FileBox, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const KIND_ICON: Partial<Record<StudioAsset["kind"], LucideIcon>> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  music: FileMusic,
  code: FileCode,
  design: FileBox,
  game: FileBox,
};

export default function AssetsPanel({ projectId }: { projectId?: string | null }) {
  const { activeAssetId, setActiveAssetId } = useStudioContext();
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      params.set("limit", "50");
      const res = await fetch(`/api/assets?${params.toString()}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        setAssets([]);
        return;
      }
      const data = await res.json();
      setAssets(data.assets ?? []);
    } catch {
      setError("Failed to load assets.");
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-xs" style={{ color: "var(--text-muted)" }} data-testid="assets-error">
        {error}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center"
        data-testid="assets-empty"
      >
        <FileImage size={20} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          No assets yet.
        </p>
        <p className="text-[10px]" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
          Generated and uploaded assets will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="assets-list">
      <div className="flex flex-col gap-1">
        {assets.map((asset) => {
          const Icon = KIND_ICON[asset.kind] ?? FileBox;
          const isActive = activeAssetId === asset.id;
          return (
            <button
              key={asset.id}
              type="button"
              onClick={() => setActiveAssetId(isActive ? null : asset.id)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition hover:bg-white/5"
              style={{
                backgroundColor: isActive ? "rgba(139,92,246,0.1)" : "transparent",
              }}
              aria-pressed={isActive}
              data-testid={`asset-item-${asset.id}`}
            >
              {/* Thumbnail or icon */}
              {asset.kind === "image" && asset.thumbnailUrl ? (
                <img
                  src={asset.thumbnailUrl}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div
                  className="grid h-8 w-8 shrink-0 place-items-center rounded"
                  style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
                >
                  <Icon size={14} style={{ color: "var(--text-muted)" }} />
                </div>
              )}

              {/* Name + meta */}
              <div className="min-w-0 flex-1">
                <p
                  className="truncate font-medium"
                  style={{ color: isActive ? "var(--litt-primary)" : "var(--text-primary)" }}
                >
                  {asset.name}
                </p>
                <p className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                  {asset.kind} · {asset.source}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
