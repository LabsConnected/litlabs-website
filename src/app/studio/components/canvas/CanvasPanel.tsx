"use client";

import { useEffect, useCallback, useState } from "react";
import { useCanvasStore, executeAction } from "../../stores/useCanvasStore";
import { BlockRenderer } from "./BlockRenderer";
import { cn } from "@/lib/utils";
import type { ArtifactAction, CanvasBlock, Canvas } from "@/lib/canvas/types";

interface CanvasPanelProps {
  /** When an action chip is clicked in chat, pass it here to execute */
  pendingAction?: ArtifactAction | null;
  onActionExecuted?: (action: ArtifactAction) => void;
}

/**
 * CanvasPanel — the main Canvas workspace panel.
 *
 * Shows the active canvas with its blocks, a canvas switcher,
 * and handles action execution from chat.
 *
 * On desktop: renders as a full-height panel (placed in a split-pane by StudioOS).
 * On mobile: rendered inside a bottom sheet (Phase 3).
 */
export function CanvasPanel({ pendingAction, onActionExecuted }: CanvasPanelProps) {
  const {
    canvases,
    activeCanvasId,
    blocks,
    loading,
    error,
    setActiveCanvas,
    setBlocks,
    upsertCanvas,
    appendBlocks,
    updateBlock: updateBlockStore,
    removeBlock: removeBlockStore,
    removeCanvas,
    setLoading,
    setError,
  } = useCanvasStore();

  const [showSwitcher, setShowSwitcher] = useState(false);

  // ─── Load canvases on mount ─────────────────────────────────
  useEffect(() => {
    void loadCanvases();
  }, []);

  const loadCanvases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/canvases?status=active");
      if (!res.ok) throw new Error("Failed to load canvases");
      const data = await res.json();
      useCanvasStore.getState().setCanvases(data.canvases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load canvases");
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  // ─── Load blocks when active canvas changes ─────────────────
  useEffect(() => {
    if (!activeCanvasId) return;
    if (blocks[activeCanvasId]) return; // already loaded
    void loadBlocks(activeCanvasId);
  }, [activeCanvasId, blocks]);

  const loadBlocks = useCallback(async (canvasId: string) => {
    try {
      const res = await fetch(`/api/canvases/${canvasId}`);
      if (!res.ok) throw new Error("Failed to load canvas");
      const data = await res.json();
      if (data.canvas) upsertCanvas(data.canvas);
      setBlocks(canvasId, data.blocks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load blocks");
    }
  }, [upsertCanvas, setBlocks, setError]);

  // ─── Execute pending action from chat ───────────────────────
  useEffect(() => {
    if (!pendingAction) return;
    void (async () => {
      const result = await executeAction(pendingAction);
      if (result.ok && result.data) {
        const data = result.data as {
          canvas?: { id: string };
          blocks?: CanvasBlock[];
        };
        // If a canvas was created, set it active and load blocks
        if (data.canvas?.id) {
          await loadBlocks(data.canvas.id);
          setActiveCanvas(data.canvas.id);
          if (data.blocks) setBlocks(data.canvas.id, data.blocks);
        }
        // If blocks were appended, update the store
        if (data.blocks && pendingAction.type === "canvas.append") {
          appendBlocks(pendingAction.canvasId, data.blocks);
        }
      }
      onActionExecuted?.(pendingAction);
    })();
  }, [pendingAction, onActionExecuted, loadBlocks, setActiveCanvas, setBlocks, appendBlocks]);

  // ─── Block update handler ───────────────────────────────────
  const handleUpdateBlock = useCallback(
    async (blockId: string, patch: Record<string, unknown>) => {
      if (!activeCanvasId) return;
      // Optimistic update
      updateBlockStore(activeCanvasId, blockId, { content: { ...patch } });
      try {
        await fetch(`/api/canvases/${activeCanvasId}/blocks/${blockId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch, actor: "user" }),
        });
      } catch {
        // Revert on error by reloading
        await loadBlocks(activeCanvasId);
      }
    },
    [activeCanvasId, updateBlockStore, loadBlocks],
  );

  // ─── Block delete handler ───────────────────────────────────
  const handleDeleteBlock = useCallback(
    async (blockId: string) => {
      if (!activeCanvasId) return;
      removeBlockStore(activeCanvasId, blockId);
      try {
        await fetch(`/api/canvases/${activeCanvasId}/blocks/${blockId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actor: "user" }),
        });
      } catch {
        await loadBlocks(activeCanvasId);
      }
    },
    [activeCanvasId, removeBlockStore, loadBlocks],
  );

  // ─── Undo handler ───────────────────────────────────────────
  const handleUndo = useCallback(async () => {
    if (!activeCanvasId) return;
    try {
      const res = await fetch(`/api/canvases/${activeCanvasId}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "user" }),
      });
      if (!res.ok) throw new Error("Undo failed");
      // Reload blocks after undo
      await loadBlocks(activeCanvasId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    }
  }, [activeCanvasId, loadBlocks, setError]);

  // ─── Render ─────────────────────────────────────────────────
  const activeCanvas = canvases.find((c) => c.id === activeCanvasId);
  const activeBlocks = activeCanvasId ? blocks[activeCanvasId] ?? [] : [];

  if (loading && canvases.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-white/40 text-sm">
        Loading canvases...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setShowSwitcher(!showSwitcher)}
            className="text-sm font-medium text-white truncate hover:text-cyan-300 transition-colors"
          >
            {activeCanvas ? activeCanvas.title : "No canvas selected"}
          </button>
          {activeCanvas && (
            <span className="text-[10px] text-white/30 shrink-0">v{activeCanvas.version}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {activeCanvas && (
            <button
              onClick={handleUndo}
              className="text-xs text-white/40 hover:text-white/80 transition-colors px-2 py-1 rounded hover:bg-white/5"
              title="Undo last change"
            >
              ↶ Undo
            </button>
          )}
          <button
            onClick={() => void loadCanvases()}
            className="text-xs text-white/40 hover:text-white/80 transition-colors px-2 py-1 rounded hover:bg-white/5"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Canvas switcher dropdown */}
      {showSwitcher && (
        <div className="border-b border-white/5 bg-black/40 px-2 py-2 max-h-48 overflow-y-auto">
          {canvases.length === 0 ? (
            <div className="text-xs text-white/30 px-2 py-1">No canvases yet</div>
          ) : (
            canvases.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setActiveCanvas(c.id);
                  setShowSwitcher(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors",
                  c.id === activeCanvasId
                    ? "bg-cyan-500/10 text-cyan-300"
                    : "text-white/70 hover:bg-white/5",
                )}
              >
                <span className="truncate">{c.title}</span>
                <span className="text-[10px] text-white/30 shrink-0 ml-2">{c.type}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Blocks */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {activeBlocks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-white/30 text-sm mb-2">
              {activeCanvas ? "This canvas is empty" : "No canvas selected"}
            </div>
            {activeCanvas && (
              <div className="text-white/20 text-xs">
                LiTT will add blocks here as you work together.
                <br />
                Try saying &quot;make notes&quot; or &quot;open in canvas&quot; in chat.
              </div>
            )}
          </div>
        ) : (
          activeBlocks.map((block) => (
            <BlockRenderer
              key={block.id}
              block={block}
              onUpdate={(patch) => void handleUpdateBlock(block.id, patch)}
              onDelete={() => void handleDeleteBlock(block.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
