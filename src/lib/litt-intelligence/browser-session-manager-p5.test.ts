/**
 * Agent Browser Phase 5 — multi-instance-safe sessions (reconnect).
 *
 * Uses the real browser-session-manager wired to the real browser-billing
 * module. The vendor (Browserbase/Stagehand) is a fake; Supabase is a
 * fake in-memory row store; the wallet ledger is mocked.
 *
 * Covered:
 *  1. Simulated instance loss (in-memory registry cleared, DB row kept)
 *     → executeBrowserAction transparently re-attaches via
 *     `new Stagehand({ env: "BROWSERBASE", browserbaseSessionID })` and
 *     writes a `browser.reconnect` audit event.
 *  2. Provider-side expiry (init throws) → honest fresh-start outcome:
 *     plain-English "expired on the provider" error, row marked closed,
 *     no fake success, no BITS debited.
 *  3. Idle-TTL row on re-attach → "expired" without ever touching the
 *     provider.
 *  4. Row closed mid-re-attach (lost race) → "closed", our connection
 *     dropped, never driven.
 *  5. Concurrent re-attach race → exactly one Stagehand.init(), single
 *     winner shared by both callers.
 *  6. sweepIdleBrowserSessions() closes DB-side idle rows (no local
 *     process owns them) and settles BITS from the persisted row
 *     snapshot; fresh rows are untouched.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fake Stagehand (the vendor) ──────────────────────────────────
const stagehandMock = vi.hoisted(() => {
  const state = {
    constructs: [] as Array<Record<string, unknown>>,
    initImpl: (async () => {}) as () => Promise<void>,
  };
  class FakeStagehand {
    static instances: FakeStagehand[] = [];
    config: Record<string, unknown>;
    closed = false;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      state.constructs.push(config);
      FakeStagehand.instances.push(this);
    }
    async init(): Promise<void> {
      return state.initImpl();
    }
    async close(): Promise<void> {
      this.closed = true;
    }
  }
  return { state, FakeStagehand };
});

vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: stagehandMock.FakeStagehand,
}));

// ─── Fake Supabase (in-memory row store) ──────────────────────────
type Row = Record<string, any>;

const dbMock = vi.hoisted(() => {
  const state = {
    sessions: new Map<string, Row>(),
    actions: [] as Row[],
  };

  class Q {
    private table: string;
    private kind: "select" | "insert" | "update";
    private payload: any;
    private filters: Array<(r: Row) => boolean> = [];
    private orderKey: string | null = null;
    private orderAsc = true;
    private limitN: number | null = null;
    private returningCols: string | null = null;

    constructor(table: string, kind: "select" | "insert" | "update", payload: any, cols?: string) {
      this.table = table;
      this.kind = kind;
      this.payload = payload;
      this.returningCols = cols ?? null;
    }
    select(cols?: string) {
      this.returningCols = cols ?? "*";
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((r) => r[col] === val);
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((r) => (vals as unknown[]).includes(r[col]));
      return this;
    }
    lt(col: string, val: string) {
      this.filters.push((r) => String(r[col]) < String(val));
      return this;
    }
    gte(col: string, val: string) {
      this.filters.push((r) => String(r[col]) >= String(val));
      return this;
    }
    order(col: string, opts?: { ascending?: boolean }) {
      this.orderKey = col;
      this.orderAsc = opts?.ascending !== false;
      return this;
    }
    limit(n: number) {
      this.limitN = n;
      return this;
    }
    private matched(): Row[] {
      let rows = [...state.sessions.values()].filter((r) =>
        this.filters.every((f) => f(r)),
      );
      if (this.orderKey) {
        const k = this.orderKey;
        const dir = this.orderAsc ? 1 : -1;
        rows = [...rows].sort((a, b) =>
          String(a[k]) < String(b[k]) ? -dir : String(a[k]) > String(b[k]) ? dir : 0,
        );
      }
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return rows;
    }
    async maybeSingle() {
      const rows = this.matched();
      return { data: rows[0] ?? null, error: null };
    }
    // Thenable so chains can be awaited directly (insert / update).
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try {
        if (this.kind === "insert") {
          if (this.table === "browser_actions") state.actions.push({ ...this.payload });
          else if (this.table === "browser_sessions")
            state.sessions.set(this.payload.id, { ...this.payload });
          resolve({ data: null, error: null });
        } else if (this.kind === "update") {
          const rows = this.matched();
          for (const r of rows) Object.assign(r, this.payload);
          resolve({
            data: this.returningCols ? rows.map((r) => ({ id: r.id })) : rows,
            error: null,
          });
        } else {
          resolve({ data: this.matched(), error: null });
        }
      } catch (e) {
        reject(e);
      }
    }
  }

  const fakeAdmin = {
    from: (table: string) => ({
      select: (cols?: string) => new Q(table, "select", null, cols),
      insert: (payload: any) => new Q(table, "insert", payload),
      update: (payload: any) => new Q(table, "update", payload),
    }),
  };

  return { state, fakeAdmin };
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: dbMock.fakeAdmin,
  getSupabaseAdmin: () => null,
}));

// ─── Action Runtime reconciliation (unit-tested separately) ──────
const runtimeReconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/action-runtime/browser-sweep", () => ({
  reconcileSweptBrowserSession: runtimeReconcile,
}));

// ─── Wallet ledger + owner billing ────────────────────────────────
vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(),
  adjustWalletBalance: vi.fn(),
}));

vi.mock("@/lib/owner", () => ({
  isBillingExempt: () => false,
}));

import { adjustWalletBalance } from "@/lib/wallet-ledger";
import {
  executeBrowserAction,
  getOrReattachStagehand,
  closeSession,
  sweepIdleBrowserSessions,
  SESSION_EXPIRED_PLAIN_MESSAGE,
  __registerActiveSessionForTest,
  __resetActiveSessionsForTest,
  type BrowserSession,
} from "./browser-session-manager";
import { browserClose } from "./browser-tool-handlers";
import { __resetBrowserBillingForTest } from "./browser-billing";

const mockAdjust = vi.mocked(adjustWalletBalance);

const USER = "user_p5_non_owner";

function dbRow(overrides: Partial<Row> = {}): Row {
  const now = new Date().toISOString();
  return {
    id: `sess-${Math.random().toString(36).slice(2)}`,
    user_id: USER,
    project_id: null,
    conversation_id: "conv-p5",
    browserbase_session_id: "bb-p5-1",
    status: "active",
    controller: "agent",
    task: null,
    live_view_url: null,
    error: null,
    metadata: {},
    created_at: now,
    updated_at: now,
    closed_at: null,
    ...overrides,
  };
}

function seed(row: Row): Row {
  dbMock.state.sessions.set(row.id, row);
  return row;
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetActiveSessionsForTest();
  __resetBrowserBillingForTest();
  dbMock.state.sessions.clear();
  dbMock.state.actions = [];
  stagehandMock.state.constructs = [];
  stagehandMock.FakeStagehand.instances = [];
  stagehandMock.state.initImpl = async () => {};
  mockAdjust.mockResolvedValue({ replayed: false } as never);
  runtimeReconcile.mockResolvedValue("no_run");
});

describe("Phase 5 — transparent re-attach after instance loss", () => {
  it("re-attaches to the stored provider session; caller can't tell except via the audit event", async () => {
    const row = seed(dbRow({ browserbase_session_id: "bb-reconnect-xyz" }));
    // Simulate instance loss: DB row survives, in-memory registry is empty.
    __resetActiveSessionsForTest();

    const result = await executeBrowserAction(
      row.id,
      USER,
      "browser.snapshot",
      {},
      async (sh) => ({
        success: true,
        data: { ranOnReattached: Boolean(sh) },
        durationMs: 3,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ranOnReattached: true });

    // Exactly one re-attach, via the documented resume config.
    expect(stagehandMock.state.constructs).toHaveLength(1);
    const cfg = stagehandMock.state.constructs[0];
    expect(cfg.env).toBe("BROWSERBASE");
    expect(cfg.browserbaseSessionID).toBe("bb-reconnect-xyz");

    // The audit log records the reconnect; the caller saw a plain success.
    const reconnects = dbMock.state.actions.filter(
      (a) => a.action === "browser.reconnect",
    );
    expect(reconnects).toHaveLength(1);
    expect(reconnects[0].success).toBe(true);
    expect(reconnects[0].session_id).toBe(row.id);

    // Second action reuses the registry — no second provider connect.
    const again = await executeBrowserAction(
      row.id,
      USER,
      "browser.snapshot",
      {},
      async () => ({ success: true, durationMs: 1 }),
    );
    expect(again.success).toBe(true);
    expect(stagehandMock.state.constructs).toHaveLength(1);
  });

  it("fast path: in-memory session never touches the provider", async () => {
    const session = {
      id: "sess-mem",
      userId: USER,
      projectId: null,
      conversationId: null,
      browserbaseSessionId: "bb-mem",
      status: "active",
      controller: "agent",
      task: null,
      liveViewUrl: null,
      error: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closedAt: null,
    } as BrowserSession;
    __registerActiveSessionForTest({
      stagehand: { close: async () => {} } as never,
      session,
      lastActivity: Date.now(),
    });

    const result = await executeBrowserAction(
      session.id,
      USER,
      "browser.snapshot",
      {},
      async () => ({ success: true, durationMs: 1 }),
    );
    expect(result.success).toBe(true);
    expect(stagehandMock.state.constructs).toHaveLength(0);
  });
});

describe("Phase 5 — honest fresh start on provider-side expiry", () => {
  it("marks the row closed and returns the plain-English expiry message — no fake success", async () => {
    const row = seed(dbRow());
    stagehandMock.state.initImpl = async () => {
      throw new Error("BrowserbaseSessionNotFoundError");
    };

    const result = await executeBrowserAction(
      row.id,
      USER,
      "browser.snapshot",
      {},
      async () => ({ success: true, durationMs: 1 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("expired on the provider");
    // The row is honestly closed — the next attempt starts fresh.
    expect(dbMock.state.sessions.get(row.id)?.status).toBe("closed");
    expect(dbMock.state.sessions.get(row.id)?.closed_at).toBeTruthy();
    // 0 BITS: no recorded action → no ledger write at all.
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("an idle-TTL row expires without ever contacting the provider", async () => {
    const row = seed(dbRow({ updated_at: isoAgo(20 * 60_000) }));

    const res = await getOrReattachStagehand(row.id, USER);

    expect(res.outcome).toBe("expired");
    expect(res.stagehand).toBeNull();
    expect(res.message).toBe(SESSION_EXPIRED_PLAIN_MESSAGE);
    expect(stagehandMock.state.constructs).toHaveLength(0);
    expect(dbMock.state.sessions.get(row.id)?.status).toBe("closed");
  });

  it("a row closed mid-re-attach reports closed and drops our connection", async () => {
    const row = seed(dbRow());
    stagehandMock.state.initImpl = async () => {
      // Another instance closed the row while we were connecting.
      dbMock.state.sessions.get(row.id)!.status = "closed";
    };

    const res = await getOrReattachStagehand(row.id, USER);

    expect(res.outcome).toBe("closed");
    expect(res.stagehand).toBeNull();
    // We connected, then dropped OUR connection — never drive it.
    expect(stagehandMock.FakeStagehand.instances).toHaveLength(1);
    expect(stagehandMock.FakeStagehand.instances[0].closed).toBe(true);
  });
});

describe("Phase 5 — concurrent re-attach race", () => {
  it("two concurrent callers share one Stagehand.init() — single winner", async () => {
    const row = seed(dbRow());
    let release!: () => void;
    stagehandMock.state.initImpl = () =>
      new Promise<void>((r) => {
        release = r;
      });

    const p1 = getOrReattachStagehand(row.id, USER);
    const p2 = getOrReattachStagehand(row.id, USER);
    // Let both reach the in-flight map before init resolves.
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(stagehandMock.state.constructs).toHaveLength(1);
    expect(r1.outcome).toBe("attached");
    expect(r2.outcome).toBe("attached");
    expect(r1.stagehand).toBe(r2.stagehand);
    expect(r1.stagehand).not.toBeNull();
  });
});

describe("Phase 5 — sweepIdleBrowserSessions", () => {
  it("closes DB-side idle rows, settles BITS from the row snapshot, leaves fresh rows alone", async () => {
    const idle = seed(
      dbRow({
        id: "sess-sweep-idle",
        created_at: isoAgo(20.5 * 60_000),
        updated_at: isoAgo(20 * 60_000),
        metadata: { billing: { actionCount: 3, modelCalls: 2 } },
      }),
    );
    const fresh = seed(dbRow({ id: "sess-sweep-fresh" }));

    const res = await sweepIdleBrowserSessions();

    expect(res.localClosed).toBe(0);
    expect(res.dbClosed).toBe(1);
    // 21 wall minutes × 45 + 2 model calls × 10 = 965 BITS.
    expect(res.settledBits).toBe(965);

    expect(dbMock.state.sessions.get(idle.id)?.status).toBe("closed");
    expect(dbMock.state.sessions.get(fresh.id)?.status).toBe("active");

    expect(mockAdjust).toHaveBeenCalledTimes(1);
    expect(mockAdjust).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: USER,
        amount: -965,
        idempotencyKey: "browser:settle:sess-sweep-idle",
      }),
    );
  });

  it("a second sweep of the same row is an idempotent no-op (no double charge)", async () => {
    const idle = seed(
      dbRow({
        id: "sess-sweep-once",
        created_at: isoAgo(20.5 * 60_000),
        updated_at: isoAgo(20 * 60_000),
        metadata: { billing: { actionCount: 1, modelCalls: 0 } },
      }),
    );

    const first = await sweepIdleBrowserSessions();
    mockAdjust.mockClear();
    mockAdjust.mockResolvedValue({ replayed: true } as never);
    const second = await sweepIdleBrowserSessions();

    // Row already closed → the conditional close loses → nothing to do.
    expect(first.dbClosed).toBe(1);
    expect(second.dbClosed).toBe(0);
    expect(second.settledBits).toBe(0);
    expect(mockAdjust).not.toHaveBeenCalled();
    expect(dbMock.state.sessions.get(idle.id)?.status).toBe("closed");
  });

  it("two concurrent sweepers elect one winner: one close, one settle, one reconcile", async () => {
    const idle = seed(
      dbRow({
        id: "sess-sweep-race",
        created_at: isoAgo(20.5 * 60_000),
        updated_at: isoAgo(20 * 60_000),
        metadata: { billing: { actionCount: 1, modelCalls: 0 } },
      }),
    );
    runtimeReconcile.mockResolvedValue("event_recorded");

    const [a, b] = await Promise.all([
      sweepIdleBrowserSessions(),
      sweepIdleBrowserSessions(),
    ]);

    // Exactly one logical close across both sweeps.
    expect(a.dbClosed + b.dbClosed).toBe(1);
    expect(a.closed + b.closed).toBe(1);
    expect(dbMock.state.sessions.get(idle.id)?.status).toBe("closed");

    // Exactly one billing settlement, under the session-scoped key.
    expect(mockAdjust).toHaveBeenCalledTimes(1);
    expect(mockAdjust).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "browser:settle:sess-sweep-race" }),
    );

    // Exactly one Action Runtime reconciliation — the losing sweeper does
    // not emit a duplicate idle-timeout lifecycle event.
    expect(runtimeReconcile).toHaveBeenCalledTimes(1);
    expect(runtimeReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sess-sweep-race", userId: USER }),
    );
    expect(a.runtimeReconciled + b.runtimeReconciled).toBe(1);
  });

  it("reports observable sweep counts without secrets or provider internals", async () => {
    seed(
      dbRow({
        id: "sess-sweep-observe",
        created_at: isoAgo(20.5 * 60_000),
        updated_at: isoAgo(20 * 60_000),
        metadata: { billing: { actionCount: 1, modelCalls: 0 } },
      }),
    );
    runtimeReconcile.mockResolvedValue("event_recorded");

    const res = await sweepIdleBrowserSessions();

    expect(res.inspected).toBe(1);
    expect(res.expired).toBe(1);
    expect(res.closed).toBe(1);
    expect(res.billingSettled).toBe(1);
    expect(res.providerCleanupFailed).toBe(0);
    expect(res.runtimeReconciled).toBe(1);
    expect(res.runtimeReconcileFailed).toBe(0);
    expect(JSON.stringify(res)).not.toMatch(/api[_-]?key|token|password|secret/i);
  });

  it("a failed runtime reconciliation is counted and logged, never silently dropped", async () => {
    seed(
      dbRow({
        id: "sess-sweep-reconcile-fail",
        created_at: isoAgo(20.5 * 60_000),
        updated_at: isoAgo(20 * 60_000),
        metadata: { billing: { actionCount: 1, modelCalls: 0 } },
      }),
    );
    runtimeReconcile.mockRejectedValue(new Error("action_runs write failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await sweepIdleBrowserSessions();

    // The close + settle still happened; the reconcile failure is visible.
    expect(res.dbClosed).toBe(1);
    expect(res.runtimeReconciled).toBe(0);
    expect(res.runtimeReconcileFailed).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[browser-session-sweep] ActionRun reconciliation failed",
      expect.objectContaining({ sessionId: "sess-sweep-reconcile-fail" }),
    );
    errorSpy.mockRestore();
  });
});

describe("Phase 5 — agent-initiated browser.close settles immediately", () => {
  it("closes the DB row and settles BITS at close time — no waiting for the sweeper", async () => {
    // Owning process died: DB row + billing snapshot survive, no
    // in-memory registry, no accumulator. The agent closes from a new
    // process (e.g. a different Railway replica).
    const row = seed(
      dbRow({
        id: "sess-close-settle",
        created_at: isoAgo(20.5 * 60_000),
        updated_at: isoAgo(60_000),
        metadata: { billing: { actionCount: 3, modelCalls: 2 } },
      }),
    );

    const res = await browserClose({ sessionId: row.id, userId: USER }, {});

    expect(res.success).toBe(true);
    expect(dbMock.state.sessions.get(row.id)?.status).toBe("closed");
    // 21 wall minutes × 45 + 2 model calls × 10 = 965 BITS, settled at
    // close time from the row snapshot (no live accumulator exists).
    expect(mockAdjust).toHaveBeenCalledTimes(1);
    expect(mockAdjust).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: USER,
        amount: -965,
        idempotencyKey: "browser:settle:sess-close-settle",
      }),
    );
    // The close itself is in the audit trail.
    const closes = dbMock.state.actions.filter(
      (a) => a.action === "browser.close",
    );
    expect(closes).toHaveLength(1);
    expect(closes[0].success).toBe(true);
  });

  it("a repeated close replays with the same idempotency key — never a double charge", async () => {
    const row = seed(dbRow({ id: "sess-close-twice" }));

    await browserClose({ sessionId: row.id, userId: USER }, {});
    const callsAfterFirst = mockAdjust.mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Second close of an already-closed session: the row is already
    // closed, the attach fails honestly, and the settle carries the
    // SAME idempotency key — the wallet ledger dedupes it into a
    // replay (replayed: true in production), never a second charge.
    await browserClose({ sessionId: row.id, userId: USER }, {});
    const keys = mockAdjust.mock.calls.map((c) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("browser:settle:sess-close-twice");
    expect(dbMock.state.sessions.get(row.id)?.status).toBe("closed");
  });
});

describe("Phase 5 — closeSession from a non-owning process", () => {
  it("settles from the row snapshot when no live accumulator exists", async () => {
    const row = seed(
      dbRow({
        id: "sess-close-row",
        created_at: isoAgo(20.5 * 60_000),
        updated_at: isoAgo(60_000),
        metadata: { billing: { actionCount: 3, modelCalls: 2 } },
      }),
    );

    await closeSession(row.id, USER);

    expect(dbMock.state.sessions.get(row.id)?.status).toBe("closed");
    expect(mockAdjust).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: -965,
        idempotencyKey: "browser:settle:sess-close-row",
      }),
    );
  });
});
