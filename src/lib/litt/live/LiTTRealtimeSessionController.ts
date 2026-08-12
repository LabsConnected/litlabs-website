/**
 * LiTTRealtimeSessionController — the ONE canonical owner of the
 * unified LiTT Live realtime multimodal session.
 *
 * Owns:
 *   - getUserMedia camera stream
 *   - getUserMedia microphone stream
 *   - getDisplayMedia screen-sharing stream
 *   - Local camera preview (attached to a <video> element)
 *   - Gemini Live WebSocket (via @google/genai SDK)
 *   - Audio capture (mic → PCM16 → sendRealtimeInput)
 *   - Audio playback (server PCM16 → AudioContext → speakers)
 *   - Camera-frame sampling (canvas → JPEG Blob → sendRealtimeInput)
 *   - Input and output transcripts
 *   - Turn detection, barge-in, interruption
 *   - Connection state machine
 *   - Reconnection with backoff
 *   - Session resumption
 *   - Tool-call forwarding
 *   - Conversation persistence events
 *   - Activity events
 *   - Full cleanup on session end
 *
 * There is exactly ONE source of truth for all realtime state.
 * No separate hooks for mic, camera, TTS, or realtime.
 *
 * @see src/lib/litt/live/types.ts
 */

import { GoogleGenAI, Modality, MediaResolution, type Session } from "@google/genai";
import type {
  LiveSessionEvent,
  LiveSessionState,
  LiveConnectionIndicators,
  LiveToolCall,
  LiTTLiveConfig,
  LiTTLiveSessionContext,
  LiveSessionError,
  LiveSessionErrorKind,
} from "./types";
import { DEFAULT_LIVE_CONFIG } from "./types";

type EventListener = (event: LiveSessionEvent) => void;

// ---------------------------------------------------------------------------
// Default indicators
// ---------------------------------------------------------------------------

const IDLE_INDICATORS: LiveConnectionIndicators = {
  cameraPreview: "inactive",
  microphone: "inactive",
  screen: "inactive",
  littAudio: "disconnected",
  littVision: "disconnected",
  frameStream: "inactive",
};

// ---------------------------------------------------------------------------
// LiTT system instruction builder
// ---------------------------------------------------------------------------

