"use client";

type CachedVoiceToken = {
  token: string;
  expiresAt: number;
};

let cached: CachedVoiceToken | null = null;
let pending: Promise<string> | null = null;

export async function getVoiceToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt - now > 30_000) {
    return cached.token;
  }
  if (!forceRefresh && pending) return pending;

  pending = fetch("/api/voice/token", {
    credentials: "include",
    cache: "no-store",
  })
    .then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Partial<
        CachedVoiceToken & { error: string }
      >;
      if (!response.ok || !body.token || !body.expiresAt) {
        throw new Error(body.error || "Voice authentication failed");
      }
      cached = { token: body.token, expiresAt: body.expiresAt };
      return body.token;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}
