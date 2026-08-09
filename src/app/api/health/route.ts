import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Public client-side configuration checks.
  // These are NEXT_PUBLIC_* values and are safe to enumerate in any environment.
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
    detail: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev",
  };

  // Determine overall status
  const allOk = Object.values(checks).every((c) => c.status === "ok");
  const degraded = Object.values(checks).every(
    (c) => c.status === "ok" || c.status === "degraded",
  );

  return NextResponse.json(
    {
      status: allOk ? "ok" : degraded ? "degraded" : "error",
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}
