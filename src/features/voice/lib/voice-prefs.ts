/**
 * voice-prefs.ts — Persistence helpers for Studio voice preferences.
 *
 * These are the SAME localStorage keys VoiceSessionContext reads and
 * writes (see src/app/(app)/studio/context/VoiceSessionContext.tsx):
 *
 *   - `litt:voice:autoSendEnabled` ("1" | "0") — read when the voice
 *     session provider mounts; the composer popover toggles it live.
 *   - `litt:voice:ttsEnabled` ("1" | "0") — same pattern for spoken replies.
 *
 * Settings → Voice & Camera writes through these helpers so a preference
 * set on the Settings page is the preference the Studio session actually
 * uses — there is no second, disconnected copy of the state. Values are
 * stored as "1"/"0" strings to match the session context's parsing
 * (`localStorage.getItem(key) === "1"`).
 *
 * No React dependencies — everything here is testable in jsdom.
 */

import { VOICE_GATE_CONFIG } from "./voice-gate-config";

/** localStorage key for the auto-send preference (shared with VoiceSessionContext). */
export const AUTO_SEND_STORAGE_KEY = "litt:voice:autoSendEnabled";

/** localStorage key for the spoken-replies (TTS) preference (shared with VoiceSessionContext). */
export const TTS_ENABLED_STORAGE_KEY = "litt:voice:ttsEnabled";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota) — the in-memory UI state
    // still reflects the choice for this mount; nothing else to do.
  }
}

/**
 * Read the auto-send preference exactly as VoiceSessionContext does:
 * a stored value always wins ("1" = on, "0" = off); when nothing is
 * stored, the default is VOICE_GATE_CONFIG.ptt.autoSendDefault (true).
 */
export function readAutoSendEnabled(): boolean {
  const stored = safeGet(AUTO_SEND_STORAGE_KEY);
  return stored === null ? VOICE_GATE_CONFIG.ptt.autoSendDefault : stored === "1";
}

/** Persist the auto-send preference in the session context's format. */
export function writeAutoSendEnabled(enabled: boolean): void {
  safeSet(AUTO_SEND_STORAGE_KEY, enabled ? "1" : "0");
}

/**
 * Read the spoken-replies preference exactly as VoiceSessionContext does:
 * unset means enabled (default true); only the literal "0" disables.
 */
export function readTtsEnabled(): boolean {
  const stored = safeGet(TTS_ENABLED_STORAGE_KEY);
  return stored === null ? true : stored === "1";
}

/** Persist the spoken-replies preference in the session context's format. */
export function writeTtsEnabled(enabled: boolean): void {
  safeSet(TTS_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
}
