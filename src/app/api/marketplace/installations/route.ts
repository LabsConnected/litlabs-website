import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

export const runtime = "nodejs";

async function getUserId(req: NextRequest): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

// GET: List user's installed marketplace capabilities
async function getHandler(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: installations, error } = await supabaseAdmin
      .from("marketplace_installations")
      .select(`
        id,
        marketplace_item_id,
        enabled,
        configuration,
        installed_at,
        updated_at,
        marketplace_items (
          id,
          slug,
          name,
          description,
          item_type,
          category,
          capability_key,
          icon,
          compatible_assistants,
          required_connections
        )
      `)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch installations" }, { status: 500 });
    }

    return NextResponse.json({
      installations: installations || [],
      total: installations?.length || 0,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch installations" }, { status: 500 });
  }
}

// POST: Install a marketplace capability
async function postHandler(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { itemId } = body;

    if (!itemId) {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }

    // Verify item exists and is installable
    const { data: item, error: itemError } = await supabaseAdmin
      .from("marketplace_items")
      .select("id, slug, name, status, capability_key")
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: "Marketplace item not found" }, { status: 404 });
    }

    if (item.status === "coming_soon") {
      return NextResponse.json({ error: "This capability is coming soon and cannot be installed yet." }, { status: 400 });
    }

    // Validate capability key exists in registry
    if (!CAPABILITY_REGISTRY[item.capability_key]) {
      return NextResponse.json({ error: "Capability not registered" }, { status: 400 });
    }

    // Check if already installed
    const { data: existing } = await supabaseAdmin
      .from("marketplace_installations")
      .select("id")
      .eq("user_id", userId)
      .eq("marketplace_item_id", itemId)
      .is("project_id", null)
      .single();

    if (existing) {
      return NextResponse.json({ message: "Already installed", installationId: existing.id }, { status: 200 });
    }

    // Install
    const { data: installation, error: installError } = await supabaseAdmin
      .from("marketplace_installations")
      .insert({
        user_id: userId,
        marketplace_item_id: itemId,
        enabled: true,
      })
      .select("id, marketplace_item_id, enabled, installed_at")
      .single();

    if (installError) {
      return NextResponse.json({ error: "Failed to install capability" }, { status: 500 });
    }

    return NextResponse.json({
      message: `${item.name} installed`,
      installation,
    });
  } catch {
    return NextResponse.json({ error: "Failed to install capability" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
export const POST = withRateLimit(postHandler);
