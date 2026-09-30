import { supabaseAdmin } from "@/lib/supabase";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

/** Public catalog only. Installation state is loaded separately after auth. */
export async function getPublicMarketplaceItems(filters: { category?: string | null; itemType?: string | null; assistant?: string | null } = {}) {
  let query = supabaseAdmin.from("marketplace_items").select("*")
    .order("is_featured", { ascending: false }).order("name", { ascending: true });
  if (filters.category && filters.category !== "all") query = query.eq("category", filters.category);
  if (filters.itemType) query = query.eq("item_type", filters.itemType);
  if (filters.assistant === "litt" || filters.assistant === "spark") query = query.contains("compatible_assistants", [filters.assistant]);
  const { data, error } = await query.abortSignal(AbortSignal.timeout(12000));
  if (error) throw new Error("Failed to fetch marketplace items");
  return (data ?? []).map((item) => ({ ...item, installable: Boolean(item.capability_key && CAPABILITY_REGISTRY[item.capability_key]?.execute) }));
}
