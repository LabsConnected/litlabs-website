"use client";

/**
 * RetroArcadeEmbedded — compact retro arcade section that embeds directly
 * into the /games page so users see their collection without navigating
 * to /games/retro every time.
 *
 * Shows:
 *   - Upload button
 *   - System filter chips
 *   - Game grid (compact cards)
 *   - Empty state with CTA
 *   - Link to full retro arcade page
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Upload,
  Search,
  Play,
  Gamepad2,
  Library,
  ArrowRight,
  ShieldCheck,
  Heart,
} from "lucide-react";
import {
  addRetroGame,
  deleteRetroGame,
  detectRetroSystem,
  getCoverArtUrl,
  getRetroSystem,
  isStandardPlayable,
  listRetroGames,
  RETRO_SYSTEMS,
  titleFromFileName,
  updateRetroGame,
  type RetroGameRecord,
  type RetroSystemId,
} from "@/lib/retro-arcade";

export function RetroArcadeEmbedded() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [games, setGames] = useState<RetroGameRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [systemFilter, setSystemFilter] = useState<RetroSystemId | "all">("all");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    listRetroGames()
      .then(setGames)
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  const standardGames = useMemo(
    () => games.filter(isStandardPlayable),
    [games],
  );

  const visibleGames = useMemo(
    () =>
      standardGames.filter((game) => {
        const matchesSystem =
          systemFilter === "all" || game.system === systemFilter;
        const matchesSearch = game.title
          .toLowerCase()
          .includes(query.toLowerCase());
        return matchesSystem && matchesSearch;
      }),
    [standardGames, query, systemFilter],
  );

  const recent = standardGames.find((game) => game.lastPlayedAt);

  function chooseFile(file?: File) {
    if (!file) return;
    const detected = detectRetroSystem(file.name);
    if (!detected) {
      setMessage(
        "That file type is not supported yet. Use NES, SFC/SMC, GB, GBC, GBA, GEN, MD, or SMD files.",
      );
      return;
    }
    setMessage(null);
    setBusy(true);
    addRetroGame(file, titleFromFileName(file.name), detected)
      .then((game) => {
        setGames((current) => [game, ...current]);
        setMessage(`${game.title} was added to your arcade.`);
      })
      .catch((error) => {
        setMessage(
          error instanceof Error ? error.message : "The ROM could not be saved.",
        );
      })
      .finally(() => setBusy(false));
  }

  async function toggleFavorite(game: RetroGameRecord) {
    const updated = await updateRetroGame(game.id, {
      favorite: !game.favorite,
    });
    setGames((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  async function removeGame(game: RetroGameRecord) {
    if (!window.confirm(`Remove ${game.title} from this browser?`)) return;
    await deleteRetroGame(game.id);
    setGames((current) =>
      current.filter((item) => item.id !== game.id),
    );
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.25em] text-fuchsia-400">
            Retro Arcade · Standard
          </p>
          <h2 className="mt-1 text-xl font-black sm:text-2xl">
            Your retro collection
          </h2>
          <p className="mt-1 text-xs text-white/45">
            {standardGames.length > 0
              ? `${standardGames.length} game${standardGames.length === 1 ? "" : "s"} · Stored locally in this browser`
              : "Import legal ROMs you own — NES, SNES, Game Boy, Genesis, and more"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl bg-linear-to-r from-fuchsia-500 to-violet-600 px-4 py-2.5 text-sm font-black shadow-[0_0_30px_rgba(217,70,239,.25)] transition hover:scale-[1.02] disabled:opacity-50"
          >
            <Upload size={16} /> {busy ? "Adding…" : "Add game"}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".nes,.sfc,.smc,.swc,.fig,.gb,.gbc,.gba,.gen,.md,.smd"
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Link
            href="/games/retro"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Full arcade <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Message toast */}
      {message && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white/60">
          {message}
        </div>
      )}

      {/* Continue playing */}
      {recent && (
        <Link
          href={`/games/retro/play/${recent.id}`}
          className="group relative flex min-h-28 items-center overflow-hidden rounded-2xl border border-fuchsia-400/20 bg-linear-to-r from-violet-950 via-[#15101e] to-transparent p-4 transition hover:border-fuchsia-400/40"
        >
          <div className="relative z-10 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/20 text-fuchsia-300">
              <Gamepad2 size={20} />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-300">
                Continue playing
              </p>
              <h3 className="text-base font-black">{recent.title}</h3>
              <p className="text-[11px] text-white/45">
                {getRetroSystem(recent.system).name}
              </p>
            </div>
            <span className="ml-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-black">
              <Play size={12} fill="currentColor" /> Resume
            </span>
          </div>
        </Link>
      )}

      {/* System filter chips + search */}
      {standardGames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSystemFilter("all")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
              systemFilter === "all"
                ? "bg-fuchsia-500/20 text-fuchsia-300"
                : "border border-white/10 text-white/50 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Library size={13} /> All
            <span className="ml-0.5 text-white/30">{standardGames.length}</span>
          </button>
          {RETRO_SYSTEMS.filter((s) =>
            standardGames.some((g) => g.system === s.id),
          ).map((system) => (
            <button
              key={system.id}
              onClick={() => setSystemFilter(system.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                systemFilter === system.id
                  ? "bg-white/15 text-white"
                  : "border border-white/10 text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <i
                className="h-2 w-2 rounded-full"
                style={{
                  background: system.color,
                  boxShadow: `0 0 8px ${system.color}`,
                }}
              />
              {system.shortName}
              <span className="ml-0.5 text-white/30">
                {standardGames.filter((g) => g.system === system.id).length}
              </span>
            </button>
          ))}
          <div className="relative ml-auto w-full max-w-40">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30"
              size={13}
            />
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-full border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white outline-none placeholder:text-white/25 focus:border-fuchsia-500/40"
            />
          </div>
        </div>
      )}

      {/* Game grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="aspect-3/4 animate-pulse rounded-xl border border-white/5 bg-white/3"
            />
          ))}
        </div>
      ) : visibleGames.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visibleGames.map((game) => {
            const coverUrl = getCoverArtUrl(game);
            const system = getRetroSystem(game.system);
            return (
              <Link
                key={game.id}
                href={`/games/retro/play/${game.id}`}
                className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/3 transition hover:-translate-y-1 hover:border-fuchsia-400/30"
              >
                <div className="relative aspect-3/4 overflow-hidden">
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl}
                      alt={`${game.title} cover art`}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30">
                      <Gamepad2 size={32} className="text-white/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent opacity-0 transition group-hover:opacity-100" />
                  <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between opacity-0 transition group-hover:opacity-100">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg">
                      <Play size={13} fill="currentColor" />
                    </span>
                  </div>
                  <span
                    className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white/70 backdrop-blur-sm"
                    style={{ color: system.color }}
                  >
                    {system.shortName}
                  </span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void toggleFavorite(game);
                    }}
                    className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white/30 backdrop-blur-sm transition hover:text-white"
                    aria-label={
                      game.favorite
                        ? `Unfavorite ${game.title}`
                        : `Favorite ${game.title}`
                    }
                  >
                    <Heart
                      size={12}
                      fill={game.favorite ? "#d946ef" : "none"}
                      className={
                        game.favorite ? "text-fuchsia-500" : ""
                      }
                    />
                  </button>
                </div>
                <div className="p-2.5">
                  <h3 className="truncate text-xs font-black">{game.title}</h3>
                  <p className="mt-0.5 text-[10px] text-white/35">
                    {system.name}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        !loading && (
          <div className="rounded-2xl border border-white/10 bg-white/3 p-8 text-center">
            <Gamepad2 size={32} className="mx-auto mb-3 text-white/20" />
            <h3 className="text-sm font-black text-white/70">
              {standardGames.length === 0
                ? "No retro games yet"
                : "No games match your filter"}
            </h3>
            <p className="mt-1 text-xs text-white/40">
              {standardGames.length === 0
                ? "Import legal ROMs you own to start playing in your browser"
                : "Try a different system or clear your search"}
            </p>
            {standardGames.length === 0 && (
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-fuchsia-500/20 px-4 py-2 text-xs font-black text-fuchsia-300 transition hover:bg-fuchsia-500/30"
              >
                <Upload size={14} /> Import your first game
              </button>
            )}
          </div>
        )
      )}

      {/* Privacy note */}
      <div className="flex items-center gap-2 text-[10px] text-white/35">
        <ShieldCheck size={12} className="shrink-0 text-emerald-400/60" />
        <span>
          ROM files stay in this browser&apos;s IndexedDB. LiTT does not upload
          or provide copyrighted games.
        </span>
      </div>
    </div>
  );
}
