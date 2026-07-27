"use client";

import { useEffect, useState } from "react";
import type { CanvasRevision } from "@/lib/canvas/types";
import { cn } from "@/lib/utils";

interface RevisionHistoryProps {
  canvasId: string;
  onRestore?: (version: number) => void;
  onClose: () => void;
}

/**
 * RevisionHistory — a drawer showing all revisions for a canvas.
 * Each revision shows the version, actor, summary, and timestamp.
 * User can click a revision to see details or restore it.
 */
export function RevisionHistory({ canvasId, onRestore, onClose }: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<CanvasRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  useEffect(() => {
    void loadRevisions();
  }, [canvasId]);

  const loadRevisions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvases/${canvasId}/revisions`);
      if (!res.ok) throw new Error("Failed to load revisions");
      const data = await res.json();
      setRevisions(data.revisions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revisions");
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async () => {
    try {
      // The POST handler on the revisions route performs the undo.
      // (There is no separate /undo route — it's the same file.)
      const res = await fetch(`/api/canvases/${canvasId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "user" }),
      });
      if (!res.ok) throw new Error("Undo failed");
      const result = await res.json();
      await loadRevisions();
      // Use the version from the undo result, not the stale `revisions`
      // closure value (loadRevisions updates state asynchronously, but
      // the `revisions` variable in this closure is still the pre-undo
      // value).
      onRestore?.(result?.undone?.version ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    }
  };

  const selectedRev = revisions.find((r) => r.version === selectedVersion);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Revision History</span>
          {revisions.length > 0 && (
            <span className="text-[10px] text-white/30">{revisions.length} versions</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {revisions.length > 1 && (
            <button
              onClick={() => void handleUndo()}
              className="text-xs text-cyan-300 hover:text-cyan-200 transition-colors px-2 py-1 rounded hover:bg-cyan-500/10"
              title="Undo last change"
            >
              ↶ Undo
            </button>
          )}
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-white/45 hover:bg-white/8 hover:text-white"
            aria-label="Close revision history"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Revision list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-white/40 text-sm">
            Loading revisions...
          </div>
        ) : revisions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-white/30 text-sm">
            No revisions yet
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {revisions.map((rev, idx) => {
              const isLatest = idx === 0;
              const isSelected = rev.version === selectedVersion;
              return (
                <button
                  key={rev.id}
                  onClick={() => setSelectedVersion(isSelected ? null : rev.version)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                    isSelected ? "bg-cyan-500/5" : "hover:bg-white/[0.02]",
                  )}
                >
                  {/* Version number */}
                  <div className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    isLatest ? "bg-cyan-500/20 text-cyan-300" : "bg-white/5 text-white/40",
                  )}>
                    {rev.version}
                  </div>
                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[10px] font-medium uppercase",
                        rev.actor === "user" && "text-cyan-300",
                        rev.actor === "litt" && "text-violet-300",
                        rev.actor === "spark" && "text-pink-300",
                        rev.actor === "system" && "text-white/40",
                      )}>
                        {rev.actor}
                      </span>
                      {isLatest && (
                        <span className="text-[9px] text-cyan-300/60">LATEST</span>
                      )}
                    </div>
                    <div className="text-sm text-white/80 mt-0.5 truncate">
                      {rev.summary || "No description"}
                    </div>
                    <div className="text-[10px] text-white/30 mt-0.5">
                      {new Date(rev.createdAt).toLocaleString()}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected revision details */}
      {selectedRev && (
        <div className="border-t border-white/5 bg-black/30 px-4 py-3 max-h-48 overflow-y-auto">
          <div className="text-[10px] font-bold uppercase text-white/40 mb-2">
            Version {selectedRev.version} — Operations
          </div>
          <div className="space-y-1.5">
            {selectedRev.operations.map((op, i) => (
              <div key={i} className="text-xs text-white/60 font-mono">
                <span className="text-cyan-300">{op.op}</span>
                {"blockId" in op && (
                  <span className="text-white/30"> → {op.blockId.slice(0, 8)}...</span>
                )}
                {"newTitle" in op && (
                  <span className="text-white/30"> → "{op.newTitle}"</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
