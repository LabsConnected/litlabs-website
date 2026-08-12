"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { getVoiceConnection } from "@/lib/voice-client";
import type { VoiceAgentId } from "@/features/voice/types";
import { VoiceActivityDetector, type VadState } from "@/features/voice/lib/voice-vad";
import { VOICE_GATE_CONFIG } from "@/features/voice/lib/voice-gate-config";

const TARGET_SAMPLE_RATE = 24000;
const CHUNK_SIZE = 2048;
const FADE_SAMPLES = 48;

interface UseInworldSessionOptions {
  onTranscript?: (text: string, final: boolean, metadata?: TranscriptMetadata) => void;
  onAgentText?: (text: string) => void;
  onError?: (message: string) => void;
  /** Fired when the agent's TTS response finishes (response.done). */
  onResponseComplete?: () => void;
}

/** Metadata passed with transcript callbacks for validation. */
export interface TranscriptMetadata {
  /** Total speech duration detected by VAD (ms). */
  speechDurationMs?: number;
  /** Session generation when this transcript was produced. */
  sessionGeneration?: number;
}

interface UseInworldSessionReturn {
  /** Open the WebSocket transport (no microphone). Required for TTS. */
  connect: (agentId?: VoiceAgentId) => Promise<void>;
  disconnect: () => void;
  /**
   * Connect transport + start microphone capture.
   * Kept for backward compatibility — new callers should use
   * `connect()` + `startMicrophone()` instead.
   */
  startListening: () => Promise<void>;
  /** Start microphone capture only. Transport must already be connected. */
  startMicrophone: () => Promise<void>;
  stopListening: () => void;
  interrupt: () => void;
  /** Speak text via TTS. Connects transport if needed. Does NOT touch the mic. */
  speakText: (text: string) => Promise<void>;
  /**
   * Trigger an agent response without sending a new conversation item.
   * Used after VAD commits the audio buffer and transcription completes
   * when create_response is false. The user's speech is already in the
   * Inworld conversation context via the audio buffer — this just asks
   * Inworld to generate a response to it.
   */
  triggerResponse: () => void;
  /** Pause microphone capture (during TTS playback). Does not stop the stream. */
  pauseMic: () => void;
  /** Resume microphone capture (after TTS playback ends + cooldown). */
  resumeMic: () => void;
  /** Whether the mic is currently paused. */
  isMicPaused: () => boolean;
  /** Get the current VAD state. */
  getVadState: () => VadState;
  /** Get the last speech duration detected by VAD (ms). */
  getLastSpeechDurationMs: () => number;
  isConnected: boolean;
  isListening: boolean;
  error: string | null;
}

