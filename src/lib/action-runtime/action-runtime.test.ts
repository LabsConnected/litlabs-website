import { describe, expect, it } from "vitest";
import { sanitizeActionPayload } from "./events";
import { assertActionRunTransition, canTransitionActionRun, isTerminalActionRunStatus, shouldEmitCancellationRequest } from "./state-machine";
import { projectBrowserSessionStatus } from "./browser-state";
import { mapBrowserFailure } from "./safe-errors";
import type { ActionRunStatus } from "./types";

describe("Action Runtime state machine", () => {
  it("allows the browser lifecycle transitions", () => {
    expect(canTransitionActionRun("queued", "starting")).toBe(true);
    expect(canTransitionActionRun("starting", "working")).toBe(true);
    expect(canTransitionActionRun("working", "waiting_for_user")).toBe(true);
    expect(canTransitionActionRun("waiting_for_user", "user_controlling")).toBe(true);
    expect(canTransitionActionRun("user_controlling", "working")).toBe(true);
    expect(canTransitionActionRun("working", "completed")).toBe(true);
  });

  it("allows queued -> working and rejects queued -> paused", () => {
    expect(canTransitionActionRun("queued", "working")).toBe(true);
    // A never-executed run is not paused work.
    expect(canTransitionActionRun("queued", "paused")).toBe(false);
    expect(canTransitionActionRun("queued", "cancelled")).toBe(true);
    expect(canTransitionActionRun("queued", "failed")).toBe(true);
  });

  it("rejects transitions out of terminal states", () => {
    expect(() => assertActionRunTransition("completed", "working")).toThrow(/Cannot transition/);
    expect(canTransitionActionRun("failed", "working")).toBe(false);
    expect(canTransitionActionRun("cancelled", "working")).toBe(false);
    expect(canTransitionActionRun("completed", "failed")).toBe(false);
    expect(canTransitionActionRun("failed", "completed")).toBe(false);
    expect(isTerminalActionRunStatus("failed")).toBe(true);
    expect(isTerminalActionRunStatus("working")).toBe(false);
  });

  it("permits idempotent same-state evaluation; persistence enforces the no-op", () => {
    // The pure machine allows evaluating completed -> completed, but the
    // SQL layer only honors it for empty/no-op patches — meaningful
    // mutation against terminal history raises ACTION_RUN_TERMINAL_IMMUTABLE.
    expect(canTransitionActionRun("completed", "completed")).toBe(true);
    expect(canTransitionActionRun("failed", "failed")).toBe(true);
    expect(canTransitionActionRun("cancelled", "cancelled")).toBe(true);
  });

  it("supports the full waiting/takeover path end to end", () => {
    const path: ActionRunStatus[] = [
      "queued", "starting", "working", "waiting_for_user",
      "user_controlling", "working", "completed",
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransitionActionRun(path[i - 1], path[i])).toBe(true);
    }
  });

  it("supports pause/resume on executed work", () => {
    expect(canTransitionActionRun("working", "paused")).toBe(true);
    expect(canTransitionActionRun("paused", "working")).toBe(true);
  });
});

describe("cancellation idempotency", () => {
  it("emits only for the first request on a non-terminal run", () => {
    expect(shouldEmitCancellationRequest("working", null)).toBe(true);
    expect(shouldEmitCancellationRequest("working", "2026-09-23T00:00:00.000Z")).toBe(false);
    expect(shouldEmitCancellationRequest("completed", null)).toBe(false);
    expect(shouldEmitCancellationRequest("cancelled", null)).toBe(false);
  });
});

