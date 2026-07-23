"use client";

import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { AGENT_PROFILES } from "@/features/voice/lib/agentProfiles";
import type { VoiceAgentId } from "@/features/voice/types";

interface AgentVoiceSelectorProps {
  onChange?: (agentId: VoiceAgentId) => void;
  compact?: boolean;
}

export function AgentVoiceSelector({ onChange, compact = false }: AgentVoiceSelectorProps) {
  const activeAgent = useVoiceStore((store) => store.activeAgent);
  const setActiveAgent = useVoiceStore((store) => store.setActiveAgent);

  function handleSelect(agentId: VoiceAgentId) {
    setActiveAgent(agentId);
    onChange?.(agentId);
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1 rounded-full bg-black/40 p-1">
        {(Object.keys(AGENT_PROFILES) as VoiceAgentId[]).map((agentId) => {
          const profile = AGENT_PROFILES[agentId];
          const active = activeAgent === agentId;
          return (
            <button
              key={agentId}
              onClick={() => handleSelect(agentId)}
              className="rounded-full px-3 py-1 text-xs font-bold transition-all"
              style={{
                backgroundColor: active ? `${profile.color}25` : "transparent",
                color: active ? profile.color : "#888",
              }}
            >
              {profile.displayName}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-bold uppercase tracking-wider opacity-40">
        Active Agent
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(AGENT_PROFILES) as VoiceAgentId[]).map((agentId) => {
          const profile = AGENT_PROFILES[agentId];
          const active = activeAgent === agentId;
          return (
            <button
              key={agentId}
              onClick={() => handleSelect(agentId)}
              className="rounded-xl p-3 text-left transition-all hover:scale-[1.02]"
              style={{
                background: active
                  ? `linear-gradient(135deg, ${profile.color}15 0%, rgba(0,0,0,0.4) 60%)`
                  : "rgba(0,0,0,0.3)",
                border: active
                  ? `1px solid ${profile.color}40`
                  : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="text-sm font-bold" style={{ color: active ? profile.color : "#ccc" }}>
                {profile.displayName}
              </div>
              <div className="text-xs opacity-50">{profile.role}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
