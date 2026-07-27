"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Expand,
  Gamepad2,
  HardDrive,
  Keyboard,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  detectSatellaview,
  EMULATOR_CORE_BY_SYSTEM,
  getRetroGame,
  getRetroSystem,
  readRomAsBase64,
  updateRetroGame,
  type RetroGameRecord,
} from "@/lib/retro-arcade";
import { RetroControlsModal } from "@/components/games/RetroControlsModal";

// Self-hosted EmulatorJS 4.2.3 data directory.
// Previously: https://cdn.emulatorjs.org/4.2.3/data/ (CDN death / cache corruption broke every launch)
const EMULATOR_DATA_PATH = "/emulatorjs/4.2.3/data/";
const EMULATOR_VERSION = "4.2.3";
// Versioned cache namespace. Bump when upgrading EmulatorJS or changing the
// data directory so stale IndexedDB / Cache Storage entries are invalidated.
const EMULATOR_BUILD_ID = "ejs-4.2.3-litt-v2";
const INIT_TIMEOUT_MS = 45_000;
const STALL_TIMEOUT_MS = 15_000;

type EmulatorRuntimeState =
  | "loading_rom"
  | "loading_loader"
  | "downloading_core"
  | "decompressing_core"
  | "initializing"
  | "running"
  | "timed_out"
  | "error";

interface DiagnosticInfo {
  buildId: string;
  version: string;
  browser: string;
  core: string;
  romExtension: string;
  romSize: number;
  biosPresent: boolean;
  dataPath: string;
  loaderStatus: "pending" | "loaded" | "failed";
  coreRequestStatus: "pending" | "downloading" | "decompressing" | "ready" | "failed";
  coreResponseBytes: number | null;
  decompressionProgress: string | null;
  elapsedMs: number | null;
  latestEvent: string | null;
  latestError: string | null;
}

function detectBrowser(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/")) return "Safari";
  return "unknown";
}

