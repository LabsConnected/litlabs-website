/**
 * Agent memory repository — persisted in Supabase, indexed by Supermemory.
 *
 * Schema: supabase/migrations/20250712_litt_agent_memory.sql
 */

import { getAdminSupabase, isAdminSupabaseConfigured } from "./supabase-admin";
import type { MemoryRecord, MemoryScope, UserAgent } from "./agent-user";

function getAdmin() {
  if (!isAdminSupabaseConfigured()) return null;
  try {
    return getAdminSupabase();
  } catch {
    return null;
  }
}

export type CreateMemoryInput = {
  ownerId: string;
  agentId?: string | null;
  content: string;
  scope: MemoryScope;
  source?: string;
  sourceId?: string;
  reason?: string;
  confidence?: number;
  expiresAt?: string | null;
  supermemoryId?: string | null;
};

export type UpdateMemoryInput = Partial<CreateMemoryInput>;

export async function createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin not available");

  const { data, error } = await admin
    .from("memories")
    .insert({
      owner_id: input.ownerId,
      agent_id: input.agentId ?? null,
      content: input.content,
      scope: input.scope,
      source: input.source ?? null,
      source_id: input.sourceId ?? null,
      reason: input.reason ?? null,
      confidence: input.confidence ?? 1.0,
      expires_at: input.expiresAt ?? null,
      supermemory_id: input.supermemoryId ?? null,
      sync_status: "pending",
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to create memory");
  return mapMemoryRow(data);
}

export async function getMemoriesForOwner(
  ownerId: string,
  options: { scope?: MemoryScope; agentId?: string; limit?: number } = {},
): Promise<MemoryRecord[]> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin not available");

  let query = admin
    .from("memories")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (options.scope) query = query.eq("scope", options.scope);
  if (options.agentId) query = query.eq("agent_id", options.agentId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(mapMemoryRow);
}

export async function getMemoryById(id: string): Promise<MemoryRecord | null> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin not available");

  const { data, error } = await admin.from("memories").select("*").eq("id", id).single();
  if (error) return null;
  return data ? mapMemoryRow(data) : null;
}

export async function updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryRecord> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin not available");

  const update: Record<string, unknown> = {};
  if (input.agentId !== undefined) update.agent_id = input.agentId ?? null;
  if (input.content !== undefined) update.content = input.content;
  if (input.scope !== undefined) update.scope = input.scope;
  if (input.source !== undefined) update.source = input.source ?? null;
  if (input.sourceId !== undefined) update.source_id = input.sourceId ?? null;
  if (input.reason !== undefined) update.reason = input.reason ?? null;
  if (input.confidence !== undefined) update.confidence = input.confidence;
  if (input.expiresAt !== undefined) update.expires_at = input.expiresAt ?? null;
  if (input.supermemoryId !== undefined) update.supermemory_id = input.supermemoryId ?? null;
  update.updated_at = new Date().toISOString();

  const { data, error } = await admin.from("memories").update(update).eq("id", id).select().single();
  if (error || !data) throw new Error(error?.message || "Failed to update memory");
  return mapMemoryRow(data);
}

export async function deleteMemory(id: string): Promise<void> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin not available");

  const { error } = await admin.from("memories").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function touchMemory(id: string): Promise<void> {
  const admin = getAdmin();
  if (!admin) return;

  await admin
    .from("memories")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id);
}

export async function getOrCreateDefaultUserAgent(ownerId: string): Promise<UserAgent> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin not available");

  const { data: existing } = await admin
    .from("user_agents")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("is_default", true)
    .single();

  if (existing) return mapUserAgentRow(existing);

  const { data, error } = await admin
    .from("user_agents")
    .insert({
      owner_id: ownerId,
      name: "LiTT Director",
      instructions: "You are LiTT, a helpful director assistant.",
      model: "google/gemini-2.5-flash",
      enabled_tools: "{}",
      memory_policy: "{}",
      autonomy: "ask-first",
      monthly_budget: 0,
      project_ids: "{}",
      is_default: true,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to create default user agent");
  return mapUserAgentRow(data);
}

export async function updateUserAgent(
  id: string,
  input: Partial<UserAgent>,
): Promise<UserAgent> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin not available");

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.instructions !== undefined) update.instructions = input.instructions;
  if (input.model !== undefined) update.model = input.model;
  if (input.enabledTools !== undefined) update.enabled_tools = input.enabledTools;
  if (input.memoryPolicy !== undefined) update.memory_policy = input.memoryPolicy;
  if (input.autonomy !== undefined) update.autonomy = input.autonomy;
  if (input.monthlyBudget !== undefined) update.monthly_budget = input.monthlyBudget;
  if (input.projectIds !== undefined) update.project_ids = input.projectIds;
  if (input.voiceSettings !== undefined) update.voice_settings = input.voiceSettings;
  if (input.dataRetentionDays !== undefined) update.data_retention_days = input.dataRetentionDays;
  if (input.isDefault !== undefined) update.is_default = input.isDefault;
  update.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("user_agents")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to update user agent");
  return mapUserAgentRow(data);
}

function mapMemoryRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    agentId: row.agent_id ? String(row.agent_id) : null,
    content: String(row.content),
    scope: String(row.scope) as MemoryScope,
    source: row.source ? String(row.source) : undefined,
    sourceId: row.source_id ? String(row.source_id) : undefined,
    reason: row.reason ? String(row.reason) : undefined,
    confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    supermemoryId: row.supermemory_id ? String(row.supermemory_id) : null,
    syncStatus: String(row.sync_status) as MemoryRecord["syncStatus"],
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapUserAgentRow(row: Record<string, unknown>): UserAgent {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
    instructions: String(row.instructions),
    model: String(row.model),
    enabledTools: Array.isArray(row.enabled_tools) ? row.enabled_tools : [],
    memoryPolicy: (row.memory_policy as Record<string, unknown>) || {},
    autonomy: String(row.autonomy) as UserAgent["autonomy"],
    monthlyBudget: typeof row.monthly_budget === "number" ? row.monthly_budget : 0,
    projectIds: Array.isArray(row.project_ids) ? row.project_ids : [],
    voiceSettings: (row.voice_settings as Record<string, unknown>) || undefined,
    dataRetentionDays:
      typeof row.data_retention_days === "number" ? row.data_retention_days : 365,
    isDefault: Boolean(row.is_default),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
