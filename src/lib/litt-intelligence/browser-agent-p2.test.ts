/**
 * Agent Browser Phase 2 — multi-turn session reuse + navigate URL
 * policy enforcement tests.
 *
 * Covers:
 *   - getActiveSession: finds a genuinely live session for the
 *     userId+conversationId pair; ignores sessions for other
 *     conversations and sessions with no live Stagehand in this process.
 *   - getOrReuseAgentBrowserSession: reuses the live session (no new
 *     Browserbase session), starts fresh when none is live, keeps the
 *     beta gate, sweeps idle sessions before deciding.
 *   - browserNavigate: URL policy blocks (loopback) never reach the
 *     browser and are audit-logged; allowed URLs are normalized and
 *     executed.
 *
 * The Browserbase/Stagehand layer is mocked — these tests verify LiTT's
 * orchestration, not the vendor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./browser-session-manager", () => ({
  startSession: vi.fn(),
  closeSession: vi.fn(),
  closeIdleSessions: vi.fn(),
  getStagehand: vi.fn(),
  dbGetActiveSessions: vi.fn(),
  executeBrowserAction: vi.fn(),
  logBlockedBrowserNavigation: vi.fn(),
}));

import {
  getActiveSession,
  getOrReuseAgentBrowserSession,
  BROWSER_BETA_ONLY_MESSAGE,
} from "./browser-agent";
import { browserNavigate } from "./browser-tool-handlers";
import {
  startSession,
  closeIdleSessions,
  getStagehand,
  dbGetActiveSessions,
  executeBrowserAction,
  logBlockedBrowserNavigation,
} from "./browser-session-manager";

const OWNER_ID = "owner_clerk_123";
const OTHER_ID = "user_random_456";
const CONV = "conv-abc";

const mockStartSession = vi.mocked(startSession);
const mockCloseIdleSessions = vi.mocked(closeIdleSessions);
const mockGetStagehand = vi.mocked(getStagehand);
const mockDbGetActiveSessions = vi.mocked(dbGetActiveSessions);
const mockExecuteBrowserAction = vi.mocked(executeBrowserAction);
const mockLogBlocked = vi.mocked(logBlockedBrowserNavigation);

function fakeSession(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "session-1",
    userId: OWNER_ID,
    projectId: null,
    conversationId: CONV,
    browserbaseSessionId: "bb-1",
    status: "active" as const,
    controller: "agent" as const,
    task: null,
    liveViewUrl: null,
    error: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

const OLD_ENV = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
  mockCloseIdleSessions.mockResolvedValue(0);
  mockDbGetActiveSessions.mockResolvedValue([]);
  mockGetStagehand.mockReturnValue(null);
});

afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
  else process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OLD_ENV;
});

describe("getActiveSession", () => {
  it("returns the live session for the userId+conversationId pair", async () => {
    mockDbGetActiveSessions.mockResolvedValue([fakeSession()]);
    mockGetStagehand.mockReturnValue({} as never);

    const found = await getActiveSession(OWNER_ID, CONV);
    expect(found?.id).toBe("session-1");
    expect(mockGetStagehand).toHaveBeenCalledWith("session-1");
  });

  it("ignores sessions from other conversations", async () => {
    mockDbGetActiveSessions.mockResolvedValue([fakeSession({ conversationId: "conv-other" })]);
    mockGetStagehand.mockReturnValue({} as never);

    expect(await getActiveSession(OWNER_ID, CONV)).toBeNull();
  });

  it("returns null when the DB row has no live Stagehand in this process", async () => {
    // A recorded-active session that is not drivable here is NOT reusable
    // (re-attach is Phase 5) — better a fresh session than a dead one.
    mockDbGetActiveSessions.mockResolvedValue([fakeSession()]);
    mockGetStagehand.mockReturnValue(null);

    expect(await getActiveSession(OWNER_ID, CONV)).toBeNull();
  });

  it("returns null when no active sessions exist", async () => {
    expect(await getActiveSession(OWNER_ID, CONV)).toBeNull();
  });
});

describe("getOrReuseAgentBrowserSession", () => {
  it("reuses the live session instead of starting a new one", async () => {
    mockDbGetActiveSessions.mockResolvedValue([fakeSession()]);
    mockGetStagehand.mockReturnValue({} as never);

    const result = await getOrReuseAgentBrowserSession({
      userId: OWNER_ID,
      task: "click the pricing link",
      conversationId: CONV,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reused).toBe(true);
      expect(result.session.id).toBe("session-1");
      expect(result.message).toMatch(/reusing/i);
    }
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("starts a fresh session when none is live (second request reuses it)", async () => {
    const fresh = fakeSession({ id: "session-2" });
    mockStartSession.mockResolvedValue(fresh);

    const first = await getOrReuseAgentBrowserSession({
      userId: OWNER_ID,
      conversationId: CONV,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.reused).toBe(false);
      expect(first.session.id).toBe("session-2");
    }
    expect(mockStartSession).toHaveBeenCalledTimes(1);

    // The session is now live in this process: the next turn reuses it.
    mockDbGetActiveSessions.mockResolvedValue([fresh]);
    mockGetStagehand.mockReturnValue({} as never);

    const second = await getOrReuseAgentBrowserSession({
      userId: OWNER_ID,
      conversationId: CONV,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.reused).toBe(true);
      expect(second.session.id).toBe("session-2");
    }
    // Still exactly one start — no Browserbase session per turn.
    expect(mockStartSession).toHaveBeenCalledTimes(1);
  });

  it("sweeps idle sessions before deciding (TTL wired to the agent)", async () => {
    await getOrReuseAgentBrowserSession({ userId: OWNER_ID, conversationId: CONV });
    expect(mockCloseIdleSessions).toHaveBeenCalled();
  });

  it("keeps the beta gate on the reuse path", async () => {
    mockDbGetActiveSessions.mockResolvedValue([fakeSession({ userId: OTHER_ID })]);
    mockGetStagehand.mockReturnValue({} as never);

    const result = await getOrReuseAgentBrowserSession({
      userId: OTHER_ID,
      conversationId: CONV,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("beta_only");
      expect(result.message).toBe(BROWSER_BETA_ONLY_MESSAGE);
    }
    expect(mockStartSession).not.toHaveBeenCalled();
  });
});

describe("browserNavigate URL policy enforcement", () => {
  const ctx = { sessionId: "session-1", userId: OWNER_ID };

  it("blocks loopback navigation before the browser is touched", async () => {
    const result = await browserNavigate(ctx, { url: "http://127.0.0.1:3000/admin" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockExecuteBrowserAction).not.toHaveBeenCalled();
    // The attempt is audit-logged.
    expect(mockLogBlocked).toHaveBeenCalledWith(
      "session-1",
      OWNER_ID,
      "http://127.0.0.1:3000/admin",
      expect.stringMatching(/loopback/i),
    );
  });

  it("blocks metadata endpoints and phishing hosts", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "https://paypa1-secure-login.com/",
      "file:///etc/passwd",
    ]) {
      const result = await browserNavigate(ctx, { url });
      expect(result.success, url).toBe(false);
      expect(result.error).toMatch(/blocked/i);
    }
    expect(mockExecuteBrowserAction).not.toHaveBeenCalled();
    expect(mockLogBlocked).toHaveBeenCalledTimes(3);
  });

  it("executes allowed URLs with the normalized address", async () => {
    mockExecuteBrowserAction.mockImplementation(
      async (_sid, _uid, _action, inputs, _fn) => ({
        success: true,
        data: { url: inputs.url },
        durationMs: 5,
      }),
    );

    const result = await browserNavigate(ctx, { url: "example.com/pricing" });

    expect(result.success).toBe(true);
    expect(mockExecuteBrowserAction).toHaveBeenCalledWith(
      "session-1",
      OWNER_ID,
      "browser.navigate",
      expect.objectContaining({ url: "https://example.com/pricing" }),
      expect.any(Function),
    );
    expect(mockLogBlocked).not.toHaveBeenCalled();
  });
});
