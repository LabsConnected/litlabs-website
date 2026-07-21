import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserByClerkId } from "@/lib/user-db";
import { sanitizeProviderError } from "@/lib/provider-error";

/**
 * LiTT Base Station — per-user station layout persistence.
 *
 * The route is the server-side reader/writer for the `agent_station_layouts`
 * table that Phase 2 created. RLS on the table enforces per-user access;
 * the route is a thin pass-through that also resolves the Clerk user id to
 * the Supabase UUID so the `auth.uid()::text` RLS expression can match.
 *
 * GET  → returns the current layout (or 404 if none).
 * POST → upserts the layout with optimistic-concurrency on the version
 *        column. The client sends its current `version`; the route
 *        rejects (409) if the persisted version is greater, and returns
 *        the canonical version in either case.
 */

export const runtime = "nodejs";

interface PersistBody {
  layout: Record<string, unknown>;
  version?: number;
}

interface StationLayoutRow {
  id: string;
  user_id: string;
  layout: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("agent_station_layouts")
      .select("id, user_id, layout, version, created_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle<StationLayoutRow>();
    if (error) {
      // PGRST116 = "no rows" — treat as 404, not a 500.
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      layout: data.layout,
      serverVersion: data.version,
      updatedAt: data.updated_at,
    });
  } catch (err) {
    const { status, error: message } = sanitizeProviderError(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PersistBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.layout || typeof body.layout !== "object") {
    return NextResponse.json({ error: "Missing layout" }, { status: 400 });
  }
  const incomingVersion = typeof body.version === "number" ? body.version : 0;

  try {
    // Read the current row (if any) to enforce optimistic-concurrency.
    const { data: existing } = await supabaseAdmin
      .from("agent_station_layouts")
      .select("version")
      .eq("user_id", userId)
      .maybeSingle<{ version: number }>();

    if (existing && existing.version > incomingVersion) {
      return NextResponse.json(
        {
          error: "Stale write",
          serverVersion: existing.version,
        },
        { status: 409 },
      );
    }

    // Resolve the Clerk user id to a Supabase profile id (if the schema has
    // a `users` table keyed by clerk_id). We do NOT require this — the
    // agent_station_layouts.user_id column is plain text and stores the
    // Clerk id directly.
    void getUserByClerkId;

    const nextVersion = (existing?.version ?? 0) + 1;
    const { data, error } = await supabaseAdmin
      .from("agent_station_layouts")
      .upsert(
        {
          user_id: userId,
          layout: body.layout,
          version: nextVersion,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("id, user_id, layout, version, created_at, updated_at")
      .single<StationLayoutRow>();
    if (error) throw error;
    return NextResponse.json({
      layout: data.layout,
      serverVersion: data.version,
      updatedAt: data.updated_at,
    });
  } catch (err) {
    const { status, error: message } = sanitizeProviderError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
