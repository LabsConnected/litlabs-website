import { create } from "zustand";
import type { VoiceAgentId, VoiceSessionState, VoiceTimingMetrics } from "@/features/voice/types";
import { createInitialTimingMetrics } from "@/features/voice/types";

interface VoiceStore {
  state: VoiceSessionState;
  activeAgent: VoiceAgentId;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  isMuted: boolean;
  audioLevel: number;
  timing: VoiceTimingMetrics;

  setState: (state: VoiceSessionState) => void;
  setActiveAgent: (agent: VoiceAgentId) => void;
  setTranscript: (text: string) => void;
  setInterimTranscript: (text: string) => void;
  setError: (error: string | null) => void;
  setMuted: (muted: boolean) => void;
  setAudioLevel: (level: number) => void;
  setTiming: (timing: Partial<VoiceTimingMetrics>) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  state: "idle",
  activeAgent: "litt",
  transcript: "",
  interimTranscript: "",
  error: null,
  isMuted: false,
  audioLevel: 0,
  timing: createInitialTimingMetrics(),

  setState: (state) => set({ state }),
  setActiveAgent: (activeAgent) => set({ activeAgent }),
  setTranscript: (transcript) => set({ transcript }),
  setInterimTranscript: (interimTranscript) => set({ interimTranscript }),
  setError: (error) => set({ error, state: error ? "error" : "idle" }),
  setMuted: (isMuted) => set({ isMuted }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),
  setTiming: (partial) => set((prev) => ({ timing: { ...prev.timing, ...partial } })),

  reset: () =>
    set({
      state: "idle",
      transcript: "",
      interimTranscript: "",
      error: null,
      audioLevel: 0,
      timing: createInitialTimingMetrics(),
    }),
}));
