"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Expand, Gamepad2, HardDrive, Keyboard, LockKeyhole, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { getRetroGame, getRetroSystem, updateRetroGame, type RetroGameRecord } from "@/lib/retro-arcade";

const EMULATOR_DATA_PATH = "https://cdn.emulatorjs.org/stable/data/";

function playerDocument(game: RetroGameRecord, romUrl: string): string {
  const system = getRetroSystem(game.system);
  const emulatorCore = game.system === "gbc" ? "gb" : game.system;
  const config = [
    `window.EJS_player = "#game";`,
    `window.EJS_core = ${JSON.stringify(emulatorCore)};`,
    `window.EJS_gameUrl = ${JSON.stringify(romUrl)};`,
    `window.EJS_gameName = ${JSON.stringify(game.title)};`,
    `window.EJS_gameID = ${JSON.stringify(`litt-${game.id}`)};`,
    `window.EJS_pathtodata = ${JSON.stringify(EMULATOR_DATA_PATH)};`,
    `window.EJS_startOnLoaded = true;`,
    `window.EJS_alignStartButton = "center";`,
    `window.EJS_color = ${JSON.stringify(system.color)};`,
  ].join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body,#game{width:100%;height:100%;margin:0;background:#020204;overflow:hidden}body{font-family:system-ui,sans-serif}</style></head>
<body><div id="game"></div><script>${config}<\/script><script src="${EMULATOR_DATA_PATH}loader.js"><\/script></body></html>`;
}

export default function RetroPlayerPage() {
  const params = useParams<{ gameId: string }>();
  const stageRef = useRef<HTMLDivElement>(null);
  const launchRecorded = useRef(false);
  const [game, setGame] = useState<RetroGameRecord | null>(null);
  const [romUrl, setRomUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    getRetroGame(params.gameId).then(async (record) => {
      if (!active) return;
      if (!record) throw new Error("This game is not stored in this browser.");
      objectUrl = URL.createObjectURL(record.rom);
      setRomUrl(objectUrl);
      setGame(record);
      if (!launchRecorded.current) {
        launchRecorded.current = true;
        const updated = await updateRetroGame(record.id, { lastPlayedAt: Date.now(), launches: (record.launches ?? 0) + 1 });
        if (active) setGame(updated);
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "The game could not be opened.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [params.gameId]);

  const srcDoc = useMemo(() => game && romUrl ? playerDocument(game, romUrl) : "", [game, romUrl]);
  const system = game ? getRetroSystem(game.system) : null;

  async function enterFullscreen() {
    try { await stageRef.current?.requestFullscreen(); } catch { /* Browser controls remain available. */ }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#050507] text-white"><div className="text-center"><Gamepad2 className="mx-auto animate-pulse text-fuchsia-400" size={40}/><p className="mt-4 text-sm font-bold text-white/50">Loading local cartridge…</p></div></div>;

  if (error || !game || !system) return <div className="flex min-h-screen items-center justify-center bg-[#050507] p-6 text-white"><div className="max-w-md rounded-3xl border border-white/10 bg-white/[.035] p-8 text-center"><LockKeyhole className="mx-auto text-fuchsia-300" size={36}/><h1 className="mt-4 text-2xl font-black">Game not found here</h1><p className="mt-2 text-sm leading-6 text-white/45">{error ?? "This local game is unavailable."} ROMs are device-specific, so add it again from this browser if needed.</p><Link href="/games/retro" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-black"><ArrowLeft size={15}/> Return to arcade</Link></div></div>;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,rgba(168,85,247,.18),transparent_30%),#050507] text-white">
      <header className="border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3"><Link href="/games/retro" className="rounded-xl border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white"><ArrowLeft size={18}/></Link><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black" style={{ background: `${system.color}20`, color: system.color }}>{system.shortName}</span><div className="min-w-0"><h1 className="truncate text-sm font-black sm:text-base">{game.title}</h1><p className="truncate text-[11px] text-white/35">LiTT Retro Arcade · local session</p></div></div>
          <button onClick={enterFullscreen} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black hover:bg-white/10"><Expand size={15}/><span className="hidden sm:inline">Fullscreen</span></button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_290px] xl:p-5">
        <section className="min-w-0">
          <div ref={stageRef} className="relative aspect-[16/10] min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:min-h-[520px]">
            <iframe key={romUrl} title={`${game.title} emulator`} srcDoc={srcDoc} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock" allow="autoplay; fullscreen; gamepad" allowFullScreen />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.025] px-4 py-3">
            <div className="flex flex-wrap gap-4 text-[11px] text-white/40"><span className="flex items-center gap-1.5"><Gamepad2 size={13}/> Gamepad ready</span><span className="flex items-center gap-1.5"><Keyboard size={13}/> Keyboard controls</span><span className="flex items-center gap-1.5"><HardDrive size={13}/> Save states in player menu</span></div>
            <button onClick={() => window.location.reload()} className="flex items-center gap-1.5 text-xs font-bold text-white/50 hover:text-white"><RotateCcw size={13}/> Reload player</button>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="relative overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-b from-violet-500/10 to-transparent p-5"><div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-fuchsia-500/20 blur-3xl"/><Sparkles className="text-violet-300" size={20}/><div className="mt-3 text-[10px] font-black uppercase tracking-[.22em] text-violet-300">LiTT Companion</div><h2 className="mt-2 text-lg font-black">Chapter loaded.</h2><p className="mt-2 text-sm leading-6 text-white/45">Your {system.shortName} cartridge is running locally. Open the emulator menu for saves, control mapping, cheats, screenshots, and other supported tools.</p></section>
          <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><h2 className="text-sm font-black">Session details</h2><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-white/35">System</dt><dd className="text-right font-bold">{system.name}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/35">Launches</dt><dd className="font-bold">{game.launches}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/35">Storage</dt><dd className="font-bold text-emerald-300">This browser</dd></div></dl></section>
          <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.04] p-5"><ShieldCheck className="text-emerald-300" size={19}/><h2 className="mt-3 text-sm font-black">Private play</h2><p className="mt-2 text-xs leading-5 text-white/40">The ROM was loaded from local IndexedDB through a temporary browser URL. LiTT does not upload the file.</p></section>
        </aside>
      </div>
    </main>
  );
}
