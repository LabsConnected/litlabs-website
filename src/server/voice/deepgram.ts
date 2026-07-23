/**
 * Deepgram streaming STT server module.
 * Manages WebSocket connections to Deepgram for live transcription.
 */

import WebSocket from "ws";

const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";

export interface DeepgramTranscript {
  text: string;
  isFinal: boolean;
  speech_final?: boolean;
}

export interface DeepgramStream {
  ws: WebSocket;
  send: (audio: Buffer) => void;
  close: () => void;
}

export function createDeepgramStream(
  onTranscript: (transcript: DeepgramTranscript) => void,
  onError?: (error: Error) => void,
  onClose?: () => void,
  options?: {
    model?: string;
    language?: string;
    sampleRate?: number;
    encoding?: string;
  },
): DeepgramStream {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const model = options?.model ?? "nova-2";
  const language = options?.language ?? "en-US";
  const sampleRate = options?.sampleRate ?? 48000;
  const encoding = options?.encoding ?? "linear16";

  const params = new URLSearchParams({
    model,
    language,
    sample_rate: String(sampleRate),
    encoding,
    interim_results: "true",
    endpointing: "300",
    utterances: "true",
    smart_format: "true",
  });

  const ws = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  });

  ws.on("open", () => {
    // Stream is ready to receive audio
  });

  ws.on("message", (data: Buffer) => {
    try {
      const response = JSON.parse(data.toString());
      if (response.type === "Results" && response.channel?.alternatives?.[0]) {
        const alt = response.channel.alternatives[0];
        onTranscript({
          text: alt.transcript || "",
          isFinal: response.is_final ?? false,
          speech_final: response.speech_final,
        });
      }
    } catch {
      // Non-JSON or parse error
    }
  });

  ws.on("error", (err: Error) => {
    onError?.(err);
  });

  ws.on("close", () => {
    onClose?.();
  });

  return {
    ws,
    send: (audio: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(audio);
      }
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },
  };
}

export function isDeepgramConfigured(): boolean {
  return !!process.env.DEEPGRAM_API_KEY;
}
