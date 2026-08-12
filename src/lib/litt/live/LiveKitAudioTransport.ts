/**
 * LiveKitAudioTransport — browser-side LiveKit client that replaces the
 * Gemini Live WebSocket as the realtime audio transport for LiTT.
 *
 * Architecture (hybrid):
 *   Browser → LiveKit room (WebRTC) → LiTT Agent Worker (server-side)
 *   Agent Worker handles STT → LLM → TTS → sends audio back to room
 *   Browser receives assistant audio + data channel events
 *
 * The controller's state machine, vision, tools, and memory stay.
 * Only the audio transport layer changes.
 *
 * Events received via LiveKit data channel (from Agent Worker):
 *   { type: "user_transcript.delta", text }
 *   { type: "user_transcript.completed", text }
 *   { type: "assistant_transcript.delta", text }
 *   { type: "assistant_transcript.completed", text }
 *   { type: "agent.thinking" }
 *   { type: "agent.speaking" }
 *   { type: "agent.idle" }
 *   { type: "tool.call", name, args, callId }
 *   { type: "tool.result", name, callId, result }
 *
 * @see src/lib/litt/live/LiTTRealtimeSessionController.ts
 * @see terminal-server/livekit-agent.ts
 */

import {
  Room,
  RoomEvent,
  Track,
  LocalParticipant,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteTrack,
  Participant,
  ParticipantKind,
  DataPacket_Kind,
  type ConnectionQuality,
} from "livekit-client";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TransportState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type AgentState = "idle" | "thinking" | "speaking";

export interface LiveKitTransportConfig {
  roomName: string;
  agentId?: string;
  instructions?: string;
  voice?: string;
}

export interface LiveKitTransportEvents {
  onStateChange: (state: TransportState) => void;
  onAgentStateChange: (state: AgentState) => void;
  onUserTranscriptDelta: (text: string) => void;
  onUserTranscriptComplete: (text: string) => void;
  onAssistantTranscriptDelta: (text: string) => void;
  onAssistantTranscriptComplete: (text: string) => void;
  onToolCall: (call: { name: string; args: Record<string, unknown>; callId: string }) => void;
  onToolResult: (result: { name: string; callId: string; result: unknown }) => void;
  onError: (error: { code: string; message: string; retryable: boolean }) => void;
  onConnectionQualityChange: (quality: ConnectionQuality) => void;
}

// ─── Transport ──────────────────────────────────────────────────────────────

export class LiveKitAudioTransport {
  private room: Room | null = null;
  private micStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private state: TransportState = "disconnected";
  private agentState: AgentState = "idle";
  private config: LiveKitTransportConfig | null = null;
  private events: Partial<LiveKitTransportEvents> = {};
  private reconnectAttempts = 0;
  private isIntentionalDisconnect = false;

  // ─── Event handler registration ───────────────────────────────────────

  on(events: Partial<LiveKitTransportEvents>): void {
    this.events = { ...this.events, ...events };
  }

  getState(): TransportState {
    return this.state;
  }

  getAgentState(): AgentState {
    return this.agentState;
  }

  // ─── Connection ───────────────────────────────────────────────────────

  async connect(config: LiveKitTransportConfig): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") return;
    this.config = config;
    this.isIntentionalDisconnect = false;
    this.setState("connecting");

