// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Agent Browser Phase 6 — owner-checked live-view resolution.
 *
 * `getJobLiveView(jobId, userId)` backs GET /api/browser/jobs/[id]/live-view.
 * Covered:
 *   1. Owner + live session + stored embed URL → available, embed URL served.
 *   2. Non-owner → null (the route turns this into 404; the capability
 *      URL is never served to anyone but the owner).
 *   3. Closed session → unavailable/session_closed, embedUrl withheld.
 *   4. Finished job → unavailable/job_finished.
 *   5. Legacy session (no stored embed URL) → lazy Debug-API fetch.
 *   6. Debug-API failure → unavailable/embed_unavailable, no broken frame.
 *   7. Job without a session → unavailable/session_not_found.
 */

// ─── Fake Stagehand (the vendor) ──────────────────────────────────
vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: class {
    async init() {}
    async close() {}
  },
}));

// ─── Fake Supabase (per-table in-memory row stores) ───────────────
type Row = Record<string, any>;

const dbMock = vi.hoisted(() => {
  const state = {
    tables: new Map<string, Map<string, Row>>(),
  };

  function table(name: string): Map<string, Row> {
    let t = state.tables.get(name);
    if (!t) {
      t = new Map();
      state.tables.set(name, t);
    }
    return t;
  }

  class Q {
    private tableName: string;
    private filters: Array<(r: Row) => boolean> = [];
    private orderKey: string | null = null;
    private orderAsc = true;
    private limitN: number | null = null;

    constructor(tableName: string) {
      this.tableName = tableName;
    }
    select() {
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
      let rows = [...table(this.tableName).values()].filter((r) =>
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
    async single() {
      const rows = this.matched();
      return { data: rows[0] ?? null, error: null };
    }
  }

  const fakeAdmin = {
    from: (name: string) => ({
      select: () => new Q(name),
      insert: (payload: any) => {
        const t = table(name);
        const id = payload.id ?? `row-${t.size + 1}`;
        t.set(id, { ...payload, id });
        return Promise.resolve({ data: null, error: null });
      },
      update: (payload: any) => ({
        eq: (col: string, val: unknown) => {
          for (const r of table(name).values()) {
            if (r[col] === val) Object.assign(r, payload);
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };

  return { state, fakeAdmin, table };
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: dbMock.fakeAdmin,
  getSupabaseAdmin: () => dbMock.fakeAdmin,
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(),
  adjustWalletBalance: vi.fn(),
}));

vi.mock("@/lib/owner", () => ({
  isBillingExempt: () => false,
}));

import {
  getJobLiveView,
  __clearLiveViewEmbedCache,
} from "./browser-job-live-view";

const OWNER = "user_p6_owner";
const OTHER = "user_p6_stranger";
const NOW = new Date().toISOString();

function jobRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "job-1",
    user_id: OWNER,
    job_type: "ghl.workflow.inspect",
    goal: "inspect",
    risk_level: "low",
    requested_by: "studio",
    idempotency_key: "k1",
    status: "running",
    params: {},
    result: null,
    error: null,
    progress: { step: 0, totalSteps: 0, steps: [] },
    browser_session_id: "sess-1",
    live_view_url: "https://www.browserbase.com/sessions/bb-1",
    approved_by: null,
    approved_at: null,
    attempts: 1,
    max_attempts: 3,
    created_at: NOW,
    started_at: NOW,
    completed_at: null,
    updated_at: NOW,
    ...overrides,
  };
}

function sessionRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "sess-1",
    user_id: OWNER,
    project_id: null,
    conversation_id: null,
    browserbase_session_id: "bb-1",
    status: "active",
    controller: "agent",
    task: null,
    live_view_url: "https://www.browserbase.com/sessions/bb-1",
    error: null,
    metadata: {
      liveEmbedUrl: "https://debug.example/sessions/bb-1?fullscreen=1&navbar=false",
    },
    created_at: NOW,
    updated_at: NOW,
    closed_at: null,
    ...overrides,
  };
}

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  dbMock.state.tables.clear();
  __clearLiveViewEmbedCache();
  vi.unstubAllGlobals();
  process.env.BROWSERBASE_API_KEY = "test-key";
  fetchImpl = async () =>
    new Response(JSON.stringify({ debuggerFullscreenUrl: "https://debug.example/x?fullscreen=1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  vi.stubGlobal("fetch", (...args: [string, RequestInit?]) => fetchImpl(args[0], args[1]));
});

describe("getJobLiveView — owner gate + availability", () => {
  it("serves the embed URL to the owner when the session is live", async () => {
    dbMock.table("browser_jobs").set("job-1", jobRow());
    dbMock.table("browser_sessions").set("sess-1", sessionRow());

    const info = await getJobLiveView("job-1", OWNER);
    expect(info).not.toBeNull();
    expect(info!.available).toBe(true);
    expect(info!.reason).toBe("live");
    expect(info!.embedUrl).toBe(
      "https://debug.example/sessions/bb-1?fullscreen=1&navbar=false",
    );
    expect(info!.openUrl).toBe("https://www.browserbase.com/sessions/bb-1");
    expect(info!.sessionStatus).toBe("active");
  });

  it("returns null for a non-owner — the route 404s, the capability URL never leaks", async () => {
    dbMock.table("browser_jobs").set("job-1", jobRow());
    dbMock.table("browser_sessions").set("sess-1", sessionRow());

    expect(await getJobLiveView("job-1", OTHER)).toBeNull();
    expect(await getJobLiveView("nope", OWNER)).toBeNull();
  });

  it("withholds the embed URL when the session is closed", async () => {
    dbMock.table("browser_jobs").set("job-1", jobRow());
    dbMock.table("browser_sessions").set("sess-1", sessionRow({ status: "closed" }));

    const info = await getJobLiveView("job-1", OWNER);
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("session_closed");
    expect(info!.embedUrl).toBeNull();
    // The dashboard page URL stays available for "open in new tab".
    expect(info!.openUrl).toBe("https://www.browserbase.com/sessions/bb-1");
  });

  it("reports job_finished for terminal jobs even with a live-looking row", async () => {
    dbMock.table("browser_jobs").set("job-1", jobRow({ status: "completed" }));
    dbMock.table("browser_sessions").set("sess-1", sessionRow());

    const info = await getJobLiveView("job-1", OWNER);
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("job_finished");
    expect(info!.embedUrl).toBeNull();
  });

  it("reports session_stale when the row is past the idle TTL", async () => {
    dbMock.table("browser_jobs").set("job-1", jobRow());
    dbMock.table("browser_sessions").set(
      "sess-1",
      sessionRow({ updated_at: new Date(Date.now() - 11 * 60_000).toISOString() }),
    );

    const info = await getJobLiveView("job-1", OWNER);
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("session_stale");
    expect(info!.embedUrl).toBeNull();
  });

  it("lazy-fetches the embed URL for legacy sessions without one stored", async () => {
    dbMock.table("browser_jobs").set("job-1", jobRow());
    dbMock.table("browser_sessions").set("sess-1", sessionRow({ metadata: {} }));

    const info = await getJobLiveView("job-1", OWNER);
    expect(info!.available).toBe(true);
    // navbar=false is appended for embedding.
    expect(info!.embedUrl).toBe("https://debug.example/x?fullscreen=1&navbar=false");
  });

  it("falls back to snapshots (embed_unavailable) when the Debug API fails", async () => {
    dbMock.table("browser_jobs").set("job-1", jobRow());
    dbMock.table("browser_sessions").set("sess-1", sessionRow({ metadata: {} }));
    fetchImpl = async () => new Response("nope", { status: 404 });

    const info = await getJobLiveView("job-1", OWNER);
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("embed_unavailable");
    expect(info!.embedUrl).toBeNull();
  });

  it("reports session_not_found when the job has no session", async () => {
    dbMock.table("browser_jobs").set(
      "job-1",
      jobRow({ browser_session_id: null, live_view_url: null }),
    );

    const info = await getJobLiveView("job-1", OWNER);
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("no_live_view_url");
  });
});
