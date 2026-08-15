"use client";

import { useState } from "react";
import { VoiceController } from "@/features/voice/components/VoiceController";

export default function VoicePage() {
  const [transcript, setTranscript] = useState("");
  const [agentText, setAgentText] = useState("");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-black">LiTT Voice</h1>
        <p className="text-sm opacity-50">Tap the orb to start talking with LiTT</p>
      </div>

      <VoiceController
        showSelector
        showStatus
        onTranscript={(text, final) => {
          if (final) {
            setTranscript((prev) => prev + " " + text);
          }
        }}
        onAgentText={(text) => {
          setAgentText((prev) => prev + text);
        }}
      />

      {(transcript || agentText) && (
        <div className="w-full max-w-2xl space-y-4">
          {transcript && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-1 text-xs font-bold uppercase opacity-40">You</div>
              <div className="text-sm">{transcript}</div>
            </div>
          )}
          {agentText && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="mb-1 text-xs font-bold uppercase opacity-40">LiTT</div>
              <div className="text-sm">{agentText}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
