/**
 * GitHub PAT (Personal Access Token) helpers.
 *
 * Retrieves stored PATs from user_connections / user_connection_credentials
 * and creates Octokit instances for repo operations.
 *
 * Used as a fallback when GitHub App installation is not available.
 */

import "server-only";
import { Octokit } from "@octokit/rest";
import { supabaseAdmin } from "@/lib/supabase";

type PATConnection = {
  connectionId: string;
  accountName: string | null;
  scopes: string[];
};

/**
 * Get the user's stored GitHub PAT connection info (without the token).
 */
export async function getPATConnection(userId: string): Promise<PATConnection | null> {
  const { data, error } = await supabaseAdmin
    .from("user_connections")
    .select("id, provider_account_name, scopes, status")
    .eq("user_id", userId)
    .eq("provider", "github")
    .eq("connection_reference", "pat")
    .eq("status", "connected")
    .eq("revoked", false)
    .maybeSingle();

  if (error || !data) return null;

  return {
    connectionId: data.id,
    accountName: data.provider_account_name,
    scopes: data.scopes || [],
  };
}

/**
 * Get an Octokit instance authenticated with the user's stored PAT.
 * Returns null if no PAT is connected.
 */
export async function getPATOctokit(userId: string): Promise<{ octokit: Octokit; accountName: string | null } | null> {
  const conn = await getPATConnection(userId);
  if (!conn) return null;

  const { data: cred, error } = await supabaseAdmin
    .from("user_connection_credentials")
    .select("encrypted_value")
    .eq("user_connection_id", conn.connectionId)
    .eq("credential_type", "pat")
    .single();

  if (error || !cred) return null;

  const octokit = new Octokit({ auth: cred.encrypted_value });
  return { octokit, accountName: conn.accountName };
}

/**
 * Get a GitHub Octokit for the user — tries GitHub App installation first,
 * falls back to PAT if no installation is available.
 *
 * Returns the Octokit instance and metadata about which method was used.
 */
export async function getUserGitHubOctokit(
  userId: string,
  installationId?: number,
): Promise<{
  octokit: Octokit;
  method: "app" | "pat";
  accountName: string | null;
} | null> {
  // Try GitHub App installation first
  if (installationId) {
    try {
      const { getInstallationOctokit } = await import("@/lib/github-app");
      const octokit = await getInstallationOctokit(installationId);
      return { octokit, method: "app" as const, accountName: null };
    } catch {
      // Fall through to PAT
    }
  }

  // Fall back to PAT
  const pat = await getPATOctokit(userId);
  if (pat) {
    return { octokit: pat.octokit, method: "pat" as const, accountName: pat.accountName };
  }

  return null;
}
