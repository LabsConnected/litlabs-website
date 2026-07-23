export type VoiceAgentId = "litt" | "spark";

export type VoiceSessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

export type VoiceProvider = "elevenlabs";

export interface AgentVoiceProfile {
  agentId: VoiceAgentId;
  provider: VoiceProvider;
  providerVoiceId: string;
  speed: number;
  stability: number;
  similarity: number;
  style: number;
  speakerBoost: boolean;
  autoSpeak: boolean;
  allowInterruptions: boolean;
  maxSpokenParagraphs: number;
  muteCodeAndLogs: boolean;
}

export interface VoiceTranscriptEvent {
  type: "transcript";
  text: string;
  final: boolean;
}

export interface VoiceAgentEvent {
  type:
    | "session.ready"
    | "user.started_speaking"
    | "user.stopped_speaking"
    | "agent.thinking"
    | "agent.audio"
    | "agent.finished"
    | "agent.interrupted"
    | "error";
  agentId?: VoiceAgentId;
  audio?: string;
  message?: string;
}

export interface VoiceSessionConfig {
  agentId: VoiceAgentId;
  sampleRate: number;
  autoSpeak: boolean;
  allowInterruptions: boolean;
}

export const DEFAULT_LITT_PROFILE: AgentVoiceProfile = {
  agentId: "litt",
  provider: "elevenlabs",
  providerVoiceId: "",
  speed: 0.92,
  stability: 0.72,
  similarity: 0.82,
  style: 0.22,
  speakerBoost: true,
  autoSpeak: true,
  allowInterruptions: true,
  maxSpokenParagraphs: 3,
  muteCodeAndLogs: true,
};

export const DEFAULT_SPARK_PROFILE: AgentVoiceProfile = {
  agentId: "spark",
  provider: "elevenlabs",
  providerVoiceId: "",
  speed: 1.08,
  stability: 0.40,
  similarity: 0.78,
  style: 0.68,
  speakerBoost: true,
  autoSpeak: true,
  allowInterruptions: true,
  maxSpokenParagraphs: 2,
  muteCodeAndLogs: true,
};

export function getDefaultProfile(agentId: VoiceAgentId): AgentVoiceProfile {
  return agentId === "spark" ? DEFAULT_SPARK_PROFILE : DEFAULT_LITT_PROFILE;
}
