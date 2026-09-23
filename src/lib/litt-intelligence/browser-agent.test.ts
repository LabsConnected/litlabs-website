/**
 * Agent Browser Phase 1 — regression tests.
 *
 * Covers: beta gate, honest failures (missing API key, bad URL, navigation
 * failure, screenshot failure), session cleanup (no orphaned Browserbase
 * sessions on ANY path), URL normalization, and screenshot intent detection.
 *
 * The Browserbase/Stagehand layer is mocked — these tests verify LiTT's
 * orchestration and honesty, not the vendor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./browser-session-manager", () => ({
  startSession: vi.fn(),
  closeSession: vi.fn(),
  getSession: vi.fn(),
  // Phase 4: startAgentBrowserSession counts active sessions for the
  // concurrent-session cap.
  dbGetActiveSessions: vi.fn(),
}));

// Phase 4: the BITS preflight is real logic tested in
// browser-billing.test.ts / browser-agent-p4.test.ts — here it is
// stubbed to "allowed" so the Phase 1 paths keep their original focus.
vi.mock("./browser-billing", () => ({
  preflightBrowserStart: vi.fn(),
  getDailyBrowserMinutesUsed: vi.fn(),
  DAILY_BROWSER_MINUTES_QUOTA: 120,
  QUOTA_PAUSED_MESSAGE:
    "Browser paused: you've hit your daily browser-minute limit. It resets tomorrow.",
}));

vi.mock("./browser-tool-handlers", () => ({
  browserToolHandlers: {
    "browser.navigate": vi.fn(),
    "browser.screenshot": vi.fn(),
  },
}));

import {
  isBrowserBetaAllowed,
  normalizeBrowserUrl,
  detectScreenshotIntent,
  extractScreenshotUrl,
  startAgentBrowserSession,
  runOneShotScreenshot,
  BROWSER_BETA_ONLY_MESSAGE,
} from "./browser-agent";
import { startSession, closeSession, dbGetActiveSessions } from "./browser-session-manager";
import { browserToolHandlers } from "./browser-tool-handlers";
import { preflightBrowserStart } from "./browser-billing";

const OWNER_ID = "owner_clerk_123";
const OTHER_ID = "user_random_456";

const mockStartSession = vi.mocked(startSession);
const mockCloseSession = vi.mocked(closeSession);
const mockDbGetActiveSessions = vi.mocked(dbGetActiveSessions);
const mockNavigate = vi.mocked(browserToolHandlers["browser.navigate"]);
const mockScreenshot = vi.mocked(browserToolHandlers["browser.screenshot"]);
const mockPreflightBrowserStart = vi.mocked(preflightBrowserStart);

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

describe("isBrowserBetaAllowed", () => {
  const OLD_ENV = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;

  beforeEach(() => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    else process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OLD_ENV;
  });

  it("allows the owner's account", () => {
    expect(isBrowserBetaAllowed(OWNER_ID)).toBe(true);
  });

  it("blocks any other account", () => {
    expect(isBrowserBetaAllowed(OTHER_ID)).toBe(false);
  });

  it("blocks null/undefined", () => {
    expect(isBrowserBetaAllowed(null)).toBe(false);
    expect(isBrowserBetaAllowed(undefined)).toBe(false);
  });
});

describe("normalizeBrowserUrl", () => {
  it("adds https:// to bare domains", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
  });

  it("keeps explicit http/https", () => {
    expect(normalizeBrowserUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeBrowserUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("chrome://settings")).toBeNull();
  });

  it("rejects empty and garbage input", () => {
    expect(normalizeBrowserUrl("")).toBeNull();
    expect(normalizeBrowserUrl("   ")).toBeNull();
    expect(normalizeBrowserUrl("not a url at all!!!")).toBeNull();
  });
});

describe("detectScreenshotIntent", () => {
  it("fires on 'screenshot example.com'", () => {
    expect(detectScreenshotIntent("screenshot example.com")).toBe(true);
  });

  it("fires on 'take a screenshot of https://example.com'", () => {
    expect(
      detectScreenshotIntent("take a screenshot of https://example.com"),
    ).toBe(true);
  });

  it("fires on 'what does example.com look like'", () => {
    expect(detectScreenshotIntent("what does example.com look like")).toBe(
      true,
    );
  });

  it("does not fire on 'what does the button look like' (no URL)", () => {
    expect(detectScreenshotIntent("what does the button look like")).toBe(
      false,
    );
  });

  it("does not fire on unrelated chat", () => {
    expect(detectScreenshotIntent("what's the weather like?")).toBe(false);
    expect(detectScreenshotIntent("help me build a landing page")).toBe(false);
  });
});

describe("extractScreenshotUrl", () => {
  it("extracts an explicit https URL", () => {
    expect(extractScreenshotUrl("screenshot https://example.com/page")).toBe(
      "https://example.com/page",
    );
  });

  it("extracts a bare domain", () => {
    expect(extractScreenshotUrl("screenshot of example.com")).toBe(
      "example.com",
    );
  });

  it("returns null when no URL is present", () => {
    expect(extractScreenshotUrl("take a screenshot")).toBeNull();
  });
});

describe("startAgentBrowserSession", () => {
  const OLD_ENV = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    // Phase 4: preflight passes by default (the real preflight logic is
    // tested in browser-billing.test.ts / browser-agent-p4.test.ts).
    mockPreflightBrowserStart.mockResolvedValue({ ok: true });
    mockDbGetActiveSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    else process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OLD_ENV;
  });

  it("blocks non-beta accounts without touching the browser", async () => {
    const result = await startAgentBrowserSession({ userId: OTHER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("beta_only");
      expect(result.message).toBe(BROWSER_BETA_ONLY_MESSAGE);
    }
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("reports honestly when BROWSERBASE_API_KEY is missing", async () => {
    mockStartSession.mockRejectedValue(
      new Error("BROWSERBASE_API_KEY is not configured"),
    );
    const result = await startAgentBrowserSession({ userId: OWNER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unavailable");
      // Honest: says unavailable, never a fake session
      expect(result.message).toMatch(/not configured|unavailable/i);
    }
  });

  it("starts a session for the beta account", async () => {
    mockStartSession.mockResolvedValue(fakeSession());
    const result = await startAgentBrowserSession({
      userId: OWNER_ID,
      task: "screenshot example.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.id).toBe("session-1");
    }
    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER_ID }),
    );
  });
});

describe("runOneShotScreenshot", () => {
  const OLD_ENV = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    mockStartSession.mockResolvedValue(fakeSession());
    mockCloseSession.mockResolvedValue(true);
    // Phase 4: preflight passes by default here too.
    mockPreflightBrowserStart.mockResolvedValue({ ok: true });
    mockDbGetActiveSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    else process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OLD_ENV;
  });

  it("success path: navigates, screenshots, closes the session", async () => {
    mockNavigate.mockResolvedValue({
      success: true,
      data: { url: "https://example.com/", title: "Example" },
      durationMs: 10,
    });
    mockScreenshot.mockResolvedValue({
      success: true,
      data: { url: "https://example.com/", title: "Example" },
      screenshotUrl: "data:image/png;base64,AAA",
      durationMs: 10,
    });

    const result = await runOneShotScreenshot(OWNER_ID, "example.com");

    expect(result.ok).toBe(true);
    expect(result.screenshotDataUrl).toBe("data:image/png;base64,AAA");
    expect(result.pageTitle).toBe("Example");
    expect(mockNavigate).toHaveBeenCalledWith(
      { sessionId: "session-1", userId: OWNER_ID },
      { url: "https://example.com/" },
    );
    // No orphaned session
    expect(mockCloseSession).toHaveBeenCalledWith("session-1", OWNER_ID);
  });

  it("blocks non-beta accounts before starting anything", async () => {
    const result = await runOneShotScreenshot(OTHER_ID, "example.com");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("beta_only");
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("rejects invalid URLs without starting a session", async () => {
    const result = await runOneShotScreenshot(OWNER_ID, "not a url!!!");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_url");
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("reports navigation failure honestly and still closes the session", async () => {
    mockNavigate.mockResolvedValue({
      success: false,
      error: "net::ERR_NAME_NOT_RESOLVED",
      durationMs: 10,
    });

    const result = await runOneShotScreenshot(OWNER_ID, "nonexistent-xyz.com");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("navigation_failed");
    expect(result.message).toMatch(/couldn't load/);
    expect(result.screenshotDataUrl).toBeUndefined();
    expect(mockScreenshot).not.toHaveBeenCalled();
    // Session closed even on failure — no orphans
    expect(mockCloseSession).toHaveBeenCalledWith("session-1", OWNER_ID);
  });

  it("reports screenshot failure honestly and still closes the session", async () => {
    mockNavigate.mockResolvedValue({
      success: true,
      data: { url: "https://example.com/" },
      durationMs: 10,
    });
    mockScreenshot.mockResolvedValue({
      success: false,
      error: "Failed to capture screenshot",
      durationMs: 10,
    });

    const result = await runOneShotScreenshot(OWNER_ID, "example.com");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("screenshot_failed");
    expect(result.screenshotDataUrl).toBeUndefined();
    expect(mockCloseSession).toHaveBeenCalledWith("session-1", OWNER_ID);
  });

  it("reports honestly when the browser backend is not configured", async () => {
    mockStartSession.mockRejectedValue(
      new Error("BROWSERBASE_API_KEY is not configured"),
    );
    const result = await runOneShotScreenshot(OWNER_ID, "example.com");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unavailable");
    expect(result.screenshotDataUrl).toBeUndefined();
  });
});
