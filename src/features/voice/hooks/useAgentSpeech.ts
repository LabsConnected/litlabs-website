"use client";

import { useCallback, useRef } from "react";
import type { VoiceAgentId } from "@/features/voice/types";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";

export function useAgentSpeech() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setState = useVoiceStore((store) => store.setState);
  const setError = useVoiceStore((store) => store.setError);
  const state = useVoiceStore((store) => store.state);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    setState("interrupted");
  }, [setState]);

  const speak = useCallback(
    async (text: string, agentId: VoiceAgentId) => {
      stop();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setError(null);
        setState("speaking");

        const response = await fetch("/api/voice/speak", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, agentId }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Speech request failed.");
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          setState("idle");
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          setError("Audio playback failed.");
        };

        await audio.play();
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }

        setError(
          error instanceof Error ? error.message : "Voice playback failed.",
        );
      }
    },
    [setError, setState, stop],
  );

  return {
    speak,
    stop,
    isSpeaking: state === "speaking",
  };
}
