"use client";

/**
 * BoardMediaPanel — ONE Media panel for images, video AND music
 * (board-only rebuild, 2026-11-14, Larry's mockup + checklist item 5).
 *
 * Backed by the real Asset Lake (GET /api/assets — the same source as
 * the Assets panel; no placeholder data). Tabs split the lake by kind:
 * Images / Video / Music (music + audio kinds ride together). Assets
 * render as thumbnails; selecting one opens it in the viewer/player at
 * the top of the panel. The panel refetches whenever anything announces
 * an asset change (`litt:assets:changed` — fired by the image tool and
 * by in-chat generation persistence), so an image LiTT generates in the
 * chat lands here on its own (checklist item 7b).
 *
 * The asset composer at the bottom (Images tab) generates a real image
 * through POST /api/media/generate on the free auto route and selects
 * the result when it lands in the lake.
 *
 * Token-bound surfaces; violet is the active-tab accent (mockup).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageIcon, LoaderCircle, Music, Play, RefreshCw, Send } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { StudioAsset } from "@/lib/assets/types";
import { notifyAssetsChanged, useAssetsRefreshTrigger } from "../../hooks/useAssetsRefresh";
import { BOARD_ACCENT_VIOLET } from "./board-types";

type MediaTab = "images" | "video" | "music";

const TAB_KINDS: Record<MediaTab, (asset: StudioAsset) => boolean> = {
  images: (a) => a.kind === "image",
  video: (a) => a.kind === "video",
  music: (a) => a.kind === "music" || a.kind === "audio",
};

export interface BoardMediaPanelProps {
  projectId: string | null;
}

export default function BoardMediaPanel({ projectId }: BoardMediaPanelProps) {
  const { tokens } = useTheme();
  const refreshTrigger = useAssetsRefreshTrigger();
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MediaTab>("images");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [composerNote, setComposerNote] = useState<string | null>(null);

  const fetchAssets = useCallback(async () => {
    if (!projectId) {
      setAssets([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("projectId", projectId);
      params.set("scope", "project");
      params.set("limit", "100");
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
      setError("Failed to load media.");
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets, refreshTrigger]);

  const visibleAssets = useMemo(() => assets.filter(TAB_KINDS[tab]), [assets, tab]);
  const selected = useMemo(
    () => visibleAssets.find((a) => a.id === selectedId) ?? null,
    [visibleAssets, selectedId],
  );

  const generateAsset = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || generating) return;
    setGenerating(true);
    setComposerNote(null);
    try {
      const res = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          projectId: projectId ?? undefined,
          generationMode: "auto-free",
          aspectRatio: "16:9",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setComposerNote(data.error || "Generation failed — no image provider completed the request.");
        return;
      }
      setPrompt("");
      // The generation persisted to the Asset Lake: announce it so this
      // panel (and every other asset surface) refetches, then select it.
      notifyAssetsChanged();
      if (data.assetId) setSelectedId(data.assetId);
      if (data.assetPersistenceFailed) {
        setComposerNote("Image generated, but saving it to the Media library failed.");
      }
    } catch {
      setComposerNote("Generation failed — the request never completed.");
    } finally {
      setGenerating(false);
    }
  };

  const tabButton = (id: MediaTab, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-testid={`board-media-tab-${id}`}
      className="rounded-full px-3 py-1 text-[11px] font-semibold"
      style={
        tab === id
          ? { backgroundColor: BOARD_ACCENT_VIOLET, color: "#FFFFFF" }
          : { color: tokens.textMuted }
      }
      onClick={() => {
        setTab(id);
        setSelectedId(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="board-media-panel"
      style={{ backgroundColor: tokens.surface, color: tokens.text }}
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: tokens.border }}
      >
        <div
          className="flex items-center gap-0.5 rounded-full border p-0.5"
          style={{ borderColor: tokens.border }}
          role="tablist"
          aria-label="Media kinds"
        >
          {tabButton("images", "Images")}
          {tabButton("video", "Video")}
          {tabButton("music", "Music")}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Refresh media"
          data-testid="board-media-refresh"
          className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-black/5"
          style={{ color: tokens.textMuted }}
          onClick={() => void fetchAssets()}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
      </div>

      {selected && (
        <div
          className="shrink-0 border-b p-2"
          style={{ borderColor: tokens.border }}
          data-testid="board-media-viewer"
        >
          {selected.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.url}
              alt={selected.name}
              className="max-h-44 w-full rounded-lg object-contain"
            />
          ) : selected.kind === "video" ? (
            <video
              src={selected.previewUrl ?? selected.url}
              controls
              className="max-h-44 w-full rounded-lg"
            />
          ) : (
            <div className="flex items-center gap-2 px-1 py-1">
              <Music size={16} style={{ color: tokens.textMuted }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{selected.name}</span>
              <audio src={selected.previewUrl ?? selected.url} controls className="h-8 max-w-[60%]" />
            </div>
          )}
          {selected.kind === "image" && (
            <p className="mt-1 truncate px-0.5 text-[11px]" style={{ color: tokens.textMuted }}>
              {selected.name}
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <p className="p-2 text-xs" style={{ color: tokens.textMuted }} data-testid="board-media-error">
            {error}
          </p>
        ) : loading && assets.length === 0 ? (
          <p className="p-2 text-xs" style={{ color: tokens.textMuted }}>
            Loading media…
          </p>
        ) : visibleAssets.length === 0 ? (
          <p className="p-2 text-xs leading-5" style={{ color: tokens.textMuted }}>
            {tab === "images" &&
              "No images yet. Generate one with LiTT in the chat, or describe an asset below — it lands here."}
            {tab === "video" && "No video assets in this project yet."}
            {tab === "music" && "No music or audio assets in this project yet."}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {visibleAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                data-testid={`board-media-asset-${asset.id}`}
                aria-pressed={selectedId === asset.id}
                className="group relative aspect-square overflow-hidden rounded-lg border"
                style={{
                  borderColor: selectedId === asset.id ? BOARD_ACCENT_VIOLET : tokens.border,
                  backgroundColor: tokens.surfaceElevated,
                }}
                onClick={() => setSelectedId(asset.id)}
                title={asset.name}
              >
                {asset.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.thumbnailUrl ?? asset.url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : asset.kind === "video" ? (
                  <>
                    {asset.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <video
                        src={asset.url}
                        preload="metadata"
                        muted
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Play size={16} className="text-white drop-shadow" aria-hidden />
                    </span>
                  </>
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1">
                    {asset.kind === "music" || asset.kind === "audio" ? (
                      <Music size={16} style={{ color: tokens.textMuted }} aria-hidden />
                    ) : (
                      <ImageIcon size={16} style={{ color: tokens.textMuted }} aria-hidden />
                    )}
                    <span
                      className="w-full truncate text-center text-[9px]"
                      style={{ color: tokens.textMuted }}
                    >
                      {asset.name}
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "images" && (
        <div className="shrink-0 border-t p-2" style={{ borderColor: tokens.border }}>
          {composerNote && (
            <p className="mb-1.5 text-[11px] leading-4" style={{ color: tokens.textMuted }} data-testid="board-media-composer-note">
              {composerNote}
            </p>
          )}
          <div
            className="flex items-center gap-1.5 rounded-full border px-2 py-1"
            style={{ borderColor: tokens.border, backgroundColor: tokens.background }}
          >
            <input
              data-testid="board-media-composer-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void generateAsset();
              }}
              placeholder="Describe your next asset..."
              className="min-w-0 flex-1 bg-transparent px-1.5 text-xs outline-none"
              style={{ color: tokens.text }}
            />
            <button
              type="button"
              aria-label="Generate asset"
              data-testid="board-media-composer-send"
              disabled={generating || !prompt.trim()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
              style={{ backgroundColor: BOARD_ACCENT_VIOLET }}
              onClick={() => void generateAsset()}
            >
              {generating ? (
                <LoaderCircle size={13} className="animate-spin" aria-hidden />
              ) : (
                <Send size={13} aria-hidden />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
