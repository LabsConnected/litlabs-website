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

    // If the lookup failed with a REAL database error (not "not found"),
    // we MUST NOT proceed to creation. Return the error immediately.
    // PGRST116 = "not found" (no rows) — the only case where creation is allowed.
    if (findError && findError.code !== "PGRST116") {
      return NextResponse.json(
        { error: `Failed to lookup Global LiTT project: ${findError.message}` },
        { status: 500 }
      );
    }
    // At this point: either existing was found (handled above) or
    // findError.code === "PGRST116" (confirmed not found) — creation may proceed.

    // Not found — create it with a normal INSERT.
    // The partial unique index UNIQUE (user_id, system_type) WHERE is_system=true
    // guarantees exactly one Global LiTT project per user. If two requests race,
    // the loser gets a 23505 unique violation — we then fetch the winner's row.
    // (We do NOT use upsert with onConflict:"user_id,system_type" because
    // PostgreSQL cannot infer a partial index from a plain column list.)
    //
    // scan_status: "ready" is the truthful state — system projects don't need
    // scanning (allowed: pending, scanning, ready, failed).
    const { data: created, error: createError } = await supabaseAdmin
      .from("studio_projects")
      .insert({
        user_id: userId,
        name: "Global LiTT",
        slug: "global-litt",
        is_system: true,
        system_type: "global_litt",
        scan_status: "ready",
      })
      .select("id, name, slug, created_at, updated_at")
      .single();

    if (createError) {
      // 23505 = unique_violation — a concurrent request created it first.
      // Fetch the existing row and return it. Do not swallow other errors.
      if (createError.code === "23505") {
        const { data: retry, error: retryError } = await supabaseAdmin
          .from("studio_projects")
          .select("id, name, slug, created_at, updated_at")
          .eq("user_id", userId)
          .eq("is_system", true)
          .eq("system_type", "global_litt")
          .single();

        if (retry && !retryError) {
          return NextResponse.json({ project: retry });
        }
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
