/**
 * mixer-settings.ts — Pure helpers for the Mic & Mixer feature.
 *
 * Owns:
 *   - Persistence of mixer preferences (input gain, output volume, mute)
 *   - Reading the persisted input-device selection (shared with
 *     VoiceSessionContext's `litt:voice:deviceId` key)
 *   - Building the getUserMedia audio constraints from the voice gate config
 *     plus the selected device
 *   - Clamping helpers for gain/volume values
 *
 * No React or Web Audio dependencies — everything here is testable in jsdom.
 *
 * @see useMixerStore.ts — zustand store built on these helpers
 * @see useInworldSession.ts — applies constraints + gains to the audio graph
 */

import { VOICE_GATE_CONFIG } from "./voice-gate-config";

/** localStorage key for mixer prefs (JSON blob). */
export const MIXER_STORAGE_KEY = "litt:voice:mixer";

/**
 * localStorage key for the selected input device. This is the SAME key
 * VoiceSessionContext uses for `selectDevice()` — both writers stay in sync
 * and the mic capture reads whichever was written last.
 */
export const DEVICE_ID_STORAGE_KEY = "litt:voice:deviceId";

/** Mixer preference values. */
export interface MixerPrefs {
  /** Input (mic) multiplier. 0–2. 1 = unity. */
  inputGain: number;
  /** Output (TTS) volume. 0–1. 1 = full scale. */
  outputVolume: number;
  /** When true the mic track is disabled and input gain is zeroed. */
  muted: boolean;
}

export const MIXER_DEFAULTS: MixerPrefs = {
  inputGain: 1,
  outputVolume: 1,
  muted: false,
};

// ── Clamps ──────────────────────────────────────────────────────────────────

/** Clamp an input-gain value to the supported range (0–2). */
export function clampGain(value: number): number {
  if (!Number.isFinite(value)) return MIXER_DEFAULTS.inputGain;
  return Math.max(0, Math.min(2, value));
}

/** Clamp an output-volume value to the supported range (0–1). */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return MIXER_DEFAULTS.outputVolume;
  return Math.max(0, Math.min(1, value));
}

// ── Constraints ─────────────────────────────────────────────────────────────

/**
 * Build the audio constraints for getUserMedia: the canonical voice gate
 * constraints, narrowed to a specific device when one is selected.
 *
 * A deviceId of "default", empty string, or null means "let the OS decide" —
 * in that case no deviceId key is emitted at all (matching browser
 * conventions where `"default"` and absent behave identically but absent is
 * more predictable across engines).
 */
export function buildMicAudioConstraints(options?: {
  deviceId?: string | null;
}): MediaTrackConstraints {
  const base: MediaTrackConstraints = { ...VOICE_GATE_CONFIG.audioConstraints };
  const deviceId = options?.deviceId;
  if (typeof deviceId === "string" && deviceId.length > 0 && deviceId !== "default") {
    base.deviceId = { exact: deviceId };
  }
  return base;
}

/** Read the persisted input-device id (null = system default). */
export function readStoredDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// ── Persistence ─────────────────────────────────────────────────────────────

/** Load mixer prefs from localStorage, falling back to defaults on any error. */
export function loadMixerPrefs(): MixerPrefs {
  if (typeof window === "undefined") return { ...MIXER_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(MIXER_STORAGE_KEY);
    if (!raw) return { ...MIXER_DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...MIXER_DEFAULTS };
    const obj = parsed as Record<string, unknown>;
    return {
      inputGain: clampGain(typeof obj.inputGain === "number" ? obj.inputGain : MIXER_DEFAULTS.inputGain),
      outputVolume: clampVolume(
        typeof obj.outputVolume === "number" ? obj.outputVolume : MIXER_DEFAULTS.outputVolume,
      ),
      muted: typeof obj.muted === "boolean" ? obj.muted : MIXER_DEFAULTS.muted,
    };
  } catch {
    return { ...MIXER_DEFAULTS };
  }
}

/** Persist mixer prefs. Failures are swallowed (private-mode / quota errors). */
export function persistMixerPrefs(prefs: MixerPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Non-fatal — settings just won't survive a reload.
  }
}
