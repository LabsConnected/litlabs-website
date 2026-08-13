"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import DragDropCanvas from "@/components/DragDropCanvas";
import Editor from "@monaco-editor/react";
import { Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResizableWidth } from "@/app/studio/hooks/useResizableWidth";
import ResizeHandle from "@/app/studio/components/shell/ResizeHandle";

interface CanvasItem {
  id: string;
  type: "text" | "image" | "shape" | "node";
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  locked?: boolean;
  visible?: boolean;
  zIndex?: number;
  data?: Record<string, unknown>;
}

const STORAGE_KEY = "litlabs:design-canvas:";

export default function DesignCanvas() {
  const { resolvedColors: T } = useTheme();
  const { getToken } = useClerkAuth();
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [code, setCode] = useState(
    `<div style="padding:24px;font-family:system-ui,sans-serif;">\n  <h1 style="margin:0 0 8px;font-size:24px;">Design Canvas</h1>\n  <p style="margin:0;opacity:.7;">Drag elements on the left, edit code on the right.</p>\n</div>`,
  );
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"canvas" | "code" | "split">("split");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resizable split — canvas pane width as percentage (20–80%)
  const [splitPct, setSplitPct] = useState<number>(() => {
    if (typeof window === "undefined") return 50;
    try {
      const stored = localStorage.getItem("littree:studio:design-split");
      return stored ? Math.min(80, Math.max(20, parseInt(stored, 10))) : 50;
    } catch {
      return 50;
    }
  });
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [isSplitDragging, setIsSplitDragging] = useState(false);

  const onSplitDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsSplitDragging(true);
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const container = splitContainerRef.current;
    if (!container) return;
    const startX = clientX;
    const startWidth = container.getBoundingClientRect().width;
    const startPct = splitPct;
    const onMove = (cx: number) => {
      const delta = cx - startX;
      const newPct = Math.min(80, Math.max(20, startPct + (delta / startWidth) * 100));
      setSplitPct(newPct);
    };
    const onMouseMove = (ev: MouseEvent) => { ev.preventDefault(); onMove(ev.clientX); };
    const onTouchMove = (ev: TouchEvent) => { if (ev.touches.length) onMove(ev.touches[0].clientX); };
    const onEnd = () => {
      setIsSplitDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onEnd);
      try { localStorage.setItem("littree:studio:design-split", String(splitPct)); } catch { /* ignore */ }
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onEnd);
  }, [splitPct]);

  // Persist split percentage
  useEffect(() => {
    try { localStorage.setItem("littree:studio:design-split", String(splitPct)); } catch { /* ignore */ }
  }, [splitPct]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        const token = await getToken?.();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch("/api/canvases?status=active&limit=20", { headers });
        if (res.ok) {
          const data = await res.json();
          const design = (data.canvases ?? []).find(
            (c: { type?: string; title?: string }) => c.type === "website" || c.title === "Design Canvas",
          );
          if (design && !cancelled) {
            setCanvasId(design.id);
            try {
              const stored = localStorage.getItem(STORAGE_KEY + design.id);
              if (stored) {
                const parsed = JSON.parse(stored);
                setItems(parsed.items ?? []);
                if (parsed.code) setCode(parsed.code);
              }
            } catch {
              // ignore corrupt storage
            }
            return;
          }
        }

        const post = await fetch("/api/canvases", {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "Design Canvas", type: "website" }),
        });
        if (post.ok) {
          const data = await post.json();
          if (!cancelled) setCanvasId(data.canvas.id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useEffect(() => {
    if (!canvasId) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(
        STORAGE_KEY + canvasId,
        JSON.stringify({ items, code, updatedAt: Date.now() }),
      );
    }, 250);
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [items, code, canvasId]);

  const handleItemsChange = useCallback((next: CanvasItem[]) => {
    setItems(next);
  }, []);

  const getPreviewHtml = useCallback(() => {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>body{margin:0;font-family:system-ui,sans-serif;background:#0a0a0f;color:#e8e8f0;}</style></head><body>${code}</body></html>`;
  }, [code]);

  const resetCanvas = useCallback(() => {
    setItems([]);
    setCode(
      `<div style="padding:24px;font-family:system-ui,sans-serif;">\n  <h1 style="margin:0 0 8px;font-size:24px;">Design Canvas</h1>\n  <p style="margin:0;opacity:.7;">Fresh canvas.</p>\n</div>`,
    );
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs" style={{ color: T.textMuted }}>
        Loading design canvas…
      </div>
    );
  }

  return (
    <div ref={splitContainerRef} className="flex h-full w-full overflow-hidden">
      <div
        className={cn(
          "h-full overflow-hidden",
          view === "code" ? "hidden" : "flex",
        )}
        style={{
          width: view === "split" ? `${splitPct}%` : "100%",
          borderRight: view === "split" ? `1px solid ${T.borderColor}25` : "none",
        }}
      >
        <DragDropCanvas items={items} onItemsChange={handleItemsChange} />
      </div>

      {/* Split resize handle */}
      {view === "split" && (
        <ResizeHandle
          onDragStart={onSplitDragStart}
          onReset={() => setSplitPct(50)}
          isDragging={isSplitDragging}
          direction="left"
          ariaLabel="Resize design split"
          testId="design-split-handle"
        />
      )}

      <div
        className={cn(
          "flex h-full flex-col",
          view === "canvas" ? "hidden" : "flex",
        )}
        style={{ width: view === "split" ? `${100 - splitPct}%` : "100%" }}
      >
        <div
          className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
          style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg }}
        >
          {(["split", "canvas", "code"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-2 py-1 text-[10px] font-bold capitalize rounded transition",
                view === v ? "bg-white/10" : "hover:bg-white/5",
              )}
              style={{ color: view === v ? T.textColor : T.textMuted }}
            >
              {v}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={resetCanvas}
              className="rounded p-1 transition hover:bg-white/10"
              title="Reset canvas"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language="html"
            theme="vs-dark"
            value={code}
            onChange={(val) => setCode(val ?? "")}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: "off",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
