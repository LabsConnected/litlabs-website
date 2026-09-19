/**
 * Agent Browser Phase 4 — preflight wiring in the chat-facing
 * orchestration layer.
 *
 * Verifies that startAgentBrowserSession runs the BITS preflight
 * (fail closed) before any provider session exists, and that a
 * refusal surfaces as an honest no-session result — startSession is
 * never called when the budget check fails.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./browser-session-manager", () => ({
  startSession: vi.fn(),
  closeSession: vi.fn(),
  closeIdleSessions: vi.fn(),
  getStagehand: vi.fn(),
  pauseSession: vi.fn(),
  dbGetActiveSessions: vi.fn(),
  executeBrowserAction: vi.fn(),
  logBlockedBrowserNavigation: vi.fn(),
}));

vi.mock("./browser-billing", () => ({
  preflightBrowserStart: vi.fn(),
  getDailyBrowserMinutesUsed: vi.fn(),
  DAILY_BROWSER_MINUTES_QUOTA: 120,
  QUOTA_PAUSED_MESSAGE:
    "Browser paused: you've hit your daily browser-minute limit. It resets tomorrow.",
}));

import { startAgentBrowserSession } from "./browser-agent";
import { startSession, dbGetActiveSessions } from "./browser-session-manager";
import { preflightBrowserStart } from "./browser-billing";

const mockStartSession = vi.mocked(startSession);
const mockDbGetActiveSessions = vi.mocked(dbGetActiveSessions);
const mockPreflight = vi.mocked(preflightBrowserStart);

const OWNER_ID = "owner_clerk_123";

const OLD_ENV = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;

function fakeSession() {
  const now = new Date().toISOString();
  return {
    id: "session-1",
    userId: OWNER_ID,
    projectId: null,
    conversationId: null,
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
  mockDbGetActiveSessions.mockResolvedValue([]);
  mockPreflight.mockResolvedValue({ ok: true });
  mockStartSession.mockResolvedValue(fakeSession());
});

afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
  else process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OLD_ENV;
});

describe("startAgentBrowserSession — Phase 4 preflight", () => {
  it("runs the BITS preflight before starting the provider session", async () => {
    const result = await startAgentBrowserSession({ userId: OWNER_ID });

    expect(result.ok).toBe(true);
    expect(mockPreflight).toHaveBeenCalledWith(OWNER_ID, 0);
    expect(mockStartSession).toHaveBeenCalledTimes(1);
  });

  it("refuses with an honest message and no session when BITS are missing", async () => {
    mockPreflight.mockResolvedValue({
      ok: false,
      error: "insufficient_bits",
      message: "You need at least 45 LiTTBits to start a browser session.",
    });

    const result = await startAgentBrowserSession({ userId: OWNER_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("insufficient_bits");
      expect(result.message).toContain("45 LiTTBits");
    }
    // Fail closed: no provider session was ever started.
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("refuses a 3rd concurrent session before starting", async () => {
    mockDbGetActiveSessions.mockResolvedValue([fakeSession(), fakeSession()]);
    mockPreflight.mockResolvedValue({
      ok: false,
      error: "session_cap",
      message: "You already have 2 browser sessions running.",
    });

    const result = await startAgentBrowserSession({ userId: OWNER_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("session_cap");
    expect(mockStartSession).not.toHaveBeenCalled();
    // The preflight saw the 2 active sessions.
    expect(mockPreflight).toHaveBeenCalledWith(OWNER_ID, 2);
  });

  it("announces the per-minute price when a session starts", async () => {
    const result = await startAgentBrowserSession({ userId: OWNER_ID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("45 LiTTBits");
  });
});
