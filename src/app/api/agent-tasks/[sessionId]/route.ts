import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserByClerkId } from "@/lib/user-db";
import { getAdminSupabase } from "@/lib/supabase-admin";

/**
 * GET /api/agent-tasks/[sessionId]
 *
 * Returns agent tasks for a specific orchestration session.
 * Authenticated via Clerk — the server resolves the Clerk user to an
 * internal Supabase user, then queries agent_tasks with the service
 * role key. The browser never touches Supabase directly.
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
    const user = await getUserByClerkId(clerkId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const db = getAdminSupabase();
    const { data: tasks, error } = await db
      .from("agent_tasks")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence_order", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch tasks" },
        { status: 500 },
      );
    }

    return NextResponse.json({ tasks: tasks ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
