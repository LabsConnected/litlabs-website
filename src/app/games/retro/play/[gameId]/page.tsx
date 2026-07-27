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
  ShieldCheck,
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
import {
  EMULATOR_BUILD_ID,
  EMULATOR_CDN_FALLBACK_PATH,
  EMULATOR_DATA_PATH,
  EMULATOR_MANIFEST_PATH,
  EMULATOR_SESSION_HOST,
  EMULATOR_VERSION,
  type CoreFallbackAttempt,
  type EmulatorAssetCheck,
  type EmulatorAssetPreflightResult,
  type EmulatorFailureCode,
  type EmulatorSessionState,
  type RuntimeEvent,
} from "@/lib/emulator/types";
import { EmulatorRuntimeBridge } from "@/lib/emulator/runtime-bridge";
import { preflightEmulatorAssets } from "@/lib/emulator/asset-preflight";
import { validateRom, createRomBlobUrl, revokeRomBlobUrl } from "@/lib/emulator/rom-validation";
import {
  getCoreForAttempt,
  shouldFallbackOnFailure,
  hasMoreAttempts,
  createAttempt,
  recordAttemptFailure,
} from "@/lib/emulator/core-fallback";
import {
  WatchdogManager,
  type WatchdogFired,
} from "@/lib/emulator/watchdogs";

// ─── Constants ───────────────────────────────────────────────────

const STATE_LABELS: Record<EmulatorSessionState, string> = {
  idle: "Idle",
  validating_rom: "Validating ROM",
  checking_assets: "Checking assets",
  preparing_runtime: "Preparing runtime",
  waiting_for_user: "Waiting for user",
  downloading_core: "Downloading core",
  decompressing_core: "Decompressing core",
  initializing_wasm: "Initializing WASM",
  mounting_rom: "Mounting ROM",
  waiting_for_first_frame: "Waiting for first frame",
  running: "Running",
  paused: "Paused",
  recovering: "Recovering",
  failed: "Failed",
  stopped: "Stopped",
};

function detectBrowser(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/")) return "Safari";
  return "unknown";
}

// ─── Cache cleanup (preserved from prior implementation) ─────────

async function clearEmulatorCache(): Promise<{ cleared: string[]; error?: string }> {
  const cleared: string[] = [];
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
    // Some browsers don't support indexedDB.databases()
  }
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
    // Cache Storage may be unavailable
  }
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
    // localStorage may be blocked
  }
  return { cleared };
}

// ─── Component ───────────────────────────────────────────────────

