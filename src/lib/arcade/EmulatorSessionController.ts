/**
 * EmulatorSessionController — typed parent-side controller for the
 * isolated EmulatorJS iframe runtime.
 *
 * Responsibilities:
 * - Build the iframe document with correct configuration
 * - Track runtime state via postMessage events (NOT text scraping)
 * - Implement stage-specific watchdogs
 * - Implement core fallback (fceumm → nestopia → nestopia-legacy)
 * - Provide real diagnostics with evidence
 * - Manage blob URL lifecycle
 *
 * @see public/arcade-runtime/emulator-session.html
 */

// ─── Types ──────────────────────────────────────────────────────

export type EmulatorSessionState =
  | "idle"
  | "validating_rom"
  | "checking_assets"
  | "preparing_runtime"
  | "waiting_for_user"
  | "downloading_core"
  | "decompressing_core"
  | "initializing_wasm"
  | "mounting_rom"
  | "waiting_for_first_frame"
  | "running"
  | "paused"
  | "recovering"
  | "failed"
  | "stopped";

export type EmulatorFailureCode =
  | "ROM_INVALID"
  | "ROM_UNSUPPORTED"
  | "ASSET_MISSING"
  | "ASSET_HTML_FALLBACK"
  | "ASSET_CORRUPT"
  | "CORE_DOWNLOAD_FAILED"
  | "CORE_DECOMPRESSION_FAILED"
  | "WASM_INITIALIZATION_FAILED"
  | "ROM_MOUNT_FAILED"
  | "FIRST_FRAME_TIMEOUT"
  | "AUDIO_CONTEXT_BLOCKED"
  | "IFRAME_CRASHED"
  | "RUNTIME_HEARTBEAT_LOST"
  | "UNKNOWN_RUNTIME_ERROR";

export interface EmulatorFailure {
  code: EmulatorFailureCode;
  message: string;
  stage: EmulatorSessionState;
  evidence?: Record<string, unknown>;
}

export interface AssetCheck {
  url: string;
  status: number;
  ok: boolean;
  contentType?: string;
  contentLength?: number;
  redirected: boolean;
  htmlFallbackDetected: boolean;
  signatureValid?: boolean;
  durationMs: number;
  error?: string;
}

export interface AssetPreflightResult {
  ok: boolean;
  checks: AssetCheck[];
  failedUrl?: string;
  reason?: string;
}

export interface RuntimeEvent {
  type: string;
  text?: string;
  percent?: number;
  message?: string;
  timestamp: number;
}

export interface DiagnosticReport {
  appBuild: string;
  emulatorVersion: string;
  dataPath: string;
  requestedCore: string;
  resolvedCore: string;
  assetChecks: AssetCheck[];
  rom: {
    name: string;
    size: number;
    extension: string;
    inesValid: boolean;
    sha256: string;
  };
  blobUrlActive: boolean;
  sessionState: EmulatorSessionState;
  events: RuntimeEvent[];
  lastEvent: RuntimeEvent | null;
  failure: EmulatorFailure | null;
  recoveryAttempt: number;
  coreAttempt: number;
  elapsedMs: number;
}

export interface SessionConfig {
  romUrl: string;
  romName: string;
  romSize: number;
  romExtension: string;
  romSha256: string;
  inesValid: boolean;
  core: string;
  dataPath: string;
  useCdn: boolean;
  color: string;
}

// ─── Core fallback chain ────────────────────────────────────────

const NES_CORE_CHAIN = [
  { core: "nes", legacy: false, label: "fceumm (nes)" },
  { core: "nestopia", legacy: false, label: "nestopia" },
  { core: "nestopia", legacy: true, label: "nestopia-legacy" },
];

const SNES_CORE_CHAIN = [
  { core: "snes", legacy: false, label: "snes9x (snes)" },
  { core: "snes9x", legacy: false, label: "snes9x" },
  { core: "snes9x", legacy: true, label: "snes9x-legacy" },
];

function getCoreChain(system: string): Array<{ core: string; legacy: boolean; label: string }> {
  if (system === "nes") return NES_CORE_CHAIN;
  if (system === "snes") return SNES_CORE_CHAIN;
  return [{ core: system, legacy: false, label: system }];
}

