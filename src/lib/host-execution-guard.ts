/**
 * Web-app host-execution guard (Security Gate 1).
 *
 * terminal-server/isolation-policy.ts closes host execution inside the
 * terminal-server process. A handful of Next.js API routes also start child
 * processes on the web host (CLI bridge shell, agent command runner, local
 * build checks). Admin-only or flag-gated is access control, not isolation,
 * so in a production-like environment those routes fail closed too, even for
 * an admin with the enabling flag set. There is deliberately no override
 * variable.
 *
 * Dependency-free on purpose: no "server-only", no Next imports, so it can be
 * unit-tested directly and cannot be bypassed by a failing import.
 *
 * Keep in sync with terminal-server/isolation-policy.ts. The web app also
 * treats Vercel as production-like. Parity is asserted in
 * tests/host-execution-guard.test.ts.
 */

type Env = Record<string, string | undefined>;

/** Markers injected by Railway into every deployed service. */
const RAILWAY_MARKERS = [
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_GIT_COMMIT_SHA",
] as const;

/** Markers injected by Vercel into every deployed build/runtime. */
const VERCEL_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL"] as const;

/**
 * True for production AND for anything hosted on Railway or Vercel. Defaults
 * to the safe side: a mis-set or missing NODE_ENV on a hosted service is still
 * production.
 */
export function isProductionLike(env: Env = process.env): boolean {
  if (env.NODE_ENV === "production") return true;
  return [...RAILWAY_MARKERS, ...VERCEL_MARKERS].some((key) => Boolean(env[key]));
}

/** True when child processes may run directly on this host (local dev only). */
export function isHostExecutionPermitted(env: Env = process.env): boolean {
  return !isProductionLike(env);
}

export const HOST_EXECUTION_DISABLED_CODE = "HOST_EXECUTION_DISABLED" as const;

/**
 * Returns a 503 Response when host execution is closed, otherwise null.
 * Call it AFTER authentication so unauthenticated callers learn nothing, and
 * BEFORE any process is started or any session state is created.
 *
 *   const blocked = hostExecutionBlockedResponse("bridge-cli");
 *   if (blocked) return blocked;
 */
export function hostExecutionBlockedResponse(
  surface: string,
  env: Env = process.env,
): Response | null {
  if (isHostExecutionPermitted(env)) return null;
  return Response.json(
    {
      error: `Host execution is disabled in production (${surface}); a verified sandbox is required`,
      code: HOST_EXECUTION_DISABLED_CODE,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
