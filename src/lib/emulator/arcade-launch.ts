/**
 * Arcade launch state machine + BS-X BIOS validation.
 *
 * The launch state is a discriminated union that gates every action:
 * - No iframe can be created until status is "launching"
 * - No launch counter increment until "launching"
 * - No "Running" label until "running" (which requires first video frame)
 *
 * @see src/app/games/retro/play/[gameId]/page.tsx
 */

import { md5 } from "hash-wasm";

// ─── Expected BS-X BIOS ────────────────────────────────────────────
// The canonical BS-X.bin MD5 hash. The user must supply a legally
// obtained copy; we validate it matches this hash before launching.
export const EXPECTED_BSX_MD5 = "fed4d8242cfbed61343d53d48432aced";
export const EXPECTED_BSX_FILENAME = "BS-X.bin";

// ─── Launch state discriminated union ──────────────────────────────

export type ArcadeLaunchState =
  | { status: "loading" }                                    // ROM being read from IndexedDB
  | { status: "rom-error"; message: string }                 // ROM failed to load/validate
  | { status: "needs-bios" }                                 // Satellaview, no BIOS selected
  | { status: "validating-bios"; fileName: string }          // BIOS file being hashed
  | { status: "invalid-bios"; reason: string; fileName: string } // BIOS MD5 mismatch
  | { status: "ready"; biosHash: string; biosFileName: string } // BIOS validated, waiting for Start
  | { status: "launching"; sessionId: string }               // Start clicked, creating iframe
  | { status: "waiting-for-user"; sessionId: string }        // EmulatorJS loaded, waiting for Play click
  | { status: "core-starting"; sessionId: string }           // EJS_onGameStart fired, waiting for video
  | { status: "running"; sessionId: string }                 // First video frame confirmed
  | { status: "error"; message: string };                    // Runtime error

// ─── Forbidden transition guard ────────────────────────────────────

const FORBIDDEN_TRANSITIONS: Record<string, string[]> = {
  "needs-bios": ["launching", "waiting-for-user", "core-starting", "running"],
  "validating-bios": ["launching", "waiting-for-user", "core-starting", "running"],
  "invalid-bios": ["launching", "waiting-for-user", "core-starting", "running"],
  "ready": ["running", "core-starting", "waiting-for-user"], // must go through "launching" first
};

export function isTransitionAllowed(from: string, to: string): boolean {
  const forbidden = FORBIDDEN_TRANSITIONS[from];
  if (forbidden && forbidden.includes(to)) return false;
  return true;
}

// ─── BIOS validation ───────────────────────────────────────────────

export interface BiosValidationResult {
  ok: boolean;
  hash?: string;
  error?: string;
  warning?: string;
}

/**
 * Validate a user-selected BS-X BIOS file by computing its MD5 hash
 * and comparing against the expected hash. The file stays in the
 * browser — it is never uploaded.
 *
 * Returns `ok: true` when the hash matches. Returns `ok: false` with
 * a `warning` (not a hard block) when the hash doesn't match — the
 * caller can still allow the user to proceed at their own risk.
 */
export async function validateBsxBios(file: File | Blob): Promise<BiosValidationResult> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return { ok: false, error: "The selected BIOS file is empty." };
    }
    const hash = await md5(bytes);
    if (hash.toLowerCase() !== EXPECTED_BSX_MD5) {
      return {
        ok: false,
        hash: hash.toLowerCase(),
        warning: `This file's MD5 (${hash.slice(0, 12)}…) doesn't match the expected BS-X BIOS (${EXPECTED_BSX_MD5.slice(0, 12)}…). It may be a different revision. You can try it anyway, but the game may not boot correctly.`,
      };
    }
    return { ok: true, hash: hash.toLowerCase() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "BIOS validation failed.",
    };
  }
}

// ─── Launch state helpers ──────────────────────────────────────────

/** Whether the iframe should be mounted for this state. */
export function shouldRenderIframe(state: ArcadeLaunchState): boolean {
  return (
    state.status === "launching" ||
    state.status === "waiting-for-user" ||
    state.status === "core-starting" ||
    state.status === "running"
  );
}

/** Whether the launch counter should be incremented. */
export function shouldIncrementLaunches(state: ArcadeLaunchState): boolean {
  return state.status === "launching";
}

/** Human-readable status label for the current state. */
export function launchStatusLabel(state: ArcadeLaunchState): string {
  switch (state.status) {
    case "loading": return "Loading ROM…";
    case "rom-error": return "ROM error";
    case "needs-bios": return "Waiting for BIOS";
    case "validating-bios": return "Validating BIOS…";
    case "invalid-bios": return "Invalid BIOS";
    case "ready": return "Ready to launch";
    case "launching": return "Creating local emulator session…";
    case "waiting-for-user": return "Ready — press Play";
    case "core-starting": return "Core starting…";
    case "running": return "Running";
    case "error": return "Runtime error";
  }
}
