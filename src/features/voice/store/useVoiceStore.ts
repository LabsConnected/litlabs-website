import { create } from "zustand";
import type { VoiceAgentId, VoiceSessionState } from "@/features/voice/types";

interface VoiceStore {
  state: VoiceSessionState;
  activeAgent: VoiceAgentId;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  isMuted: boolean;
  audioLevel: number;

  setState: (state: VoiceSessionState) => void;
  setActiveAgent: (agent: VoiceAgentId) => void;
  setTranscript: (text: string) => void;
  setInterimTranscript: (text: string) => void;
  setError: (error: string | null) => void;
  setMuted: (muted: boolean) => void;
  setAudioLevel: (level: number) => void;
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

  setState: (state) => set({ state }),
  setActiveAgent: (activeAgent) => set({ activeAgent }),
  setTranscript: (transcript) => set({ transcript }),
  setInterimTranscript: (interimTranscript) => set({ interimTranscript }),
  setError: (error) => set({ error, state: error ? "error" : "idle" }),
  setMuted: (isMuted) => set({ isMuted }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),

  reset: () =>
    set({
      state: "idle",
      transcript: "",
      interimTranscript: "",
      error: null,
      audioLevel: 0,
    }),
}));
