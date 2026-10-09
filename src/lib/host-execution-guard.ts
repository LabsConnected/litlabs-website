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
 * Same rule as terminal-server/isolation-policy.ts (isTrustedLocalEnvironment):
 * allow-only-on-positively-verified-local. Parity is asserted in
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

function hasHostedMarker(env: Env): boolean {
  return [...RAILWAY_MARKERS, ...VERCEL_MARKERS].some((key) => Boolean(env[key]));
}

/** Explicit opt-in; must match terminal-server/isolation-policy.ts. */
export const LOCAL_HOST_EXEC_OPT_IN = "LITT_ALLOW_LOCAL_HOST_EXEC";
/** Set by scripts/dev-network.mjs from the real bind address. */
export const RESOLVED_BIND_HOST = "LITT_RESOLVED_BIND_HOST";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * DEFAULT-DENY. Permitted only when ALL hold: NODE_ENV is exactly
 * "development" or "test"; no Railway/Vercel marker; LITT_ALLOW_LOCAL_HOST_EXEC
 * is exactly "1"; and the dev server is bound to loopback. NODE_ENV alone is
 * never enough: a remotely reachable dev server must not run commands for
 * whoever can reach it. Missing/unknown values deny.
 */
export function isLocalDevelopment(env: Env = process.env): boolean {
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return false;
  if (hasHostedMarker(env)) return false;
  if (env[LOCAL_HOST_EXEC_OPT_IN] !== "1") return false;
  const bind = env[RESOLVED_BIND_HOST];
  return bind !== undefined && LOOPBACK_HOSTS.has(bind);
}

/**
 * Kept for callers/tests that ask "is this a deployed environment?". It is the
 * exact complement of isLocalDevelopment, so anything not provably local is
 * treated as production-like.
 */
export function isProductionLike(env: Env = process.env): boolean {
  return !isLocalDevelopment(env);
}

/** True when child processes may run directly on this host (local dev only). */
export function isHostExecutionPermitted(env: Env = process.env): boolean {
  return isLocalDevelopment(env);
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
