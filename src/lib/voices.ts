/**
 * voices.ts
 *
 * The shared voice library for every TTS surface in the project
 * (FloatingChat, AudioTool, LiTT Terminal, persona bindings).
 *
 * Two tiers of voices:
 *   1. **ElevenLabs / Gemini TTS voices** — premium, high quality. Used when
 *      ELEVENLABS_API_KEY is configured (or via the server-side Gemini TTS
 *      endpoint that doesn't require a key).
 *   2. **Browser speechSynthesis voices** — fallback. Discovered at runtime
 *      from `window.speechSynthesis.getVoices()` and merged with the
 *      persona-specific label.
 *
 * Each voice has:
 *   - id: stable string used for storage and API calls
 *   - label: human-friendly name
 *   - persona: optional LiTT persona binding (littcode | littlebit | none)
 *   - gender / accent / style: descriptive tags
 *   - provider: "elevenlabs" | "gemini" | "browser"
 *   - engineId: provider-specific voice id (for ElevenLabs / Gemini)
 *   - pitch / rate: defaults for browser TTS fallback
 *
 * The FloatingChat panel reads from this list to populate the voice picker.
 * When a user picks a voice, the choice is persisted in localStorage so
 * it sticks across reloads. Persona-aware defaults are also applied:
 *   - LiTT-Code   → deeper, calmer male voice
 *   - LiTTle-Bit  → brighter, faster female voice
 */

export type VoiceProvider = "elevenlabs" | "gemini" | "browser";

export type VoicePersona = "littcode" | "littlebit" | "none";

export interface VoiceDescriptor {
  id: string;
  label: string;
  desc: string;
  provider: VoiceProvider;
  /** Provider-specific id (ElevenLabs voice id, Gemini voice name, or browser voiceURI). */
  engineId: string;
  persona: VoicePersona;
  gender: "male" | "female" | "neutral";
  accent: string;
  style: string;
  /** Browser TTS rate (0.5 - 2.0). */
  rate: number;
  /** Browser TTS pitch (0 - 2). */
  pitch: number;
  /** True for premium, requires API key. */
  premium: boolean;
  /** Optional preview text used in the voice picker. */
  previewText: string;
}

