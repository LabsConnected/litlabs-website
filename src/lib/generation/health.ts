import "server-only";
import type { ProviderHealth, ProviderHealthState } from "./types";

/**
 * Provider health checks.
 *
 * Health is NOT "env var exists" — it's "can we actually reach the provider?"
 * Each probe makes a minimal API call to verify the provider is responding.
 *
 * Results are cached for 45 seconds to avoid hammering provider APIs.
 */

const CACHE_MS = 45_000;
const PROBE_TIMEOUT_MS = 8_000;

interface CachedHealth {
  result: ProviderHealth;
  expiresAt: number;
}

const cache = new Map<string, CachedHealth>();

function now(): string {
  return new Date().toISOString();
}

function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  return fn().then((result) => ({ result, ms: Date.now() - t0 }));
}

async function probeFetch(
  id: string,
  url: string,
  init?: RequestInit,
): Promise<ProviderHealth> {
  const lastChecked = now();

  try {
    const { result: res, ms } = await timed(() =>
      fetch(url, {
        ...init,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }),
    );

    if (res.ok) {
      return { id, state: "healthy", detail: `OK · ${ms}ms`, latencyMs: ms, lastChecked };
    }
    if (res.status === 401 || res.status === 403) {
      return { id, state: "not_configured", detail: "Key rejected", latencyMs: ms, lastChecked };
    }
    if (res.status === 429) {
      return { id, state: "rate_limited", detail: "Rate limited", latencyMs: ms, lastChecked };
    }
    if (res.status >= 500) {
      return { id, state: "failed", detail: `Server error ${res.status}`, latencyMs: ms, lastChecked };
    }
    return { id, state: "degraded", detail: `Unexpected ${res.status}`, latencyMs: ms, lastChecked };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { id, state: "failed", detail: msg, latencyMs: null, lastChecked };
  }
}

function notConfigured(id: string): ProviderHealth {
  return { id, state: "not_configured", detail: "API key required", latencyMs: null, lastChecked: now() };
}

function cached(id: string, fn: () => Promise<ProviderHealth>): Promise<ProviderHealth> {
  const entry = cache.get(id);
  if (entry && Date.now() < entry.expiresAt) {
    return Promise.resolve(entry.result);
  }
  return fn().then((result) => {
    cache.set(id, { result, expiresAt: Date.now() + CACHE_MS });
    return result;
  });
}

// ─── Individual provider probes ─────────────────────────────────

export async function probeGeminiImage(): Promise<ProviderHealth> {
  return cached("gemini-image", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return notConfigured("gemini-image");
    return probeFetch(
      "gemini-image",
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      },
    );
  });
}

export async function probeVeo(): Promise<ProviderHealth> {
  return cached("veo", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return notConfigured("veo");
    // Veo uses the same Gemini API key — just check if the models endpoint lists it
    return probeFetch(
      "veo",
      `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview?key=${key}`,
    );
  });
}

export async function probeLyria(): Promise<ProviderHealth> {
  return cached("lyria", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return notConfigured("lyria");
    return probeFetch(
      "lyria",
      `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-pro-preview?key=${key}`,
    );
  });
}

export async function probeElevenLabsMusic(): Promise<ProviderHealth> {
  return cached("elevenlabs-music", async () => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return notConfigured("elevenlabs-music");
    // Check user subscription endpoint (lightweight)
    return probeFetch("elevenlabs-music", "https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key },
    });
  });
}

export async function probeGroq(): Promise<ProviderHealth> {
  return cached("groq", async () => {
    const key = process.env.GROQ_API_KEY;
    if (!key) return notConfigured("groq");
    return probeFetch("groq", "https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
  });
}

export async function probeAlibaba(): Promise<ProviderHealth> {
  return cached("alibaba", async () => {
    const key = process.env.ALIBABA_DASHSCOPE_API_KEY;
    if (!key) return notConfigured("alibaba");
    return probeFetch(
      "alibaba",
      "https://dashscope.aliyuncs.com/api/v1/models",
      { headers: { Authorization: `Bearer ${key}` } },
    );
  });
}

export async function probeRecraft(): Promise<ProviderHealth> {
  return cached("recraft", async () => {
    const key = process.env.RECRAFT_API_KEY;
    if (!key) return notConfigured("recraft");
    return probeFetch("recraft", "https://external.api.recraft.ai/v1/images", {
      headers: { Authorization: `Bearer ${key}` },
    });
  });
}

// ─── Aggregate health ────────────────────────────────────────────

export interface MediaHealthSummary {
  image: ProviderHealth;
  video: ProviderHealth;
  music: ProviderHealth;
  speech: ProviderHealth;
  anyHealthy: boolean;
}

/**
 * Get health for all media generation modalities.
 * Each modality reports the health of its primary provider.
 */
export async function getMediaHealth(): Promise<MediaHealthSummary> {
  const [image, video, music, speech] = await Promise.all([
    probeGeminiImage(),
    probeVeo(),
    probeLyria().then((lyria) =>
      lyria.state === "healthy"
        ? lyria
        : probeElevenLabsMusic().then((eleven) =>
            eleven.state === "healthy" ? eleven : lyria,
          ),
    ),
    probeGroq(),
  ]);

  return {
    image,
    video,
    music,
    speech,
    anyHealthy: [image, video, music, speech].some((h) => h.state === "healthy"),
  };
}