describe("browser provider projection", () => {
  it("keeps provider state separate from product state", () => {
    expect(projectBrowserSessionStatus("active", "starting")).toBe("starting");
    expect(projectBrowserSessionStatus("active", "starting", { isExecutionActive: true })).toBe("working");
    expect(projectBrowserSessionStatus("active", "working", { isExecutionActive: false })).toBe("working");
    expect(projectBrowserSessionStatus("active", "waiting_for_user")).toBe("waiting_for_user");
    expect(projectBrowserSessionStatus("active", "user_controlling")).toBe("user_controlling");
    expect(projectBrowserSessionStatus("active", "paused")).toBe("paused");
    expect(projectBrowserSessionStatus("human_control", "working")).toBe("user_controlling");
    expect(projectBrowserSessionStatus("paused", "working")).toBe("paused");
    expect(projectBrowserSessionStatus("error", "working")).toBe("failed");
    expect(projectBrowserSessionStatus("closed", "working")).toBe("failed");
  });

  it("never lets provider state overwrite terminal ActionRun truth", () => {
    expect(projectBrowserSessionStatus("active", "cancelled")).toBe("cancelled");
    expect(projectBrowserSessionStatus("closed", "completed")).toBe("completed");
    expect(projectBrowserSessionStatus("closed", "cancelled")).toBe("cancelled");
    expect(projectBrowserSessionStatus("closed", "failed")).toBe("failed");
    // Error precedence: a terminal run stays terminal — provider noise
    // after completion must not retroactively fail finished work.
    expect(projectBrowserSessionStatus("error", "completed")).toBe("completed");
    expect(projectBrowserSessionStatus("error", "cancelled")).toBe("cancelled");
    expect(projectBrowserSessionStatus("human_control", "cancelled")).toBe("cancelled");
  });
});

describe("safe browser failures", () => {
  it("does not expose provider exception text", () => {
    const failure = mapBrowserFailure(new Error("Browserbase socket secret=abc123 stack trace"));
    expect(failure.code).toBe("BROWSER_ACTION_FAILED");
    expect(failure.message).not.toContain("abc123");
    expect(failure.message).not.toContain("Browserbase socket");
  });
});

describe("event payload safety", () => {
  it("redacts secret-shaped fields recursively", () => {
    expect(sanitizeActionPayload({
      url: "https://example.com",
      password: "never-store",
      passwd: "never-store",
      secret: "never-store",
      apiKey: "also-never-store",
      api_key: "also-never-store",
      token: "never-store",
      accessToken: "never-store",
      refreshToken: "never-store",
      authorization: "Bearer private",
      cookie: "private",
      "set-cookie": "private",
      CLERK_SECRET_KEY: "private",
      nested: { apiKey: "also-never-store" },
      values: [{ cookie: "private" }],
    })).toEqual({
      url: "https://example.com",
      password: "[REDACTED]",
      passwd: "[REDACTED]",
      secret: "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      token: "[REDACTED]",
      accessToken: "[REDACTED]",
      refreshToken: "[REDACTED]",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "set-cookie": "[REDACTED]",
      CLERK_SECRET_KEY: "[REDACTED]",
      nested: { apiKey: "[REDACTED]" },
      values: [{ cookie: "[REDACTED]" }],
    });
  });

  it("redacts credential keys case-insensitively at any depth", () => {
    const sanitized = sanitizeActionPayload({
      Authorization: "x",
      AUTHORIZATION: "x",
      ApiKey: "x",
      AccessToken: "x",
      COOKIE: "x",
      privateKey: "x",
      nested: { SessionToken: "x" },
    });
    for (const value of Object.values(sanitized)) {
      if (typeof value === "string") expect(value).toBe("[REDACTED]");
    }
    expect((sanitized.nested as Record<string, unknown>).SessionToken).toBe("[REDACTED]");
  });

  it("does not over-redact harmless names containing secret substrings", () => {
    expect(sanitizeActionPayload({
      tokenCount: 42,
      cookiePolicy: "strict",
      secretLabel: "public label",
      sessionId: "session-one",
      tokensUsed: 7,
    })).toEqual({
      tokenCount: 42,
      cookiePolicy: "strict",
      secretLabel: "public label",
      sessionId: "session-one",
      tokensUsed: 7,
    });
  });
});