/* ------------------------------------------------------------------ */
/*  Premium voices (ElevenLabs / Gemini TTS)                          */
/* ------------------------------------------------------------------ */
export const PREMIUM_VOICES: VoiceDescriptor[] = [
  // Gemini TTS voices (free, no extra key beyond Gemini)
  {
    id: "kore",
    label: "Kore",
    desc: "Firm · Female",
    provider: "gemini",
    engineId: "Kore",
    persona: "littlebit",
    gender: "female",
    accent: "American",
    style: "Confident, clear",
    rate: 1.05,
    pitch: 1.0,
    premium: false,
    previewText: "Hi, I'm Kore. Let's get litlabs.net shipped.",
  },
  {
    id: "puck",
    label: "Puck",
    desc: "Upbeat · Male",
    provider: "gemini",
    engineId: "Puck",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "Energetic, friendly",
    rate: 1.1,
    pitch: 1.1,
    premium: false,
    previewText: "Hey! Puck here. What are we building?",
  },
  {
    id: "charon",
    label: "Charon",
    desc: "Informational · Male",
    provider: "gemini",
    engineId: "Charon",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Calm, technical",
    rate: 0.95,
    pitch: 0.85,
    premium: false,
    previewText: "Charon online. I read the brief. Proceeding.",
  },
  {
    id: "fenrir",
    label: "Fenrir",
    desc: "Excitable · Male",
    provider: "gemini",
    engineId: "Fenrir",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "High energy",
    rate: 1.15,
    pitch: 1.0,
    premium: false,
    previewText: "Fenrir ready. Let's GO.",
  },
  {
    id: "orus",
    label: "Orus",
    desc: "Steady · Male",
    provider: "gemini",
    engineId: "Orus",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Deep, deliberate",
    rate: 0.95,
    pitch: 0.8,
    premium: false,
    previewText: "Orus here. Steady hands. What's the build?",
  },
  {
    id: "aoede",
    label: "Aoede",
    desc: "Bright · Female",
    provider: "gemini",
    engineId: "Aoede",
    persona: "littlebit",
    gender: "female",
    accent: "American",
    style: "Warm, melodic",
    rate: 1.05,
    pitch: 1.15,
    premium: false,
    previewText: "Aoede here. Lighter and quicker — let's move.",
  },
  {
    id: "callirrhoe",
    label: "Callirrhoe",
    desc: "Easy-going · Female",
    provider: "gemini",
    engineId: "Callirrhoe",
    persona: "none",
    gender: "female",
    accent: "American",
    style: "Calm, friendly",
    rate: 1.0,
    pitch: 1.0,
    premium: false,
    previewText: "Hey, Callirrhoe here. Take it easy.",
  },
  {
    id: "despina",
    label: "Despina",
    desc: "Smooth · Female",
    provider: "gemini",
    engineId: "Despina",
    persona: "none",
    gender: "female",
    accent: "American",
    style: "Smooth, professional",
    rate: 1.0,
    pitch: 1.05,
    premium: false,
    previewText: "Despina online. Ready when you are.",
  },
  {
    id: "enceladus",
    label: "Enceladus",
    desc: "Breathy · Male",
    provider: "gemini",
    engineId: "Enceladus",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "Soft, intimate",
    rate: 0.95,
    pitch: 0.95,
    premium: false,
    previewText: "Enceladus here. Quiet mode engaged.",
  },
  {
    id: "iapetus",
    label: "Iapetus",
    desc: "Clear · Male",
    provider: "gemini",
    engineId: "Iapetus",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "Crisp, articulate",
    rate: 1.0,
    pitch: 0.95,
    premium: false,
    previewText: "Iapetus. Crisp and clear.",
  },
  {
    id: "leda",
    label: "Leda",
    desc: "Youthful · Female",
    provider: "gemini",
    engineId: "Leda",
    persona: "none",
    gender: "female",
    accent: "American",
    style: "Bright, energetic",
    rate: 1.1,
    pitch: 1.2,
    premium: false,
    previewText: "Leda here. What's up?",
  },
  {
    id: "pulcherrima",
    label: "Pulcherrima",
    desc: "Forward · Female",
    provider: "gemini",
    engineId: "Pulcherrima",
    persona: "littlebit",
    gender: "female",
    accent: "American",
    style: "Confident, direct",
    rate: 1.05,
    pitch: 1.05,
    premium: false,
    previewText: "Pulcherrima online. Direct and to the point.",
  },
  {
    id: "rasalgethi",
    label: "Rasalgethi",
    desc: "Informative · Male",
    provider: "gemini",
    engineId: "Rasalgethi",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Authoritative",
    rate: 1.0,
    pitch: 0.9,
    premium: false,
    previewText: "Rasalgethi. Here are the facts.",
  },
  {
    id: "sadachbia",
    label: "Sadachbia",
    desc: "Lively · Male",
    provider: "gemini",
    engineId: "Sadachbia",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "Lively, dynamic",
    rate: 1.1,
    pitch: 1.05,
    premium: false,
    previewText: "Sadachbia here. Lively and ready.",
  },
  {
    id: "sadaltager",
    label: "Sadaltager",
    desc: "Knowledgeable · Male",
    provider: "gemini",
    engineId: "Sadaltager",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Measured, wise",
    rate: 0.95,
    pitch: 0.85,
    premium: false,
    previewText: "Sadaltager. I have the context.",
  },
  {
    id: "schedar",
    label: "Schedar",
    desc: "Even · Male",
    provider: "gemini",
    engineId: "Schedar",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "Calm, balanced",
    rate: 1.0,
    pitch: 0.95,
    premium: false,
    previewText: "Schedar. Steady as she goes.",
  },
  {
    id: "umbriel",
    label: "Umbriel",
    desc: "Easy-going · Male",
    provider: "gemini",
    engineId: "Umbriel",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "Casual, relaxed",
    rate: 1.0,
    pitch: 1.0,
    premium: false,
    previewText: "Umbriel here. Take it easy.",
  },
  {
    id: "vindemiatrix",
    label: "Vindemiatrix",
    desc: "Gentle · Female",
    provider: "gemini",
    engineId: "Vindemiatrix",
    persona: "none",
    gender: "female",
    accent: "American",
    style: "Soft, gentle",
    rate: 1.0,
    pitch: 1.1,
    premium: false,
    previewText: "Vindemiatrix. Soft and steady.",
  },
  {
    id: "zephyr",
    label: "Zephyr",
    desc: "Bright · Female",
    provider: "gemini",
    engineId: "Zephyr",
    persona: "littlebit",
    gender: "female",
    accent: "American",
    style: "Cheerful, bright",
    rate: 1.1,
    pitch: 1.1,
    premium: false,
    previewText: "Zephyr here. Bright and breezy.",
  },
  // ElevenLabs premium voices (used when ELEVENLABS_API_KEY is set)
  {
    id: "eleven_rachel",
    label: "Rachel (ElevenLabs)",
    desc: "Warm · Female",
    provider: "elevenlabs",
    engineId: "21m00Tcm4TlvDq8ikWAM",
    persona: "littlebit",
    gender: "female",
    accent: "American",
    style: "Warm, conversational",
    rate: 1.0,
    pitch: 1.0,
    premium: true,
    previewText: "Hi, I'm Rachel. litlabs.net, at your service.",
  },
  {
    id: "eleven_domi",
    label: "Domi (ElevenLabs)",
    desc: "Strong · Female",
    provider: "elevenlabs",
    engineId: "AZnzlk1XvdvUeBnXmlld",
    persona: "none",
    gender: "female",
    accent: "American",
    style: "Strong, confident",
    rate: 1.0,
    pitch: 1.0,
    premium: true,
    previewText: "Domi here. Let's ship.",
  },
  {
    id: "eleven_bella",
    label: "Bella (ElevenLabs)",
    desc: "Soft · Female",
    provider: "elevenlabs",
    engineId: "EXAVITQu4vr4xnSDxMaL",
    persona: "none",
    gender: "female",
    accent: "American",
    style: "Soft, gentle",
    rate: 1.0,
    pitch: 1.0,
    premium: true,
    previewText: "Bella here. Soft and steady.",
  },
  {
    id: "eleven_antoni",
    label: "Antoni (ElevenLabs)",
    desc: "Warm · Male",
    provider: "elevenlabs",
    engineId: "ErXwobaYiN019PkySvjV",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Warm, friendly",
    rate: 1.0,
    pitch: 1.0,
    premium: true,
    previewText: "Antoni. Let's get to work.",
  },
  {
    id: "eleven_josh",
    label: "Josh (ElevenLabs)",
    desc: "Deep · Male",
    provider: "elevenlabs",
    engineId: "TxGEqnHWrfWFTfGW9XjX",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Deep, narrative",
    rate: 0.95,
    pitch: 0.9,
    premium: true,
    previewText: "Josh here. Deep focus, let's go.",
  },
  {
    id: "eleven_arnold",
    label: "Arnold (ElevenLabs)",
    desc: "Crisp · Male",
    provider: "elevenlabs",
    engineId: "VR6AewLTigWG4xSOukaG",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Crisp, authoritative",
    rate: 1.0,
    pitch: 0.95,
    premium: true,
    previewText: "Arnold. Crisp and clear.",
  },
  {
    id: "eleven_adam",
    label: "Adam (ElevenLabs)",
    desc: "Deep · Male",
    provider: "elevenlabs",
    engineId: "pNInz6obpgDQGcFmaJgB",
    persona: "littcode",
    gender: "male",
    accent: "American",
    style: "Deep, narrative",
    rate: 0.95,
    pitch: 0.9,
    premium: true,
    previewText: "Adam. Deep and steady.",
  },
  {
    id: "eleven_sam",
    label: "Sam (ElevenLabs)",
    desc: "Raspy · Male",
    provider: "elevenlabs",
    engineId: "yoZ06aMxZJJ28mfd3POQ",
    persona: "none",
    gender: "male",
    accent: "American",
    style: "Raspy, narrative",
    rate: 1.0,
    pitch: 0.95,
    premium: true,
    previewText: "Sam. A bit rough around the edges. Ready.",
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

export function getVoiceById(id: string): VoiceDescriptor | undefined {
  return PREMIUM_VOICES.find((v) => v.id === id);
}

export function getPersonaVoice(persona: VoicePersona): VoiceDescriptor {
  // First non-broken premium voice tagged for this persona
  const match = PREMIUM_VOICES.find((v) => v.persona === persona);
  if (match) return match;
  // Fallback by gender
  if (persona === "littlebit") {
    return PREMIUM_VOICES.find((v) => v.gender === "female") ?? PREMIUM_VOICES[0];
  }
  return PREMIUM_VOICES.find((v) => v.gender === "male") ?? PREMIUM_VOICES[0];
}

/**
 * Returns true if any premium TTS service is reachable from the client.
 * Gemini TTS requires no extra config (uses the existing Gemini key).
 * ElevenLabs requires ELEVENLABS_API_KEY.
 */
export function isElevenLabsAvailable(): boolean {
  // Best-effort client detection — actual reachability is checked server-side.
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __ELEVENLABS_AVAILABLE__?: boolean }).__ELEVENLABS_AVAILABLE__);
}

