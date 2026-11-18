import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 2 build-list §3.2/§3.3 pins for the terminal internal client:
 *
 * - getSandboxAvailability parses the terminal's gate decision and
 *   FAILS CLOSED ({ allowed: false }) on any error, non-OK status,
 *   unparseable body, or missing internal-service configuration.
 * - Results are cached briefly per user.
 * - buildPreviewProxyUrl with an owner+project scope mints a signed
 *   preview token instead of appending the global PREVIEW_ACCESS_TOKEN;
 *   without a scope the historical behavior is byte-identical.
 */

const VALID_KEY = "k".repeat(40);
const VALID_SECRET = "s".repeat(40);

beforeEach(() => {
  vi.stubEnv("TERMINAL_INTERNAL_SERVICE_KEY", VALID_KEY);
  vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "http://terminal.internal:4001");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getSandboxAvailability", () => {
  it("returns the terminal's decision when it reports allowed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            provider: "e2b",
            routingEnabled: true,
            verified: true,
            allowed: true,
            reason: "ok",
          }),
          { status: 200 },
        ),
      ),
    );
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    const result = await getSandboxAvailability("user-avail-ok");
    expect(result).toEqual({
      provider: "e2b",
      routingEnabled: true,
      verified: true,
      allowed: true,
      reason: "ok",
    });
  });

  it("sends the internal service key and the userId query", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: false, reason: "not-owner" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    await getSandboxAvailability("user-avail-headers");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/internal/sandbox/availability?userId=user-avail-headers");
    expect((init.headers as Record<string, string>)["X-Internal-Service-Key"]).toBe(VALID_KEY);
  });

  it("fails closed on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    const result = await getSandboxAvailability("user-avail-500");
    expect(result.allowed).toBe(false);
  });

  it("fails closed when the terminal is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    const result = await getSandboxAvailability("user-avail-down");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("availability-unavailable");
  });

  it("fails closed on an unparseable body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    const result = await getSandboxAvailability("user-avail-garbled");
    expect(result.allowed).toBe(false);
  });

  it("fails closed WITHOUT fetching when the internal key is not configured", async () => {
    vi.stubEnv("TERMINAL_INTERNAL_SERVICE_KEY", "");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    const result = await getSandboxAvailability("user-avail-nokey");
    expect(result.allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches per user — a second call within the TTL does not re-fetch", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ allowed: true, reason: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    await getSandboxAvailability("user-avail-cache");
    await getSandboxAvailability("user-avail-cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a truthy-but-not-true allowed field as not allowed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ allowed: "yes" }), { status: 200 }),
      ),
    );
    const { getSandboxAvailability } = await import("@/lib/terminal-internal-client");
    const result = await getSandboxAvailability("user-avail-stringy");
    expect(result.allowed).toBe(false);
  });
});

describe("buildPreviewProxyUrl — scoped minting (§3.3)", () => {
  it("mints a signed token instead of the global access token when scoped", async () => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", VALID_SECRET);
    vi.stubEnv("PREVIEW_ACCESS_TOKEN", "global-token-must-not-leak");
    const { buildPreviewProxyUrl } = await import("@/lib/terminal-internal-client");
    const url = buildPreviewProxyUrl("ws-1", { userId: "user-1", projectId: "proj-1" });
    expect(url).toContain("/preview/ws-1?token=");
    expect(url).not.toContain("global-token-must-not-leak");
    const token = new URL(url).searchParams.get("token") ?? "";
    // Signed preview tokens are payload.signature pairs (see
    // src/lib/projects/preview-token.ts).
    expect(token.split(".")).toHaveLength(2);
  });

  it("keeps the legacy global-token behavior when no scope is given", async () => {
    vi.stubEnv("PREVIEW_ACCESS_TOKEN", "global-token-legacy");
    const { buildPreviewProxyUrl } = await import("@/lib/terminal-internal-client");
    const url = buildPreviewProxyUrl("ws-1");
    expect(url).toContain("token=global-token-legacy");
  });

  it("falls back to the legacy channel when scoped minting is unavailable", async () => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", "");
    vi.stubEnv("PREVIEW_ACCESS_TOKEN", "global-token-fallback");
    const { buildPreviewProxyUrl } = await import("@/lib/terminal-internal-client");
    const url = buildPreviewProxyUrl("ws-1", { userId: "user-1", projectId: "proj-1" });
    expect(url).toContain("token=global-token-fallback");
  });
});