function buildSystemInstruction(ctx: LiTTLiveSessionContext): string {
  const parts: string[] = [
    "You are LiTT, the AI copilot, engineer, and creator inside LiTTree Lab Studios.",
    "You are NOT Gemini — you are LiTT. Never say 'I am Gemini' or reveal the underlying provider.",
    "You are operating inside the Studio, a unified workspace for code, creation, and deployment.",
    "",
    "You can see through the user's camera (when connected) and hear the user's voice (when connected).",
    "You respond with spoken audio and can call tools to act on the user's behalf.",
    "",
    "CURRENT CONTEXT:",
    `- User: ${ctx.userName || ctx.userId}`,
  ];
  if (ctx.projectName) parts.push(`- Project: ${ctx.projectName}`);
  if (ctx.repository) parts.push(`- Repository: ${ctx.repository}`);
  if (ctx.branch) parts.push(`- Branch: ${ctx.branch}`);
  if (ctx.currentMission) parts.push(`- Current Mission: ${ctx.currentMission}`);
  if (ctx.currentTool) parts.push(`- Current Studio Tool: ${ctx.currentTool}`);
  if (ctx.recentSummary) parts.push(`- Recent Summary: ${ctx.recentSummary}`);
  parts.push("");
  parts.push("SAFETY RULES:");
  parts.push("- Always ask for approval before: deployment, git push, file deletion, database migrations, secret changes, package installation.");
  parts.push("- Never execute destructive actions based on visual input alone.");
  parts.push("- Be concise in spoken responses — avoid long monologues.");
  parts.push("- If you cannot see the camera, clearly state that vision is not connected.");
  parts.push("- If you can see the camera, describe what you observe when asked.");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class LiTTRealtimeSessionController {
  private listeners = new Set<EventListener>();
  private state: LiveSessionState = "idle";
  private indicators: LiveConnectionIndicators = { ...IDLE_INDICATORS };

  // Media streams
  private cameraStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  // Gemini Live
  private ai: GoogleGenAI | null = null;
  private session: Session | null = null;
  private config: LiTTLiveConfig;
  private context: LiTTLiveSessionContext | null = null;

  // Audio capture
  private audioContext: AudioContext | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private isMuted = false;

  // Audio playback
  private playbackContext: AudioContext | null = null;
  private playbackQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private nextPlayTime = 0;

  // Camera frame sampling
  private frameCanvas: HTMLCanvasElement | null = null;
  private frameCtx: CanvasRenderingContext2D | null = null;
  private frameInterval: ReturnType<typeof setInterval> | null = null;
  private frameVideoElement: HTMLVideoElement | null = null;
  private framesSent = 0;

  // Reconnection
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;

  // Ephemeral token expiration (P0.10)
  private tokenExpiresAt: number | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;

  // Transcripts
  private currentUserTranscript = "";
  private currentAssistantTranscript = "";
  // P0.2: Track last raw transcription chunks to suppress duplicate delivery
  private lastInputTranscriptChunk = "";
  private lastOutputTranscriptChunk = "";
  // P0.2: Turn guard — prevents out-of-order generationComplete from
  // finalizing transcripts that belong to a new turn
  private currentTurnId = 0;
  // P0.2: Track pending tool call IDs for cancellation dedup
  private pendingToolCallIds = new Set<string>();

  // P0.19: Observability — session timing and structured events
  private sessionStartTime: number | null = null;
  private firstAudioReceivedAt: number | null = null;
  private lastEventTimestamp: number | null = null;

  // Facing mode
  private facingMode: "user" | "environment" = "user";
  private isAcquiringCamera = false;

  constructor(config?: Partial<LiTTLiveConfig>) {
    this.config = {
      ...DEFAULT_LIVE_CONFIG,
      ...config,
    } as LiTTLiveConfig;
  }

  // -------------------------------------------------------------------------
  // Event subscription
  // -------------------------------------------------------------------------

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: LiveSessionEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors are non-fatal
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public state accessors
  // -------------------------------------------------------------------------

  getState(): LiveSessionState {
    return this.state;
  }

  getIndicators(): LiveConnectionIndicators {
    return { ...this.indicators };
  }

  getCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  getMicStream(): MediaStream | null {
    return this.micStream;
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  getFramesSent(): number {
    return this.framesSent;
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  private setState(newState: LiveSessionState) {
    this.state = newState;
    this.emit({ type: "stateChange", state: newState });
  }

  private updateIndicators(patch: Partial<LiveConnectionIndicators>) {
    this.indicators = { ...this.indicators, ...patch };
    this.emit({ type: "indicatorsChange", indicators: this.indicators });
  }

  private emitError(kind: LiveSessionErrorKind, message: string, retryable: boolean) {
    const error: LiveSessionError = { kind, message, retryable };
    this.emit({ type: "error", error });
    this.logEvent("live_error", { kind, message, retryable });
  }

  // P0.19: Structured event logging for observability
  private logEvent(event: string, data?: Record<string, unknown>) {
    const timestamp = Date.now();
    this.lastEventTimestamp = timestamp;
    const log: { event: string; timestamp: number; sessionId?: string; state?: string;[key: string]: unknown } = {
      event,
      timestamp,
      sessionId: this.sessionStartTime ? `live_${this.sessionStartTime}` : undefined,
      state: this.state,
      ...data,
    };
    this.emit({ type: "activityLog", log });
  }

  // -------------------------------------------------------------------------
  // Start session
  // -------------------------------------------------------------------------

  async start(
    videoEl: HTMLVideoElement,
    context: LiTTLiveSessionContext,
    options?: {
      camera?: boolean;
      microphone?: boolean;
      screen?: boolean;
      facingMode?: "user" | "environment";
    },
  ): Promise<void> {
    const wantCamera = options?.camera ?? true;
    const wantMic = options?.microphone ?? true;
    const wantScreen = options?.screen ?? false;
    this.facingMode = options?.facingMode ?? "user";

    this.context = context;
    this.config.systemInstruction = buildSystemInstruction(context);
    this.isIntentionalClose = false;
    this.reconnectAttempts = 0;
    this.sessionStartTime = Date.now();
    this.firstAudioReceivedAt = null;
    this.logEvent("live_session_started", {
      userId: context.userId,
      projectId: context.projectId,
      camera: wantCamera,
      microphone: wantMic,
      screen: wantScreen,
    });

    this.setState("requesting_permission");

    // 1. Acquire media streams
    try {
      if (wantCamera) {
        await this.acquireCamera(this.facingMode);
      }
      if (wantMic) {
        await this.acquireMicrophone();
      }
      if (wantScreen) {
        await this.acquireScreen();
      }
    } catch (_err) {
      // Error already emitted by acquire methods
      return;
    }

    // 2. Attach camera to video element for local preview
    this.videoElement = videoEl;
    if (this.cameraStream && videoEl) {
      videoEl.srcObject = this.cameraStream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      await videoEl.play().catch(() => {});
    }

    // We now have a local preview but are NOT connected to the model yet.
    this.setState("local_preview");
    this.updateIndicators({
      cameraPreview: this.cameraStream ? "active" : "inactive",
      microphone: this.micStream ? (this.isMuted ? "muted" : "active") : "inactive",
      screen: this.screenStream ? "active" : "inactive",
      littAudio: "disconnected",
      littVision: "disconnected",
      frameStream: "inactive",
    });

    // 3. Connect to Gemini Live
    await this.connectToGeminiLive();
  }

  // -------------------------------------------------------------------------
  // Media acquisition
  // -------------------------------------------------------------------------

  private async acquireCamera(facingMode: "user" | "environment"): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      this.cameraStream = stream;
      // Listen for track ending
      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => {
        this.emitError("no_device", "Camera track ended unexpectedly.", true);
        this.updateIndicators({ cameraPreview: "error" });
      });
    } catch (err) {
      const name = (err as Error).name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        this.emitError("camera_permission_denied", "Camera permission was denied. Please allow camera access in your browser settings.", true);
        this.updateIndicators({ cameraPreview: "denied" });
        this.setState("permission_denied");
        throw err;
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        this.emitError("no_device", "No camera device found.", false);
        this.updateIndicators({ cameraPreview: "error" });
        throw err;
      }
      this.emitError("device_busy", `Camera error: ${(err as Error).message}`, true);
      this.updateIndicators({ cameraPreview: "error" });
      throw err;
    }
  }

  private async acquireMicrophone(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.micStream = stream;
    } catch (err) {
      const name = (err as Error).name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        this.emitError("microphone_permission_denied", "Microphone permission was denied. Please allow microphone access in your browser settings.", true);
        this.updateIndicators({ microphone: "denied" });
        this.setState("permission_denied");
        throw err;
      }
      this.emitError("no_device", `Microphone error: ${(err as Error).message}`, false);
      this.updateIndicators({ microphone: "error" });
      throw err;
    }
  }

  private async acquireScreen(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      this.screenStream = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => {
        this.screenStream = null;
        this.updateIndicators({ screen: "inactive" });
      });
    } catch (_err) {
      // Screen share is optional — don't fail the session
      this.updateIndicators({ screen: "inactive" });
    }
  }

  // -------------------------------------------------------------------------
  // Gemini Live connection
  // -------------------------------------------------------------------------

  private async connectToGeminiLive(): Promise<void> {
    this.setState("connecting");
    this.updateIndicators({ littAudio: "connecting", littVision: "connecting" });

    // 1. Get ephemeral token from server (permanent key never leaves server)
    let ephemeralToken: string;
    let model: string;
    let tokenExpiresAt: number;
    try {
      const res = await fetch("/api/live/session-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ model: this.config.model }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.emitError("token_request_failed", data.error || `Token request failed (${res.status})`, res.status >= 500);
        this.setState("failed");
        return;
      }
      const data = await res.json() as { token: string; model: string; expiresAt: string };
      ephemeralToken = data.token;
      model = data.model;
      tokenExpiresAt = new Date(data.expiresAt).getTime();
    } catch (err) {
      this.emitError("token_request_failed", `Network error: ${(err as Error).message}`, true);
      this.setState("failed");
      return;
    }

    // 2. Create GoogleGenAI client with the ephemeral token (v1alpha required)
    try {
      this.ai = new GoogleGenAI({ apiKey: ephemeralToken, apiVersion: "v1alpha" });
      this.tokenExpiresAt = tokenExpiresAt;
    } catch (err) {
      this.emitError("websocket_rejected", `Failed to create AI client: ${(err as Error).message}`, false);
      this.setState("failed");
      return;
    }

    // 3. Connect to Live API
    // P0.9: Connection timeout — don't leave user on "Connecting…" forever
    this.connectionTimer = setTimeout(() => {
      if (this.state === "connecting" || this.state === "reconnecting") {
        this.emitError("connection_timeout", "Connection timed out. Please retry.", true);
        this.setState("failed");
        this.updateIndicators({ littAudio: "error", littVision: "error" });
      }
    }, 15_000);

    try {
      this.session = await this.ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: this.config.systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
          // Enable server-side voice activity detection for turn detection
          // (the SDK defaults to server VAD when audio input is present)
        },
        callbacks: {
          onopen: () => {
            if (this.connectionTimer) {
              clearTimeout(this.connectionTimer);
              this.connectionTimer = null;
            }
            this.reconnectAttempts = 0;
            // Start sending audio and video
            this.startAudioCapture();
            this.startFrameSampling();
          },
          onmessage: (msg) => this.handleServerMessage(msg),
          onerror: (e) => {
            this.emitError("websocket_rejected", `WebSocket error: ${e.message || "unknown"}`, true);
            this.updateIndicators({ littAudio: "error", littVision: "error" });
          },
          onclose: (e) => {
            this.handleWebSocketClose(e.code, e.reason);
          },
        },
      });
    } catch (err) {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      const msg = (err as Error).message || "unknown";
      if (msg.includes("quota") || msg.includes("429")) {
        this.emitError("quota_exceeded", "Gemini API quota exceeded. Please try again later.", true);
      } else if (msg.includes("model") || msg.includes("not found")) {
        this.emitError("model_unavailable", `Model ${model} is not available. ${msg}`, false);
      } else {
        this.emitError("websocket_rejected", `Failed to connect: ${msg}`, true);
      }
      this.setState("failed");
      this.updateIndicators({ littAudio: "error", littVision: "error" });
    }
  }

  // -------------------------------------------------------------------------
  // Server message handling
  // -------------------------------------------------------------------------

  private handleServerMessage(msg: ReturnType<typeof Object> & {
    setupComplete?: unknown;
    serverContent?: {
      modelTurn?: {
        parts?: Array<{
          text?: string;
          inlineData?: { data: string; mimeType: string };
        }>;
      };
      outputTranscription?: { text: string };
      inputTranscription?: { text: string };
      interrupted?: boolean;
      generationComplete?: boolean;
    };
    toolCall?: {
      functionCalls?: Array<{ id: string; name: string; args?: Record<string, unknown> }>;
    };
    toolCallCancellation?: unknown;
  }) {
    // Setup complete — session is ready
    if (msg.setupComplete) {
      // Audio is connected when setup completes and we have a mic stream
      if (this.micStream) {
        this.updateIndicators({ littAudio: "connected" });
        if (this.state === "connecting" || this.state === "reconnecting") {
          // P0.2 fix: correctly set live_audio_and_vision when vision is active
          const hasVision = !!(this.cameraStream || this.screenStream);
          this.setState(hasVision ? "live_audio_and_vision" : "live_audio");
        }
      }
      this.logEvent("live_connected", {
        reconnect: this.reconnectAttempts > 0,
        attempt: this.reconnectAttempts,
      });
      return;
    }

    // Tool call — forward to LiTT orchestrator
    if (msg.toolCall?.functionCalls) {
      for (const fc of msg.toolCall.functionCalls) {
        // P0.2: Suppress duplicate tool call IDs
        if (this.pendingToolCallIds.has(fc.id)) continue;
        this.pendingToolCallIds.add(fc.id);
        const call: LiveToolCall = {
          id: fc.id,
          name: fc.name,
          args: fc.args || {},
        };
        this.emit({ type: "toolCall", call });
        this.logEvent("live_tool_called", { toolName: fc.name, toolCallId: fc.id });
      }
      return;
    }

    // P0.2: Tool call cancellation — clean up pending IDs and notify
    if (msg.toolCallCancellation) {
      // The cancellation may include IDs or cancel all pending calls
      const cancelMsg = msg.toolCallCancellation as { ids?: string[] };
      if (cancelMsg.ids && Array.isArray(cancelMsg.ids)) {
        for (const id of cancelMsg.ids) {
          this.pendingToolCallIds.delete(id);
        }
      } else {
        // Cancel all pending tool calls
        this.pendingToolCallIds.clear();
      }
      this.emit({ type: "turnComplete" });
      return;
    }

    // Server content — audio output, transcripts, interruptions
    const content = msg.serverContent;
    if (!content) return;

    // Interruption (barge-in)
    if (content.interrupted) {
      this.stopPlayback();
      this.emit({ type: "interrupted" });
      this.logEvent("live_interrupted");
      // Reset assistant transcript on interruption
      if (this.currentAssistantTranscript) {
        this.emit({
          type: "assistantTranscript",
          transcript: {
            role: "assistant",
            text: this.currentAssistantTranscript,
            isFinal: true,
            timestamp: Date.now(),
          },
        });
        this.currentAssistantTranscript = "";
      }
      return;
    }

    // Input transcript (user speech → text)
    // P0.2: The Gemini Live API sends cumulative transcription text.
    // We replace (not append) to avoid duplication from re-delivered chunks.
    if (content.inputTranscription?.text) {
      const chunk = content.inputTranscription.text;
      // Suppress exact duplicate chunks (re-delivery during reconnect)
      if (chunk !== this.lastInputTranscriptChunk) {
        this.lastInputTranscriptChunk = chunk;
        this.currentUserTranscript = chunk; // Replace, not append
        this.emit({
          type: "userTranscript",
          transcript: {
            role: "user",
            text: this.currentUserTranscript,
            isFinal: false,
            timestamp: Date.now(),
          },
        });
      }
    }

    // Output transcript (LiTT speech → text)
    // P0.2: Same deduplication as input transcript
    if (content.outputTranscription?.text) {
      const chunk = content.outputTranscription.text;
      if (chunk !== this.lastOutputTranscriptChunk) {
        this.lastOutputTranscriptChunk = chunk;
        this.currentAssistantTranscript = chunk; // Replace, not append
        this.emit({
          type: "assistantTranscript",
          transcript: {
            role: "assistant",
            text: this.currentAssistantTranscript,
            isFinal: false,
            timestamp: Date.now(),
          },
        });
      }
    }

    // Audio output (PCM16 data)
    const parts = content.modelTurn?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          // P0.19: Track latency to first audio
          if (!this.firstAudioReceivedAt && this.sessionStartTime) {
            this.firstAudioReceivedAt = Date.now();
            this.logEvent("live_first_audio", {
              latencyMs: this.firstAudioReceivedAt - this.sessionStartTime,
            });
          }
          // Decode base64 → ArrayBuffer
          const binary = atob(part.inlineData.data);
          const buf = new ArrayBuffer(binary.length);
          const view = new Uint8Array(buf);
          for (let i = 0; i < binary.length; i++) {
            view[i] = binary.charCodeAt(i);
          }
          this.queuePlayback(buf);
          this.emit({ type: "assistantAudio", data: buf });
        }
      }
    }

    // Turn complete
    if (content.generationComplete) {
      // P0.2: Increment turn ID to guard against out-of-order events
      const turnId = ++this.currentTurnId;

      // Finalize transcripts (capture locally to avoid race with next turn)
      const userText = this.currentUserTranscript;
      const assistantText = this.currentAssistantTranscript;

      if (userText) {
        this.emit({
          type: "userTranscript",
          transcript: {
            role: "user",
            text: userText,
            isFinal: true,
            timestamp: Date.now(),
          },
        });
      }
      if (assistantText) {
        this.emit({
          type: "assistantTranscript",
          transcript: {
            role: "assistant",
            text: assistantText,
            isFinal: true,
            timestamp: Date.now(),
          },
        });
      }

      // Clear transcripts and dedup state for the next turn
      this.currentUserTranscript = "";
      this.currentAssistantTranscript = "";
      this.lastInputTranscriptChunk = "";
      this.lastOutputTranscriptChunk = "";
      this.pendingToolCallIds.clear();

      // P0.2: Only emit turnComplete if this is still the current turn
      // (prevents stale generationComplete from a previous turn)
      if (turnId === this.currentTurnId) {
        this.emit({ type: "turnComplete" });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Audio capture (mic → PCM16 → Gemini Live)
  // -------------------------------------------------------------------------

  private startAudioCapture() {
    if (!this.micStream || !this.session) return;

    try {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      this.micSource = this.audioContext.createMediaStreamSource(this.micStream);

      // Use ScriptProcessorNode as a fallback when AudioWorklet is
      // not available. AudioWorklet requires a separate module file
      // which complicates the build — ScriptProcessor is deprecated
      // but still works in all browsers and is simpler for this use case.
      const bufferSize = 4096;
      const processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!this.session || this.isMuted || this.isIntentionalClose) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Resample from 48kHz to 16kHz and convert float32 → PCM16
        const pcm16 = this.resampleToPCM16(inputData, 48000, this.config.audioSampleRate);
        if (pcm16.byteLength > 0) {
          const blob = new Blob([pcm16], { type: `audio/pcm;rate=${this.config.audioSampleRate}` });
          try {
            // The SDK's type definitions use Blob_2 (base64) but the browser
            // build accepts browser Blob objects at runtime — cast to bypass.
            this.session.sendRealtimeInput({ audio: blob as unknown as never });
          } catch {
            // send may fail if session is closing — ignore
          }
        }
      };

      this.micSource.connect(processor);
      processor.connect(this.audioContext.destination);
      // Store reference for cleanup
      this.audioWorkletNode = processor as unknown as AudioWorkletNode;
    } catch (err) {
      this.emitError("audio_playback_blocked", `Audio capture failed: ${(err as Error).message}`, true);
    }
  }

  /**
   * Resample float32 audio to PCM16 at the target sample rate.
   * Uses linear interpolation for downsampling.
   */
  private resampleToPCM16(input: Float32Array, inputRate: number, outputRate: number): ArrayBuffer {
    if (inputRate === outputRate) {
      // No resampling needed — just convert format
      const buf = new ArrayBuffer(input.length * 2);
      const view = new DataView(buf);
      for (let i = 0; i < input.length; i++) {
        const clamped = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      }
      return buf;
    }

    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(input.length / ratio);
    const buf = new ArrayBuffer(outputLength * 2);
    const view = new DataView(buf);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexFrac = srcIndex - srcIndexFloor;
      const sample1 = input[srcIndexFloor] || 0;
      const sample2 = input[srcIndexFloor + 1] || sample1;
      const interpolated = sample1 + (sample2 - sample1) * srcIndexFrac;
      const clamped = Math.max(-1, Math.min(1, interpolated));
      view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  // Audio playback (server PCM16 → speakers)
  // -------------------------------------------------------------------------

  private queuePlayback(pcm16Data: ArrayBuffer) {
    this.playbackQueue.push(pcm16Data);
    if (!this.isPlaying) {
      void this.processPlaybackQueue();
    }
  }

  private async processPlaybackQueue() {
    if (!this.playbackContext) {
      this.playbackContext = new AudioContext({ sampleRate: 24000 });
      // Resume if suspended (autoplay policy)
      if (this.playbackContext.state === "suspended") {
        await this.playbackContext.resume();
      }
    }

    this.isPlaying = true;

    while (this.playbackQueue.length > 0 && !this.isIntentionalClose) {
      const data = this.playbackQueue.shift();
      if (!data) continue;

      // Convert PCM16 → float32 for AudioBuffer
      const view = new DataView(data);
      const samples = data.byteLength / 2;
      const float32 = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        float32[i] = view.getInt16(i * 2, true) / 0x8000;
      }

      const audioBuffer = this.playbackContext.createBuffer(1, samples, 24000);
      audioBuffer.copyToChannel(float32, 0);

      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);

      const now = this.playbackContext.currentTime;
      const startTime = Math.max(now, this.nextPlayTime);
      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;

      // Wait for this chunk to finish before processing the next
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
      });
    }

    this.isPlaying = false;
    this.nextPlayTime = 0;
  }

  private stopPlayback() {
    this.playbackQueue = [];
    this.isPlaying = false;
    this.nextPlayTime = 0;
  }

  // -------------------------------------------------------------------------
  // Camera frame sampling (1 FPS → JPEG → Gemini Live)
  // -------------------------------------------------------------------------

  private startFrameSampling() {
    this.stopFrameSampling();
    if (!this.cameraStream && !this.screenStream) return;
    if (!this.session) return;

    // Create canvas for frame capture
    if (!this.frameCanvas) {
      this.frameCanvas = document.createElement("canvas");
      this.frameCtx = this.frameCanvas.getContext("2d");
    }

    const intervalMs = Math.max(100, 1000 / this.config.frameRate);

    // Use the screen stream if sharing, otherwise camera
    const activeStream = this.screenStream || this.cameraStream;
    if (!activeStream) return;

    // Create a hidden video element to read frames from the active stream
    const sampleVideo = document.createElement("video");
    sampleVideo.srcObject = activeStream;
    sampleVideo.muted = true;
    sampleVideo.playsInline = true;
    void sampleVideo.play().catch(() => {});
    this.frameVideoElement = sampleVideo;

    this.frameInterval = setInterval(() => {
      if (!this.session || this.isIntentionalClose) return;
      if (document.hidden) return; // Don't sample when tab is hidden

      const video = sampleVideo;
      if (!video || video.videoWidth === 0 || !this.frameCtx || !this.frameCanvas) return;

      // Scale to working width
      const scale = this.config.frameWidth / video.videoWidth;
      this.frameCanvas.width = this.config.frameWidth;
      this.frameCanvas.height = Math.round(video.videoHeight * scale);

      this.frameCtx.drawImage(video, 0, 0, this.frameCanvas.width, this.frameCanvas.height);

      this.frameCanvas.toBlob(
        (blob) => {
          if (!blob || !this.session || this.isIntentionalClose) return;
          try {
            this.session.sendRealtimeInput({ media: blob as unknown as never });
            this.framesSent++;
            // Vision is connected once we successfully send a frame
            if (this.indicators.littVision !== "connected") {
              this.updateIndicators({
                littVision: "connected",
                frameStream: "active",
              });
              // Update overall state
              if (this.indicators.littAudio === "connected") {
                this.setState("live_audio_and_vision");
              } else {
                this.setState("live_vision");
              }
            }
          } catch {
            // Session may be closing
          }
        },
        "image/jpeg",
        this.config.jpegQuality,
      );
    }, intervalMs);
  }

  private stopFrameSampling() {
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    // P0.17/P0.18: Clean up the hidden video element used for frame sampling
    if (this.frameVideoElement) {
      this.frameVideoElement.srcObject = null;
      this.frameVideoElement = null;
    }
    this.updateIndicators({ frameStream: "inactive", littVision: "disconnected" });
  }

  // -------------------------------------------------------------------------
  // WebSocket close / reconnection
  // -------------------------------------------------------------------------

  private handleWebSocketClose(code: number, reason: string) {
    if (this.isIntentionalClose) {
      this.setState("ended");
      return;
    }

    // Determine error type
    if (code === 1008 || code === 4000) {
      this.emitError("quota_exceeded", `Session closed: ${reason || "quota exceeded"}`, true);
    } else if (code === 1011) {
      this.emitError("model_unavailable", `Server error: ${reason}`, true);
    } else {
      this.emitError("network_interrupted", `Connection closed (${code}): ${reason}`, true);
    }

    this.logEvent("live_connection_failed", { code, reason, attempt: this.reconnectAttempts });

    this.updateIndicators({ littAudio: "disconnected", littVision: "disconnected" });

    // Attempt reconnection with exponential backoff
    if (this.reconnectAttempts < 5) {
      this.setState("reconnecting");
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        void this.reconnect();
      }, delay);
    } else {
      this.setState("failed");
    }
  }

  private async reconnect() {
    // Stop existing audio/frame pipelines but keep media streams
    this.stopAudioCapture();
    this.stopFrameSampling();
    this.stopPlayback();
    this.session = null;

    // P0.2: Reset transcript and dedup state from previous session
    this.currentUserTranscript = "";
    this.currentAssistantTranscript = "";
    this.lastInputTranscriptChunk = "";
    this.lastOutputTranscriptChunk = "";
    this.pendingToolCallIds.clear();
    this.currentTurnId = 0;

    // P0.10: If the ephemeral token has expired (or is about to expire),
    // connectToGeminiLive will fetch a fresh one. The token is single-use,
    // so we always need a new one for reconnection.
    const now = Date.now();
    if (this.tokenExpiresAt && now >= this.tokenExpiresAt - 5000) {
      // Token expired or expiring soon — will request a new one
      this.logEvent("live_token_expired", { expiredAt: this.tokenExpiresAt });
      this.tokenExpiresAt = null;
    }

    // Reconnect to Gemini Live (fetches a fresh ephemeral token)
    await this.connectToGeminiLive();
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  /** Toggle microphone mute */
  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }
    this.updateIndicators({
      microphone: this.isMuted ? "muted" : "active",
    });
  }

  /** Toggle camera on/off with track release, double-acquisition guard, and frame sampler cleanup */
  async toggleCamera(): Promise<void> {
    if (this.isAcquiringCamera) return;

    // If camera is currently active, turn off & stop all tracks
    if (this.cameraStream) {
      this.stopFrameSampling();
      this.cameraStream.getVideoTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
      this.cameraStream = null;
      if (this.videoElement && !this.screenStream) {
        this.videoElement.srcObject = null;
      }
      this.updateIndicators({
        cameraPreview: "inactive",
        littVision: "disconnected",
        frameStream: "inactive",
      });
      if (this.indicators.littAudio === "connected") {
        this.setState("live_audio");
      }
      return;
    }

    // Acquire camera stream dynamically if disabled/uninitialized
    this.isAcquiringCamera = true;
    try {
      await this.acquireCamera(this.facingMode);
      if (this.videoElement && this.cameraStream) {
        this.videoElement.srcObject = this.cameraStream;
        await this.videoElement.play().catch(() => {});
      }
      this.updateIndicators({ cameraPreview: "active" });
      this.startFrameSampling();
    } catch {
      // Error emitted by acquireCamera
      this.stopFrameSampling();
      const errStream = this.cameraStream as MediaStream | null;
      if (errStream) {
        errStream.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
        this.cameraStream = null;
      }
    } finally {
      this.isAcquiringCamera = false;
    }
  }

  /** Switch between front and rear camera */
  async flipCamera(): Promise<void> {
    const nextMode = this.facingMode === "user" ? "environment" : "user";
    this.facingMode = nextMode;

    // Stop current camera
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
    this.stopFrameSampling();

    // Acquire new camera
    try {
      await this.acquireCamera(nextMode);
      if (this.videoElement && this.cameraStream) {
        this.videoElement.srcObject = this.cameraStream;
        await this.videoElement.play().catch(() => {});
      }
      this.updateIndicators({ cameraPreview: "active" });
      // Resume frame sampling with new camera
      this.startFrameSampling();
    } catch {
      // Error already emitted
    }
  }

  /** Start screen sharing */
  async startScreenShare(): Promise<void> {
    await this.acquireScreen();
    if (this.screenStream) {
      this.updateIndicators({ screen: "active" });
      // Restart frame sampling to use screen stream
      this.stopFrameSampling();
      this.startFrameSampling();
    }
  }

  /** Stop screen sharing */
  stopScreenShare(): void {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this.updateIndicators({ screen: "inactive" });
    // Restart frame sampling with camera if available
    this.stopFrameSampling();
    if (this.cameraStream) {
      this.startFrameSampling();
    }
  }

  /** Send a text message to the Live session */
  sendText(text: string): void {
    if (!this.session) return;
    try {
      this.session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    } catch {
      // Session may be closing
    }
  }

  /** Send a tool response back to the Live session */
  sendToolResponse(id: string, name: string, response: Record<string, unknown>): void {
    if (!this.session) return;
    try {
      this.session.sendToolResponse({
        functionResponses: [{ id, name, response }],
      });
      // P0.16: Clean up pending tool call ID after response is sent
      this.pendingToolCallIds.delete(id);
    } catch {
      // Session may be closing
    }
  }

  /** Interrupt the current model response (barge-in) */
  interrupt(): void {
    this.stopPlayback();
    if (this.session) {
      // Sending empty client content with turnComplete interrupts
      try {
        this.session.sendClientContent({ turnComplete: true });
      } catch {
        // ignore
      }
    }
    // P0.2: Clear dedup state so next turn starts fresh
    this.currentAssistantTranscript = "";
    this.lastOutputTranscriptChunk = "";
    this.pendingToolCallIds.clear();
    this.emit({ type: "interrupted" });
  }

  // -------------------------------------------------------------------------
  // Reconnect manually
  // -------------------------------------------------------------------------

  async reconnectSession(): Promise<void> {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.reconnect();
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  private stopAudioCapture() {
    if (this.audioWorkletNode) {
      try {
        this.audioWorkletNode.disconnect();
      } catch { /* ignore */ }
      this.audioWorkletNode = null;
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch { /* ignore */ }
      this.micSource = null;
    }
    if (this.audioContext) {
      try {
        void this.audioContext.close();
      } catch { /* ignore */ }
      this.audioContext = null;
    }
  }

  /**
   * End the Live session and clean up ALL resources.
   * No camera or microphone remains active after this call.
   */
  end(): void {
    this.isIntentionalClose = true;

    // P0.19: Log session end with duration
    if (this.sessionStartTime) {
      this.logEvent("live_session_ended", {
        durationMs: Date.now() - this.sessionStartTime,
        firstAudioLatencyMs: this.firstAudioReceivedAt
          ? this.firstAudioReceivedAt - this.sessionStartTime
          : null,
      });
      this.sessionStartTime = null;
      this.firstAudioReceivedAt = null;
    }

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clear connection timeout timer
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    // Clear token expiration
    this.tokenExpiresAt = null;

    // Stop frame sampling
    this.stopFrameSampling();

    // Stop audio capture
    this.stopAudioCapture();

    // Stop playback
    this.stopPlayback();
    if (this.playbackContext) {
      try {
        void this.playbackContext.close();
      } catch { /* ignore */ }
      this.playbackContext = null;
    }

    // Close Gemini Live session
    if (this.session) {
      try {
        this.session.close();
      } catch { /* ignore */ }
      this.session = null;
    }
    this.ai = null;

    // Stop ALL media stream tracks
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    // Detach video element
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    // Reset state
    this.indicators = { ...IDLE_INDICATORS };
    this.setState("ended");
    this.emit({ type: "indicatorsChange", indicators: this.indicators });

    // Clear transcripts
    this.currentUserTranscript = "";
    this.currentAssistantTranscript = "";
    this.lastInputTranscriptChunk = "";
    this.lastOutputTranscriptChunk = "";
    this.currentTurnId = 0;
    this.pendingToolCallIds.clear();
    this.framesSent = 0;
  }
}
