export type VoiceAgentId =
  | "litt"
  | "spark"
  | "researcher"
  | "writer"
  | "marketer"
  | "coder"
  | "analyst";

export type VoiceSessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

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

export interface VoiceTimingMetrics {
  recordingStartedAt: number | null;
  recordingEndedAt: number | null;
  transcriptionStartedAt: number | null;
  transcriptionCompletedAt: number | null;
  aiResponseStartedAt: number | null;
  aiResponseCompletedAt: number | null;
  ttsStartedAt: number | null;
  ttsFirstByteAt: number | null;
  playbackStartedAt: number | null;
  playbackEndedAt: number | null;
}

export function createInitialTimingMetrics(): VoiceTimingMetrics {
  return {
    recordingStartedAt: null,
    recordingEndedAt: null,
    transcriptionStartedAt: null,
    transcriptionCompletedAt: null,
    aiResponseStartedAt: null,
    aiResponseCompletedAt: null,
    ttsStartedAt: null,
    ttsFirstByteAt: null,
    playbackStartedAt: null,
    playbackEndedAt: null,
  };
}

export interface VoiceDiagnostics {
  timing: VoiceTimingMetrics;
  queueLength: number;
  currentText: string;
  spokenCharCount: number;
  totalCharCount: number;
}

export function computeLatencies(timing: VoiceTimingMetrics): {
  transcriptionMs: number | null;
  aiResponseMs: number | null;
  ttsMs: number | null;
  totalMs: number | null;
  ttsTimeToFirstByteMs: number | null;
} {
  const transcriptionMs = timing.transcriptionStartedAt && timing.transcriptionCompletedAt
    ? timing.transcriptionCompletedAt - timing.transcriptionStartedAt
    : null;
  const aiResponseMs = timing.aiResponseStartedAt && timing.aiResponseCompletedAt
    ? timing.aiResponseCompletedAt - timing.aiResponseStartedAt
    : null;
  const ttsMs = timing.ttsStartedAt && timing.playbackStartedAt
    ? timing.playbackStartedAt - timing.ttsStartedAt
    : null;
  const ttsTimeToFirstByteMs = timing.ttsStartedAt && timing.ttsFirstByteAt
    ? timing.ttsFirstByteAt - timing.ttsStartedAt
    : null;
  const totalMs = timing.recordingStartedAt && timing.playbackStartedAt
    ? timing.playbackStartedAt - timing.recordingStartedAt
    : null;
  return { transcriptionMs, aiResponseMs, ttsMs, totalMs, ttsTimeToFirstByteMs };
}
