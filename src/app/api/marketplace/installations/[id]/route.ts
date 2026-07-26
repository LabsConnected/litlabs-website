import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

// PATCH: Enable/disable an installation
async function patchHandler(req: NextRequest, ctx?: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx!.params;
    const body = await req.json();
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "Missing 'enabled' field" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("marketplace_installations")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, enabled")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Installation not found" }, { status: 404 });
    }

    return NextResponse.json({ installation: data });
  } catch {
    return NextResponse.json({ error: "Failed to update installation" }, { status: 500 });
  }
}

// DELETE: Uninstall a capability
async function deleteHandler(_req: NextRequest, ctx?: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx!.params;
    const { error } = await supabaseAdmin
      .from("marketplace_installations")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: "Failed to uninstall" }, { status: 500 });
    }

    return NextResponse.json({ message: "Capability uninstalled" });
  } catch {
    return NextResponse.json({ error: "Failed to uninstall" }, { status: 500 });
  }
}

export const PATCH = withRateLimit(patchHandler);
export const DELETE = withRateLimit(deleteHandler);
