import { supabaseAdmin } from "@/lib/supabase";

export const GLOBAL_LITT_SYSTEM_KEY = "global_litt" as const;

export interface LittSystemProject {
  id: string;
  ownerId: string;
  systemKey: typeof GLOBAL_LITT_SYSTEM_KEY;
  name: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface LittSystemProjectRow {
  id: string;
  owner_id: string;
  system_key: string;
  name: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function mapSystemProject(row: LittSystemProjectRow): LittSystemProject {
  return {
    id: row.id,
    ownerId: row.owner_id,
    systemKey: GLOBAL_LITT_SYSTEM_KEY,
    name: row.name,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getGlobalLittSystemProject(
  ownerId: string,
): Promise<LittSystemProject | null> {
  const { data, error } = await supabaseAdmin
    .from("litt_system_projects")
    .select("id, owner_id, system_key, name, metadata, created_at, updated_at")
    .eq("owner_id", ownerId)
    .eq("system_key", GLOBAL_LITT_SYSTEM_KEY)
    .maybeSingle();

  if (error || !data) return null;
  return mapSystemProject(data as LittSystemProjectRow);
}

/**
 * Resolve the durable hidden workspace used by Global LiTT.
 *
 * The unique (owner_id, system_key) constraint makes this safe under races.
 * If two first requests arrive together, one insert wins and the loser
 * re-reads the canonical row after the unique-violation response.
 */
export async function getOrCreateGlobalLittSystemProject(
  ownerId: string,
): Promise<LittSystemProject> {
  const existing = await getGlobalLittSystemProject(ownerId);
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from("litt_system_projects")
    .insert({
      owner_id: ownerId,
      system_key: GLOBAL_LITT_SYSTEM_KEY,
      name: "Global LiTT",
      metadata: {},
    })
    .select("id, owner_id, system_key, name, metadata, created_at, updated_at")
    .single();

  if (data) return mapSystemProject(data as LittSystemProjectRow);

  if (error?.code === "23505") {
    const raced = await getGlobalLittSystemProject(ownerId);
    if (raced) return raced;
  }

  throw new Error(
    `Failed to resolve Global LiTT system project: ${error?.message ?? "unknown error"}`,
  );
}
