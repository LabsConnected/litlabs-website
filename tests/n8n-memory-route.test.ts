// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";

const BRIDGE_SECRET = "test-bridge-secret-not-real";

const BOUND_OWNER = "user_synthetic_1";
const BOUND_AGENT_ID = "22222222-2222-2222-2222-222222222222";

const mocks = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
  upsert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  auditInsert: vi.fn(),
  agentMaybeSingle: vi.fn(),
  singleResult: {
    data: {
      id: "11111111-1111-1111-1111-111111111111",
      owner_id: "user_synthetic_1",
      content: "synthetic test memory",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    error: null as { message: string } | null,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: mocks.supabaseFrom,
  },
  // The rate limiter (withRateLimit) also imports getSupabaseAdmin —
  // returning null routes it to its in-process fallback counter.
  getSupabaseAdmin: () => null,
}));

function sign(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function buildRequest(bodyObj: unknown, opts: { signed?: boolean; secret?: string; timestamp?: number } = {}) {
  const body = JSON.stringify(bodyObj);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.signed !== false) {
    headers["x-litt-signature"] = sign(body, opts.secret ?? BRIDGE_SECRET, timestamp);
    headers["x-litt-timestamp"] = String(timestamp);
  }
  return new NextRequest("https://www.litlabs.net/api/n8n/memory", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/n8n/memory", () => {
  beforeEach(() => {
    vi.stubEnv("LITT_N8N_BRIDGE_SECRET", BRIDGE_SECRET);
    // The route now requires a credential binding (owner + agent);
    // the default binding is synthesized from these three envs.
    vi.stubEnv("LITT_BRIDGE_OWNER_ID", BOUND_OWNER);
    vi.stubEnv("LITT_BRIDGE_AGENT_ID", BOUND_AGENT_ID);
    vi.stubEnv("LITT_BRIDGE_BINDINGS", "");
    mocks.supabaseFrom.mockReset();
    mocks.upsert.mockReset();
    mocks.select.mockReset();
    mocks.single.mockReset();
    mocks.auditInsert.mockReset();
    mocks.agentMaybeSingle.mockReset();
    // supabaseAdmin.from dispatches per table: memories upserts,
    // user_agents lookups (bound agent is registered by default), and
    // bridge_audit_log inserts (which always succeed by default).
    mocks.supabaseFrom.mockImplementation((table: string) => {
      if (table === "user_agents") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: mocks.agentMaybeSingle }) }),
          }),
        };
      }
      if (table === "bridge_audit_log") {
        return { insert: mocks.auditInsert };
      }
      return { upsert: mocks.upsert };
    });
    mocks.agentMaybeSingle.mockImplementation(() =>
      Promise.resolve({ data: { id: BOUND_AGENT_ID }, error: null }),
    );
    mocks.auditInsert.mockImplementation(() => Promise.resolve({ error: null }));
    mocks.upsert.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ single: mocks.single });
    mocks.single.mockImplementation(() => Promise.resolve(mocks.singleResult));
  });

  it("writes a memory for a validly signed request", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest({
      userId: "user_synthetic_1",
      idempotencyKey: "evt-abc-123",
      content: "synthetic test memory",
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.memory.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(mocks.supabaseFrom).toHaveBeenCalledWith("memories");
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: "user_synthetic_1",
        agent_id: BOUND_AGENT_ID,
        dedupe_key: "evt-abc-123",
        agent_slug: "litt",
        memory_type: "n8n_event",
        project_id: "00000000-0000-0000-0000-000000000000",
      }),
      { onConflict: "owner_id,project_id,agent_slug,memory_type,dedupe_key" },
    );
  });

  it("rejects a request with no signature headers", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest(
      { userId: "user_synthetic_1", idempotencyKey: "evt-1", content: "x" },
      { signed: false },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a request signed with the wrong secret", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest(
      { userId: "user_synthetic_1", idempotencyKey: "evt-1", content: "x" },
      { secret: "wrong-secret" },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (replay protection)", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes old
    const req = buildRequest(
      { userId: "user_synthetic_1", idempotencyKey: "evt-1", content: "x" },
      { timestamp: staleTimestamp },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a payload missing userId", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest({ idempotencyKey: "evt-1", content: "x" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a payload missing idempotencyKey", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest({ userId: "user_synthetic_1", content: "x" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("blocks content shaped like a secret and never calls the DB", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest({
      userId: "user_synthetic_1",
      idempotencyKey: "evt-secret",
      content: "password: hunter2hunter2",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("returns 503 when the bridge secret is not configured", async () => {
    vi.stubEnv("LITT_N8N_BRIDGE_SECRET", "");
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest({ userId: "u", idempotencyKey: "e", content: "x" });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("upserts on the same dedupe key for a repeated (retried) webhook", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const payload = { userId: "user_synthetic_1", idempotencyKey: "evt-retry-1", content: "retry me" };

    const res1 = await POST(buildRequest(payload));
    const res2 = await POST(buildRequest(payload));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    // Both calls target the identical conflict key — Postgres's unique
    // index (not this mock) is what actually prevents the duplicate row;
    // this assertion verifies the route sends the dedupe-capable shape
    // both times rather than falling back to a plain insert.
    const [firstRow] = mocks.upsert.mock.calls[0];
    const [secondRow] = mocks.upsert.mock.calls[1];
    expect(firstRow.dedupe_key).toBe(secondRow.dedupe_key);
    expect(firstRow.owner_id).toBe(secondRow.owner_id);
  });

  it("rejects a payload naming a different user than the credential's bound owner", async () => {
    const { POST } = await import("@/app/api/n8n/memory/route");
    const req = buildRequest({
      userId: "user_synthetic_2",
      idempotencyKey: "evt-cross-user",
      content: "belongs to user 2 only",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "rejected_binding",
        supplied_user_id: "user_synthetic_2",
        bound_owner_id: BOUND_OWNER,
      }),
    );
  });
});
