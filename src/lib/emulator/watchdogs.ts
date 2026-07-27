/**
 * EmulatorWatchdogs — stage-specific watchdog manager.
 *
 * Instead of one generic 15s/45s timer, each runtime stage has its own
 * timeout. Timers reset when real stage progress occurs (events from the
 * iframe bridge). When a timer fires, it reports which stage failed and
 * the last evidence received.
 *
 * Stages and default timeouts:
 *   asset_preflight:  10s
 *   core_download:    30s (reset on core_download_progress)
 *   core_decompression: 20s (reset on core_decompression_progress)
 *   wasm_init:        20s
 *   rom_mount:        10s
 *   first_frame:      15s (time since loader_ready without running)
 *   heartbeat:        10s (only after running — heartbeat must keep coming)
 */

import type { EmulatorSessionState, EmulatorFailureCode, WatchdogConfig } from "./types";
import { DEFAULT_WATCHDOG_CONFIG } from "./types";

export type WatchdogStage =
  | "asset_preflight"
  | "core_download"
  | "core_decompression"
  | "wasm_init"
  | "rom_mount"
  | "first_frame"
  | "heartbeat";

export interface WatchdogFired {
  stage: WatchdogStage;
  failureCode: EmulatorFailureCode;
  lastEvidence: string;
  elapsedMs: number;
}

type WatchdogCallback = (fired: WatchdogFired) => void;

interface ActiveTimer {
  stage: WatchdogStage;
  timer: number;
  startedAt: number;
}

/**
 * Manages stage-specific watchdog timers.
 *
 * Usage:
 *   const mgr = new WatchdogManager(config, (fired) => {
 *     console.error("Watchdog fired:", fired);
 *   });
 *   mgr.start("first_frame", "FIRST_FRAME_TIMEOUT");
 *   mgr.reset("core_download", "core at 42%");  // resets the core_download timer
 *   mgr.stop("first_frame");                     // stops one timer
 *   mgr.stopAll();                               // stops all timers
 */
export class WatchdogManager {
  private config: WatchdogConfig;
  private callback: WatchdogCallback;
  private timers = new Map<WatchdogStage, ActiveTimer>();
  private lastEvidence = new Map<WatchdogStage, string>();

  constructor(
    config: WatchdogConfig = DEFAULT_WATCHDOG_CONFIG,
    callback: WatchdogCallback,
  ) {
    this.config = config;
    this.callback = callback;
  }

  /** Start a watchdog for a stage. Replaces any existing timer for that stage. */
  start(stage: WatchdogStage, evidence?: string): void {
    this.stop(stage);
    const timeout = this.getTimeoutForStage(stage);
    if (timeout <= 0) return;
    const startedAt = Date.now();
    if (evidence) this.lastEvidence.set(stage, evidence);

    const timer = window.setTimeout(() => {
      this.timers.delete(stage);
      const elapsed = Date.now() - startedAt;
      this.callback({
        stage,
        failureCode: this.stageToFailureCode(stage),
        lastEvidence: this.lastEvidence.get(stage) ?? "no evidence",
        elapsedMs: elapsed,
      });
    }, timeout);

    this.timers.set(stage, { stage, timer, startedAt });
  }

  /** Reset a watchdog timer (call when progress is observed for the stage). */
  reset(stage: WatchdogStage, evidence?: string): void {
    if (evidence) this.lastEvidence.set(stage, evidence);
    if (!this.timers.has(stage)) return;
    // Restart with the same stage
    this.start(stage, evidence ?? this.lastEvidence.get(stage));
  }

  /** Stop a single watchdog. */
  stop(stage: WatchdogStage): void {
    const active = this.timers.get(stage);
    if (active) {
      window.clearTimeout(active.timer);
      this.timers.delete(stage);
    }
  }

  /** Stop all watchdogs. */
  stopAll(): void {
    for (const active of this.timers.values()) {
      window.clearTimeout(active.timer);
    }
    this.timers.clear();
  }

  /** Update the last evidence for a stage without resetting the timer. */
  noteEvidence(stage: WatchdogStage, evidence: string): void {
    this.lastEvidence.set(stage, evidence);
  }

  /** Get the elapsed time for a stage, or null if not running. */
  getElapsedMs(stage: WatchdogStage): number | null {
    const active = this.timers.get(stage);
    if (!active) return null;
    return Date.now() - active.startedAt;
  }

  /** Whether a watchdog is currently running for a stage. */
  isRunning(stage: WatchdogStage): boolean {
    return this.timers.has(stage);
  }

  private getTimeoutForStage(stage: WatchdogStage): number {
    switch (stage) {
      case "asset_preflight": return this.config.assetPreflight;
      case "core_download": return this.config.coreDownload;
      case "core_decompression": return this.config.coreDecompression;
      case "wasm_init": return this.config.wasmInitialization;
      case "rom_mount": return this.config.romMount;
      case "first_frame": return this.config.firstFrame;
      case "heartbeat": return this.config.heartbeatAfterRunning;
      default: return 15_000;
    }
  }

  private stageToFailureCode(stage: WatchdogStage): EmulatorFailureCode {
    switch (stage) {
      case "asset_preflight":
        return "ASSET_MISSING";
      case "core_download":
        return "CORE_DOWNLOAD_FAILED";
      case "core_decompression":
        return "CORE_DECOMPRESSION_FAILED";
      case "wasm_init":
        return "WASM_INITIALIZATION_FAILED";
      case "rom_mount":
        return "ROM_MOUNT_FAILED";
      case "first_frame":
        return "FIRST_FRAME_TIMEOUT";
      case "heartbeat":
        return "RUNTIME_HEARTBEAT_LOST";
    }
  }
}

/**
 * Map a runtime state to the watchdog stage that should be active.
 * Returns null if no watchdog is needed for the state.
 */
export function stateToWatchdogStage(
  state: EmulatorSessionState,
): WatchdogStage | null {
  switch (state) {
    case "checking_assets":
      return "asset_preflight";
    case "downloading_core":
      return "core_download";
    case "decompressing_core":
      return "core_decompression";
    case "initializing_wasm":
      return "wasm_init";
    case "mounting_rom":
      return "rom_mount";
    case "waiting_for_first_frame":
      return "first_frame";
    case "running":
      return "heartbeat";
    default:
      return null;
  }
}
