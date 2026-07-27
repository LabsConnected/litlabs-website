/**
 * OpenAIRealtimeProvider — primary voice provider using OpenAI Realtime API
 * over WebRTC. The browser manages microphone capture and audio playback
 * through the WebRTC peer connection.
 *
 * Flow:
 * 1. Browser requests an ephemeral token from /api/voice/realtime-token
 * 2. Browser creates a WebRTC peer connection to OpenAI
 * 3. Microphone audio flows through the peer connection
 * 4. OpenAI returns transcription + assistant text + audio
 * 5. Transcription and text deltas are routed to the ConversationEngine
 * 6. Audio playback is handled by the WebRTC <audio> element
 *
 * @see https://openai.github.io/openai-agents-js/guides/voice-agents/
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

export class OpenAIRealtimeProvider implements RealtimeVoiceProvider {
  id = "openai-realtime";

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private micStream: MediaStream | null = null;
  private config: VoiceSessionConfig | null = null;

  private transportState: VoiceTransportState = "disconnected";
  private micState: VoiceMicState = "off";
  private runtimeState: VoiceRuntimeState = {
    transport: "disconnected",
    microphone: "off",
    transcription: "idle",
    assistant: "idle",
    playback: "idle",
    handsFree: false,
    ttsEnabled: true,
    selectedLanguage: "en-US",
    selectedVoice: null,
  };

  // Event handler sets
  private transcriptDeltaHandlers = new Set<Handler<TranscriptDelta>>();
  private transcriptCompleteHandlers = new Set<Handler<TranscriptComplete>>();
  private assistantDeltaHandlers = new Set<Handler<AssistantDelta>>();
  private assistantCompleteHandlers = new Set<Handler<AssistantComplete>>();
  private playbackStartedHandlers = new Set<Handler<string>>();
  private playbackCompletedHandlers = new Set<Handler<string>>();
  private transportChangeHandlers = new Set<Handler<VoiceTransportState>>();
  private micChangeHandlers = new Set<Handler<VoiceMicState>>();
  private errorHandlers = new Set<Handler<LiTTError>>();

  // Track the current assistant message ID for streaming
  private currentAssistantMessageId: string | null = null;
  private currentAssistantText = "";

  getCapabilities(): VoiceProviderCapabilities {
    return {
      stt: true,
      tts: true,
      streaming: true,
      interruptions: true,
      handsFree: true,
    };
  }

  getRuntimeState(): VoiceRuntimeState {
    return { ...this.runtimeState };
  }

  async connect(config: VoiceSessionConfig): Promise<void> {
    if (this.transportState === "connected" || this.transportState === "connecting") return;
    this.config = config;
    this.setTransportState("connecting");

    try {
      // 1. Get ephemeral token from our server
      const tokenRes = await fetch("/api/voice/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: config.agentId,
          instructions: config.instructions,
          voice: config.voice,
        }),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        throw new Error(`Token endpoint failed: ${tokenRes.status} ${body}`);
      }
      const { token, model } = await tokenRes.json();

      // 2. Create WebRTC peer connection
      this.pc = new RTCPeerConnection();

      // 3. Set up audio element for remote audio playback
      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      this.audioEl.style.display = "none";
      document.body.appendChild(this.audioEl);

      this.pc.ontrack = (event) => {
        if (this.audioEl) {
          this.audioEl.srcObject = event.streams[0];
          this.runtimeState.playback = "speaking";
        }
      };

      // 4. Set up data channel for events
      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.onmessage = (event) => this.handleDataChannelMessage(event.data);

      // 5. Add microphone track (if available, otherwise add a silent placeholder)
      // The mic is started separately via startMicrophone()
      // but we need a track for the SDP offer
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micStream.getTracks().forEach((track) => {
          track.enabled = false; // Disabled until startMicrophone()
          this.pc?.addTrack(track, this.micStream!);
        });
      } catch {
        // Mic permission denied — connection can still proceed for TTS-only
        this.setMicState("denied");
      }

      // 6. Create and send offer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // 7. Send offer to OpenAI Realtime via REST
      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
      );
      if (!sdpRes.ok) {
        const body = await sdpRes.text();
        throw new Error(`Realtime SDP exchange failed: ${sdpRes.status} ${body}`);
      }
      const answerSdp = await sdpRes.text();
      await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      this.setTransportState("connected");
    } catch (err) {
      this.setTransportState("error");
      const error: LiTTError = {
        code: "CONNECT_FAILED",
        message: err instanceof Error ? err.message : "Connection failed",
        retryable: true,
      };
      this.errorHandlers.forEach((h) => h(error));
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.stopMicrophone();
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
    this.setTransportState("disconnected");
  }

  async startMicrophone(): Promise<void> {
    if (this.micState === "on") return;
    if (!this.micStream) {
      this.setMicState("requesting");
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micStream.getTracks().forEach((track) => {
          track.enabled = true;
          this.pc?.addTrack(track, this.micStream!);
        });
      } catch {
        this.setMicState("denied");
        return;
      }
    } else {
      this.micStream.getTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    this.setMicState("on");
  }

  stopMicrophone(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    this.setMicState("off");
  }

  async interrupt(): Promise<void> {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify({ type: "response.cancel" }));
    }
    this.runtimeState.playback = "idle";
    this.runtimeState.assistant = "idle";
  }

  async setMuted(muted: boolean): Promise<void> {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  /**
   * Speak exact text via the Realtime API's TTS.
   * The text MUST be the canonical assistant message content.
   */
  async speakText(messageId: string, text: string): Promise<void> {
    if (!this.dc || this.dc.readyState !== "open") {
      // If not connected, use browser speechSynthesis as fallback
      this.browserTTS(messageId, text);
      return;
    }

    // Send the text as a conversation item and trigger TTS
    this.currentAssistantMessageId = messageId;
    this.dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
      },
    }));
    this.dc.send(JSON.stringify({
      type: "response.create",
      response: { modalities: ["audio"] },
    }));
    this.runtimeState.playback = "speaking";
    this.playbackStartedHandlers.forEach((h) => h(messageId));
  }

  stopSpeaking(): void {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify({ type: "response.cancel" }));
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.runtimeState.playback = "idle";
  }

  // ─── Event handler registration ───────────────────────────────

  onUserTranscriptDelta(handler: Handler<TranscriptDelta>): Unsubscribe {
    this.transcriptDeltaHandlers.add(handler);
    return () => this.transcriptDeltaHandlers.delete(handler);
  }

  onUserTranscriptComplete(handler: Handler<TranscriptComplete>): Unsubscribe {
    this.transcriptCompleteHandlers.add(handler);
    return () => this.transcriptCompleteHandlers.delete(handler);
  }

  onAssistantTextDelta(handler: Handler<AssistantDelta>): Unsubscribe {
    this.assistantDeltaHandlers.add(handler);
    return () => this.assistantDeltaHandlers.delete(handler);
  }

  onAssistantTextComplete(handler: Handler<AssistantComplete>): Unsubscribe {
    this.assistantCompleteHandlers.add(handler);
    return () => this.assistantCompleteHandlers.delete(handler);
  }

  onPlaybackStarted(handler: Handler<string>): Unsubscribe {
    this.playbackStartedHandlers.add(handler);
    return () => this.playbackStartedHandlers.delete(handler);
  }

  onPlaybackCompleted(handler: Handler<string>): Unsubscribe {
    this.playbackCompletedHandlers.add(handler);
    return () => this.playbackCompletedHandlers.delete(handler);
  }

  onTransportChange(handler: Handler<VoiceTransportState>): Unsubscribe {
    this.transportChangeHandlers.add(handler);
    return () => this.transportChangeHandlers.delete(handler);
  }

  onMicChange(handler: Handler<VoiceMicState>): Unsubscribe {
    this.micChangeHandlers.add(handler);
    return () => this.micChangeHandlers.delete(handler);
  }

  onError(handler: Handler<LiTTError>): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  // ─── Internal helpers ─────────────────────────────────────────

  private setTransportState(state: VoiceTransportState): void {
    this.transportState = state;
    this.runtimeState.transport = state;
    this.transportChangeHandlers.forEach((h) => h(state));
  }

  private setMicState(state: VoiceMicState): void {
    this.micState = state;
    this.runtimeState.microphone = state;
    this.micChangeHandlers.forEach((h) => h(state));
  }

  private handleDataChannelMessage(data: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    const type = event.type as string;

    switch (type) {
      case "conversation.item.input_audio_transcription.completed":
        // User speech transcription completed
        {
          const transcript = (event.transcript as string) || "";
          if (transcript) {
            this.runtimeState.transcription = "idle";
            this.transcriptCompleteHandlers.forEach((h) =>
              h({ text: transcript, messageId: "" }),
            );
          }
        }
        break;

      case "conversation.item.input_audio_transcription.delta":
        // Partial user transcript
        {
          const delta = (event.delta as string) || "";
          if (delta) {
            this.runtimeState.transcription = "partial";
            this.transcriptDeltaHandlers.forEach((h) =>
              h({ text: delta, isFinal: false }),
            );
          }
        }
        break;

      case "response.text.delta":
        // Assistant text streaming
        {
          const delta = (event.delta as string) || "";
          if (delta && this.currentAssistantMessageId) {
            this.runtimeState.assistant = "streaming";
            this.currentAssistantText += delta;
            this.assistantDeltaHandlers.forEach((h) =>
              h({ messageId: this.currentAssistantMessageId!, delta }),
            );
          }
        }
        break;

      case "response.text.done":
        // Assistant text complete
        {
          if (this.currentAssistantMessageId) {
            const msgId = this.currentAssistantMessageId;
            this.runtimeState.assistant = "idle";
            this.assistantCompleteHandlers.forEach((h) =>
              h({
                messageId: msgId,
                content: this.currentAssistantText,
              }),
            );
            this.currentAssistantText = "";
          }
        }
        break;

      case "response.output_audio.delta":
        // Audio chunk — playback handled by WebRTC track
        this.runtimeState.playback = "speaking";
        break;

      case "response.done":
        this.runtimeState.playback = "idle";
        if (this.currentAssistantMessageId) {
          const msgId = this.currentAssistantMessageId;
          this.playbackCompletedHandlers.forEach((h) => h(msgId));
        }
        break;

      case "error":
        {
          const error: LiTTError = {
            code: "REALTIME_ERROR",
            message: (event.error as { message?: string })?.message || "Realtime error",
            retryable: true,
          };
          this.errorHandlers.forEach((h) => h(error));
        }
        break;
    }
  }

  /** Browser speechSynthesis fallback for TTS when not connected. */
  private browserTTS(messageId: string, text: string): void {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.runtimeState.selectedLanguage;
    utterance.onstart = () => {
      this.runtimeState.playback = "speaking";
      this.playbackStartedHandlers.forEach((h) => h(messageId));
    };
    utterance.onend = () => {
      this.runtimeState.playback = "idle";
      this.playbackCompletedHandlers.forEach((h) => h(messageId));
    };
    window.speechSynthesis.speak(utterance);
  }
}
