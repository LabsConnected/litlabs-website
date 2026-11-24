/**
 * LiTT Hosting — the canonical publish abstraction.
 *
 * This module is the ONLY thing the user-site publishing model knows about
 * where sites live. The model (deploy-service, the deployment store, the
 * Studio UI, the /deployments page, API responses) talks about "LiTT
 * Hosting" and the deploy target below. It never names an infrastructure
 * provider.
 *
 * Infrastructure providers (Railway, Vercel, whatever actually serves the
 * bytes) are implementation details behind the HostingBackend interface.
 * They never leak into the publishing model, UI copy, or API responses.
 * Swapping infrastructure means writing a new HostingBackend and
 * registering it here — callers do not change.
 *
 * The deploy target "litt-static" is the seed of this abstraction: LiTT
 * Hosting's static-site tier. It is formalized here rather than replaced,
 * so existing deployment rows keep their meaning.
 */

import { createRailwayHostingBackend } from "./railway-backend";

/**
 * The canonical deploy target for user-site publishing: LiTT Hosting,
 * static tier. Stored on every deployment row. Never caller-selectable.
 */
export const HOSTING_TARGET = "litt-static" as const;

/** The name users see in UI copy and API responses. */
export const HOSTING_DISPLAY_NAME = "LiTT Hosting" as const;

/** Fast, network-free answer to "can this backend publish right now?" */
export type HostingConfigCheck = { ok: true } | { ok: false; reason: string };

/**
 * An infrastructure adapter behind LiTT Hosting.
 *
 * - `isConfigured()` is synchronous and never touches the network: it
 *   answers whether publishing can even be attempted.
 * - `resolveBaseUrl()` returns the real public base URL, resolved from the
 *   actual infrastructure (not from caller input, not from a guess). The
 *   deploy service appends the deployment path and verifies the result
 *   over HTTP before anything is reported as live.
 *
 * A future backend that needs a real build step (trigger/poll) implements
 * it internally and still resolves through this interface — callers stay
 * untouched.
 */
export interface HostingBackend {
  isConfigured(): HostingConfigCheck;
  resolveBaseUrl(): Promise<string>;
}

/** Registry of hosting backends. The canonical entry is "litt-hosting". */
const BACKENDS: Record<string, () => HostingBackend> = {
  "litt-hosting": () => createRailwayHostingBackend(),
};

export const CANONICAL_HOSTING_BACKEND = "litt-hosting";

/**
 * Return the canonical LiTT Hosting backend (or the named one).
 *
 * Throws for unknown names rather than guessing — a misconfigured backend
 * name is a bug, and failing loudly here keeps it from becoming a silent
 * publish to the wrong place.
 */
export function getHostingBackend(name: string = CANONICAL_HOSTING_BACKEND): HostingBackend {
  const factory = BACKENDS[name];
  if (!factory) {
    throw new Error(
      `Unknown hosting backend "${name}". Available: ${Object.keys(BACKENDS).join(", ")}.`,
    );
  }
  return factory();
}

/**
 * ACC-01 F8a — the ONE stable public path for a project.
 *
 * Per-deployment snapshot URLs (/sites/<deploymentId>/) are immutable:
 * every publish mints a new one and the old address serves the old
 * snapshot forever. Users share ONE address, so the project's public
 * address must not rotate: /sites/project/<projectId>/ always resolves
 * the project's latest READY LiTT Hosting deployment at request time
 * (see src/app/sites/project/[projectId]).
 */
export function stableSitePathForProject(projectId: string): string {
  return `/sites/project/${projectId}/`;
}

/**
 * The project's stable public URL, built on the same infrastructure
 * base the deploy service mints per-deployment publicUrls from — so
 * staging/production origins are correct by construction. Throws when
 * the hosting backend cannot resolve a base URL; callers that present
 * the URL opportunistically (status endpoints) catch and omit it
 * rather than guessing an origin.
 */
export async function stablePublicUrlFor(
  projectId: string,
  hosting: HostingBackend = getHostingBackend(),
): Promise<string> {
  const baseUrl = await hosting.resolveBaseUrl();
  return `${baseUrl.replace(/\/+$/, "")}${stableSitePathForProject(projectId)}`;
}