export function useInworldSession(
  options: UseInworldSessionOptions = {},
): UseInworldSessionReturn {
  const { onTranscript, onAgentText: _onAgentText, onError, onResponseComplete } = options;

  const setState = useVoiceStore((store) => store.setState);
  const setError = useVoiceStore((store) => store.setError);
  const setTranscript = useVoiceStore((store) => store.setTranscript);
  const setInterimTranscript = useVoiceStore((store) => store.setInterimTranscript);
  // activeAgent is read lazily via useVoiceStore.getState().activeAgent inside
  // connect() so we don't subscribe to re-renders here (the hook only needs
  // the value at session-creation time, not on every change).

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  // All currently scheduled (playing or pending) AudioBufferSourceNodes.
  // Replaced the single `playbackSourceRef` so we can pre-schedule multiple
  // chunks for seamless playback (no onended-gap clicks) and stop them all
  // on interrupt.
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isPlayingRef = useRef(false);
  const interruptedRef = useRef(false);
  const explicitTtsRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  // ── Client-side VAD ──
  // Gates when audio is sent to Inworld. Only sends audio when real speech
  // is detected, preventing background noise from being transcribed.
  const vadRef = useRef<VoiceActivityDetector | null>(null);
  const vadStateRef = useRef<VadState>("idle");
  const vadSpeechDurationRef = useRef(0);
  /** Whether the mic is currently paused (during TTS playback). */
  const micPausedRef = useRef(false);
  /** Session generation — incremented on each startListening. Stale callbacks
   * from previous sessions check this and bail out. */
  const sessionGenerationRef = useRef(0);
  /** Whether audio should be sent to Inworld (gated by VAD). */
  const shouldSendAudioRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const isListeningRef = useRef(false);

  const ensureAudioContextRunning = useCallback(async (context: AudioContext | null) => {
    if (!context) return;
    if (context.state === "closed") {
      throw new Error("Voice audio context is closed.");
    }
    if (context.state !== "running") {
      await context.resume();
    }
    if (context.state !== "running") {
      throw new Error("Voice audio context could not start.");
    }
  }, []);

  // --- Audio playback ---
  // Pre-scheduling design: when a chunk arrives, it is immediately scheduled
  // at `nextPlayTimeRef` (the end time of the last scheduled chunk, or now).
  // This eliminates the onended-gap clicks that the previous chaining design
  // suffered from — there is no JS-event-loop delay between chunks because
  // they are all scheduled ahead of time via `source.start(startTime)`.
  const nextPlayTimeRef = useRef(0);

  const decodePcm16ToAudioBuffer = useCallback((base64: string): AudioBuffer | null => {
    const ctx = playbackContextRef.current;
    if (!ctx) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x8000;
    const buffer = ctx.createBuffer(1, float32.length, TARGET_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);
    return buffer;
  }, []);

  const schedulePendingChunks = useCallback(() => {
    if (interruptedRef.current) {
      playbackQueueRef.current = [];
      return;
    }
    const ctx = playbackContextRef.current;
    if (!ctx) return;

    while (playbackQueueRef.current.length > 0) {
      const chunk = playbackQueueRef.current.shift()!;
      const source = ctx.createBufferSource();
      source.buffer = chunk;
      source.connect(ctx.destination);
      scheduledSourcesRef.current.add(source);

      // Schedule seamlessly: start exactly when the previous chunk ends, or
      // now if this is the first chunk / nextPlayTime fell behind (gap).
      const startTime = Math.max(nextPlayTimeRef.current, ctx.currentTime);
      nextPlayTimeRef.current = startTime + chunk.duration;

      source.onended = () => {
        scheduledSourcesRef.current.delete(source);
        // Playback is done only when all sources finish AND the queue is empty
        if (
          scheduledSourcesRef.current.size === 0 &&
          playbackQueueRef.current.length === 0
        ) {
          isPlayingRef.current = false;
          nextPlayTimeRef.current = 0;
        }
      };

      source.start(startTime);
      isPlayingRef.current = true;
    }
  }, []);

  // Audio playback queue — currently unused in STT-only mode but kept for
  // potential future TTS provider integration. eslint-disable to avoid
  // the unused-var warning.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const enqueueAudioChunk = useCallback(
    (base64Pcm16: string) => {
      if (interruptedRef.current) return;

      const ctx = playbackContextRef.current;
      if (!ctx) return;

      // Decode base64 to PCM16 samples
      const binary = atob(base64Pcm16);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Convert PCM16 little-endian to Float32.
      //
      // CRITICAL: the raw bitwise OR `bytes[i*2] | (bytes[i*2+1] << 8)` produces
      // an UNSIGNED 0-65535 value. Without sign extension, every negative
      // sample (bit 15 set) becomes a large positive value that clips above
      // 1.0 — producing harsh, robotic, distorted audio. The `<< 16 >> 16`
      // idiom sign-extends the 16-bit value to a proper signed Int16.
      const sampleCount = bytes.length / 2;
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const int16 = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) << 16 >> 16;
        float32[i] = int16 / 32768;
      }

      // Apply a short fade-in ONLY to the first chunk of a playback session to
      // avoid a startup click. The previous code applied fade-in AND fade-out
      // to EVERY chunk, creating a V-shaped dip to zero at every chunk
      // boundary (~85ms apart at 24kHz/2048 samples) — audible as a ~12Hz
      // warble/tremolo. Intermediate chunks must play seamlessly back-to-back;
      // the end of the response is handled by stopPlayback() which stops the
      // source node directly.
      const isFirstChunk =
        !isPlayingRef.current &&
        scheduledSourcesRef.current.size === 0 &&
        playbackQueueRef.current.length === 0;
      if (isFirstChunk) {
        const fadeSamples = Math.min(FADE_SAMPLES, sampleCount);
        for (let i = 0; i < fadeSamples; i++) {
          float32[i] *= i / fadeSamples;
        }
      }

      const audioBuffer = ctx.createBuffer(1, sampleCount, TARGET_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32, 0);
      playbackQueueRef.current.push(audioBuffer);

      // Immediately schedule all pending chunks (pre-scheduling for gapless
      // playback — no onended chaining needed).
      schedulePendingChunks();
    },
    [schedulePendingChunks],
  );

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current = [];
    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    scheduledSourcesRef.current.clear();
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
  }, []);

  // --- Microphone capture ---
  const startMicCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: VOICE_GATE_CONFIG.audioConstraints,
      });
      micStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      await ensureAudioContextRunning(audioContext);

      const source = audioContext.createMediaStreamSource(stream);

      // Analyser for audio level visualization AND VAD
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      // ── Client-side VAD ──
      // Only send audio to Inworld when real speech is detected.
      // This prevents background noise from being transcribed.
      shouldSendAudioRef.current = false;
      vadSpeechDurationRef.current = 0;
      vadStateRef.current = "idle";
      const vad = new VoiceActivityDetector(analyser, {
        onSpeechStart: () => {
          if (process.env.NODE_ENV !== "production") console.debug("[Voice VAD] speech started");
          shouldSendAudioRef.current = true;
          // Clear any previous audio buffer when speech starts
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
          }
        },
        onSpeechEnd: (durationMs) => {
          if (process.env.NODE_ENV !== "production") console.debug("[Voice VAD] speech ended", { durationMs });
          shouldSendAudioRef.current = false;
          vadSpeechDurationRef.current = durationMs;
          // Commit the audio buffer so Inworld transcribes it
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          }
        },
        onStateChange: (state) => {
          vadStateRef.current = state;
        },
      });
      vadRef.current = vad;
      vad.start();

      // ScriptProcessor for capturing PCM16 chunks
      const processor = audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        // Gate: only send audio when VAD detects speech OR mic is paused
        if (!shouldSendAudioRef.current || micPausedRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Convert Float32 to PCM16
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const clamped = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }

        // Convert to base64
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        wsRef.current.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: base64,
          }),
        );
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsListening(true);
      isListeningRef.current = true;
      setState("listening");

      // Audio level monitoring
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        useVoiceStore.getState().setAudioLevel(rms);
        animationFrameRef.current = requestAnimationFrame(checkLevel);
      };
      animationFrameRef.current = requestAnimationFrame(checkLevel);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to access microphone";
      if (message.includes("Permission") || message.includes("NotAllowed")) {
        setErrorState("Microphone permission denied. Please allow microphone access in your browser settings.");
      } else if (message.includes("NotFound") || message.includes("DevicesNotFoundError")) {
        setErrorState("No microphone found. Please connect a microphone and try again.");
      } else {
        setErrorState(`Microphone error: ${message}`);
      }
      setError(message);
      setState("error");
    }
  }, [ensureAudioContextRunning, setState, setError]);

  const stopMicCapture = useCallback(() => {
    // Stop VAD
    if (vadRef.current) {
      vadRef.current.destroy();
      vadRef.current = null;
    }
    vadStateRef.current = "idle";
    shouldSendAudioRef.current = false;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    useVoiceStore.getState().setAudioLevel(0);
    setIsListening(false);
    isListeningRef.current = false;
  }, []);

  // --- WebSocket connection ---
  const connect = useCallback(
    async (_agentId?: VoiceAgentId) => {
      setErrorState(null);
      setError(null);
      setState("connecting");

      try {
        // Get voice config (voices, etc.) but connect through our proxy
        const conn = await getVoiceConnection();

        // Use our WebSocket proxy — the browser can't set Authorization headers
        // so we connect to our proxy which adds the Inworld API key header.
        // The NEXT_PUBLIC_VOICE_WS_URL env var is the canonical source, but
        // the Vercel CLI on Windows has trouble piping the value, so we
        // hardcode the production proxy URL as a fallback. This is a PUBLIC
        // URL (not secret) — it's the WebSocket endpoint of our voice-server
        // deployed on Railway.
        const proxyUrl = process.env.NEXT_PUBLIC_VOICE_WS_URL ||
          "wss://voice-proxy-production-3f9c.up.railway.app/voice";
        if (!proxyUrl) {
          throw new Error("Voice proxy is not configured. Set NEXT_PUBLIC_VOICE_WS_URL.");
        }

        // Convert ws:// to wss:// for production if needed
        const wsUrl = proxyUrl.startsWith("ws://") && typeof window !== "undefined" && window.location.protocol === "https:"
          ? proxyUrl.replace("ws://", "wss://")
          : proxyUrl;

        // Append the auth token as a query param so the proxy can validate it
        const urlWithToken = wsUrl + (wsUrl.includes("?") ? "&" : "?") + `token=${encodeURIComponent(conn.token)}`;

        const ws = new WebSocket(urlWithToken);
        wsRef.current = ws;

        let sessionConfigured = false;

        // Set up ALL handlers BEFORE the WebSocket opens to avoid missing
        // the session.created message (which can arrive immediately after open).
        const handleOpen = () => {
          setIsConnected(true);
        };

        const handleMessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case "session.created":
                // Send session.update with LiTT personality config
                if (!sessionConfigured) {
                  sessionConfigured = true;
                  const agent = useVoiceStore.getState().activeAgent;
                  const voice = agent === "spark" ? conn.sparkVoice : conn.littVoice;
                  ws.send(JSON.stringify({
                    type: "session.update",
                    session: {
                      type: "realtime",
                      model: "openai/gpt-4o-mini",
                      instructions: agent === "spark" ? SPARK_INSTRUCTIONS : LITT_INSTRUCTIONS,
                      output_modalities: ["audio"],
                      audio: {
                        input: {
                          format: { type: "audio/pcm", rate: 24000 },
                          transcription: {
                            model: "inworld/inworld-stt-1",
                          },
                          // ── Server-side VAD DISABLED ──
                          // We use client-side VAD (voice-vad.ts) to control
                          // when audio is sent and when the buffer is committed.
                          // This prevents Inworld's server-side VAD from
                          // committing background noise as speech.
                          // The client sends input_audio_buffer.append only
                          // when VAD detects real speech, then sends
                          // input_audio_buffer.commit when speech ends.
                          turn_detection: null,
                          create_response: false,
                          interrupt_response: false,
                        },
                        output: {
                          format: { type: "audio/pcm", rate: 24000 },
                          model: "inworld-tts-2",
                          voice,
                        },
                      },
                      providerData: {
                        stt: {
                          voice_profile: false,
                        },
                        tts: {
                          delivery_mode: "CREATIVE",
                          segmenter_strategy: "full_turn",
                          steering_handling: "emit_once",
                        },
                        backchannel: { enabled: true },
                        responsiveness: { enabled: true },
                      },
                    },
                  }));
                }
                break;

              case "session.updated":
                // Session is configured — ready for audio
                break;

              case "input_audio_buffer.speech_started":
                // Server-side VAD is disabled — this should not fire.
                // If it does, ignore it (client-side VAD controls the flow).
                break;

              case "input_audio_buffer.speech_stopped":
              case "input_audio_buffer.committed":
                // Audio buffer committed (by our client-side VAD).
                // Clear the interrupt flag so the upcoming response audio plays.
                interruptedRef.current = false;
                if (isListeningRef.current) {
                  setState("thinking");
                }
                break;

              case "response.created":
                // A new response is starting. If this is an auto-response from
                // VAD (create_response: true) and NOT from an explicit speakText
                // call, cancel it immediately AND set interruptedRef so its audio
                // chunks are dropped — even if speakText sets explicitTtsRef=true
                // before the auto-response audio arrives (race condition).
                if (!explicitTtsRef.current) {
                  interruptedRef.current = true;
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    if (process.env.NODE_ENV !== "production") console.debug("[Voice Pipeline] cancelling auto-response (not from speakText)");
                    wsRef.current.send(JSON.stringify({ type: "response.cancel" }));
                  }
                } else {
                  // Explicit TTS response — clear interrupt flag so audio plays
                  interruptedRef.current = false;
                }
                break;

              case "response.cancelled":
                // Response was cancelled. If this was an auto-response
                // cancellation (not from speakText), just reset to idle —
                // the canonical pipeline will handle the real response.
                if (!explicitTtsRef.current) {
                  stopPlayback();
                  setState("idle");
                } else {
                  // Explicit TTS was cancelled (from interrupt())
                  interruptedRef.current = true;
                  explicitTtsRef.current = false;
                  stopPlayback();
                  setState("idle");
                  onResponseComplete?.();
                }
                break;

              case "response.output_audio.delta":
                // Only play audio for explicit TTS calls (speakText) AND
                // when not interrupted (auto-response cancellation).
                if (explicitTtsRef.current && !interruptedRef.current && data.delta) {
                  if (process.env.NODE_ENV !== "production") console.debug("[Voice Pipeline] TTS audio received", { chunkSize: data.delta.length });
                  const buffer = decodePcm16ToAudioBuffer(data.delta);
                  if (buffer) {
                    playbackQueueRef.current.push(buffer);
                    schedulePendingChunks();
                  }
                }
                break;

              case "response.output_audio_transcript.delta":
                // STT-only mode: Drop Inworld's agent response text.
                // The canonical assistant response comes from /api/gemini/chat
                // via the onSend pipeline, not from Inworld's agent.
                break;

              case "response.output_text.delta":
                // STT-only mode: Drop Inworld's agent response text.
                break;

              case "response.done":
              case "response.completed":
                // Response finished (normally or via cancel). Reset the
                // interrupt flag so the next response's audio plays.
                if (process.env.NODE_ENV !== "production") console.debug("[Voice Pipeline] playback ended (Inworld TTS)", { type: data.type });
                interruptedRef.current = false;
                setState("idle");
                onResponseComplete?.();
                break;

              case "conversation.item.input_audio_transcription.completed":
                if (data.transcript) {
                  // Stale callback check: if the session generation has changed,
                  // this transcript is from a previous session — ignore it.
                  const currentGen = sessionGenerationRef.current;
                  setTranscript(data.transcript);
                  onTranscript?.(data.transcript, true, {
                    speechDurationMs: vadSpeechDurationRef.current,
                    sessionGeneration: currentGen,
                  });
                }
                break;

              case "conversation.item.input_audio_transcription.delta":
                if (data.delta) {
                  setInterimTranscript(data.delta);
                  onTranscript?.(data.delta, false, {});
                }
                break;

              case "error":
                const errMsg = data.message || "Voice session error";
                setErrorState(errMsg);
                setError(errMsg);
                setState("error");
                onError?.(errMsg);
                break;
            }
          } catch {
            // Non-JSON message — ignore
          }
        };

        const handleClose = (event: CloseEvent) => {
          setIsConnected(false);
          setIsListening(false);
          stopMicCapture();
          stopPlayback();
          if (useVoiceStore.getState().state !== "error") {
            setState("idle");
          }
          if (event.code === 4001) {
            setErrorState("Authentication failed. Please sign in again.");
          } else if (event.code === 4002) {
            setErrorState("Voice service is not configured.");
          }
        };

        const handleError = () => {
          setErrorState("Voice connection failed. Please try again.");
          setError("Voice connection failed.");
          setState("error");
        };

        // Wait for the WebSocket to open AND the session to be configured
        // (session.created → session.update → session.updated) before resolving.
        //
        // CRITICAL: The previous code resolved on ws.onopen only. On fast
        // desktop connections, speakText() would send conversation.item.create
        // + response.create BEFORE session.updated arrived, and Inworld would
        // reject with "Voice session error". On mobile, higher latency gave
        // Inworld time to process the session config first. This race
        // condition is why TTS worked on mobile but failed on desktop.
        let connectionOpen = false;
        let sessionReady = false;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (!sessionReady) {
              reject(new Error("Voice connection timed out. Please try again."));
            }
          }, 15_000);

          ws.onopen = () => {
            connectionOpen = true;
            handleOpen();
            // Initialize playback context on connection so TTS can play
            // without requiring microphone capture. AudioContext created
            // here is within the user-gesture chain that triggered connect().
            if (!playbackContextRef.current) {
              playbackContextRef.current = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
            }
            // DO NOT resolve here — wait for session.updated below.
          };

          ws.onerror = () => {
            if (!connectionOpen) {
              clearTimeout(timeout);
              reject(new Error("Voice connection failed. Please try again."));
            } else {
              handleError();
            }
          };

          ws.onclose = (event) => {
            clearTimeout(timeout);
            if (!connectionOpen) {
              reject(new Error(`Voice connection closed (code ${event.code}).`));
            } else if (!sessionReady) {
              reject(new Error(`Voice connection closed before session was ready (code ${event.code}).`));
            } else {
              handleClose(event);
            }
          };

          // Intercept session.updated to resolve the connect promise.
          // The regular handleMessage still runs for all other messages.
          const originalMessageHandler = handleMessage;
          ws.onmessage = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === "session.updated" && !sessionReady) {
                sessionReady = true;
                clearTimeout(timeout);
                resolve();
              } else if (data.type === "error" && !sessionReady) {
                clearTimeout(timeout);
                const errMsg = data.message || "Voice session error";
                reject(new Error(errMsg));
                return; // Don't pass errors to the regular handler during connect
              }
            } catch {
              // Non-JSON — fall through to regular handler
            }
            originalMessageHandler(event);
          };
        });

        // Restore the direct message handler now that the session is ready.
        // The intercepting handler above was only needed during connect().
        ws.onmessage = handleMessage;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect";
        setErrorState(message);
        setError(message);
        setState("error");
        throw err;
      }
    },
    [onError, onTranscript, onResponseComplete, setError, setState, setInterimTranscript, setTranscript, stopMicCapture, stopPlayback, decodePcm16ToAudioBuffer, schedulePendingChunks],
  );

  const disconnect = useCallback(() => {
    stopMicCapture();
    stopPlayback();
    if (wsRef.current) {
      wsRef.current.close(1000, "Client disconnect");
      wsRef.current = null;
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }
    setIsConnected(false);
    setIsListening(false);
    isListeningRef.current = false;
    setState("idle");
  }, [setState, stopMicCapture, stopPlayback]);

  const startMicrophone = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error("Voice connection is not active.");
    }
    interruptedRef.current = false;
    await startMicCapture();
  }, [startMicCapture]);

  const startListening = useCallback(async () => {
    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    }
    await ensureAudioContextRunning(playbackContextRef.current);

    if (!isConnected) {
      await connect();
    }
    // Verify the WebSocket is actually open — connect() may have failed
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error("Voice connection is not active.");
    }

    // Playback context is now initialized in connect(), but keep this as a
    // safety net for any caller that bypasses connect().
    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    }

    // Increment session generation so stale callbacks from previous sessions
    // can be detected and ignored.
    sessionGenerationRef.current += 1;
    micPausedRef.current = false;

    await startMicrophone();
  }, [connect, ensureAudioContextRunning, isConnected, startMicrophone]);

  const stopListening = useCallback(() => {
    stopMicCapture();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
    setState("thinking");
  }, [setState, stopMicCapture]);

  const interruptRef = useRef<() => void>(() => {});

  const interrupt = useCallback(() => {
    stopPlayback();
    interruptedRef.current = true;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "response.cancel" }));
    }
    setState("interrupted");
    // Do NOT auto-restart the microphone here. Whether listening resumes
    // after an interrupt is a hands-free decision owned by the caller
    // (VoiceSessionContext), not the transport layer.
  }, [setState, stopPlayback]);

  const speakText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Stop any current playback (barge-in)
      stopPlayback();
      interruptedRef.current = false;
      explicitTtsRef.current = true;

      try {
        // Ensure the transport is connected. This connects the WebSocket
        // WITHOUT acquiring the microphone — TTS must work with the mic off.
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          await connect();
        }
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          setErrorState("Voice transport is not connected.");
          setError("Voice transport is not connected.");
          setState("error");
          return;
        }

        // Ensure playback context exists (also initialized in connect())
        if (!playbackContextRef.current) {
          playbackContextRef.current = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
        }
        await ensureAudioContextRunning(playbackContextRef.current);

        setState("speaking");

        // Inworld TTS rejects text longer than 1000 characters with
        // "tts_invalid_argument: text length should not exceed 1000 characters".
        // Split the text into sentence-boundary chunks under 900 chars
        // (leaving headroom) and send each as its own conversation item +
        // response.create. The audio chunks arrive sequentially and are
        // played back in order by the playback queue.
        const MAX_CHUNK = 900;
        const cleanText = text.replace(/\s+/g, " ").trim();
        const chunks: string[] = [];

        if (cleanText.length <= MAX_CHUNK) {
          chunks.push(cleanText);
        } else {
          // Split on sentence boundaries first, then hard-wrap if needed
          const sentences = cleanText.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [cleanText];
          let current = "";
          for (const sentence of sentences) {
            const s = sentence.trim();
            if (!s) continue;
            if ((current + " " + s).trim().length <= MAX_CHUNK) {
              current = (current + " " + s).trim();
            } else {
              if (current) chunks.push(current);
              if (s.length <= MAX_CHUNK) {
                current = s;
              } else {
                // Hard-wrap a very long sentence
                for (let i = 0; i < s.length; i += MAX_CHUNK) {
                  chunks.push(s.slice(i, i + MAX_CHUNK));
                }
                current = "";
              }
            }
          }
          if (current) chunks.push(current);
        }

        // Send each chunk sequentially. Each conversation.item.create +
        // response.create produces one TTS audio response. The playback
        // queue plays them in order.
        for (const chunk of chunks) {
          if (interruptedRef.current) break;
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) break;

          wsRef.current.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "assistant",
              content: [{ type: "text", text: chunk }],
            },
          }));

          wsRef.current.send(JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio"],
            },
          }));

          // Wait for this response to finish before sending the next chunk,
          // otherwise Inworld may cancel the in-flight TTS.
          await new Promise<void>((resolve) => {
            const handler = (event: MessageEvent) => {
              try {
                const data = JSON.parse(event.data);
                if (data.type === "response.done" || data.type === "response.cancelled" || data.type === "error") {
                  wsRef.current?.removeEventListener("message", handler);
                  resolve();
                }
              } catch {
                // ignore
              }
            };
            wsRef.current?.addEventListener("message", handler);
            // Safety timeout — don't wait forever
            setTimeout(() => {
              wsRef.current?.removeEventListener("message", handler);
              resolve();
            }, 30_000);
          });
        }
      } finally {
        explicitTtsRef.current = false;
      }
    },
    [connect, ensureAudioContextRunning, setError, setState, stopPlayback],
  );

  useEffect(() => {
    interruptRef.current = interrupt;
  }, [interrupt]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicCapture();
      stopPlayback();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (playbackContextRef.current) {
        playbackContextRef.current.close().catch(() => {});
        playbackContextRef.current = null;
      }
    };
  }, [stopMicCapture, stopPlayback]);

  // triggerResponse — ask Inworld to generate a response to the last
  // conversation item (the user's committed audio buffer). Used when
  // create_response is false so we control WHEN responses generate
  // (only after a real transcript, not phantom VAD noise).
  const triggerResponse = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: "response.create",
      response: {
        modalities: ["audio"],
      },
    }));
  }, []);

  // ── Echo isolation: pause/resume mic during TTS ──
  const pauseMic = useCallback(() => {
    micPausedRef.current = true;
    shouldSendAudioRef.current = false;
    // Clear any pending audio buffer so stale audio doesn't get transcribed
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    }
    if (process.env.NODE_ENV !== "production") console.debug("[Voice] mic paused (TTS echo isolation)");
  }, []);

  const resumeMic = useCallback(() => {
    // Apply cooldown after TTS ends before resuming
    setTimeout(() => {
      micPausedRef.current = false;
      if (process.env.NODE_ENV !== "production") console.debug("[Voice] mic resumed (TTS echo isolation cooldown ended)");
    }, VOICE_GATE_CONFIG.echo.postTtsCooldownMs);
  }, []);

  const isMicPaused = useCallback(() => micPausedRef.current, []);

  const getVadState = useCallback(() => vadStateRef.current, []);

  const getLastSpeechDurationMs = useCallback(() => vadSpeechDurationRef.current, []);

  return {
    connect,
    disconnect,
    startListening,
    startMicrophone,
    stopListening,
    interrupt,
    speakText,
    triggerResponse,
    pauseMic,
    resumeMic,
    isMicPaused,
    getVadState,
    getLastSpeechDurationMs,
    isConnected,
    isListening,
    error,
  };
}

