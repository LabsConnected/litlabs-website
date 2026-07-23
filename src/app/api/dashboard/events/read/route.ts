import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { event_ids } = body as { event_ids?: string[] };

  if (event_ids && Array.isArray(event_ids)) {
    const { error } = await supabaseAdmin
      .from("integration_events")
      .update({ read_at: new Date().toISOString() })
      .in("id", event_ids)
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // Mark all as read
    const { error } = await supabaseAdmin
      .from("integration_events")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
