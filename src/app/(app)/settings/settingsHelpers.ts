/**
 * settingsHelpers — pure helpers for the Settings page.
 *
 * Extracted so the truthfulness rules of the Overview cards (real user name,
 * real 2FA state, real theme labels, honest lock affordances) are unit-tested
 * instead of buried inline in the page component.
 */
import {
  MODE_ORDER,
  SETTINGS_SECTIONS,
  type ControlMode,
} from "@/stores/useSettingsStore";

/* ── Section locks ─────────────────────────────────────────────────── */

export function sectionMinMode(sectionId: string): ControlMode {
  return SETTINGS_SECTIONS.find((s) => s.id === sectionId)?.minMode ?? "standard";
}

/** True when `sectionId` needs a higher control mode than the current one. */
export function isSectionLocked(sectionId: string, controlMode: ControlMode): boolean {
  return MODE_ORDER.indexOf(sectionMinMode(sectionId)) > MODE_ORDER.indexOf(controlMode);
}

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
