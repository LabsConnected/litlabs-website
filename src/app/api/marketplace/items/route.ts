import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const itemType = searchParams.get("type");
    const assistant = searchParams.get("assistant");

    let query = supabaseAdmin
      .from("marketplace_items")
      .select("*")
      .order("is_featured", { ascending: false })
      .order("name", { ascending: true });

    if (category && category !== "all") {
      query = query.eq("category", category);
    }
    if (itemType) {
      query = query.eq("item_type", itemType);
    }
    if (assistant && (assistant === "litt" || assistant === "spark")) {
      query = query.contains("compatible_assistants", [assistant]);
    }

    const { data: items, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Failed to fetch marketplace items" }, { status: 500 });
    }

    return NextResponse.json({
      items: items || [],
      total: items?.length || 0,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch marketplace items" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
