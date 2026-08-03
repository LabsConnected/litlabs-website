/**
 * voice-vad.ts — Client-side Voice Activity Detection with endpointing.
 *
 * Uses an AnalyserNode to compute RMS audio levels and detect:
 * - When real speech starts (RMS above threshold for minSpeechDurationMs)
 * - When speech ends (sustained silence for endOfSpeechSilenceMs)
 * - Rejects noise spikes, clicks, breathing, keyboard sounds that don't
 *   meet the minimum speech duration
 *
 * The VAD is designed to be used WITH Inworld STT, not instead of it.
 * It gates when audio is sent to Inworld — only sending audio when real
 * speech is detected — and provides endpointing so the caller knows when
 * to commit the audio buffer.
 *
 * @see voice-gate-config.ts for configurable thresholds
 */

import { VOICE_GATE_CONFIG } from "./voice-gate-config";

export type VadState =
  | "idle"
  | "listening"
  | "speech_detected"
  | "speech_ended"
  | "error";

export interface VadCallbacks {
  /** Fired when real speech is detected (after minSpeechDurationMs of continuous audio). */
  onSpeechStart?: () => void;
  /** Fired when speech ends (sustained silence after speech). */
  onSpeechEnd?: (durationMs: number) => void;
  /** Fired on every audio level sample with the RMS value (0-1). */
  onLevel?: (rms: number) => void;
  /** Fired when the VAD state changes. */
  onStateChange?: (state: VadState) => void;
}

interface VadInternalState {
  state: VadState;
  speechStartTime: number;
  lastSpeechTime: number;
  silenceStartTime: number | null;
  totalSpeechMs: number;
  rafId: number | null;
  analyser: AnalyserNode | null;
  dataArray: Uint8Array | null;
  isDestroyed: boolean;
}

/**
 * VoiceActivityDetector — detects real speech and endpointing using RMS levels.
 *
 * Usage:
 *   const vad = new VoiceActivityDetector(analyser, callbacks);
 *   vad.start();
 *   // ... when user stops talking ...
 *   vad.stop();  // fires onSpeechEnd if speech was detected
 *
 * The detector does NOT capture audio — it only analyzes an AnalyserNode
 * that the caller has already connected to the mic stream.
 */
export class VoiceActivityDetector {
  private state: VadInternalState;
  private readonly config: typeof VOICE_GATE_CONFIG.vad;
  private readonly callbacks: VadCallbacks;

  constructor(analyser: AnalyserNode, callbacks: VadCallbacks = {}) {
    this.config = VOICE_GATE_CONFIG.vad;
    this.callbacks = callbacks;
    this.state = {
      state: "idle",
      speechStartTime: 0,
      lastSpeechTime: 0,
      silenceStartTime: null,
      totalSpeechMs: 0,
      rafId: null,
      analyser,
      dataArray: new Uint8Array(analyser.frequencyBinCount),
      isDestroyed: false,
    };
  }

  /** Start VAD monitoring. */
  start(): void {
    if (this.state.isDestroyed) return;
    if (this.state.rafId !== null) return; // already running
    this.setState("listening");
    this.state.silenceStartTime = null;
    this.state.speechStartTime = 0;
    this.state.totalSpeechMs = 0;
    this.tick();
  }

  /** Stop VAD monitoring. If speech was in progress, fires onSpeechEnd. */
  stop(): void {
    if (this.state.rafId !== null) {
      cancelAnimationFrame(this.state.rafId);
      this.state.rafId = null;
    }
    // If we were in speech_detected, finalize the utterance
    if (this.state.state === "speech_detected" && this.state.totalSpeechMs > 0) {
      this.callbacks.onSpeechEnd?.(this.state.totalSpeechMs);
    }
    this.setState("idle");
  }

  /** Permanently destroy the VAD — stop monitoring and release references. */
  destroy(): void {
    this.stop();
    this.state.isDestroyed = true;
    this.state.analyser = null;
    this.state.dataArray = null;
  }

  /** Get current VAD state. */
  getState(): VadState {
    return this.state.state;
  }

  /** Get total speech duration detected in this session (ms). */
  getSpeechDurationMs(): number {
    return this.state.totalSpeechMs;
  }

  // ── Internal ──

  private setState(newState: VadState): void {
    if (this.state.state === newState) return;
    this.state.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  private tick = (): void => {
    if (this.state.isDestroyed || !this.state.analyser || !this.state.dataArray) {
      return;
    }

    const analyser = this.state.analyser;
    const dataArray = this.state.dataArray;
    if (dataArray) analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);

    // Compute RMS
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    this.callbacks.onLevel?.(rms);

    const now = performance.now();
    const isSpeech = rms >= this.config.silenceRmsThreshold;

    if (isSpeech) {
      this.state.lastSpeechTime = now;
      this.state.silenceStartTime = null;

      if (this.state.state === "listening") {
        // Potential speech start — record start time but wait for minSpeechDurationMs
        if (this.state.speechStartTime === 0) {
          this.state.speechStartTime = now;
        }
        const speechDuration = now - this.state.speechStartTime;
        if (speechDuration >= this.config.minSpeechDurationMs) {
          this.setState("speech_detected");
          this.callbacks.onSpeechStart?.();
        }
      }
      // Accumulate speech time while in speech_detected
      if (this.state.state === "speech_detected") {
        this.state.totalSpeechMs = now - this.state.speechStartTime;
      }
    } else {
      // Silence
      if (this.state.state === "speech_detected") {
        if (this.state.silenceStartTime === null) {
          this.state.silenceStartTime = now;
        }
        const silenceDuration = now - this.state.silenceStartTime;
        if (silenceDuration >= this.config.endOfSpeechSilenceMs) {
          // Speech ended — finalize
          const totalSpeech = this.state.totalSpeechMs;
          this.callbacks.onSpeechEnd?.(totalSpeech);
          // Reset for next utterance but stay in listening
          this.state.speechStartTime = 0;
          this.state.silenceStartTime = null;
          this.state.totalSpeechMs = 0;
          this.setState("listening");
        }
      } else if (this.state.state === "listening") {
        // Reset potential speech start if silence breaks the min duration
        if (this.state.speechStartTime > 0) {
          const sinceLastSpeech = now - this.state.lastSpeechTime;
          if (sinceLastSpeech > this.config.minSpeechDurationMs) {
            this.state.speechStartTime = 0;
          }
        }
      }
    }

    this.state.rafId = requestAnimationFrame(this.tick);
  };
}

/**
 * Compute RMS level from an AnalyserNode's time-domain data.
 * Utility function for callers that just want the level without full VAD.
 */
export function computeRmsLevel(analyser: AnalyserNode): number {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const val = (dataArray[i] - 128) / 128;
    sum += val * val;
  }
  return Math.sqrt(sum / dataArray.length);
}
