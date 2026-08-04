"use client";

/**
 * YouTubeSearchPanel — search panel that slides into the YouTube dock.
 *
 * Uses /api/youtube/search (YouTube Data API v3) to find music videos.
 * Results can be played immediately or added to the queue.
 *
 * Integrates with the existing YouTubePlayerContext — no new player.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, Play, Plus, X, Loader2, Music, AlertCircle } from "lucide-react";
import { useYouTubePlayer } from "@/context/YouTubePlayerContext";

interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string;
  viewCount?: string;
}

interface SearchResponse {
  results: SearchResult[];
  totalResults: number;
  error?: string;
}

function formatDuration(iso: string): string {
  if (!iso) return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatViews(views?: string): string {
  if (!views) return "";
  const n = parseInt(views, 10);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
  return `${n} views`;
}

const TRENDING_CHIPS = [
  "lofi hip hop",
  "synthwave",
  "trap beats",
  "ambient music",
  "electronic",
  "jazz",
  "classical music",
  "rock",
];

export function YouTubeSearchPanel({ onClose }: { onClose: () => void }) {
  const { loadVideo, addToQueue } = useYouTubePlayer();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(q)}&maxResults=12`,
        { credentials: "include" },
      );
      const data = await response.json().catch(() => null) as SearchResponse | null;
      if (!response.ok || !data) {
        throw new Error(data?.error ?? `Search failed (${response.status})`);
      }
      if (data.error) {
        setError(data.error);
        setResults([]);
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
      setHasSearched(true);
    }
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (value.trim().length >= 3) void search(value);
        else {
          setResults([]);
          setHasSearched(false);
        }
      }, 400);
    },
    [search],
  );

  const handleChipClick = useCallback(
    (chip: string) => {
      setQuery(chip);
      void search(chip);
    },
    [search],
  );

  const handlePlay = useCallback(
    (result: SearchResult) => {
      loadVideo(`https://www.youtube.com/watch?v=${result.videoId}`);
    },
    [loadVideo],
  );

  const handleAddToQueue = useCallback(
    (result: SearchResult) => {
      addToQueue(`https://www.youtube.com/watch?v=${result.videoId}`);
    },
    [addToQueue],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="youtube-search-panel">
      {/* Search header */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) void search(query);
            }}
            placeholder="Search YouTube Music…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-white placeholder-white/30 outline-none transition focus:border-purple-400/40 focus:bg-white/8"
            aria-label="Search YouTube Music"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
          aria-label="Close search"
        >
          <X size={14} />
        </button>
      </div>

      {/* Trending chips */}
      {!hasSearched && !loading && (
        <div className="flex flex-wrap gap-1.5">
          {TRENDING_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleChipClick(chip)}
              className="rounded-full border border-purple-500/20 bg-purple-500/8 px-2.5 py-1 text-[10px] font-bold text-purple-300 transition hover:bg-purple-500/15"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-300">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/40">
          <Loader2 size={14} className="animate-spin" />
          Searching…
        </div>
      )}

      {/* Results */}
      {!loading && results.length > 0 && (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {results.map((result) => (
            <div
              key={result.videoId}
              className="group flex items-center gap-3 rounded-lg border border-white/8 bg-white/3 p-2 transition hover:border-purple-500/20 hover:bg-white/5"
            >
              {/* Thumbnail */}
              <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.thumbnail}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {result.duration && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[8px] font-bold text-white">
                    {formatDuration(result.duration)}
                  </span>
                )}
              </div>

              {/* Title + channel */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-bold text-white">{result.title}</p>
                <p className="truncate text-[9px] text-white/40">{result.channel}</p>
                {result.viewCount && (
                  <p className="truncate text-[8px] text-white/25">{formatViews(result.viewCount)}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => handlePlay(result)}
                  className="grid h-7 w-7 place-items-center rounded-md bg-purple-500/15 text-purple-300 transition hover:bg-purple-500/25"
                  aria-label={`Play ${result.title}`}
                  title="Play now"
                >
                  <Play size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => handleAddToQueue(result)}
                  className="grid h-7 w-7 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white"
                  aria-label={`Add ${result.title} to queue`}
                  title="Add to queue"
                >
                  <Plus size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state after search */}
      {!loading && hasSearched && results.length === 0 && !error && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Music size={24} className="text-white/20" />
          <p className="text-xs text-white/40">No results found for &ldquo;{query}&rdquo;</p>
        </div>
      )}
    </div>
  );
}
