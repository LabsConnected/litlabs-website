"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Expand, Gamepad2, HardDrive, Keyboard, LockKeyhole, RotateCcw, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { detectSatellaview, getRetroGame, getRetroSystem, readRomAsBase64, updateRetroGame, type RetroGameRecord } from "@/lib/retro-arcade";

const EMULATOR_DATA_PATH = "https://cdn.emulatorjs.org/stable/data/";

/** A safe literal that survives JSON serialization inside an HTML attribute. */
function escapeForScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function buildPlayerDocument(opts: {
  core: string;
  gameUrl: string;
  gameName: string;
  gameId: string;
  color: string;
  biosUrl?: string;
  /** bsnes-specific config block; only emitted when a BIOS is present. */
  bsnesBios?: string;
}): string {
  const configLines = [
    `window.EJS_player = "#game";`,
    `window.EJS_core = ${JSON.stringify(opts.core)};`,
    `window.EJS_gameUrl = ${JSON.stringify(opts.gameUrl)};`,
    `window.EJS_gameName = ${JSON.stringify(opts.gameName)};`,
    `window.EJS_gameID = ${JSON.stringify(`litt-${opts.gameId}`)};`,
    `window.EJS_pathtodata = ${JSON.stringify(EMULATOR_DATA_PATH)};`,
    `window.EJS_startOnLoaded = true;`,
    `window.EJS_alignStartButton = "center";`,
    `window.EJS_color = ${JSON.stringify(opts.color)};`,
  ];
  if (opts.biosUrl) {
    configLines.push(`window.EJS_biosUrl = ${JSON.stringify(opts.biosUrl)};`);
  }
  if (opts.bsnesBios) {
    configLines.push(opts.bsnesBios);
  }
  // Surface uncaught emulator errors back to the parent so the aside panel
  // can render a real reason instead of staying on "Chapter loaded."
  configLines.push(
    `window.addEventListener("error",(e)=>{try{parent.postMessage({source:"ejs",type:"error",message:(e&&e.message)||"emulator error"},"*")}catch(_){}});`,
  );
  const config = configLines.join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body,#game{width:100%;height:100%;margin:0;background:#020204;overflow:hidden}body{font-family:system-ui,sans-serif}</style></head>
<body><div id="game"></div><script>${escapeForScript(config)}<\/script><script src="${EMULATOR_DATA_PATH}loader.js"><\/script></body></html>`;
}

export default function RetroPlayerPage() {
  const params = useParams<{ gameId: string }>();
  const stageRef = useRef<HTMLDivElement>(null);
  const biosInputRef = useRef<HTMLInputElement>(null);
  const launchRecorded = useRef(false);
  const [game, setGame] = useState<RetroGameRecord | null>(null);
  const [romDataUrl, setRomDataUrl] = useState<string | null>(null);
  const [biosDataUrl, setBiosDataUrl] = useState<string | null>(null);
  const [biosName, setBiosName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emulatorError, setEmulatorError] = useState<string | null>(null);
  const [isSatellaview, setIsSatellaview] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const record = await getRetroGame(params.gameId);
        if (!active) return;
        if (!record) throw new Error("This game is not stored in this browser.");
        const b64 = await readRomAsBase64(record.rom);
        if (!active) return;
        setGame(record);
        setIsSatellaview(detectSatellaview(record.fileName));
        setRomDataUrl(`data:application/octet-stream;base64,${b64}`);
        if (!launchRecorded.current) {
          launchRecorded.current = true;
          const updated = await updateRetroGame(record.id, { lastPlayedAt: Date.now(), launches: (record.launches ?? 0) + 1 });
          if (active) setGame(updated);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "The game could not be opened.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [params.gameId]);

  // Forward emulator errors emitted from the iframe back into a visible state.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { source?: string; type?: string; message?: string } | null;
      if (data && data.source === "ejs" && (data.type === "error" || data.type === "ready")) {
        if (data.type === "error" && data.message) setEmulatorError(data.message);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const system = game ? getRetroSystem(game.system) : null;
  const isSnes = game?.system === "snes";
  // For Satellaview content we ask EmulatorJS to use the bsnes core, which
  // can mount the BS‑X BIOS alongside the broadcast data. For ordinary SNES
  // games we keep the default snes9x core.
  const emulatorCore = !isSnes ? (game?.system === "gbc" ? "gb" : game?.system ?? "snes") : (isSatellaview ? "bsnes" : "snes");

  const srcDoc = useMemo(() => {
    if (!game || !romDataUrl) return "";
    return buildPlayerDocument({
      core: emulatorCore,
      gameUrl: romDataUrl,
      gameName: game.title,
      gameId: game.id,
      color: system?.color ?? "#a78bfa",
      biosUrl: isSatellaview && biosDataUrl ? biosDataUrl : undefined,
      bsnesBios: undefined,
    });
  }, [game, romDataUrl, biosDataUrl, isSatellaview, emulatorCore, system]);

  async function pickBios(file?: File) {
    if (!file) return;
    try {
      const b64 = await readRomAsBase64(file);
      setBiosDataUrl(`data:application/octet-stream;base64,${b64}`);
      setBiosName(file.name);
      setEmulatorError(null);
    } catch (reason) {
      setEmulatorError(reason instanceof Error ? reason.message : "Could not read BIOS file.");
    }
  }

  function clearBios() {
    setBiosDataUrl(null);
    setBiosName(null);
  }

  async function enterFullscreen() {
    try { await stageRef.current?.requestFullscreen(); } catch { /* Browser controls remain available. */ }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#050507] text-white"><div className="text-center"><Gamepad2 className="mx-auto animate-pulse text-fuchsia-400" size={40}/><p className="mt-4 text-sm font-bold text-white/50">Loading local cartridge…</p></div></div>;

  if (error || !game || !system) return <div className="flex min-h-screen items-center justify-center bg-[#050507] p-6 text-white"><div className="max-w-md rounded-3xl border border-white/10 bg-white/[.035] p-8 text-center"><LockKeyhole className="mx-auto text-fuchsia-300" size={36}/><h1 className="mt-4 text-2xl font-black">Game not found here</h1><p className="mt-2 text-sm leading-6 text-white/45">{error ?? "This local game is unavailable."} ROMs are device-specific, so add it again from this browser if needed.</p><Link href="/games/retro" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-black"><ArrowLeft size={15}/> Return to arcade</Link></div></div>;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,rgba(168,85,247,.18),transparent_30%),#050507] text-white">
      <header className="border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3"><Link href="/games/retro" className="rounded-xl border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white"><ArrowLeft size={18}/></Link><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black" style={{ background: `${system.color}20`, color: system.color }}>{system.shortName}</span><div className="min-w-0"><h1 className="truncate text-sm font-black sm:text-base">{game.title}</h1><p className="truncate text-[11px] text-white/35">LiTT Retro Arcade · local session{isSatellaview && " · Satellaview / BS‑X"}</p></div></div>
          <button onClick={enterFullscreen} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black hover:bg-white/10"><Expand size={15}/><span className="hidden sm:inline">Fullscreen</span></button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_290px] xl:p-5">
        <section className="min-w-0">
          <div ref={stageRef} className="relative aspect-[16/10] min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:min-h-[520px]">
            <iframe key={romDataUrl + "|" + (biosDataUrl ?? "")} title={`${game.title} emulator`} srcDoc={srcDoc} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock" allow="autoplay; fullscreen; gamepad" allowFullScreen />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.025] px-4 py-3">
            <div className="flex flex-wrap gap-4 text-[11px] text-white/40"><span className="flex items-center gap-1.5"><Gamepad2 size={13}/> Gamepad ready</span><span className="flex items-center gap-1.5"><Keyboard size={13}/> Keyboard controls</span><span className="flex items-center gap-1.5"><HardDrive size={13}/> Save states in player menu</span></div>
            <button onClick={() => window.location.reload()} className="flex items-center gap-1.5 text-xs font-bold text-white/50 hover:text-white"><RotateCcw size={13}/> Reload player</button>
          </div>
          {emulatorError && <div className="mt-3 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] px-4 py-3 text-xs text-rose-100"><span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-rose-400"/><div><b className="block text-rose-200">Emulator reported an error</b><span className="text-rose-100/80">{emulatorError}</span></div></div>}
        </section>

        <aside className="space-y-4">
          {isSatellaview && (
            <section className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[.05] p-5">
              <div className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full border border-cyan-300/40 text-[10px] font-black text-cyan-200">BS</span><h2 className="text-sm font-black">BS‑X BIOS required</h2></div>
              <p className="mt-2 text-xs leading-5 text-white/55">Satellaview titles need the BS‑X BIOS to boot. Pick a copy here — it stays in this browser only, never uploaded.</p>
              {biosName ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[.06] px-3 py-2 text-xs"><span className="truncate text-emerald-100">BIOS · {biosName}</span><button onClick={clearBios} className="rounded p-1 text-white/40 hover:text-white" aria-label="Remove BIOS"><X size={13}/></button></div>
              ) : (
                <button onClick={() => biosInputRef.current?.click()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 py-2 text-xs font-black text-cyan-200 hover:bg-cyan-400/15"><Upload size={13}/> Load BS‑X BIOS</button>
              )}
              <input ref={biosInputRef} type="file" className="hidden" accept=".sfc,.smc,.bin,.rom" onChange={(event) => { pickBios(event.target.files?.[0]); event.target.value = ""; }} />
            </section>
          )}
          <section className="relative overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-b from-violet-500/10 to-transparent p-5"><div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-fuchsia-500/20 blur-3xl"/><Sparkles className="text-violet-300" size={20}/><div className="mt-3 text-[10px] font-black uppercase tracking-[.22em] text-violet-300">LiTT Companion</div><h2 className="mt-2 text-lg font-black">{emulatorError ? "Emulator trouble." : "Chapter loaded."}</h2><p className="mt-2 text-sm leading-6 text-white/45">{emulatorError ? emulatorError : `Your ${system.shortName} cartridge is running locally. Open the emulator menu for saves, control mapping, cheats, screenshots, and other supported tools.`}</p></section>
          <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><h2 className="text-sm font-black">Session details</h2><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-white/35">System</dt><dd className="text-right font-bold">{system.name}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/35">Core</dt><dd className="text-right font-bold">{emulatorCore}</dd></div>{isSatellaview && <div className="flex justify-between gap-3"><dt className="text-white/35">Mode</dt><dd className="text-right font-bold text-cyan-200">Satellaview / BS‑X</dd></div>}<div className="flex justify-between gap-3"><dt className="text-white/35">Launches</dt><dd className="font-bold">{game.launches}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/35">Storage</dt><dd className="font-bold text-emerald-300">This browser</dd></div></dl></section>
          <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.04] p-5"><ShieldCheck className="text-emerald-300" size={19}/><h2 className="mt-3 text-sm font-black">Private play</h2><p className="mt-2 text-xs leading-5 text-white/40">The ROM and BIOS were loaded from this browser only — the data stays in memory as a base64 URL inside the emulator iframe. LiTT does not upload the file.</p></section>
        </aside>
      </div>
    </main>
  );
}
