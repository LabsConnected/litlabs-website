"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ArtifactAction } from "@/lib/canvas/types";

interface ActionChipsProps {
  actions: ArtifactAction[];
  onExecute: (action: ArtifactAction) => void;
}

/**
 * ActionChips — renders the actions proposed by LiTT as clickable
 * chips under a chat response.
 *
 * Behavior:
 * - canvas.create → "Open in Canvas"
 * - canvas.append → "Add to Canvas"
 * - canvas.update_block → "Update Block"
 * - canvas.delete_block → "Delete Block"
 * - canvas.rename → "Rename Canvas"
 * - task.create → "Create Task"
 * - project.promote → "Promote to Project"
 */
export function ActionChips({ actions, onExecute }: ActionChipsProps) {
  const [executed, setExecuted] = useState<Set<number>>(new Set());
  const [executing, setExecuting] = useState<number | null>(null);

  if (!actions || actions.length === 0) return null;

  const handleExecute = async (idx: number, action: ArtifactAction) => {
    setExecuting(idx);
    try {
      onExecute(action);
      setExecuted((prev) => new Set(prev).add(idx));
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions.map((action, idx) => {
        const label = getActionLabel(action);
        const isExecuted = executed.has(idx);
        const isExecuting = executing === idx;

        return (
          <button
            key={idx}
            onClick={() => void handleExecute(idx, action)}
            disabled={isExecuted || isExecuting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
              isExecuted
                ? "border-green-500/30 bg-green-500/10 text-green-300 cursor-default"
                : isExecuting
                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 animate-pulse"
                  : "border-white/10 bg-white/5 text-white/60 hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-300",
            )}
          >
            <span>{getActionIcon(action)}</span>
            <span>{isExecuted ? "Done" : isExecuting ? "Working..." : label}</span>
          </button>
        );
      })}
    </div>
  );
}

function getActionLabel(action: ArtifactAction): string {
  switch (action.type) {
    case "canvas.create":
      return "Open in Canvas";
    case "canvas.append":
      return "Add to Canvas";
    case "canvas.update_block":
      return "Update Block";
    case "canvas.delete_block":
      return "Delete Block";
    case "canvas.rename":
      return "Rename Canvas";
    case "task.create":
      return "Create Task";
    case "project.promote":
      return "Promote to Project";
  }
}

function getActionIcon(action: ArtifactAction): string {
  switch (action.type) {
    case "canvas.create":
      return "📋";
    case "canvas.append":
      return "➕";
    case "canvas.update_block":
      return "✏️";
    case "canvas.delete_block":
      return "🗑️";
    case "canvas.rename":
      return "🏷️";
    case "task.create":
      return "✓";
    case "project.promote":
      return "🚀";
  }
}
