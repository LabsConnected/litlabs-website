/**
 * EmulatorJS runtime types — the typed contract between the parent React
 * component and the isolated iframe host (/arcade-runtime/emulator-session.html).
 *
 * The parent sends commands; the iframe emits events. All messages use
 * { source: "arcade" } (iframe → parent) or { source: "arcade-parent" }
 * (parent → iframe) so both sides can filter cross-origin noise.
 */

// ─── Iframe → Parent events ──────────────────────────────────────

export type RuntimeEventType =
  | "runtime.booting"
  | "runtime.loader_ready"
  | "runtime.loader_loaded"
  | "runtime.preparing_runtime"
  | "runtime.progress"
  | "runtime.core_download_started"
  | "runtime.core_download_progress"
  | "runtime.core_download_completed"
  | "runtime.core_decompression_started"
  | "runtime.core_decompression_progress"
  | "runtime.core_decompression_completed"
  | "runtime.wasm_initializing"
  | "runtime.wasm_ready"
  | "runtime.rom_mounting"
  | "runtime.rom_mounted"
  | "runtime.canvas_created"
  | "runtime.first_frame"
  | "runtime.audio_ready"
  | "runtime.running"
  | "runtime.paused"
  | "runtime.error"
  | "runtime.exited"
  | "runtime.heartbeat"
  | "runtime.dom_diagnostics";

export interface RuntimeEvent {
  source: "arcade";
  type: RuntimeEventType;
  text?: string;
  percent?: number;
  message?: string;
  filename?: string;
  lineno?: number;
  core?: string;
  dataPath?: string;
  timestamp?: number;
  // dom_diagnostics fields
  gameChildren?: number;
  gameInnerHTMLLen?: number;
  canvas?: { width: number; height: number; parentTag: string; parentClass: string } | null;
  contextType?: string | null;
  bodyChildren?: number;
}

// ─── Parent → Iframe commands ────────────────────────────────────

export type RuntimeCommandType =
  | "command.start"
  | "command.pause"
  | "command.resume"
  | "command.reset"
  | "command.fullscreen"
  | "command.save_state"
  | "command.load_state"
  | "command.shutdown";

export interface RuntimeCommand {
  source: "arcade-parent";
  type: RuntimeCommandType;
}

// ─── Session state machine ───────────────────────────────────────

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

// ─── Structured failure codes ────────────────────────────────────

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

// ─── Asset preflight ─────────────────────────────────────────────

export interface EmulatorAssetCheck {
  url: string;
  label: string;
  status: number;
  ok: boolean;
  contentType?: string;
  contentLength?: number;
  redirected: boolean;
  htmlFallbackDetected: boolean;
  checksumExpected?: string;
  checksumActual?: string;
  checksumValid?: boolean;
  durationMs: number;
  error?: string;
}

export interface EmulatorAssetPreflightResult {
  ok: boolean;
  checks: EmulatorAssetCheck[];
  coreBytes?: number;
  failedUrl?: string;
  reason?: string;
  failureCode?: EmulatorFailureCode;
}

// ─── ROM validation ──────────────────────────────────────────────

export interface RomValidationResult {
  valid: boolean;
  extension: string;
  size: number;
  sha256?: string;
  headerValid: boolean;
  failureCode?: EmulatorFailureCode;
  error?: string;
}

// ─── Core fallback ───────────────────────────────────────────────

export interface CoreFallbackAttempt {
  attempt: number;
  core: string;
  legacy: boolean;
  failureCode?: EmulatorFailureCode;
  error?: string;
  durationMs?: number;
}

export interface CoreFallbackResult {
  success: boolean;
  attempts: CoreFallbackAttempt[];
  finalCore?: string;
  finalLegacy?: boolean;
}

// ─── Diagnostics ─────────────────────────────────────────────────

export interface EmulatorDiagnosticReport {
  runtimeVersion: string;
  buildId: string;
  dataPath: string;
  requestedCore: string;
  resolvedCore: string;
  runtimeSource: "self-hosted" | "official-fallback";
  browser: string;
  // Asset preflight
  assetChecks: EmulatorAssetCheck[];
  // ROM
  romExtension: string;
  romSize: number;
  romSha256?: string;
  romHeaderValid: boolean;
  // Runtime timing
  bootTime?: number;
  loaderReadyTime?: number;
  coreDownloadDuration?: number;
  decompressionDuration?: number;
  wasmInitDuration?: number;
  romMountDuration?: number;
  firstFrameTime?: number;
  // Live state
  blobUrlActive: boolean;
  canvasCreated: boolean;
  firstFrameObserved: boolean;
  audioContextState?: string;
  heartbeatAgeMs?: number;
  lastRuntimeEvent?: string;
  lastConsoleError?: string;
  // Recovery
  recoveryAttempt: number;
  fallbackAttempts: CoreFallbackAttempt[];
  // Failure
  failureCode?: EmulatorFailureCode;
  errorMessage?: string;
}

