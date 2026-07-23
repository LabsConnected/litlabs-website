"use client";

export type VoiceConnectionInfo = {
  token: string;
  expiresAt: number;
  endpoint: string;
  littVoice: string;
  sparkVoice: string;
};

let cached: VoiceConnectionInfo | null = null;
let pending: Promise<VoiceConnectionInfo> | null = null;

export async function getVoiceConnection(forceRefresh = false): Promise<VoiceConnectionInfo> {
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt - now > 30_000) {
    return cached;
  }
  if (!forceRefresh && pending) return pending;

  pending = fetch("/api/voice/token", {
    credentials: "include",
    cache: "no-store",
  })
    .then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Partial<
        VoiceConnectionInfo & { error: string }
      >;
      if (!response.ok || !body.token || !body.endpoint) {
        throw new Error(body.error || "Voice authentication failed");
      }
      cached = {
        token: body.token,
        expiresAt: body.expiresAt ?? Date.now() + 120_000,
        endpoint: body.endpoint,
        littVoice: body.littVoice || "rustic-banana-5826__design-voice-e5899468",
        sparkVoice: body.sparkVoice || body.littVoice || "rustic-banana-5826__design-voice-e5899468",
      };
      return cached;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export async function getVoiceToken(forceRefresh = false): Promise<string> {
  const info = await getVoiceConnection(forceRefresh);
  return info.token;
}
