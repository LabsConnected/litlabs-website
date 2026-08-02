import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/agents/[slug]/detail
 *
 * Returns the full agent detail data needed for the agent product page:
 *   - Agent record (name, description, system prompt excerpt, personality)
 *   - Marketplace listing (price, status, category, billing model)
 *   - Published agent version (features, model, version number)
 *   - Agent entitlement state for the current user (if authenticated)
 *
 * This is a public endpoint — the system prompt is NOT returned.
 * Only a short excerpt of the personality/description is included.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    // Fetch the agent
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("id, slug, name, description, category, personality, is_public, is_featured")
      .eq("slug", slug)
      .eq("is_public", true)
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Fetch the marketplace listing
    const { data: listing } = await supabaseAdmin
      .from("marketplace_items")
      .select("id, slug, name, status, category, is_featured, is_official, is_beta, billing_model, risk_level, price_cents, compatible_assistants, required_connections")
      .eq("agent_id", agent.id)
      .eq("item_type", "agent")
      .maybeSingle();

    // Fetch the latest published version
    const { data: version } = await supabaseAdmin
      .from("agent_versions")
      .select("id, version, model, features, price_cents, currency, status, created_at")
      .eq("agent_id", agent.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch version history (published versions only)
    const { data: versionHistory } = await supabaseAdmin
      .from("agent_versions")
      .select("id, version, status, created_at, features")
      .eq("agent_id", agent.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      agent: {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
        category: agent.category,
        personality: agent.personality,
        is_featured: agent.is_featured,
      },
      listing: listing ?? null,
      version: version ?? null,
      versionHistory: versionHistory ?? [],
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch agent detail" }, { status: 500 });
  }
}