// ─── Watchdog configuration ──────────────────────────────────────

export interface WatchdogConfig {
  assetPreflight: number;      // 10s
  coreDownload: number;        // 30s
  coreDecompression: number;   // 20s
  wasmInitialization: number;  // 20s
  romMount: number;            // 10s
  firstFrame: number;          // 15s
  heartbeatAfterRunning: number; // 10s
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  assetPreflight: 10_000,
  coreDownload: 30_000,
  coreDecompression: 20_000,
  wasmInitialization: 20_000,
  romMount: 10_000,
  firstFrame: 15_000,
  heartbeatAfterRunning: 10_000,
};

// ─── Constants ───────────────────────────────────────────────────

export const EMULATOR_VERSION = "4.2.3" as const;
export const EMULATOR_DATA_PATH = "/emulatorjs/4.2.3/data/" as const;
export const EMULATOR_CDN_FALLBACK_PATH = "https://cdn.emulatorjs.org/4.2.3/data/" as const;
export const EMULATOR_MANIFEST_PATH = "/emulatorjs/4.2.3/manifest.json" as const;
export const EMULATOR_SESSION_HOST = "/arcade-runtime/emulator-session.html" as const;
export const EMULATOR_BUILD_ID = "ejs-4.2.3-litt-v13" as const;

// NES core fallback sequence: fceumm → nestopia → nestopia-legacy
export const NES_CORE_FALLBACK_SEQUENCE: ReadonlyArray<{ core: string; legacy: boolean }> = [
  { core: "nes", legacy: false },       // resolves to fceumm
  { core: "nestopia", legacy: false },
  { core: "nestopia", legacy: true },
];

export const MAX_CORE_FALLBACK_ATTEMPTS = 3;

// ─── Core alias resolution ──────────────────────────────────────
// EmulatorJS uses system aliases (e.g. "nes", "snes") that resolve to
// actual libretro core names (e.g. "fceumm", "snes9x"). The preflight
// must check the ACTUAL core filename, not the alias.
// @see https://github.com/EmulatorJS/EmulatorJS
const CORE_ALIASES: Readonly<Record<string, string>> = {
  nes: "fceumm",
  snes: "snes9x",
  gb: "gambatte",
  gbc: "gambatte",
  gba: "mgba",
  n64: "mupen64plus_next",
  nds: "melonds",
  psx: "pcsx_rearmed",
  segaMD: "genesis_plus_gx",
  segaMS: "genesis_plus_gx",
  segaCD: "genesis_plus_gx",
  segaGG: "genesis_plus_gx",
  sega32x: "picodrive",
  atari2600: "stella",
  atari7800: "prosystem",
  lynx: "handy",
  jaguar: "virtualjaguar",
  vb: "beetle_vb",
  pce: "mednafen_pce",
  tg16: "mednafen_pce",
  wswan: "mednafen_supersu",
  arcade: "fbneo",
  fbneo: "fbneo",
  mame2003: "mame2003",
  mame2010: "mame2010",
};

/**
 * Resolve a core alias to the actual libretro core name.
 * Returns the input unchanged if no alias exists (e.g. "fceumm" → "fceumm").
 */
export function resolveCoreName(core: string): string {
  return CORE_ALIASES[core] ?? core;
}

/**
 * Build the actual core .data filename for a given core alias.
 * Handles legacy + thread variants.
 */
export function getCoreDataFilename(
  core: string,
  options?: { legacy?: boolean; threads?: boolean },
): string {
  const resolved = resolveCoreName(core);
  const parts = [resolved];
  if (options?.threads) parts.push("thread");
  if (options?.legacy) parts.push("legacy");
  parts.push("wasm.data");
  return parts.join("-");
}

// iNES header magic bytes: 4E 45 53 1A
export const INES_MAGIC = [0x4e, 0x45, 0x53, 0x1a] as const;

// 7z archive signature: 37 7A BC AF 27 1C
export const SEVEN_Z_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] as const;
