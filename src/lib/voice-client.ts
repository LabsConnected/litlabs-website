"use client";

export type VoiceConnectionInfo = {
  token: string;
  expiresAt: number;
  endpoint: string;
  littVoice: string;
  sparkVoice: string;
  /**
   * Non-reversible fingerprint (12 hex chars of SHA-256) of the
   * VOICE_AUTH_SECRET the token was signed with. Used to detect a
   * website/voice-proxy credential mismatch after a double-4001.
   */
  secretFp?: string;
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
        littVoice: body.littVoice || "",
        sparkVoice: body.sparkVoice || body.littVoice || "",
        secretFp: body.secretFp,
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
