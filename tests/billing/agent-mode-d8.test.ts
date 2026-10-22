// @vitest-environment node
/**
 * D8 regression — agent_runs.agent_mode must carry the run's MODE.
 *
 * Hosted staging rejected every run insert with
 * `agent_runs_agent_mode_check`: agent-billing wrote
 * `ctx.model ?? "default"` — a MODEL ID (or the literal "default") —
 * into a column whose check constraint allows only
 * ('standard', 'builder', 'research', 'spark')
 * (migration 20260805000000_litt_agent_identity.sql). The defect was
 * masked until the RPC row-shape fix let execution reach the insert.
 *
 * Semantics (Larry's ruling):
 *   - each allowed mode passes through unchanged;
 *   - an ABSENT mode (undefined / null / not carried) → 'standard';
 *   - an explicitly INVALID mode → the run fails closed with a loud
 *     error BEFORE any insert — never silently converted to
 *     'standard', which would conceal a routing defect — and a
 *     reservation already taken is released so no hold leaks;
 *   - ctx.model (a model id) never lands in agent_mode; it stays in
 *     input.model where it belongs.
 *
 * Harness mirrors tests/billing/agent-billing-rpc.test.ts: the REAL
 * agent-billing module over a fake supabaseAdmin at the RPC boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fake supabaseAdmin at the RPC boundary ───────────────────────

type RpcHandler = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const fake = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const writes: Array<{ table: string; op: "insert" | "update"; payload: unknown }> = [];
  let rpcHandler: RpcHandler = async () => ({ data: null, error: null });
  let exempt = false;
  let runInsertError: { message: string } | null = null;

  function chain(table: string): unknown {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) {
      c[m] = () => c;
    }
    c.insert = (payload: unknown) => {
      writes.push({ table, op: "insert", payload });
      return c;
    };
    c.update = (payload: unknown) => {
      writes.push({ table, op: "update", payload });
      return c;
    };
    c.single = async () => {
      if (table === "agent_runs") {
        if (runInsertError) return { data: null, error: runInsertError };
        return { data: { id: "run-1" }, error: null };
      }
      return { data: null, error: null };
    };
    c.maybeSingle = async () => {
      if (table === "users") return { data: { id: "user-1" }, error: null };
      return { data: null, error: null };
    };
    // Awaited directly (e.g. reconciliation inserts): neutral success.
    c.then = (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null });
    return c;
  }

  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcHandler(fn, args);
    },
    from: (table: string) => chain(table),
  };

  return {
    admin,
    rpcCalls,
    writes,
    setRpcHandler: (h: RpcHandler) => {
      rpcHandler = h;
    },
    setExempt: (v: boolean) => {
      exempt = v;
    },
    isExempt: () => exempt,
    setRunInsertError: (e: { message: string } | null) => {
      runInsertError = e;
    },
    reset: () => {
      rpcCalls.length = 0;
      writes.length = 0;
      exempt = false;
      runInsertError = null;
      rpcHandler = async () => ({ data: null, error: null });
    },
    callsTo: (fn: string) => rpcCalls.filter((c) => c.fn === fn),
    insertsTo: (table: string) => writes.filter((w) => w.table === table && w.op === "insert"),
  };
});

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: fake.admin }));
vi.mock("@/lib/owner", () => ({ isBillingExempt: () => fake.isExempt() }));
vi.mock("@/lib/metering", () => ({ emitUsageEvent: vi.fn(async () => undefined) }));

import {
  reserveCredits,
  resolveAgentRunMode,
  InvalidAgentModeError,
  type AgentRunContext,
} from "@/lib/agent-billing";

const BASE_CTX: AgentRunContext = {
  clerkId: "clerk_1",
  agentInstanceId: "studio-build",
  agentId: null,
  agentVersionId: null,
  conversationId: "conv-1",
  idempotencyKey: "req-d8",
};

function ctxWith(overrides: Record<string, unknown>): AgentRunContext {
  return { ...BASE_CTX, ...overrides } as AgentRunContext;
}

/** Hosted PostgREST shape: RETURNS TABLE comes back as an array of one row. */
function row<T extends Record<string, unknown>>(record: T): T[] {
  return [record];
}

function happyRpc(): RpcHandler {
  return async (fn) => {
    if (fn === "reserve_bits") {
      return {
        data: row({ reservation_id: "res-1", success: true, available_after: 88, reason: null }),
        error: null,
      };
    }
    if (fn === "release_bits") {
      return {
        data: row({ success: true, released_amount: 12, available_after: 100, reason: "released" }),
        error: null,
      };
    }
    return { data: null, error: null };
  };
}

interface RunInsertPayload {
  agent_mode?: unknown;
  input?: { model?: unknown; billing_exempt?: unknown };
}

function runInsertPayload(): RunInsertPayload {
  const inserts = fake.insertsTo("agent_runs");
  expect(inserts).toHaveLength(1);
  return inserts[0].payload as RunInsertPayload;
}

beforeEach(() => {
  fake.reset();
  fake.setRpcHandler(happyRpc());
});

// ─── Resolver semantics ───────────────────────────────────────────

