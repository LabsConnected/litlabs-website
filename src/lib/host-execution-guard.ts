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

/**
 * Owner-approved two-key operator opt-in (identical names in
 * terminal-server/isolation-policy.ts). Both must be exactly "true".
 */
export const LOCAL_EXECUTION_OPT_IN_VAR = "LITT_LOCAL_EXECUTION_OPT_IN";
/**
 * Operator ATTESTATION that isolation was verified on this machine. It records
 * a claim; it does not create isolation, and no sandbox-verification
 * infrastructure exists yet. Must never be set in production (production-like
 * environments ignore it). Becomes a programmatic check when real sandbox
 * verification lands.
 */
export const ISOLATION_VERIFIED_VAR = "LITT_ISOLATION_VERIFIED";
const OPT_IN_VALUE = "true";
/** Set by scripts/dev-network.mjs from the real bind address. */
export const RESOLVED_BIND_HOST = "LITT_RESOLVED_BIND_HOST";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLocalExecutionOptedIn(env: Env = process.env): boolean {
  return env[LOCAL_EXECUTION_OPT_IN_VAR] === OPT_IN_VALUE && env[ISOLATION_VERIFIED_VAR] === OPT_IN_VALUE;
}

/**
 * DEFAULT-DENY. Permitted only when ALL hold: NODE_ENV is exactly
 * "development" or "test"; no Railway/Vercel marker; the two-key opt-in is
 * set; and the dev server is bound to loopback. NODE_ENV alone is never
 * enough: a remotely reachable dev server must not run commands for whoever
 * can reach it. Missing/unknown values deny. Feature flags (TERMINAL_ENABLED,
 * ENABLE_AGENT_COMMANDS, ENABLE_LOCAL_BUILD_API, ADMIN_*) never override.
 */
export function isLocalDevelopment(env: Env = process.env): boolean {
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return false;
  if (hasHostedMarker(env)) return false;
  if (!isLocalExecutionOptedIn(env)) return false;
  const bind = env[RESOLVED_BIND_HOST];
  return bind !== undefined && LOOPBACK_HOSTS.has(bind);
}

/**
 * Complement of isLocalDevelopment, so anything not provably local is
 * treated as production-like.
 */
export function isProductionLike(env: Env = process.env): boolean {
  return !isLocalDevelopment(env);
}

/** True when child processes may run directly on this host (trusted local only). */
export function isHostExecutionPermitted(env: Env = process.env): boolean {
  return isLocalDevelopment(env);
}

/** Headers a reverse proxy / tunnel / CDN adds. Any of them => not a direct local request. */
const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "true-client-ip",
  "via",
] as const;

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]")); // [::1]:3001
  return h.split(":")[0];
}

/**
 * True when a request cannot be shown to be a direct request to a loopback
 * listener: it carries proxy/tunnel headers, or its Host is missing or not a
 * loopback name. A loopback-bound server behind ngrok/Cloudflare/nginx/Tailscale
 * Funnel still receives requests from untrusted parties, so those are refused.
 * Local execution is for the developer's own browser on the same machine only.
 */
export function isUntrustedLocalRequest(headers: { get(name: string): string | null }): boolean {
  if (PROXY_HEADERS.some((h) => headers.get(h) !== null)) return true;
  const host = headers.get("host");
  if (!host) return true;
  return !LOOPBACK_HOSTS.has(hostnameOf(host));
}

export const HOST_EXECUTION_DISABLED_CODE = "HOST_EXECUTION_DISABLED" as const;

/**
 * Thrown by library-level execution boundaries (docker provider, git clone).
 * Request handlers map it to 503 HOST_EXECUTION_DISABLED.
 */
export class HostExecutionDisabledError extends Error {
  readonly code = HOST_EXECUTION_DISABLED_CODE;
  readonly context: string;
  readonly statusCode = 503;
  constructor(context: string) {
    super(
      `Host execution is not permitted (${context}). Default-deny: execution requires a ` +
        `trusted local environment with explicit operator opt-in, and is never permitted ` +
        `in production. Failing closed.`,
    );
    this.name = "HostExecutionDisabledError";
    this.context = context;
  }
}

/** Throws HostExecutionDisabledError unless host execution is permitted. */
export function assertHostExecutionPermitted(context: string, env: Env = process.env): void {
  if (!isHostExecutionPermitted(env)) throw new HostExecutionDisabledError(context);
}

/** JSON body for a refusal; pair with status 503. */
export function hostExecutionDisabledResponse(context: string): {
  error: string;
  code: typeof HOST_EXECUTION_DISABLED_CODE;
  context: string;
} {
  return {
    error: "Execution is unavailable on this deployment. No verified sandbox isolation exists.",
    code: HOST_EXECUTION_DISABLED_CODE,
    context,
  };
}

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
  req?: { headers: { get(name: string): string | null } },
): Response | null {
  // `req` is optional only for non-request callers; every API route passes it.
  if (isHostExecutionPermitted(env) && !(req && isUntrustedLocalRequest(req.headers))) return null;
  return Response.json(
    {
      error: `Host execution is disabled (${surface}): not a trusted local request, and no verified sandbox exists`,
      code: HOST_EXECUTION_DISABLED_CODE,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