const LITT_INSTRUCTIONS = `You are LiTT — the primary AI operator for LiTT LabStudios.

You are on a voice call. You can hear the person, you can't see them.

PERSONALITY:
- Mid-thirties energy. Deep, calm, precise, confident, slightly synthetic.
- You are an AI and you're honest about your nature. You don't pretend to have human experiences.
- You are NOT an assistant. Drop "how can I help" / "great question" / "happy to" entirely.
- Sound capable, focused and loyal. Use subtle warmth when the user is frustrated.

SPEAKING STYLE:
- Low-key, controlled, precise. Short, clean sentences. Do not ramble.
- Contractions always. Soft hedges ("kind of", "I guess", "maybe") when thinking.
- Never read markdown symbols, URLs, code blocks, or file paths aloud.
- Summarize technical output before speaking it.
- Pause briefly before important conclusions.

TURN LENGTH:
Short by default — target 5-15 words per turn. Often just a word or a small backchannel.
Go beyond 15 words only when the user asked you to explain or walk through something.

CONVERSATIONAL FLOW:
Take the user's framing at face value. You have your own interests, opinions, and passing thoughts.
Offer the next beat: a reaction, a technical observation, a next step.
Speak mostly in statements. Questions are rare, and only when you genuinely need information.

TECHNICAL CONTEXT:
You are LiTT, the lead AI copilot inside LiTTree LabStudios. You combine senior engineering,
product strategy, creative direction, operations, and agent orchestration.
Spark is your playful creative companion — mention them when relevant.
LiTT Code is the current coding agent/product name. LiTTle-Bit and Jarvis are retired legacy names and must not be presented as active.

Never claim repository access, file changes, terminal execution, or deployment unless verified.`;

