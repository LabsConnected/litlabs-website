/**
 * EmulatorCoreFallback — manages the NES core fallback sequence.
 *
 * Attempt 1: core "nes" (resolves to fceumm), threads false, legacy false
 * Attempt 2: core "nestopia", threads false, legacy false
 * Attempt 3: core "nestopia", threads false, legacy true
 *
 * Fallback only after a structured failure. Maximum 3 attempts.
 * Never fallback based only on elapsed time while progress or heartbeat
 * is still occurring.
 */

import type {
  CoreFallbackAttempt,
  CoreFallbackResult,
  EmulatorFailureCode,
} from "./types";
import {
  NES_CORE_FALLBACK_SEQUENCE,
  MAX_CORE_FALLBACK_ATTEMPTS,
} from "./types";

/**
 * Get the core config for a given attempt number (1-indexed).
 * Returns null if the attempt exceeds the max.
 */
export function getCoreForAttempt(
  attempt: number,
): { core: string; legacy: boolean } | null {
  if (attempt < 1 || attempt > MAX_CORE_FALLBACK_ATTEMPTS) return null;
  return NES_CORE_FALLBACK_SEQUENCE[attempt - 1] ?? null;
}

/**
 * Determine whether a failure should trigger a fallback to the next core.
 *
 * Returns true for core-related failures, false for ROM/asset failures
 * that won't be fixed by switching cores.
 */
export function shouldFallbackOnFailure(
  failureCode: EmulatorFailureCode,
): boolean {
  switch (failureCode) {
    case "CORE_DOWNLOAD_FAILED":
    case "CORE_DECOMPRESSION_FAILED":
    case "WASM_INITIALIZATION_FAILED":
    case "FIRST_FRAME_TIMEOUT":
    case "UNKNOWN_RUNTIME_ERROR":
      return true;
    case "ROM_INVALID":
    case "ROM_UNSUPPORTED":
    case "ASSET_MISSING":
    case "ASSET_HTML_FALLBACK":
    case "ASSET_CORRUPT":
    case "ROM_MOUNT_FAILED":
    case "AUDIO_CONTEXT_BLOCKED":
    case "IFRAME_CRASHED":
    case "RUNTIME_HEARTBEAT_LOST":
      return false;
    default:
      return false;
  }
}

/**
 * Build the fallback result after a session ends (success or failure).
 */
export function buildFallbackResult(
  attempts: CoreFallbackAttempt[],
  success: boolean,
): CoreFallbackResult {
  const lastAttempt = attempts[attempts.length - 1];
  return {
    success,
    attempts,
    finalCore: success ? lastAttempt?.core : undefined,
    finalLegacy: success ? lastAttempt?.legacy : undefined,
  };
}

/**
 * Create a fallback attempt record.
 */
export function createAttempt(
  attempt: number,
  core: string,
  legacy: boolean,
): CoreFallbackAttempt {
  return { attempt, core, legacy };
}

/**
 * Record a failure on an attempt.
 */
export function recordAttemptFailure(
  attempt: CoreFallbackAttempt,
  failureCode: EmulatorFailureCode,
  error?: string,
  durationMs?: number,
): CoreFallbackAttempt {
  return {
    ...attempt,
    failureCode,
    error,
    durationMs,
  };
}

/**
 * Whether there are more fallback attempts available.
 */
export function hasMoreAttempts(currentAttempt: number): boolean {
  return currentAttempt < MAX_CORE_FALLBACK_ATTEMPTS;
}
