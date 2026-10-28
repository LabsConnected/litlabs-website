import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
}));

vi.mock("../lib/auth/auth-session.js", () => ({
  getAuthSession: () => ({ getAccessToken: mocks.getAccessToken }),
}));

import { createMemory, listMemories, MemoryClientError } from "../lib/memory/memory-client.js";

describe("memory-client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mocks.getAccessToken.mockReset();
    delete process.env.LITT_API_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("fails closed with a clear error when not signed in", async () => {
    mocks.getAccessToken.mockResolvedValue(null);
    await expect(createMemory("hello")).rejects.toThrow(MemoryClientError);
    await expect(createMemory("hello")).rejects.toThrow(/not signed in/i);
  });

  it("attaches the existing Clerk session token as a Bearer header on create", async () => {
    mocks.getAccessToken.mockResolvedValue("fake-clerk-jwt");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memory: { id: "m1", owner_id: "u1", content: "hello", scope: "profile" } }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createMemory("hello", { scope: "profile" });

    expect(result.id).toBe("m1");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://www.litlabs.net/api/memory");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer fake-clerk-jwt");
  });

  it("surfaces the server's error message and status on failure", async () => {
    mocks.getAccessToken.mockResolvedValue("fake-clerk-jwt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    }) as unknown as typeof fetch;

    await expect(createMemory("hello")).rejects.toMatchObject({
      message: "Unauthorized",
      status: 401,
    });
  });

  it("lists memories for the signed-in user via the same owner-scoped endpoint", async () => {
    mocks.getAccessToken.mockResolvedValue("fake-clerk-jwt");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [{ id: "m1" }, { id: "m2" }] }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await listMemories({ scope: "profile", limit: 10 });

    expect(result).toHaveLength(2);
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/memory?");
    expect(url).toContain("scope=profile");
    expect(url).toContain("limit=10");
  });

  it("respects LITT_API_URL override instead of the production default", async () => {
    vi.stubEnv("LITT_API_URL", "http://localhost:3001");
    mocks.getAccessToken.mockResolvedValue("fake-clerk-jwt");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ memories: [] }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await listMemories();

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/^http:\/\/localhost:3001\/api\/memory/);
  });
});
