/**
 * /api/capabilities/project-terminal route tests (Step 6, F4).
 *
 * The terminal /health payload publishes TWO execution dimensions:
 * the host verdict (terminal.execution — "disabled" in production,
 * permanently) and the sandbox dimension (terminal.sandbox). The route
 * must declare the terminal unavailable only when BOTH are off; when
 * sandbox execution is enabled-and-fresh it falls through to the
 * alive-but-no-session response, because the sandbox-wired surfaces
 * (agent exec, prepare, preview) work even though interactive PTY
 * sessions stay gated on the host.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const authState = vi.hoisted(() => ({ userId: "user-123" as string | null }));
const healthState = vi.hoisted(() => ({
  payload: null as Record<string, unknown> | null,
  ok: true,
  status: 200,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: authState.userId })),
}));

import { GET } from "./route";

const HOST_REASON =
  "Terminal execution is disabled: this is not a trusted local environment " +
  "and no verified sandbox isolation exists. Failing closed unconditionally; " +
  "no override is available.";

function healthPayload(sandbox?: Record<string, unknown> | null) {
  return {
    status: "ok",
    readiness: "ready",
    terminal: {
      execution: "disabled",
      isolation: "unsafe",
      mode: "none",
      reason: HOST_REASON,
      ...(sandbox === undefined ? {} : { sandbox }),
    },
  };
}

function sandboxSection(overrides: Record<string, unknown> = {}) {
  return {
    execution: "enabled",
    provider: "e2b",
    state: "verified",
    checkedAt: new Date(Date.now() - 60_000).toISOString(),
    freshUntil: new Date(Date.now() + 4 * 60_000).toISOString(),
    reason: "Sandbox execution is verified.",
    ...overrides,
  };
}

async function callRoute() {
  const response = await GET(
    new NextRequest("http://localhost:3000/api/capabilities/project-terminal"),
  );
  return response.json();
}

describe("/api/capabilities/project-terminal — sandbox fall-through (F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.userId = "user-123";
    healthState.ok = true;
    healthState.status = 200;
    healthState.payload = healthPayload(sandboxSection());
    process.env.TERMINAL_PUBLIC_URL = "https://terminal.example.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: healthState.ok,
        status: healthState.status,
        json: async () => healthState.payload,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TERMINAL_PUBLIC_URL;
  });

  it("falls through when host execution is disabled but sandbox execution is enabled-and-fresh", async () => {
    const data = await callRoute();
    // NOT the disabled branch: no host reason leaks as the error, and the
    // response is the alive-but-no-session shape.
    expect(data.serverReachable).toBe(true);
    expect(data.terminalStatus).toBe("disconnected");
    expect(data.error).toBeNull();
  });

  it("stays unavailable when host execution is disabled and there is no sandbox section", async () => {
    healthState.payload = healthPayload(null);
    const data = await callRoute();
    expect(data.status).toBe("unavailable");
    expect(data.terminalStatus).toBe("unavailable");
    expect(data.serverReachable).toBe(true);
    expect(data.error).toBe(HOST_REASON.slice(0, 300));
  });

  it("stays unavailable when the sandbox canary failed", async () => {
    healthState.payload = healthPayload(
      sandboxSection({ execution: "disabled", state: "failed" }),
    );
    const data = await callRoute();
    expect(data.terminalStatus).toBe("unavailable");
    expect(data.error).toBe(HOST_REASON.slice(0, 300));
  });

  it("stays unavailable when the sandbox signal is stale (freshUntil in the past)", async () => {
    healthState.payload = healthPayload(
      sandboxSection({
        state: "stale",
        freshUntil: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const data = await callRoute();
    expect(data.terminalStatus).toBe("unavailable");
    expect(data.error).toBe(HOST_REASON.slice(0, 300));
  });

  it("stays unavailable when sandbox claims verified but freshUntil has already lapsed", async () => {
    healthState.payload = healthPayload(
      sandboxSection({ freshUntil: new Date(Date.now() - 1_000).toISOString() }),
    );
    const data = await callRoute();
    expect(data.terminalStatus).toBe("unavailable");
  });

  it("still requires authentication before reporting any capability", async () => {
    authState.userId = null;
    const data = await callRoute();
    expect(data.status).toBe("unavailable");
    expect(data.error).toBe("Not authenticated.");
  });
});
