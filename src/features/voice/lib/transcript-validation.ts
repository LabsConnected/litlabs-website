/**
 * transcript-validation.ts — Gate that rejects invalid voice transcripts.
 *
 * Every finalized transcript from STT must pass this gate before it can
 * become a message. This prevents ghost transcription from:
 * - Background noise transcribed as filler words
 * - Empty or near-empty transcripts
 * - Duplicates of the previous transcript
 * - Transcripts captured during LiTT TTS playback (echo)
 * - Low-confidence recognition results
 *
 * @see voice-gate-config.ts for configurable thresholds
 */

import { VOICE_GATE_CONFIG } from "./voice-gate-config";

export type RejectionReason =
  | "empty"
  | "too_short"
  | "filler_only"
  | "duplicate"
  | "during_tts"
  | "low_confidence"
  | "no_speech_detected"
  | "accepted";

export interface TranscriptValidationResult {
  accepted: boolean;
  reason: RejectionReason;
  transcript: string;
  /** Human-readable explanation for diagnostics. */
  explanation: string;
}

export interface ValidationContext {
  /** The previous accepted transcript (for duplicate detection). */
  previousTranscript: string | null;
  /** Whether LiTT TTS is currently playing (echo isolation). */
  ttsPlaying: boolean;
  /** Confidence score from STT (0-1), if available. */
  confidence?: number;
  /** Total speech duration detected by VAD (ms), if available. */
  speechDurationMs?: number;
}

/**
 * Validate a finalized transcript. Returns whether it should be accepted
 * and the rejection reason if not.
 */
export function validateTranscript(
  rawTranscript: string,
  ctx: ValidationContext,
): TranscriptValidationResult {
  const transcript = rawTranscript.trim();
  const config = VOICE_GATE_CONFIG.validation;

  // 1. Empty transcript
  if (!transcript) {
    return reject("empty", transcript, "Transcript is empty.");
  }

  // 2. Too short (character count)
  if (config.rejectShortTranscripts && transcript.length < config.minLength) {
    return reject("too_short", transcript, `Transcript too short (${transcript.length} chars, min ${config.minLength}).`);
  }

  // 3. Filler-only transcript
  if (config.rejectFillerOnly && isFillerOnly(transcript, config.fillerWords)) {
    return reject("filler_only", transcript, `Transcript is only filler words: "${transcript}".`);
  }

  // 4. Duplicate of previous transcript
  if (config.rejectDuplicates && ctx.previousTranscript && transcript === ctx.previousTranscript) {
    return reject("duplicate", transcript, "Transcript duplicates the previous one.");
  }

  // 5. Captured during TTS playback (echo)
  if (ctx.ttsPlaying) {
    return reject("during_tts", transcript, "Transcript captured during LiTT TTS playback (echo).");
  }

  // 6. Low confidence
  if (config.minConfidence > 0 && ctx.confidence !== undefined && ctx.confidence < config.minConfidence) {
    return reject("low_confidence", transcript, `Confidence too low (${ctx.confidence.toFixed(2)}, min ${config.minConfidence}).`);
  }

  // 7. No speech detected by VAD
  if (ctx.speechDurationMs !== undefined && ctx.speechDurationMs < VOICE_GATE_CONFIG.vad.minSpeechDurationMs) {
    return reject("no_speech_detected", transcript, `No real speech detected (duration ${ctx.speechDurationMs}ms, min ${VOICE_GATE_CONFIG.vad.minSpeechDurationMs}ms).`);
  }

  // All checks passed
  return {
    accepted: true,
    reason: "accepted",
    transcript,
    explanation: "Transcript accepted.",
  };
}

/**
 * Check if a transcript consists ONLY of filler words.
 * "yeah" → true. "yeah let's do it" → false.
 */
export function isFillerOnly(transcript: string, fillerWords: readonly string[]): boolean {
  const normalized = transcript.toLowerCase().replace(/[^\w\s]/g, "").trim();
  if (!normalized) return true;
  const words = normalized.split(/\s+/);
  // Check if the entire transcript is a single filler word or phrase
  for (const filler of fillerWords) {
    if (normalized === filler) return true;
  }
  // Check if ALL words are filler words (e.g. "yeah um")
  const fillerSet = new Set(fillerWords.flatMap((f) => f.split(/\s+/)));
  const allFiller = words.every((w) => fillerSet.has(w));
  return allFiller && words.length <= 3;
}

function reject(reason: RejectionReason, transcript: string, explanation: string): TranscriptValidationResult {
  return { accepted: false, reason, transcript, explanation };
}
