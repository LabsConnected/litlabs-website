/**
 * voice-gate-config.ts — Configurable constants for voice activity detection,
 * transcript validation, and echo isolation.
 *
 * All thresholds are exposed as named constants so they can be tuned without
 * hunting through code. Defaults are conservative to prevent ghost
 * transcription from background noise, filler words, and LiTT's own TTS
 * output.
 *
 * @see voice-vad.ts — client-side VAD using these constants
 * @see transcript-validation.ts — transcript validation gate using these constants
 */

export const VOICE_GATE_CONFIG = {
  // ── Client-side VAD (Voice Activity Detection) ──
  vad: {
    /** RMS threshold (0-1) below which audio is considered silence. */
    silenceRmsThreshold: 0.015,
    /** Minimum continuous speech duration (ms) before accepting audio as real speech. */
    minSpeechDurationMs: 350,
    /** Silence duration (ms) after speech before finalizing the utterance. */
    endOfSpeechSilenceMs: 900,
    /** Maximum recording duration (ms) before auto-stopping (safety cap). */
    maxRecordingMs: 60_000,
    /** How often to sample audio level (ms). */
    sampleIntervalMs: 50,
  },

  // ── Transcript validation ──
  validation: {
    /** Minimum transcript length (characters) to accept. */
    minLength: 2,
    /** Minimum transcript word count to accept. */
    minWords: 1,
    /** Filler words that are rejected if they are the ENTIRE transcript. */
    fillerWords: [
      "yeah", "yea", "yep", "yup", "no", "nah", "hmm", "mm", "mmm",
      "uh", "um", "uhh", "umm", "oh", "ah", "eh", "okay", "ok",
      "sure", "right", "great", "cool", "nice", "wow", "hey",
      "you know", "i mean", "like",
    ],
    /** If true, transcripts matching only filler words are rejected. */
    rejectFillerOnly: true,
    /** If true, transcripts that exactly duplicate the previous one are rejected. */
    rejectDuplicates: true,
    /** If true, transcripts shorter than minLength are rejected. */
    rejectShortTranscripts: true,
    /** Minimum confidence (0-1) if confidence is reported. 0 = no minimum. */
    minConfidence: 0.0,
  },

  // ── Echo isolation (prevent LiTT from hearing itself) ──
  echo: {
    /** Pause microphone capture while TTS is playing. */
    pauseMicDuringTts: true,
    /** Cooldown (ms) after TTS ends before resuming mic capture. */
    postTtsCooldownMs: 500,
    /** Cancel stale recognition callbacks created before TTS started. */
    cancelStaleCallbacksOnTts: true,
  },

  // ── Audio constraints requested from getUserMedia ──
  audioConstraints: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 24000,
  },

  // ── Push-to-talk ──
  ptt: {
    /** Push-to-talk is the default mode. Hands-free is removed. */
    defaultMode: "push_to_talk" as const,
    /** Auto-send finalized transcript (default: false — show editable draft). */
    autoSendDefault: false,
  },
} as const;

export type VoiceGateConfig = typeof VOICE_GATE_CONFIG;
