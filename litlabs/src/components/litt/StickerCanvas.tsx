"use client";

import { useState, useRef } from "react";
import { LITT } from "./litt-theme";

interface StickerCanvasProps {
  onSendToLiTT?: (prompt: string) => void;
}

export function StickerCanvas({ onSendToLiTT }: StickerCanvasProps) {
  const [text, setText] = useState("LiTT");
  const [style, setStyle] = useState("neon");
  const [color, setColor] = useState<string>(LITT.accentCyan);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const styles = ["neon", "retro", "cyber", "minimal"];

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `litt-sticker-${style}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  const handleAskLiTT = () => {
    const prompt = `Design a ${style} sticker for "${text}" using ${color}. Suggest a composition, background, and export size.`;
    onSendToLiTT?.(prompt);
  };

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: LITT.border, backgroundColor: LITT.bgPanel }}
    >
      <h3 className="mb-1 text-lg font-bold" style={{ color: LITT.text }}>
        Sticker Canvas
      </h3>
      <p className="mb-4 text-sm" style={{ color: LITT.textMuted }}>
        Sketch a sticker concept and ask LiTT to refine it.
      </p>

      <canvas
        ref={canvasRef}
        width={240}
        height={240}
        className="mb-4 w-full rounded-lg border"
        style={{
          backgroundColor: LITT.bg,
          borderColor: LITT.border,
          height: 200,
        }}
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Sticker text"
          className="rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: LITT.bg,
            borderColor: LITT.border,
            color: LITT.text,
          }}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-full w-full cursor-pointer rounded-lg border bg-transparent p-1"
          style={{ borderColor: LITT.border }}
        />
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2">
        {styles.map((s) => (
          <button
            key={s}
            onClick={() => setStyle(s)}
            className="rounded-md border px-2 py-1 text-xs font-medium"
            style={{
              borderColor: style === s ? LITT.accentCyan : LITT.border,
              backgroundColor: style === s ? "rgba(163,245,70,0.12)" : LITT.bg,
              color: style === s ? LITT.accentCyan : LITT.textMuted,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleAskLiTT}
          disabled={!onSendToLiTT}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
          style={{ backgroundColor: LITT.accentOrange, color: "#000" }}
        >
          Ask LiTT
        </button>
        <button
          onClick={handleDownload}
          className="rounded-lg border px-4 py-2 text-sm font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: LITT.border, color: LITT.textMuted }}
        >
          Download PNG
        </button>
      </div>
    </div>
  );
}
