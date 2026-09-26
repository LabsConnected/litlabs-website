// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Chat browser as first-class capability — session-scoped live-view
 * resolution.
 *
 * `getSessionLiveView(sessionId, userId)` backs
 * GET /api/litt/browser/session/live-view (session mode).
 * `getConversationLiveView(conversationId, userId)` backs the same
 * route in conversation mode — the newest active-like session bound to
 * the conversation.
 *
 * Covered:
 *   1. Owner + active session + stored embed URL → available, embed URL served.
 *   2. Non-owner → null (the route 404s; the capability URL never leaks).
 *   3. Closed session → unavailable/session_closed, embedUrl withheld.
 *   4. Stale row (past idle TTL) → unavailable/session_stale.
 *   5. No stored embed URL + Debug API failure → unavailable/embed_unavailable.
 *   6. Conversation mode picks the newest session for the conversation.
 *   7. Conversation mode with no session → null (panel renders nothing).
 *   8. Sessions from other conversations are ignored.
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
    // The real PostgREST builder is thenable: awaiting it resolves the
    // row list. Mirror that so dbGetActiveSessions (which awaits the
    // builder directly) works against the fake.
    then(
      resolve: (value: { data: Row[]; error: null }) => void,
      reject?: (reason: unknown) => void,
    ) {
      try {
        resolve({ data: this.matched(), error: null });
      } catch (e) {
        if (reject) reject(e);
      }
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
  getSessionLiveView,
  getConversationLiveView,
  __clearSessionLiveViewEmbedCache,
} from "./browser-session-live-view";

const OWNER = "user_chat_owner";
const OTHER = "user_chat_stranger";
const NOW = new Date().toISOString();

function sessionRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "sess-chat-1",
    user_id: OWNER,
    project_id: null,
    conversation_id: "conv-1",
    browserbase_session_id: "bb-chat-1",
    status: "active",
    controller: "agent",
    task: "browse for Larry",
    live_view_url: "https://www.browserbase.com/sessions/bb-chat-1",
    error: null,
    metadata: {
      liveEmbedUrl: "https://debug.example/sessions/bb-chat-1?fullscreen=1&navbar=false",
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
  __clearSessionLiveViewEmbedCache();
  vi.unstubAllGlobals();
  process.env.BROWSERBASE_API_KEY = "test-key";
  fetchImpl = async () =>
    new Response(JSON.stringify({ debuggerFullscreenUrl: "https://debug.example/x?fullscreen=1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  vi.stubGlobal("fetch", (...args: [string, RequestInit?]) => fetchImpl(args[0], args[1]));
});

describe("getSessionLiveView — owner gate + availability", () => {
  it("serves the embed URL to the owner when the session is live", async () => {
    dbMock.table("browser_sessions").set("sess-chat-1", sessionRow());

    const info = await getSessionLiveView("sess-chat-1", OWNER);
    expect(info).not.toBeNull();
    expect(info!.available).toBe(true);
    expect(info!.reason).toBe("live");
    expect(info!.embedUrl).toBe(
      "https://debug.example/sessions/bb-chat-1?fullscreen=1&navbar=false",
    );
    expect(info!.openUrl).toBe("https://www.browserbase.com/sessions/bb-chat-1");
    expect(info!.sessionId).toBe("sess-chat-1");
    expect(info!.sessionStatus).toBe("active");
  });

  it("returns null for a non-owner — the route 404s, the capability URL never leaks", async () => {
    dbMock.table("browser_sessions").set("sess-chat-1", sessionRow());

    expect(await getSessionLiveView("sess-chat-1", OTHER)).toBeNull();
    expect(await getSessionLiveView("nope", OWNER)).toBeNull();
  });

  it("withholds the embed URL when the session is closed", async () => {
    dbMock.table("browser_sessions").set("sess-chat-1", sessionRow({ status: "closed" }));

    const info = await getSessionLiveView("sess-chat-1", OWNER);
    expect(info).not.toBeNull();
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("session_closed");
    expect(info!.embedUrl).toBeNull();
    // The dashboard page URL stays available for "open in new tab".
    expect(info!.openUrl).toBe("https://www.browserbase.com/sessions/bb-chat-1");
  });

  it("reports session_stale when the row is past the idle TTL", async () => {
    dbMock.table("browser_sessions").set(
      "sess-chat-1",
      sessionRow({ updated_at: new Date(Date.now() - 11 * 60_000).toISOString() }),
    );

    const info = await getSessionLiveView("sess-chat-1", OWNER);
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("session_stale");
    expect(info!.embedUrl).toBeNull();
  });

  it("falls back to embed_unavailable when the Debug API fails", async () => {
    dbMock.table("browser_sessions").set("sess-chat-1", sessionRow({ metadata: {} }));
    fetchImpl = async () => new Response("nope", { status: 500 });

    const info = await getSessionLiveView("sess-chat-1", OWNER);
    expect(info!.available).toBe(false);
    expect(info!.reason).toBe("embed_unavailable");
    expect(info!.embedUrl).toBeNull();
  });
});

describe("getConversationLiveView — conversation mode", () => {
  it("picks the newest active-like session for the conversation", async () => {
    dbMock.table("browser_sessions").set(
      "sess-old",
      sessionRow({
        id: "sess-old",
        created_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    dbMock.table("browser_sessions").set("sess-new", sessionRow({ id: "sess-new" }));

    const info = await getConversationLiveView("conv-1", OWNER);
    expect(info).not.toBeNull();
    expect(info!.sessionId).toBe("sess-new");
    expect(info!.available).toBe(true);
  });

  it("ignores sessions from other conversations", async () => {
    dbMock.table("browser_sessions").set(
      "sess-other",
      sessionRow({ id: "sess-other", conversation_id: "conv-2" }),
    );

    expect(await getConversationLiveView("conv-1", OWNER)).toBeNull();
  });

  it("returns null when the conversation has no session — the panel renders nothing", async () => {
    expect(await getConversationLiveView("conv-empty", OWNER)).toBeNull();
  });

  it("returns null for a non-owner", async () => {
    dbMock.table("browser_sessions").set("sess-chat-1", sessionRow());
    expect(await getConversationLiveView("conv-1", OTHER)).toBeNull();
  });
});
