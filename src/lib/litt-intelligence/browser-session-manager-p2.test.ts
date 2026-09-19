/**
 * Agent Browser Phase 2 — session manager: TTL expiry + live status.
 *
 * Uses the real browser-session-manager (not a mock) with its test seams:
 *   - closeIdleSessions: a session idle past the 10-minute TTL is closed
 *     (Stagehand closed, registry cleared); a fresh session survives.
 *   - getLiveSessionStatus: "live" only for an in-process Stagehand with
 *     fresh activity; paused/human-controlled -> "idle"; stale or
 *     absent -> "disconnected". The status probe must not refresh the
 *     idle heartbeat of the session it checks.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  closeIdleSessions,
  getLiveSessionStatus,
  __registerActiveSessionForTest,
  __resetActiveSessionsForTest,
  __activeSessionCountForTest,
  type BrowserSession,
} from "./browser-session-manager";

const TEN_MIN_MS = 10 * 60 * 1000;

function fakeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const now = new Date().toISOString();
  return {
    id: `session-${Math.random().toString(36).slice(2)}`,
    userId: "owner_clerk_123",
    projectId: null,
    conversationId: "conv-abc",
    browserbaseSessionId: "bb-1",
    status: "active",
    controller: "agent",
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

function fakeStagehand() {
  return { close: vi.fn().mockResolvedValue(undefined) } as never;
}

beforeEach(() => {
  __resetActiveSessionsForTest();
});

describe("closeIdleSessions (TTL expiry)", () => {
  it("closes a session idle past the 10-minute TTL", async () => {
    const session = fakeSession();
    const stagehand = fakeStagehand();
    __registerActiveSessionForTest({
      stagehand,
      session,
      lastActivity: Date.now() - TEN_MIN_MS - 60_000,
    });

    const closed = await closeIdleSessions();

    expect(closed).toBe(1);
    expect((stagehand as unknown as { close: () => Promise<void> }).close).toHaveBeenCalled();
    expect(__activeSessionCountForTest()).toBe(0);
  });

  it("keeps a session with fresh activity alive", async () => {
    const session = fakeSession();
    const stagehand = fakeStagehand();
    __registerActiveSessionForTest({
      stagehand,
      session,
      lastActivity: Date.now(),
    });

    const closed = await closeIdleSessions();

    expect(closed).toBe(0);
    expect((stagehand as unknown as { close: () => Promise<void> }).close).not.toHaveBeenCalled();
    expect(__activeSessionCountForTest()).toBe(1);
  });

  it("closes only the expired session, keeps the fresh one", async () => {
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session: fakeSession({ id: "stale" }),
      lastActivity: Date.now() - TEN_MIN_MS - 1,
    });
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session: fakeSession({ id: "fresh" }),
      lastActivity: Date.now(),
    });

    const closed = await closeIdleSessions();

    expect(closed).toBe(1);
    expect(__activeSessionCountForTest()).toBe(1);
  });
});

describe("getLiveSessionStatus", () => {
  it("reports live for an in-process session with fresh activity", async () => {
    const session = fakeSession({ status: "active", controller: "agent" });
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });

    const status = await getLiveSessionStatus(session.userId, session.conversationId ?? undefined);

    expect(status.state).toBe("live");
    expect(status.sessionId).toBe(session.id);
    expect(status.controller).toBe("agent");
  });

  it("reports idle for a paused session (exists, not drivable by agent)", async () => {
    const session = fakeSession({ status: "paused" });
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });

    const status = await getLiveSessionStatus(session.userId, session.conversationId ?? undefined);

    expect(status.state).toBe("idle");
    expect(status.sessionId).toBe(session.id);
    expect(status.sessionStatus).toBe("paused");
  });

  it("reports idle for a human-controlled session", async () => {
    const session = fakeSession({ status: "human_control", controller: "human" });
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });

    const status = await getLiveSessionStatus(session.userId, session.conversationId ?? undefined);

    expect(status.state).toBe("idle");
    expect(status.controller).toBe("human");
  });

  it("reports disconnected when a session is past the TTL (not assumed live)", async () => {
    const session = fakeSession();
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now() - TEN_MIN_MS - 60_000,
    });

    const status = await getLiveSessionStatus(session.userId, session.conversationId ?? undefined);

    expect(status.state).toBe("disconnected");
    expect(status.sessionId).toBeNull();
  });

  it("reports disconnected when there are no sessions", async () => {
    const status = await getLiveSessionStatus("nobody", "conv-none");
    expect(status.state).toBe("disconnected");
    expect(status.sessionId).toBeNull();
  });

  it("scopes to the requested conversation", async () => {
    const session = fakeSession({ conversationId: "conv-other" });
    __registerActiveSessionForTest({
      stagehand: fakeStagehand(),
      session,
      lastActivity: Date.now(),
    });

    const status = await getLiveSessionStatus(session.userId, "conv-abc");
    expect(status.state).toBe("disconnected");
  });

  it("does not refresh the idle heartbeat on a status probe", async () => {
    // A status poll must never resurrect an idle session: after the probe,
    // closeIdleSessions must still see the original lastActivity.
    const session = fakeSession();
    const stagehand = fakeStagehand();
    __registerActiveSessionForTest({
      stagehand,
      session,
      lastActivity: Date.now() - TEN_MIN_MS - 1,
    });

    await getLiveSessionStatus(session.userId, session.conversationId ?? undefined);
    const closed = await closeIdleSessions();

    expect(closed).toBe(1);
  });
});
