import { create } from "zustand";
import {
  clampGain,
  clampVolume,
  loadMixerPrefs,
  persistMixerPrefs,
  type MixerPrefs,
} from "@/features/voice/lib/mixer-settings";

interface MixerStore extends MixerPrefs {
  setInputGain: (value: number) => void;
  setOutputVolume: (value: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
}

/**
 * Mic & Mixer state — input gain, output volume, and mute.
 *
 * Values are hydrated from localStorage at store creation (guarded for SSR)
 * and every mutation is persisted immediately so the audio graph picks up
 * the same values on the next session.
 *
 * The voice pipeline (useInworldSession) subscribes to this store while the
 * microphone is live, so slider changes apply in real time without
 * restarting capture.
 */
export const useMixerStore = create<MixerStore>((set) => {
  const initial = loadMixerPrefs();
  const commit = (partial: Partial<MixerPrefs>) => {
    set((prev) => {
      const next: MixerPrefs = {
        inputGain: prev.inputGain,
        outputVolume: prev.outputVolume,
        muted: prev.muted,
        ...partial,
      };
      persistMixerPrefs(next);
      return next;
    });
  };

  return {
    inputGain: initial.inputGain,
    outputVolume: initial.outputVolume,
    muted: initial.muted,

    setInputGain: (value) => commit({ inputGain: clampGain(value) }),
    setOutputVolume: (value) => commit({ outputVolume: clampVolume(value) }),
    setMuted: (muted) => commit({ muted }),
    toggleMuted: () =>
      set((prev) => {
        const next: MixerPrefs = {
          inputGain: prev.inputGain,
          outputVolume: prev.outputVolume,
          muted: !prev.muted,
        };
        persistMixerPrefs(next);
        return next;
      }),
  };
});
