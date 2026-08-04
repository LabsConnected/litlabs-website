import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getRole } from "@/lib/roles";
import {
  isOwnerClerkId,
  resolveActiveProject,
  resolveMissions,
  resolveActivity,
  resolveHealth,
  resolveBilling,
  resolveGrowth,
  type MissionControlResponse,
} from "@/lib/mission-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/mission-control
 *
 * Aggregated Mission Control response for the /dashboard page.
 *
 * Returns:
 *   - role / ownerMode (server-resolved)
 *   - project: canonical active project runtime (or null)
 *   - missions: active missions with progress and state
 *   - activity: recent platform/project events
 *   - health: flat HealthService[] grouped by platform/workspace/provider
 *   - billing: LiTTBits balance + plan (revenue/cost owner-only)
 *   - growth: owner-only live presence + funnel metrics (null for normal users)
 *
 * Security:
 *   - Owner is resolved server-side via ADMIN_CLERK_IDS + Clerk role metadata
 *   - Normal users never receive growth, revenue, or provider cost
 *   - No API keys, internal hostnames, or secrets are exposed
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getSupabaseAdmin();
  if (!client) {
    // Graceful degradation — return minimal valid response
    return NextResponse.json({
      role: "user" as const,
      ownerMode: false,
      project: null,
      missions: [],
      activity: [],
      health: [],
      growth: null,
      billing: { balance: 0, plan: "Starter", revenueTodayCents: null, estimatedProviderCostTodayCents: null },
    } satisfies MissionControlResponse);
  }

  // Resolve owner status server-side
  const ownerFromEnv = isOwnerClerkId(userId);
  let role: "owner" | "admin" | "user" = "user";
  try {
    const roleStr = await getRole();
    if (roleStr === "owner") role = "owner";
    else if (roleStr === "admin") role = "admin";
  } catch {
    // getRole uses Clerk server auth which may not be available in API context
  }
  if (ownerFromEnv) role = "owner";
  const ownerMode = role === "owner";

  try {
    // Parallel resolution of independent data
    const [project, missions, activity, health, billing] = await Promise.all([
      resolveActiveProject(client, userId),
      resolveMissions(client, userId),
      resolveActivity(client, userId),
      resolveHealth(client, userId, ownerMode),
      resolveBilling(client, userId, ownerMode),
    ]);

    // Growth is owner-only — do not fetch for normal users
    const growth = ownerMode ? await resolveGrowth(client) : null;

    const response: MissionControlResponse = {
      role,
      ownerMode,
      project,
      missions,
      activity,
      health,
      growth,
      billing,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mission Control unavailable";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
