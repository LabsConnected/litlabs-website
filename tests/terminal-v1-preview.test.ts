import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { PreviewPortManager } from "@/lib/terminal-v1/preview-gateway";

const SECRET = "a".repeat(64);

// Mock the sandbox provider
vi.mock("@/lib/terminal-v1/providers", () => ({
  getSandboxProvider: () => ({
    get: vi.fn(async () => ({
      sandboxId: "sbx-test",
      userId: "user-test",
      projectId: "proj-test",
      state: "running",
    })),
  }),
}));

describe("Terminal V1 — Preview Port Gateway", () => {
  let manager: PreviewPortManager;

  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
    vi.stubEnv("TERMINAL_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://studio.littree.dev");
    manager = new PreviewPortManager();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("expose returns a private preview endpoint", async () => {
    const endpoint = await manager.expose("sbx-test", 3000);
    expect(endpoint.port).toBe(3000);
    expect(endpoint.state).toBe("private");
    expect(endpoint.previewToken).toBeTruthy();
    expect(endpoint.url).toContain("sbx-test");
    expect(endpoint.url).toContain("3000");
    expect(endpoint.expiresAt).toBeTruthy();
  });

  it("expose with custom TTL", async () => {
    const endpoint = await manager.expose("sbx-test", 3000, { ttlMinutes: 60 });
    const expiresAt = new Date(endpoint.expiresAt).getTime();
    const now = Date.now();
    const diffMinutes = (expiresAt - now) / (1000 * 60);
    expect(diffMinutes).toBeGreaterThan(55);
    expect(diffMinutes).toBeLessThan(65);
  });

  it("expose with public state", async () => {
    const endpoint = await manager.expose("sbx-test", 3000, { state: "public" });
    expect(endpoint.state).toBe("public");
  });

  it("expose throws for invalid port", async () => {
    await expect(manager.expose("sbx-test", 0)).rejects.toThrow("Invalid port");
    await expect(manager.expose("sbx-test", 65536)).rejects.toThrow("Invalid port");
  });

  it("expose throws for non-existent sandbox", async () => {
    // The mock returns null for unknown sandbox IDs
    vi.doMock("@/lib/terminal-v1/providers", () => ({
      getSandboxProvider: () => ({
        get: vi.fn(async () => null),
      }),
    }));
    const { PreviewPortManager: FreshManager } = await import("@/lib/terminal-v1/preview-gateway");
    const freshManager = new FreshManager();
    await expect(freshManager.expose("sbx-unknown", 3000)).rejects.toThrow("Sandbox not found");
  });

  it("verify returns true for correct token on private preview", async () => {
    const endpoint = await manager.expose("sbx-test", 3000);
    expect(manager.verify("sbx-test", 3000, endpoint.previewToken)).toBe(true);
  });

  it("verify returns false for wrong token on private preview", async () => {
    await manager.expose("sbx-test", 3000);
    expect(manager.verify("sbx-test", 3000, "wrong-token")).toBe(false);
  });

  it("verify returns true for any token on public preview", async () => {
    await manager.expose("sbx-test", 3000, { state: "public" });
    expect(manager.verify("sbx-test", 3000, "any-token")).toBe(true);
  });

  it("verify returns false for non-existent preview", async () => {
    expect(manager.verify("sbx-test", 9999, "token")).toBe(false);
  });

  it("makePublic changes state to public", async () => {
    await manager.expose("sbx-test", 3000);
    const endpoint = manager.makePublic("sbx-test", 3000);
    expect(endpoint).not.toBeNull();
    expect(endpoint!.state).toBe("public");
  });

  it("makePrivate changes state back to private", async () => {
    await manager.expose("sbx-test", 3000, { state: "public" });
    const endpoint = manager.makePrivate("sbx-test", 3000);
    expect(endpoint).not.toBeNull();
    expect(endpoint!.state).toBe("private");
  });

  it("close removes the preview", async () => {
    await manager.expose("sbx-test", 3000);
    expect(manager.close("sbx-test", 3000)).toBe(true);
    expect(manager.get("sbx-test", 3000)).toBeNull();
  });

  it("close returns false for non-existent preview", () => {
    expect(manager.close("sbx-test", 9999)).toBe(false);
  });

  it("listBySandbox returns all ports for a sandbox", async () => {
    await manager.expose("sbx-test", 3000);
    await manager.expose("sbx-test", 8080);
    await manager.expose("sbx-other", 3000);

    const endpoints = manager.listBySandbox("sbx-test");
    expect(endpoints).toHaveLength(2);
    expect(endpoints.map((e) => e.port).sort()).toEqual([3000, 8080]);
  });

  it("listBySandbox returns empty for sandbox with no previews", () => {
    const endpoints = manager.listBySandbox("sbx-none");
    expect(endpoints).toHaveLength(0);
  });

  it("get returns null for expired preview", async () => {
    await manager.expose("sbx-test", 3000, { ttlMinutes: -1 });
    expect(manager.get("sbx-test", 3000)).toBeNull();
  });
});