    try {
      // 1. Get token from our server
      const tokenRes = await fetch("/api/voice/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          roomName: config.roomName,
          agentId: config.agentId,
          instructions: config.instructions,
          voice: config.voice,
        }),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({}));
        this.emitError("token_request_failed", body.error || `Token request failed (${tokenRes.status})`, tokenRes.status >= 500);
        this.setState("error");
        return;
      }

      const { token, url } = await tokenRes.json() as { token: string; url: string; roomName: string };

      // 2. Create LiveKit room and connect
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });

      this.setupRoomEvents();

      // 3. Connect to the room
      await this.room.connect(url, token, {
        autoSubscribe: true,
      });

      // 4. Publish microphone (the agent worker needs to receive it)
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await this.room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        // Mic permission denied — connection can still proceed for TTS-only
        this.emitError("microphone_permission_denied", "Microphone access denied. Voice input will not work.", false);
      }

      // 5. Set up audio element for remote (agent) audio playback
      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      this.audioEl.style.display = "none";
      document.body.appendChild(this.audioEl);

      this.setState("connected");
      this.reconnectAttempts = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      this.emitError("websocket_rejected", message, true);
      this.setState("error");
    }
  }

  async disconnect(): Promise<void> {
    this.isIntentionalDisconnect = true;
    this.stopMicrophone();

    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }

    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }

    this.setState("disconnected");
  }

  // ─── Microphone ───────────────────────────────────────────────────────

  async startMicrophone(): Promise<void> {
    if (!this.room) return;
    try {
      if (!this.micStream) {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      await this.room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      this.emitError("microphone_permission_denied", "Microphone access denied.", false);
    }
  }

  stopMicrophone(): void {
    if (this.room) {
      this.room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
  }

  setMuted(muted: boolean): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => {
        t.enabled = !muted;
      });
    }
  }

  // ─── Vision (send camera frame to agent via data channel) ─────────────

  async sendVisionFrame(jpegBlob: Blob): Promise<void> {
    if (!this.room) return;
    try {
      const buf = await jpegBlob.arrayBuffer();
      const encoded = new Uint8Array(buf);
      // Send as binary data with a topic prefix so the agent can distinguish
      // vision frames from JSON events
      await this.room.localParticipant.publishData(encoded, {
        reliable: false, // vision frames are lossy — don't block on retransmit
        topic: "litt.vision.frame",
      });
    } catch {
      // non-fatal — frame drops are acceptable
    }
  }

  // ─── Barge-in / interruption ──────────────────────────────────────────

  async interrupt(): Promise<void> {
    if (!this.room) return;
    // Send an interrupt signal to the agent worker
    const payload = new TextEncoder().encode(JSON.stringify({ type: "agent.interrupt" }));
    try {
      await this.room.localParticipant.publishData(payload, {
        reliable: true,
        topic: "litt.control",
      });
    } catch {}
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private setupRoomEvents(): void {
    if (!this.room) return;

    // Remote audio track (agent speaking)
    // Use a loose event handler to avoid generic RemoteTrack<Kind> overload issues
    const roomAny = this.room as unknown as {
      on: (event: string, handler: (...args: unknown[]) => void) => void;
    };
    roomAny.on(RoomEvent.TrackSubscribed, (...args: unknown[]) => {
      const track = args[0] as RemoteTrack;
      if (track && track.kind === Track.Kind.Audio) {
        // attach() returns an HTMLMediaElement with the track already attached
        const mediaEl = (track as { attach: () => HTMLMediaElement }).attach();
        if (this.audioEl) {
          // Use the attached element's srcObject directly
          this.audioEl.srcObject = (mediaEl as HTMLMediaElement).srcObject;
        }
      }
    });

    roomAny.on(RoomEvent.TrackUnsubscribed, (...args: unknown[]) => {
      const track = args[0] as RemoteTrack;
      if (track) {
        (track as { detach: () => void }).detach();
      }
    });

    // Data channel messages (transcripts, state, tool calls)
    this.room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, kind?: DataPacket_Kind, topic?: string) => {
      if (topic === "litt.vision.frame" || topic === "litt.control") return; // not for us
      this.handleDataMessage(payload);
    });

    // Connection quality
    this.room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
      if (participant instanceof RemoteParticipant) {
        this.events.onConnectionQualityChange?.(quality);
      }
    });

    // Reconnection
    this.room.on(RoomEvent.Reconnecting, () => {
      this.setState("reconnecting");
    });

    this.room.on(RoomEvent.Reconnected, () => {
      this.setState("connected");
      this.reconnectAttempts = 0;
    });

    this.room.on(RoomEvent.Disconnected, () => {
      if (!this.isIntentionalDisconnect) {
        // Unexpected disconnect — try to surface the error
        this.emitError("network_interrupted", "Connection to LiTT was lost.", true);
      }
      this.setState("disconnected");
    });

    // Participant connected (the agent worker joining)
    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (participant.kind === ParticipantKind.AGENT) {
        // Agent worker has joined — we're ready
      }
    });
  }

  private handleDataMessage(payload: Uint8Array): void {
    let text: string;
    try {
      text = new TextDecoder().decode(payload);
    } catch {
      return;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }

    const type = event.type as string;
    switch (type) {
      case "user_transcript.delta":
        this.events.onUserTranscriptDelta?.((event.text as string) || "");
        break;
      case "user_transcript.completed":
        this.events.onUserTranscriptComplete?.((event.text as string) || "");
        break;
      case "assistant_transcript.delta":
        this.events.onAssistantTranscriptDelta?.((event.text as string) || "");
        break;
      case "assistant_transcript.completed":
        this.events.onAssistantTranscriptComplete?.((event.text as string) || "");
        break;
      case "agent.thinking":
        this.setAgentState("thinking");
        break;
      case "agent.speaking":
        this.setAgentState("speaking");
        break;
      case "agent.idle":
        this.setAgentState("idle");
        break;
      case "tool.call":
        this.events.onToolCall?.({
          name: (event.name as string) || "",
          args: (event.args as Record<string, unknown>) || {},
          callId: (event.callId as string) || "",
        });
        break;
      case "tool.result":
        this.events.onToolResult?.({
          name: (event.name as string) || "",
          callId: (event.callId as string) || "",
          result: event.result,
        });
        break;
      case "error":
        this.events.onError?.({
          code: (event.code as string) || "unknown",
          message: (event.message as string) || "Agent error",
          retryable: (event.retryable as boolean) ?? true,
        });
        break;
    }
  }

  private setState(state: TransportState): void {
    this.state = state;
    this.events.onStateChange?.(state);
  }

  private setAgentState(state: AgentState): void {
    this.agentState = state;
    this.events.onAgentStateChange?.(state);
  }

  private emitError(code: string, message: string, retryable: boolean): void {
    this.events.onError?.({ code, message, retryable });
  }
}