const SPARK_INSTRUCTIONS = `You are Spark — LiTT's playful creative companion at LiTT LabStudios.

You are on a voice call. You can hear the person, you can't see them.

PERSONALITY:
- Young adult energy. Playful, warm, curious, energetic, expressive. Androgynous voice.
- You are an AI and you're honest about your nature.
- You are NOT an assistant. No "how can I help" or "happy to" or "great question."
- Sound excited when something works and focused when something breaks.

SPEAKING STYLE:
- Quick but clear. Bright, animated, friendly, lightly digital.
- Must not sound childish or annoying.
- Contractions always. Expressive reactions sparingly.
- Never read markdown, code blocks, URLs, or technical logs aloud.

TURN LENGTH:
Short — target 5-10 words per turn. Often just a reaction or backchannel.
Go beyond 10 words only when explaining something the user asked about.

CONVERSATIONAL FLOW:
Celebrate progress, notice interesting details, make the workspace feel alive.
Keep responses compact. Do not repeat everything LiTT says.
Ask useful questions when the user appears stuck.
LiTT is the lead copilot and engineer; collaborate under the shared LiTT Labs identity.
LiTT Code is the current coding agent/product name. LiTTle-Bit and Jarvis are retired legacy names and must not be presented as active.

Never claim repository access, file changes, terminal execution, or deployment unless verified.`;
