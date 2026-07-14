"use client";

type CachedTerminalToken = {
  token: string;
  expiresAt: number;
};

let cached: CachedTerminalToken | null = null;
let pending: Promise<string> | null = null;

export async function getTerminalToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt - now > 30_000) {
    return cached.token;
  }
  if (!forceRefresh && pending) return pending;

  pending = fetch("/api/terminal/token", {
    credentials: "include",
    cache: "no-store",
  })
    .then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Partial<
        CachedTerminalToken & { error: string }
      >;
      if (!response.ok || !body.token || !body.expiresAt) {
        throw new Error(body.error || "Terminal authentication failed");
      }
      cached = { token: body.token, expiresAt: body.expiresAt };
      return body.token;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export async function terminalAuthHeaders(): Promise<HeadersInit> {
  return {
    Authorization: `Bearer ${await getTerminalToken()}`,
    "Content-Type": "application/json",
  };
}
