"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { useMicrophone } from "@/features/voice/hooks/useMicrophone";
import { useAgentSpeech } from "@/features/voice/hooks/useAgentSpeech";
import { chooseAgent } from "@/features/voice/lib/voiceRouting";
import type { VoiceAgentId } from "@/features/voice/types";

interface UseVoiceSessionOptions {
  onTranscript?: (text: string, agentId: VoiceAgentId) => void;
  onAgentResponse?: (text: string, agentId: VoiceAgentId) => void;
}

interface UseVoiceSessionReturn {
  startListening: () => Promise<void>;
  stopListening: () => void;
  interrupt: () => void;
  speakResponse: (text: string, agentId?: VoiceAgentId) => Promise<void>;
  getSessionId: () => string | null;
  voiceError: string | null;
}

export function useVoiceSession(options: UseVoiceSessionOptions = {}): UseVoiceSessionReturn {
  const { onTranscript, onAgentResponse } = options;

  const setState = useVoiceStore((store) => store.setState);
  const setError = useVoiceStore((store) => store.setError);
  const setTranscript = useVoiceStore((store) => store.setTranscript);
  const setInterimTranscript = useVoiceStore((store) => store.setInterimTranscript);
  const activeAgent = useVoiceStore((store) => store.activeAgent);
  const reset = useVoiceStore((store) => store.reset);

  const sessionIdRef = useRef<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const { speak: speakAgent, stop: stopSpeech } = useAgentSpeech();

  const handleSpeechEnd = useCallback(async () => {
    setState("transcribing");

    // Get the recorded audio and send to transcribe endpoint
    // For now, we use the interim transcript that was accumulated
    const finalText = useVoiceStore.getState().interimTranscript.trim();

    if (!finalText) {
      setState("idle");
      return;
    }

    setTranscript(finalText);
    setInterimTranscript("");

    // Determine agent
    const agentId = chooseAgent(finalText);

    setState("thinking");

    // Send to conversation endpoint (caller handles this)
    onTranscript?.(finalText, agentId);
  }, [setState, setTranscript, setInterimTranscript, onTranscript]);

  const { error: micError, start: startMic, stop: stopMic } = useMicrophone({
    onAudioLevel: (level) => {
      useVoiceStore.getState().setAudioLevel(level);
    },
    onSpeechStart: () => {
      // Barge-in: if agent is speaking, interrupt
      const currentState = useVoiceStore.getState().state;
      if (currentState === "speaking" || currentState === "thinking") {
        stopSpeech();
      }
      setState("listening");
      setInterimTranscript("");
    },
    onSpeechEnd: () => {
      void handleSpeechEnd();
    },
    silenceDurationMs: 1500,
  });

  // Sync mic error to voice store
  useEffect(() => {
    if (micError) {
      setVoiceError(micError);
      setError(micError);
    } else {
      setVoiceError(null);
    }
  }, [micError, setError]);

  const startListening = useCallback(async () => {
    // Create session if needed
    if (!sessionIdRef.current) {
      try {
        const res = await fetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: activeAgent }),
        });
        const data = await res.json();
        if (data.sessionId) {
          sessionIdRef.current = data.sessionId;
        }
      } catch {
        // Non-fatal — session is optional for basic functionality
      }
    }

    setState("connecting");
    await startMic();
    setState("listening");
  }, [activeAgent, setState, startMic]);

  const stopListening = useCallback(() => {
    stopMic();
    setState("idle");
  }, [stopMic, setState]);

  const interrupt = useCallback(() => {
    stopSpeech();
    stopMic();
    setState("interrupted");
    // Immediately start listening again
    void startListening();
  }, [stopSpeech, stopMic, setState, startListening]);

  const speakResponse = useCallback(
    async (text: string, agentId?: VoiceAgentId) => {
      const id = agentId ?? activeAgent;
      onAgentResponse?.(text, id);
      await speakAgent(text, id);
    },
    [activeAgent, onAgentResponse, speakAgent],
  );

  const getSessionId = useCallback(() => sessionIdRef.current, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMic();
      stopSpeech();
      if (sessionIdRef.current) {
        fetch(`/api/voice/session?sessionId=${sessionIdRef.current}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      reset();
    };
  }, [stopMic, stopSpeech, reset]);

  return {
    startListening,
    stopListening,
    interrupt,
    speakResponse,
    getSessionId,
    voiceError,
  };
}
