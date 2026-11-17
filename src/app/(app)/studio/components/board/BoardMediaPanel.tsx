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
 * Click-to-manage (Amendment 6, 2026-11-16): selecting any item exposes
 * per-item actions in the viewer — Delete (with a confirm step) calls
 * DELETE /api/assets/[assetId], which removes the underlying Asset
 * Lake source row, so the item is gone on refetch; Edit (images)
 * opens a prompt inside this panel and submits through the existing
 * POST /api/media/edit-image path.
 *
 * Generation returns a SET (Amendment 7, 2026-11-16): the asset
 * composer shows style presets up front (folded into the prompt) and
 * generates a set of options through POST /api/media/generate (one
 * call per option, seeds varied). Picking an option keeps it; the
 * unpicked options are deleted through the real delete path above —
 * the generate endpoint persists every call, so "discarded" means
 * deleted, never just hidden. Refresh discards the current set the
 * same way and generates a different one.
 *
 * Token-bound surfaces; violet is the active-tab accent (mockup),
 * green is the keep/generate accent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, LoaderCircle, Music, Pencil, Play, RefreshCw, Send, Trash2, X } from "lucide-react";
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

const MEDIA_ACCENT_GREEN = "#2FBF5A";
const OPTION_SET_SIZE = 4;

interface StylePreset {
  id: string;
  label: string;
  /** Folded into the generation prompt — the endpoint takes prompts only. */
  suffix: string;
}

const STYLE_PRESETS: StylePreset[] = [
  { id: "none", label: "No style", suffix: "" },
  { id: "3d-render", label: "3D render", suffix: ", 3D render" },
  { id: "cartoon", label: "Cartoon", suffix: ", cartoon style" },
  { id: "pixel-art", label: "Pixel art", suffix: ", pixel art" },
  { id: "watercolor", label: "Watercolor", suffix: ", watercolor painting" },
  { id: "cinematic-photo", label: "Cinematic photo", suffix: ", cinematic photo" },
];

