import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { AgentDetailClient } from "./AgentDetailClient";

/**
 * Agent Detail Page — /agents/[slug]
 *
 * This is a serious product page, not a tiny app-store card.
 * It shows: outcome, who it's for, what it creates, example input/result,
 * tools/permissions, approval boundaries, pricing, version history,
 * and Buy/Install/Open state.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("name, description")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (!agent) {
    return { title: "Agent not found — LiTTree Lab Studios" };
  }

  return {
    title: `${agent.name} — LiTTree Lab Studios`,
    description: agent.description,
  };
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { slug } = await params;

  // Fetch agent
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, slug, name, description, category, personality, is_public, is_featured")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (!agent) {
    notFound();
  }

  // Fetch marketplace listing
  const { data: listing } = await supabaseAdmin
    .from("marketplace_items")
    .select("id, slug, name, status, category, is_featured, is_official, is_beta, billing_model, risk_level, price_cents, compatible_assistants, required_connections")
    .eq("agent_id", agent.id)
    .eq("item_type", "agent")
    .maybeSingle();

  // Fetch latest published version
  const { data: version } = await supabaseAdmin
    .from("agent_versions")
    .select("id, version, model, features, price_cents, currency, status, created_at")
    .eq("agent_id", agent.id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch version history
  const { data: versionHistory } = await supabaseAdmin
    .from("agent_versions")
    .select("id, version, status, created_at, features")
    .eq("agent_id", agent.id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <AgentDetailClient
      agent={{
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
        category: agent.category,
        personality: agent.personality,
        is_featured: agent.is_featured,
      }}
      listing={listing ?? null}
      version={version ?? null}
      versionHistory={versionHistory ?? []}
    />
  );
}