describe("resolveAgentRunMode — the D8 mode contract", () => {
  it.each(["standard", "builder", "research", "spark"])(
    "passes the allowed mode '%s' through unchanged",
    (mode) => {
      expect(resolveAgentRunMode(mode)).toBe(mode);
    },
  );

  it("absent mode (undefined) resolves to 'standard'", () => {
    expect(resolveAgentRunMode(undefined)).toBe("standard");
  });

  it("absent mode (null) resolves to 'standard'", () => {
    expect(resolveAgentRunMode(null)).toBe("standard");
  });

  it.each(["default", "gpt-4o", "", "STANDARD", "turbo"])(
    "explicitly invalid mode %j throws InvalidAgentModeError — never a silent 'standard'",
    (bad) => {
      expect(() => resolveAgentRunMode(bad)).toThrow(InvalidAgentModeError);
    },
  );

  it("a non-string mode value throws InvalidAgentModeError", () => {
    expect(() => resolveAgentRunMode(42)).toThrow(InvalidAgentModeError);
  });
});

// ─── Reserve path ─────────────────────────────────────────────────

describe("reserveCredits — agent_mode on the reserve path", () => {
  it.each(["standard", "builder", "research", "spark"])(
    "writes agent_mode '%s' to the run row insert",
    async (mode) => {
      const res = await reserveCredits(ctxWith({ agentMode: mode }), 12);
      expect(res.ok).toBe(true);
      expect(runInsertPayload().agent_mode).toBe(mode);
    },
  );

  it("mode and model stay in their own fields: agentMode 'spark' + model id", async () => {
    const res = await reserveCredits(ctxWith({ agentMode: "spark", model: "gpt-4o" }), 12);
    expect(res.ok).toBe(true);
    const payload = runInsertPayload();
    expect(payload.agent_mode).toBe("spark");
    expect(payload.input?.model).toBe("gpt-4o");
  });

  it("absent mode writes 'standard'", async () => {
    const res = await reserveCredits(ctxWith({}), 12);
    expect(res.ok).toBe(true);
    expect(runInsertPayload().agent_mode).toBe("standard");
  });

  it("null mode writes 'standard'", async () => {
    const res = await reserveCredits(ctxWith({ agentMode: null }), 12);
    expect(res.ok).toBe(true);
    expect(runInsertPayload().agent_mode).toBe("standard");
  });

  it("a model id in ctx.model NEVER lands in agent_mode — input.model preserves it", async () => {
    const res = await reserveCredits(ctxWith({ model: "gpt-4o" }), 12);
    expect(res.ok).toBe(true);
    const payload = runInsertPayload();
    expect(payload.agent_mode).toBe("standard");
    expect(payload.agent_mode).not.toBe("gpt-4o");
    expect(payload.agent_mode).not.toBe("default");
    expect(payload.input?.model).toBe("gpt-4o");
  });

  it("no model at all: agent_mode 'standard', input.model null", async () => {
    const res = await reserveCredits(ctxWith({}), 12);
    expect(res.ok).toBe(true);
    const payload = runInsertPayload();
    expect(payload.agent_mode).toBe("standard");
    expect(payload.input?.model).toBeNull();
  });

  it("explicitly invalid mode fails closed: error names the mode, NO insert, reservation released", async () => {
    const res = await reserveCredits(ctxWith({ agentMode: "turbo-mode" }), 12);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toContain("turbo-mode");
    // The run row was never written — the invalid value reached no insert.
    expect(fake.insertsTo("agent_runs")).toHaveLength(0);
    // The reservation WAS taken first (reserve precedes run creation)…
    expect(fake.callsTo("reserve_bits")).toHaveLength(1);
    // …and it was released, so the rejected run leaks no hold.
    const releases = fake.callsTo("release_bits");
    expect(releases).toHaveLength(1);
    expect(releases[0].args).toMatchObject({
      p_reservation_id: "res-1",
      p_idempotency_key: "req-d8:release-on-invalid-mode",
    });
  });

  it("run-row insert failure releases the reservation (release-on-insert-fail)", async () => {
    fake.setRunInsertError({ message: "insert exploded" });
    const res = await reserveCredits(ctxWith({}), 12);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    const releases = fake.callsTo("release_bits");
    expect(releases).toHaveLength(1);
    expect(releases[0].args).toMatchObject({
      p_reservation_id: "res-1",
      p_idempotency_key: "req-d8:release-on-insert-fail",
    });
  });
});

// ─── Billing-exempt path ──────────────────────────────────────────

describe("reserveCredits — agent_mode on the billing-exempt path", () => {
  beforeEach(() => {
    fake.setExempt(true);
  });

  it("writes the caller's allowed mode 'builder' to the audit row", async () => {
    const res = await reserveCredits(ctxWith({ agentMode: "builder" }), 12);
    expect(res.ok).toBe(true);
    expect(res.reservationId).toBeNull();
    const payload = runInsertPayload();
    expect(payload.agent_mode).toBe("builder");
    expect(payload.input?.billing_exempt).toBe(true);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("absent mode writes 'standard'", async () => {
    const res = await reserveCredits(ctxWith({}), 12);
    expect(res.ok).toBe(true);
    expect(runInsertPayload().agent_mode).toBe("standard");
  });

  it("a model id in ctx.model NEVER lands in agent_mode — input.model preserves it", async () => {
    const res = await reserveCredits(ctxWith({ model: "claude-sonnet-4" }), 12);
    expect(res.ok).toBe(true);
    const payload = runInsertPayload();
    expect(payload.agent_mode).toBe("standard");
    expect(payload.input?.model).toBe("claude-sonnet-4");
  });

  it("explicitly invalid mode fails closed: error, NO insert, and no RPC was ever touched", async () => {
    const res = await reserveCredits(ctxWith({ agentMode: "ludicrous" }), 12);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toContain("ludicrous");
    expect(fake.insertsTo("agent_runs")).toHaveLength(0);
    // No reservation exists on the exempt path, so nothing to release.
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
