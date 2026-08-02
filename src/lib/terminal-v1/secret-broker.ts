/**
 * Secret broker for Terminal V1.
 *
 * Stores user-provided secrets (API keys, tokens) encrypted at rest
 * and injects them into sandbox environments via the allowlist.
 *
 * Encryption: AES-256-GCM with server-side key (TERMINAL_SECRET_KEY).
 * The key NEVER enters the sandbox — only decrypted values are passed
 * as environment variables through the allowlist.
 */

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Encryption ──────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const key = process.env.TERMINAL_SECRET_KEY;
  if (!key || key.length < 32) {
    throw new Error("TERMINAL_SECRET_KEY must be at least 32 characters");
  }
  return Buffer.from(key.slice(0, 32), "utf-8");
}

export interface EncryptedSecret {
  encryptedValue: string;
  iv: string;
  tag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(encrypted: EncryptedSecret): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.encryptedValue, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

// ─── Database row type ───────────────────────────────────────────

interface SecretRow {
  secret_id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  encrypted_value: string;
  encryption_iv: string;
  encryption_tag: string;
  secret_type: string;
  scope: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface SecretMetadata {
  secretId: string;
  userId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  secretType: string;
  scope: "user" | "project";
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

function rowToMetadata(row: SecretRow): SecretMetadata {
  return {
    secretId: row.secret_id,
    userId: row.user_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    secretType: row.secret_type,
    scope: row.scope as "user" | "project",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

// ─── Secret broker service ───────────────────────────────────────

export interface CreateSecretInput {
  userId: string;
  projectId?: string;
  name: string;
  description?: string;
  value: string;
  secretType?: string;
  scope?: "user" | "project";
}

export class SecretBroker {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client =
      client ??
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        { auth: { persistSession: false } },
      );
  }

  /**
   * Store a new secret (encrypted at rest).
   */
  async create(input: CreateSecretInput): Promise<SecretMetadata> {
    const encrypted = encryptSecret(input.value);
    const secretId = `sec-${randomUUID()}`;
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .from("terminal_secrets")
      .insert({
        secret_id: secretId,
        user_id: input.userId,
        project_id: input.projectId ?? null,
        name: input.name,
        description: input.description ?? null,
        encrypted_value: encrypted.encryptedValue,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag,
        secret_type: input.secretType ?? "generic",
        scope: input.scope ?? (input.projectId ? "project" : "user"),
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create secret: ${error.message}`);
    return rowToMetadata(data as SecretRow);
  }

  /**
   * Get secret metadata (without decrypted value).
   */
  async getById(secretId: string, userId: string): Promise<SecretMetadata | null> {
    const { data, error } = await this.client
      .from("terminal_secrets")
      .select("*")
      .eq("secret_id", secretId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(`Failed to get secret: ${error.message}`);
    if (!data) return null;

    return rowToMetadata(data as SecretRow);
  }

  /**
   * List all secrets for a user (metadata only, no values).
   */
  async listByUser(userId: string): Promise<SecretMetadata[]> {
    const { data, error } = await this.client
      .from("terminal_secrets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to list secrets: ${error.message}`);
    return (data as SecretRow[]).map(rowToMetadata);
  }

  /**
   * List secrets for a specific project (includes user-scoped secrets).
   */
  async listForProject(userId: string, projectId: string): Promise<SecretMetadata[]> {
    const { data, error } = await this.client
      .from("terminal_secrets")
      .select("*")
      .eq("user_id", userId)
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to list project secrets: ${error.message}`);
    return (data as SecretRow[]).map(rowToMetadata);
  }

  /**
   * Resolve and decrypt all secrets for a user+project.
   * Returns a key-value map suitable for sandbox environment injection.
   */
  async resolveForSandbox(userId: string, projectId: string): Promise<Record<string, string>> {
    const secrets = await this.listForProject(userId, projectId);
    const result: Record<string, string> = {};

    for (const meta of secrets) {
      const { data, error } = await this.client
        .from("terminal_secrets")
        .select("encrypted_value, encryption_iv, encryption_tag")
        .eq("secret_id", meta.secretId)
        .single();

      if (error || !data) continue;

      const row = data as Pick<SecretRow, "encrypted_value" | "encryption_iv" | "encryption_tag">;
      try {
        const value = decryptSecret({
          encryptedValue: row.encrypted_value,
          iv: row.encryption_iv,
          tag: row.encryption_tag,
        });
        result[meta.name] = value;
      } catch {
        // Skip secrets that can't be decrypted (key rotation, etc.)
      }

      // Update last_used_at
      await this.client
        .from("terminal_secrets")
        .update({ last_used_at: new Date().toISOString() })
        .eq("secret_id", meta.secretId);
    }

    return result;
  }

  /**
   * Update a secret's value (re-encrypt).
   */
  async updateValue(secretId: string, userId: string, value: string): Promise<void> {
    const encrypted = encryptSecret(value);

    const { error } = await this.client
      .from("terminal_secrets")
      .update({
        encrypted_value: encrypted.encryptedValue,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag,
        updated_at: new Date().toISOString(),
      })
      .eq("secret_id", secretId)
      .eq("user_id", userId);

    if (error) throw new Error(`Failed to update secret: ${error.message}`);
  }

  /**
   * Delete a secret.
   */
  async delete(secretId: string, userId: string): Promise<boolean> {
    const { error } = await this.client
      .from("terminal_secrets")
      .delete()
      .eq("secret_id", secretId)
      .eq("user_id", userId);

    if (error) throw new Error(`Failed to delete secret: ${error.message}`);
    return true;
  }
}
