"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useCanvasStore, executeAction } from "../../stores/useCanvasStore";
import { useStudioAgentStore, AGENT_META, type ChatMessage } from "../../stores/useStudioAgentStore";
import { useConversationStore } from "../../stores/useConversationStore";
import { BlockRenderer } from "./BlockRenderer";
import { RevisionHistory } from "./RevisionHistory";
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
    setLoading,
    setError,
  } = useCanvasStore();

  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPromoteConfirm, setShowPromoteConfirm] = useState(false);

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const canonicalMessages = useConversationStore((s) => s.messagesByConversationId[s.selectedConversationId ?? ""] ?? []);
  const chatMessages = useMemo(
    () => canonicalMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, createdAt: new Date(m.createdAt).getTime() || Date.now() }) as ChatMessage),
    [canonicalMessages],
  );

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

  // ─── Load canvases on mount ─────────────────────────────────
  useEffect(() => {
    void loadCanvases();
  }, [loadCanvases]);

  // ─── Load blocks when active canvas changes ─────────────────
  useEffect(() => {
    if (!activeCanvasId) return;
    if (blocks[activeCanvasId]) return; // already loaded
    void loadBlocks(activeCanvasId);
  }, [activeCanvasId, blocks, loadBlocks]);

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

  // ─── Promote to project handler ────────────────────────────
  const activeCanvas = canvases.find((c) => c.id === activeCanvasId);
  const handlePromote = useCallback(async () => {
    if (!activeCanvasId) return;
    try {
      const res = await fetch(`/api/canvases/${activeCanvasId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to promote canvas");
      }
      const data = await res.json();
      setShowPromoteConfirm(false);
      // Reload the canvas to reflect the new project link
      await loadBlocks(activeCanvasId);
      // Update the canvas in the store
      if (data.project) {
        upsertCanvas({ ...activeCanvas, projectId: data.projectId } as Canvas);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promotion failed");
    }
  }, [activeCanvasId, loadBlocks, upsertCanvas, activeCanvas, setError]);

  // ─── Render ─────────────────────────────────────────────────
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
            <>
              <button
                onClick={handleUndo}
                className="text-xs text-white/40 hover:text-white/80 transition-colors px-2 py-1 rounded hover:bg-white/5"
                title="Undo last change"
              >
                ↶ Undo
              </button>
              <button
                onClick={() => setShowHistory(true)}
                className="text-xs text-white/40 hover:text-white/80 transition-colors px-2 py-1 rounded hover:bg-white/5"
                title="Revision history"
              >
                History
              </button>
              {activeCanvas.projectId === null && (
                <button
                  onClick={() => setShowPromoteConfirm(true)}
                  className="text-xs text-violet-300/70 hover:text-violet-300 transition-colors px-2 py-1 rounded hover:bg-violet-500/10"
                  title="Promote canvas to a Project"
                >
                  Promote
                </button>
              )}
            </>
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
          chatMessages.length > 0 ? (
            <div className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-2">
                Live Conversation
              </div>
              {chatMessages.map((msg, i) => {
                const isUser = msg.role === "user";
                const agentMeta = AGENT_META[activeAgentId];
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-sm",
                      isUser
                        ? "border-cyan-500/20 bg-cyan-500/5"
                        : "border-violet-500/20 bg-violet-500/5",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="h-4 w-4 rounded-full text-[8px] font-bold grid place-items-center text-white"
                        style={{ backgroundColor: isUser ? "#06b6d4" : agentMeta.color }}
                      >
                        {isUser ? "U" : agentMeta.displayName.charAt(0)}
                      </span>
                      <span className="text-[10px] font-bold text-white/50">
                        {isUser ? "You" : agentMeta.displayName}
                      </span>
                      {msg.createdAt && (
                        <span className="text-[9px] text-white/20 ml-auto">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <div className="text-white/80 text-xs leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
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
          )
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

      {/* Revision history drawer — slides up from bottom */}
      {showHistory && activeCanvasId && (
        <div className="absolute inset-0 z-10 flex flex-col bg-[#08090d]/98 border-t border-white/10">
          <RevisionHistory
            canvasId={activeCanvasId}
            onClose={() => setShowHistory(false)}
            onRestore={() => {
              // Reload blocks after undo from the history drawer
              if (activeCanvasId) void loadBlocks(activeCanvasId);
            }}
          />
        </div>
      )}

      {/* Promote to project confirmation */}
      {showPromoteConfirm && activeCanvas && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
          <div className="max-w-sm rounded-xl border border-violet-500/20 bg-[#0a0b12] p-5 shadow-2xl">
            <div className="text-sm font-bold text-white mb-2">Promote to Project?</div>
            <div className="text-xs text-white/60 mb-4">
              This will create a new blank project named &quot;{activeCanvas.title}&quot; and link
              this canvas to it. You can then run missions, connect GitHub, and deploy from
              the project workspace.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowPromoteConfirm(false)}
                className="text-xs text-white/50 hover:text-white/80 px-3 py-1.5 rounded hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => void handlePromote()}
                className="text-xs font-bold text-violet-200 bg-violet-500/20 hover:bg-violet-500/30 px-3 py-1.5 rounded border border-violet-500/30"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
