/**
 * settingsHelpers — pure helpers for the Settings page.
 *
 * Extracted so the truthfulness rules of the Overview cards (real user name,
 * real 2FA state, real theme labels) are unit-tested instead of buried inline
 * in the page component.
 */

/* ── Display labels ────────────────────────────────────────────────── */

const ACCENT_LABELS: Record<string, string> = {
  lime: "LiTT Lime",
  "neon-green": "Neon Green",
  "hot-pink": "Hot Pink",
  "electric-blue": "Electric Blue",
  "cyber-yellow": "Cyber Yellow",
  "matrix-green": "Matrix Green",
  "sunset-orange": "Sunset Orange",
  "ocean-blue": "Ocean Blue",
  "purple-haze": "Purple Haze",
};

/** Friendly accent name — never a raw hex code or internal id. */
export function accentLabel(accentId: string): string {
  return ACCENT_LABELS[accentId] ?? accentId;
}

export function themeModeLabel(mode: "dark" | "light" | "system"): string {
  if (mode === "light") return "Light";
  if (mode === "system") return "System";
  return "Dark";
}

/* ── Overview card values ──────────────────────────────────────────── */

export function accountCardValue(opts: {
  isSignedIn: boolean;
  userLoaded: boolean;
  firstName?: string | null;
  username?: string | null;
}): string {
  if (!opts.isSignedIn) return "Not signed in";
  if (!opts.userLoaded) return "Signing in…";
  return `Signed in as ${opts.firstName || opts.username || "User"}`;
}

export function securityCardValue(opts: {
  userLoaded: boolean;
  twoFactorEnabled?: boolean;
  lastSignInAt?: Date | number | null;
}): string {
  if (!opts.userLoaded) return "Loading…";
  const twoFA = opts.twoFactorEnabled ? "2FA on" : "2FA off";
  const last = opts.lastSignInAt ? new Date(opts.lastSignInAt).toLocaleDateString() : "never";
  return `${twoFA} · Last sign-in ${last}`;
}

export type MicCardStatus = "unknown" | "available" | "denied" | "error";

/** Honest mic status — "unknown" means not tested yet, never "testing". */
export function micCardValue(status: MicCardStatus): string {
  if (status === "available") return "Microphone available";
  if (status === "denied") return "Microphone blocked";
  if (status === "error") return "Microphone error";
  return "Not tested yet";
}

/* ── Local settings reset ──────────────────────────────────────────── */

const SETTINGS_KEY_PREFIXES = [
  "litlabs:settings:",
  "littree:",
  "litlabs:agent-settings",
  "litt-voice-browser-selection",
  "litt:voice:",
];

/**
 * Remove every localStorage key the Settings page owns. Returns the number
 * of keys removed. Never touches auth/session keys (Clerk uses __clerk_*).
 */
export function resetAllLocalSettings(): number {
  if (typeof window === "undefined" || !window.localStorage) return 0;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && SETTINGS_KEY_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
  return doomed.length;
}

/* ── Voice preferences ───────────────────────────────────────────────
 * These keys MUST match VoiceSessionContext
 * (src/app/(app)/studio/context/VoiceSessionContext.tsx) — that context is
 * the runtime consumer. The Settings page writes the same keys so Studio
 * voice behavior actually changes and survives reloads.
 */

export const VOICE_AUTO_SEND_KEY = "litt:voice:autoSendEnabled";
export const VOICE_TTS_KEY = "litt:voice:ttsEnabled";
export const VOICE_DEVICE_KEY = "litt:voice:deviceId";

export interface VoicePrefs {
  autoSend: boolean;
  ttsEnabled: boolean;
  deviceId: string | null;
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read the voice prefs the Studio voice session actually consumes. */
export function loadVoicePrefs(storage: Storage | null = defaultStorage()): VoicePrefs {
  const get = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const tts = get(VOICE_TTS_KEY);
  return {
    autoSend: get(VOICE_AUTO_SEND_KEY) === "1",
    // Context default is enabled; only an explicit "0" disables it.
    ttsEnabled: tts === null ? true : tts === "1",
    deviceId: get(VOICE_DEVICE_KEY),
  };
}

/** Persist one voice pref. Storage failures are non-fatal (private mode). */
export function saveVoicePref(key: string, value: string, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(key, value);
  } catch {
    /* storage unavailable — pref stays session-only */
  }
}

