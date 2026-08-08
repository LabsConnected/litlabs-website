"use client";

import { useClerkAuth } from "@/hooks/useClerkAuth";

/**
 * Returns a fetch wrapper that sends `credentials: "include"` and an
 * `Authorization: Bearer <token>` header when the user is signed in.
 *
 * This fixes the "signed in on the frontend but 401 on the API" failure
 * that occurs when marketplace fetch calls don't send cookies or the
 * Clerk session token.
 *
 * Usage:
 *   const authedFetch = useAuthedFetch();
 *   const res = await authedFetch("/api/marketplace/agents/.../install", { method: "POST" });
 */
export function useAuthedFetch() {
  const { getToken } = useClerkAuth();

  return async function authedFetch(
    input: string,
    init?: RequestInit,
  ): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, {
      ...init,
      headers,
      credentials: "include",
    });
  };
}
