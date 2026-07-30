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
import {
  type ArcadeLaunchState,
  EXPECTED_BSX_MD5,
  validateBsxBios,
  shouldRenderIframe,
  launchStatusLabel,
} from "@/lib/emulator/arcade-launch";
import {
  type EmulatorSystemId,
  controlSchemeForSystem,
} from "@/lib/emulator/control-profiles";

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

// ─── BS-X BIOS IndexedDB persistence ──────────────────────────────
// Stores the user's legally-obtained BS-X.bin in IndexedDB so they
// don't have to re-select it every time they launch a Satellaview title.

const BIOS_DB_NAME = "litt-arcade-bios";
const BIOS_STORE = "bios";
const BIOS_KEY = "bsx";

async function storeBiosInIndexedDB(name: string, dataUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BIOS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BIOS_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(BIOS_STORE, "readwrite");
      tx.objectStore(BIOS_STORE).put({ name, dataUrl, savedAt: Date.now() }, BIOS_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

async function loadBiosFromIndexedDB(): Promise<{ name: string; dataUrl: string } | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BIOS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BIOS_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(BIOS_STORE, "readonly");
        const getReq = tx.objectStore(BIOS_STORE).get(BIOS_KEY);
        getReq.onsuccess = () => {
          db.close();
          resolve(getReq.result ?? null);
        };
        getReq.onerror = () => { db.close(); reject(getReq.error); };
      } catch {
        db.close();
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function clearBiosFromIndexedDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BIOS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BIOS_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(BIOS_STORE, "readwrite");
        tx.objectStore(BIOS_STORE).delete(BIOS_KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      } catch {
        db.close();
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

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
  const [romBlob, setRomBlob] = useState<Blob | null>(null); // ROM blob, NOT URL yet
  const [biosFile, setBiosFile] = useState<File | null>(null);
  const [biosDataUrl, setBiosDataUrl] = useState<string | null>(null);
  const [biosName, setBiosName] = useState<string | null>(null);
  const [biosHash, setBiosHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSatellaview, setIsSatellaview] = useState(false);
  const [showControls, setShowControls] = useState(false);
  // Sega Genesis controller type: 3-button (default for Lion King) or 6-button.
  // Only affects which controls the LiTTree modal displays; the EmulatorJS
  // runtime always uses the full segaMD control scheme (which includes
  // X/Y/Z/Mode), so switching never resets emulator shortcuts.
  const [controllerType, setControllerType] = useState<"3-button" | "6-button">("3-button");

  // ─── Launch state machine (single source of truth) ────────────
  const [launchState, setLaunchState] = useState<ArcadeLaunchState>({ status: "loading" });
  const [runtimeConfig, setRuntimeConfig] = useState<{
    sessionId: string;
    romUrl: string;
    biosUrl: string;
    core: string;
    systemId: EmulatorSystemId;
    controlScheme: string;
    gameName: string;
  } | null>(null);
  const biosUrlRef = useRef<string | null>(null);

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
  const [domDiagnostics, setDomDiagnostics] = useState<string | null>(null);
  const [heartbeatAge, setHeartbeatAge] = useState<number | null>(null);
  const [fallbackAttempts, setFallbackAttempts] = useState<CoreFallbackAttempt[]>([]);
  const [bootTime, setBootTime] = useState<number | null>(null);
  const [loaderReadyTime, setLoaderReadyTime] = useState<number | null>(null);

  const system = game ? getRetroSystem(game.system) : null;

  // ─── System identity (product-facing) vs core identity ──────────
  // systemId drives the control scheme + labels; coreId (ejsCore) drives
  // which libretro core runs the game. These are deliberately separate so
  // that, e.g., Sega Genesis loads genesis_plus_gx but renders the segaMD
  // controller layout (not the ambiguous segaMS "BUTTON 1/2" fallback).
  const emulatorSystemId: EmulatorSystemId = (game?.system ?? "nes") as EmulatorSystemId;
  const controlScheme = controlSchemeForSystem(emulatorSystemId);

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
  // NOTE: We do NOT create a blob URL or increment launches here.
  // That only happens when the user clicks Start Game.
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

        // Determine if this is a Satellaview title.
        // Metadata (systemVariant) takes priority over filename detection.
        const satellaview = record.systemVariant === "satellaview" || detectSatellaview(record.fileName);

        if (!validation.valid) {
          setGame(record);
          setIsSatellaview(satellaview);
          setLaunchState({
            status: "rom-error",
            message: validation.error ?? "ROM validation failed.",
          });
          setLoading(false);
          return;
        }

        // Store the ROM blob — don't create a URL yet
        setGame(record);
        setIsSatellaview(satellaview);
        setRomBlob(record.rom);

        // All games (including Satellaview) go straight to ready.
        // BIOS is optional — the user can load one from the side panel
        // if the game doesn't boot without it.
        setLaunchState({ status: "ready", biosHash: "", biosFileName: "" });
        setSessionState("idle"); // Don't auto-start the runtime
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "The game could not be opened.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      // Revoke ROM blob URL if one was created
      if (romBlobUrlRef.current) {
        revokeRomBlobUrl(romBlobUrlRef.current);
        romBlobUrlRef.current = null;
      }
      // Revoke BIOS blob URL if one was created
      if (biosUrlRef.current) {
        URL.revokeObjectURL(biosUrlRef.current);
        biosUrlRef.current = null;
      }
    };
  }, [params.gameId]);

  // ─── Set document title to the game name ──────────────────────
  useEffect(() => {
    if (!game) return;
    const system = getRetroSystem(game.system);
    document.title = `${game.title} (${system.shortName}) · LiTTree LabStudios`;
    return () => {
      document.title = "LiTTree LabStudios";
    };
  }, [game]);

  // ─── Asset preflight (only when launching) ────────────────────
  useEffect(() => {
    if (!game || launchState.status !== "launching") return;
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
  }, [game, launchState, ejsCore, sessionState, runtimeSource, activeDataPath, useLegacy]);

  // ─── Iframe src (built from runtimeConfig, only when launching) ─
  const iframeSrc = useMemo(() => {
    if (!runtimeConfig) return "";
    const searchParams = new URLSearchParams({
      core: runtimeConfig.core,
      rom: runtimeConfig.romUrl,
      name: runtimeConfig.gameName,
      dataPath: activeDataPath,
      color: system?.color ?? "#a78bfa",
      legacy: useLegacy ? "1" : "0",
      sessionId: runtimeConfig.sessionId,
      // Control scheme override — mandatory for Sega Genesis so EmulatorJS
      // renders the segaMD layout instead of the ambiguous segaMS fallback.
      // This alone fixes the "BUTTON 1 / BUTTON 2" label issue.
      // NOTE: EJS_defaultControls is intentionally NOT injected. EmulatorJS
      // 4.2.3's setupKeys() crashes if the format isn't exactly right, and
      // the control scheme override alone is sufficient for correct labels.
      controlScheme: runtimeConfig.controlScheme,
    });
    // Pass BIOS URL for Satellaview/BS-X titles
    if (runtimeConfig.biosUrl) {
      searchParams.set("bios", runtimeConfig.biosUrl);
    }
    if (runtimeSource === "official-fallback") searchParams.set("cdnTest", "1");
    return `${EMULATOR_SESSION_HOST}?${searchParams.toString()}`;
  }, [runtimeConfig, useLegacy, activeDataPath, runtimeSource, system]);

  // ─── Bridge + watchdog setup ───────────────────────────────────
  const handleWatchdogFired = useCallback((fired: WatchdogFired) => {
    setFailureCode(fired.failureCode);

    // Special message for no-video timeout — the most common cause
    // is a missing BIOS for Satellaview/BS-X titles
    if (fired.failureCode === "FIRST_FRAME_TIMEOUT") {
      const biosHint = isSatellaview && !biosDataUrl
        ? " This Satellaview title may need a BS-X BIOS to boot. Try loading BS-X.bin from the BIOS panel, or try a different core."
        : " The ROM may require a BIOS, another core, or additional subsystem support.";
      setEmulatorError(
        `Game core started but produced no video within 8 seconds.${biosHint}`,
      );
      setSessionState("failed");
      return;
    }

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
  }, [attempt, ejsCore, useLegacy, isSatellaview, biosDataUrl]);

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
      // Transition launch state: launching → waiting-for-user
      setLaunchState((prev) =>
        prev.status === "launching"
          ? { status: "waiting-for-user", sessionId: prev.sessionId }
          : prev,
      );
    });

    // Canvas created
    const unsubCanvas = bridge.on("runtime.canvas_created", () => {
      setCanvasCreated(true);
    });

    // First frame — the REAL "running" signal.
    const unsubFrame = bridge.on("runtime.first_frame", () => {
      setFirstFrameObserved(true);
      watchdog.stopAll();
      setSessionState("running");
      setProgressText(null);
      watchdog.start("heartbeat", "running");
      // Update launch state machine — only this transition = "running"
      setLaunchState((prev) =>
        prev.status === "launching" || prev.status === "waiting-for-user" || prev.status === "core-starting"
          ? { status: "running", sessionId: prev.sessionId }
          : prev,
      );
    });

    // Running — EJS_onGameStart (core started, but video not confirmed yet)
    // Transition to "core-starting" in the launch state machine
    const unsubRun = bridge.on("runtime.running", () => {
      setLaunchState((prev) =>
        prev.status === "launching" || prev.status === "waiting-for-user"
          ? { status: "core-starting", sessionId: prev.sessionId }
          : prev,
      );
      setSessionState("waiting_for_first_frame");
      setProgressText("Waiting for video…");
      watchdog.start("first_frame", "waiting_for_first_frame");
    });

    // Paused
    const unsubPause = bridge.on("runtime.paused", () => {
      setSessionState("paused");
    });

    // Error
    const unsubErr = bridge.on("runtime.error", (event) => {
      watchdog.stopAll();
      const msg = event.message ?? "Unknown runtime error";
      const stack = event.stack ? `\n\nStack: ${event.stack}` : "";
      setEmulatorError(`${msg}${stack}`);
      setFailureCode("UNKNOWN_RUNTIME_ERROR");
      // Update launch state machine
      setLaunchState({ status: "error", message: msg });
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

    // DOM diagnostics — reports what's inside #game every 2s
    const unsubDomDiag = bridge.on("runtime.dom_diagnostics", (event) => {
      const c = event.canvas;
      const canvasStr = c
        ? `canvas ${c.width}x${c.height} (${c.parentTag}.${c.parentClass?.slice(0, 30)}) ctx=${event.contextType}`
        : "no canvas";
      setDomDiagnostics(`#game children=${event.gameChildren} htmlLen=${event.gameInnerHTMLLen} | ${canvasStr}`);
    });

    // ROM preflight passed — ROM blob is valid and fetchable
    const unsubRomReady = bridge.on("runtime.rom_ready", (event) => {
      setProgressText(`ROM verified (${event.bytes} bytes)`);
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
      unsubDomDiag();
      unsubRomReady();
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
    setBiosFile(file);
    setBiosName(file.name);
    setLaunchState({ status: "validating-bios", fileName: file.name });
    try {
      const result = await validateBsxBios(file);
      // Hard error (empty file / read failure) — block
      if (result.error && !result.warning) {
        setLaunchState({ status: "invalid-bios", reason: result.error, fileName: file.name });
        setBiosHash(null);
        return;
      }
      // Store the BIOS (even if hash mismatch — user accepted the warning)
      const b64 = await readRomAsBase64(file);
      const dataUrl = `data:application/octet-stream;base64,${b64}`;
      setBiosDataUrl(dataUrl);
      setBiosHash(result.hash ?? null);
      setLaunchState({ status: "ready", biosHash: result.hash ?? "", biosFileName: file.name });
      setEmulatorError(null);
      // Persist to IndexedDB (only if hash matched — don't persist wrong BIOS)
      if (result.ok) {
        try {
          await storeBiosInIndexedDB(file.name, dataUrl);
        } catch { /* non-fatal */ }
      }
    } catch (reason) {
      setLaunchState({
        status: "invalid-bios",
        reason: reason instanceof Error ? reason.message : "Could not read BIOS file.",
        fileName: file.name,
      });
    }
  }

  function clearBios() {
    setBiosFile(null);
    setBiosDataUrl(null);
    setBiosName(null);
    setBiosHash(null);
    setLaunchState({ status: "needs-bios" });
    void clearBiosFromIndexedDB().catch(() => {});
  }

  /** Let the user try launching without a BIOS. EmulatorJS may still
   *  boot some Satellaview titles, or show its own error. */
  function skipBios() {
    setBiosFile(null);
    setBiosDataUrl(null);
    setBiosName(null);
    setBiosHash(null);
    setLaunchState({ status: "ready", biosHash: "", biosFileName: "" });
  }

  // ─── Start Game — the ONLY path that creates blob URLs + iframe ─
  async function startGame() {
    if (launchState.status !== "ready") return;
    if (!romBlob || !game) return;

    // BIOS is optional — user can try without it (EmulatorJS may still boot)

    // Create ROM blob URL
    const romUrl = createRomBlobUrl(romBlob);
    romBlobUrlRef.current = romUrl;

    // Create BIOS blob URL (for Satellaview, if provided)
    let biosUrl = "";
    if (isSatellaview && biosFile) {
      biosUrl = URL.createObjectURL(biosFile);
      biosUrlRef.current = biosUrl;
    }

    const sessionId = crypto.randomUUID();
    const core = game.system === "snes" ? "snes9x" : ejsCore;

    // EJS_defaultControls is intentionally NOT injected — EmulatorJS 4.2.3's
    // setupKeys() crashes if the format isn't exactly right. The controlScheme
    // override alone is sufficient for correct Sega labels.
    setRuntimeConfig({
      sessionId,
      romUrl,
      biosUrl,
      core,
      systemId: emulatorSystemId,
      controlScheme,
      gameName: game.title,
    });

    setLaunchState({ status: "launching", sessionId });
    setSessionState("checking_assets");

    // Increment launch counter — ONLY here, on real session creation
    if (!launchRecorded.current) {
      launchRecorded.current = true;
      try {
        const updated = await updateRetroGame(game.id, {
          lastPlayedAt: Date.now(),
          launches: (game.launches ?? 0) + 1,
        });
        setGame(updated);
      } catch { /* non-fatal */ }
    }
  }

  function destroySessionUrls() {
    if (romBlobUrlRef.current) {
      revokeRomBlobUrl(romBlobUrlRef.current);
      romBlobUrlRef.current = null;
    }
    if (biosUrlRef.current) {
      URL.revokeObjectURL(biosUrlRef.current);
      biosUrlRef.current = null;
    }
    setRuntimeConfig(null);
  }

  function exitGame() {
    watchdogRef.current?.stopAll();
    destroySessionUrls();
    setSessionState("idle");
    setEmulatorError(null);
    setFailureCode(null);
    setProgressText(null);
    setCanvasCreated(false);
    setFirstFrameObserved(false);
    // Return to ready — BIOS is optional, always allow relaunch
    if (isSatellaview && biosDataUrl && biosHash) {
      setLaunchState({ status: "ready", biosHash, biosFileName: biosName ?? "" });
    } else {
      setLaunchState({ status: "ready", biosHash: "", biosFileName: "" });
    }
  }

  async function enterFullscreen() {
    try {
      await stageRef.current?.requestFullscreen();
    } catch {
      /* Browser controls remain available. */
    }
  }

  // ─── Auto-load BIOS from IndexedDB ─────────────────────────────
  // When a Satellaview title is detected, try to restore a previously
  // saved BIOS from IndexedDB. Silently restores it if available so
  // the emulator has the best chance of booting. Non-blocking — the
  // game is already in "ready" state and can be launched without it.
  useEffect(() => {
    if (!isSatellaview) return;
    let cancelled = false;
    void loadBiosFromIndexedDB().then(async (stored) => {
      if (cancelled || !stored) return;
      try {
        const resp = await fetch(stored.dataUrl);
        const blob = await resp.blob();
        const result = await validateBsxBios(blob);
        if (cancelled || !result.ok) return;
        setBiosDataUrl(stored.dataUrl);
        setBiosName(stored.name);
        setBiosHash(result.hash ?? null);
        setBiosFile(new File([blob], stored.name));
      } catch { /* non-fatal */ }
    }).catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [isSatellaview]);

  // ─── Derived state ─────────────────────────────────────────────

  // The iframe is ONLY rendered when the launch state allows it.
  // This is the hard launch gate — no iframe without valid BIOS.
  const canRenderIframe = shouldRenderIframe(launchState);
  const isRunning = launchState.status === "running";
  const isError = launchState.status === "error" || launchState.status === "rom-error";
  const isLoadingState =
    launchState.status === "launching" ||
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

      <div
        className="mx-auto grid max-w-[1600px] gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_290px] xl:p-5"
        style={{ paddingTop: "clamp(32px, 5vh, 56px)", paddingBottom: "32px" }}
      >
        <section className="min-w-0">
          <div
            ref={stageRef}
            className="relative aspect-[16/10] min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:min-h-[520px]"
          >
            {canRenderIframe && runtimeConfig ? (
              <iframe
                key={runtimeConfig.sessionId}
                ref={attachBridge}
                title={`${game.title} emulator`}
                src={iframeSrc}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock"
                allow="autoplay; fullscreen; gamepad"
                allowFullScreen
              />
            ) : isSatellaview && launchState.status === "needs-bios" ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-md space-y-4">
                  <LockKeyhole className="mx-auto text-amber-300" size={40} />
                  <h2 className="text-xl font-black">BIOS recommended</h2>
                  <p className="text-sm leading-6 text-white/55">
                    This Satellaview title may need a BS-X system BIOS to boot.
                    If you have a legally obtained BS-X.bin, load it below.
                    You can also try launching without it — some games work fine.
                  </p>
                  <div className="flex flex-wrap justify-center gap-3">
                    <button
                      onClick={() => biosInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-black text-black hover:bg-amber-400"
                    >
                      <Upload size={15} /> Load BIOS
                    </button>
                    <button
                      onClick={skipBios}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-black hover:bg-emerald-400"
                    >
                      <Gamepad2 size={15} /> Try without BIOS
                    </button>
                    <a
                      href="https://emulatorjs.org/docs/systems/snes/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-black text-white/70 hover:bg-white/10"
                    >
                      Learn More
                    </a>
                    <Link
                      href="/games/retro"
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-sm font-black text-white/50 hover:bg-white/5"
                    >
                      <ArrowLeft size={15} /> Back
                    </Link>
                  </div>
                </div>
              </div>
            ) : isSatellaview && launchState.status === "validating-bios" ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <Gamepad2 className="mx-auto animate-pulse text-cyan-300" size={36} />
                  <h2 className="text-lg font-black">Validating BIOS…</h2>
                  <p className="text-xs leading-5 text-white/55">
                    Checking MD5 hash of {launchState.fileName}. Expected: {EXPECTED_BSX_MD5.slice(0, 12)}…
                  </p>
                </div>
              </div>
            ) : isSatellaview && launchState.status === "invalid-bios" ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <LockKeyhole className="mx-auto text-rose-300" size={36} />
                  <h2 className="text-lg font-black">BIOS not accepted</h2>
                  <p className="text-xs leading-5 text-rose-300/80">
                    {launchState.reason}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    <button
                      onClick={() => biosInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-black text-black hover:bg-amber-400"
                    >
                      <Upload size={13} /> Try another file
                    </button>
                    <button
                      onClick={skipBios}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black text-black hover:bg-emerald-400"
                    >
                      <Gamepad2 size={13} /> Skip BIOS
                    </button>
                  </div>
                </div>
              </div>
            ) : launchState.status === "ready" ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <Gamepad2 className="mx-auto text-emerald-300" size={36} />
                  <h2 className="text-lg font-black">Ready to launch</h2>
                  <p className="text-xs leading-5 text-white/55">
                    {isSatellaview && biosHash ? "BIOS loaded. " : ""}Press Start Game to begin.
                  </p>
                  <button
                    onClick={startGame}
                    className="mt-2 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-black hover:bg-emerald-400"
                  >
                    <Gamepad2 size={15} /> Start Game
                  </button>
                </div>
              </div>
            ) : launchState.status === "error" ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <LockKeyhole className="mx-auto text-rose-300" size={36} />
                  <h2 className="text-lg font-black">Runtime error</h2>
                  <p className="text-xs leading-5 text-rose-300/80">{launchState.message}</p>
                </div>
              </div>
            ) : launchState.status === "rom-error" ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <LockKeyhole className="mx-auto text-rose-300" size={36} />
                  <h2 className="text-lg font-black">ROM error</h2>
                  <p className="text-xs leading-5 text-rose-300/80">{launchState.message}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <Gamepad2 className="mx-auto animate-pulse text-white/30" size={36} />
                  <p className="text-xs text-white/40">{launchStatusLabel(launchState)}</p>
                </div>
              </div>
            )}
            {isLoadingState && canRenderIframe && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-cyan-300/20 bg-black/70 px-3 py-1.5 text-[10px] font-bold text-cyan-100 backdrop-blur">
                {launchStatusLabel(launchState)} · {runtimeConfig?.core ?? ejsCore}{useLegacy ? " (legacy)" : ""}
                {progressText ? ` · ${progressText}` : ""}
              </div>
            )}
            {isRunning && (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-emerald-300/20 bg-black/70 px-3 py-1.5 text-[10px] font-bold text-emerald-100 backdrop-blur">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Running · {runtimeConfig?.core ?? ejsCore}{useLegacy ? " (legacy)" : ""}
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
                <div>BIOS MD5: {biosHash ? `${biosHash.slice(0, 16)}…` : "—"}</div>
                <div>BIOS valid: {launchState.status === "ready" ? "✓" : launchState.status === "invalid-bios" ? "✗" : "—"}</div>
                <div>Launch state: {launchState.status}</div>
                <div>Session ID: {runtimeConfig?.sessionId ?? "—"}</div>
                <div>ROM URL: {runtimeConfig?.romUrl ? "yes" : "no"}</div>
                <div>BIOS URL: {runtimeConfig?.biosUrl ? "yes" : "no"}</div>
                <div>iframe mounted: {canRenderIframe ? "yes" : "no"}</div>
                <div>Data path: {activeDataPath}</div>
                <div>Runtime: {runtimeSource}</div>
                <div>Session: {STATE_LABELS[sessionState]}</div>
                <div>Attempt: {attempt}</div>
                <div>Canvas: {canvasCreated ? "✓" : "—"}</div>
                <div>First frame: {firstFrameObserved ? "✓" : "—"}</div>
                <div>DOM: {domDiagnostics ?? "—"}</div>
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
            <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full border border-white/20 text-[10px] font-black text-white/50">
                  BS
                </span>
                <h2 className="text-sm font-black text-white/70">BIOS (optional)</h2>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/45">
                Most Satellaview games boot without a BIOS. If yours doesn&apos;t,
                load a legally obtained BS-X.bin here. The file stays in this
                browser and is never uploaded.
              </p>

              {/* BIOS validation status */}
              {launchState.status === "validating-bios" && (
                <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-3 py-2 text-xs text-amber-200">
                  Validating BIOS… ({launchState.fileName})
                </div>
              )}
              {launchState.status === "invalid-bios" && (
                <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/[.06] px-3 py-2 text-xs text-rose-200">
                  <div className="font-bold">Invalid BIOS</div>
                  <div className="mt-1 text-rose-300/80">{launchState.reason}</div>
                </div>
              )}
              {launchState.status === "ready" && biosName && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[.06] px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate text-emerald-100">BIOS · {biosName}</div>
                    <div className="text-[10px] text-emerald-300/60">MD5 ✓ verified</div>
                  </div>
                  <button
                    onClick={clearBios}
                    className="rounded p-1 text-white/40 hover:text-white"
                    aria-label="Remove BIOS"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* BIOS file picker — always available when BIOS is needed or invalid */}
              {(launchState.status === "needs-bios" || launchState.status === "invalid-bios") && (
                <button
                  onClick={() => biosInputRef.current?.click()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 py-2 text-xs font-black text-amber-200 hover:bg-amber-400/15"
                >
                  <Upload size={13} /> Load My BIOS
                </button>
              )}

              {/* Start Game button — only when BIOS is validated */}
              {launchState.status === "ready" && (
                <button
                  onClick={startGame}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400"
                >
                  <Gamepad2 size={13} /> Start Game
                </button>
              )}

              <input
                ref={biosInputRef}
                type="file"
                className="hidden"
                accept=".bin,application/octet-stream"
                onChange={(event) => {
                  pickBios(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </section>
          )}

          {/* Start Game button for non-Satellaview titles */}
          {!isSatellaview && launchState.status === "ready" && (
            <button
              onClick={startGame}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400"
            >
              <Gamepad2 size={13} /> Start Game
            </button>
          )}

          <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <h2 className="text-sm font-black">
              {launchStatusLabel(launchState)}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {launchState.status === "needs-bios"
                ? "Load a BS-X BIOS file, or try launching without one. The file stays in this browser."
                : launchState.status === "ready"
                  ? isSatellaview
                    ? biosHash ? "BIOS loaded. Press Start to begin." : "Press Start Game to begin. If the game doesn't boot, try loading a BS-X BIOS from the panel above."
                    : "Press Start Game to begin."
                  : launchState.status === "launching"
                    ? "Creating local emulator session. The ROM and BIOS are being loaded into the emulator iframe."
                    : launchState.status === "waiting-for-user"
                      ? "Runtime ready — press Play inside the emulator to start the game."
                      : launchState.status === "running"
                        ? `Your ${system.shortName} cartridge is running locally. Open the emulator menu for saves, control mapping, cheats, screenshots, and other supported tools.`
                        : launchState.status === "error" || launchState.status === "rom-error"
                          ? launchState.message
                          : launchState.status === "invalid-bios"
                            ? launchState.reason
                            : `${launchStatusLabel(launchState)}. The emulator is loading the ${runtimeConfig?.core ?? ejsCore} core.`}
            </p>
            {/* Exit button when running or error */}
            {(canRenderIframe || launchState.status === "error") && (
              <button
                onClick={exitGame}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-black text-white/70 hover:bg-white/10"
              >
                <X size={13} /> Exit Session
              </button>
            )}
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
                  {runtimeConfig?.romUrl ? "blob:local" : romBlob ? "ready" : "—"}
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
              {canRenderIframe
                ? "The ROM and BIOS were loaded from this browser only — the data stays in memory as a blob URL inside the emulator iframe. LiTT does not upload the file. The emulator runtime is self-hosted and versioned."
                : isSatellaview && launchState.status === "needs-bios"
                  ? "The ROM is available locally. Press Start to launch."
                  : "The ROM is stored in this browser only. LiTT does not upload the file. The emulator runtime is self-hosted and versioned."}
            </p>
          </section>
        </aside>
      </div>

      <RetroControlsModal
        systemId={system.id}
        systemName={system.name}
        systemShort={system.shortName}
        emulatorSystemId={emulatorSystemId}
        controllerType={controllerType}
        onControllerTypeChange={setControllerType}
        open={showControls}
        onClose={() => setShowControls(false)}
      />
    </main>
  );
}
