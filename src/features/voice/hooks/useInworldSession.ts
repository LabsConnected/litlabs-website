"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { getVoiceToken } from "@/lib/voice-client";
import type { VoiceAgentId } from "@/features/voice/types";

const TARGET_SAMPLE_RATE = 24000;
const CHUNK_SIZE = 4096;
const FADE_SAMPLES = 48;

interface UseInworldSessionOptions {
  onTranscript?: (text: string, final: boolean) => void;
  onAgentText?: (text: string) => void;
  onError?: (message: string) => void;
}

interface UseInworldSessionReturn {
  connect: (agentId?: VoiceAgentId) => Promise<void>;
  disconnect: () => void;
  startListening: () => Promise<void>;
  stopListening: () => void;
  interrupt: () => void;
  isConnected: boolean;
  isListening: boolean;
  error: string | null;
}

export function useInworldSession(
  options: UseInworldSessionOptions = {},
): UseInworldSessionReturn {
  const { onTranscript, onAgentText, onError } = options;

  const setState = useVoiceStore((store) => store.setState);
  const setError = useVoiceStore((store) => store.setError);
  const setTranscript = useVoiceStore((store) => store.setTranscript);
  const setInterimTranscript = useVoiceStore((store) => store.setInterimTranscript);
  const activeAgent = useVoiceStore((store) => store.activeAgent);
  void activeAgent;

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isPlayingRef = useRef(false);
  const interruptedRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);

  // --- Audio playback ---
  const playNextChunkRef = useRef<() => void>(() => {});

  const playNextChunk = useCallback(() => {
    if (interruptedRef.current) {
      playbackQueueRef.current = [];
      isPlayingRef.current = false;
      return;
    }

    const chunk = playbackQueueRef.current.shift();
    if (!chunk) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const ctx = playbackContextRef.current;
    if (!ctx) return;

    const source = ctx.createBufferSource();
    source.buffer = chunk;
    source.connect(ctx.destination);
    playbackSourceRef.current = source;

    source.onended = () => {
      playbackSourceRef.current = null;
      playNextChunkRef.current();
    };

    source.start();
  }, []);

  useEffect(() => {
    playNextChunkRef.current = playNextChunk;
  }, [playNextChunk]);

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

      // Convert PCM16 little-endian to Float32
      const sampleCount = bytes.length / 2;
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const int16 = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
        float32[i] = int16 / 32768;
      }

      // Apply fade in/out to avoid clicks
      const fadeSamples = Math.min(FADE_SAMPLES, sampleCount);
      for (let i = 0; i < fadeSamples; i++) {
        const gain = i / fadeSamples;
        float32[i] *= gain;
      }
      for (let i = 0; i < fadeSamples; i++) {
        const gain = (fadeSamples - i) / fadeSamples;
        float32[sampleCount - 1 - i] *= gain;
      }

      const audioBuffer = ctx.createBuffer(1, sampleCount, TARGET_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32, 0);
      playbackQueueRef.current.push(audioBuffer);

      if (!isPlayingRef.current) {
        playNextChunk();
      }
    },
    [playNextChunk],
  );

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current = [];
    if (playbackSourceRef.current) {
      try {
        playbackSourceRef.current.stop();
      } catch {
        // Already stopped
      }
      playbackSourceRef.current = null;
    }
    isPlayingRef.current = false;
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
      setError(error);
      setState("error");
    }
  }, [error, setState, setError]);

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
  }, []);

  // --- WebSocket connection ---
  const connect = useCallback(
    async (_agentId?: VoiceAgentId) => {
      setErrorState(null);
      setError(null);
      setState("connecting");

      try {
        const token = await getVoiceToken();
        const wsUrl =
          process.env.NEXT_PUBLIC_VOICE_WS_URL ||
          "ws://localhost:4002/voice";

        const ws = new WebSocket(`${wsUrl}?token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          setState("idle");
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case "session.created":
                // Server will send session.update automatically
                break;

              case "session.updated":
                setState("idle");
                break;

              case "input_audio_buffer.speech_started":
                // User started speaking — interrupt agent playback
                interruptedRef.current = true;
                stopPlayback();
                setState("listening");
                break;

              case "input_audio_buffer.speech_stopped":
              case "input_audio_buffer.committed":
                // Turn ended — agent will respond
                if (isListening) {
                  setState("thinking");
                }
                break;

              case "response.output_audio.delta":
                // Agent audio chunk
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
                setState("idle");
                interruptedRef.current = false;
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

        ws.onerror = () => {
          setErrorState("Voice connection failed. Please try again.");
          setError("Voice connection failed.");
          setState("error");
        };

        ws.onclose = (event) => {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect";
        setErrorState(message);
        setError(message);
        setState("error");
      }
    },
    [enqueueAudioChunk, isListening, onError, onAgentText, onTranscript, setError, setState, setInterimTranscript, setTranscript, stopMicCapture, stopPlayback],
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
    setState("idle");
  }, [setState, stopMicCapture, stopPlayback]);

  const startListening = useCallback(async () => {
    if (!isConnected) {
      await connect();
    }

    // Initialize playback context on user gesture
    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    }

    interruptedRef.current = false;
    await startMicCapture();
  }, [isConnected, connect, startMicCapture]);

  const stopListening = useCallback(() => {
    stopMicCapture();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
    setState("thinking");
  }, [isListening, setState, stopMicCapture]);

  const interruptRef = useRef<() => void>(() => {});

  const interrupt = useCallback(() => {
    stopPlayback();
    interruptedRef.current = true;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "response.cancel" }));
    }
    setState("interrupted");
    // Brief pause then restart listening
    setTimeout(() => {
      interruptedRef.current = false;
      if (isListening) {
        setState("listening");
      } else {
        void startListening();
      }
    }, 200);
  }, [isListening, setState, startListening, stopPlayback]);

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

  return {
    connect,
    disconnect,
    startListening,
    stopListening,
    interrupt,
    isConnected,
    isListening,
    error,
  };
}