// ─── Watchdog timeouts (ms) ─────────────────────────────────────

const WATCHDOGS: Record<string, number> = {
  asset_preflight: 10_000,
  core_download: 30_000,
  core_decompression: 20_000,
  wasm_init: 20_000,
  rom_mount: 10_000,
  first_frame: 15_000,
  heartbeat: 10_000,
};

// ─── Controller ─────────────────────────────────────────────────

export class EmulatorSessionController {
  private config: SessionConfig;
  private state: EmulatorSessionState = "idle";
  private events: RuntimeEvent[] = [];
  private failure: EmulatorFailure | null = null;
  private coreAttempt = 0;
  private recoveryAttempt = 0;
  private startTime = 0;
  private lastHeartbeat = 0;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private blobUrl: string | null = null;
  private onStateChange: (state: EmulatorSessionState) => void;
  private onEvent: (event: RuntimeEvent) => void;
  private onFailure: (failure: EmulatorFailure) => void;

  constructor(
    config: SessionConfig,
    callbacks: {
      onStateChange: (state: EmulatorSessionState) => void;
      onEvent: (event: RuntimeEvent) => void;
      onFailure: (failure: EmulatorFailure) => void;
    },
  ) {
    this.config = config;
    this.onStateChange = callbacks.onStateChange;
    this.onEvent = callbacks.onEvent;
    this.onFailure = callbacks.onFailure;
    this.blobUrl = config.romUrl;
  }

  // ─── Asset preflight ──────────────────────────────────────────

  async runPreflight(): Promise<AssetPreflightResult> {
    this.setState("checking_assets");
    const checks: AssetCheck[] = [];
    const dataPath = this.config.dataPath;
    const coreEntry = getCoreChain(this.detectSystem())[Math.min(this.coreAttempt, 2)];
    const coreFile = coreEntry.legacy
      ? `${coreEntry.core}-legacy-wasm.data`
      : `${coreEntry.core}-wasm.data`;

    const requiredFiles = [
      "loader.js",
      "emulator.min.js",
      "emulator.min.css",
      "version.json",
      `cores/${coreFile}`,
      "compression/extract7z.js",
      "compression/extractzip.js",
    ];

    let allOk = true;
    let firstFailure: { url: string; reason: string } | null = null;

    for (const file of requiredFiles) {
      const url = `${dataPath}${file}`;
      const check = await this.checkAsset(url, file.endsWith(".data"));
      checks.push(check);
      if (!check.ok) {
        allOk = false;
        if (!firstFailure) {
          firstFailure = { url, reason: check.error || `HTTP ${check.status}` };
        }
      }
    }

    const result: AssetPreflightResult = {
      ok: allOk,
      checks,
      failedUrl: firstFailure?.url,
      reason: firstFailure?.reason,
    };

    if (!allOk) {
      this.fail("ASSET_MISSING", `Asset preflight failed: ${firstFailure?.reason}`, { checks });
    }

    return result;
  }

