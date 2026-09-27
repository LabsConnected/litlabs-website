"use client";

/**
 * ImageStudio — the shell's "images" stage surface: a real pixel editor
 * over the project's Asset Lake.
 *
 *   asset list (API: /api/assets?kind=image) → pick one → it loads onto
 *   a canvas → crop (drag on the preview) / rotate / flip / resize /
 *   adjustments → every op pushes onto an undoable stack → Save writes
 *   a real PNG into the workspace (assets/insert) or the Asset Lake
 *   (/api/upload + /api/assets registration with truthful provenance).
 *
 * The op stack is pure (lib/image-ops); the canvas render is
 * renderOpsToCanvas — what you see is exactly what exports.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, Crop, FlipHorizontal2, FlipVertical2, Image as ImageIcon,
  Loader2, Lock, RotateCcw, RotateCw, Sparkles, Unlock, Upload,
} from "lucide-react";
import type { StudioAsset } from "@/lib/assets/types";
import { notifyAssetsChanged, useAssetsRefreshTrigger } from "../../hooks/useAssetsRefresh";
import { useStudioContext } from "../../context/StudioContext";
import {
  clampCrop, currentOps, canRedo, canUndo, defaultOps,
  opsAreIdentity, outputSize, pushOp, redoOp, renderOpsToCanvas,
  resizeKeepingAspect, undoOp,
  type CropRect, type ImageOps, type OpHistory,
} from "../../lib/image-ops";

const MUTED = "var(--text-muted)";
const BORDER = "rgba(255,255,255,0.08)";

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveKind = "project" | "asset" | null;

function slugify(name: string): string {
  return (name || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "image";
}

export default function ImageStudio({ projectId, onOpenCreate }: { projectId: string | null; onOpenCreate?: () => void }) {
  const { setActiveAssetId } = useStudioContext();
  const refreshTrigger = useAssetsRefreshTrigger();

  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StudioAsset | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<OpHistory>({ stack: [defaultOps()], index: 0 });
  const ops = currentOps(history);

  const [cropMode, setCropMode] = useState(false);
  const [cropDraft, setCropDraft] = useState<CropRect | null>(null);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [saveBusy, setSaveBusy] = useState<SaveKind>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // ── asset list ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) { setAssets([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ kind: "image", limit: "60" });
        if (projectId) params.set("projectId", projectId);
        const res = await fetch(`/api/assets?${params}`, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`assets ${res.status}`);
        const json = (await res.json()) as { assets?: StudioAsset[] };
        if (!cancelled) { setAssets(json.assets ?? []); setAssetsError(null); }
      } catch (err) {
        if (!cancelled) setAssetsError(err instanceof Error ? err.message : "Failed to load assets");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, refreshTrigger]);

  // ── load image onto the editing canvas ──────────────────────────────
  const loadAsset = useCallback((asset: StudioAsset) => {
    setSelected(asset);
    setSavedNote(null);
    setSaveError(null);
    setCropMode(false);
    setCropDraft(null);
    setHistory({ stack: [defaultOps()], index: 0 });
    setLoadState("loading");
    setLoadError(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { setImage(img); setLoadState("ready"); };
    img.onerror = () => {
      setLoadState("error");
      setLoadError("Couldn't load this image into the editor (CORS or unreachable URL). Try Save-to-project assets or a re-upload.");
    };
    img.src = asset.url;
  }, []);

  const uploadFileRef = useRef<HTMLInputElement>(null);
  const handleUploadFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setSelected(null);
        setImage(img);
        setLoadState("ready");
        setLoadError(null);
        setHistory({ stack: [defaultOps()], index: 0 });
        setSavedNote(null);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // ── render ──────────────────────────────────────────────────────────
  const dirty = useMemo(() => !opsAreIdentity(ops), [ops]);
  const out = useMemo(
    () => (image ? outputSize(ops, image.naturalWidth || image.width, image.naturalHeight || image.height) : { w: 0, h: 0 }),
    [image, ops],
  );

  useEffect(() => {
    if (!image || loadState !== "ready") return;
    const rendered = renderOpsToCanvas(image, ops);
    const canvas = canvasRef.current;
    if (!rendered || !canvas) return;
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(rendered, 0, 0);
  }, [image, ops, loadState]);

  const apply = useCallback((next: ImageOps) => {
    setHistory((h) => pushOp(h, next));
  }, []);

  // ── crop drag (preview coords → image coords) ───────────────────────
  const scaleRef = useRef(1);
  const onCropDown = (e: React.PointerEvent) => {
    if (!cropMode || !canvasRef.current || !stageRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    scaleRef.current = out.w / Math.max(1, rect.width);
    const x = (e.clientX - rect.left) * scaleRef.current;
    const y = (e.clientY - rect.top) * scaleRef.current;
    dragStartRef.current = { x, y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setCropDraft({ x, y, w: 0, h: 0 });
  };
  const onCropMove = (e: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!cropMode || !start || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * scaleRef.current;
    const y = (e.clientY - rect.top) * scaleRef.current;
    setCropDraft({
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      w: Math.abs(x - start.x),
      h: Math.abs(y - start.y),
    });
  };
  const onCropUp = () => { dragStartRef.current = null; };
  const commitCrop = () => {
    if (!cropDraft || !image) return;
    const srcW = ops.crop ? ops.crop.w : image.naturalWidth || image.width;
    const srcH = ops.crop ? ops.crop.h : image.naturalHeight || image.height;
    // Crop is expressed in CURRENT-output coords → translate back into
    // source crop space (crop composes: new crop inside old crop).
    const base = ops.crop ?? { x: 0, y: 0, w: image.naturalWidth || image.width, h: image.naturalHeight || image.height };
    const rotated = ops.rotate === 90 || ops.rotate === 270;
    // For rotated previews the drag rect maps differently — keep v1
    // honest: crop composes in unrotated source space only before rotate.
    void rotated;
    const next = clampCrop(
      { x: base.x + cropDraft.x, y: base.y + cropDraft.y, w: cropDraft.w, h: cropDraft.h },
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    );
    void srcW; void srcH;
    if (next) apply({ ...ops, crop: next, resize: null });
    setCropDraft(null);
    setCropMode(false);
  };

  // ── save paths (real writes; no billing) ────────────────────────────
  const saveToProject = useCallback(async () => {
    if (!image || !projectId || saveBusy) return;
    setSaveBusy("project");
    setSaveError(null);
    setSavedNote(null);
    try {
      const canvas = renderOpsToCanvas(image, ops);
      if (!canvas) throw new Error("Canvas render unavailable");
      const dataUrl = canvas.toDataURL("image/png");
      const path = `public/assets/images/${slugify(selected?.name ?? "edited")}-${Date.now().toString(36)}.png`;
      const res = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/assets/insert`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dataUrl, path, kind: "image", name: `${selected?.name ?? "image"} (edited)` }),
      });
      const json = await res.json().catch(() => null) as { error?: string; path?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `insert ${res.status}`);
      setSavedNote(`Saved to ${json?.path ?? path}`);
      notifyAssetsChanged();
      window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, source: "image-edit" } }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaveBusy(null);
    }
  }, [image, projectId, ops, selected, saveBusy]);

  const saveAsAsset = useCallback(async () => {
    if (!image || saveBusy) return;
    setSaveBusy("asset");
    setSaveError(null);
    setSavedNote(null);
    try {
      const canvas = renderOpsToCanvas(image, ops);
      if (!canvas) throw new Error("Canvas render unavailable");
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("PNG export failed");
      const form = new FormData();
      form.append("file", new File([blob], `${slugify(selected?.name ?? "edited")}.png`, { type: "image/png" }));
      form.append("purpose", "studio-image-edit");
      const up = await fetch("/api/upload", { method: "POST", credentials: "same-origin", body: form });
      const upJson = await up.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!up.ok || !upJson?.url || !/^https?:/.test(upJson.url)) {
        throw new Error(upJson?.error ?? "Upload didn't produce a durable URL");
      }
      const reg = await fetch("/api/assets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          url: upJson.url,
          provider: "studio-editor",
          model: "canvas-2d",
          prompt: `Manual edit${selected?.name ? ` of ${selected.name}` : ""}`,
          projectId: projectId ?? undefined,
          width: canvas.width,
          height: canvas.height,
          metadata: { parentAssetId: selected?.id ?? null, editor: "image-studio" },
        }),
      });
      const regJson = await reg.json().catch(() => null) as { asset?: { id?: string }; error?: string } | null;
      if (!reg.ok) throw new Error(regJson?.error ?? `asset ${reg.status}`);
      if (regJson?.asset?.id) setActiveAssetId(regJson.asset.id);
      setSavedNote("Saved to Asset Lake");
      notifyAssetsChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaveBusy(null);
    }
  }, [image, ops, selected, projectId, saveBusy, setActiveAssetId]);

  // ── render ──────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="image-studio">
      {/* asset rail */}
      <div className="flex w-44 shrink-0 flex-col border-r" style={{ borderColor: BORDER }}>
        <div className="flex items-center justify-between border-b px-2.5 py-2" style={{ borderColor: BORDER }}>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>Images</span>
          <div className="flex items-center gap-1">
            <button type="button" title="Upload image" aria-label="Upload image" data-testid="image-studio-upload" className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/5" style={{ color: MUTED }} onClick={() => uploadFileRef.current?.click()}>
              <Upload size={12} />
            </button>
            {onOpenCreate && (
              <button type="button" title="Generate with LiTT" aria-label="Generate image" className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/5" style={{ color: "var(--litt-primary)" }} onClick={onOpenCreate}>
                <Sparkles size={12} />
              </button>
            )}
          </div>
        </div>
        <input ref={uploadFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ""; }} />
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {assetsError && <div className="p-2 text-[10px]" style={{ color: "#fca5a5" }}>{assetsError}</div>}
          {!projectId && <div className="p-2 text-[10px]" style={{ color: MUTED }}>Open a project to browse its images.</div>}
          {projectId && assets.length === 0 && !assetsError && (
            <div className="p-2 text-[10px]" style={{ color: MUTED }}>No images yet — generate one with LiTT or upload.</div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => loadAsset(a)}
                className="group relative aspect-square overflow-hidden rounded-md border text-left"
                style={{ borderColor: selected?.id === a.id ? "var(--litt-primary)" : BORDER }}
                data-testid={`image-asset-${a.id}`}
                title={a.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.thumbnailUrl ?? a.url} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* stage */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2.5 py-1.5" style={{ borderColor: BORDER }}>
          <ToolBtn label="Crop" testId="image-op-crop" active={cropMode} disabled={!image} onClick={() => { setCropMode((v) => !v); setCropDraft(null); }} icon={<Crop size={12} />} />
          <ToolBtn label="Rotate left" testId="image-op-rotate-left" disabled={!image} onClick={() => apply({ ...ops, rotate: ((ops.rotate + 270) % 360) as ImageOps["rotate"] })} icon={<RotateCcw size={12} />} />
          <ToolBtn label="Rotate right" testId="image-op-rotate-right" disabled={!image} onClick={() => apply({ ...ops, rotate: ((ops.rotate + 90) % 360) as ImageOps["rotate"] })} icon={<RotateCw size={12} />} />
          <ToolBtn label="Flip horizontal" testId="image-op-flip-h" active={ops.flipH} disabled={!image} onClick={() => apply({ ...ops, flipH: !ops.flipH })} icon={<FlipHorizontal2 size={12} />} />
          <ToolBtn label="Flip vertical" testId="image-op-flip-v" active={ops.flipV} disabled={!image} onClick={() => apply({ ...ops, flipV: !ops.flipV })} icon={<FlipVertical2 size={12} />} />
          <span className="mx-1 h-4 w-px" style={{ backgroundColor: BORDER }} />
          <ToolBtn label="Undo" testId="image-op-undo" disabled={!canUndo(history)} onClick={() => setHistory(undoOp)} icon={<RotateCcw size={12} />} />
          <ToolBtn label="Redo" testId="image-op-redo" disabled={!canRedo(history)} onClick={() => setHistory(redoOp)} icon={<RotateCw size={12} />} />
          <button
            type="button"
            disabled={!dirty}
            onClick={() => setHistory({ stack: [defaultOps()], index: 0 })}
            className="rounded-md border px-2 py-1 text-[10px] font-bold disabled:opacity-40"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            Reset
          </button>
          <span className="flex-1" />
          {image && (
            <span className="font-mono text-[10px]" style={{ color: MUTED }} data-testid="image-studio-size">
              {out.w}×{out.h}
            </span>
          )}
          <button
            type="button"
            disabled={!image || !projectId || !!saveBusy}
            onClick={() => { void saveToProject(); }}
            className="rounded-md border px-2.5 py-1 text-[10px] font-bold disabled:opacity-40"
            style={{ borderColor: "rgba(72,238,56,0.35)", color: "#48EE38" }}
            data-testid="image-studio-save-project"
          >
            {saveBusy === "project" ? <Loader2 size={10} className="inline animate-spin" /> : <Check size={10} className="inline" />} Save to project
          </button>
          <button
            type="button"
            disabled={!image || !!saveBusy}
            onClick={() => { void saveAsAsset(); }}
            className="rounded-md border px-2.5 py-1 text-[10px] font-bold disabled:opacity-40"
            style={{ borderColor: "rgba(155,77,255,0.35)", color: "var(--litt-primary)" }}
            data-testid="image-studio-save-asset"
          >
            {saveBusy === "asset" ? <Loader2 size={10} className="inline animate-spin" /> : null} Save as asset
          </button>
        </div>

        {/* canvas area */}
        <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4" style={{ background: "radial-gradient(circle at 50% 40%, rgba(139,92,246,0.05), transparent 50%)" }}>
          {loadState === "idle" && (
            <div className="text-center" style={{ color: MUTED }}>
              <ImageIcon size={22} className="mx-auto mb-2 opacity-60" />
              <p className="text-[12px] font-bold" style={{ color: "var(--text-secondary)" }}>Select an image to edit</p>
              <p className="mt-1 text-[10px]">Pick from the list, upload one, or generate with LiTT.</p>
            </div>
          )}
          {loadState === "loading" && <Loader2 size={18} className="animate-spin" style={{ color: MUTED }} />}
          {loadState === "error" && (
            <div className="max-w-xs text-center text-[11px]" style={{ color: "#fca5a5" }}>{loadError}</div>
          )}
          {loadState === "ready" && image && (
            <div className="relative" style={{ maxWidth: "100%", maxHeight: "100%" }}>
              <canvas
                ref={canvasRef}
                className="block max-h-full max-w-full rounded-md border"
                style={{ borderColor: BORDER, cursor: cropMode ? "crosshair" : "default", maxWidth: "min(100%, 720px)", maxHeight: "100%" }}
                data-testid="image-studio-canvas"
                onPointerDown={onCropDown}
                onPointerMove={onCropMove}
                onPointerUp={onCropUp}
              />
              {cropMode && cropDraft && cropDraft.w > 1 && cropDraft.h > 1 && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed"
                  style={{
                    borderColor: "var(--litt-primary)",
                    left: `${(cropDraft.x / out.w) * 100}%`,
                    top: `${(cropDraft.y / out.h) * 100}%`,
                    width: `${(cropDraft.w / out.w) * 100}%`,
                    height: `${(cropDraft.h / out.h) * 100}%`,
                  }}
                  data-testid="image-crop-rect"
                />
              )}
            </div>
          )}
        </div>

        {/* crop confirm + resize + filters strip */}
        {loadState === "ready" && image && (
          <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: BORDER }}>
            {cropMode && (
              <div className="mb-2 flex items-center gap-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                <span>Drag on the image to pick the crop area.</span>
                <button type="button" className="rounded-md border px-2 py-0.5 font-bold disabled:opacity-40" style={{ borderColor: "rgba(72,238,56,0.4)", color: "#48EE38" }} disabled={!cropDraft || cropDraft.w < 2} onClick={commitCrop} data-testid="image-crop-apply">Apply crop</button>
                <button type="button" className="rounded-md border px-2 py-0.5 font-bold" style={{ borderColor: BORDER, color: MUTED }} onClick={() => { setCropMode(false); setCropDraft(null); }}>Cancel</button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* resize */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold uppercase" style={{ color: MUTED }}>Size</span>
                <input type="number" className="w-16 rounded-md border bg-black/20 px-1.5 py-0.5 text-[11px]" style={{ borderColor: BORDER, color: "var(--text-main)" }} value={ops.resize?.w ?? out.w} data-testid="image-resize-w" onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!v) return;
                  const base = { w: out.w, h: out.h };
                  apply({ ...ops, resize: aspectLocked ? resizeKeepingAspect(base, "w", v) : { w: v, h: ops.resize?.h ?? out.h } });
                }} />
                <button type="button" className="grid h-6 w-6 place-items-center rounded-md" style={{ color: MUTED }} aria-label={aspectLocked ? "Unlock aspect" : "Lock aspect"} data-testid="image-aspect-lock" onClick={() => setAspectLocked((v) => !v)}>
                  {aspectLocked ? <Lock size={10} /> : <Unlock size={10} />}
                </button>
                <input type="number" className="w-16 rounded-md border bg-black/20 px-1.5 py-0.5 text-[11px]" style={{ borderColor: BORDER, color: "var(--text-main)" }} value={ops.resize?.h ?? out.h} data-testid="image-resize-h" onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!v) return;
                  const base = { w: out.w, h: out.h };
                  apply({ ...ops, resize: aspectLocked ? resizeKeepingAspect(base, "h", v) : { w: ops.resize?.w ?? out.w, h: v } });
                }} />
              </div>
              {/* filters */}
              {([
                ["brightness", "Brightness", 200], ["contrast", "Contrast", 200],
                ["saturate", "Saturation", 200], ["grayscale", "Grayscale", 100],
                ["sepia", "Sepia", 100], ["blur", "Blur", 20],
              ] as const).map(([key, label, max]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <span className="w-16 text-right text-[9px] font-bold uppercase" style={{ color: MUTED }}>{label}</span>
                  <input
                    type="range" min={0} max={max} step={1}
                    value={ops.filters[key]}
                    data-testid={`image-filter-${key}`}
                    onChange={(e) => apply({ ...ops, filters: { ...ops.filters, [key]: parseInt(e.target.value, 10) } })}
                    className="w-20"
                  />
                  <span className="w-7 font-mono text-[9px]" style={{ color: MUTED }}>{ops.filters[key]}</span>
                </label>
              ))}
            </div>
            {(savedNote || saveError) && (
              <div className="mt-2 text-[10px]" style={{ color: savedNote ? "#48EE38" : "#fca5a5" }} data-testid="image-studio-save-status">
                {savedNote ?? saveError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({ label, testId, active, disabled, onClick, icon }: {
  label: string; testId?: string; active?: boolean; disabled?: boolean;
  onClick: () => void; icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md border transition disabled:opacity-40"
      style={{
        borderColor: active ? "var(--litt-primary)" : BORDER,
        color: active ? "var(--litt-primary)" : MUTED,
        backgroundColor: active ? "rgba(155,77,255,0.12)" : "transparent",
      }}
    >
      {icon}
    </button>
  );
}
