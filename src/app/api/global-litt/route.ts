import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/global-litt
 *
 * Get or create the authenticated user's Global LiTT system project.
 *
 * The Global LiTT project is a server-owned system project (is_system=true,
 * system_type='global_litt') that serves as the canonical home for Global
 * LiTT conversations. It is hidden from normal project lists.
 *
 * Returns: { project: { id, name, ... } }
 */

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Try to find existing Global LiTT project
    const { data: existing, error: findError } = await supabaseAdmin
      .from("studio_projects")
      .select("id, name, slug, created_at, updated_at")
      .eq("user_id", userId)
      .eq("is_system", true)
      .eq("system_type", "global_litt")
      .single();

    if (existing) {
      return NextResponse.json({ project: existing });
    }

    // Not found — create it. Use upsert to handle race conditions
    // (unique index on user_id, system_type ensures idempotency).
    const { data: created, error: createError } = await supabaseAdmin
      .from("studio_projects")
      .upsert(
        {
          user_id: userId,
          name: "Global LiTT",
          slug: "global-litt",
          is_system: true,
          system_type: "global_litt",
          scan_status: "complete",
        },
        {
          onConflict: "user_id,system_type",
          ignoreDuplicates: false,
        }
      )
      .select("id, name, slug, created_at, updated_at")
      .single();

    if (createError) {
      // If upsert failed due to race, try fetching again
      const { data: retry } = await supabaseAdmin
        .from("studio_projects")
        .select("id, name, slug, created_at, updated_at")
        .eq("user_id", userId)
        .eq("is_system", true)
        .eq("system_type", "global_litt")
        .single();

      if (retry) {
        return NextResponse.json({ project: retry });
      }

      return NextResponse.json(
        { error: createError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ project: created });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
