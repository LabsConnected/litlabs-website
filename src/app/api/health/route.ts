import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

async function checkDatabase(): Promise<{ status: string; detail?: string }> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const client = getSupabaseAdmin();
    if (!client) return { status: "degraded", detail: "Supabase not configured" };
    const { error } = await client.from("users").select("id").limit(1);
    if (error) return { status: "degraded", detail: `DB query failed: ${error.code}` };
    return { status: "ok" };
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : "DB check failed" };
  }
}

async function checkTerminalServer(): Promise<{ status: string; detail?: string }> {
  // Use HTTP URLs for the health check — wss:// URLs cannot be fetched
  const terminalUrl = process.env.TERMINAL_SERVER_INTERNAL_URL ??
    process.env.TERMINAL_SERVER_URL ??
    process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL ??
    null;
  if (!terminalUrl) return { status: "degraded", detail: "Terminal server URL not configured" };
  // Normalize: strip wss:// → https://, ws:// → http:// for the fetch
  const httpUrl = terminalUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${httpUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return { status: "degraded", detail: `Terminal server returned ${resp.status}` };
    return { status: "ok" };
  } catch {
    return { status: "degraded", detail: "Terminal server unreachable" };
  }
}

function checkStorage(): { status: string; detail?: string } {
  const r2Configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID);
  const supabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (r2Configured) return { status: "ok", detail: "R2" };
  if (supabaseConfigured) return { status: "ok", detail: "Supabase Storage" };
  return { status: "degraded", detail: "No storage backend configured" };
}

/**
 * Never echo anything that looks like a secret value into a health-check
 * response. Clerk's SDK error messages are expected to contain only a
 * generic reason, but this is defense in depth — never trust that an
 * upstream error message is safe to forward verbatim.
 */
function redactSecretLike(message: string): string {
  return message.replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]+/g, "$1_$2_***REDACTED***").slice(0, 200);
}

let clerkAuthCache: { at: number; result: { status: string; detail?: string } } | null = null;
const CLERK_AUTH_CACHE_MS = 60_000;

/**
 * Verify CLERK_SECRET_KEY actually authenticates against Clerk's backend —
 * not just that it's present.
 *
 * docs/qa/production-login-recovery-20260902.md documents a real incident:
 * a present-but-invalid CLERK_SECRET_KEY passed every "is it set" check
 * while sign-in was completely broken in production, because Clerk's
 * backend rejected it (`secret-key-invalid`) at request time. This check
 * makes the same class of failure visible here instead of only in Railway
 * runtime logs after a user reports being locked out.
 *
 * Uses clerk.users.getCount() — the cheapest real backend call that still
 * requires a valid secret key to succeed. Cached for CLERK_AUTH_CACHE_MS
 * so this endpoint (hit by Railway's healthcheck, uptime monitors, and
 * release-gate.yml every 30 minutes) doesn't hammer Clerk's API.
 */
async function checkClerkAuth(): Promise<{ status: string; detail?: string }> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return { status: "degraded", detail: "CLERK_SECRET_KEY not set" };
  }

  if (clerkAuthCache && Date.now() - clerkAuthCache.at < CLERK_AUTH_CACHE_MS) {
    return clerkAuthCache.result;
  }

  let result: { status: string; detail?: string };
  try {
    const { createClerkClient } = await import("@clerk/backend");
    const clerk = createClerkClient({ secretKey });
    // clerk.users.getCount() takes no signal/timeout option, so bound it
    // with our own race rather than leaving a hung Clerk API call to block
    // this health check indefinitely.
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("Clerk backend request timed out")), 3000);
    });
    try {
      await Promise.race([clerk.users.getCount(), timeoutPromise]);
      result = { status: "ok" };
    } finally {
      clearTimeout(timeoutHandle!);
    }
  } catch (err) {
    // "degraded", not "error" — this is a persistent config problem, not a
    // transient one. "error" maps to HTTP 503, which triggers Railway's
    // restart policy; restarting the container cannot fix a bad secret key
    // (the new instance would boot with the same broken env var) and would
    // just crash-loop the whole service over an auth-specific problem.
    // "degraded" still fails release-gate.yml and `litt production doctor`.
    const message = err instanceof Error ? err.message : "Clerk backend rejected the request";
    result = { status: "degraded", detail: `Clerk auth check failed: ${redactSecretLike(message)}` };
  }

  clerkAuthCache = { at: Date.now(), result };
  return result;
}

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Public client-side configuration checks
  const publicRequired = [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  const publicMissing = publicRequired.filter((k) => !process.env[k]);
  checks.env = {
    status: publicMissing.length === 0 ? "ok" : "degraded",
    detail:
      publicMissing.length === 0
        ? undefined
        : isProduction()
          ? "Required public configuration is missing"
          : `Missing: ${publicMissing.join(", ")}`,
  };

  // Build/deploy identity
  checks.build = {
    status: "ok",
    detail: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
      "dev",
  };

  // Database connectivity
  checks.database = await checkDatabase();

  // Terminal server reachability
  checks.terminal = await checkTerminalServer();

  // Storage backend
  checks.storage = checkStorage();

  // Clerk backend auth — a real handshake, not just "is the key set"
  checks.auth = await checkClerkAuth();

  // Determine overall status
  // - "ok" or "degraded" → HTTP 200 (service is alive, Railway healthcheck passes)
  // - "error" → HTTP 503 (service is broken, Railway will restart)
  const hasError = Object.values(checks).some((c) => c.status === "error");
  const allOk = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json(
    {
      service: "web",
      status: allOk ? "ok" : hasError ? "error" : "degraded",
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ??
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
        "dev",
      version: process.env.npm_package_version ?? "unknown",
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: hasError ? 503 : 200 },
  );
}
