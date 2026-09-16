import "server-only";
import { cookies, headers } from "next/headers";

/**
 * Shared server-side fetch helper for the social pages (Phase 1).
 *
 * Same-origin fetches from server components do NOT carry the browser's
 * cookies or a User-Agent automatically, so this helper:
 *  - forwards the request cookies so the API sees the Clerk session and
 *    can fill viewer-specific fields (reactions, follow state),
 *  - sets an explicit User-Agent because proxy.ts bot protection rejects
 *    requests with no User-Agent (Node fetch sends none by default),
 *  - uses cache: "no-store" — feed and profile data is live.
 */
export const SSR_USER_AGENT = "litlabs-social-ssr/1.0";

async function getApiBase(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = await getApiBase();
  const cookieStore = await cookies();
  const merged = new Headers(init?.headers);
  if (!merged.has("user-agent")) {
    merged.set("User-Agent", SSR_USER_AGENT);
  }
  const cookie = cookieStore.toString();
  if (cookie && !merged.has("cookie")) {
    merged.set("cookie", cookie);
  }
  return fetch(`${base}${path}`, {
    ...init,
    cache: "no-store",
    headers: merged,
  });
}

/** Mirrors the backend contract for GET /api/users/by-username/[username]. */
export interface ProfileDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  counts: {
    posts: number;
    followers: number;
    following: number;
  };
  viewer: {
    following: boolean;
  };
}
