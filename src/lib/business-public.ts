/**
 * Public site helpers for the platform form backend and the public
 * booking surface.
 *
 * Published sites are static snapshots served from /sites/[deploymentId]/
 * with no server of their own, so their forms and booking widgets call
 * back into these platform endpoints. Every public endpoint resolves the
 * `deploymentId` to the owning user via the deployment store — the
 * client is never trusted to name an owner.
 *
 * Server-only.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseDeploymentStore } from "@/lib/deployments/deployment-store";

export const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface SiteOwnerResolution {
  ok: true;
  ownerId: string;
  deploymentId: string;
}

export interface SiteOwnerFailure {
  ok: false;
  status: number;
  error: string;
}

/**
 * Resolve a public deployment id to the site owner's user id.
 * Only `ready` deployments resolve — drafts and failed deploys never
 * accept public form submissions or bookings.
 */
export async function resolveSiteOwner(
  deploymentId: string,
): Promise<SiteOwnerResolution | SiteOwnerFailure> {
  if (!deploymentId || !DEPLOYMENT_ID_PATTERN.test(deploymentId)) {
    return { ok: false, status: 400, error: "Invalid deployment id" };
  }
  if (!getSupabaseAdmin()) {
    return { ok: false, status: 503, error: "Service temporarily unavailable" };
  }
  let record;
  try {
    record = await supabaseDeploymentStore.findById(deploymentId);
  } catch {
    return { ok: false, status: 503, error: "Service temporarily unavailable" };
  }
  if (!record || record.status !== "ready") {
    return { ok: false, status: 404, error: "Site not found" };
  }
  return { ok: true, ownerId: record.userId, deploymentId: record.id };
}

// ─── CORS ───────────────────────────────────────────────────────────
// Published pages are served with `Content-Security-Policy: sandbox`
// (opaque origin), so fetch() calls from a live site to these endpoints
// are cross-origin requests with `Origin: null`. These endpoints are
// intentionally public (keyed by deployment id, rate-limited), so we
// answer CORS openly. No credentials are ever accepted.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function withCors(headers: Headers): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
}

export function corsPreflight(): Response {
  const headers = new Headers();
  withCors(headers);
  return new Response(null, { status: 204, headers });
}
