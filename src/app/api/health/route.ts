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
