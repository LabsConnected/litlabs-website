"use client";

/**
 * MediaQueue — displays the mixed-provider queue.
 *
 * Shows YouTube and Spotify items together. Clicking an item
 * jumps to it (switching providers if needed). Items can be removed.
 */

import { useMediaHub } from "./MediaHubProvider";
import type { MediaProviderId } from "./media-types";

const PROVIDER_LABELS: Record<MediaProviderId, string> = {
  youtube: "YT",
  spotify: "SP",
  soundcloud: "SC",
  "apple-music": "AM",
  direct: "MP3",
  litt: "LiTT",
};

export function MediaQueue() {
  const { queue, currentIndex, jumpTo, removeFromQueue, clearQueue } = useMediaHub();

  if (queue.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border px-3 py-6 text-[12px]"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-muted)",
          backgroundColor: "var(--studio-surface)",
        }}
      >
        Queue is empty. Paste a link above to start.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
          Queue ({queue.length})
        </span>
        <button
          type="button"
          onClick={clearQueue}
          className="text-[11px] font-bold transition hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
        >
          Clear all
        </button>
      </div>
      <div className="max-h-[180px] overflow-y-auto rounded-md border" style={{ borderColor: "var(--studio-border)" }}>
        {queue.map((item, index) => {
          const isActive = index === currentIndex;
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 border-b px-2.5 py-2 last:border-0 transition hover:bg-white/5"
              style={{
                borderColor: "var(--studio-border)",
                backgroundColor: isActive ? "rgba(155,77,255,0.08)" : "transparent",
              }}
            >
              <button
                type="button"
                onClick={() => jumpTo(index)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black"
                  style={{
                    backgroundColor: item.provider === "youtube" ? "rgba(255,0,0,0.15)" : "rgba(30,215,96,0.15)",
                    color: item.provider === "youtube" ? "#ff6b6b" : "#1ed760",
                  }}
                >
                  {PROVIDER_LABELS[item.provider]}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[12px] font-bold"
                  style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
                >
                  {item.title || item.sourceUrl}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeFromQueue(index)}
                className="shrink-0 text-[11px] font-bold transition hover:opacity-70"
                style={{ color: "var(--text-muted)" }}
                aria-label="Remove from queue"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
