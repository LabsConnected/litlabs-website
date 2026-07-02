"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import Palette from "./Palette";
import { DEFAULT_COLOR_PALETTE } from "@/lib/color-templates";

export type ColorRegion = {
  id: number;
  colorNumber: number;
  pixels: number;
};

type RegionInfo = {
  regionMap: number[];
  w: number;
  h: number;
  isOutline: (x: number, y: number) => boolean;
};

export default function ColorByNumber({
  svgString,
  width = 400,
  height = 400,
  onExport,
}: {
  svgString: string;
  width?: number;
  height?: number;
  onExport?: (dataUrl: string) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const infoRef = useRef<RegionInfo | null>(null);
  const [regions, setRegions] = useState<ColorRegion[]>([]);
  const [selectedColor, setSelectedColor] = useState(1);
  const [filledRegions, setFilledRegions] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const palette = useMemo(() => DEFAULT_COLOR_PALETTE.slice(0, 8), []);

  const OUTLINE_THRESHOLD = 60;

  const progress = useMemo(() => {
    if (regions.length === 0) return 0;
    const total = regions.reduce((sum, r) => sum + r.pixels, 0);
    const filled = regions
      .filter((r) => filledRegions.has(r.id))
      .reduce((sum, r) => sum + r.pixels, 0);
    return Math.round((filled / total) * 100);
  }, [regions, filledRegions]);

  const detectRegions = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const visited = new Uint8Array(w * h);
      let regionId = 0;
      const regionMap: number[] = new Array(w * h).fill(-1);
      const regionCounts: Record<number, number> = {};

      const isOutline = (x: number, y: number) => {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const brightness = (r + g + b) / 3;
        return brightness < 255 - OUTLINE_THRESHOLD;
      };

      const floodFill = (sx: number, sy: number) => {
        const stack: [number, number][] = [[sx, sy]];
        let count = 0;
        while (stack.length > 0) {
          const [x, y] = stack.pop()!;
          const idx = y * w + x;
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          if (visited[idx]) continue;
          if (isOutline(x, y)) continue;
          visited[idx] = 1;
          regionMap[idx] = regionId;
          count++;
          stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
        return count;
      };

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (!visited[idx] && !isOutline(x, y)) {
            const count = floodFill(x, y);
            if (count > 50) {
              regionCounts[regionId] = count;
              regionId++;
            }
          }
        }
      }

      const detected: ColorRegion[] = Object.keys(regionCounts).map((id, i) => ({
        id: Number(id),
        colorNumber: (i % palette.length) + 1,
        pixels: regionCounts[Number(id)],
      }));

      setRegions(detected);
      infoRef.current = { regionMap, w, h, isOutline };
    },
    [palette]
  );

  const drawScene = useCallback(
    (
      visibleCtx: CanvasRenderingContext2D,
      vw: number,
      vh: number,
      hiddenCtx: CanvasRenderingContext2D,
      overlayCtx: CanvasRenderingContext2D
    ) => {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      visibleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      visibleCtx.clearRect(0, 0, vw / dpr, vh / dpr);
      visibleCtx.fillStyle = "#ffffff";
      visibleCtx.fillRect(0, 0, vw / dpr, vh / dpr);

      visibleCtx.drawImage(overlayCtx.canvas, 0, 0, vw / dpr, vh / dpr);
      visibleCtx.drawImage(hiddenCtx.canvas, 0, 0, vw / dpr, vh / dpr);

      const info = infoRef.current;
      if (!info || regions.length === 0) return;
      const { regionMap, w } = info;

      visibleCtx.font = "bold 14px sans-serif";
      visibleCtx.textAlign = "center";
      visibleCtx.textBaseline = "middle";

      regions.forEach((region) => {
        if (filledRegions.has(region.id)) return;
        let sumX = 0, sumY = 0, count = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * w + x;
            if (regionMap[idx] === region.id) {
              sumX += x;
              sumY += y;
              count++;
            }
          }
        }
        if (count > 0) {
          const cx = (sumX / count) * (vw / dpr / width);
          const cy = (sumY / count) * (vh / dpr / height);
          const color = palette.find((c) => c.number === region.colorNumber);
          visibleCtx.fillStyle = color ? color.color : "#000";
          visibleCtx.fillText(String(region.colorNumber), cx, cy);
        }
      });
    },
    [regions, filledRegions, palette, width, height]
  );

  const fillRegion = useCallback(
    (regionId: number, colorNumber: number) => {
      const overlay = overlayRef.current;
      const info = infoRef.current;
      if (!overlay || !info) return;
      const ctx = overlay.getContext("2d");
      if (!ctx) return;

      const color = palette.find((c) => c.number === colorNumber);
      if (!color) return;

      const imageData = ctx.getImageData(0, 0, overlay.width, overlay.height);
      const data = imageData.data;
      const dpr = window.devicePixelRatio || 1;
      const scaleX = overlay.width / dpr / info.w;
      const scaleY = overlay.height / dpr / info.h;

      const hex = color.color;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);

      for (let y = 0; y < info.h; y++) {
        for (let x = 0; x < info.w; x++) {
          if (info.regionMap[y * info.w + x] === regionId) {
            const vx = Math.floor(x * scaleX);
            const vy = Math.floor(y * scaleY);
            const idx = (vy * overlay.width + vx) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      setFilledRegions((prev) => new Set(prev).add(regionId));
    },
    [palette]
  );

  // Load SVG and detect regions once when svgString changes
  useEffect(() => {
    if (!canvasRef.current || !hiddenRef.current || !overlayRef.current) return;
    const hidden = hiddenRef.current;
    const overlay = overlayRef.current;
    const visible = canvasRef.current;
    const hiddenCtx = hidden.getContext("2d", { willReadFrequently: true });
    const overlayCtx = overlay.getContext("2d");
    const visibleCtx = visible.getContext("2d");
    if (!hiddenCtx || !overlayCtx || !visibleCtx) return;

    setError(null);
    setFilledRegions(new Set());
    setRegions([]);

    hidden.width = width;
    hidden.height = height;
    overlay.width = width * 2;
    overlay.height = height * 2;
    visible.width = width * 2;
    visible.height = height * 2;

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    visibleCtx.clearRect(0, 0, visible.width, visible.height);

    const img = new Image();
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      hiddenCtx.clearRect(0, 0, width, height);
      hiddenCtx.fillStyle = "#ffffff";
      hiddenCtx.fillRect(0, 0, width, height);
      hiddenCtx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      detectRegions(hiddenCtx, width, height);
    };

    img.onerror = () => {
      setError("Failed to load outline image");
      URL.revokeObjectURL(url);
    };

    img.src = url;
  }, [svgString, width, height, detectRegions]);

  // Redraw scene whenever regions or filledRegions change
  useEffect(() => {
    if (!canvasRef.current || !hiddenRef.current || !overlayRef.current) return;
    const visible = canvasRef.current;
    const hiddenCtx = hiddenRef.current.getContext("2d");
    const overlayCtx = overlayRef.current.getContext("2d");
    const visibleCtx = visible.getContext("2d");
    if (!hiddenCtx || !overlayCtx || !visibleCtx) return;
    drawScene(visibleCtx, visible.width, visible.height, hiddenCtx, overlayCtx);
  }, [regions, filledRegions, drawScene]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const info = infoRef.current;
      if (!canvas || !info) return;

      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * info.w);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * info.h);
      if (x < 0 || x >= info.w || y < 0 || y >= info.h) return;
      if (info.isOutline(x, y)) return;

      const regionId = info.regionMap[y * info.w + x];
      if (regionId === -1) return;
      if (filledRegions.has(regionId)) return;

      fillRegion(regionId, selectedColor);
    },
    [selectedColor, fillRegion, filledRegions]
  );

  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas || !onExport) return;
    onExport(canvas.toDataURL("image/png"));
  };

  const handleReset = () => {
    setFilledRegions(new Set());
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext("2d");
    if (overlay && ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
  };

  const handleFillAll = () => {
    regions.forEach((r) => fillRegion(r.id, r.colorNumber));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
        <div>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>
            Palette
          </div>
          <Palette colors={palette} active={selectedColor} onSelect={setSelectedColor} />
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs font-bold" style={{ color: T.accentColor }}>
            {progress}% complete
          </div>
          <div className="w-32 h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.borderColor + "40" }}>
            <div
              className="h-full transition-all"
              style={{ width: `${progress}%`, backgroundColor: T.accentColor }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleFillAll}
          className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border"
          style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40", color: T.textColor }}
        >
          Fill All
        </button>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border"
          style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40", color: T.textColor }}
        >
          Reset
        </button>
        {onExport && (
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border"
            style={{ backgroundColor: T.accentColor, borderColor: T.accentColor, color: "#000" }}
          >
            Export PNG
          </button>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}

      <div className="relative border rounded-2xl overflow-hidden" style={{ borderColor: T.borderColor + "40" }}>
        <canvas
          ref={canvasRef}
          width={width * 2}
          height={height * 2}
          style={{ width: "100%", maxWidth: 600, aspectRatio: `${width} / ${height}`, cursor: "crosshair" }}
          onClick={handleCanvasClick}
        />
        <canvas ref={hiddenRef} className="hidden" />
        <canvas ref={overlayRef} className="hidden" />
      </div>

      <p className="text-[10px]" style={{ color: T.textMuted }}>
        Click a number, then tap a region to fill it. Use the same number on matching regions for faster coloring.
      </p>
    </div>
  );
}
