"use client";

import { useState } from "react";
import { Volume2 } from "lucide-react";
import { SettingsCard, ToggleRow } from "@/components/settings/SettingsPrimitives";
import {
  readAutoSendEnabled,
  writeAutoSendEnabled,
  readTtsEnabled,
  writeTtsEnabled,
} from "@/features/voice/lib/voice-prefs";

/**
 * VoicePreferencesCard — the "Voice" card in Settings → Voice & Camera.
 *
 * Every control here is wired to the real preference store the Studio
 * voice session reads (see voice-prefs.ts): toggling writes the same
 * localStorage keys VoiceSessionContext parses, so a choice made here is
 * the choice the Studio session actually runs with, and it survives
 * navigation and reloads.
 *
 * Controls that used to sit here with no consumer anywhere in the
 * codebase (barge-in, silence timeout, playback speed, spoken response
 * length) were removed rather than left as decoration — the session's
 * push-to-talk turn-taking and spoken-summary behaviour are automatic
 * and intentionally not user-tunable from this card.
 */
export function VoicePreferencesCard() {
  const [autoSend, setAutoSend] = useState<boolean>(() => readAutoSendEnabled());
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => readTtsEnabled());

  return (
    <SettingsCard title="Voice" description="Speech and playback" icon={<Volume2 size={16} />}>
      <div className="space-y-3">
        <ToggleRow
          title="Auto-send"
          description="Send message when you stop speaking"
          checked={autoSend}
          onChange={(v) => {
            setAutoSend(v);
            writeAutoSendEnabled(v);
          }}
        />
        <ToggleRow
          title="Spoken replies"
          description="LiTT reads its replies aloud in the Studio"
          checked={ttsEnabled}
          onChange={(v) => {
            setTtsEnabled(v);
            writeTtsEnabled(v);
          }}
        />
        <p className="text-[10px] text-white/40">
          These preferences are shared with the Studio voice session — changing them here
          changes them there too.
        </p>
      </div>
    </SettingsCard>
  );
}
