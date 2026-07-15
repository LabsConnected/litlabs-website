"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Gamepad2,
  HardDrive,
  Heart,
  Library,
  LockKeyhole,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import PageShell from "@/components/PageShell";
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
      current.map((item) => (item.id === updated.id ? item : item)),
    );
  }

  async function removeGame(game: RetroGameRecord) {
    if (!window.confirm(`Remove ${game.title} from this browser?`)) return;
    await deleteRetroGame(game.id);
    setGames((current) => current.filter((item) => item.id !== game.id));
  }

  return (
    <PageShell className="bg-[#07070b]">
      <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(124,58,237,.22),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(6,182,212,.12),transparent_25%),#07070b] text-white">
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
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 px-4 py-2.5 text-sm font-black shadow-[0_0_30px_rgba(217,70,239,.25)] transition hover:scale-[1.02]"
            >
              <Upload size={16} /> Add your game
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".nes,.sfc,.smc,.swc,.bs,.bsa,.fig,.gb,.gbc,.gba,.gen,.md,.smd"
              onChange={(event) => {
                chooseFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </header>

        <div className="mx-auto grid max-w-[1500px] gap-4 p-4 lg:grid-cols-[240px_minmax(0,1fr)_280px] lg:p-6">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/[.035] p-3 backdrop-blur">
              <div className="mb-3 px-2 text-[10px] font-black uppercase tracking-[.22em] text-white/40">
                Your collection
              </div>
              <button
                onClick={() => setSystemFilter("all")}
                className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-bold transition ${systemFilter === "all" ? "bg-fuchsia-500/15 text-fuchsia-300" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
              >
                <span className="flex items-center gap-2">
                  <Library size={15} /> All systems
                </span>
                <span>{games.length}</span>
              </button>
              {RETRO_SYSTEMS.map((system) => (
                <button
                  key={system.id}
                  onClick={() => setSystemFilter(system.id)}
                  className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-bold transition ${systemFilter === system.id ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
                >
                  <span className="flex items-center gap-2">
                    <i
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: system.color,
                        boxShadow: `0 0 10px ${system.color}`,
                      }}
                    />
                    {system.shortName}
                  </span>
                  <span>
                    {games.filter((game) => game.system === system.id).length}
                  </span>
                </button>
              ))}
            </section>
            <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.04] p-4">
              <ShieldCheck className="mb-2 text-emerald-300" size={20} />
              <h2 className="text-sm font-black">Private by default</h2>
              <p className="mt-1 text-xs leading-5 text-white/45">
                ROM files stay in this browser&apos;s IndexedDB. LiTT does not
                upload or provide copyrighted games.
              </p>
            </section>
          </aside>

          <section className="min-w-0 space-y-4">
            {recent && (
              <Link
                href={`/games/retro/play/${recent.id}`}
                className="group relative flex min-h-40 overflow-hidden rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-violet-950 via-[#15101e] to-cyan-950 p-6 shadow-[0_25px_80px_rgba(0,0,0,.35)]"
              >
                <div className="relative z-10 flex max-w-xl flex-col justify-end">
                  <span className="mb-2 text-[10px] font-black uppercase tracking-[.25em] text-fuchsia-300">
                    Continue playing
                  </span>
                  <h2 className="text-3xl font-black">{recent.title}</h2>
                  <p className="mt-2 text-sm text-white/50">
                    {getRetroSystem(recent.system).name} · Stored locally
                  </p>
                  <span className="mt-4 flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-black text-black">
                    <Play size={15} fill="currentColor" /> Resume chapter
                  </span>
                </div>
                <div className="absolute -right-8 -top-20 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl transition group-hover:bg-fuchsia-500/30" />
                <Gamepad2
                  className="absolute right-10 top-1/2 -translate-y-1/2 text-white/[.07]"
                  size={180}
                />
              </Link>
            )}

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
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search library"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25 sm:w-44"
                />
              </label>
            </div>

            {message && (
              <div className="flex items-center justify-between rounded-xl border border-cyan-400/15 bg-cyan-400/[.06] px-4 py-3 text-sm text-cyan-100">
                <span>{message}</span>
                <button onClick={() => setMessage(null)} aria-label="Dismiss">
                  <X size={16} />
                </button>
              </div>
            )}

            {loading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-56 animate-pulse rounded-2xl bg-white/5"
                  />
                ))}
              </div>
            ) : visibleGames.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleGames.map((game) => {
                  const system = getRetroSystem(game.system);
                  return (
                    <article
                      key={game.id}
                      className="group overflow-hidden rounded-2xl border border-white/10 bg-[#101017] transition hover:-translate-y-1 hover:border-white/20"
                    >
                      <Link
                        href={`/games/retro/play/${game.id}`}
                        className="relative flex h-32 items-center justify-center overflow-hidden"
                        style={{
                          background: `radial-gradient(circle at 50% 20%, ${system.color}33, transparent 55%), linear-gradient(145deg,#181824,#09090d)`,
                        }}
                      >
                        <span className="select-none text-5xl font-black tracking-tighter text-white/10">
                          {system.shortName}
                        </span>
                        <span
                          className="absolute left-3 top-3 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-black"
                          style={{ color: system.color }}
                        >
                          {system.shortName}
                        </span>
                        <span className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-black opacity-0 shadow-xl transition group-hover:opacity-100">
                          <Play size={16} fill="currentColor" />
                        </span>
                      </Link>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="truncate font-black">
                              {game.title}
                            </h3>
                            <p className="mt-1 truncate text-xs text-white/35">
                              {formatRomSize(game.size)} · {game.launches}{" "}
                              {game.launches === 1 ? "launch" : "launches"}
                            </p>
                          </div>
                          <button
                            onClick={() => toggleFavorite(game)}
                            className={`p-1.5 ${game.favorite ? "text-pink-400" : "text-white/25 hover:text-white"}`}
                            aria-label="Favorite"
                          >
                            <Heart
                              size={16}
                              fill={game.favorite ? "currentColor" : "none"}
                            />
                          </button>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <Link
                            href={`/games/retro/play/${game.id}`}
                            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/10 py-2 text-xs font-black hover:bg-white/15"
                          >
                            <Play size={13} /> Play
                          </Link>
                          <button
                            onClick={() => removeGame(game)}
                            className="rounded-lg border border-white/10 px-3 text-white/30 hover:border-red-400/30 hover:text-red-300"
                            aria-label="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
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
          </section>

          <aside className="space-y-4">
            <section className="relative overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-b from-violet-500/10 to-transparent p-5">
              <Sparkles className="mb-3 text-violet-300" />
              <div className="text-[10px] font-black uppercase tracking-[.22em] text-violet-300">
                LiTT Companion
              </div>
              <h2 className="mt-2 text-lg font-black">
                {games.length === 0
                  ? "Your cabinet is ready."
                  : recent
                    ? `Welcome back, player.`
                    : "Pick your first chapter."}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/45">
                {games.length === 0
                  ? "Add your first game and I’ll organize it by system automatically."
                  : recent
                    ? `${recent.title} is ready where you left it. Your library never leaves this browser.`
                    : `You have ${games.length} ${games.length === 1 ? "game" : "games"} across ${systemsOwned} ${systemsOwned === 1 ? "system" : "systems"}.`}
              </p>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[.035] p-5">
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
              <div className="mt-4 space-y-3">
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
                      className={`flex h-8 w-8 items-center justify-center rounded-full ${done ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-white/20"}`}
                    >
                      {done ? <Check size={15} /> : <LockKeyhole size={13} />}
                    </span>
                    <div>
                      <div className="text-xs font-bold">{title}</div>
                      <div className="text-[11px] text-white/35">{detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
              <HardDrive size={18} className="mb-2 text-cyan-300" />
              <h2 className="text-sm font-black">Supported now</h2>
              <p className="mt-2 text-xs leading-5 text-white/40">
                NES, SNES (including Satellaview / BS‑X), Game Boy, Game Boy
                Color, Game Boy Advance, and Genesis / Mega Drive.
              </p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-4 flex items-center gap-1 text-xs font-black text-cyan-300"
              >
                Import a game <ChevronRight size={13} />
              </button>
            </section>
          </aside>
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
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 py-3 font-black disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Gamepad2 size={17} />
                {busy ? "Saving locally…" : "Add to my arcade"}
              </button>
            </div>
          </div>
        )}
      </main>
    </PageShell>
  );
}
