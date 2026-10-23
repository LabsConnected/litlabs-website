/**
 * n8n → Shared Memory bridge.
 *
 * The ONLY way n8n may write to the `memories` table. n8n has no Clerk
 * session (it's a server, not a browser), so it cannot use `/api/memory`
 * directly — that route requires a Clerk session/bearer <redacted> Instead
 * this route reuses the EXISTING signed-webhook trust boundary from
 * `/api/n8n/[...path]` (HMAC-SHA256 over the raw body, 5-minute replay
 * window, timing-safe compare — see src/lib/n8n-webhook.ts).
 *
 * AUTHORIZATION (added 2026-10-22, ART-20261022-045): a valid signature
 * proves only that the caller holds *a* bridge credential. It does not
 * prove the caller may write for the user named in the payload. Every
 * credential is therefore BOUND to one owner + one permitted agent
 * (see src/lib/bridge-authz.ts):
 *   - payload.userId must equal the binding's ownerId (else 403);
 *   - the binding's agent must be a registered `user_agents` row that
 *     belongs to that owner (else 403);
 *   - the written memory is attributed to that agent (`agent_id`).
 * Every outcome — accepted or rejected — is recorded in
 * `bridge_audit_log` (fingerprints only, never content or secrets).
 * An accepted write whose audit row cannot be written is reported as a
 * failure (500); the idempotent upsert makes the caller's retry safe.
 *
 * This does NOT bypass anything the rest of the app doesn't already
 * rely on: every memories query in this codebase is isolated by an
 * app-layer `owner_id` filter, not by Postgres RLS (RLS policies on
 * `memories` are `FOR ALL TO service_role USING (true)` — service_role
 * already sees every row; isolation is enforced here, in code, same as
 * /api/memory and memory-service.ts).
 *
 * Idempotency: reuses the EXISTING unique index
 *   idx_memories_dedupe ON memories(owner_id, project_id, agent_slug, memory_type, dedupe_key)
 *   WHERE dedupe_key IS NOT NULL
 * by mapping the webhook's `idempotencyKey` directly onto `dedupe_key`.
 * A retried webhook delivery with the same idempotencyKey upserts the
 * same row instead of creating a duplicate.
 *
 * Schema constraints that shaped the column values below (verified
 * against supabase/migrations, not assumed):
 *   - agent_slug has CHECK (agent_slug IS NULL OR agent_slug IN ('litt','spark'))
 *     → n8n-sourced memories are recorded as LiTT's own ('litt'), the
 *     only value that both satisfies the CHECK and reads correctly.
 *     The specific registered agent is carried by `agent_id` instead.
 *   - project_id/agent_slug/dedupe_key participate in a UNIQUE index —
 *     Postgres treats NULL as never equal to NULL in that comparison,
 *     so a NULL project_id would make the upsert silently re-insert
 *     instead of deduping. A fixed nil-UUID sentinel is used when the
 *     caller doesn't supply a real project. (conversation_id differs:
 *     it is FK-referenced and NOT part of the dedupe index, so it must
 *     be NULL — see the row literal below.)
 *   - scope has NOT NULL DEFAULT 'profile' CHECK (... IN (...)); 'agent'
 *     is used here since this is an automation-sourced memory, not a
 *     user-stated preference.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/n8n-webhook";
import {
  recordBridgeAudit,
  resolveBridgeBinding,
  verifyBoundAgent,
} from "@/lib/bridge-authz";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

const ENDPOINT = "POST /api/n8n/memory";

/** Sentinel for "no specific project" — mirrors memory-service.ts's convention. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Duplicated from memory-service.ts intentionally (same pattern the
// existing memory-service test suite already uses) rather than
// importing a private helper from a file this change doesn't otherwise
// touch — keeps this new route fully self-contained and reviewable.
const SECRET_PATTERNS = [
  /(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{20,}/i,
  /gh[pousr]_[A-Za-z0-9]{36,}/i,
  /github_pat_[A-Za-z0-9_]{82,}/i,
  /AIza[a-zA-Z0-9_\-]{35}/i,
  /eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/i,
  /xox[baprs]-[a-zA-Z0-9-]+/i,
  /\b(?:password|passwd|pwd|secret|token|api_key|apikey|private_key)\s*[:=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /supabase.*service.*role.*key/i,
  /NEXT_PUBLIC_SUPABASE_ANON_KEY/i,
  /CLERK_SECRET_KEY/i,
  /STRIPE_SECRET_KEY/i,
];

function containsSecrets(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

interface N8nMemoryWritePayload {
  userId: string;
  idempotencyKey: string;
  content: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

function validatePayload(body: unknown): { ok: true; payload: N8nMemoryWritePayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Request body must be a JSON object" };
  const b = body as Record<string, unknown>;

  if (typeof b.userId !== "string" || b.userId.trim() === "") {
    return { ok: false, error: "userId is required" };
  }
  if (typeof b.idempotencyKey !== "string" || b.idempotencyKey.trim() === "") {
    return { ok: false, error: "idempotencyKey is required" };
  }
  if (typeof b.content !== "string" || b.content.trim() === "") {
    return { ok: false, error: "content is required" };
  }
  if (b.projectId !== undefined && (typeof b.projectId !== "string" || !UUID_RE.test(b.projectId))) {
    return { ok: false, error: "projectId must be a UUID when provided" };
  }
  if (b.metadata !== undefined && (typeof b.metadata !== "object" || b.metadata === null || Array.isArray(b.metadata))) {
    return { ok: false, error: "metadata must be an object when provided" };
  }

  return {
    ok: true,
    payload: {
      userId: b.userId,
      idempotencyKey: b.idempotencyKey,
      content: b.content,
      projectId: b.projectId as string | undefined,
      metadata: (b.metadata as Record<string, unknown> | undefined) ?? {},
    },
  };
}

async function postHandler(req: NextRequest): Promise<NextResponse> {
  // ── Resolve the credential binding. No binding = bridge not
  // configured for this credential → fail closed. ──
  const credentialHeader = req.headers.get("x-litt-credential");
  const binding = resolveBridgeBinding(credentialHeader);
  if (!binding) {
    return NextResponse.json({ error: "Bridge not configured" }, { status: 503 });
  }

  const rawBody = await req.text();

  // ── Authenticate: signed webhook ONLY (no legacy shared-secret
  // fallback for this endpoint — it writes data, unlike the generic
  // forwarding bridge, so it gets the strictest of the two existing
  // auth modes rather than both). The signature is verified against
  // the BOUND credential's secret. ──
  const signature = req.headers.get("x-litt-signature");
  const timestampHeader = req.headers.get("x-litt-timestamp");
  const timestamp = timestampHeader ? Number(timestampHeader) : NaN;
  const signatureOk =
    !!signature &&
    Number.isFinite(timestamp) &&
    verifyWebhookSignature(
      rawBody,
      signature,
      timestamp,
      Math.floor(Date.now() / 1000),
      binding.secret,
    );
  if (!signatureOk) {
    await recordBridgeAudit(supabaseAdmin, {
      credentialId: binding.credentialId,
      boundOwnerId: binding.ownerId,
      suppliedUserId: null,
      agentId: binding.agentId,
      outcome: "rejected_auth",
      reason: "invalid signature or expired timestamp",
      content: rawBody,
      endpoint: ENDPOINT,
    });
    console.warn("[n8n-memory] rejected: invalid signature or expired timestamp");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse + validate payload ──
  let parsedBody: unknown;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsedBody = null;
  }
  const validation = validatePayload(parsedBody);
  if (!validation.ok) {
    const b =
      parsedBody && typeof parsedBody === "object"
        ? (parsedBody as Record<string, unknown>)
        : {};
    await recordBridgeAudit(supabaseAdmin, {
      credentialId: binding.credentialId,
      boundOwnerId: binding.ownerId,
      suppliedUserId: typeof b.userId === "string" ? b.userId : null,
      agentId: binding.agentId,
      outcome: "rejected_validation",
      reason: validation.error,
      content: typeof b.content === "string" ? b.content : null,
      idempotencyKey: typeof b.idempotencyKey === "string" ? b.idempotencyKey : null,
      endpoint: ENDPOINT,
    });
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { payload } = validation;

  // ── Authorize: the payload may only write for the owner this
  // credential is bound to. A different userId is a forged-ID attempt
  // from a credential holder — reject and leave durable evidence. ──
  if (payload.userId !== binding.ownerId) {
    await recordBridgeAudit(supabaseAdmin, {
      credentialId: binding.credentialId,
      boundOwnerId: binding.ownerId,
      suppliedUserId: payload.userId,
      agentId: binding.agentId,
      outcome: "rejected_binding",
      reason: "payload userId does not match the credential's bound owner",
      content: payload.content,
      idempotencyKey: payload.idempotencyKey,
      endpoint: ENDPOINT,
    });
    console.warn("[n8n-memory] rejected: userId does not match credential binding");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Authorize: the bound agent must be registered to that owner. ──
  const agentOk = await verifyBoundAgent(supabaseAdmin, binding);
  if (!agentOk) {
    await recordBridgeAudit(supabaseAdmin, {
      credentialId: binding.credentialId,
      boundOwnerId: binding.ownerId,
      suppliedUserId: payload.userId,
      agentId: binding.agentId,
      outcome: "rejected_agent",
      reason: "bound agent is not a registered user_agents row for the bound owner",
      content: payload.content,
      idempotencyKey: payload.idempotencyKey,
      endpoint: ENDPOINT,
    });
    console.warn("[n8n-memory] rejected: bound agent not registered for owner");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Block secrets — never persist credential-shaped content ──
  if (containsSecrets(payload.content)) {
    await recordBridgeAudit(supabaseAdmin, {
      credentialId: binding.credentialId,
      boundOwnerId: binding.ownerId,
      suppliedUserId: payload.userId,
      agentId: binding.agentId,
      outcome: "rejected_secret_content",
      reason: "content matched the secret-shape screen",
      content: payload.content,
      idempotencyKey: payload.idempotencyKey,
      endpoint: ENDPOINT,
    });
    console.warn("[n8n-memory] blocked write containing secret-shaped content", {
      userId: payload.userId,
    });
    return NextResponse.json({ error: "Content contains secrets and was not stored" }, { status: 400 });
  }

  const row = {
    owner_id: payload.userId,
    // The registered agent this write is attributed to (verified above).
    agent_id: binding.agentId,
    project_id: payload.projectId ?? NIL_UUID,
    // No FK-safe sentinel exists for conversation — the column references
    // studio_conversations(id), so "none" must be NULL (same value
    // memory-service.ts writes). conversation_id is NOT part of the dedupe
    // index, so NULL cannot weaken dedupe.
    conversation_id: null,
    agent_slug: "litt",
    memory_type: "n8n_event",
    dedupe_key: payload.idempotencyKey,
    scope: "agent",
    content: payload.content,
    metadata: payload.metadata ?? {},
    source: "n8n",
    sync_status: "pending",
  };

  // Upsert on the existing dedupe unique index; retried deliveries of
  // the same idempotencyKey update the same row instead of duplicating.
  const { data, error } = await supabaseAdmin
    .from("memories")
    .upsert(row, { onConflict: "owner_id,project_id,agent_slug,memory_type,dedupe_key" })
    .select()
    .single();

  if (error || !data) {
    await recordBridgeAudit(supabaseAdmin, {
      credentialId: binding.credentialId,
      boundOwnerId: binding.ownerId,
      suppliedUserId: payload.userId,
      agentId: binding.agentId,
      outcome: "error",
      reason: `memory upsert failed: ${error?.message ?? "no data returned"}`,
      content: payload.content,
      idempotencyKey: payload.idempotencyKey,
      endpoint: ENDPOINT,
    });
    console.error("[n8n-memory] upsert failed:", error?.message ?? "no data returned");
    return NextResponse.json({ error: error?.message ?? "Failed to persist memory" }, { status: 500 });
  }

  // The audit trail is part of the security control: a write we cannot
  // audit is reported as failed. The upsert is idempotent, so the
  // caller's retry re-attempts both the write and its audit row safely.
  const audited = await recordBridgeAudit(supabaseAdmin, {
    credentialId: binding.credentialId,
    boundOwnerId: binding.ownerId,
    suppliedUserId: payload.userId,
    agentId: binding.agentId,
    outcome: "accepted",
    reason: "signature, binding, and agent registration verified",
    content: payload.content,
    idempotencyKey: payload.idempotencyKey,
    endpoint: ENDPOINT,
  });
  if (!audited) {
    return NextResponse.json({ error: "Audit write failed" }, { status: 500 });
  }

  return NextResponse.json({ memory: data });
}

export const POST = withRateLimit(postHandler, 30, 60);
