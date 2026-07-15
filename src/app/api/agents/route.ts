// API Route: List marketplace agents from Supabase + create custom agents
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { getCoreAgents } from "@/lib/core-agents";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roleFilter = searchParams.get("category");
    const coreOnly = searchParams.get("featured") === "true";
    const includeOwn = searchParams.get("mine") === "true";

    let query = supabaseAdmin
      .from("agents")
      .select(
        "id, slug, display_name, description, role, system_prompt, personality, model, is_core, is_public, is_featured, owner_id, avatar_url, features, price_cents, rating, installs, created_at, updated_at",
      )
      .order("is_core", { ascending: false })
      .order("created_at", { ascending: false });

    if (includeOwn) {
      const { userId } = await auth();
      if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("clerk_id", userId)
        .single();
      if (user) query = query.or(`is_core.eq.true,owner_id.eq.${user.id}`);
      else query = query.eq("is_core", true);
    } else {
      query = query.eq("is_core", true);
    }

    if (roleFilter) query = query.eq("role", roleFilter);
    if (coreOnly) query = query.eq("is_core", true);

    const { data: rows, error } = await query;

    if (error) {
      // Supabase error:
      return NextResponse.json(
        { error: "Failed to fetch agents" },
        { status: 500 },
      );
    }

    const dbRows = rows || [];
    // If no core agents exist in the database yet, serve the built-in core
    // agents so the marketplace is never empty.
    const fallbackRows = dbRows.length === 0 ? getCoreAgents() : [];
    const combinedRows = [...dbRows, ...fallbackRows];

    const agents = combinedRows.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.display_name,
      description: a.description ?? "",
      category: a.role ?? "general",
      avatar_url: a.avatar_url ?? "",
      system_prompt: a.system_prompt ?? "",
      personality: a.personality ?? "",
      price_cents: a.price_cents ?? 0,
      is_public: a.is_public ?? true,
      is_featured: a.is_featured ?? a.is_core ?? false,
      features: Array.isArray(a.features) ? (a.features as string[]) : [],
      rating: a.rating ? Number(a.rating) : undefined,
      installs: a.installs ?? undefined,
      model: a.model,
      created_at: a.created_at,
    }));

    return NextResponse.json({
      agents,
      total: agents.length,
      categories: [...new Set(agents.map((a) => a.category))],
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Error fetching agents:
    return NextResponse.json(
      { error: "Failed to fetch agents" },
      { status: 500 },
    );
  }
}

async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, slug, description, category, system_prompt } = body;

    if (!name || !slug || !system_prompt) {
      return NextResponse.json(
        { error: "name, slug, and system_prompt are required" },
        { status: 400 },
      );
    }

    const slugClean = String(slug)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/--+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slugClean) {
      return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    }

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data: existing } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("slug", slugClean)
      .single();
    if (existing) {
      return NextResponse.json(
        { error: "Slug already exists" },
        { status: 409 },
      );
    }

    const { data: agent, error } = await supabaseAdmin
      .from("agents")
      .insert({
        display_name: String(name).trim(),
        slug: slugClean,
        description: description ? String(description).trim() : null,
        role: category ? String(category).trim() : "general",
        system_prompt: String(system_prompt).trim(),
        owner_id: user.id,
        is_core: false,
      })
      .select()
      .single();

    if (error) {
      // Supabase insert error:
      return NextResponse.json(
        { error: "Failed to create agent" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, agent }, { status: 201 });
  } catch {
    // Error creating agent:
    return NextResponse.json(
      { error: "Failed to create agent" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 20, 60);
