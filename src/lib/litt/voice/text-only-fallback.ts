/**
 * TextOnlyFallbackProvider — always available, no voice.
 * Used when no voice provider is connected or mic is denied.
 * Chat remains fully usable.
 */

import type {
  RealtimeVoiceProvider,
  VoiceSessionConfig,
  VoiceProviderCapabilities,
  VoiceRuntimeState,
  VoiceTransportState,
  VoiceMicState,
  TranscriptDelta,
  TranscriptComplete,
  AssistantDelta,
  AssistantComplete,
  Unsubscribe,
  LiTTError,
} from "../types";

type Handler<T> = (event: T) => void;

export class TextOnlyFallbackProvider implements RealtimeVoiceProvider {
  id = "text-only";

  private runtimeState: VoiceRuntimeState = {
    transport: "disconnected",
    microphone: "off",
    transcription: "idle",
    assistant: "idle",
    playback: "idle",
    handsFree: false,
    ttsEnabled: false,
    selectedLanguage: "en-US",
    selectedVoice: null,
  };

  private errorHandlers = new Set<Handler<LiTTError>>();

  getCapabilities(): VoiceProviderCapabilities {
    return { stt: false, tts: false, streaming: false, interruptions: false, handsFree: false };
  }

  getRuntimeState(): VoiceRuntimeState {
    return { ...this.runtimeState };
  }

  async connect(_config: VoiceSessionConfig): Promise<void> {
    // No-op — text only
  }

  async disconnect(): Promise<void> {
    // No-op
  }

  async startMicrophone(): Promise<void> {
    // No-op — text only
  }

  stopMicrophone(): void {
    // No-op
  }

  async interrupt(): Promise<void> {
    // No-op
  }

  async setMuted(_muted: boolean): Promise<void> {
    // No-op
  }

  async speakText(_messageId: string, _text: string): Promise<void> {
    // No-op — no TTS in text-only mode
  }

  stopSpeaking(): void {
    // No-op
  }

  onUserTranscriptDelta(_handler: Handler<TranscriptDelta>): Unsubscribe {
    return () => {};
  }

  onUserTranscriptComplete(_handler: Handler<TranscriptComplete>): Unsubscribe {
    return () => {};
  }

  onAssistantTextDelta(_handler: Handler<AssistantDelta>): Unsubscribe {
    return () => {};
  }

  onAssistantTextComplete(_handler: Handler<AssistantComplete>): Unsubscribe {
    return () => {};
  }

  onPlaybackStarted(_handler: Handler<string>): Unsubscribe {
    return () => {};
  }

  onPlaybackCompleted(_handler: Handler<string>): Unsubscribe {
    return () => {};
  }

  onTransportChange(_handler: Handler<VoiceTransportState>): Unsubscribe {
    return () => {};
  }

  onMicChange(_handler: Handler<VoiceMicState>): Unsubscribe {
    return () => {};
  }

  onError(handler: Handler<LiTTError>): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
}
