"use client";

/**
 * MediaUrlInput — universal URL input field.
 *
 * Accepts YouTube or Spotify URLs, auto-detects the provider,
 * and either loads immediately or adds to the queue.
 */

import { useState, useCallback } from "react";
import { useMediaHub } from "./MediaHubProvider";
import { parseMediaUrl } from "./parse-media-url";

export function MediaUrlInput({ onLoaded }: { onLoaded?: () => void }) {
  const { loadUrl, addToQueue, dockMode, showExpanded } = useMediaHub();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setError(null);

    try {
      parseMediaUrl(input); // validate
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid URL");
      return;
    }

    if (shiftHeld) {
      const ok = addToQueue(input);
      if (!ok) {
        setError("Could not add to queue.");
        return;
      }
      setInput("");
    } else {
      const ok = loadUrl(input);
      if (!ok) {
        setError("Could not load this URL.");
        return;
      }
      setInput("");
      if (dockMode === "collapsed") showExpanded();
      onLoaded?.();
    }
  }, [input, shiftHeld, addToQueue, loadUrl, dockMode, showExpanded, onLoaded]);

  return (
    <div className="flex flex-col gap-1.5">
      <form onSubmit={handleSubmit} className="flex gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => setShiftHeld(e.shiftKey)}
          onKeyUp={() => setShiftHeld(false)}
          placeholder="Paste a YouTube or Spotify link…"
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-[13px] outline-none transition focus:border-[var(--spark-primary)]"
          style={{
            backgroundColor: "var(--studio-surface)",
            borderColor: "var(--studio-border)",
            color: "var(--text-primary)",
          }}
          aria-label="Media URL input"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md px-3 py-2 text-[13px] font-bold transition hover:opacity-80"
          style={{
            backgroundColor: "rgba(155,77,255,0.15)",
            color: "var(--spark-primary)",
            border: "1px solid rgba(155,77,255,0.25)",
          }}
        >
          {shiftHeld ? "+ Queue" : "Play"}
        </button>
      </form>
      {error && (
        <p className="text-[12px] font-bold" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Paste a link and press Enter to play. Hold Shift + Enter to add to queue.
      </p>
    </div>
  );
}
