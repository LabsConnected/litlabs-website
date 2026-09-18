// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression test for the ACT-mode approval-resume P0 (2026-09-17):
 * approving image.generate deterministically failed with "The approved
 * workspace operation failed, so the project was not completed."
 *
 * Root cause: handleImageGenerate self-fetched /api/media/generate with no
 * authentication. The agent loop has no Clerk session, so the route 401'd
 * ("Sign in to generate media"). #371 fixed the capability gate but the
 * approval gate pauses before execution, so the handler — the actual broken
 * link — was first exercised on the resume path and killed the approved run.
 * The model then re-requested the same approval (infinite loop).
 *
 * The fix: the handler authenticates the self-fetch with the internal
 * service key and the approving user's ID (from the workspace transport);
 * the route trusts that pair as the caller.
 */

const ORIGINAL_ENV = { ...process.env };

vi.mock("server-only", () => ({}));

import { handleImageGenerate } from "./tool-handlers";
import { toolRegistry } from "./tool-registry";
import { resolveAgentServiceUser } from "@/app/api/media/generate/route";

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/media/generate", {
    method: "POST",
    headers,
  });
}

describe("image.generate agent auth", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the internal service key + agent user id when the transport carries a user", async () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-internal-key-123";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, downloadUrl: "https://cdn/x.png" }),
    } as Response);

    const transport = { userId: "user_abc", workspaceId: "ws_1" };
    const result = (await handleImageGenerate({ prompt: "a sunny dog park" }, transport)) as {
      success: boolean;
    };

    expect(result.success).toBe(true);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Internal-Service-Key"]).toBe("test-internal-key-123");
    expect(headers["X-Agent-User-Id"]).toBe("user_abc");
  });

  it("omits agent headers when no service key is configured (back-compat)", async () => {
    delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, downloadUrl: "https://cdn/x.png" }),
    } as Response);

    await handleImageGenerate({ prompt: "a sunny dog park" }, { userId: "user_abc" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Internal-Service-Key"]).toBeUndefined();
    expect(headers["X-Agent-User-Id"]).toBeUndefined();
  });

  it("surfaces the route's auth rejection as a handler failure (no silent lie)", async () => {
    delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: "Sign in to generate media" }),
    } as Response);

    const result = (await handleImageGenerate({ prompt: "a sunny dog park" })) as {
      success: boolean;
      error: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain("Sign in to generate media");
  });

  it("no longer requires projectId in inputs (the handler never used it)", () => {
    expect(toolRegistry.validateInputs("image.generate", { prompt: "a sunny dog park" })).toBeNull();
  });
});

describe("resolveAgentServiceUser", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("trusts the agent user id when the service key matches", () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-internal-key-123";
    const req = makeRequest({
      "X-Internal-Service-Key": "test-internal-key-123",
      "X-Agent-User-Id": "user_abc",
    });
    expect(resolveAgentServiceUser(req)).toBe("user_abc");
  });

  it("rejects a wrong key", () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-internal-key-123";
    const req = makeRequest({
      "X-Internal-Service-Key": "wrong-key",
      "X-Agent-User-Id": "user_abc",
    });
    expect(resolveAgentServiceUser(req)).toBeNull();
  });

  it("rejects when the key is not configured", () => {
    delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    const req = makeRequest({
      "X-Internal-Service-Key": "anything",
      "X-Agent-User-Id": "user_abc",
    });
    expect(resolveAgentServiceUser(req)).toBeNull();
  });

  it("rejects when the agent user id header is missing", () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-internal-key-123";
    const req = makeRequest({ "X-Internal-Service-Key": "test-internal-key-123" });
    expect(resolveAgentServiceUser(req)).toBeNull();
  });

  it("returns null for ordinary browser requests (falls through to Clerk auth)", () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-internal-key-123";
    expect(resolveAgentServiceUser(makeRequest({}))).toBeNull();
  });
});
