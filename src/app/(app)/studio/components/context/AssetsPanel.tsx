"use client";

/**
 * AssetsPanel — Context Drawer Assets tab.
 *
 * Lists real StudioAsset records from the Asset Lake facade.
 * Backed by GET /api/assets — no placeholder, no fake data.
 *
 * Selecting an asset updates StudioContext.activeAssetId.
 * "Use in project" downloads the asset and writes it into the project
 * workspace via /api/studio-projects/[projectId]/assets/insert.
 * Empty state is truthful.
 */

import { useEffect, useState, useCallback } from "react";
import { useStudioContext } from "@/app/(app)/studio/context/StudioContext";
import { useAssetsRefreshTrigger } from "@/app/(app)/studio/hooks/useAssetsRefresh";
import type { StudioAsset } from "@/lib/assets/types";
import { FileImage, FileVideo, FileAudio, FileMusic, FileCode, FileBox, Loader2, FolderInput, Check, AlertCircle } from "lucide-react";
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

/** Suggested workspace directory for each asset kind. */
const KIND_DIRECTORY: Partial<Record<StudioAsset["kind"], string>> = {
  image: "public/assets/images",
  video: "public/assets/videos",
  audio: "public/assets/audio",
  music: "public/assets/audio",
  design: "public/assets/design",
  code: "src/assets",
  game: "public/assets/game",
};

/** Infer a safe filename from the asset name + URL extension. */
function inferFilename(asset: StudioAsset): string {
  const ext = asset.url.split(".").pop()?.split("?")[0] || "";
  const safeName = asset.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const fallbackExt = asset.kind === "audio" || asset.kind === "music" ? "mp3" : asset.kind === "video" ? "mp4" : "png";
  const finalExt = ext && ext.length <= 5 ? ext : fallbackExt;
  return `${safeName || "asset"}.${finalExt}`;
}

type InsertState = "idle" | "inserting" | "inserted" | "failed";

export default function AssetsPanel({ projectId }: { projectId?: string | null }) {
  const { activeAssetId, setActiveAssetId } = useStudioContext();
  const refreshTrigger = useAssetsRefreshTrigger();
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insertStates, setInsertStates] = useState<Record<string, InsertState>>({});
  const [insertedPath, setInsertedPath] = useState<string | null>(null);

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
  }, [fetchAssets, refreshTrigger]);

  const handleInsertAsset = useCallback(async (asset: StudioAsset) => {
    if (!projectId || !asset.url.startsWith("https://")) return;
    const dir = KIND_DIRECTORY[asset.kind] ?? "public/assets";
    const filename = inferFilename(asset);
    const targetPath = `${dir}/${filename}`;

    setInsertStates((prev) => ({ ...prev, [asset.id]: "inserting" }));
    setInsertedPath(null);

    try {
      const res = await fetch(`/api/studio-projects/${projectId}/assets/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: asset.url,
          path: targetPath,
          kind: asset.kind,
          name: asset.name,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setInsertStates((prev) => ({ ...prev, [asset.id]: "inserted" }));
      setInsertedPath(targetPath);
      // Reset after 3 seconds
      setTimeout(() => {
        setInsertStates((prev) => ({ ...prev, [asset.id]: "idle" }));
      }, 3000);
    } catch {
      setInsertStates((prev) => ({ ...prev, [asset.id]: "failed" }));
      setTimeout(() => {
        setInsertStates((prev) => ({ ...prev, [asset.id]: "idle" }));
      }, 3000);
    }
  }, [projectId]);

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
      {insertedPath && (
        <div
          className="mb-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px]"
          style={{
            backgroundColor: "rgba(72,238,56,0.08)",
            color: "#48EE38",
            border: "1px solid rgba(72,238,56,0.2)",
          }}
          data-testid="asset-inserted-notice"
        >
          <Check size={11} className="shrink-0" />
          <span className="truncate">Saved to {insertedPath}</span>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {assets.map((asset) => {
          const Icon = KIND_ICON[asset.kind] ?? FileBox;
          const isActive = activeAssetId === asset.id;
          const insertState = insertStates[asset.id] ?? "idle";
          const canInsert = projectId && asset.url.startsWith("https://");
          return (
            <div
              key={asset.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition hover:bg-white/5"
              style={{
                backgroundColor: isActive ? "rgba(139,92,246,0.1)" : "transparent",
              }}
              data-testid={`asset-item-${asset.id}`}
            >
              <button
                type="button"
                onClick={() => setActiveAssetId(isActive ? null : asset.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-pressed={isActive}
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

              {/* Use in project button */}
              {canInsert && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (insertState === "idle" || insertState === "failed") {
                      void handleInsertAsset(asset);
                    }
                  }}
                  disabled={insertState === "inserting"}
                  className="shrink-0 rounded p-1 transition"
                  style={{
                    color:
                      insertState === "inserted" ? "#48EE38" :
                      insertState === "failed" ? "#EF4444" :
                      "var(--text-muted)",
                    opacity: insertState === "idle" ? 0.6 : 1,
                  }}
                  aria-label="Use asset in project"
                  title="Save this asset into the project workspace"
                  data-testid={`asset-insert-${asset.id}`}
                >
                  {insertState === "inserting" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : insertState === "inserted" ? (
                    <Check size={13} />
                  ) : insertState === "failed" ? (
                    <AlertCircle size={13} />
                  ) : (
                    <FolderInput size={13} />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
