"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiveVoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

interface UseGeminiLiveVoiceOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAiText?: (text: string) => void;
}

interface UseGeminiLiveVoiceReturn {
  state: LiveVoiceState;
  interimTranscript: string;
  aiText: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  interrupt: () => void;
}

const LIVE_API_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha";

export function useGeminiLiveVoice(
  options: UseGeminiLiveVoiceOptions = {},
): UseGeminiLiveVoiceReturn {
  const [state, setState] = useState<LiveVoiceState>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [aiText, setAiText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputNodeRef = useRef<AudioWorkletNode | null>(null);
  const outputNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stop = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (inputNodeRef.current) {
      inputNodeRef.current.disconnect();
      inputNodeRef.current = null;
    }
    if (outputNodeRef.current) {
      outputNodeRef.current.disconnect();
      outputNodeRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setState("idle");
    setInterimTranscript("");
    setAiText("");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState("connecting");

    try {
      // 1. Fetch ephemeral token
      const tokenRes = await fetch("/api/voice/live-token", { method: "POST" });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to get live voice token");
      }
      const { token } = await tokenRes.json();
      if (!token) throw new Error("No token returned");

      // 2. Set up AudioContext with worklets
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule("/worklets/litt-pcm-input.js");
      await audioCtx.audioWorklet.addModule("/worklets/litt-pcm-output.js");

      // 3. Get microphone
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = micStream;

      const sourceNode = audioCtx.createMediaStreamSource(micStream);
      const inputNode = new AudioWorkletNode(audioCtx, "litt-pcm-input");
      sourceNode.connect(inputNode);
      inputNodeRef.current = inputNode;

      // 4. Set up output worklet for AI audio
      const outputNode = new AudioWorkletNode(audioCtx, "litt-pcm-output");
      outputNode.connect(audioCtx.destination);
      outputNodeRef.current = outputNode;

      // 5. Connect WebSocket
      const ws = new WebSocket(`${LIVE_API_BASE}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setState("listening");

        // Send setup message
        ws.send(JSON.stringify({
          setup: {
            model: process.env.NEXT_PUBLIC_GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
            systemInstruction: "You are LiTT, a creative AI assistant inside LiTTree Lab Studios. Respond conversationally and concisely.",
            generationConfig: {
              temperature: 0.6,
              responseModalities: ["AUDIO"],
            },
          },
        }));

        // Pipe PCM input to WebSocket
        inputNode.port.onmessage = (e: MessageEvent) => {
          if (ws.readyState === WebSocket.OPEN && state !== "speaking") {
            ws.send(e.data);
          }
        };
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (event.data instanceof Blob) {
          // Audio response — convert to PCM and feed to output worklet
          const arrayBuffer = await event.data.arrayBuffer();
          const pcm16 = new Int16Array(arrayBuffer);
          const float32 = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 0x8000;
          }

          // Resample from 24kHz to 16kHz (simple decimation by 1.5x — approximate)
          // For production, use a proper resampler. For now, send as-is to output.
          const pcmBuffer = new ArrayBuffer(pcm16.buffer.byteLength);
          new Int16Array(pcmBuffer).set(pcm16);
          outputNode.port.postMessage(pcmBuffer, [pcmBuffer]);

          setState("speaking");
        } else if (typeof event.data === "string") {
          try {
            const json = JSON.parse(event.data);
            if (json.serverContent?.inputTranscription?.text) {
              const text = json.serverContent.inputTranscription.text;
              setInterimTranscript(text);
              optionsRef.current.onTranscript?.(text, false);
            }
            if (json.serverContent?.outputTranscription?.text) {
              const text = json.serverContent.outputTranscription.text;
              setAiText(text);
              optionsRef.current.onAiText?.(text);
            }
            if (json.serverContent?.turnComplete) {
              setState("listening");
              if (interimTranscript) {
                optionsRef.current.onTranscript?.(interimTranscript, true);
              }
            }
          } catch {
            // Non-JSON message, ignore
          }
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
        setState("error");
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          stop();
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start live voice");
      setState("error");
      stop();
    }
  }, [stop, state, interimTranscript]);

  const interrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ clientContent: { turnComplete: true } }));
    }
    setState("listening");
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    state,
    interimTranscript,
    aiText,
    error,
    start,
    stop,
    interrupt,
  };
}
