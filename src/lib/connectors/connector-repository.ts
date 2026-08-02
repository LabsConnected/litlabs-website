import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { UserConnectionRow, ConnectorCapabilityRow, UserPreferencesRow, ConnectorAuditLogRow } from "./db-types";
import type { CapabilityId, CapabilityStatus, UserConnectionProvider } from "./provider-registry";

// ── User Connections ───────────────────────────────────────────────────

export async function getUserConnections(userId: string): Promise<UserConnectionRow[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from("user_connections")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data as UserConnectionRow[]) ?? [];
}

export async function getUserConnection(
  userId: string,
  provider: UserConnectionProvider,
): Promise<UserConnectionRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("user_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return null;
  return (data as UserConnectionRow) ?? null;
}

export async function createUserConnection(
  userId: string,
  provider: UserConnectionProvider,
  fields: {
    providerAccountId?: string;
    providerAccountName?: string;
    providerAccountEmail?: string;
    scopes?: string[];
    requestedScopes?: string[];
    connectionReference?: string;
  },
): Promise<UserConnectionRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("user_connections")
    .insert({
      user_id: userId,
      provider,
      provider_account_id: fields.providerAccountId ?? null,
      provider_account_name: fields.providerAccountName ?? null,
      provider_account_email: fields.providerAccountEmail ?? null,
      scopes: fields.scopes ?? [],
      requested_scopes: fields.requestedScopes ?? [],
      status: "connected",
      connection_reference: fields.connectionReference ?? null,
      last_connected_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) return null;
  return data as UserConnectionRow;
}

export async function updateUserConnectionStatus(
  userId: string,
  connectionId: string,
  status: UserConnectionRow["status"],
  detail?: Record<string, unknown>,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const update: Record<string, unknown> = {
    status,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (detail) update.metadata = detail;
  const { error } = await admin
    .from("user_connections")
    .update(update)
    .eq("id", connectionId)
    .eq("user_id", userId);
  return !error;
}

export async function revokeUserConnection(userId: string, connectionId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { error } = await admin
    .from("user_connections")
    .update({
      status: "disconnected",
      revoked: true,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId)
    .eq("user_id", userId);
  return !error;
}

// ── Capabilities ───────────────────────────────────────────────────────

export async function getUserCapabilities(userId: string): Promise<ConnectorCapabilityRow[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from("connector_capabilities")
    .select("*")
    .eq("user_id", userId);
  if (error) return [];
  return (data as ConnectorCapabilityRow[]) ?? [];
}

export async function upsertCapability(
  userId: string,
  capabilityId: CapabilityId,
  provider: string,
  status: CapabilityStatus,
  connectionId?: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { error } = await admin
    .from("connector_capabilities")
    .upsert({
      user_id: userId,
      capability_id: capabilityId,
      provider,
      status,
      user_connection_id: connectionId ?? null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,capability_id",
    });
  return !error;
}

export async function getCapabilityStatus(
  userId: string,
  capabilityId: CapabilityId,
): Promise<CapabilityStatus | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("connector_capabilities")
    .select("status")
    .eq("user_id", userId)
    .eq("capability_id", capabilityId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { status: CapabilityStatus }).status;
}

// ── Audit Log ──────────────────────────────────────────────────────────

export async function logConnectorAction(
  userId: string,
  entry: {
    capabilityId: CapabilityId;
    provider: string;
    action: string;
    status: ConnectorAuditLogRow["status"];
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
    connectionId?: string;
    approvedBy?: string;
  },
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  await admin.from("connector_audit_log").insert({
    user_id: userId,
    capability_id: entry.capabilityId,
    provider: entry.provider,
    action: entry.action,
    status: entry.status,
    input_summary: entry.inputSummary ?? {},
    output_summary: entry.outputSummary ?? {},
    user_connection_id: entry.connectionId ?? null,
    approved_by: entry.approvedBy ?? null,
  });
}

// ── User Preferences ───────────────────────────────────────────────────

export async function getUserPreferences(userId: string): Promise<UserPreferencesRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return (data as UserPreferencesRow) ?? null;
}

export async function upsertUserPreferences(
  userId: string,
  fields: Partial<Omit<UserPreferencesRow, "id" | "user_id" | "created_at" | "updated_at">>,
): Promise<UserPreferencesRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("user_preferences")
    .upsert({
      user_id: userId,
      ...fields,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
    })
    .select("*")
    .single();
  if (error) return null;
  return data as UserPreferencesRow;
}
