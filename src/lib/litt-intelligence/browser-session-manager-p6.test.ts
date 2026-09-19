// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Agent Browser Phase 6 — owner checks on the session surfaces.
 *
 *  1. getSession: the in-memory fast path must not serve another
 *     user's session (it used to bypass the user_id check that the
 *     DB path enforces). The liveViewUrl is a capability URL — a
 *     non-owner gets null, exactly as if the session didn't exist.
 *  2. takeScreenshot: a caller that doesn't own the session gets null —
 *     never another user's browser pixels.
 *  3. fetchLiveEmbedUrl: returns the Debug API's debuggerFullscreenUrl
 *     with navbar=false; fail-soft null on any failure.
 */

vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: class {
    async init() {}
    async close() {}
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => {
      const chain: { eq: () => unknown; maybeSingle: () => Promise<{ data: null; error: null }> } = {
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return {
        select: () => chain,
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      };
    },
  },
  getSupabaseAdmin: () => null,
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(),
  adjustWalletBalance: vi.fn(),
}));

vi.mock("@/lib/owner", () => ({
  isBillingExempt: () => false,
}));

import {
  getSession,
  takeScreenshot,
  fetchLiveEmbedUrl,
  __registerActiveSessionForTest,
  __resetActiveSessionsForTest,
  type BrowserSession,
} from "./browser-session-manager";

const OWNER = "user_p6_owner";
const STRANGER = "user_p6_stranger";

function session(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const now = new Date().toISOString();
  return {
    id: "sess-owner-1",
    userId: OWNER,
    projectId: null,
    conversationId: null,
    browserbaseSessionId: "bb-1",
    status: "active",
    controller: "agent",
    task: null,
    liveViewUrl: "https://www.browserbase.com/sessions/bb-1",
    error: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

function fakeStagehand() {
  return {
    context: {
      pages: () => [
        {
          screenshot: async () => new Uint8Array([137, 80, 78, 71]),
        },
      ],
    },
  } as never;
}

beforeEach(() => {
  __resetActiveSessionsForTest();
  vi.unstubAllGlobals();
});

describe("getSession — in-memory owner check", () => {
  it("returns the session to its owner", async () => {
    const s = session();
    __registerActiveSessionForTest({ stagehand: fakeStagehand(), session: s, lastActivity: Date.now() });

    const got = await getSession(s.id, OWNER);
    expect(got?.id).toBe(s.id);
    expect(got?.liveViewUrl).toBe(s.liveViewUrl);
  });

  it("returns null to a non-owner — the capability URL never leaks", async () => {
    const s = session();
    __registerActiveSessionForTest({ stagehand: fakeStagehand(), session: s, lastActivity: Date.now() });

    expect(await getSession(s.id, STRANGER)).toBeNull();
  });

  it("returns null for an unknown session", async () => {
    expect(await getSession("nope", OWNER)).toBeNull();
  });
});

describe("takeScreenshot — owner check", () => {
  it("captures for the owner", async () => {
    const s = session();
    __registerActiveSessionForTest({ stagehand: fakeStagehand(), session: s, lastActivity: Date.now() });

    const shot = await takeScreenshot(s.id, OWNER);
    expect(shot).toMatch(/^data:image\/png;base64,/);
  });

  it("returns null for a non-owner — never another user's pixels", async () => {
    const s = session();
    __registerActiveSessionForTest({ stagehand: fakeStagehand(), session: s, lastActivity: Date.now() });

    expect(await takeScreenshot(s.id, STRANGER)).toBeNull();
  });

  it("returns null when the session is not in this process", async () => {
    expect(await takeScreenshot("nope", OWNER)).toBeNull();
  });
});

describe("fetchLiveEmbedUrl", () => {
  it("returns the debugger fullscreen URL with navbar=false", async () => {
    process.env.BROWSERBASE_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ debuggerFullscreenUrl: "https://debug.example/s/bb-1?fullscreen=1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const url = await fetchLiveEmbedUrl("bb-1");
    expect(url).toBe("https://debug.example/s/bb-1?fullscreen=1&navbar=false");
  });

  it("returns null when the API key is missing", async () => {
    delete process.env.BROWSERBASE_API_KEY;
    expect(await fetchLiveEmbedUrl("bb-1")).toBeNull();
  });

  it("returns null on Debug API failure (fail-soft — snapshots instead)", async () => {
    process.env.BROWSERBASE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    expect(await fetchLiveEmbedUrl("bb-1")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await fetchLiveEmbedUrl("bb-1")).toBeNull();
  });

  it("returns null without a provider session id", async () => {
    process.env.BROWSERBASE_API_KEY = "test-key";
    expect(await fetchLiveEmbedUrl(null)).toBeNull();
  });
});
