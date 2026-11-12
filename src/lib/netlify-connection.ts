/**
 * Netlify connection helpers.
 *
 * Reads the user's stored Netlify personal-access-token connection from
 * user_connections / user_connection_credentials — the same credential
 * store the GitHub PAT connection uses (see src/lib/github-pat.ts).
 * Writes happen in src/app/api/netlify/token/route.ts, which verifies
 * the token against the Netlify API before storing it.
 *
 * The token is only ever returned by getNetlifyToken, which is
 * server-only and used solely to call the Netlify API on the owner's
 * behalf. It is never logged and never sent to the client.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

export interface NetlifyConnection {
  connectionId: string;
  accountName: string | null;
}

/** The user's Netlify connection info (without the token), or null. */
export async function getNetlifyConnection(
  userId: string,
): Promise<NetlifyConnection | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("user_connections")
    .select("id, provider_account_name, status")
    .eq("user_id", userId)
    .eq("provider", "netlify")
    .eq("connection_reference", "api_token")
    .eq("status", "connected")
    .eq("revoked", false)
    .maybeSingle();

  if (error || !data) return null;
  return {
    connectionId: data.id as string,
    accountName: (data.provider_account_name as string | null) ?? null,
  };
}

/**
 * The user's stored Netlify token, or null when not connected.
 * Server-only: the caller uses it to build a Netlify API client.
 */
export async function getNetlifyToken(
  userId: string,
): Promise<{ token: string; accountName: string | null } | null> {
  const conn = await getNetlifyConnection(userId);
  if (!conn || !supabaseAdmin) return null;

  const { data: cred, error } = await supabaseAdmin
    .from("user_connection_credentials")
    .select("encrypted_value")
    .eq("user_connection_id", conn.connectionId)
    .eq("credential_type", "api_token")
    .single();

  if (error || !cred) return null;
  const token = (cred.encrypted_value as string | null) ?? null;
  if (!token) return null;
  return { token, accountName: conn.accountName };
}
