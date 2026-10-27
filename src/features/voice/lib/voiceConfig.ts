import type { VoiceAgentId } from "@/features/voice/types";

export const AGENT_VOICE_CONFIG = {
  litt: {
    agentId: "litt" as const,
    style: "deep-calm-precise",
    rate: 0.9,
    pitch: 0.88,
    volume: 1,
  },
  researcher: {
    agentId: "researcher" as const,
    style: "measured-clear",
    rate: 0.95,
    pitch: 0.92,
    volume: 1,
  },
  writer: {
    agentId: "writer" as const,
    style: "clear-expressive",
    rate: 0.98,
    pitch: 0.95,
    volume: 1,
  },
  marketer: {
    agentId: "marketer" as const,
    style: "confident-warm",
    rate: 1.0,
    pitch: 0.98,
    volume: 1,
  },
  coder: {
    agentId: "coder" as const,
    style: "technical-rigor",
    rate: 0.92,
    pitch: 0.9,
    volume: 1,
  },
  analyst: {
    agentId: "analyst" as const,
    style: "evidence-first",
    rate: 0.94,
    pitch: 0.91,
    volume: 1,
  },
} as const;

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
  const stored = getStoredVoiceName(agentId);
  if (stored) {
    const match = voices.find((v) => v.name === stored);
    if (match) return match;
  }

  for (const pattern of DEEP_VOICE_PATTERNS) {
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
