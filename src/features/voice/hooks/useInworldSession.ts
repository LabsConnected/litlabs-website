"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { getVoiceConnection } from "@/lib/voice-client";
import type { VoiceAgentId } from "@/features/voice/types";

const TARGET_SAMPLE_RATE = 24000;
const CHUNK_SIZE = 2048;
const FADE_SAMPLES = 48;

interface UseInworldSessionOptions {
  onTranscript?: (text: string, final: boolean) => void;
  onAgentText?: (text: string) => void;
  onError?: (message: string) => void;
  /** Fired when the agent's TTS response finishes (response.done). */
  onResponseComplete?: () => void;
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
  isConnected: boolean;
  isListening: boolean;
  error: string | null;
}

export function useInworldSession(
  options: UseInworldSessionOptions = {},
): UseInworldSessionReturn {
  const { onTranscript, onAgentText, onError, onResponseComplete } = options;

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
  const animationFrameRef = useRef<number | null>(null);

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
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: TARGET_SAMPLE_RATE,
        },
      });
      micStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      await ensureAudioContextRunning(audioContext);

      const source = audioContext.createMediaStreamSource(stream);

      // Analyser for audio level visualization
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      // ScriptProcessor for capturing PCM16 chunks
      const processor = audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

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
        // so we connect to our proxy which adds the Inworld API key header
        const proxyUrl = process.env.NEXT_PUBLIC_VOICE_WS_URL;
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
                          turn_detection: {
                            type: "semantic_vad",
                            eagerness: "low",
                            // create_response: false — we manually trigger
                            // response.create after a real transcript arrives.
                            // This prevents Inworld from auto-generating
                            // responses to phantom VAD detections (background
                            // noise, typing, breathing) which caused LiTT to
                            // "say things the user didn't say."
                            create_response: false,
                            interrupt_response: true,
                          },
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
                // User started speaking — only barge-in if the agent is
                // actually playing audio. Setting interruptedRef unconditionally
                // here would drop the NEXT response's audio (the agent's reply
                // to this very utterance), which is the classic "TTS goes silent
                // after the first turn" bug.
                if (isPlayingRef.current) {
                  interruptedRef.current = true;
                  stopPlayback();
                }
                setState("listening");
                break;

              case "input_audio_buffer.speech_stopped":
              case "input_audio_buffer.committed":
                // Turn ended — agent will respond. Clear the interrupt flag so
                // the upcoming response audio is not dropped.
                interruptedRef.current = false;
                if (isListeningRef.current) {
                  setState("thinking");
                }
                break;

              case "response.created":
                // A new response is starting — clear any stale interrupt flag
                // so its audio chunks are not dropped. This handles both VAD
                // auto-responses and explicit response.create from speakText.
                interruptedRef.current = false;
                break;

              case "response.cancelled":
                // Explicit cancel (from interrupt()) — keep interruptedRef true
                // so in-flight chunks are dropped, and reset state.
                interruptedRef.current = true;
                stopPlayback();
                setState("idle");
                onResponseComplete?.();
                break;

              case "response.output_audio.delta":
                // Agent audio chunk — play unless the user interrupted this
                // specific response. interruptedRef is reset on response.created
                // and on speech_stopped, so only true barge-ins drop audio.
                if (!interruptedRef.current) {
                  if (useVoiceStore.getState().state !== "speaking") {
                    setState("speaking");
                  }
                  enqueueAudioChunk(data.delta);
                }
                break;

              case "response.output_audio_transcript.delta":
                // Agent speech transcript (for display)
                if (data.delta) {
                  onAgentText?.(data.delta);
                }
                break;

              case "response.output_text.delta":
                if (data.delta) {
                  onAgentText?.(data.delta);
                }
                break;

              case "response.done":
              case "response.completed":
                // Response finished (normally or via cancel). Reset the
                // interrupt flag so the next response's audio plays.
                interruptedRef.current = false;
                setState("idle");
                onResponseComplete?.();
                break;

              case "conversation.item.input_audio_transcription.completed":
                if (data.transcript) {
                  setTranscript(data.transcript);
                  onTranscript?.(data.transcript, true);
                }
                break;

              case "conversation.item.input_audio_transcription.delta":
                if (data.delta) {
                  setInterimTranscript(data.delta);
                  onTranscript?.(data.delta, false);
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
    [enqueueAudioChunk, onError, onAgentText, onTranscript, onResponseComplete, setError, setState, setInterimTranscript, setTranscript, stopMicCapture, stopPlayback],
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
            role: "user",
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

  return {
    connect,
    disconnect,
    startListening,
    startMicrophone,
    stopListening,
    interrupt,
    speakText,
    triggerResponse,
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
- Signature beats: a calm "Connection established" / "I found the problem" / "The build is ready."
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
LiTT-Code and LiTTle-Bit are retired legacy names and must not be presented as active.

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
LiTT-Code and LiTTle-Bit are retired legacy names and must not be presented as active.

Never claim repository access, file changes, terminal execution, or deployment unless verified.`;
