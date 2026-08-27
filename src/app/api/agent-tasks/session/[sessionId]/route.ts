import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase } from "@/lib/supabase-admin";

/**
 * GET /api/agent-tasks/session/[sessionId]
 *
 * Returns the authenticated user's agent tasks for one orchestration
 * session, in sequence order.
 *
 * Lives under `session/` rather than as a bare `[sessionId]` segment:
 * Next.js refuses two differently-named dynamic slugs at the same path
 * level, and `/api/agent-tasks/[taskId]` already occupies that slot.
 * Having both broke the build outright.
 *
 * Authorization: the query is scoped by BOTH session_id and user_id.
 *
 * Scoping by session_id alone was an IDOR: this route queries with the
 * SERVICE ROLE key, which bypasses RLS, so the WHERE clause is the only
 * thing standing between one user's data and another's. A sessionId is
 * a bearer-ish identifier that travels through URLs, logs and client
 * state — knowing one must not be sufficient to read its tasks, and
 * task_input/task_output carry user prompts and results.
 *
 * `agent_tasks.user_id` is TEXT holding the CLERK id (see
 * 20260714030000_usage_stats_schema_fixes.sql, and the insert in
 * ../route.ts) — not the internal users.id UUID. Both sibling routes
 * (`/api/agent-tasks` and `/api/agent-tasks/[taskId]`) scope the same
 * way; this one now matches them.
 *
 * Rows predating that migration have user_id NULL and were deliberately
 * never backfilled, so they match no user and are returned to nobody.
 * That is the intended direction to fail: an unattributable row is not
 * served to everyone.
 *
 * Realtime updates are not provided here — clients should poll this
 * endpoint at a reasonable interval (e.g. 2s) while a session is active.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  if (!sessionId || sessionId.length < 1) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  try {
    const db = getAdminSupabase();
    const { data: tasks, error } = await db
      .from("agent_tasks")
      .select("*")
      .eq("session_id", sessionId)
      // Ownership filter — do NOT remove. See the authorization note above.
      .eq("user_id", clerkId)
      .order("sequence_order", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch tasks" },
        { status: 500 },
      );
    }

    // An empty array covers both "no such session" and "not yours", so
    // the response does not disclose whether a foreign sessionId exists.
    return NextResponse.json({ tasks: tasks ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