  private async checkAsset(url: string, isCore: boolean): Promise<AssetCheck> {
    const start = Date.now();
    const check: AssetCheck = {
      url,
      status: 0,
      ok: false,
      redirected: false,
      htmlFallbackDetected: false,
      durationMs: 0,
    };
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store", redirect: "follow" });
      check.status = res.status;
      check.contentType = res.headers.get("content-type") || undefined;
      check.redirected = res.redirected;
      const buf = await res.arrayBuffer();
      check.contentLength = buf.byteLength;

      if (!res.ok) {
        check.error = `HTTP ${res.status} ${res.statusText}`;
        check.durationMs = Date.now() - start;
        return check;
      }

      if (buf.byteLength === 0) {
        check.error = "Zero-byte response";
        check.durationMs = Date.now() - start;
        return check;
      }

      const ct = check.contentType || "";
      if (ct.includes("text/html")) {
        check.htmlFallbackDetected = true;
        check.error = `Server returned HTML (content-type: ${ct})`;
        check.durationMs = Date.now() - start;
        return check;
      }

      if (isCore) {
        const bytes = new Uint8Array(buf, 0, Math.min(6, buf.byteLength));
        const is7z = bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc;
        check.signatureValid = is7z;
        if (!is7z) {
          const sig = Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
          check.error = `Wrong archive signature: ${sig} (expected 7z: 37 7a bc af)`;
          check.durationMs = Date.now() - start;
          return check;
        }
      }

      check.ok = true;
    } catch (err) {
      check.error = err instanceof Error ? err.message : "Fetch failed";
    }
    check.durationMs = Date.now() - start;
    return check;
  }

  // ─── Launch ───────────────────────────────────────────────────

  async launch(iframe: HTMLIFrameElement): Promise<void> {
    this.iframe = iframe;
    this.startTime = Date.now();
    this.events = [];
    this.failure = null;
    this.setState("preparing_runtime");

    // Set up message listener
    this.messageHandler = (event: MessageEvent) => {
      if (!event.data || event.data.source !== "arcade") return;
      this.handleRuntimeEvent(event.data);
    };
    window.addEventListener("message", this.messageHandler);

    // Build the iframe URL
    const coreEntry = getCoreChain(this.detectSystem())[Math.min(this.coreAttempt, 2)];
    const params = new URLSearchParams({
      core: coreEntry.core,
      rom: this.config.romUrl,
      name: this.config.romName,
      dataPath: this.config.dataPath,
      color: this.config.color,
    });
    if (this.config.useCdn) params.set("cdnTest", "1");

    iframe.src = `/arcade-runtime/emulator-session.html?${params.toString()}`;

    // Start the first-frame watchdog
    this.startWatchdog("first_frame", () => {
      if (this.state !== "running") {
        this.fail("FIRST_FRAME_TIMEOUT", `No first frame within ${WATCHDOGS.first_frame / 1000}s`);
      }
    });
  }

  // ─── Runtime event handler ────────────────────────────────────

  private handleRuntimeEvent(data: { type: string; text?: string; percent?: number; message?: string }): void {
    const evt: RuntimeEvent = {
      type: data.type,
      text: data.text,
      percent: data.percent,
      message: data.message,
      timestamp: Date.now(),
    };
    this.events = [...this.events.slice(-100), evt];
    this.onEvent(evt);
    this.lastHeartbeat = Date.now();

    switch (data.type) {
      case "runtime.booting":
        this.setState("preparing_runtime");
        break;
      case "runtime.loader_ready":
        this.setState("waiting_for_user");
        this.resetWatchdog();
        break;
      case "runtime.progress":
        if (data.text && /download.*core/i.test(data.text)) {
          this.setState("downloading_core");
          this.resetWatchdog();
          this.startWatchdog("core_download", () => {
            this.fail("CORE_DOWNLOAD_FAILED", "Core download timed out");
          });
        } else if (data.text && /decompress.*core/i.test(data.text)) {
          this.setState("decompressing_core");
          this.resetWatchdog();
          this.startWatchdog("core_decompression", () => {
            this.fail("CORE_DECOMPRESSION_FAILED", "Core decompression timed out");
          });
        }
        break;
      case "runtime.core_decompression_completed":
        this.setState("initializing_wasm");
        this.resetWatchdog();
        this.startWatchdog("wasm_init", () => {
          this.fail("WASM_INITIALIZATION_FAILED", "WASM initialization timed out");
        });
        break;
      case "runtime.running":
        this.setState("running");
        this.resetWatchdog();
        this.startHeartbeatWatchdog();
        break;
      case "runtime.error":
        this.fail("UNKNOWN_RUNTIME_ERROR", data.message || "Runtime error");
        break;
      case "runtime.heartbeat":
        this.lastHeartbeat = Date.now();
        this.resetWatchdog();
        this.startHeartbeatWatchdog();
        break;
    }
  }

  // ─── Watchdogs ────────────────────────────────────────────────

  private startWatchdog(stage: string, onTimeout: () => void): void {
    this.resetWatchdog();
    const timeout = WATCHDOGS[stage] || 15_000;
    this.watchdogTimer = setTimeout(() => {
      if (this.state !== "running" && this.state !== "stopped") {
        onTimeout();
      }
    }, timeout);
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private startHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      const age = Date.now() - this.lastHeartbeat;
      if (age > WATCHDOGS.heartbeat && this.state === "running") {
        this.fail("RUNTIME_HEARTBEAT_LOST", `No heartbeat for ${age / 1000}s`);
      }
    }, WATCHDOGS.heartbeat + 2000);
  }

  // ─── Core fallback ────────────────────────────────────────────

  async tryNextCore(): Promise<boolean> {
    this.coreAttempt++;
    const chain = getCoreChain(this.detectSystem());
    if (this.coreAttempt >= chain.length) {
      return false; // No more cores to try
    }
    this.setState("recovering");
    this.recoveryAttempt++;
    if (this.iframe) {
      await this.launch(this.iframe);
    }
    return true;
  }

  // ─── Failure ──────────────────────────────────────────────────

  private fail(code: EmulatorFailureCode, message: string, evidence?: Record<string, unknown>): void {
    this.failure = {
      code,
      message,
      stage: this.state,
      evidence,
    };
    this.setState("failed");
    this.resetWatchdog();
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.onFailure(this.failure);
  }

  // ─── Shutdown ─────────────────────────────────────────────────

  shutdown(): void {
    this.resetWatchdog();
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    if (this.iframe) {
      // Send shutdown command
      this.iframe.contentWindow?.postMessage(
        { source: "arcade-parent", type: "command.shutdown" },
        "*",
      );
      this.iframe.src = "about:blank";
      this.iframe = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.setState("stopped");
  }

  // ─── Diagnostics ──────────────────────────────────────────────

  getDiagnosticReport(): DiagnosticReport {
    const chain = getCoreChain(this.detectSystem());
    const coreEntry = chain[Math.min(this.coreAttempt, chain.length - 1)];
    return {
      appBuild: "litlab-studio",
      emulatorVersion: "4.2.3",
      dataPath: this.config.dataPath,
      requestedCore: this.config.core,
      resolvedCore: coreEntry.label,
      assetChecks: [],
      rom: {
        name: this.config.romName,
        size: this.config.romSize,
        extension: this.config.romExtension,
        inesValid: this.config.inesValid,
        sha256: this.config.romSha256,
      },
      blobUrlActive: this.blobUrl !== null,
      sessionState: this.state,
      events: this.events,
      lastEvent: this.events[this.events.length - 1] || null,
      failure: this.failure,
      recoveryAttempt: this.recoveryAttempt,
      coreAttempt: this.coreAttempt,
      elapsedMs: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private detectSystem(): string {
    if (this.config.romExtension === ".nes") return "nes";
    if (this.config.romExtension === ".sfc" || this.config.romExtension === ".smc") return "snes";
    if (this.config.romExtension === ".gb") return "gb";
    if (this.config.romExtension === ".gbc") return "gbc";
    if (this.config.romExtension === ".gba") return "gba";
    if (this.config.romExtension === ".md" || this.config.romExtension === ".gen") return "segaMD";
    return "nes";
  }

  getState(): EmulatorSessionState {
    return this.state;
  }

  getEvents(): readonly RuntimeEvent[] {
    return this.events;
  }

  getFailure(): EmulatorFailure | null {
    return this.failure;
  }

  private setState(state: EmulatorSessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }
}

// ─── ROM validation utilities ───────────────────────────────────

export function isLikelyNesRom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 16 &&
    bytes[0] === 0x4e &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x53 &&
    bytes[3] === 0x1a
  );
}

export function isLikelySnesRom(bytes: Uint8Array): boolean {
  // SNES ROMs can have various headers; check for common SMC header
  if (bytes.length < 0x8000) return false;
  // Check for the internal header at offset 0xFFC0 (or 0x81C0 with SMC header)
  const offset = bytes.length % 0x400 === 0x200 ? 0x81C0 : 0xFFC0;
  if (offset + 0x10 > bytes.length) return false;
  // Check for "SUPER NINTENDO" or similar at the title offset
  const title = new TextDecoder().decode(bytes.slice(offset, offset + 21));
  return title.trim().length > 0;
}

export async function computeSha256(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "unavailable";
}
