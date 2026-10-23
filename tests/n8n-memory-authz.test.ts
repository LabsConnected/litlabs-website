// @vitest-environment node
/**
 * Authorization suite for POST /api/n8n/memory (ART-20261022-045).
 *
 * The route suite (n8n-memory-route.test.ts) covers the bridge's basic
 * contract. This suite proves the authorization layer Larry required
 * before the shared-brain bridge can be considered for merge:
 *   1. a credential is bound to ONE owner + ONE registered agent;
 *   2. a forged userId (valid signature, wrong user) is rejected 403
 *      and leaves a durable audit row — and NO memory is written;
 *   3. an unregistered agent identity is rejected 403;
 *   4. a second credential cannot write for the first credential's
 *      owner (multi-user separation);
 *   5. replayed deliveries stay idempotent; stale replays are 401;
 *   6. every outcome is audited with fingerprints only — the audit row
 *      never contains the memory content or any secret;
 *   7. if the audit write fails, an accepted write is reported failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash, createHmac } from "crypto";

const OWNER_A = "user_owner_a";
const OWNER_B = "user_owner_b";
const AGENT_A = "33333333-3333-3333-3333-333333333333";
const AGENT_B = "44444444-4444-4444-4444-444444444444";
const SECRET_A = "synthetic-secret-a";
const SECRET_B = "synthetic-secret-b";

interface AuditRow {
  credential_id: string | null;
  bound_owner_id: string | null;
  supplied_user_id: string | null;
  agent_id: string | null;
  outcome: string;
  reason: string;
  content_fingerprint: string | null;
  content_bytes: number | null;
  idempotency_key: string | null;
  endpoint: string;
}

const state = vi.hoisted(() => ({
  audits: [] as AuditRow[],
  upserts: [] as Record<string, unknown>[],
  agentRow: null as { id: string } | null,
  auditError: null as { message: string } | null,
  agentLookups: [] as { id: string; owner: string }[],
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "user_agents") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              eq: (_col2: string, owner: string) => ({
                maybeSingle: () => {
                  state.agentLookups.push({ id, owner });
                  return Promise.resolve({ data: state.agentRow, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === "bridge_audit_log") {
        return {
          insert: (row: AuditRow) => {
            if (state.auditError) return Promise.resolve({ error: state.auditError });
            state.audits.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      // memories
      return {
        upsert: (row: Record<string, unknown>) => {
          state.upserts.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: "99999999-9999-9999-9999-999999999999", ...row },
                  error: null,
                }),
            }),
          };
        },
      };
    },
  },
  getSupabaseAdmin: () => null,
}));

function sign(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function buildRequest(
  bodyObj: unknown,
  opts: { secret?: string; timestamp?: number; credential?: string } = {},
) {
  const body = JSON.stringify(bodyObj);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-litt-signature": sign(body, opts.secret ?? SECRET_A, timestamp),
    "x-litt-timestamp": String(timestamp),
  };
  if (opts.credential) headers["x-litt-credential"] = opts.credential;
  return new NextRequest("https://www.litlabs.net/api/n8n/memory", {
    method: "POST",
    headers,
    body,
  });
}

function bindingsEnv(): string {
  return JSON.stringify([
    { credentialId: "dex-a", secret: SECRET_A, ownerId: OWNER_A, agentId: AGENT_A },
    { credentialId: "dex-b", secret: SECRET_B, ownerId: OWNER_B, agentId: AGENT_B },
  ]);
}

describe("POST /api/n8n/memory — authorization layer", () => {
  beforeEach(() => {
    state.audits.length = 0;
    state.upserts.length = 0;
    state.agentLookups.length = 0;
    state.agentRow = { id: AGENT_A };
    state.auditError = null;
    vi.stubEnv("LITT_BRIDGE_BINDINGS", bindingsEnv());
    vi.stubEnv("LITT_N8N_BRIDGE_SECRET", "");
    vi.stubEnv("LITT_BRIDGE_OWNER_ID", "");
    vi.stubEnv("LITT_BRIDGE_AGENT_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a write for the bound owner and attributes it to the registered agent", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const content = "owner A preference: dark mode";
    const res = await POST(
      buildRequest(
        { userId: OWNER_A, idempotencyKey: "evt-a-1", content },
        { credential: "dex-a" },
      ),
    );
    expect(res.status).toBe(200);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].owner_id).toBe(OWNER_A);
    expect(state.upserts[0].agent_id).toBe(AGENT_A);
    // Agent lookup was scoped to the bound owner, not just the agent id.
    expect(state.agentLookups).toEqual([{ id: AGENT_A, owner: OWNER_A }]);
    // Exactly one audit row: accepted, fingerprinted, content-free.
    expect(state.audits).toHaveLength(1);
    const audit = state.audits[0];
    expect(audit.outcome).toBe("accepted");
    expect(audit.supplied_user_id).toBe(OWNER_A);
    expect(audit.bound_owner_id).toBe(OWNER_A);
    expect(audit.content_fingerprint).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    expect(JSON.stringify(audit)).not.toContain(content);
    expect(JSON.stringify(audit)).not.toContain(SECRET_A);
  });

  it("rejects a forged userId from a valid credential holder (403, audited, nothing written)", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const res = await POST(
      buildRequest(
        { userId: OWNER_B, idempotencyKey: "evt-forge-1", content: "planted memory" },
        { credential: "dex-a" },
      ),
    );
    expect(res.status).toBe(403);
    expect(state.upserts).toHaveLength(0);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].outcome).toBe("rejected_binding");
    expect(state.audits[0].supplied_user_id).toBe(OWNER_B);
    expect(state.audits[0].bound_owner_id).toBe(OWNER_A);
  });

  it("rejects when the bound agent is not registered for the owner", async () => {
    state.agentRow = null; // user_agents has no such (id, owner) row
    const { POST } = await import("@/app/api/n8n/memory/route");
    const res = await POST(
      buildRequest(
        { userId: OWNER_A, idempotencyKey: "evt-agent-1", content: "hello" },
        { credential: "dex-a" },
      ),
    );
    expect(res.status).toBe(403);
    expect(state.upserts).toHaveLength(0);
    expect(state.audits[0].outcome).toBe("rejected_agent");
  });

  it("keeps credentials separated: credential B writes only for owner B", async () => {
    state.agentRow = { id: AGENT_B };
    const { POST } = await import("@/app/api/n8n/memory/route");
    const okRes = await POST(
      buildRequest(
        { userId: OWNER_B, idempotencyKey: "evt-b-1", content: "owner B note" },
        { credential: "dex-b", secret: SECRET_B },
      ),
    );
    expect(okRes.status).toBe(200);
    expect(state.upserts[0].agent_id).toBe(AGENT_B);

    const forged = await POST(
      buildRequest(
        { userId: OWNER_A, idempotencyKey: "evt-b-2", content: "cross-write attempt" },
        { credential: "dex-b", secret: SECRET_B },
      ),
    );
    expect(forged.status).toBe(403);
    expect(state.upserts).toHaveLength(1);
    expect(state.audits.at(-1)?.outcome).toBe("rejected_binding");
  });

  it("treats a replayed delivery as idempotent and audits each attempt", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = () =>
      buildRequest(
        { userId: OWNER_A, idempotencyKey: "evt-replay-1", content: "same event" },
        { credential: "dex-a" },
      );
    const res1 = await POST(req());
    const res2 = await POST(req());
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Both attempts upsert the identical dedupe shape (the DB unique
    // index collapses them to one row); each attempt is audited.
    expect(state.upserts).toHaveLength(2);
    expect(state.upserts[0].dedupe_key).toBe(state.upserts[1].dedupe_key);
    expect(state.audits.map((a) => a.outcome)).toEqual(["accepted", "accepted"]);
  });

  it("rejects a stale replayed request (401) and audits the rejection", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const stale = Math.floor(Date.now() / 1000) - 600;
    const res = await POST(
      buildRequest(
        { userId: OWNER_A, idempotencyKey: "evt-stale-1", content: "old news" },
        { credential: "dex-a", timestamp: stale },
      ),
    );
    expect(res.status).toBe(401);
    expect(state.upserts).toHaveLength(0);
    expect(state.audits[0].outcome).toBe("rejected_auth");
  });

  it("reports failure when the audit write itself fails (no silent unaudited success)", async () => {
    state.auditError = { message: "audit table unavailable" };
    const { POST } = await import("@/app/api/n8n/memory/route");
    const res = await POST(
      buildRequest(
        { userId: OWNER_A, idempotencyKey: "evt-audit-1", content: "must be audited" },
        { credential: "dex-a" },
      ),
    );
    expect(res.status).toBe(500);
  });

  it("fails closed (503) when no binding is configured", async () => {
    vi.stubEnv("LITT_BRIDGE_BINDINGS", "");
    const { POST } = await import("@/app/api/n8n/memory/route");
    const res = await POST(
      buildRequest({ userId: OWNER_A, idempotencyKey: "evt-none", content: "x" }),
    );
    expect(res.status).toBe(503);
    expect(state.upserts).toHaveLength(0);
  });
});
