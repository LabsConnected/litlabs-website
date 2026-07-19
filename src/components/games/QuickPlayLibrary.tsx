"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  Info,
  Loader2,
  Play,
  Sparkles,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  QUICK_PLAY_LIBRARY,
  downloadQuickPlayRom,
  quickPlayLicenseLabel,
  type QuickPlayGame,
} from "@/lib/retro-quickplay";
import { addRetroGame, getRetroSystem } from "@/lib/retro-arcade";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

type Props = {
  /**
   * Called after a Quick Play game is added to the local IndexedDB library
   * (and before the play page is opened) so the parent can refresh its list
   * of games.
   */
  onAdded?: (gameId: string, game: QuickPlayGame) => void;
  /**
   * Optional: hide the header / decorative chrome so the parent can render
   * the library inline inside another card.
   */
  embedded?: boolean;
};

export default function QuickPlayLibrary({ onAdded, embedded = false }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [activeInfo, setActiveInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function addAndPlay(game: QuickPlayGame) {
    if (busyId) return;
    setBusyId(game.id);
    setStatus((current) => ({ ...current, [game.id]: { kind: "loading" } }));
    try {
      const file = await downloadQuickPlayRom(game);
      const record = await addRetroGame(file, game.title, game.system);
      setStatus((current) => ({ ...current, [game.id]: { kind: "idle" } }));
      onAdded?.(record.id, game);
      router.push(`/games/retro/play/${record.id}`);
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Could not download this game.";
      setStatus((current) => ({
        ...current,
        [game.id]: { kind: "error", message },
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      aria-label="Quick Play public-domain homebrew"
      className={
        embedded
          ? "space-y-4"
          : "rounded-3xl border border-emerald-400/20 bg-linear-to-b from-emerald-400/[.04] to-transparent p-4 sm:p-5"
      }
    >
      {!embedded && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
              style={{
                backgroundColor: "rgba(52, 211, 153, 0.12)",
                color: "#34d399",
              }}
            >
              <Sparkles size={18} />
            </span>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.25em] text-emerald-300">
                Quick Play
              </div>
              <h2 className="mt-1 text-lg font-black text-white">
                Free homebrew, one click away
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-white/55">
                Public-domain and MIT-licensed homebrew ROMs you can launch
                without uploading anything. Each game keeps the same private,
                browser-only storage as your own files.
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-emerald-300/20 bg-emerald-300/[.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-200">
            <ShieldCheck size={11} /> No copyright issues
          </div>
        </header>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {QUICK_PLAY_LIBRARY.map((game) => {
          const system = getRetroSystem(game.system);
          const itemStatus = status[game.id] ?? { kind: "idle" };
          const isBusy = busyId === game.id;
          const showInfo = activeInfo === game.id;
          return (
            <article
              key={game.id}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e16] transition hover:-translate-y-0.5 hover:border-white/20"
            >
              <div
                className="relative flex h-24 items-center gap-4 overflow-hidden px-4"
                style={{
                  background: `radial-gradient(circle at 15% 20%, ${game.accent}33, transparent 55%), linear-gradient(145deg,#181826,#0a0a10)`,
                }}
              >
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl"
                  style={{
                    backgroundColor: `${game.accent}22`,
                    color: game.accent,
                  }}
                  aria-hidden
                >
                  {game.glyph}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-white">
                    {game.title}
                  </h3>
                  <p className="mt-0.5 truncate text-[11px] text-white/55">
                    {game.tagline}
                  </p>
                </div>
                <span
                  className="absolute right-3 top-3 rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
                  style={{ color: system.color }}
                >
                  {system.shortName}
                </span>
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2 text-[10px] text-white/45">
                  <span className="truncate" title={game.author}>
                    by {game.author} · {game.year}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-black uppercase tracking-wider text-emerald-200">
                    {quickPlayLicenseLabel(game.license)}
                  </span>
                </div>

                {itemStatus.kind === "error" && (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-400/20 bg-rose-400/[.07] p-2.5 text-[11px] leading-5 text-rose-100"
                  >
                    <div className="font-bold text-rose-200">
                      Couldn’t add this one
                    </div>
                    <div className="mt-1 text-rose-100/85">
                      {itemStatus.message}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a
                        href={game.licenseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-rose-100 hover:bg-white/10"
                      >
                        <ExternalLink size={10} /> Source
                      </a>
                      <a
                        href={game.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-rose-100 hover:bg-white/10"
                      >
                        <Download size={10} /> Direct file
                      </a>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addAndPlay(game)}
                    disabled={isBusy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white py-2 text-xs font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`Add ${game.title} to my arcade and play`}
                  >
                    {isBusy ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Fetching…
                      </>
                    ) : (
                      <>
                        <Play size={13} fill="currentColor" />
                        Add & Play
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveInfo(showInfo ? null : game.id)
                    }
                    aria-label={`More info about ${game.title}`}
                    aria-expanded={showInfo}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/55 transition hover:bg-white/10 hover:text-white"
                  >
                    {showInfo ? <X size={13} /> : <Info size={13} />}
                  </button>
                </div>

                {showInfo && (
                  <div className="space-y-2 rounded-lg border border-white/10 bg-white/[.03] p-3 text-[11px] leading-5 text-white/65">
                    <p>{game.description}</p>
                    <p className="text-white/40">
                      {system.name} · {Math.max(1, Math.round(game.sizeBytes / 1024))} KB
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={game.licenseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                      >
                        <ShieldCheck size={11} /> License
                      </a>
                      {game.homeUrl ? (
                        <a
                          href={game.homeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                        >
                          <ExternalLink size={11} /> Project page
                        </a>
                      ) : null}
                      <a
                        href={game.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-white/55 hover:text-white"
                      >
                        <Download size={11} /> Direct file
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {!embedded && (
        <p className="text-[10px] leading-5 text-white/35">
          Don’t see your favorite system? Drop in your own legally obtained
          ROM via the <Link href="/games/retro" className="text-emerald-300 hover:text-emerald-200">Add your game</Link> button.
        </p>
      )}
    </section>
  );
}