interface GeneratedCandidate {
  assetId: string | null;
  url: string;
}

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
  const [styleId, setStyleId] = useState("none");
  const [generating, setGenerating] = useState(false);
  const [composerNote, setComposerNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<GeneratedCandidate[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const candidatesRef = useRef<GeneratedCandidate[] | null>(null);
  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);

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

  // Selection changes reset the per-item action state.
  useEffect(() => {
    setConfirmDelete(false);
    setEditOpen(false);
    setEditPrompt("");
    setActionNote(null);
  }, [selectedId]);

  const deleteAssetById = useCallback(
    async (assetId: string): Promise<boolean> => {
      try {
        const params = new URLSearchParams();
        if (projectId) params.set("projectId", projectId);
        const qs = params.toString();
        const res = await fetch(
          `/api/assets/${encodeURIComponent(assetId)}${qs ? `?${qs}` : ""}`,
          { method: "DELETE" },
        );
        return res.ok;
      } catch {
        return false;
      }
    },
    [projectId],
  );

  // The generate endpoint persists every call to the Asset Lake, so an
  // unpicked candidate is discarded by deleting it for real.
  const discardCandidates = useCallback(
    async (list: GeneratedCandidate[]): Promise<number> => {
      let failed = 0;
      for (const candidate of list) {
        if (!candidate.assetId) continue;
        const ok = await deleteAssetById(candidate.assetId);
        if (!ok) failed += 1;
      }
      return failed;
    },
    [deleteAssetById],
  );

  // If the panel unmounts with an unpicked set on screen, delete those
  // candidates (keepalive) so they do not silently become library items.
  useEffect(() => {
    return () => {
      const pending = candidatesRef.current;
      if (!pending) return;
      for (const candidate of pending) {
        if (!candidate.assetId) continue;
        void fetch(`/api/assets/${encodeURIComponent(candidate.assetId)}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, []);

  const generateAssetSet = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || generating) return;
    setGenerating(true);
    setComposerNote(null);
    try {
      // Refresh semantics: a new set replaces the old one, and the old
      // unpicked options are deleted through the real delete path.
      if (candidates && candidates.length > 0) {
        await discardCandidates(candidates);
        setCandidates(null);
      }
      const style = STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0];
      const styledPrompt = `${trimmed}${style.suffix}`;
      const baseSeed = Math.floor(Math.random() * 1_000_000);
      const settled = await Promise.allSettled(
        Array.from({ length: OPTION_SET_SIZE }, async (_, i) => {
          const res = await fetch("/api/media/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: styledPrompt,
              projectId: projectId ?? undefined,
              generationMode: "auto-free",
              aspectRatio: "16:9",
              seed: baseSeed + i,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(data.error || "Generation failed");
          }
          const url = data.downloadUrl ?? data.durableUrl;
          if (!url) throw new Error("Generation returned no image");
          return {
            assetId: typeof data.assetId === "string" ? data.assetId : null,
            url,
          } as GeneratedCandidate;
        }),
      );
      // Partial success still shows: one failed provider call must not
      // throw away the options that did complete.
      const results = settled
        .filter((s): s is PromiseFulfilledResult<GeneratedCandidate> => s.status === "fulfilled")
        .map((s) => s.value);
      if (results.length === 0) {
        setComposerNote("Generation failed — no image provider completed the request.");
        return;
      }
      setCandidates(results);
      if (results.length < OPTION_SET_SIZE) {
        setComposerNote(
          `${results.length} of ${OPTION_SET_SIZE} options generated — the rest did not complete.`,
        );
      }
    } catch {
      setComposerNote("Generation failed — the request never completed.");
    } finally {
      setGenerating(false);
    }
  };

  const keepCandidate = async (candidate: GeneratedCandidate) => {
    const current = candidates ?? [];
    const others = current.filter((c) => c !== candidate);
    setCandidates(null);
    const failed = await discardCandidates(others);
    if (candidate.assetId) setSelectedId(candidate.assetId);
    setPrompt("");
    notifyAssetsChanged();
    if (failed > 0) {
      setComposerNote(
        "Kept your pick, but some unpicked options could not be removed from the library.",
      );
    }
  };

  const discardAllCandidates = async () => {
    const current = candidates ?? [];
    setCandidates(null);
    const failed = await discardCandidates(current);
    notifyAssetsChanged();
    if (failed > 0) {
      setComposerNote("Some options could not be removed from the library.");
    }
  };

  const deleteSelected = async () => {
    if (!selected || deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setActionNote(null);
    try {
      const ok = await deleteAssetById(selected.id);
      if (!ok) {
        setActionNote("Delete failed — the item is still in the library.");
        return;
      }
      setSelectedId(null);
      setConfirmDelete(false);
      // Announce so every asset surface refetches; the deleted item is
      // gone from the underlying list, not just hidden here.
      notifyAssetsChanged();
      await fetchAssets();
    } finally {
      setDeleting(false);
    }
  };

  const submitEdit = async () => {
    if (!selected || selected.kind !== "image" || editing) return;
    const trimmed = editPrompt.trim();
    if (trimmed.length < 3) {
      setActionNote("Describe the edit first.");
      return;
    }
    setEditing(true);
    setActionNote(null);
    try {
      const res = await fetch("/api/media/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: selected.url,
          prompt: trimmed,
          projectId: projectId ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setActionNote(data.error || "Edit failed — no image provider completed the request.");
        return;
      }
      setEditOpen(false);
      setEditPrompt("");
      if (data.assetId) setSelectedId(data.assetId);
      notifyAssetsChanged();
      setActionNote("Edit created a new image — it is selected above.");
    } catch {
      setActionNote("Edit failed — the request never completed.");
    } finally {
      setEditing(false);
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

          <div
            className="mt-2 flex flex-wrap items-center gap-1.5"
            data-testid="board-media-actions"
          >
            {selected.kind === "image" && (
              <button
                type="button"
                data-testid="board-media-action-edit"
                className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                style={{ borderColor: tokens.border, color: tokens.text }}
                onClick={() => {
                  setEditOpen((open) => !open);
                  setConfirmDelete(false);
                }}
              >
                <Pencil size={11} aria-hidden /> Edit
              </button>
            )}
            {!confirmDelete ? (
              <button
                type="button"
                data-testid="board-media-action-delete"
                className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                style={{ borderColor: tokens.border, color: tokens.text }}
                onClick={() => void deleteSelected()}
              >
                <Trash2 size={11} aria-hidden /> Delete
              </button>
            ) : (
              <>
                <span className="text-[11px]" style={{ color: tokens.textMuted }}>
                  Delete this item permanently?
                </span>
                <button
                  type="button"
                  data-testid="board-media-action-delete-confirm"
                  disabled={deleting}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "#B3382E" }}
                  onClick={() => void deleteSelected()}
                >
                  {deleting ? (
                    <LoaderCircle size={11} className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 size={11} aria-hidden />
                  )}{" "}
                  Delete
                </button>
                <button
                  type="button"
                  data-testid="board-media-action-delete-cancel"
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                  style={{ borderColor: tokens.border, color: tokens.text }}
                  onClick={() => setConfirmDelete(false)}
                >
                  <X size={11} aria-hidden /> Cancel
                </button>
              </>
            )}
          </div>

          {editOpen && selected.kind === "image" && (
            <div className="mt-2" data-testid="board-media-edit-form">
              <div
                className="flex items-center gap-1.5 rounded-full border px-2 py-1"
                style={{ borderColor: tokens.border, backgroundColor: tokens.background }}
              >
                <input
                  data-testid="board-media-edit-input"
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitEdit();
                  }}
                  placeholder="Describe the edit..."
                  className="min-w-0 flex-1 bg-transparent px-1.5 text-xs outline-none"
                  style={{ color: tokens.text }}
                />
                <button
                  type="button"
                  aria-label="Apply edit"
                  data-testid="board-media-edit-submit"
                  disabled={editing || editPrompt.trim().length < 3}
                  className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-semibold disabled:opacity-50"
                  style={{ backgroundColor: MEDIA_ACCENT_GREEN, color: "#15171B" }}
                  onClick={() => void submitEdit()}
                >
                  {editing ? (
                    <LoaderCircle size={12} className="animate-spin" aria-hidden />
                  ) : (
                    <Pencil size={12} aria-hidden />
                  )}{" "}
                  Apply edit
                </button>
              </div>
              <p className="mt-1 px-0.5 text-[10px] leading-4" style={{ color: tokens.textMuted }}>
                Editing creates a new image from this one — the original stays in the library.
              </p>
            </div>
          )}

          {actionNote && (
            <p
              className="mt-1.5 text-[11px] leading-4"
              style={{ color: tokens.textMuted }}
              data-testid="board-media-action-note"
            >
              {actionNote}
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
                  borderColor: selectedId === asset.id ? MEDIA_ACCENT_GREEN : tokens.border,
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
            className="mb-2 flex flex-wrap items-center gap-1"
            role="radiogroup"
            aria-label="Image style"
            data-testid="board-media-style-group"
          >
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: tokens.textMuted }}>
              Style
            </span>
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={styleId === preset.id}
                data-testid={`board-media-style-${preset.id}`}
                className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                style={
                  styleId === preset.id
                    ? { backgroundColor: MEDIA_ACCENT_GREEN, borderColor: MEDIA_ACCENT_GREEN, color: "#15171B" }
                    : { borderColor: tokens.border, color: tokens.textMuted }
                }
                onClick={() => setStyleId(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {candidates && candidates.length > 0 && (
            <div className="mb-2" data-testid="board-media-candidates">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="flex-1 text-[11px] font-semibold">Pick one to keep</span>
                <button
                  type="button"
                  data-testid="board-media-candidates-refresh"
                  disabled={generating}
                  className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                  style={{ borderColor: tokens.border, color: tokens.text }}
                  onClick={() => void generateAssetSet()}
                >
                  <RefreshCw size={10} aria-hidden /> Refresh
                </button>
                <button
                  type="button"
                  data-testid="board-media-candidates-discard"
                  className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                  style={{ borderColor: tokens.border, color: tokens.textMuted }}
                  onClick={() => void discardAllCandidates()}
                >
                  <X size={10} aria-hidden /> Discard all
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {candidates.map((candidate, i) => (
                  <div
                    key={`${candidate.assetId ?? "unpersisted"}-${i}`}
                    data-testid={`board-media-candidate-${i}`}
                    className="overflow-hidden rounded-lg border"
                    style={{ borderColor: tokens.border, backgroundColor: tokens.surfaceElevated }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={candidate.url}
                      alt={`Generated option ${i + 1}`}
                      className="aspect-video w-full object-cover"
                    />
                    <button
                      type="button"
                      data-testid={`board-media-candidate-keep-${i}`}
                      className="w-full px-2 py-1 text-[11px] font-semibold"
                      style={{ backgroundColor: MEDIA_ACCENT_GREEN, color: "#15171B" }}
                      onClick={() => void keepCandidate(candidate)}
                    >
                      Keep this one
                    </button>
                  </div>
                ))}
              </div>
            </div>
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
                if (e.key === "Enter") void generateAssetSet();
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
              onClick={() => void generateAssetSet()}
            >
              {generating ? (
                <LoaderCircle size={13} className="animate-spin" aria-hidden />
              ) : (
                <Send size={13} aria-hidden />
              )}
            </button>
          </div>
          <p className="mt-1 px-0.5 text-[10px] leading-4" style={{ color: tokens.textMuted }}>
            Generates a set of {OPTION_SET_SIZE} options — pick one to keep; the rest are removed.
          </p>
        </div>
      )}
    </div>
  );
}
