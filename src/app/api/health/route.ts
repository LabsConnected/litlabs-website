import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Check environment variables
  const required = [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  checks.env = {
    status: missing.length === 0 ? "ok" : "degraded",
    detail: missing.length === 0 ? undefined : `Missing: ${missing.join(", ")}`,
  };

  // Check build SHA
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
