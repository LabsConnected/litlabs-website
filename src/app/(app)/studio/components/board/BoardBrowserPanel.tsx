"use client";

/**
 * BoardBrowserPanel — an embedded web view on the board (board-only
 * rebuild, 2026-11-14, checklist item 5).
 *
 * A real iframe with a small local history (back / forward / refresh),
 * a URL bar, and an open-in-new-tab escape hatch. Honest limits: many
 * sites send X-Frame-Options / CSP frame-ancestors and refuse to be
 * embedded — the panel cannot detect that reliably, so the empty state
 * says so up front and the external-open button is always one click
 * away. Wiring LiTT's own web lookup through this panel is a later
 * slice (out of scope here, per the brief).
 *
 * Token-bound surfaces; no pink.
 */

import { useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

/** Normalize a typed address into a loadable URL, or null if empty. */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^about:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function BoardBrowserPanel() {
  const { tokens } = useTheme();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [reloadKey, setReloadKey] = useState(0);
  const currentUrl = historyIndex >= 0 ? history[historyIndex] : null;

  const navigate = (raw: string) => {
    const url = normalizeBrowserUrl(raw);
    if (!url) return;
    const next = [...history.slice(0, historyIndex + 1), url];
    setHistory(next);
    setHistoryIndex(next.length - 1);
    setInput(url);
  };

  const barButton =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5 disabled:opacity-40";

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="board-browser-panel"
      style={{ backgroundColor: tokens.surface, color: tokens.text }}
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: tokens.border }}
      >
        <button
          type="button"
          aria-label="Back"
          data-testid="board-browser-back"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={historyIndex <= 0}
          onClick={() => {
            const next = historyIndex - 1;
            setHistoryIndex(next);
            setInput(history[next] ?? "");
          }}
        >
          <ArrowLeft size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Forward"
          data-testid="board-browser-forward"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={historyIndex >= history.length - 1}
          onClick={() => {
            const next = historyIndex + 1;
            setHistoryIndex(next);
            setInput(history[next] ?? "");
          }}
        >
          <ArrowRight size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Refresh"
          data-testid="board-browser-refresh"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={!currentUrl}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
        <input
          data-testid="board-browser-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate(input);
          }}
          placeholder="Enter a web address…"
          className="min-w-0 flex-1 rounded-full border bg-transparent px-3 py-1 text-xs outline-none"
          style={{ borderColor: tokens.border, color: tokens.text }}
        />
        {currentUrl && (
          <a
            data-testid="board-browser-open"
            href={currentUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in a new tab"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
            style={{ color: tokens.text }}
          >
            <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>

      {currentUrl ? (
        <iframe
          key={`${currentUrl}:${reloadKey}`}
          data-testid="board-browser-frame"
          title="Board browser"
          src={currentUrl}
          className="min-h-0 flex-1 border-0"
          style={{ backgroundColor: "#FFFFFF" }}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Globe size={22} style={{ color: tokens.textMuted }} aria-hidden />
          <p className="max-w-60 text-xs leading-5" style={{ color: tokens.textMuted }}>
            Browse the web without leaving Studio. Some sites refuse to be
            embedded — if a page stays blank, open it in a new tab instead.
          </p>
        </div>
      )}
    </div>
  );
}
