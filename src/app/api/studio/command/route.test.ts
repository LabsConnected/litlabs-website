import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression coverage for the web→terminal-server command bridge URL.
 *
 * The route must only ever forward commands to an http(s) endpoint. A
 * missing or non-HTTP configuration (e.g. a wss:// websocket URL being
 * reused as a fetch base) must fail loudly with a configuration error
 * rather than attempting a request that can never succeed.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_test" })),
}));

import { POST } from "./route";

const ENV_KEYS = [
  "TERMINAL_SERVER_INTERNAL_URL",
  "TERMINAL_SERVER_URL",
  "NEXT_PUBLIC_TERMINAL_HTTP_URL",
  "NEXT_PUBLIC_TERMINAL_WS_URL",
  "TERMINAL_INTERNAL_SERVICE_KEY",
];

let savedEnv: Record<string, string | undefined>;
let fetchSpy: ReturnType<typeof vi.fn>;

function req(command: string): NextRequest {
  return new NextRequest("http://localhost/api/studio/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  process.env.TERMINAL_INTERNAL_SERVICE_KEY = "k".repeat(40);
  delete process.env.TERMINAL_SERVER_INTERNAL_URL;
  delete process.env.TERMINAL_SERVER_URL;
  delete process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL;
  delete process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/studio/command — terminal URL resolution", () => {
  it("fails loudly instead of fetching when only a wss:// URL is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL = "wss://terminal.litlabs.net";

    const res = await POST(req("status"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured|configuration/i);
    // The wss:// value must never reach server-side fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses TERMINAL_SERVER_INTERNAL_URL when it is a valid http(s) URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.TERMINAL_SERVER_INTERNAL_URL = "http://litlabs-terminal-server.railway.internal:8080/";

    const res = await POST(req("status"));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://litlabs-terminal-server.railway.internal:8080/internal/command",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects a non-http(s) TERMINAL_SERVER_INTERNAL_URL instead of fetching", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.TERMINAL_SERVER_INTERNAL_URL = "wss://terminal.litlabs.net";

    const res = await POST(req("status"));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails loudly in production when no internal URL is configured at all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(req("status"));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the internal service key to the upstream", async () => {
    process.env.TERMINAL_SERVER_INTERNAL_URL = "https://terminal.litlabs.net";
    await POST(req("status"));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Internal-Service-Key": "k".repeat(40),
        }),
      }),
    );
  });
});
