"use client";

type CachedTerminalToken = {
  token: string;
  expiresAt: number;
};

let cached: CachedTerminalToken | null = null;
let pending: Promise<string> | null = null;

export function clearTerminalTokenCache() {
  cached = null;
  pending = null;
}

export async function getTerminalToken(
  forceRefresh = false,
  projectId?: string,
  authToken?: string,
): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt - now > 30_000) {
    return cached.token;
  }
  if (!forceRefresh && pending) return pending;

  const url = projectId
    ? `/api/terminal/token?projectId=${encodeURIComponent(projectId)}`
    : "/api/terminal/token";

  const headers: HeadersInit = authToken
    ? { Authorization: `Bearer ${authToken}` }
    : {};

  pending = fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers,
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
