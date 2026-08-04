"use client";

/**
 * MediaCollapsedBar — compact now-playing strip shown when the dock
 * is collapsed. Contains provider icon, title, play/pause, prev/next,
 * and expand button.
 */

import { useMediaHub } from "./MediaHubProvider";

export function MediaCollapsedBar() {
  const {
    activeProvider,
    playback,
    play,
    pause,
    toggle,
    next,
    previous,
    showExpanded,
    hide,
  } = useMediaHub();

  const isPlaying = playback.status === "playing";
  const hasItem = !!playback.item;
  const title = playback.item?.title || (hasItem ? playback.item!.sourceUrl : "Nothing playing");

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t px-3"
      style={{
        height: 40,
        backgroundColor: "var(--studio-surface)",
        borderColor: "var(--studio-border)",
      }}
      data-testid="media-collapsed-bar"
    >
      {/* Provider indicator */}
      <span
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black"
        style={{
          backgroundColor: activeProvider === "youtube" ? "rgba(255,0,0,0.15)" : "rgba(30,215,96,0.15)",
          color: activeProvider === "youtube" ? "#ff6b6b" : "#1ed760",
        }}
      >
        {activeProvider === "youtube" ? "YT" : "SP"}
      </span>

      {/* Title */}
      <span
        className="min-w-0 flex-1 truncate text-[12px] font-bold"
        style={{ color: hasItem ? "var(--text-primary)" : "var(--text-muted)" }}
        title={title}
      >
        {title}
      </span>

      {/* Controls */}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={previous}
          disabled={!hasItem}
          className="rounded p-1.5 transition hover:bg-white/5 disabled:opacity-30"
          style={{ color: "var(--text-secondary)" }}
          aria-label="Previous track"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={toggle}
          disabled={!hasItem}
          className="rounded p-1.5 transition hover:bg-white/5 disabled:opacity-30"
          style={{ color: "var(--text-primary)" }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!hasItem}
          className="rounded p-1.5 transition hover:bg-white/5 disabled:opacity-30"
          style={{ color: "var(--text-secondary)" }}
          aria-label="Next track"
        >
          ⏭
        </button>

        {/* Divider */}
        <div className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--studio-border)" }} />

        <button
          type="button"
          onClick={showExpanded}
          className="rounded p-1.5 transition hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
          aria-label="Expand media player"
          title="Expand"
        >
          ⤢
        </button>
        <button
          type="button"
          onClick={hide}
          className="rounded p-1.5 transition hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
          aria-label="Close media player"
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