export const VOICE_STORAGE_KEY = "litlabs-voice-pref";
export const VOICE_PERSONA_STORAGE_KEY = "litlabs-voice-persona";

export function loadStoredVoice(): VoiceDescriptor {
  if (typeof window === "undefined") return PREMIUM_VOICES[0];
  try {
    const id = localStorage.getItem(VOICE_STORAGE_KEY);
    if (id) {
      const v = getVoiceById(id);
      if (v) return v;
    }
  } catch {}
  return PREMIUM_VOICES[0];
}

export function saveStoredVoice(v: VoiceDescriptor): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, v.id);
  } catch {}
}

/**
 * Returns the browser's available SpeechSynthesisVoices filtered to the
 * language hints we care about (en-US, en-GB, plus anything labeled
 * "Google", "Microsoft", "Apple"). Used as a fallback for the persona
 * voice when no premium provider is reachable.
 */
export function discoverBrowserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const all = window.speechSynthesis.getVoices() || [];
  // Prefer en-US / en-GB / "natural" / "neural" voices
  const preferred = all.filter((v) => {
    if (!v.lang) return false;
    if (!v.lang.toLowerCase().startsWith("en")) return false;
    const n = v.name.toLowerCase();
    return (
      n.includes("google") ||
      n.includes("microsoft") ||
      n.includes("apple") ||
      n.includes("samantha") ||
      n.includes("alex") ||
      n.includes("daniel") ||
      n.includes("neural") ||
      n.includes("natural") ||
      n.includes("premium") ||
      n.includes("enhanced")
    );
  });
  if (preferred.length > 0) return preferred;
  // Fall back to any English voice
  return all.filter((v) => v.lang?.toLowerCase().startsWith("en"));
}
