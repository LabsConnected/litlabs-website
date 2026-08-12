import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ConnectorAuditLogRow } from "@/lib/connectors/db-types";

// GET /api/settings/audit-log — list recent connector audit entries
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "50", 10),
      200,
    );
    const offset = Math.max(
      parseInt(url.searchParams.get("offset") ?? "0", 10),
      0,
    );

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ entries: [], total: 0 });
    }

    const { data, error, count } = await admin
      .from("connector_audit_log")
      .select("*", { count: "exact" })
      .eq("user_id", clerkId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: "Failed to load audit log" }, { status: 500 });
    }

    const entries = (data as ConnectorAuditLogRow[]) ?? [];
    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        capabilityId: e.capability_id,
        provider: e.provider,
        action: e.action,
        status: e.status,
        inputSummary: e.input_summary,
        outputSummary: e.output_summary,
        approvedBy: e.approved_by,
        createdAt: e.created_at,
      })),
      total: count ?? 0,
    });
  } catch (err) {
    console.error("[audit-log] GET error:", err);
    return NextResponse.json({ error: "Failed to load audit log" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