/* ── Microphone error classification ──────────────────────────────── */

export type MicErrorKind =
  | "denied"
  | "not-found"
  | "in-use"
  | "overconstrained"
  | "insecure"
  | "unsupported"
  | "error";

export interface MicErrorInfo {
  kind: MicErrorKind;
  /** Maps onto the existing micStatus union used for the status dot. */
  status: "denied" | "error";
  /** User-facing explanation + recovery path. */
  hint: string;
}

/**
 * Turn a getUserMedia/permission failure into an actionable message.
 * Never surfaces raw DOMException text to the user.
 */
export function classifyMicError(err: unknown, hasMediaDevices = true): MicErrorInfo {
  if (!hasMediaDevices) {
    return {
      kind: "unsupported",
      status: "error",
      hint: "This browser or page can't access a microphone. Voice needs HTTPS (or localhost) and a supported browser.",
    };
  }
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return {
        kind: "denied",
        status: "denied",
        hint: "Microphone permission was blocked. Allow it via the lock/site-settings icon in the address bar, then retry.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        kind: "not-found",
        status: "error",
        hint: "No microphone was found. Connect or enable an input device, then retry.",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        kind: "in-use",
        status: "error",
        hint: "The microphone is in use by another app or tab. Close it and retry.",
      };
    case "OverconstrainedError":
      return {
        kind: "overconstrained",
        status: "error",
        hint: "The selected microphone can't satisfy the voice requirements. Pick a different device above.",
      };
    case "AbortError":
      return {
        kind: "error",
        status: "error",
        hint: "The microphone request was interrupted. Retry the test.",
      };
    default:
      return {
        kind: "error",
        status: "error",
        hint: "Microphone test failed. Check that a device is connected and not in use, then retry.",
      };
  }
}

/* ── Voice connection error classification ────────────────────────── */

/** Explain a failed /api/voice/token response with a recovery path. */
export function describeVoiceTokenFailure(status: number): string {
  if (status === 401 || status === 403) {
    return "Voice sign-in was rejected (session expired or missing). Sign in again, then retry.";
  }
  if (status === 503) {
    return "Voice service is not configured on the server (missing VOICE_AUTH_SECRET or provider keys). Contact support.";
  }
  if (status === 429) {
    return "Too many voice requests — wait a moment and retry.";
  }
  return `Voice token request failed (HTTP ${status}). Check your connection and retry.`;
}

/** Explain a WebSocket close before the session was established. */
export function describeVoiceClose(code: number, reason = ""): string {
  const suffix = reason ? ` — ${reason.slice(0, 80)}` : "";
  if (code === 1008) {
    return `Voice server rejected the session (policy violation)${suffix}. This usually means a token/secret mismatch — report it.`;
  }
  if (code === 1006) {
    return "Connection dropped before the voice session started. Check your network or VPN, then retry.";
  }
  if (code === 1011) {
    return `Voice server hit an internal error during setup${suffix}. Retry; if it persists, contact support.`;
  }
  return `Voice session closed before it was ready (code ${code})${suffix}.`;
}

/** Explain a failed /api/voice/tts preview response. */
export function describeTtsFailure(status: number, serverError?: string): string {
  if (status === 401 || status === 403) {
    return "Preview needs a signed-in session — sign in and retry.";
  }
  if (status === 429) {
    return "Too many preview requests — wait a moment and retry.";
  }
  if (serverError && /not configured/i.test(serverError)) {
    return "LiTT voice preview is unavailable — the server TTS provider isn't configured.";
  }
  return `LiTT voice preview failed (HTTP ${status}). You can still preview with the browser voice below.`;
}
