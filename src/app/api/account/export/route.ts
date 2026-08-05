import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * GET /api/account/export
 * Exports all of the authenticated user's personal data as a downloadable JSON file.
 * Implements the GDPR "right to data portability" (Article 20).
 *
 * Collects from every table that stores user data:
 *   - users (profile)
 *   - wallets (credit balance)
 *   - agent_runs, agent_steps, tool_executions, model_usage
 *   - audit_events, agent_system_notifications
 *   - music_generations, music_tracks
 *   - media_playback_history, media_playlists
 *   - user_agents, user_connections, user_preferences
 *   - connector_capabilities, connector_audit_log
 */
async function handler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find internal user UUID
    const { data: user, error: findError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("clerk_id", clerkId)
      .single();

    if (findError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = user.id;

    // Pull profile from Clerk for completeness
    let clerkProfile: Record<string, unknown> = {};
    try {
      const clerk = await clerkClient();
      const clerkUser = await clerk.users.getUser(clerkId);
      clerkProfile = {
        id: clerkUser.id,
        email: clerkUser.emailAddresses[0]?.emailAddress ?? null,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        username: clerkUser.username,
        createdAt: clerkUser.createdAt,
        lastSignInAt: clerkUser.lastSignInAt,
      };
    } catch {
      // Clerk API unavailable — proceed with Supabase data only
    }

    // Helper: safely fetch a table by user_id (UUID) or user_id (TEXT = clerkId)
    const fetchByUuid = async (table: string) => {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq("user_id", userId);
      if (error) return { error: error.message };
      return data ?? [];
    };
    const fetchByText = async (table: string) => {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq("user_id", clerkId);
      if (error) return { error: error.message };
      return data ?? [];
    };

    const exportData = {
      exportedAt: new Date().toISOString(),
      userId,
      clerkId,
      clerkProfile,
      supabaseProfile: user,
      wallets: await fetchByUuid("wallets"),
      agentRuns: await fetchByUuid("agent_runs"),
      agentSteps: await fetchByUuid("agent_steps"),
      toolExecutions: await fetchByUuid("tool_executions"),
      modelUsage: await fetchByUuid("model_usage"),
      auditEvents: await fetchByUuid("audit_events"),
      notifications: await fetchByUuid("agent_system_notifications"),
      musicGenerations: await fetchByUuid("music_generations"),
      musicTracks: await fetchByUuid("music_tracks"),
      mediaPlaybackHistory: await fetchByText("media_playback_history"),
      mediaPlaylists: await fetchByText("media_playlists"),
      userAgents: await fetchByUuid("user_agents"),
      userConnections: await fetchByText("user_connections"),
      userPreferences: await fetchByText("user_preferences"),
      connectorCapabilities: await fetchByText("connector_capabilities"),
      connectorAuditLog: await fetchByText("connector_audit_log"),
    };

    const filename = `litlabs-data-export-${clerkId}.json`;
    const json = JSON.stringify(exportData, null, 2);

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(handler, 10, 60);
