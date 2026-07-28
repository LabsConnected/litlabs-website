/**
 * Composer — persistent message input at the bottom of the left rail.
 *
 * Phase 2: connected to /api/litt/run via useLiTTRun hook.
 * Submits user messages, shows run status, supports cancel/retry.
 */

"use client";

import { useState, useRef, useEffect } from "react";

interface ThemeColors {
  borderColor: string;
}

interface ComposerProps {
  T: ThemeColors;
  status: "idle" | "pending" | "streaming" | "running" | "completed" | "failed" | "cancelled";
  onSubmit: (message: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  canRetry: boolean;
}

export function Composer({ T, status, onSubmit, onCancel, onRetry, canRetry }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isBusy = status === "pending" || status === "streaming" || status === "running";
  const canSend = draft.trim().length > 0 && !isBusy;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [draft]);

  const handleSubmit = () => {
    if (!canSend) return;
    onSubmit(draft.trim());
    setDraft("");
  };

  return (
    <div
      className="shrink-0 border-t px-3 py-2"
      style={{ borderColor: `${T.borderColor}30` }}
    >
      {/* Status indicator */}
      {status !== "idle" && (
        <div className="mb-1.5 flex items-center gap-2 text-[10px]">
          {status === "pending" && (
            <span className="text-white/50">Sending…</span>
          )}
          {status === "streaming" && (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              <span className="text-white/50">LiTT is responding…</span>
              <button
                type="button"
                onClick={onCancel}
                className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/60 hover:bg-white/5"
              >
                Cancel
              </button>
            </>
          )}
          {status === "completed" && (
            <span className="text-green-400/70">Response complete</span>
          )}
          {status === "failed" && (
            <>
              <span className="text-red-400/80">Failed</span>
              {canRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/60 hover:bg-white/5"
                >
                  Retry
                </button>
              )}
            </>
          )}
          {status === "cancelled" && (
            <>
              <span className="text-amber-400/70">Cancelled</span>
              {canRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/60 hover:bg-white/5"
                >
                  Retry
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe what to build…"
          disabled={isBusy}
          className="min-h-[36px] max-h-[120px] flex-1 resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-white/20 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSend}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Send
        </button>
      </div>
    </div>
  );
}
