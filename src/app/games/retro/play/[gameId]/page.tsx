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
// Controlled CDN fallback — only used when the self-hosted preflight fails AND
// the user explicitly clicks "Use official runtime". Never mixed with local.
const EMULATOR_CDN_FALLBACK_PATH = "https://cdn.emulatorjs.org/4.2.3/data/";
const EMULATOR_VERSION = "4.2.3";
// Versioned cache namespace. Bump when upgrading EmulatorJS or changing the
// data directory so stale IndexedDB / Cache Storage entries are invalidated.
// v3: nestopia core added, fceumm re-synced, verifyEmulatorAssets repaired,
//     worker-error surfacing, CDN fallback, 99% finalization grace.
// v10: all cores repackaged as STORE (method 0) zip to bypass the
//      Emscripten extractzip.js deflate decompression worker bug that
//      stalls at 99% indefinitely. Cores are larger but extract instantly.
const EMULATOR_BUILD_ID = "ejs-4.2.3-litt-v10";
const PREV_EMULATOR_BUILD_IDS = ["ejs-4.2.3-litt-v9", "ejs-4.2.3-litt-v8", "ejs-4.2.3-litt-v7", "ejs-4.2.3-litt-v6", "ejs-4.2.3-litt-v5", "ejs-4.2.3-litt-v4", "ejs-4.2.3-litt-v3", "ejs-4.2.3-litt-v2", "ejs-4.2.3-litt-v1"];
const INIT_TIMEOUT_MS = 45_000;
const STALL_TIMEOUT_MS = 15_000;
// At 99% decompression the worker may take a while to finalize without
// emitting progress. Allow a 30s grace window before declaring a stall, but
// still fail immediately on a worker-error event.
const FINALIZATION_GRACE_MS = 30_000;
const CORE_MIN_BYTES = 800_000;
// Archive signatures for EmulatorJS core .data files.
// Cores were originally 7z but have been repackaged as zip to work around
// a 7z decompression worker bug that stalls at 99% indefinitely.
// 7z: 37 7A BC AF 27 1C  |  zip: 50 4B 03 04
const SEVEN_Z_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

// Single source of truth for which NES cores may be offered in the UI.
// A core is only "available" if its *-wasm.data asset actually shipped.
const AVAILABLE_NES_CORES = ["fceumm", "nestopia"] as const;
type NesCore = (typeof AVAILABLE_NES_CORES)[number];

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
  runtimeSource: "self-hosted" | "official-fallback" | "pending";
  loaderStatus: "pending" | "loaded" | "failed";
  coreRequestStatus: "pending" | "downloading" | "decompressing" | "ready" | "failed";
  coreResponseBytes: number | null;
  decompressionProgress: string | null;
  elapsedMs: number | null;
  latestEvent: string | null;
  latestError: string | null;
  workerError: string | null;
  assetChecks: AssetCheckEntry[];
}

interface AssetCheckEntry {
  url: string;
  label: string;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  validSignature?: boolean;
  error?: string;
}

