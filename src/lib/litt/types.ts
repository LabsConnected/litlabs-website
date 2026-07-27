/**
 * LiTT Canonical Types — Ultra Handbook v11.0
 *
 * One source of truth for conversation messages, events, capabilities,
 * and voice provider interfaces. Every Studio surface subscribes to
 * the same event stream and uses the same message schema.
 *
 * @see docs/litt/00-constitution/north-star.md
 */

// ─── Canonical Chat Message ─────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "pending" | "streaming" | "complete" | "failed" | "cancelled";
export type InputMode = "text" | "voice" | "tool";

export interface MessageError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  inputMode: InputMode;
  parentMessageId?: string;
  providerRunId?: string;
  missionId?: string;
  canvasBlockId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: MessageError;
}

// ─── Canvas Block ───────────────────────────────────────────────

export type CanvasBlockType =
  | "transcript_turn"
  | "plan"
  | "task"
  | "decision"
  | "research"
  | "code"
  | "file"
  | "image"
  | "audio"
  | "video"
  | "preview"
  | "report"
  | "deployment";

export type BlockStatus = "streaming" | "complete" | "failed";

export interface CanvasBlock {
  id: string;
  canvasId: string;
  type: CanvasBlockType;
  messageId?: string;
  speaker?: "user" | "litt" | "spark";
  content: string;
  status: BlockStatus;
  inputMode?: InputMode;
  revision: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// ─── Typed Event Bus ────────────────────────────────────────────

export interface LiTTError {
  code: string;
  message: string;
  retryable: boolean;
}

export type LiTTEvent =
  | { type: "conversation.created"; conversationId: string }
  | { type: "message.user.created"; message: ChatMessage }
  | { type: "message.assistant.started"; message: ChatMessage }
  | { type: "message.assistant.delta"; messageId: string; delta: string }
  | { type: "message.assistant.completed"; message: ChatMessage }
  | { type: "message.failed"; messageId: string; error: LiTTError }

  | { type: "canvas.block.created"; block: CanvasBlock }
  | { type: "canvas.block.updated"; blockId: string; patch: Partial<CanvasBlock> }
  | { type: "canvas.block.finalized"; blockId: string }

  | { type: "voice.transport.connecting" }
  | { type: "voice.transport.connected" }
  | { type: "voice.transport.disconnected" }
  | { type: "voice.transport.error"; error: LiTTError }

  | { type: "voice.mic.started" }
  | { type: "voice.mic.stopped" }
  | { type: "voice.mic.denied" }

  | { type: "voice.user_transcript.delta"; text: string }
  | { type: "voice.user_transcript.completed"; text: string }

  | { type: "voice.playback.started"; messageId: string }
  | { type: "voice.playback.completed"; messageId: string }
  | { type: "voice.playback.interrupted"; messageId: string }

  | { type: "tool.started"; executionId: string; toolId: string }
  | { type: "tool.progress"; executionId: string; progress: unknown }
  | { type: "tool.completed"; executionId: string; result: unknown }
  | { type: "tool.failed"; executionId: string; error: LiTTError };

// ─── Capability Registry ────────────────────────────────────────

export type CapabilityState =
  | "ready"
  | "offline"
  | "connecting"
  | "limited"
  | "requires_approval"
  | "degraded"
  | "unavailable"
  | "unknown";

export interface CapabilityRecord {
  id: string;
  state: CapabilityState;
  verifiedAt: number;
  reason?: string;
  provider?: string;
  permissions: string[];
  dependencies: string[];
  costClass?: "free" | "low" | "medium" | "high";
}

// ─── Voice Provider Interfaces ──────────────────────────────────

export type VoiceTransportState = "disconnected" | "connecting" | "connected" | "error";
export type VoiceMicState = "off" | "requesting" | "on" | "denied" | "error";
export type VoiceTranscriptionState = "idle" | "partial" | "finalizing" | "error";
export type VoiceAssistantState = "idle" | "thinking" | "streaming" | "error";
export type VoicePlaybackState = "idle" | "buffering" | "speaking" | "error";

export interface VoiceRuntimeState {
  transport: VoiceTransportState;
  microphone: VoiceMicState;
  transcription: VoiceTranscriptionState;
  assistant: VoiceAssistantState;
  playback: VoicePlaybackState;
  handsFree: boolean;
  ttsEnabled: boolean;
  selectedLanguage: string;
  selectedVoice: string | null;
}

export interface VoiceSessionConfig {
  agentId: string;
  instructions: string;
  voice?: string;
  language?: string;
  model?: string;
}

export interface VoiceProviderCapabilities {
  stt: boolean;
  tts: boolean;
  streaming: boolean;
  interruptions: boolean;
  handsFree: boolean;
}

export interface TranscriptDelta {
  text: string;
  isFinal: boolean;
}

export interface TranscriptComplete {
  text: string;
  messageId: string;
}

export interface AssistantDelta {
  messageId: string;
  delta: string;
}

export interface AssistantComplete {
  messageId: string;
  content: string;
}

export type Unsubscribe = () => void;

/**
 * RealtimeVoiceProvider — the provider-agnostic voice interface.
 * Adapters: OpenAIRealtimeProvider, InworldRealtimeProvider,
 * BrowserSpeechFallback, TextOnlyFallback.
 */
export interface RealtimeVoiceProvider {
  id: string;

  connect(config: VoiceSessionConfig): Promise<void>;
  disconnect(): Promise<void>;

  startMicrophone(): Promise<void>;
  stopMicrophone(): void;

  interrupt(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;

  /**
   * Speak exact text via TTS. The text MUST be the canonical assistant
   * message content — never a separately generated response.
   */
  speakText(messageId: string, text: string): Promise<void>;
  stopSpeaking(): void;

  onUserTranscriptDelta(handler: (event: TranscriptDelta) => void): Unsubscribe;
  onUserTranscriptComplete(handler: (event: TranscriptComplete) => void): Unsubscribe;
  onAssistantTextDelta(handler: (event: AssistantDelta) => void): Unsubscribe;
  onAssistantTextComplete(handler: (event: AssistantComplete) => void): Unsubscribe;
  onPlaybackStarted(handler: (messageId: string) => void): Unsubscribe;
  onPlaybackCompleted(handler: (messageId: string) => void): Unsubscribe;
  onTransportChange(handler: (state: VoiceTransportState) => void): Unsubscribe;
  onMicChange(handler: (state: VoiceMicState) => void): Unsubscribe;
  onError(handler: (error: LiTTError) => void): Unsubscribe;

  getCapabilities(): VoiceProviderCapabilities;
  getRuntimeState(): VoiceRuntimeState;
}

// ─── Intent Router ──────────────────────────────────────────────

export type LiTTMode =
  | "think"
  | "research"
  | "create"
  | "build"
  | "review"
  | "ship"
  | "status"
  | "learn";

export type LiTTRisk =
  | "informational"
  | "privacy"
  | "financial"
  | "security"
  | "destructive"
  | "public"
  | "medical"
  | "legal";

export interface LiTTControlDecision {
  requestId: string;
  mode: LiTTMode;
  requiresProject: boolean;
  requiresCurrentInformation: boolean;
  requiresExecution: boolean;
  requiresPrivateData: boolean;
  skillIds: string[];
  capabilityIds: string[];
  toolIds: string[];
  modelProfileId: string;
  risk: LiTTRisk;
  approvalRequired: boolean;
}
