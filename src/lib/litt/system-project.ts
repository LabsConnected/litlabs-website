import { supabaseAdmin } from "@/lib/supabase";

export const GLOBAL_LITT_SYSTEM_KEY = "global_litt" as const;

export interface LittSystemProject {
  id: string;
  ownerId: string;
  systemKey: typeof GLOBAL_LITT_SYSTEM_KEY;
  name: string;
  primaryConversationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface LittSystemProjectRow {
  id: string;
  owner_id: string;
  system_key: string;
  name: string;
  primary_conversation_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const SYSTEM_PROJECT_COLUMNS =
  "id, owner_id, system_key, name, primary_conversation_id, metadata, created_at, updated_at";

function mapSystemProject(row: LittSystemProjectRow): LittSystemProject {
  return {
    id: row.id,
    ownerId: row.owner_id,
    systemKey: GLOBAL_LITT_SYSTEM_KEY,
    name: row.name,
    primaryConversationId: row.primary_conversation_id,
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
    .select(SYSTEM_PROJECT_COLUMNS)
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
    .select(SYSTEM_PROJECT_COLUMNS)
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

/**
 * Compare-and-set the system project's primary conversation. Returns the row
 * only when this caller won the race; callers that lose must re-read it.
 */
export async function claimGlobalLittPrimaryConversation(
  ownerId: string,
  systemProjectId: string,
  conversationId: string,
): Promise<LittSystemProject | null> {
  const { data, error } = await supabaseAdmin
    .from("litt_system_projects")
    .update({ primary_conversation_id: conversationId })
    .eq("id", systemProjectId)
    .eq("owner_id", ownerId)
    .eq("system_key", GLOBAL_LITT_SYSTEM_KEY)
    .is("primary_conversation_id", null)
    .select(SYSTEM_PROJECT_COLUMNS)
    .maybeSingle();

  if (error || !data) return null;
  return mapSystemProject(data as LittSystemProjectRow);
}
