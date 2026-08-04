import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveSystemHealth } from "@/lib/system-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system-health
 *
 * Returns canonical system health split into three honest categories:
 *   - workspace: GitHub, Vercel, Supabase (user project integration)
 *   - ai:        Gemini, OpenRouter (real probes, cached 45s)
 *   - platform:  Clerk, Supabase DB, Stripe, Terminal, Voice, …
 *
 * GitHub state is resolved from ALL canonical sources (integration_projects,
 * projects, github_installations, integration_accounts) — not just
 * integration_accounts, which caused false "Not configured" reports.
 *
 * AI provider health is probed with a real lightweight request, not just
 * env-var presence. Results are cached for 45 seconds.
 *
 * Normal users receive simplified safe statuses. Owners get fuller detail.
 * Never exposes API keys, internal hostnames, or secret identifiers.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getSupabaseAdmin();
  if (!client) {
    return NextResponse.json(
      { error: "System health unavailable — database not configured" },
      { status: 503 },
    );
  }

  const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .filter(Boolean);
  const isOwner = ADMIN_CLERK_IDS.includes(userId);

  try {
    const health = await resolveSystemHealth(client, userId, isOwner);
    return NextResponse.json(health);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Health resolution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
