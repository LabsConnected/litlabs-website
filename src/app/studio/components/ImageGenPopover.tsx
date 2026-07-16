"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Loader2,
  Sparkles,
  Download,
  X,
  Wand2,
  Send,
  RefreshCw,
} from "lucide-react";
import type { MediaProviderId } from "@/lib/media";

/* ─── Constants ───────────────────────────────────────────────────────── */

const ASPECT_OPTIONS = [
  { label: "1:1", value: "1:1", width: 1024, height: 1024, icon: "▪" },
  { label: "16:9", value: "16:9", width: 1344, height: 768, icon: "▬" },
  { label: "9:16", value: "9:16", width: 768, height: 1344, icon: "▮" },
  { label: "4:3", value: "4:3", width: 1024, height: 768, icon: "▭" },
  { label: "3:4", value: "3:4", width: 768, height: 1024, icon: "▯" },
] as const;

const STYLE_PRESETS = [
  "None",
  "Cyberpunk neon noir",
  "Photorealistic",
  "Anime studio ghibli",
  "Oil painting Renaissance",
  "Watercolor impressionist",
  "3D Render octane",
  "Cinematic film",
  "Pixel art 16-bit",
  "Synthwave 80s",
  "Dark fantasy gothic",
  "Minimal clean vector",
  "Vaporwave aesthetic",
];

const PROVIDER_OPTIONS: {
  id: MediaProviderId;
  label: string;
  tag: string;
  desc: string;
}[] = [
  {
    id: "pollinations",
    label: "Pollinations",
    tag: "FREE",
    desc: "FLUX · No key needed",
  },
  {
    id: "gemini",
    label: "Gemini",
    tag: "Imagen3",
    desc: "Google Gemini",
  },
  {
    id: "together",
    label: "Together.ai",
    tag: "FLUX.1",
    desc: "Together AI",
  },
  {
    id: "fal",
    label: "FAL.ai",
    tag: "Pro",
    desc: "Fal.ai",
  },
  {
    id: "openai",
    label: "DALL-E 3",
    tag: "OpenAI",
    desc: "OpenAI DALL-E",
  },
];

/* ─── Component ──────────────────────────────────────────────────────── */

interface ImageGenPopoverProps {
  open: boolean;
  onClose: () => void;
  initialPrompt?: string;
  onInsert: (url: string, name: string) => void;
}

type GenStatus = "idle" | "generating" | "done" | "error";

export default function ImageGenPopover({
  open,
  onClose,
  initialPrompt = "",
  onInsert,
}: ImageGenPopoverProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectIdx, setAspectIdx] = useState(0);
  const [styleIdx, setStyleIdx] = useState(0);
  const [providerId, setProviderId] = useState<MediaProviderId>("pollinations");
  const [status, setStatus] = useState<GenStatus>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Sync prompt when popover opens
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setStatus("idle");
      setResultUrl(null);
      setError(null);
    }
  }, [open, initialPrompt]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const aspect = ASPECT_OPTIONS[aspectIdx];

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Enter a prompt to generate.");
      return;
    }
    setError(null);
    setResultUrl(null);
    setStatus("generating");

    const stylePreset = STYLE_PRESETS[styleIdx];
    const finalPrompt =
      stylePreset === "None"
        ? trimmed
        : `${trimmed}, ${stylePreset.toLowerCase()}`;

    try {
      const res = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          providerId,
          format: "image",
          width: aspect.width,
          height: aspect.height,
          aspectRatio: aspect.value,
          seed: Math.floor(Math.random() * 2147483647),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      setResultUrl(data.downloadUrl || data.thumbUrl || null);
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      setError(msg);
      setStatus("error");
    }
  }, [prompt, styleIdx, providerId, aspect]);

  const handleInsert = useCallback(() => {
    if (!resultUrl) return;
    onInsert(resultUrl, `generated-${Date.now()}.png`);
    onClose();
  }, [resultUrl, onInsert, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-110 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-120 flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Generate image"
          className="pointer-events-auto w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0a14] shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-500/10 text-cyan-400">
                <Wand2 size={15} />
              </span>
              <span className="text-sm font-black text-white">Generate Image</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-4 p-4">
            {/* Prompt */}
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleGenerate();
                  }
                }}
                placeholder="Describe the image you want to create..."
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-500 focus:border-cyan-500/30 focus:bg-white/8"
                autoFocus
              />
            </div>

            {/* Aspect ratio */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Aspect ratio
              </label>
              <div className="flex gap-1.5">
                {ASPECT_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.value}
                    onClick={() => setAspectIdx(i)}
                    className={`flex flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition ${
                      aspectIdx === i
                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                        : "border-white/10 text-gray-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="text-sm">{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Style preset */}
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Style
              </label>
              <div className="flex flex-wrap gap-1.5">
                {STYLE_PRESETS.map((style, i) => (
                  <button
                    key={style}
                    onClick={() => setStyleIdx(i)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
                      styleIdx === i
                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                        : "border-white/10 text-gray-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            {/* Provider */}
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Provider
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PROVIDER_OPTIONS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProviderId(p.id)}
                    title={p.desc}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition ${
                      providerId === p.id
                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                        : "border-white/10 text-gray-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span>{p.label}</span>
                    <span
                      className={`rounded px-1 text-[8px] ${
                        p.tag === "FREE"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-white/10 text-gray-400"
                      }`}
                    >
                      {p.tag}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            {/* Result preview */}
            {resultUrl && status === "done" && (
              <div className="flex flex-col gap-2">
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt="Generated result"
                    className="mx-auto max-h-64 w-auto object-contain"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleInsert}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/25"
                  >
                    <Send size={13} /> Insert into chat
                  </button>
                  <a
                    href={resultUrl}
                    download={`litlabs-${Date.now()}.png`}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 transition hover:bg-white/5"
                  >
                    <Download size={13} /> Save
                  </a>
                  <button
                    onClick={handleGenerate}
                    aria-label="Regenerate"
                    className="flex items-center justify-center rounded-lg border border-white/10 px-3 py-2 text-gray-300 transition hover:bg-white/5"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={status === "generating" || !prompt.trim()}
              className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500/15 px-4 py-3 text-sm font-black text-cyan-300 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "generating" ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Generate
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
