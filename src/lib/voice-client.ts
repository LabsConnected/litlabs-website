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

  // Bound the token fetch: on a stalled mobile network an unbounded fetch
  // left the composer sitting on "Connecting…" forever with no error and
  // no way out. Ten seconds matches the scale of the session-ready wait
  // downstream; an abort surfaces as the connect-timeout message.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  pending = fetch("/api/voice/token", {
    credentials: "include",
    cache: "no-store",
    signal: controller.signal,
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
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("Voice connection timed out. Please try again.");
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timeoutId);
      pending = null;
    });

  return pending;
}

export async function getVoiceToken(forceRefresh = false): Promise<string> {
  const info = await getVoiceConnection(forceRefresh);
  return info.token;
}
