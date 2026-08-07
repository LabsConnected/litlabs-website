/**
 * LiTT Runtime — Result Verifier
 *
 * Lightweight output verification. In Phase 1 this performs the same
 * sanitization the legacy routes used (template-variable scrubbing) plus
 * a guard against empty responses. Phase 5 will add capability-claim
 * verification (refusing to let the LLM claim a tool worked when no
 * handler executed).
 */

import { sanitizeOutput } from "./prompt-builder";

export interface VerifiedResult {
  text: string;
  /** True when the response was non-empty after sanitization. */
  ok: boolean;
  /** Reason the result was flagged, if any. */
  warning?: string;
}

/**
 * Sanitize and verify a model response.
 */
export function verifyResult(rawText: string): VerifiedResult {
  const text = sanitizeOutput(rawText ?? "");
  if (!text.trim()) {
    return { text, ok: false, warning: "empty_response" };
  }
  return { text, ok: true };
}
