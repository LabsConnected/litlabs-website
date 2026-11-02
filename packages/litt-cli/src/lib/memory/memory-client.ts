/**
 * Shared-memory client — LiTT CLI's read/write access to the website's
 * owner-scoped memory store (Supabase `memories` table, fronted by
 * `/api/memory` on the website backend).
 *
 * Reuses the CLI's EXISTING Clerk OAuth session (getAuthSession()) for
 * auth — no new login flow, no new token type. If the user isn't
 * signed in, every call here fails closed with a clear error instead
 * of silently operating as an anonymous/unscoped caller.
 */

import { getAuthSession } from "../auth/auth-session.js";
import { getApiBaseUrl } from "../api-config.js";

export type MemoryScope = "profile" | "preference" | "agent" | "project" | "conversation" | "temporary";

export interface MemoryRecord {
  id: string;
  owner_id: string;
  content: string;
  scope: MemoryScope;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export class MemoryClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MemoryClientError";
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAuthSession().getAccessToken();
  if (!token) {
    throw new MemoryClientError(
      "Not signed in — run `litt login` before using shared memory.",
    );
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * Create a memory record for the signed-in user.
 */
export async function createMemory(
  content: string,
  options: { scope?: MemoryScope; metadata?: Record<string, unknown> } = {},
): Promise<MemoryRecord> {
  const headers = await authHeader();
  const res = await fetch(`${getApiBaseUrl()}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      content,
      scope: options.scope ?? "profile",
      metadata: options.metadata ?? {},
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new MemoryClientError(
      typeof body?.error === "string" ? body.error : `createMemory failed: ${res.status}`,
      res.status,
    );
  }
  return body.memory as MemoryRecord;
}

/**
 * Retrieve the signed-in user's recent memories (optionally scoped and
 * optionally filtered by a text query). Cross-device by construction —
 * this hits the same owner-scoped `/api/memory` the website and the
 * mobile companion app use, so it returns the same records regardless
 * of which device wrote them.
 */
export async function listMemories(
  options: { query?: string; scope?: MemoryScope; limit?: number } = {},
): Promise<MemoryRecord[]> {
  const headers = await authHeader();
  const params = new URLSearchParams();
  if (options.query) params.set("q", options.query);
  if (options.scope) params.set("scope", options.scope);
  if (options.limit) params.set("limit", String(options.limit));

  const res = await fetch(`${getApiBaseUrl()}/api/memory?${params.toString()}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new MemoryClientError(
      typeof body?.error === "string" ? body.error : `listMemories failed: ${res.status}`,
      res.status,
    );
  }
  return (body.memories ?? []) as MemoryRecord[];
}
