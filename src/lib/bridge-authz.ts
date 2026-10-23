/**
 * Bridge authorization for machine-to-LiTT write endpoints.
 *
 * HMAC proves a request came from *a* holder of a bridge credential. It
 * does NOT prove the request is allowed to write for the user named in
 * its payload — anyone holding the shared secret could otherwise submit
 * any user's ID (authorization failure identified in the 2026-10-22
 * shared-brain review, ART-20261022-045; binding required by Larry's
 * ruling the same night).
 *
 * A BINDING ties one credential to exactly:
 *   - one owner (a Clerk user ID — the only identity the request may
 *     write for), and
 *   - one permitted agent (a `user_agents.id` that must exist and
 *     belong to that owner).
 *
 * Configuration (server-side only; secrets never leave env storage):
 *   LITT_BRIDGE_BINDINGS — JSON array of
 *     { "credentialId": string, "secret": string,
 *       "ownerId": string, "agentId": string }
 *   When unset, a single "default" binding is synthesized from
 *   LITT_N8N_BRIDGE_SECRET + LITT_BRIDGE_OWNER_ID + LITT_BRIDGE_AGENT_ID
 *   (all three required, otherwise the bridge is unconfigured).
 *
 * The request names its credential via the `x-litt-credential` header;
 * absent that header the "default" binding is used.
 *
 * Every authorization outcome — accepted or rejected — is recorded in
 * `bridge_audit_log` (migration 20261021010000). The audit record never
 * contains the credential secret or the memory/task content itself:
 * content is represented by a SHA-256 fingerprint + byte length only.
 *
 * Issuing a per-user Dex credential later = adding one binding for that
 * (owner, agent) pair. No code change is required per user.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BridgeBinding {
  credentialId: string;
  secret: string;
  ownerId: string;
  /** user_agents.id (uuid) of the one agent this credential may act as. */
  agentId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBindings(raw: string | undefined): BridgeBinding[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const bindings: BridgeBinding[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") return null;
      const b = entry as Record<string, unknown>;
      if (
        typeof b.credentialId !== "string" ||
        typeof b.secret !== "string" ||
        typeof b.ownerId !== "string" ||
        typeof b.agentId !== "string" ||
        !UUID_RE.test(b.agentId)
      ) {
        return null;
      }
      bindings.push({
        credentialId: b.credentialId,
        secret: b.secret,
        ownerId: b.ownerId,
        agentId: b.agentId,
      });
    }
    return bindings;
  } catch {
    return null;
  }
}

/**
 * Resolve the binding for a request, or null when the bridge is not
 * configured (no bindings at all, a malformed bindings value, or the
 * named credential does not exist). Callers must fail closed on null.
 */
export function resolveBridgeBinding(
  credentialHeader: string | null,
): BridgeBinding | null {
  const fromEnv = parseBindings(process.env.LITT_BRIDGE_BINDINGS);
  const bindings: BridgeBinding[] = fromEnv ?? [];
  if (!fromEnv) {
    const secret = process.env.LITT_N8N_BRIDGE_SECRET;
    const ownerId = process.env.LITT_BRIDGE_OWNER_ID;
    const agentId = process.env.LITT_BRIDGE_AGENT_ID;
    if (secret && ownerId && agentId && UUID_RE.test(agentId)) {
      bindings.push({ credentialId: "default", secret, ownerId, agentId });
    }
  }
  if (bindings.length === 0) return null;
  const wanted = credentialHeader ?? "default";
  return bindings.find((b) => b.credentialId === wanted) ?? null;
}

export type BridgeAuditOutcome =
  | "accepted"
  | "rejected_auth"
  | "rejected_binding"
  | "rejected_agent"
  | "rejected_validation"
  | "rejected_secret_content"
  | "error";

export interface BridgeAuditEntry {
  credentialId: string | null;
  boundOwnerId: string | null;
  /** The user ID the caller *claimed* (untrusted until binding passes). */
  suppliedUserId: string | null;
  agentId: string | null;
  outcome: BridgeAuditOutcome;
  reason: string;
  /** Raw payload whose fingerprint is recorded (content itself never is). */
  content?: string | null;
  idempotencyKey?: string | null;
  endpoint: string;
}

/**
 * Write one durable audit row. Returns false when the write failed —
 * callers on an accept path must treat a failed audit write as a failed
 * request (the audit trail is part of the security control, not a
 * nice-to-have log).
 */
export async function recordBridgeAudit(
  admin: SupabaseClient,
  entry: BridgeAuditEntry,
): Promise<boolean> {
  const fingerprint = entry.content
    ? createHash("sha256").update(entry.content).digest("hex")
    : null;
  const { error } = await admin.from("bridge_audit_log").insert({
    credential_id: entry.credentialId,
    bound_owner_id: entry.boundOwnerId,
    supplied_user_id: entry.suppliedUserId,
    agent_id: entry.agentId,
    outcome: entry.outcome,
    reason: entry.reason,
    content_fingerprint: fingerprint,
    content_bytes: entry.content ? Buffer.byteLength(entry.content) : null,
    idempotency_key: entry.idempotencyKey ?? null,
    endpoint: entry.endpoint,
  });
  if (error) {
    console.error("[bridge-audit] insert failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Verify the bound agent is registered: a `user_agents` row with the
 * binding's agentId that belongs to the binding's owner. Anything else
 * (missing row, another owner's agent) is an authorization failure.
 */
export async function verifyBoundAgent(
  admin: SupabaseClient,
  binding: BridgeBinding,
): Promise<boolean> {
  const { data, error } = await admin
    .from("user_agents")
    .select("id")
    .eq("id", binding.agentId)
    .eq("owner_id", binding.ownerId)
    .maybeSingle();
  if (error) {
    console.error("[bridge-authz] agent lookup failed:", error.message);
    return false;
  }
  return data !== null;
}