export default function RetroPlayerPage() {
  const params = useParams<{ gameId: string }>();
  const stageRef = useRef<HTMLDivElement>(null);
  const biosInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const launchRecorded = useRef(false);
  const bridgeRef = useRef<EmulatorRuntimeBridge | null>(null);
  const watchdogRef = useRef<WatchdogManager | null>(null);
  const romBlobUrlRef = useRef<string | null>(null);
  const fallbackAttemptsRef = useRef<CoreFallbackAttempt[]>([]);

  // ─── Game + ROM state ──────────────────────────────────────────
  const [game, setGame] = useState<RetroGameRecord | null>(null);
  const [romDataUrl, setRomDataUrl] = useState<string | null>(null);
  const [biosDataUrl, setBiosDataUrl] = useState<string | null>(null);
  const [biosName, setBiosName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSatellaview, setIsSatellaview] = useState(false);
  const [showControls, setShowControls] = useState(false);

  // ─── Runtime state ─────────────────────────────────────────────
  const [sessionState, setSessionState] = useState<EmulatorSessionState>("idle");
  const [runtimeSource, setRuntimeSource] = useState<"self-hosted" | "official-fallback">("self-hosted");
  const [attempt, setAttempt] = useState(1); // 1-indexed core fallback attempt
  const [progressText, setProgressText] = useState<string | null>(null);
  const [emulatorError, setEmulatorError] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<EmulatorFailureCode | null>(null);
  const [assetCheck, setAssetCheck] = useState<EmulatorAssetPreflightResult | null>(null);
  const [romValid, setRomValid] = useState<boolean | null>(null);
  const [romSha, setRomSha] = useState<string | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [cacheClearResult, setCacheClearResult] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [canvasCreated, setCanvasCreated] = useState(false);
  const [firstFrameObserved, setFirstFrameObserved] = useState(false);
  const [heartbeatAge, setHeartbeatAge] = useState<number | null>(null);
  const [fallbackAttempts, setFallbackAttempts] = useState<CoreFallbackAttempt[]>([]);
  const [bootTime, setBootTime] = useState<number | null>(null);
  const [loaderReadyTime, setLoaderReadyTime] = useState<number | null>(null);

  const system = game ? getRetroSystem(game.system) : null;

  // ─── Core config for current attempt ───────────────────────────
  const coreConfig = useMemo(() => {
    const config = getCoreForAttempt(attempt);
    if (!config) return { core: "nes", legacy: false };
    // For non-NES systems, don't use the fallback sequence — use the system's core
    if (game && game.system !== "nes") {
      const map: Record<string, string> = {
        nes: "fceumm",
        snes: "snes9x",
        gb: "gambatte",
        gbc: "gambatte",
        gba: "mgba",
        segaMD: "genesis_plus_gx",
      };
      return { core: map[game.system] ?? "snes9x", legacy: false };
    }
    return config;
  }, [attempt, game]);

  const ejsCore = coreConfig.core;
  const useLegacy = coreConfig.legacy;

  const activeDataPath = runtimeSource === "official-fallback" ? EMULATOR_CDN_FALLBACK_PATH : EMULATOR_DATA_PATH;

  // ─── Load ROM from IndexedDB ───────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const record = await getRetroGame(params.gameId);
        if (!active) return;
        if (!record) throw new Error("This game is not stored in this browser.");

        // Validate ROM header
        const validation = await validateRom(record.rom, record.fileName, record.system);
        if (!active) return;
        setRomValid(validation.valid);
        setRomSha(validation.sha256 ?? null);

        if (!validation.valid) {
          setSessionState("failed");
          setFailureCode(validation.failureCode ?? "ROM_INVALID");
          setEmulatorError(validation.error ?? "ROM validation failed.");
          setLoading(false);
          setGame(record);
          setIsSatellaview(detectSatellaview(record.fileName));
          return;
        }

        // Create blob URL — kept alive for the entire session
        const blobUrl = createRomBlobUrl(record.rom);
        if (!active) {
          revokeRomBlobUrl(blobUrl);
          return;
        }
        romBlobUrlRef.current = blobUrl;
        setGame(record);
        setIsSatellaview(detectSatellaview(record.fileName));
        setRomDataUrl(blobUrl);
        setSessionState("checking_assets");

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
      // Revoke blob URL only when the gameId changes or component unmounts
      if (romBlobUrlRef.current) {
        revokeRomBlobUrl(romBlobUrlRef.current);
        romBlobUrlRef.current = null;
      }
    };
  }, [params.gameId]);

  // ─── Asset preflight ───────────────────────────────────────────
  useEffect(() => {
    if (!game || !romDataUrl || sessionState !== "checking_assets") return;
    let active = true;
    (async () => {
      const isCdn = runtimeSource === "official-fallback";
      const result = await preflightEmulatorAssets(ejsCore, activeDataPath, {
        manifestPath: EMULATOR_MANIFEST_PATH,
        verifyChecksums: !isCdn,
        legacy: useLegacy,
      });
      if (!active) return;
      setAssetCheck(result);
      if (!result.ok) {
        setSessionState("failed");
        setFailureCode(result.failureCode ?? "ASSET_MISSING");
        setEmulatorError(
          `${isCdn ? "Official CDN" : "Self-hosted"} asset check failed: ${result.failedUrl} — ${result.reason}.`,
        );
      } else {
        setSessionState("preparing_runtime");
      }
    })();
    return () => {
      active = false;
    };
  }, [game, romDataUrl, ejsCore, sessionState, runtimeSource, activeDataPath, useLegacy]);

  // ─── Iframe src (built from URL params) ────────────────────────
  const iframeSrc = useMemo(() => {
    if (!romDataUrl || !game) return "";
    const searchParams = new URLSearchParams({
      core: ejsCore,
      rom: romDataUrl,
      name: game.title,
      dataPath: activeDataPath,
      color: system?.color ?? "#a78bfa",
      legacy: useLegacy ? "1" : "0",
    });
    if (runtimeSource === "official-fallback") searchParams.set("cdnTest", "1");
    return `${EMULATOR_SESSION_HOST}?${searchParams.toString()}`;
  }, [romDataUrl, game, ejsCore, useLegacy, activeDataPath, runtimeSource, system]);

  // ─── Bridge + watchdog setup ───────────────────────────────────
  const handleWatchdogFired = useCallback((fired: WatchdogFired) => {
    setFailureCode(fired.failureCode);
    setEmulatorError(
      `Watchdog fired: ${fired.stage} (${fired.failureCode}). Last evidence: "${fired.lastEvidence}". Elapsed: ${fired.elapsedMs}ms.`,
    );
    // Trigger core fallback if appropriate
    if (shouldFallbackOnFailure(fired.failureCode) && hasMoreAttempts(attempt)) {
      setSessionState("recovering");
      const currentAttempt = createAttempt(attempt, ejsCore, useLegacy);
      const failedAttempt = recordAttemptFailure(
        currentAttempt,
        fired.failureCode,
        fired.lastEvidence,
        fired.elapsedMs,
      );
      fallbackAttemptsRef.current = [...fallbackAttemptsRef.current, failedAttempt];
      setFallbackAttempts(fallbackAttemptsRef.current);
      // Move to next attempt
      setAttempt((a) => a + 1);
      setSessionState("checking_assets");
      setEmulatorError(null);
      setFailureCode(null);
      setProgressText(null);
      setCanvasCreated(false);
      setFirstFrameObserved(false);
      setLoaderReadyTime(null);
    } else {
      setSessionState("failed");
    }
  }, [attempt, ejsCore, useLegacy]);

  // Create bridge + watchdog instances
  useEffect(() => {
    bridgeRef.current = new EmulatorRuntimeBridge();
    watchdogRef.current = new WatchdogManager(undefined, handleWatchdogFired);
    return () => {
      watchdogRef.current?.stopAll();
      bridgeRef.current?.detach();
    };
  }, [handleWatchdogFired]);

  // ─── Bridge event handlers ─────────────────────────────────────
  useEffect(() => {
    const bridge = bridgeRef.current;
    const watchdog = watchdogRef.current;
    if (!bridge || !watchdog) return;

    // Wildcard handler — track last event
    const unsubAll = bridge.on("*", (event: RuntimeEvent) => {
      setLastEvent(event.type);
      setHeartbeatAge(bridge.getHeartbeatAgeMs());
    });

    // Booting — iframe started
    const unsubBoot = bridge.on("runtime.booting", () => {
      setBootTime(Date.now());
      setSessionState("preparing_runtime");
    });

    // Loader ready — EJS_ready fired (UI loaded, core is ready)
    const unsubReady = bridge.on("runtime.loader_ready", () => {
      setLoaderReadyTime(Date.now());
      watchdog.stop("core_download");
      watchdog.stop("core_decompression");
      setSessionState("waiting_for_user");
    });

    // Canvas created
    const unsubCanvas = bridge.on("runtime.canvas_created", () => {
      setCanvasCreated(true);
    });

    // First frame
    const unsubFrame = bridge.on("runtime.first_frame", () => {
      setFirstFrameObserved(true);
    });

    // Running — EJS_onGameStart (authoritative)
    const unsubRun = bridge.on("runtime.running", () => {
      watchdog.stopAll();
      setSessionState("running");
      setProgressText(null);
      // Start heartbeat watchdog
      watchdog.start("heartbeat", "running");
    });

    // Paused
    const unsubPause = bridge.on("runtime.paused", () => {
      setSessionState("paused");
    });

    // Error
    const unsubErr = bridge.on("runtime.error", (event) => {
      watchdog.stopAll();
      const msg = event.message ?? "Unknown runtime error";
      setEmulatorError(msg);
      setFailureCode("UNKNOWN_RUNTIME_ERROR");
      if (shouldFallbackOnFailure("UNKNOWN_RUNTIME_ERROR") && hasMoreAttempts(attempt)) {
        setSessionState("recovering");
        const currentAttempt = createAttempt(attempt, ejsCore, useLegacy);
        const failedAttempt = recordAttemptFailure(currentAttempt, "UNKNOWN_RUNTIME_ERROR", msg);
        fallbackAttemptsRef.current = [...fallbackAttemptsRef.current, failedAttempt];
        setFallbackAttempts(fallbackAttemptsRef.current);
        setAttempt((a) => a + 1);
        setSessionState("checking_assets");
        setEmulatorError(null);
        setFailureCode(null);
      } else {
        setSessionState("failed");
      }
    });

    // Exited
    const unsubExit = bridge.on("runtime.exited", () => {
      watchdog.stopAll();
      setSessionState("stopped");
    });

    // Progress — supplementary (display + watchdog reset only)
    const unsubProgress = bridge.on("runtime.progress", (event) => {
      setProgressText(event.text ?? null);
    });

    // Core download progress — reset watchdog
    const unsubDlProgress = bridge.on("runtime.core_download_progress", (event) => {
      watchdog.reset("core_download", `download ${event.percent}%`);
    });

    // Core download started — start watchdog
    const unsubDlStart = bridge.on("runtime.core_download_started", () => {
      watchdog.start("core_download", "download started");
      setSessionState("downloading_core");
    });

    // Core decompression progress — reset watchdog
    const unsubDcProgress = bridge.on("runtime.core_decompression_progress", (event) => {
      watchdog.reset("core_decompression", `decompress ${event.percent}%`);
    });

    // Core decompression started — start watchdog
    const unsubDcStart = bridge.on("runtime.core_decompression_started", () => {
      watchdog.start("core_decompression", "decompress started");
      setSessionState("decompressing_core");
    });

    // Heartbeat — reset heartbeat watchdog
    const unsubHb = bridge.on("runtime.heartbeat", () => {
      if (watchdog.isRunning("heartbeat")) {
        watchdog.reset("heartbeat", "heartbeat received");
      }
    });

    return () => {
      unsubAll();
      unsubBoot();
      unsubReady();
      unsubCanvas();
      unsubFrame();
      unsubRun();
      unsubPause();
      unsubErr();
      unsubExit();
      unsubProgress();
      unsubDlProgress();
      unsubDlStart();
      unsubDcProgress();
      unsubDcStart();
      unsubHb();
    };
  }, [attempt, ejsCore, useLegacy, handleWatchdogFired]);

  // ─── Attach bridge to iframe when it mounts ────────────────────
  const attachBridge = useCallback((iframe: HTMLIFrameElement | null) => {
    iframeRef.current = iframe;
    if (iframe && bridgeRef.current) {
      bridgeRef.current.attach(iframe);
      bridgeRef.current.resetTracking();
    }
  }, []);

  // ─── Heartbeat age display ticker ──────────────────────────────
  useEffect(() => {
    if (sessionState !== "running") return;
    const interval = window.setInterval(() => {
      setHeartbeatAge(bridgeRef.current?.getHeartbeatAgeMs() ?? null);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [sessionState]);

  // ─── Actions ───────────────────────────────────────────────────

  const retryPlayer = useCallback(() => {
    watchdogRef.current?.stopAll();
    setEmulatorError(null);
    setFailureCode(null);
    setProgressText(null);
    setAssetCheck(null);
    setLastEvent(null);
    setCanvasCreated(false);
    setFirstFrameObserved(false);
    setLoaderReadyTime(null);
    setBootTime(null);
    setAttempt(1);
    fallbackAttemptsRef.current = [];
    setFallbackAttempts([]);
    setSessionState("checking_assets");
  }, []);

  const tryNextCore = useCallback(() => {
    if (!hasMoreAttempts(attempt)) return;
    watchdogRef.current?.stopAll();
    setEmulatorError(null);
    setFailureCode(null);
    setProgressText(null);
    setCanvasCreated(false);
    setFirstFrameObserved(false);
    setLoaderReadyTime(null);
    setAttempt((a) => a + 1);
    setSessionState("checking_assets");
  }, [attempt]);

  const useOfficialRuntime = useCallback(() => {
    watchdogRef.current?.stopAll();
    setRuntimeSource("official-fallback");
    setEmulatorError(null);
    setFailureCode(null);
    setProgressText(null);
    setAssetCheck(null);
    setCanvasCreated(false);
    setFirstFrameObserved(false);
    setLoaderReadyTime(null);
    setAttempt(1);
    setSessionState("checking_assets");
  }, []);

  const useSelfHostedRuntime = useCallback(() => {
    watchdogRef.current?.stopAll();
    setRuntimeSource("self-hosted");
    setEmulatorError(null);
    setFailureCode(null);
    setProgressText(null);
    setAssetCheck(null);
    setCanvasCreated(false);
    setFirstFrameObserved(false);
    setLoaderReadyTime(null);
    setAttempt(1);
    setSessionState("checking_assets");
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

  // ─── Derived state ─────────────────────────────────────────────

  const biosRequired = isSatellaview && !biosDataUrl;
  const canLaunch = !biosRequired;
  const isRunning = sessionState === "running";
  const isError = sessionState === "failed" || sessionState === "stopped";
  const isLoadingState =
    sessionState === "checking_assets" ||
    sessionState === "preparing_runtime" ||
    sessionState === "downloading_core" ||
    sessionState === "decompressing_core" ||
    sessionState === "initializing_wasm" ||
    sessionState === "mounting_rom" ||
    sessionState === "waiting_for_first_frame" ||
    sessionState === "waiting_for_user" ||
    sessionState === "recovering";

  const hasMoreCores = hasMoreAttempts(attempt);
  const altCoreLabel = ejsCore === "nes" ? "Nestopia" : ejsCore === "nestopia" ? (useLegacy ? "FCEUmm" : "Nestopia (legacy)") : "FCEUmm";

  // ─── Loading state ─────────────────────────────────────────────
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
            {canLaunch && romDataUrl && romValid !== false ? (
              <iframe
                key={`${attempt}|${ejsCore}|${useLegacy}|${runtimeSource}`}
                ref={attachBridge}
                title={`${game.title} emulator`}
                src={iframeSrc}
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
                {STATE_LABELS[sessionState]} · {ejsCore}{useLegacy ? " (legacy)" : ""}
                {progressText ? ` · ${progressText}` : ""}
              </div>
            )}
            {isRunning && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-emerald-300/20 bg-black/70 px-3 py-1.5 text-[10px] font-bold text-emerald-100 backdrop-blur">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Running · {ejsCore}{useLegacy ? " (legacy)" : ""}
                {heartbeatAge !== null ? ` · hb ${heartbeatAge}ms` : ""}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.025] px-4 py-3">
            <div className="flex flex-wrap gap-4 text-[11px] text-white/40">
              <span className="flex items-center gap-1.5">
                <Gamepad2 size={13} /> {system.shortName}
              </span>
              <span className="flex items-center gap-1.5">
                <HardDrive size={13} /> {game.fileName}
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={13} /> {runtimeSource === "official-fallback" ? "CDN" : "self-hosted"}
              </span>
            </div>
            <button
              onClick={() => setShowControls(true)}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black hover:bg-white/10"
            >
              <Keyboard size={14} /> Controls
            </button>
          </div>

          {isError && (
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] px-4 py-3 text-xs text-rose-100">
              <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-rose-400" />
              <div className="min-w-0 flex-1">
                <b className="block text-rose-200">
                  {sessionState === "stopped" ? "Session ended" : "Emulator trouble"}
                </b>
                <span className="text-rose-100/80">{emulatorError}</span>
                {failureCode && (
                  <p className="mt-1 text-[10px] text-rose-100/60">Failure code: {failureCode}</p>
                )}
                {progressText && (
                  <p className="mt-1 text-[10px] text-rose-100/60">Last status: {progressText}</p>
                )}
                {assetCheck && !assetCheck.ok && (
                  <p className="mt-1 text-[10px] text-rose-100/60">
                    Asset check failed: {assetCheck.failedUrl} ({assetCheck.reason})
                  </p>
                )}
                {fallbackAttempts.length > 0 && (
                  <p className="mt-1 text-[10px] text-rose-100/60">
                    Fallback attempts: {fallbackAttempts.map((a) => `${a.core}${a.legacy ? "-legacy" : ""}`).join(" → ")}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={retryPlayer}
                    className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-[10px] font-bold text-rose-200 hover:bg-rose-400/10"
                  >
                    Clean retry
                  </button>
                  {hasMoreCores && game.system === "nes" && (
                    <button
                      onClick={tryNextCore}
                      className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Try {altCoreLabel}
                    </button>
                  )}
                  <button
                    onClick={handleClearCache}
                    className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-[10px] font-bold text-amber-200 hover:bg-amber-400/10"
                  >
                    <Trash2 size={11} className="mr-1 inline" />
                    Clear emulator cache
                  </button>
                  {runtimeSource === "self-hosted" && (
                    <button
                      onClick={useOfficialRuntime}
                      className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-[10px] font-bold text-violet-200 hover:bg-violet-400/10"
                    >
                      Use official runtime
                    </button>
                  )}
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
              <div className="mb-2 font-bold text-white/90">DIAGNOSTICS — {EMULATOR_BUILD_ID}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>EmulatorJS: {EMULATOR_VERSION}</div>
                <div>Browser: {detectBrowser()}</div>
                <div>Core: {ejsCore}{useLegacy ? " (legacy)" : ""}</div>
                <div>ROM: .{game.fileName.split(".").pop()} ({game.size.toLocaleString()} bytes)</div>
                <div>ROM SHA-256: {romSha ? `${romSha.slice(0, 16)}…` : "—"}</div>
                <div>ROM header: {romValid ? "✓ valid" : "✗ invalid"}</div>
                <div>BIOS: {biosDataUrl ? "present" : "—"}</div>
                <div>Data path: {activeDataPath}</div>
                <div>Runtime: {runtimeSource}</div>
                <div>Session: {STATE_LABELS[sessionState]}</div>
                <div>Attempt: {attempt}</div>
                <div>Canvas: {canvasCreated ? "✓" : "—"}</div>
                <div>First frame: {firstFrameObserved ? "✓" : "—"}</div>
                <div>Heartbeat age: {heartbeatAge !== null ? `${heartbeatAge}ms` : "—"}</div>
                <div>Last event: {lastEvent ?? "—"}</div>
                <div>Boot time: {bootTime ? new Date(bootTime).toISOString().slice(11, 23) : "—"}</div>
                <div>Loader ready: {loaderReadyTime ? new Date(loaderReadyTime).toISOString().slice(11, 23) : "—"}</div>
              </div>
              {emulatorError && (
                <div className="mt-2 text-rose-300">Error: {emulatorError}</div>
              )}
              {failureCode && (
                <div className="mt-1 text-rose-300">Failure code: {failureCode}</div>
              )}
              {fallbackAttempts.length > 0 && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <div className="mb-1 font-bold text-white/80">Fallback attempts ({fallbackAttempts.length})</div>
                  {fallbackAttempts.map((a) => (
                    <div key={a.attempt}>
                      #{a.attempt}: {a.core}{a.legacy ? "-legacy" : ""} — {a.failureCode ?? "running"} {a.error ? `(${a.error.slice(0, 60)})` : ""}
                    </div>
                  ))}
                </div>
              )}
              {assetCheck && assetCheck.checks.length > 0 && (
                <div className="mt-3 border-t border-white/10 pt-2">
                  <div className="mb-1 font-bold text-white/80">Asset checks ({assetCheck.checks.length})</div>
                  <div className="space-y-0.5">
                    {assetCheck.checks.map((c: EmulatorAssetCheck) => (
                      <div key={c.url} className="flex items-center gap-2">
                        <span className={c.error ? "text-rose-300" : "text-emerald-300"}>
                          {c.error ? "✖" : "✓"}
                        </span>
                        <span className="truncate">{c.label}</span>
                        <span className="ml-auto text-white/40">
                          {c.status} · {c.contentLength?.toLocaleString() ?? "—"} B
                          {c.checksumValid === false ? " · checksum FAIL" : c.checksumValid === true ? " · checksum ✓" : ""}
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

          <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <h2 className="text-sm font-black">
              {isError ? "Emulator trouble." : isRunning ? "Game running." : "Launching…"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {isError
                ? emulatorError ?? "The emulator could not start."
                : isRunning
                  ? `Your ${system.shortName} cartridge is running locally. Open the emulator menu for saves, control mapping, cheats, screenshots, and other supported tools.`
                  : `${STATE_LABELS[sessionState]}. The emulator is loading the ${ejsCore} core from the ${runtimeSource === "official-fallback" ? "official CDN" : "self-hosted data directory"}. This usually takes a few seconds.`}
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
                <dd className="text-right font-bold">{ejsCore}{useLegacy ? " (legacy)" : ""}</dd>
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
                <dd className="font-bold">{STATE_LABELS[sessionState]}</dd>
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