interface AssetVerificationResult {
  ok: boolean;
  checks: AssetCheckEntry[];
  coreBytes?: number;
  failedUrl?: string;
  reason?: string;
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
  dataPath: string;
}): string {
  const configLines = [
    `window.EJS_player = "#game";`,
    `window.EJS_core = ${JSON.stringify(opts.core)};`,
    `window.EJS_gameUrl = ${JSON.stringify(opts.gameUrl)};`,
    `window.EJS_gameName = ${JSON.stringify(opts.gameName)};`,
    `window.EJS_gameID = ${numericGameId(opts.gameId)};`,
    `window.EJS_pathtodata = ${JSON.stringify(opts.dataPath)};`,
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
    // Signal to parent that the config script has started executing.
    `try{parent.postMessage({source:"ejs",type:"progress",text:"config script started",buildId:${JSON.stringify(opts.buildId)}},"*")}catch(_){}`,
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
<body><div id="game"></div><script>${escapeForScript(config)}<\/script><script src="${opts.dataPath}loader.js" onload="try{parent.postMessage({source:'ejs',type:'progress',text:'loader.js loaded',buildId:${JSON.stringify(opts.buildId)}},'*')}catch(_){}" onerror="parent.postMessage({source:'ejs',type:'error',message:'The emulator runtime could not be loaded from ${opts.dataPath}loader.js. The data directory may be missing or blocked.',buildId:${JSON.stringify(opts.buildId)}},'*')"><\/script></body></html>`;
}

function hasSevenZSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < SEVEN_Z_SIGNATURE.length) return false;
  const view = new Uint8Array(buffer, 0, SEVEN_Z_SIGNATURE.length);
  for (let i = 0; i < SEVEN_Z_SIGNATURE.length; i++) {
    if (view[i] !== SEVEN_Z_SIGNATURE[i]) return false;
  }
  return true;
}

function hasZipSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < ZIP_SIGNATURE.length) return false;
  const view = new Uint8Array(buffer, 0, ZIP_SIGNATURE.length);
  for (let i = 0; i < ZIP_SIGNATURE.length; i++) {
    if (view[i] !== ZIP_SIGNATURE[i]) return false;
  }
  return true;
}

function hasValidArchiveSignature(buffer: ArrayBuffer): boolean {
  return hasSevenZSignature(buffer) || hasZipSignature(buffer);
}

function looksLikeHtml(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength > 1024 * 1024) return false;
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512))).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<head") ||
    head.includes("<title>")
  );
}

/**
 * Verify that EmulatorJS assets return HTTP 200 with valid bodies before we
 * mount the iframe. EVERY required asset is checked before returning success
 * (the previous implementation returned early after the core check, which
 * meant extract7z.js was never validated).
 *
 * Rejects HTML error pages served with status 200, zero-byte responses,
 * missing 7z archive signatures on core packages, and undersized cores.
 *
 * `dataPath` may be the self-hosted path or the official CDN fallback path.
 */
async function verifyEmulatorAssets(core: string, dataPath: string): Promise<AssetVerificationResult> {
  const checks: Array<{ url: string; label: string; requireNonZero?: boolean; isCore?: boolean; minBytes?: number }> = [
    { url: `${dataPath}loader.js`, label: "loader.js", requireNonZero: true, minBytes: 1_000 },
    { url: `${dataPath}emulator.min.js`, label: "emulator.min.js", requireNonZero: true, minBytes: 100_000 },
    { url: `${dataPath}emulator.min.css`, label: "emulator.min.css", requireNonZero: true, minBytes: 1_000 },
    { url: `${dataPath}cores/${core}-wasm.data`, label: `core ${core}-wasm.data`, isCore: true, minBytes: CORE_MIN_BYTES },
    { url: `${dataPath}compression/extract7z.js`, label: "extract7z.js", requireNonZero: true, minBytes: 50_000 },
    { url: `${dataPath}compression/extractzip.js`, label: "extractzip.js", requireNonZero: true, minBytes: 50_000 },
  ];

  const results: AssetCheckEntry[] = [];
  let allOk = true;
  let firstFailure: { url: string; reason: string } | null = null;
  let coreBytes: number | undefined;

  for (const check of checks) {
    const entry: AssetCheckEntry = {
      url: check.url,
      label: check.label,
      status: null,
      contentType: null,
      bytes: null,
    };
    try {
      const res = await fetch(check.url, { method: "GET", cache: "no-store" });
      entry.status = res.status;
      entry.contentType = res.headers.get("content-type");
      if (!res.ok) {
        entry.error = `HTTP ${res.status} ${res.statusText}`;
        results.push(entry);
        if (allOk) firstFailure = { url: check.url, reason: entry.error };
        allOk = false;
        continue;
      }
      const buffer = await res.arrayBuffer();
      entry.bytes = buffer.byteLength;
      if (check.requireNonZero && buffer.byteLength === 0) {
        entry.error = "Zero-byte response";
        results.push(entry);
        if (allOk) firstFailure = { url: check.url, reason: entry.error };
        allOk = false;
        continue;
      }
      if (check.minBytes && buffer.byteLength < check.minBytes) {
        entry.error = `File too small: ${buffer.byteLength} bytes (minimum ${check.minBytes})`;
        results.push(entry);
        if (allOk) firstFailure = { url: check.url, reason: entry.error };
        allOk = false;
        continue;
      }
      // Reject HTML error pages (some CDNs return 200 + HTML for missing files)
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/html") || looksLikeHtml(buffer)) {
        entry.error = `Server returned HTML (content-type: ${contentType})`;
        results.push(entry);
        if (allOk) firstFailure = { url: check.url, reason: entry.error };
        allOk = false;
        continue;
      }
      if (check.isCore) {
        const validSig = hasValidArchiveSignature(buffer);
        entry.validSignature = validSig;
        if (!validSig) {
          const view = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8));
          const hex = Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join(" ");
          entry.error = `Missing archive signature (7z or zip). First bytes: ${hex}`;
          results.push(entry);
          if (allOk) firstFailure = { url: check.url, reason: entry.error };
          allOk = false;
          continue;
        }
        coreBytes = buffer.byteLength;
      }
      results.push(entry);
    } catch (err) {
      entry.error = err instanceof Error ? err.message : "Network request failed";
      results.push(entry);
      if (allOk) firstFailure = { url: check.url, reason: entry.error };
      allOk = false;
    }
  }

  return {
    ok: allOk,
    checks: results,
    coreBytes,
    failedUrl: firstFailure?.url,
    reason: firstFailure?.reason,
  };
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
  const [assetCheck, setAssetCheck] = useState<AssetVerificationResult | null>(null);
  const [cacheClearResult, setCacheClearResult] = useState<string | null>(null);
  const [latestEvent, setLatestEvent] = useState<string | null>(null);
  // Phase 6: runtime source — self-hosted (default) or official CDN fallback.
  const [runtimeSource, setRuntimeSource] = useState<"self-hosted" | "official-fallback">("official-fallback");
  // Phase 7: worker error surfaced from inside the iframe.
  const [workerError, setWorkerError] = useState<string | null>(null);
  // Phase 8: track when we first hit 99% decompression so we can apply a
  // finalization grace window instead of stalling at 15s.
  const [hit99At, setHit99At] = useState<number | null>(null);
  // Phase 9: one-time cache clear for prior build IDs on first v3 launch.
  const oldBuildsCleared = useRef(false);

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

  // Phase 9: on the first v3 launch, clear only old EmulatorJS runtime/cache
  // records (prior build IDs). NEVER delete the "litt-retro-arcade" IndexedDB
  // database containing the user's ROMs.
  useEffect(() => {
    if (oldBuildsCleared.current) return;
    oldBuildsCleared.current = true;
    const storedBuild = (() => {
      try {
        return localStorage.getItem("litt:ejs-build-id");
      } catch {
        return null;
      }
    })();
    if (storedBuild && PREV_EMULATOR_BUILD_IDS.includes(storedBuild)) {
      // Old build detected — clear stale emulator cache (ROMs preserved).
      clearEmulatorCache().then(() => {
        try {
          localStorage.setItem("litt:ejs-build-id", EMULATOR_BUILD_ID);
        } catch {
          /* ignore */
        }
      }).catch(() => {
        /* non-fatal */
      });
    } else {
      try {
        localStorage.setItem("litt:ejs-build-id", EMULATOR_BUILD_ID);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const system = game ? getRetroSystem(game.system) : null;
  // Map our system IDs to EmulatorJS core names.
  // SNES default is snes9x (the only SNES core shipped in EmulatorJS 4.2.3).
  // bsnes is NOT in 4.2.3 — never auto-switch to it.
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
      const data = event.data as {
        source?: string;
        type?: string;
        message?: string;
        text?: string;
        buildId?: string;
        filename?: string | null;
        lineno?: number | null;
      } | null;
      if (!data || data.source !== "ejs") return;
      // Validate buildId to ignore events from a stale iframe.
      if (data.buildId && data.buildId !== EMULATOR_BUILD_ID) return;

      setLatestEvent(data.type ?? "unknown");

      if (data.type === "error" && data.message) {
        setEmulatorError(data.message);
        setRuntimeState("error");
      } else if (data.type === "worker-error" && data.message) {
        // Phase 7: a decompression worker crashed. Fail immediately — do NOT
        // leave the user waiting for the 15s stall timer.
        const detail = data.filename ? ` (${data.filename}${data.lineno ? `:${data.lineno}` : ""})` : "";
        setWorkerError(`${data.message}${detail}`);
        setEmulatorError(`${data.message}${detail}`);
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
        setHit99At(null);
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
          // Phase 8: record when we first hit 99% so the stall detector can
          // apply a finalization grace window instead of failing at 15s.
          if (lower.includes("99") && hit99At === null) {
            setHit99At(Date.now());
          }
        } else if (lower.includes("loading")) {
          setRuntimeState("initializing");
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [hit99At]);

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
  // Phase 8: at 99% decompression, allow a 30s finalization grace window
  // before declaring a stall (the worker may be finalizing without emitting
  // progress). Still fail immediately on a worker-error event (handled in the
  // message listener above).
  useEffect(() => {
    if (runtimeState === "running" || runtimeState === "error" || runtimeState === "timed_out") return;
    if (lastProgressAt === null) return;
    // If we're at 99% decompression, use the longer finalization grace window.
    const at99 = hit99At !== null;
    const stallLimit = at99 ? FINALIZATION_GRACE_MS : STALL_TIMEOUT_MS;
    const since = at99 ? hit99At! : lastProgressAt;
    const remaining = stallLimit - (Date.now() - since);
    if (remaining <= 0) {
      setRuntimeState((current) => {
        if (current === "running" || current === "error" || current === "timed_out") return current;
        setEmulatorError(
          at99
            ? `Emulator stalled at 99% decompression for ${FINALIZATION_GRACE_MS / 1000}s. The core archive may be corrupted. Clear the emulator cache and retry, or try the other NES core.`
            : `Emulator stalled — no progress for ${STALL_TIMEOUT_MS / 1000}s. Last status: "${progressText ?? "unknown"}". The core download or decompression may have hung. Clear the emulator cache and retry.`,
        );
        return "error";
      });
      return;
    }
    const timer = window.setTimeout(() => {
      setRuntimeState((current) => {
        if (current === "running" || current === "error" || current === "timed_out") return current;
        setEmulatorError(
          at99
            ? `Emulator stalled at 99% decompression for ${FINALIZATION_GRACE_MS / 1000}s. The core archive may be corrupted. Clear the emulator cache and retry, or try the other NES core.`
            : `Emulator stalled — no progress for ${STALL_TIMEOUT_MS / 1000}s. Last status: "${progressText ?? "unknown"}". The core download or decompression may have hung. Clear the emulator cache and retry.`,
        );
        return "error";
      });
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [runtimeState, lastProgressAt, progressText, playerAttempt, hit99At]);

  // Active data path — depends on runtime source (self-hosted vs CDN fallback).
  const activeDataPath = runtimeSource === "official-fallback" ? EMULATOR_CDN_FALLBACK_PATH : EMULATOR_DATA_PATH;

  // Pre-flight asset verification before mounting the iframe.
  useEffect(() => {
    if (!game || !romDataUrl) return;
    let active = true;
    (async () => {
      const result = await verifyEmulatorAssets(ejsCore, activeDataPath);
      if (!active) return;
      setAssetCheck(result);
      if (!result.ok) {
        setRuntimeState("error");
        setEmulatorError(
          `${runtimeSource === "official-fallback" ? "Official CDN" : "Self-hosted"} emulator asset check failed: ${result.failedUrl} — ${result.reason}.`,
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [game, romDataUrl, ejsCore, playerAttempt, runtimeSource, activeDataPath]);

  const retryPlayer = useCallback((nextCore?: string) => {
    if (nextCore) setCoreOverride(nextCore);
    setEmulatorError(null);
    setWorkerError(null);
    setProgressText(null);
    setAssetCheck(null);
    setLatestEvent(null);
    setRuntimeState("loading_loader");
    setLaunchStartTime(Date.now());
    setLastProgressAt(null);
    setElapsedMs(null);
    setHit99At(null);
    setPlayerAttempt((attempt) => attempt + 1);
  }, []);

  // Phase 6: switch to the official CDN fallback runtime. Rebuilds the entire
  // iframe using the CDN path — never mixes a local loader with CDN cores.
  // The ROM stays as its local Blob URL and is never uploaded.
  const useOfficialRuntime = useCallback(() => {
    setRuntimeSource("official-fallback");
    setEmulatorError(null);
    setWorkerError(null);
    setProgressText(null);
    setAssetCheck(null);
    setLatestEvent(null);
    setRuntimeState("loading_loader");
    setLaunchStartTime(Date.now());
    setLastProgressAt(null);
    setElapsedMs(null);
    setHit99At(null);
    setPlayerAttempt((attempt) => attempt + 1);
  }, []);

  // Return to self-hosted runtime (used after a CDN fallback session).
  const useSelfHostedRuntime = useCallback(() => {
    setRuntimeSource("self-hosted");
    setEmulatorError(null);
    setWorkerError(null);
    setProgressText(null);
    setAssetCheck(null);
    setLatestEvent(null);
    setRuntimeState("loading_loader");
    setLaunchStartTime(Date.now());
    setLastProgressAt(null);
    setElapsedMs(null);
    setHit99At(null);
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
      dataPath: activeDataPath,
    });
  }, [game, romDataUrl, biosDataUrl, isSatellaview, ejsCore, system, activeDataPath]);

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

  // Phase 5: determine which NES core to offer as an alternative. Only offer a
  // core if it is in AVAILABLE_NES_CORES AND its asset passed verification.
  const altNesCore: NesCore | null = useMemo(() => {
    if (!game || game.system !== "nes") return null;
    const current = ejsCore;
    for (const candidate of AVAILABLE_NES_CORES) {
      if (candidate === current) continue;
      // Check the asset verification result for this candidate core.
      const candidateCheck = assetCheck?.checks.find(
        (c) => c.label === `core ${candidate}-wasm.data`,
      );
      // If we haven't verified yet, still allow offering it (the preflight
      // will catch a missing asset). But if we DID verify and it failed, hide it.
      if (candidateCheck && (!candidateCheck.bytes || candidateCheck.error || candidateCheck.validSignature === false)) {
        continue;
      }
      return candidate;
    }
    return null;
  }, [game, ejsCore, assetCheck]);

  const diagnostic: DiagnosticInfo = {
    buildId: EMULATOR_BUILD_ID,
    version: EMULATOR_VERSION,
    browser: detectBrowser(),
    core: ejsCore,
    romExtension: game?.fileName.split(".").pop() ?? "—",
    romSize: game?.size ?? 0,
    biosPresent: !!biosDataUrl,
    dataPath: activeDataPath,
    runtimeSource,
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
    workerError,
    assetChecks: assetCheck?.checks ?? [],
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
                {workerError && (
                  <p className="mt-1 text-[10px] text-rose-100/60">
                    Worker error: {workerError}
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
                  {/* Phase 5: only offer a core that is in AVAILABLE_NES_CORES
                      and whose asset passed verification. */}
                  {altNesCore && (
                    <button
                      onClick={() => retryPlayer(altNesCore)}
                      className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Try {altNesCore === "fceumm" ? "FCEUmm" : "Nestopia"}
                    </button>
                  )}
                  {/* Phase 6: controlled CDN fallback. Show whenever the
                      emulator errors and we're not already on the fallback,
                      so the user can test whether the CDN runtime works. */}
                  {runtimeSource === "self-hosted" && (
                    <button
                      onClick={useOfficialRuntime}
                      className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-[10px] font-bold text-violet-200 hover:bg-violet-400/10"
                    >
                      Use official runtime
                    </button>
                  )}
                  {/* Return to self-hosted after using the CDN fallback. */}
                  {runtimeSource === "official-fallback" && (
                    <button
                      onClick={useSelfHostedRuntime}
                      className="rounded-lg border border-emerald-400/30 px-3 py-1.5 text-[10px] font-bold text-emerald-200 hover:bg-emerald-400/10"
                    >
                      Use self-hosted runtime
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
                <div>Runtime: {diagnostic.runtimeSource}</div>
                <div>Loader: {diagnostic.loaderStatus}</div>
                <div>Core request: {diagnostic.coreRequestStatus}</div>
                <div>Core bytes: {diagnostic.coreResponseBytes?.toLocaleString() ?? "—"}</div>
                <div>Decompression: {diagnostic.decompressionProgress ?? "—"}</div>
                <div>Elapsed: {diagnostic.elapsedMs !== null ? `${diagnostic.elapsedMs}ms` : "—"}</div>
                <div>Latest event: {diagnostic.latestEvent ?? "—"}</div>
              </div>
              {diagnostic.workerError && (
                <div className="mt-2 text-rose-300">Worker error: {diagnostic.workerError}</div>
              )}
              {diagnostic.latestError && (
                <div className="mt-2 text-rose-300">Error: {diagnostic.latestError}</div>
              )}
              {diagnostic.assetChecks.length > 0 && (
                <div className="mt-3 border-t border-white/10 pt-2">
                  <div className="mb-1 font-bold text-white/80">Asset checks ({diagnostic.assetChecks.length})</div>
                  <div className="space-y-0.5">
                    {diagnostic.assetChecks.map((c) => (
                      <div key={c.url} className="flex items-center gap-2">
                        <span className={c.error ? "text-rose-300" : "text-emerald-300"}>
                          {c.error ? "✖" : "✓"}
                        </span>
                        <span className="truncate">{c.label}</span>
                        <span className="ml-auto text-white/40">
                          {c.status ?? "—"} · {c.bytes?.toLocaleString() ?? "—"} B
                          {c.validSignature === false ? " · bad sig" : c.validSignature === true ? " · archive ok" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
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
                <dd className="font-mono text-[10px] text-white/50">
                  {runtimeSource === "official-fallback" ? "CDN fallback" : "self-hosted"} {EMULATOR_VERSION}
                </dd>
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
