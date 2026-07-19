"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Upload, X } from "lucide-react";
import { updateRetroGame, type RetroGameRecord } from "@/lib/retro-arcade";
import RetroArtwork from "./RetroArtwork";

type Props = {
  game: RetroGameRecord;
  open: boolean;
  onClose: () => void;
  onUpdated: (game: RetroGameRecord) => void;
};

const MAX_ARTWORK_SIZE = 2 * 1024 * 1024;

export default function RetroArtworkDialog({ game, open, onClose, onUpdated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setPreviewUrl(game.customArtworkUrl ?? null);
    }
  }, [open, game.customArtworkUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleFile(file?: File) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_ARTWORK_SIZE) {
      setError("Artwork must be under 2 MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG, WebP, or SVG).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setPreviewUrl(result);
      }
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsDataURL(file);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateRetroGame(game.id, {
        customArtworkUrl: previewUrl ?? undefined,
      });
      onUpdated(updated);
      onClose();
    } catch {
      setError("Could not save artwork. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeArtwork() {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateRetroGame(game.id, {
        customArtworkUrl: undefined,
      });
      onUpdated(updated);
      onClose();
    } catch {
      setError("Could not remove artwork.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Manage artwork for ${game.title}`}
    >
      <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#111119] p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.25em] text-fuchsia-300">
              Custom artwork
            </div>
            <h2 className="mt-1 text-xl font-black text-white">{game.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 flex gap-4">
          <div className="relative aspect-3/4 w-32 shrink-0 overflow-hidden rounded-xl border border-white/10">
            <RetroArtwork
              system={game.system}
              title={game.title}
              subtitle={game.subtitle}
              accent={game.artworkAccent}
              customArtworkUrl={previewUrl}
              ratio="cover"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-black text-white transition hover:bg-white/10"
            >
              <Upload size={14} /> Upload image
            </button>
            {game.customArtworkUrl && (
              <button
                onClick={removeArtwork}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-400/5 py-2.5 text-xs font-black text-red-300 transition hover:bg-red-400/10 disabled:opacity-50"
              >
                <Trash2 size={14} /> Remove custom
              </button>
            )}
            <p className="text-[10px] leading-4 text-white/35">
              PNG, JPG, WebP, or SVG. Max 2 MB. Artwork is stored locally in your
              browser and never uploaded.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={save}
            disabled={busy || previewUrl === (game.customArtworkUrl ?? null)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-fuchsia-500 to-violet-600 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ImagePlus size={16} />
            {busy ? "Saving…" : "Save artwork"}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
