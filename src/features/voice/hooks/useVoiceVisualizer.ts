"use client";

import { useEffect, useRef, useState } from "react";

interface UseVoiceVisualizerOptions {
  analyser: AnalyserNode | null;
  enabled?: boolean;
}

interface VoiceVisualizerData {
  level: number;
  frequencies: Uint8Array;
  waveform: Uint8Array;
}

export function useVoiceVisualizer({ analyser, enabled = true }: UseVoiceVisualizerOptions) {
  const [data, setData] = useState<VoiceVisualizerData>({
    level: 0,
    frequencies: new Uint8Array(0),
    waveform: new Uint8Array(0),
  });
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analyser || !enabled) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    const update = () => {
      if (!analyser) return;

      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      // Calculate RMS level
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const val = (timeData[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / timeData.length);

      setData({
        level: rms,
        frequencies: new Uint8Array(freqData),
        waveform: new Uint8Array(timeData),
      });

      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [analyser, enabled]);

  return data;
}
