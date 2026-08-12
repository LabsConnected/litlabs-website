/**
 * LiTT Live — Realtime multimodal session types.
 *
 * These types define the state machine, connection indicators, and
 * event payloads for the unified LiTTRealtimeSessionController.
 *
 * @see src/lib/litt/live/LiTTRealtimeSessionController.ts
 */

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * The overall Live session state.
 *
 * Transition flow:
 *   idle → requesting_permission → local_preview → connecting →
 *   live_audio → live_vision → live_audio_and_vision →
 *   reconnecting → live_audio_and_vision
 *   any → degraded / permission_denied / failed / ended
 */
export type LiveSessionState =
  | "idle"
  | "requesting_permission"
  | "local_preview"
  | "connecting"
  | "live_audio"
  | "live_vision"
  | "live_audio_and_vision"
  | "reconnecting"
  | "degraded"
  | "permission_denied"
  | "failed"
  | "ended";

// ---------------------------------------------------------------------------
// Connection indicators (truthful, granular)
// ---------------------------------------------------------------------------

export type DeviceStatus = "inactive" | "active" | "muted" | "denied" | "error";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface LiveConnectionIndicators {
  cameraPreview: DeviceStatus;
  microphone: DeviceStatus;
  screen: DeviceStatus;
  littAudio: ConnectionStatus;
  littVision: ConnectionStatus;
  frameStream: DeviceStatus;
  /** True when the LiTT agent worker (ParticipantKind.AGENT) has joined the room. */
  agentJoined: boolean;
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export interface LiveTranscript {
  /** "user" for input transcript, "assistant" for LiTT output transcript */
  role: "user" | "assistant";
  /** Incremental text — may be updated multiple times per turn */
  text: string;
  /** Whether this turn's transcript is finalized */
  isFinal: boolean;
  /** Timestamp (ms since epoch) */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Tool calls (from Gemini Live → LiTT orchestrator)
// ---------------------------------------------------------------------------

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveToolResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Events emitted by the controller
// ---------------------------------------------------------------------------

export type LiveSessionEvent =
  | { type: "stateChange"; state: LiveSessionState }
  | { type: "indicatorsChange"; indicators: LiveConnectionIndicators }
  | { type: "userTranscript"; transcript: LiveTranscript }
  | { type: "assistantTranscript"; transcript: LiveTranscript }
  | { type: "assistantAudio"; /** PCM16 audio chunk */ data: ArrayBuffer }
  | { type: "toolCall"; call: LiveToolCall }
  | { type: "error"; error: LiveSessionError }
  | { type: "turnComplete" }
  | { type: "interrupted" }
  | { type: "activityLog"; log: { event: string; timestamp: number; sessionId?: string; state?: string;[key: string]: unknown } };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type LiveSessionErrorKind =
  | "camera_permission_denied"
  | "microphone_permission_denied"
  | "no_device"
  | "device_busy"
  | "token_request_failed"
  | "websocket_rejected"
  | "model_unavailable"
  | "quota_exceeded"
  | "session_expired"
  | "realtime_token_expired"
  | "network_interrupted"
  | "audio_playback_blocked"
  | "vision_frames_stopped"
  | "connection_timeout"
  | "unknown";

export interface LiveSessionError {
  kind: LiveSessionErrorKind;
  message: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LiTTLiveConfig {
  /** Gemini Live model ID */
  model: string;
  /** Camera frame rate (frames per second). Default: 1 */
  frameRate: number;
  /** Working width for sampled camera frames. Default: 768 */
  frameWidth: number;
  /** JPEG quality (0-1). Default: 0.7 */
  jpegQuality: number;
  /** Audio sample rate for Gemini Live. Default: 16000 */
  audioSampleRate: number;
  /** Whether to enable input audio transcription */
  inputTranscription: boolean;
  /** Whether to enable output audio transcription */
  outputTranscription: boolean;
  /** System instruction (LiTT identity + context) */
  systemInstruction: string;
  /** LiTT voice name (Gemini speech config) */
  voiceName?: string;
}

/**
 * The canonical Gemini Live model ID.
 *
 * `gemini-live-2.5-flash-preview` was shut down on December 9, 2025.
 * All Live code must reference this constant — never scatter raw model IDs.
 *
 * @see https://ai.google.dev/gemini-api/docs/deprecations
 */
export const LIVE_MODEL_ID = "gemini-3.1-flash-live-preview";

export const DEFAULT_LIVE_CONFIG: Omit<LiTTLiveConfig, "systemInstruction"> = {
  model: LIVE_MODEL_ID,
  frameRate: 1,
  frameWidth: 768,
  jpegQuality: 0.7,
  audioSampleRate: 16000,
  inputTranscription: true,
  outputTranscription: true,
};

// ---------------------------------------------------------------------------
// Session context (seeded into the Live session)
// ---------------------------------------------------------------------------

export interface LiTTLiveSessionContext {
  userId: string;
  userName?: string;
  projectId?: string;
  projectName?: string;
  repository?: string;
  branch?: string;
  currentMission?: string;
  recentSummary?: string;
  currentTool?: string;
  approvedTools?: string[];
  /** Canonical conversation ID — Live continues the same conversation */
  conversationId?: string;
  /** Active agent slug — Live uses the same agent as typed chat */
  agentSlug?: string;
}

// ---------------------------------------------------------------------------
// Live transcript persistence (P0.4 — no double LLM response)
// ---------------------------------------------------------------------------

/**
 * A finalized Live turn pair — user speech + assistant response.
 * Persisted to the canonical conversation WITHOUT invoking another LLM call.
 */
export interface LiveTurnPair {
  userText: string;
  assistantText: string;
  liveTurnId: string;
  liveSessionId?: string;
  timestamp: number;
}
