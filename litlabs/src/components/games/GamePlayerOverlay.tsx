"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { X, ExternalLink, Gamepad2 } from "lucide-react";
import type { Game } from "@/lib/games";
import { setLastPlayedGameId } from "@/lib/games";

interface GamePlayerOverlayProps {
  game: Game;
  onClose: () => void;
}

export function GamePlayerOverlay({ game, onClose }: GamePlayerOverlayProps) {
  const { resolvedColors: T } = useTheme();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLastPlayedGameId(game.id);
  }, [game.id]);

  const handleOpenNewTab = () => {
    if (game.html5Url) {
      window.open(game.html5Url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
    >
      <div
        className="w-full max-w-5xl overflow-hidden rounded-2xl border"
        style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b p-4"
          style={{ borderColor: T.borderColor }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border"
              style={{
                backgroundColor: `${T.accentColor}15`,
                borderColor: `${T.accentColor}30`,
              }}
            >
              <Gamepad2 size={20} style={{ color: T.accentColor }} />
            </div>
            <div>
              <h2 className="font-black" style={{ color: T.headerColor }}>
                {game.title}
              </h2>
              <p className="text-xs" style={{ color: T.textMuted }}>
                {game.platform.toUpperCase()} • {game.year} • {game.developer}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {game.html5Url && (
              <button
                onClick={handleOpenNewTab}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition hover:opacity-80"
                style={{ borderColor: T.borderColor, color: T.textMuted }}
                title="Open in new tab"
              >
                <ExternalLink size={14} /> New Tab
              </button>
            )}
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ borderColor: T.borderColor, color: T.textMuted }}
            >
              <X size={14} /> Close
            </button>
          </div>
        </div>

        {/* Game iframe */}
        <div className="relative aspect-video bg-black">
          {game.html5Url ? (
            <iframe
              src={game.html5Url}
              className="h-full w-full"
              allow="fullscreen; gamepad"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer"
              style={{ border: "none" }}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(true);
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyGameState />
            </div>
          )}
          {loading && game.html5Url && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: T.accentColor, borderTopColor: "transparent" }}
                />
                <span className="text-xs" style={{ color: T.textMuted }}>
                  Loading game...
                </span>
              </div>
            </div>
          )}
          {error && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mb-4 text-4xl">🎮</div>
                <p className="text-sm" style={{ color: T.textMuted }}>
                  This game cannot be loaded here.
                </p>
                {game.html5Url && (
                  <button
                    onClick={handleOpenNewTab}
                    className="mt-4 rounded-lg px-4 py-2 text-sm font-bold"
                    style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                  >
                    Open in New Tab
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Info bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
          <div className="flex items-center gap-4 text-xs" style={{ color: T.textMuted }}>
            <span>⭐ {game.rating}</span>
            <span>👤 {game.players}P</span>
            <span>👁 {game.plays}</span>
            <span>
              Controls: <span className="font-mono">{game.controls?.join(" / ") || "—"}</span>
            </span>
            <span className="capitalize">Difficulty: {game.difficulty || "—"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {game.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border px-2 py-1 text-[10px] font-bold uppercase"
                style={{ borderColor: T.borderColor, color: T.textMuted }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyGameState() {
  return (
    <div className="text-center">
      <div className="mb-4 text-4xl">🎮</div>
      <p className="text-sm opacity-60">No playable link available.</p>
    </div>
  );
}
