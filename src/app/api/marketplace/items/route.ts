import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

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

    // installable is derived server-side from the capability registry: an
    // item is only installable when its capability has a real executor.
    // Today no capability has one, so every item reports installable: false
    // and the page is truthful by construction. Items flip to installable
    // automatically the moment executors land — no page changes needed.
    const itemsWithInstallable = (items || []).map((item) => ({
      ...item,
      installable: Boolean(
        item.capability_key && CAPABILITY_REGISTRY[item.capability_key]?.execute,
      ),
    }));

    return NextResponse.json({
      items: itemsWithInstallable,
      total: itemsWithInstallable.length,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch marketplace items" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
