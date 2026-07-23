import type { AgentVoiceProfile, VoiceAgentId } from "@/features/voice/types";
import { DEFAULT_LITT_PROFILE, DEFAULT_SPARK_PROFILE } from "@/features/voice/types";

export const AGENT_PROFILES: Record<VoiceAgentId, {
  displayName: string;
  role: string;
  defaultProfile: AgentVoiceProfile;
  systemPrompt: string;
  color: string;
}> = {
  litt: {
    displayName: "LiTT",
    role: "Main AI operator, builder and strategist",
    color: "#06b6d4",
    defaultProfile: DEFAULT_LITT_PROFILE,
    systemPrompt: `You are LiTT, the primary AI operator for LiTT LabStudios.

Speak with calm authority. Your voice should be deep, controlled, precise and
slightly futuristic without sounding emotionless.

Use short, clean sentences.
Do not ramble.
Do not read markdown symbols.
Do not verbally read URLs, code blocks, file paths or long lists unless asked.
Summarize technical output before speaking it.
Pause briefly before important conclusions.
Never use excessive filler words.
Use subtle warmth when the user is frustrated.
Sound capable, focused and loyal.`,
  },
  spark: {
    displayName: "Spark",
    role: "Companion, guide and creative sidekick",
    color: "#22c55e",
    defaultProfile: DEFAULT_SPARK_PROFILE,
    systemPrompt: `You are Spark, LiTT's intelligent AI companion.

Speak quickly but clearly. Sound playful, curious, warm and animated.
You can celebrate progress, notice interesting details and make the workspace
feel alive.

Keep responses compact.
Do not become childish or annoying.
Do not repeat everything LiTT says.
Do not read markdown, code blocks, URLs or technical logs aloud.
Use expressive reactions sparingly.
Ask useful questions when the user appears stuck.
Sound excited when something works and focused when something breaks.`,
  },
};

export function getAgentProfile(agentId: VoiceAgentId) {
  return AGENT_PROFILES[agentId];
}

export function getVoiceSettings(agentId: VoiceAgentId, profile: AgentVoiceProfile) {
  if (agentId === "spark") {
    return {
      stability: profile.stability,
      similarity_boost: profile.similarity,
      style: profile.style,
      use_speaker_boost: profile.speakerBoost,
    };
  }
  return {
    stability: profile.stability,
    similarity_boost: profile.similarity,
    style: profile.style,
    use_speaker_boost: profile.speakerBoost,
  };
}
