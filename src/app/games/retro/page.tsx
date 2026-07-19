"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Gamepad2,
  HardDrive,
  LockKeyhole,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import PageShell from "@/components/PageShell";
import QuickPlayLibrary from "@/components/games/QuickPlayLibrary";
import RetroHero from "@/components/games/retro/RetroHero";
import RetroShelf from "@/components/games/retro/RetroShelf";
import RetroGameCard from "@/components/games/retro/RetroGameCard";
import RetroSystemFilters from "@/components/games/retro/RetroSystemFilters";
import RetroArtworkDialog from "@/components/games/retro/RetroArtworkDialog";
import {
  addRetroGame,
  deleteRetroGame,
  detectRetroSystem,
  detectSatellaview,
  formatRomSize,
  getRetroSystem,
  listRetroGames,
  RETRO_SYSTEMS,
  titleFromFileName,
  updateRetroGame,
  type RetroGameRecord,
  type RetroSystemId,
} from "@/lib/retro-arcade";

type PendingUpload = {
  file: File;
  title: string;
  system: RetroSystemId;
  legal: boolean;
  bsx: boolean;
};

export default function RetroArcadePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [games, setGames] = useState<RetroGameRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [query, setQuery] = useState("");
  const [systemFilter, setSystemFilter] = useState<RetroSystemId | "all">(
    "all",
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    listRetroGames()
      .then(setGames)
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  const visibleGames = useMemo(
    () =>
      games.filter((game) => {
        const matchesSystem =
          systemFilter === "all" || game.system === systemFilter;
        const matchesSearch = game.title
          .toLowerCase()
          .includes(query.toLowerCase());
        return matchesSystem && matchesSearch;
      }),
    [games, query, systemFilter],
  );

  const recent = games.find((game) => game.lastPlayedAt);
  const systemsOwned = new Set(games.map((game) => game.system)).size;

  function chooseFile(file?: File) {
    if (!file) return;
    const detected = detectRetroSystem(file.name);
    if (!detected) {
      setMessage(
        "That file type is not supported yet. Use NES, SFC/SMC/SWC/BS/FIG, GB, GBC, GBA, GEN, MD, or SMD files.",
      );
      return;
    }
    setMessage(null);
    setPending({
      file,
      title: titleFromFileName(file.name),
      system: detected,
      legal: false,
      bsx: detected === "snes" && detectSatellaview(file.name),
    });
  }

  async function importGame() {
    if (!pending?.legal || busy) return;
    setBusy(true);
    try {
      const game = await addRetroGame(
        pending.file,
        pending.title,
        pending.system,
      );
      setGames((current) => [game, ...current]);
      setPending(null);
      setMessage(`${game.title} was added to this browser.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The ROM could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(game: RetroGameRecord) {
    const updated = await updateRetroGame(game.id, {
      favorite: !game.favorite,
    });
    setGames((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  async function refreshGames() {
    try {
      const fresh = await listRetroGames();
      setGames(fresh);
    } catch {
      // keep stale list
    }
  }

  const [artworkGame, setArtworkGame] = useState<RetroGameRecord | null>(null);

  const favoriteGames = useMemo(() => games.filter((g) => g.favorite), [games]);
  const recentGames = useMemo(
    () => [...games].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)).slice(0, 12),
    [games],
  );
  const systemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const game of games) {
      counts[game.system] = (counts[game.system] ?? 0) + 1;
    }
    return counts;
  }, [games]);

  async function removeGame(game: RetroGameRecord) {
    if (!window.confirm(`Remove ${game.title} from this browser?`)) return;
    await deleteRetroGame(game.id);
    setGames((current) => current.filter((item) => item.id !== game.id));
  }

  return (
    <PageShell className="bg-[#07070b]">
      <main className="min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(124,58,237,.22),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(6,182,212,.12),transparent_25%),#07070b] text-white">
        <header className="border-b border-white/10 bg-black/30 px-4 py-4 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link
                href="/games"
                className="rounded-xl border border-white/10 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
                aria-label="Back to Games"
              >
                <ArrowLeft size={18} />
              </Link>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.3em] text-fuchsia-400">
                  Game Cloud · Chapter 01
                </div>
                <h1 className="text-xl font-black tracking-tight sm:text-2xl">
                  LiTT Retro Arcade
                </h1>
              </div>
            </div>
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-2 rounded-xl bg-linear-to-r from-fuchsia-500 to-violet-600 px-4 py-2.5 text-sm font-black shadow-[0_0_30px_rgba(217,70,239,.25)] transition hover:scale-[1.02]"
            >
              <Upload size={16} /> Add your game
            </button>
            <input
              ref={inputRef}
              id="retro-file"
              name="retroFile"
              type="file"
              className="hidden"
              accept=".nes,.sfc,.smc,.swc,.bs,.bsx,.bsa,.fig,.gb,.gbc,.gba,.gen,.md,.smd"
              onChange={(event) => {
                chooseFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] space-y-6 p-4 lg:p-6">
          {recent && <RetroHero game={recent} />}

          {favoriteGames.length > 0 && (
            <RetroShelf
              title="Favorites"
              subtitle="Your starred cartridges"
              games={favoriteGames}
              onToggleFavorite={toggleFavorite}
              onRemove={removeGame}
              onManageArtwork={(g) => setArtworkGame(g)}
            />
          )}

          {recentGames.length > 0 && (
            <RetroShelf
              title="Recently played"
              subtitle="Jump back in"
              games={recentGames}
              onToggleFavorite={toggleFavorite}
              onRemove={removeGame}
              onManageArtwork={(g) => setArtworkGame(g)}
            />
          )}

          <QuickPlayLibrary
            onAdded={() => {
              refreshGames();
              setMessage("Quick Play cartridge added. Launching the player…");
            }}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black">
                  {systemFilter === "all"
                    ? "My ROM library"
                    : getRetroSystem(systemFilter).name}
                </h2>
                <p className="text-xs text-white/40">
                  Real games you added on this device
                </p>
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-white/50">
                <Search size={15} />
                <input
                  id="retro-search"
                  name="retroSearch"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search library"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25 sm:w-44"
                />
              </label>
            </div>

          <RetroSystemFilters
            active={systemFilter}
            onChange={setSystemFilter}
            counts={systemCounts}
            totalCount={games.length}
          />

          {message && (
            <div className="flex items-center justify-between rounded-xl border border-cyan-400/15 bg-cyan-400/[.06] px-4 py-3 text-sm text-cyan-100">
              <span>{message}</span>
              <button onClick={() => setMessage(null)} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {[1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className="aspect-3/4 animate-pulse rounded-2xl bg-white/5"
                />
              ))}
            </div>
          ) : visibleGames.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleGames.map((game) => (
                <RetroGameCard
                  key={game.id}
                  game={game}
                  onToggleFavorite={toggleFavorite}
                  onRemove={removeGame}
                  onManageArtwork={(g) => setArtworkGame(g)}
                />
              ))}
            </div>
          ) : (
            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseFile(event.dataTransfer.files[0]);
              }}
              className="flex min-h-72 w-full flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[.025] p-8 text-center transition hover:border-fuchsia-400/40 hover:bg-fuchsia-400/[.03]"
            >
              <span className="mb-4 rounded-2xl bg-fuchsia-500/10 p-4 text-fuchsia-300">
                <Upload size={28} />
              </span>
              <h3 className="text-lg font-black">
                {games.length
                  ? "No games match that filter"
                  : "Build your private arcade"}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/40">
                {games.length
                  ? "Try another system or search."
                  : "Drop a legally obtained ROM here or choose a file. It stays on this device and launches as a real playable game."}
              </p>
              {!games.length && (
                <span className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-black">
                  Choose ROM
                </span>
              )}
            </button>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.04] p-4">
              <ShieldCheck className="mb-2 text-emerald-300" size={20} />
              <h2 className="text-sm font-black">Private by default</h2>
              <p className="mt-1 text-xs leading-5 text-white/45">
                ROM files stay in this browser&apos;s IndexedDB. LiTT does not
                upload or provide copyrighted games.
              </p>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black">Arcade progress</h2>
                <span className="text-xs text-white/35">
                  {
                    [
                      games.length > 0,
                      games.some((g) => g.launches > 0),
                      systemsOwned >= 3,
                    ].filter(Boolean).length
                  }
                  /3
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {[
                  ["First cartridge", "Add one game", games.length > 0],
                  [
                    "Power on",
                    "Launch a game",
                    games.some((game) => game.launches > 0),
                  ],
                  ["System hopper", "Collect three systems", systemsOwned >= 3],
                ].map(([title, detail, done]) => (
                  <div key={String(title)} className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full ${done ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-white/20"}`}
                    >
                      {done ? <Check size={13} /> : <LockKeyhole size={12} />}
                    </span>
                    <div>
                      <div className="text-xs font-bold">{title}</div>
                      <div className="text-[11px] text-white/35">{detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4">
              <HardDrive size={18} className="mb-2 text-cyan-300" />
              <h2 className="text-sm font-black">Supported now</h2>
              <p className="mt-2 text-xs leading-5 text-white/40">
                NES, SNES (including Satellaview / BS‑X), Game Boy, Game Boy
                Color, Game Boy Advance, and Genesis / Mega Drive.
              </p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-3 flex items-center gap-1 text-xs font-black text-cyan-300"
              >
                Import a game <ChevronRight size={13} />
              </button>
            </section>
          </div>
        </div>

        {pending && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#111119] p-6 shadow-2xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[.25em] text-fuchsia-300">
                    Add to local arcade
                  </div>
                  <h2 className="mt-1 text-2xl font-black">
                    Confirm your game
                  </h2>
                </div>
                <button
                  onClick={() => setPending(null)}
                  className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-white/50">
                    Display title
                  </span>
                  <input
                    id="retro-title"
                    name="retroTitle"
                    value={pending.title}
                    onChange={(event) =>
                      setPending({ ...pending, title: event.target.value })
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-fuchsia-400/50"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-white/50">
                    Detected system
                  </span>
                  <select
                    id="retro-system"
                    name="retroSystem"
                    value={pending.system}
                    onChange={(event) =>
                      setPending({
                        ...pending,
                        system: event.target.value as RetroSystemId,
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#0b0b10] px-4 py-3 outline-none"
                  >
                    {RETRO_SYSTEMS.map((system) => (
                      <option key={system.id} value={system.id}>
                        {system.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/45">
                  <b className="text-white/75">{pending.file.name}</b>
                  <br />
                  {formatRomSize(pending.file.size)} · stored only in this
                  browser
                  {pending.bsx && (
                    <div className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-bold text-cyan-200">
                      Satellaview / BS‑X detected — supply a BS‑X BIOS on the
                      play page to boot.
                    </div>
                  )}
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4">
                  <input
                    id="retro-favorite"
                    name="retroFavorite"
                    type="checkbox"
                    checked={pending.legal}
                    onChange={(event) =>
                      setPending({ ...pending, legal: event.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 accent-fuchsia-500"
                  />
                  <span className="text-xs leading-5 text-white/60">
                    I confirm I have the legal right to use this ROM. LiTT does
                    not supply copyrighted game files.
                  </span>
                </label>
              </div>
              <button
                disabled={!pending.legal || busy || !pending.title.trim()}
                onClick={importGame}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-fuchsia-500 to-violet-600 py-3 font-black disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Gamepad2 size={17} />
                {busy ? "Saving locally…" : "Add to my arcade"}
              </button>
            </div>
          </div>
        )}
      </main>

      {artworkGame && (
        <RetroArtworkDialog
          game={artworkGame}
          open={!!artworkGame}
          onClose={() => setArtworkGame(null)}
          onUpdated={() => {
            setArtworkGame(null);
            refreshGames();
          }}
        />
      )}
    </PageShell>
  );
}
