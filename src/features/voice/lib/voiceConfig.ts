import type { VoiceAgentId } from "@/features/voice/types";

export type AgentVoiceId = "litt" | "spark";

export const AGENT_VOICE_CONFIG = {
  litt: {
    agentId: "litt" as const,
    style: "deep-calm-precise",
    rate: 0.9,
    pitch: 0.88,
    volume: 1,
  },
  spark: {
    agentId: "spark" as const,
    style: "bright-warm-expressive",
    rate: 1.04,
    pitch: 1.03,
    volume: 1,
  },
} as const;

export type ProviderVoiceMap = {
  elevenlabs?: string;
  openai?: string;
  google?: string;
  browser?: string;
};

export const LITT_PROVIDER_VOICES: ProviderVoiceMap = {
  elevenlabs: process.env.ELEVENLABS_LITT_VOICE_ID,
  openai: process.env.OPENAI_LITT_VOICE_ID,
  google: process.env.GOOGLE_LITT_VOICE_NAME,
  browser: "preferred-deep-us-voice",
};

export const SPARK_PROVIDER_VOICES: ProviderVoiceMap = {
  elevenlabs: process.env.ELEVENLABS_SPARK_VOICE_ID,
  openai: process.env.OPENAI_SPARK_VOICE_ID,
  google: process.env.GOOGLE_SPARK_VOICE_NAME,
  browser: "preferred-bright-us-voice",
};

export function getProviderVoices(agentId: VoiceAgentId): ProviderVoiceMap {
  return agentId === "spark" ? SPARK_PROVIDER_VOICES : LITT_PROVIDER_VOICES;
}

export interface TtsResponseMetadata {
  provider: string;
  requestedAgent: "litt" | "spark";
  requestedVoiceId: string | null;
  actualVoiceId: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

const DEEP_VOICE_PATTERNS = [
  /david/i,
  /mark/i,
  /alex/i,
  /daniel/i,
  /google.*us.*english/i,
  /microsoft.*david/i,
  /microsoft.*mark/i,
  /arthur/i,
  /james/i,
  /thomas/i,
];

const BRIGHT_VOICE_PATTERNS = [
  /zira/i,
  /aria/i,
  /jenny/i,
  /samantha/i,
  /victoria/i,
  /karen/i,
  /moira/i,
  /tessa/i,
  /google.*us.*english/i,
  /microsoft.*zira/i,
  /microsoft.*aria/i,
];

const VOICE_STORAGE_KEY = "litt-voice-browser-selection";

export function pickBrowserVoice(
  voices: SpeechSynthesisVoice[],
  agentId: VoiceAgentId,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  const enUsVoices = voices.filter((v) => v.lang === "en-US");
  if (enUsVoices.length === 0) {
    const enVoices = voices.filter((v) => v.lang.startsWith("en"));
    if (enVoices.length === 0) return voices[0] ?? null;
    return pickByPatterns(enVoices, agentId);
  }

  return pickByPatterns(enUsVoices, agentId);
}

function pickByPatterns(
  voices: SpeechSynthesisVoice[],
  agentId: VoiceAgentId,
): SpeechSynthesisVoice {
  const patterns = agentId === "spark" ? BRIGHT_VOICE_PATTERNS : DEEP_VOICE_PATTERNS;

  const stored = getStoredVoiceName(agentId);
  if (stored) {
    const match = voices.find((v) => v.name === stored);
    if (match) return match;
  }

  for (const pattern of patterns) {
    const match = voices.find((v) => pattern.test(v.name));
    if (match) return match;
  }

  return voices[0];
}

export function getStoredVoiceName(agentId: VoiceAgentId): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VOICE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed[agentId] ?? null;
  } catch {
    return null;
  }
}

export function storeVoiceName(agentId: VoiceAgentId, voiceName: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(VOICE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    parsed[agentId] = voiceName;
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // non-fatal
  }
}

export function clearStoredVoiceNames(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(VOICE_STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

export function getBrowserVoiceConfig(agentId: VoiceAgentId): {
  rate: number;
  pitch: number;
  volume: number;
} {
  const config = AGENT_VOICE_CONFIG[agentId];
  return { rate: config.rate, pitch: config.pitch, volume: config.volume };
}
