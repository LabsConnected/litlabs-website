"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveVoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

export interface LiveStudioContext {
  agentId: "litt" | "spark";
  agentName: string;
  agentRole: string;
  projectId: string | null;
  projectName: string | null;
  mode: "code" | "media" | "command";
  activeWindow: string | null;
  activeFilePath: string | null;
}

export interface GeminiLiveVoiceController {
  state: LiveVoiceState;
  inputTranscript: string;
  outputTranscript: string;
  micLevel: number;
  error: string | null;
  muted: boolean;
  start: (context: LiveStudioContext) => Promise<void>;
  stop: () => void;
  mute: () => void;
  unmute: () => void;
  interrupt: () => void;
}

interface UseGeminiLiveVoiceOptions {
  onInputTranscript?: (text: string, isFinal: boolean) => void;
  onOutputTranscript?: (text: string, isFinal: boolean) => void;
}

const LIVE_API_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha";

function buildSystemInstruction(ctx: LiveStudioContext): string {
  return `You are ${ctx.agentName}, the active agent inside LiTT Studio.

Role:
${ctx.agentRole}

Active project:
${ctx.projectName ?? "No project selected"}

Active Studio mode:
${ctx.mode}
${ctx.activeFilePath ? `Active file: ${ctx.activeFilePath}` : ""}

Voice behavior:
- Start answering immediately.
- Use short, direct sentences.
- Default to one to three sentences.
- Do not use generic AI disclaimers.
- Do not list steps unless the creator requests steps.
- Never claim a file changed or command ran without a verified tool result.
- Ask for approval before file edits, commands, Git actions, or deployments.
- Speak naturally and avoid markdown formatting.`;
}

export function useGeminiLiveVoice(
  options: UseGeminiLiveVoiceOptions = {},
): GeminiLiveVoiceController {
  const [state, setState] = useState<LiveVoiceState>("idle");
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputNodeRef = useRef<AudioWorkletNode | null>(null);
  const outputNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const stateRef = useRef<LiveVoiceState>("idle");
  const contextRef = useRef<LiveStudioContext | null>(null);
  const optionsRef = useRef(options);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const cleanupAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
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
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    cleanupAudio();
    reconnectAttemptsRef.current = 0;
    setState("idle");
    setInputTranscript("");
    setOutputTranscript("");
    setMicLevel(0);
    setMuted(false);
  }, [cleanupAudio]);

  const startMicLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current || stateRef.current === "idle") {
        rafRef.current = null;
        return;
      }
      analyserRef.current.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128 - 1;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setMicLevel(Math.min(1, rms * 3));
      rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const connectWebSocket = useCallback(
    async (token: string, context: LiveStudioContext) => {
      const ws = new WebSocket(
        `${LIVE_API_BASE}?token=${encodeURIComponent(token)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setState("listening");

        ws.send(
          JSON.stringify({
            setup: {
              model:
                process.env.NEXT_PUBLIC_GEMINI_LIVE_MODEL ??
                "gemini-3.1-flash-live-preview",
              systemInstruction: buildSystemInstruction(context),
              generationConfig: {
                temperature: 0.45,
                responseModalities: ["AUDIO"],
              },
            },
          }),
        );

        if (inputNodeRef.current) {
          inputNodeRef.current.port.onmessage = (e: MessageEvent) => {
            if (
              ws.readyState === WebSocket.OPEN &&
              !mutedRef.current &&
              stateRef.current !== "speaking"
            ) {
              ws.send(e.data);
            }
          };
        }

        startMicLevelLoop();
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (event.data instanceof Blob) {
          const arrayBuffer = await event.data.arrayBuffer();
          const pcm16 = new Int16Array(arrayBuffer);
          const pcmBuffer = new ArrayBuffer(pcm16.buffer.byteLength);
          new Int16Array(pcmBuffer).set(pcm16);

          if (outputNodeRef.current) {
            outputNodeRef.current.port.postMessage(pcmBuffer, [pcmBuffer]);
          }
          if (stateRef.current !== "speaking") {
            setState("speaking");
          }
        } else if (typeof event.data === "string") {
          try {
            const json = JSON.parse(event.data);
            const sc = json.serverContent;
            if (!sc) return;

            if (sc.inputTranscription?.text) {
              const text = sc.inputTranscription.text;
              setInputTranscript(text);
              optionsRef.current.onInputTranscript?.(text, false);
            }

            if (sc.outputTranscription?.text) {
              const text = sc.outputTranscription.text;
              setOutputTranscript(text);
              optionsRef.current.onOutputTranscript?.(text, false);
            }

            if (sc.turnComplete) {
              setInputTranscript((prev) => {
                if (prev) optionsRef.current.onInputTranscript?.(prev, true);
                return "";
              });
              setOutputTranscript((prev) => {
                if (prev) optionsRef.current.onOutputTranscript?.(prev, true);
                return "";
              });
              setState("listening");
            }

            if (sc.interrupted) {
              if (outputNodeRef.current) {
                outputNodeRef.current.port.postMessage({ type: "clear" });
              }
              setState("listening");
            }
          } catch {
            // Non-JSON message
          }
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
        setState("error");
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          if (stateRef.current !== "idle" && stateRef.current !== "error") {
            setError("Live voice connection closed");
            setState("error");
          }
        }
      };
    },
    [startMicLevelLoop],
  );

  const start = useCallback(
    async (context: LiveStudioContext) => {
      setError(null);
      setState("connecting");
      contextRef.current = context;

      try {
        const tokenRes = await fetch("/api/voice/live-token", {
          method: "POST",
        });
        if (!tokenRes.ok) {
          const err = await tokenRes.json().catch(() => ({}));
          throw new Error(err.error || "Failed to get live voice token");
        }
        const { token } = await tokenRes.json();
        if (!token) throw new Error("No token returned");

        const audioCtx = new AudioContext({ sampleRate: 24000 });
        audioCtxRef.current = audioCtx;

        await audioCtx.audioWorklet.addModule("/worklets/litt-live-input.js");
        await audioCtx.audioWorklet.addModule("/worklets/litt-live-output.js");

        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        micStreamRef.current = micStream;

        const sourceNode = audioCtx.createMediaStreamSource(micStream);

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        sourceNode.connect(analyser);
        analyserRef.current = analyser;

        const inputNode = new AudioWorkletNode(audioCtx, "litt-live-input");
        sourceNode.connect(inputNode);
        inputNodeRef.current = inputNode;

        const outputNode = new AudioWorkletNode(audioCtx, "litt-live-output");
        outputNode.connect(audioCtx.destination);
        outputNodeRef.current = outputNode;

        await connectWebSocket(token, context);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to start live voice",
        );
        setState("error");
        cleanupAudio();
      }
    },
    [cleanupAudio, connectWebSocket],
  );

  const mute = useCallback(() => {
    setMuted(true);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => (t.enabled = false));
    }
  }, []);

  const unmute = useCallback(() => {
    setMuted(false);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => (t.enabled = true));
    }
  }, []);

  const interrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ clientContent: { turns: [{ turnComplete: true }] } }),
      );
    }
    if (outputNodeRef.current) {
      outputNodeRef.current.port.postMessage({ type: "clear" });
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
    inputTranscript,
    outputTranscript,
    micLevel,
    error,
    muted,
    start,
    stop,
    mute,
    unmute,
    interrupt,
  };
}
