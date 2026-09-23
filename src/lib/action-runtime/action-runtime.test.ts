import { describe, expect, it } from "vitest";
import { sanitizeActionPayload } from "./events";
import { assertActionRunTransition, canTransitionActionRun, isTerminalActionRunStatus, shouldEmitCancellationRequest } from "./state-machine";
import { projectBrowserSessionStatus } from "./browser-state";
import { mapBrowserFailure } from "./safe-errors";

describe("Action Runtime state machine", () => {
  it("allows the browser lifecycle transitions", () => {
    expect(canTransitionActionRun("queued", "starting")).toBe(true);
    expect(canTransitionActionRun("starting", "working")).toBe(true);
    expect(canTransitionActionRun("working", "waiting_for_user")).toBe(true);
    expect(canTransitionActionRun("waiting_for_user", "user_controlling")).toBe(true);
    expect(canTransitionActionRun("user_controlling", "working")).toBe(true);
    expect(canTransitionActionRun("working", "completed")).toBe(true);
  });

  it("rejects transitions out of terminal states", () => {
    expect(() => assertActionRunTransition("completed", "working")).toThrow(/Cannot transition/);
    expect(isTerminalActionRunStatus("failed")).toBe(true);
    expect(isTerminalActionRunStatus("working")).toBe(false);
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
    expect(projectBrowserSessionStatus("active", "starting", true)).toBe("working");
    expect(projectBrowserSessionStatus("human_control", "working")).toBe("user_controlling");
    expect(projectBrowserSessionStatus("paused", "working")).toBe("paused");
    expect(projectBrowserSessionStatus("error", "working")).toBe("failed");
    expect(projectBrowserSessionStatus("closed", "completed")).toBe("completed");
    expect(projectBrowserSessionStatus("closed", "working")).toBe("failed");
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
});