function numericGameId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
}

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
  buildId: string;
}): string {
  const configLines = [
    `window.EJS_player = "#game";`,
    `window.EJS_core = ${JSON.stringify(opts.core)};`,
    `window.EJS_gameUrl = ${JSON.stringify(opts.gameUrl)};`,
    `window.EJS_gameName = ${JSON.stringify(opts.gameName)};`,
    `window.EJS_gameID = ${numericGameId(opts.gameId)};`,
    `window.EJS_pathtodata = ${JSON.stringify(EMULATOR_DATA_PATH)};`,
    `window.EJS_startOnLoaded = false;`,
    `window.EJS_startButtonName = ${JSON.stringify(`Start ${opts.gameName}`)};`,
    `window.EJS_disableAutoLang = true;`,
    `window.EJS_backgroundColor = "#020204";`,
    `window.EJS_alignStartButton = "center";`,
    `window.EJS_color = ${JSON.stringify(opts.color)};`,
    // Force legacy cores off; we ship both wasm and legacy-wasm variants.
    `window.EJS_threads = false;`,
    // Ready = UI loaded, NOT game started
    `window.EJS_ready = ()=>{try{parent.postMessage({source:"ejs",type:"ready",buildId:${JSON.stringify(opts.buildId)}},"*")}catch(_){}};`,
    // start = game actually started (canvas rendering)
    `window.EJS_onGameStart = ()=>{try{parent.postMessage({source:"ejs",type:"started",buildId:${JSON.stringify(opts.buildId)}},"*")}catch(_){}};`,
  ];
  if (opts.biosUrl) {
    configLines.push(`window.EJS_biosUrl = ${JSON.stringify(opts.biosUrl)};`);
  }
  configLines.push(
    `window.addEventListener("error",(e)=>{try{parent.postMessage({source:"ejs",type:"error",message:(e&&e.message)||"emulator error",buildId:${JSON.stringify(opts.buildId)}},"*")}catch(_){}});`,
    // Observe the loading text element so the parent knows the exact runtime
    // stage ("Download Game Core 42%", "Decompress Game Core 99%", etc).
    `const __littWatch=new MutationObserver(()=>{const el=document.querySelector(".ejs_loading_text");if(!el)return;const text=(el.innerText||"").trim();if(text)try{parent.postMessage({source:"ejs",type:"progress",text,buildId:${JSON.stringify(opts.buildId)}},"*")}catch(_){}});`,
    `const __littBoot=()=>{const root=document.getElementById("game");if(root)__littWatch.observe(root,{subtree:true,childList:true,characterData:true});else setTimeout(__littBoot,50);};`,
    `__littBoot();`,
  );
  const config = configLines.join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body,#game{width:100%;height:100%;margin:0;background:#020204;overflow:hidden}body{font-family:system-ui,sans-serif}</style></head>
<body><div id="game"></div><script>${escapeForScript(config)}<\/script><script src="${EMULATOR_DATA_PATH}loader.js" onerror="parent.postMessage({source:'ejs',type:'error',message:'The emulator runtime could not be loaded from ${EMULATOR_DATA_PATH}loader.js. The self-hosted data directory may be missing or blocked.',buildId:${JSON.stringify(opts.buildId)}},'*')"><\/script></body></html>`;
}

/**
 * Verify that the self-hosted EmulatorJS assets return HTTP 200 with non-zero
 * bodies before we even mount the iframe. Rejects HTML error pages served with
 * status 200, zero-byte responses, and timed-out requests.
 */
async function verifyEmulatorAssets(
  core: string,
): Promise<{ ok: boolean; failedUrl?: string; reason?: string; coreBytes?: number }> {
  const checks: Array<{ url: string; label: string; requireNonZero?: boolean }> = [
    { url: `${EMULATOR_DATA_PATH}loader.js`, label: "loader.js", requireNonZero: true },
    { url: `${EMULATOR_DATA_PATH}emulator.min.js`, label: "emulator.min.js", requireNonZero: true },
    { url: `${EMULATOR_DATA_PATH}cores/${core}-wasm.data`, label: `core ${core}-wasm.data`, requireNonZero: true },
    { url: `${EMULATOR_DATA_PATH}compression/extract7z.js`, label: "extract7z.js", requireNonZero: true },
  ];

  for (const check of checks) {
    try {
      const res = await fetch(check.url, { method: "GET", cache: "no-store" });
      if (!res.ok) {
        return { ok: false, failedUrl: check.url, reason: `HTTP ${res.status} ${res.statusText}` };
      }
      const buffer = await res.arrayBuffer();
      if (check.requireNonZero && buffer.byteLength === 0) {
        return { ok: false, failedUrl: check.url, reason: "Zero-byte response" };
      }
      // Reject HTML error pages (some CDNs return 200 + HTML for missing files)
      const contentType = res.headers.get("content-type") ?? "";
      if (check.label.includes("core") && contentType.includes("text/html")) {
        return { ok: false, failedUrl: check.url, reason: `Server returned HTML (content-type: ${contentType})` };
      }
      if (check.label.startsWith("core")) {
        return { ok: true, coreBytes: buffer.byteLength };
      }
    } catch (err) {
      return {
        ok: false,
        failedUrl: check.url,
        reason: err instanceof Error ? err.message : "Network request failed",
      };
    }
  }
  return { ok: true };
}

/**
 * Clear EmulatorJS cached data from IndexedDB, Cache Storage, and localStorage
 * WITHOUT touching the user's ROM library (which lives in a separate DB:
 * "litt-retro-arcade"). This forces a fresh download of the core on next launch.
 */
async function clearEmulatorCache(): Promise<{ cleared: string[]; error?: string }> {
  const cleared: string[] = [];

  // 1. IndexedDB — delete any DB whose name looks EmulatorJS-related, but
  //    NEVER touch "litt-retro-arcade" (user ROMs) or "litlab-*" (app data).
  try {
    const dbs = await indexedDB.databases?.();
    if (dbs) {
      for (const db of dbs) {
        const name = db.name ?? "";
        if (
          (name.toLowerCase().includes("emulator") ||
            name.toLowerCase().includes("ejs") ||
            name.toLowerCase().includes("core")) &&
          !name.includes("litt-retro-arcade")
        ) {
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
          cleared.push(`indexedDB:${name}`);
        }
      }
    }
  } catch {
    // Some browsers don't support indexedDB.databases() — that's fine.
  }

  // 2. Cache Storage — delete any cache that holds emulator assets.
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        if (
          key.toLowerCase().includes("emulator") ||
          key.toLowerCase().includes("ejs") ||
          key.toLowerCase().includes("core")
        ) {
          await caches.delete(key);
          cleared.push(`cache:${key}`);
        }
      }
    }
  } catch {
    // Cache Storage may be unavailable in some contexts.
  }

  // 3. localStorage — delete EmulatorJS keys only.
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.toLowerCase().includes("ejs") || key.toLowerCase().includes("emulator"))) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      localStorage.removeItem(key);
      cleared.push(`localStorage:${key}`);
    }
  } catch {
    // localStorage may be blocked by privacy settings.
  }

  return { cleared };
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
  const [showControls, setShowControls] = useState(false);
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const [runtimeState, setRuntimeState] = useState<EmulatorRuntimeState>("loading_rom");
  const [coreOverride, setCoreOverride] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [launchStartTime, setLaunchStartTime] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [lastProgressAt, setLastProgressAt] = useState<number | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [assetCheck, setAssetCheck] = useState<{ ok: boolean; failedUrl?: string; reason?: string; coreBytes?: number } | null>(null);
  const [cacheClearResult, setCacheClearResult] = useState<string | null>(null);
  const [latestEvent, setLatestEvent] = useState<string | null>(null);

  // Load the ROM record from IndexedDB.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const record = await getRetroGame(params.gameId);
        if (!active) return;
        if (!record) throw new Error("This game is not stored in this browser.");
        const objectUrl = URL.createObjectURL(record.rom);
        if (!active) return;
        setGame(record);
        setIsSatellaview(detectSatellaview(record.fileName));
        setRomDataUrl(objectUrl);
        setRuntimeState("loading_loader");
        setLaunchStartTime(Date.now());
        if (!launchRecorded.current) {
          launchRecorded.current = true;
          const updated = await updateRetroGame(record.id, {
            lastPlayedAt: Date.now(),
            launches: (record.launches ?? 0) + 1,
          });
          if (active) setGame(updated);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "The game could not be opened.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      setRomDataUrl((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [params.gameId]);

  const system = game ? getRetroSystem(game.system) : null;
  const isSnes = game?.system === "snes";
  // SNES default is snes9x (the only SNES core shipped in EmulatorJS 4.2.3).
  // bsnes is NOT in 4.2.3 — never auto-switch to it.
  const emulatorCore = coreOverride ?? (game ? EMULATOR_CORE_BY_SYSTEM[game.system] : "snes");
  // Map our system IDs to EmulatorJS core names.
  const ejsCore = useMemo(() => {
    if (coreOverride) return coreOverride;
    if (!game) return "snes";
    const map: Record<string, string> = {
      nes: "fceumm",
      snes: "snes9x",
      gb: "gambatte",
      gbc: "gambatte",
      gba: "mgba",
      segaMD: "genesis_plus_gx",
    };
    return map[game.system] ?? "snes9x";
  }, [game, coreOverride]);

  // Per-launch nonce so we can ignore stale postMessage events from a prior
  // iframe instance after a retry. Derived from playerAttempt (no ref write
  // during render).
  const launchNonce = useMemo(() => `${playerAttempt}-${Date.now()}`, [playerAttempt]);

  // Listen for postMessage events from the iframe.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { source?: string; type?: string; message?: string; text?: string; buildId?: string } | null;
      if (!data || data.source !== "ejs") return;
      // Validate buildId to ignore events from a stale iframe.
      if (data.buildId && data.buildId !== EMULATOR_BUILD_ID) return;

      setLatestEvent(data.type ?? "unknown");

      if (data.type === "error" && data.message) {
        setEmulatorError(data.message);
        setRuntimeState("error");
      } else if (data.type === "ready") {
        // UI loaded — NOT game started. Move to initializing.
        setRuntimeState("initializing");
        setEmulatorError(null);
      } else if (data.type === "started") {
        // Game actually started — canvas is rendering.
        setRuntimeState("running");
        setEmulatorError(null);
        setProgressText(null);
      } else if (data.type === "progress" && data.text) {
        const text = data.text;
        setProgressText(text);
        setLastProgressAt(Date.now());
        // Derive runtime state from the progress text.
        const lower = text.toLowerCase();
        if (lower.includes("download") && lower.includes("core")) {
          setRuntimeState("downloading_core");
        } else if (lower.includes("decompress") && lower.includes("core")) {
          setRuntimeState("decompressing_core");
        } else if (lower.includes("loading")) {
          setRuntimeState("initializing");
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Elapsed time ticker.
  useEffect(() => {
    if (runtimeState === "running" || runtimeState === "error" || runtimeState === "timed_out") {
      if (launchStartTime !== null) {
        setElapsedMs(Date.now() - launchStartTime);
      }
      return;
    }
    if (launchStartTime === null) return;
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - launchStartTime);
    }, 500);
    return () => window.clearInterval(interval);
  }, [runtimeState, launchStartTime]);

  // Hard 45s timeout.
  useEffect(() => {
    if (runtimeState === "running" || runtimeState === "error" || runtimeState === "timed_out") return;
    if (launchStartTime === null) return;
    const remaining = INIT_TIMEOUT_MS - (Date.now() - launchStartTime);
    if (remaining <= 0) {
      setRuntimeState("timed_out");
      setEmulatorError(
        `The emulator did not start within ${INIT_TIMEOUT_MS / 1000}s. The core may be corrupted or blocked. Try clearing the emulator cache and retrying.`,
      );
      return;
    }
    const timer = window.setTimeout(() => {
      setRuntimeState((current) => {
        if (current === "running" || current === "error") return current;
        setEmulatorError(
          `The emulator did not start within ${INIT_TIMEOUT_MS / 1000}s. The core may be corrupted or blocked. Try clearing the emulator cache and retrying.`,
        );
        return "timed_out";
      });
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [runtimeState, launchStartTime, playerAttempt]);

  // Stall detection — if no progress event for 15s while loading, mark stalled.
  useEffect(() => {
    if (runtimeState === "running" || runtimeState === "error" || runtimeState === "timed_out") return;
    if (lastProgressAt === null) return;
    const remaining = STALL_TIMEOUT_MS - (Date.now() - lastProgressAt);
    if (remaining <= 0) {
      setRuntimeState((current) => {
        if (current === "running" || current === "error" || current === "timed_out") return current;
        setEmulatorError(
          `Emulator stalled — no progress for ${STALL_TIMEOUT_MS / 1000}s. Last status: "${progressText ?? "unknown"}". The core download or decompression may have hung. Clear the emulator cache and retry.`,
        );
        return "error";
      });
      return;
    }
    const timer = window.setTimeout(() => {
      setRuntimeState((current) => {
        if (current === "running" || current === "error" || current === "timed_out") return current;
        setEmulatorError(
          `Emulator stalled — no progress for ${STALL_TIMEOUT_MS / 1000}s. Last status: "${progressText ?? "unknown"}". The core download or decompression may have hung. Clear the emulator cache and retry.`,
        );
        return "error";
      });
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [runtimeState, lastProgressAt, progressText, playerAttempt]);

  // Pre-flight asset verification before mounting the iframe.
  useEffect(() => {
    if (!game || !romDataUrl) return;
    let active = true;
    (async () => {
      const result = await verifyEmulatorAssets(ejsCore);
      if (!active) return;
      setAssetCheck(result);
      if (!result.ok) {
        setRuntimeState("error");
        setEmulatorError(
          `Self-hosted emulator asset check failed: ${result.failedUrl} — ${result.reason}. The data directory at ${EMULATOR_DATA_PATH} may be incomplete.`,
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [game, romDataUrl, ejsCore, playerAttempt]);

  const retryPlayer = useCallback((nextCore?: string) => {
    if (nextCore) setCoreOverride(nextCore);
    setEmulatorError(null);
    setProgressText(null);
    setAssetCheck(null);
    setLatestEvent(null);
    setRuntimeState("loading_loader");
    setLaunchStartTime(Date.now());
    setLastProgressAt(null);
    setElapsedMs(null);
    setPlayerAttempt((attempt) => attempt + 1);
  }, []);

  const handleClearCache = useCallback(async () => {
    const result = await clearEmulatorCache();
    const count = result.cleared.length;
    setCacheClearResult(
      count > 0
        ? `Cleared ${count} emulator cache entr${count === 1 ? "y" : "ies"}: ${result.cleared.slice(0, 3).join(", ")}${count > 3 ? "…" : ""}. ROMs preserved.`
        : "No emulator cache entries found. ROMs preserved.",
    );
  }, []);

  const srcDoc = useMemo(() => {
    if (!game || !romDataUrl) return "";
    return buildPlayerDocument({
      core: ejsCore,
      gameUrl: romDataUrl,
      gameName: game.title,
      gameId: game.id,
      color: system?.color ?? "#a78bfa",
      biosUrl: isSatellaview && biosDataUrl ? biosDataUrl : undefined,
      buildId: EMULATOR_BUILD_ID,
    });
  }, [game, romDataUrl, biosDataUrl, isSatellaview, ejsCore, system]);

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
    try {
      await stageRef.current?.requestFullscreen();
    } catch {
      /* Browser controls remain available. */
    }
  }

  // Satellaview games require BS-X BIOS. Block launch until BIOS is provided.
  const biosRequired = isSatellaview && !biosDataUrl;
  const canLaunch = !biosRequired;

  const diagnostic: DiagnosticInfo = {
    buildId: EMULATOR_BUILD_ID,
    version: EMULATOR_VERSION,
    browser: detectBrowser(),
    core: ejsCore,
    romExtension: game?.fileName.split(".").pop() ?? "—",
    romSize: game?.size ?? 0,
    biosPresent: !!biosDataUrl,
    dataPath: EMULATOR_DATA_PATH,
    loaderStatus: assetCheck?.ok ? "loaded" : assetCheck?.ok === false ? "failed" : "pending",
    coreRequestStatus:
      runtimeState === "downloading_core"
        ? "downloading"
        : runtimeState === "decompressing_core"
          ? "decompressing"
          : runtimeState === "running"
            ? "ready"
            : runtimeState === "error" || runtimeState === "timed_out"
              ? "failed"
              : "pending",
    coreResponseBytes: assetCheck?.coreBytes ?? null,
    decompressionProgress: progressText,
    elapsedMs,
    latestEvent,
    latestError: emulatorError,
  };

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050507] text-white">
        <div className="text-center">
          <Gamepad2 className="mx-auto animate-pulse text-fuchsia-400" size={40} />
          <p className="mt-4 text-sm font-bold text-white/50">Loading local cartridge…</p>
        </div>
      </div>
    );

  if (error || !game || !system)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050507] p-6 text-white">
        <div className="max-w-md rounded-3xl border border-white/10 bg-white/[.035] p-8 text-center">
          <LockKeyhole className="mx-auto text-fuchsia-300" size={36} />
          <h1 className="mt-4 text-2xl font-black">Game not found here</h1>
          <p className="mt-2 text-sm leading-6 text-white/45">
            {error ?? "This local game is unavailable."} ROMs are device-specific, so add it again from this browser if needed.
          </p>
          <Link
            href="/games/retro"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-black"
          >
            <ArrowLeft size={15} /> Return to arcade
          </Link>
        </div>
      </div>
    );

  const isRunning = runtimeState === "running";
  const isError = runtimeState === "error" || runtimeState === "timed_out";
  const isLoadingState =
    runtimeState === "loading_rom" ||
    runtimeState === "loading_loader" ||
    runtimeState === "downloading_core" ||
    runtimeState === "decompressing_core" ||
    runtimeState === "initializing";

  const stateLabel: Record<EmulatorRuntimeState, string> = {
    loading_rom: "Loading ROM",
    loading_loader: "Loading emulator runtime",
    downloading_core: "Downloading core",
    decompressing_core: "Decompressing core",
    initializing: "Initializing emulator",
    running: "Running",
    timed_out: "Timed out",
    error: "Error",
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,rgba(168,85,247,.18),transparent_30%),#050507] text-white">
      <header className="border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/games/retro"
              className="rounded-xl border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Back to arcade"
            >
              <ArrowLeft size={18} />
            </Link>
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black"
              style={{ background: `${system.color}20`, color: system.color }}
            >
              {system.shortName}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-black sm:text-base">{game.title}</h1>
              <p className="truncate text-[11px] text-white/35">
                LiTT Retro Arcade · local session{isSatellaview && " · Satellaview / BS-X"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDiagnostic((v) => !v)}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black hover:bg-white/10"
              aria-label="Toggle diagnostics"
            >
              {showDiagnostic ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              <span className="hidden sm:inline">Diagnostics</span>
            </button>
            <button
              onClick={enterFullscreen}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black hover:bg-white/10"
              aria-label="Enter fullscreen"
            >
              <Expand size={15} />
              <span className="hidden sm:inline">Fullscreen</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_290px] xl:p-5">
        <section className="min-w-0">
          <div
            ref={stageRef}
            className="relative aspect-[16/10] min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:min-h-[520px]"
          >
            {canLaunch ? (
              <iframe
                key={`${romDataUrl}|${biosDataUrl ?? ""}|${ejsCore}|${playerAttempt}|${launchNonce}`}
                title={`${game.title} emulator`}
                srcDoc={srcDoc}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock"
                allow="autoplay; fullscreen; gamepad"
                allowFullScreen
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <LockKeyhole className="mx-auto text-cyan-300" size={36} />
                  <h2 className="text-lg font-black">BS-X BIOS required</h2>
                  <p className="text-xs leading-5 text-white/55">
                    This Satellaview title needs the BS-X BIOS to boot. Load a BIOS file from the panel on the right — it stays in this browser only.
                  </p>
                </div>
              </div>
            )}
            {isLoadingState && canLaunch && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-cyan-300/20 bg-black/70 px-3 py-1.5 text-[10px] font-bold text-cyan-100 backdrop-blur">
                {stateLabel[runtimeState]} · {ejsCore}
                {progressText ? ` · ${progressText}` : ""}
                {elapsedMs !== null ? ` · ${elapsedMs}ms` : ""}
              </div>
            )}
            {isRunning && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-emerald-300/20 bg-black/70 px-3 py-1.5 text-[10px] font-bold text-emerald-100 backdrop-blur">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Running · {ejsCore}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.025] px-4 py-3">
            <div className="flex flex-wrap gap-4 text-[11px] text-white/40">
              <span className="flex items-center gap-1.5">
                <Gamepad2 size={13} /> Gamepad ready
              </span>
              <button
                type="button"
                onClick={() => setShowControls(true)}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-white/40 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400/50"
                aria-label={`Open ${system.name} keyboard controls`}
              >
                <Keyboard size={13} /> Keyboard controls
              </button>
              <span className="flex items-center gap-1.5">
                <HardDrive size={13} /> Save states in player menu
              </span>
            </div>
            <button
              onClick={() => retryPlayer()}
              className="flex items-center gap-1.5 text-xs font-bold text-white/50 hover:text-white"
              aria-label="Reload player"
            >
              <RotateCcw size={13} /> Reload player
            </button>
          </div>

          {isError && (
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] px-4 py-3 text-xs text-rose-100">
              <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-rose-400" />
              <div className="min-w-0 flex-1">
                <b className="block text-rose-200">
                  {runtimeState === "timed_out" ? "Launch timed out" : "Player recovery available"}
                </b>
                <span className="text-rose-100/80">{emulatorError}</span>
                {progressText && (
                  <p className="mt-1 text-[10px] text-rose-100/60">Last status: {progressText}</p>
                )}
                {assetCheck && !assetCheck.ok && (
                  <p className="mt-1 text-[10px] text-rose-100/60">
                    Asset check failed: {assetCheck.failedUrl} ({assetCheck.reason})
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => retryPlayer()}
                    className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-[10px] font-bold text-rose-200 hover:bg-rose-400/10"
                  >
                    Clean retry
                  </button>
                  <button
                    onClick={handleClearCache}
                    className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-[10px] font-bold text-amber-200 hover:bg-amber-400/10"
                  >
                    <Trash2 size={11} className="mr-1 inline" />
                    Clear emulator cache
                  </button>
                  {game.system === "nes" && (
                    <button
                      onClick={() => retryPlayer(ejsCore === "fceumm" ? "nestopia" : "fceumm")}
                      className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Try {ejsCore === "fceumm" ? "Nestopia" : "FCEUmm"}
                    </button>
                  )}
                  <Link
                    href="/games/retro"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-[10px] font-bold text-white/60 hover:bg-white/5"
                  >
                    Back to Library
                  </Link>
                </div>
                {cacheClearResult && (
                  <p className="mt-2 text-[10px] text-amber-200/80">{cacheClearResult}</p>
                )}
              </div>
            </div>
          )}

          {showDiagnostic && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/60 p-4 text-[10px] font-mono text-white/70">
              <div className="mb-2 font-bold text-white/90">DIAGNOSTICS — {diagnostic.buildId}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>EmulatorJS: {diagnostic.version}</div>
                <div>Browser: {diagnostic.browser}</div>
                <div>Core: {diagnostic.core}</div>
                <div>ROM: .{diagnostic.romExtension} ({diagnostic.romSize.toLocaleString()} bytes)</div>
                <div>BIOS: {diagnostic.biosPresent ? "present" : "—"}</div>
                <div>Data path: {diagnostic.dataPath}</div>
                <div>Loader: {diagnostic.loaderStatus}</div>
                <div>Core request: {diagnostic.coreRequestStatus}</div>
                <div>Core bytes: {diagnostic.coreResponseBytes?.toLocaleString() ?? "—"}</div>
                <div>Decompression: {diagnostic.decompressionProgress ?? "—"}</div>
                <div>Elapsed: {diagnostic.elapsedMs !== null ? `${diagnostic.elapsedMs}ms` : "—"}</div>
                <div>Latest event: {diagnostic.latestEvent ?? "—"}</div>
              </div>
              {diagnostic.latestError && (
                <div className="mt-2 text-rose-300">Error: {diagnostic.latestError}</div>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {isSatellaview && (
            <section className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[.05] p-5">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full border border-cyan-300/40 text-[10px] font-black text-cyan-200">
                  BS
                </span>
                <h2 className="text-sm font-black">BS-X BIOS required</h2>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/55">
                Satellaview titles need the BS-X BIOS to boot. Pick a copy here — it stays in this browser only, never uploaded.
              </p>
              {biosName ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[.06] px-3 py-2 text-xs">
                  <span className="truncate text-emerald-100">BIOS · {biosName}</span>
                  <button
                    onClick={clearBios}
                    className="rounded p-1 text-white/40 hover:text-white"
                    aria-label="Remove BIOS"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => biosInputRef.current?.click()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 py-2 text-xs font-black text-cyan-200 hover:bg-cyan-400/15"
                >
                  <Upload size={13} /> Load BS-X BIOS
                </button>
              )}
              <input
                ref={biosInputRef}
                type="file"
                className="hidden"
                accept=".sfc,.smc,.bin,.rom"
                onChange={(event) => {
                  pickBios(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </section>
          )}
          <section className="relative overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-b from-violet-500/10 to-transparent p-5">
            <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-fuchsia-500/20 blur-3xl" />
            <Sparkles className="text-violet-300" size={20} />
            <div className="mt-3 text-[10px] font-black uppercase tracking-[.22em] text-violet-300">
              LiTT Companion
            </div>
            <h2 className="mt-2 text-lg font-black">
              {isError ? "Emulator trouble." : isRunning ? "Game running." : "Launching…"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {isError
                ? emulatorError ?? "The emulator could not start."
                : isRunning
                  ? `Your ${system.shortName} cartridge is running locally. Open the emulator menu for saves, control mapping, cheats, screenshots, and other supported tools.`
                  : `${stateLabel[runtimeState]}. The emulator is downloading and decompressing the ${ejsCore} core from the self-hosted data directory. This usually takes a few seconds.`}
            </p>
          </section>
          <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <h2 className="text-sm font-black">Session details</h2>
            <dl className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">System</dt>
                <dd className="text-right font-bold">{system.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">Core</dt>
                <dd className="text-right font-bold">{ejsCore}</dd>
              </div>
              {isSatellaview && (
                <div className="flex justify-between gap-3">
                  <dt className="text-white/35">Mode</dt>
                  <dd className="text-right font-bold text-cyan-200">Satellaview / BS-X</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">Launches</dt>
                <dd className="font-bold">{game.launches}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">Storage</dt>
                <dd className="font-bold text-emerald-300">This browser</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">Runtime</dt>
                <dd className="font-bold">{stateLabel[runtimeState]}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">ROM</dt>
                <dd className="max-w-[180px] truncate font-mono text-[10px] text-white/50">
                  {romDataUrl ? "blob:local" : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">EmulatorJS</dt>
                <dd className="font-mono text-[10px] text-white/50">self-hosted {EMULATOR_VERSION}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/35">Build</dt>
                <dd className="font-mono text-[10px] text-white/50">{EMULATOR_BUILD_ID}</dd>
              </div>
            </dl>
          </section>
          <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.04] p-5">
            <ShieldCheck className="text-emerald-300" size={19} />
            <h2 className="mt-3 text-sm font-black">Private play</h2>
            <p className="mt-2 text-xs leading-5 text-white/50">
              The ROM and BIOS were loaded from this browser only — the data stays in memory as a blob URL inside the emulator iframe. LiTT does not upload the file. The emulator runtime is self-hosted and versioned.
            </p>
          </section>
        </aside>
      </div>

      <RetroControlsModal
        systemId={system.id}
        systemName={system.name}
        systemShort={system.shortName}
        open={showControls}
        onClose={() => setShowControls(false)}
      />
    </main>
  );
}
