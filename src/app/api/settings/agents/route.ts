import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getUserByClerkId, getUserPreferences, upsertUserPreferences } from "@/lib/user-db";

/**
 * GET /api/settings/agents
 *
 * Returns the agent_settings JSONB blob from user_preferences, or null
 * if no settings have been saved yet.
 */
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const prefs = await getUserPreferences(clerkId);
    if (!prefs) {
      return NextResponse.json({ agentSettings: null });
    }

    // agent_settings column may not exist yet (pre-migration)
    const agentSettings = (prefs as Record<string, unknown>).agent_settings ?? null;
    return NextResponse.json({ agentSettings });
  } catch {
    return NextResponse.json(
      { error: "Failed to load agent settings" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/settings/agents
 *
 * Saves the agent_settings JSONB blob to user_preferences.
 * Body: the full agent settings object (defaultAgent, responseStyle, etc.)
 */
async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const user = await getUserByClerkId(clerkId);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    // Validate allowed keys — reject anything unexpected
    const allowedKeys = new Set([
      "defaultAgent",
      "responseStyle",
      "spokenLength",
      "approvalRequired",
      "projectAwareness",
      "memoryUsage",
      "proactiveSuggestions",
      "terminalAccess",
      "fileWrite",
      "githubAccess",
      "deployApproval",
    ]);

    const cleanSettings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowedKeys.has(key)) {
        cleanSettings[key] = value;
      }
    }

    if (Object.keys(cleanSettings).length === 0) {
      return NextResponse.json(
        { error: "No valid agent settings fields" },
        { status: 400 },
      );
    }

    // Persist as JSONB blob in agent_settings column
    // (column added by migration 20260805100000_agent_settings_column.sql)
    await upsertUserPreferences(user.id, {
      ...({ agent_settings: cleanSettings } as Record<string, unknown>),
    } as Parameters<typeof upsertUserPreferences>[1]);

    return NextResponse.json({ agentSettings: cleanSettings });
  } catch {
    return NextResponse.json(
      { error: "Failed to update agent settings" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 60, 60);
