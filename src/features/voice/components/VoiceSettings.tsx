"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { AgentVoiceSelector } from "@/features/voice/components/AgentVoiceSelector";
import { AGENT_PROFILES } from "@/features/voice/lib/agentProfiles";
import { getDefaultProfile } from "@/features/voice/types";
import type { VoiceAgentId, AgentVoiceProfile } from "@/features/voice/types";

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    play: "M5 3l14 9-14 9V3z",
    stop: "M6 6h12v12H6z",
    reset: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
    check: "M20 6L9 17l-5-5",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || ""} />
    </svg>
  );
}

export function VoiceSettings() {
  const T = useTheme().resolvedColors;
  const [profiles, setProfiles] = useState<Record<string, AgentVoiceProfile>>({
    litt: getDefaultProfile("litt"),
    spark: getDefaultProfile("spark"),
  });
  const [selectedAgent, setSelectedAgent] = useState<VoiceAgentId>("litt");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.profiles) {
          setProfiles(data.profiles);
        }
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async (agentId: VoiceAgentId, settings: Partial<AgentVoiceProfile>) => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/voice/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, settings }),
      });
      setProfiles((prev) => ({
        ...prev,
        [agentId]: { ...prev[agentId], ...settings },
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Non-fatal
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      await fetch("/api/voice/settings", { method: "DELETE" });
      setProfiles({
        litt: getDefaultProfile("litt"),
        spark: getDefaultProfile("spark"),
      });
    } catch {
      // Non-fatal
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const profile = profiles[selectedAgent];
      const sampleText = selectedAgent === "litt"
        ? "Connection established. I'm scanning the project now."
        : "Oh, that's clean. The preview is live.";

      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sampleText,
          agentId: selectedAgent,
          voiceSettings: {
            stability: profile.stability,
            similarity: profile.similarity,
            style: profile.style,
            speakerBoost: profile.speakerBoost,
          },
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
      }
    } catch {
      // Non-fatal
    } finally {
      setPreviewing(false);
    }
  };

  const profile = profiles[selectedAgent];
  const agentProfile = AGENT_PROFILES[selectedAgent];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ color: T.textColor }}>
      {/* Agent selector */}
      <AgentVoiceSelector onChange={setSelectedAgent} />

      {/* Settings for selected agent */}
      <div
        className="rounded-xl p-5"
        style={{ background: T.boxBg, border: `1px solid ${T.borderColor}30` }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold" style={{ color: T.headerColor }}>
            {agentProfile.displayName} Voice Settings
          </h3>
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80 disabled:opacity-40"
            style={{ background: `${agentProfile.color}20`, color: agentProfile.color }}
          >
            {previewing ? <Icon name="stop" size={12} /> : <Icon name="play" size={12} />}
            {previewing ? "Playing…" : "Preview"}
          </button>
        </div>

        {/* Sliders */}
        <div className="space-y-4">
          {/* Speed */}
          <SliderRow
            label="Speed"
            value={profile.speed}
            min={0.5}
            max={2.0}
            step={0.01}
            color={agentProfile.color}
            onChange={(v) => setProfiles((prev) => ({
              ...prev,
              [selectedAgent]: { ...prev[selectedAgent], speed: v },
            }))}
          />

          {/* Stability */}
          <SliderRow
            label="Stability"
            value={profile.stability}
            min={0}
            max={1}
            step={0.01}
            color={agentProfile.color}
            onChange={(v) => setProfiles((prev) => ({
              ...prev,
              [selectedAgent]: { ...prev[selectedAgent], stability: v },
            }))}
          />

          {/* Similarity */}
          <SliderRow
            label="Similarity"
            value={profile.similarity}
            min={0}
            max={1}
            step={0.01}
            color={agentProfile.color}
            onChange={(v) => setProfiles((prev) => ({
              ...prev,
              [selectedAgent]: { ...prev[selectedAgent], similarity: v },
            }))}
          />

          {/* Style / Expression */}
          <SliderRow
            label="Expression"
            value={profile.style}
            min={0}
            max={1}
            step={0.01}
            color={agentProfile.color}
            onChange={(v) => setProfiles((prev) => ({
              ...prev,
              [selectedAgent]: { ...prev[selectedAgent], style: v },
            }))}
          />

          {/* Spoken response length */}
          <div>
            <label className="mb-1 block text-xs font-semibold opacity-60">
              Spoken response length
            </label>
            <div className="flex gap-2">
              {[
                { label: "Short", value: 1 },
                { label: "Medium", value: 3 },
                { label: "Long", value: 5 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setProfiles((prev) => ({
                    ...prev,
                    [selectedAgent]: { ...prev[selectedAgent], maxSpokenParagraphs: opt.value },
                  }))}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                  style={{
                    background: profile.maxSpokenParagraphs === opt.value
                      ? `${agentProfile.color}20`
                      : `${T.borderColor}15`,
                    color: profile.maxSpokenParagraphs === opt.value
                      ? agentProfile.color
                      : T.textColor,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <ToggleRow
            label="Auto-speak"
            checked={profile.autoSpeak}
            color={agentProfile.color}
            onChange={(v) => setProfiles((prev) => ({
              ...prev,
              [selectedAgent]: { ...prev[selectedAgent], autoSpeak: v },
            }))}
          />

          <ToggleRow
            label="Allow interruptions"
            checked={profile.allowInterruptions}
            color={agentProfile.color}
            onChange={(v) => setProfiles((prev) => ({
              ...prev,
              [selectedAgent]: { ...prev[selectedAgent], allowInterruptions: v },
            }))}
          />

          <ToggleRow
            label="Mute code and logs"
            checked={profile.muteCodeAndLogs}
            color={agentProfile.color}
            onChange={(v) => setProfiles((prev) => ({
              ...prev,
              [selectedAgent]: { ...prev[selectedAgent], muteCodeAndLogs: v },
            }))}
          />
        </div>

        {/* Actions */}
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => handleSave(selectedAgent, profile)}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80 disabled:opacity-40"
            style={{ background: `${agentProfile.color}20`, color: agentProfile.color }}
          >
            {saving ? "Saving…" : saved ? (
              <><Icon name="check" size={14} /> Saved</>
            ) : "Save"}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold opacity-60 transition-all hover:opacity-80"
            style={{ background: `${T.borderColor}20`, color: T.textColor }}
          >
            <Icon name="reset" size={14} />
            Restore defaults
          </button>
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  color,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-semibold opacity-60">{label}</label>
        <span className="text-xs font-mono opacity-40">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: color }}
      />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  color,
  onChange,
}: {
  label: string;
  checked: boolean;
  color: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-xs font-semibold opacity-60">{label}</label>
      <button
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 rounded-full transition-all"
        style={{
          backgroundColor: checked ? color : "rgba(255,255,255,0.1)",
        }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
          style={{
            left: checked ? "calc(100% - 22px)" : "2px",
          }}
        />
      </button>
    </div>
  );
}
