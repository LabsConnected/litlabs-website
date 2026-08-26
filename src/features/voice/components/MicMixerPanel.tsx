"use client";

/**
 * MicMixerPanel.tsx — Mic & Mixer control surface.
 *
 * Owns:
 *   - Input device picker (writes the shared `litt:voice:deviceId` key that
 *     both VoiceSessionContext.selectDevice() and useInworldSession read)
 *   - Input gain / output volume sliders (live via useMixerStore)
 *   - Mute toggle + live input level meter
 *   - Output test tone routed at the current output volume
 *
 * Device changes apply on the NEXT mic capture — a live capture is NOT
 * restarted automatically, since mid-session getUserMedia swaps race with
 * the VAD/STT pipeline. The panel shows a hint when this is the case.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMixerStore } from "@/features/voice/store/useMixerStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { DEVICE_ID_STORAGE_KEY, readStoredDeviceId } from "@/features/voice/lib/mixer-settings";

interface MicMixerPanelProps {
  /** Accent color from the theme (defaults to cyan). */
  accentColor?: string;
}

export function MicMixerPanel({ accentColor = "#06b6d4" }: MicMixerPanelProps) {
  const inputGain = useMixerStore((s) => s.inputGain);
  const outputVolume = useMixerStore((s) => s.outputVolume);
  const muted = useMixerStore((s) => s.muted);
  const setInputGain = useMixerStore((s) => s.setInputGain);
  const setOutputVolume = useMixerStore((s) => s.setOutputVolume);
  const toggleMuted = useMixerStore((s) => s.toggleMuted);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceChanged, setDeviceChanged] = useState(false);
  const [tonePlaying, setTonePlaying] = useState(false);
  const [level, setLevel] = useState(0);
  const toneStopRef = useRef<(() => void) | null>(null);

  // Hydrate the persisted device selection after mount (SSR-safe).
  useEffect(() => {
    setSelectedDeviceId(readStoredDeviceId());
  }, []);

  // Poll the shared audio level from the voice store and scale it by the
  // input gain so the meter reflects what the pipeline actually sends.
  useEffect(() => {
    const id = window.setInterval(() => {
      const raw = useVoiceStore.getState().audioLevel;
      setLevel(Math.min(1, raw * inputGain * 4));
    }, 100);
    return () => window.clearInterval(id);
  }, [inputGain]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch {
      // Non-fatal — labels may be unavailable without permission.
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    if (!navigator.mediaDevices?.addEventListener) return;
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  const onSelectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceChanged(true);
    try {
      if (deviceId === "default") {
        window.localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
      } else {
        window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
      }
    } catch {
      // Non-fatal — selection just won't persist.
    }
  }, []);

  // ── Output test tone ──
  const playTestTone = useCallback(() => {
    if (toneStopRef.current) {
      toneStopRef.current();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    osc.type = "sine";
    gain.gain.value = outputVolume * 0.2; // keep the test tone gentle
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTonePlaying(true);

    const stop = () => {
      try {
        osc.stop();
        osc.disconnect();
        gain.disconnect();
        void ctx.close().catch(() => {});
      } catch {
        // Already stopped/closed.
      }
      toneStopRef.current = null;
      setTonePlaying(false);
    };
    toneStopRef.current = stop;
    window.setTimeout(stop, 1200);
  }, [outputVolume]);

  useEffect(() => () => toneStopRef.current?.(), []);

  const levelPercent = Math.round(level * 100);
  const meterColor =
    level > 0.9 ? "#ef4444" : level > 0.7 ? "#f59e0b" : accentColor;

  return (
    <div className="space-y-3">
      {/* Input device */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
          Input device
        </span>
        <select
          value={selectedDeviceId ?? "default"}
          onChange={(e) => onSelectDevice(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none"
        >
          <option value="default">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
        {deviceChanged && (
          <p className="mt-1 text-[10px] text-amber-400">
            Applies on your next voice session — restart the mic to switch now.
          </p>
        )}
        {devices.length === 0 && (
          <p className="mt-1 text-[10px] text-white/40">
            No devices listed yet — grant microphone permission in Studio, or test the mic above.
          </p>
        )}
      </div>

      {/* Input gain + live level meter */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Input gain
          </span>
          <span className="text-[10px] font-bold text-white/60">
            {Math.round(inputGain * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={Math.round(inputGain * 100)}
          onChange={(e) => setInputGain(Number(e.target.value) / 100)}
          className="mt-1 w-full"
          style={{ accentColor }}
        />
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{ width: `${muted ? 0 : levelPercent}%`, backgroundColor: meterColor }}
          />
        </div>
      </div>

      {/* Output volume */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Output volume (LiTT&apos;s voice)
          </span>
          <span className="text-[10px] font-bold text-white/60">
            {Math.round(outputVolume * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(outputVolume * 100)}
          onChange={(e) => setOutputVolume(Number(e.target.value) / 100)}
          className="mt-1 w-full"
          style={{ accentColor }}
        />
      </div>

      {/* Mute + test tone */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={toggleMuted}
          className="rounded-lg border px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80"
          style={{
            borderColor: muted ? "#ef444480" : `${accentColor}40`,
            color: muted ? "#ef4444" : accentColor,
          }}
        >
          {muted ? "Unmute microphone" : "Mute microphone"}
        </button>
        <button
          type="button"
          onClick={playTestTone}
          className="rounded-lg border px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80"
          style={{
            borderColor: tonePlaying ? "#22c55e80" : `${accentColor}40`,
            color: tonePlaying ? "#22c55e" : accentColor,
          }}
        >
          {tonePlaying ? "Playing…" : "Test output"}
        </button>
      </div>

      <p className="text-[10px] text-white/40">
        Gain shapes what LiTT hears (VAD runs post-gain). Volume shapes what you hear.
      </p>
    </div>
  );
}

