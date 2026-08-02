import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getSandboxProvider, resetSandboxProvider } from "@/lib/terminal-v1/providers";
import { DisabledProvider, FeatureDisabledError } from "@/lib/terminal-v1/providers/disabled-provider";

const SECRET = "a".repeat(64);

describe("Terminal V1 Safety Boundary — PR 1", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
    vi.stubEnv("TERMINAL_ENABLED", "false");
    vi.stubEnv("TERMINAL_PROVIDER", "disabled");
    vi.resetModules();
    resetSandboxProvider();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    resetSandboxProvider();
  });

  // ─── Disabled terminal produces no connection ──────────────────

  it("disabled provider refuses create", async () => {
    const provider = new DisabledProvider();
    await expect(
      provider.create({
        workspaceId: "ws-a",
        userId: "user-a",
        projectId: "proj-a",
      }),
    ).rejects.toThrow(FeatureDisabledError);
  });

  it("disabled provider refuses start", async () => {
    const provider = new DisabledProvider();
    await expect(provider.start("sbx-a")).rejects.toThrow(FeatureDisabledError);
  });

  it("disabled provider refuses stop", async () => {
    const provider = new DisabledProvider();
    await expect(provider.stop("sbx-a")).rejects.toThrow(FeatureDisabledError);
  });

  it("disabled provider refuses connectTerminal", async () => {
    const provider = new DisabledProvider();
    await expect(
      provider.connectTerminal("sbx-a", { shell: "bash", cols: 80, rows: 24 }),
    ).rejects.toThrow(FeatureDisabledError);
  });

  it("disabled provider refuses execute", async () => {
    const provider = new DisabledProvider();
    await expect(
      provider.execute("sbx-a", { command: "ls" }),
    ).rejects.toThrow(FeatureDisabledError);
  });

  it("disabled provider health reports unhealthy", async () => {
    const provider = new DisabledProvider();
    const health = await provider.health();
    expect(health.healthy).toBe(false);
  });

  it("disabled provider get returns null", async () => {
    const provider = new DisabledProvider();
    const result = await provider.get("sbx-a");
    expect(result).toBeNull();
  });

  // ─── Provider factory ──────────────────────────────────────────

  it("getSandboxProvider returns disabled by default", () => {
    vi.stubEnv("TERMINAL_PROVIDER", "disabled");
    resetSandboxProvider();
    const provider = getSandboxProvider();
    expect(provider.name).toBe("disabled");
  });

  it("getSandboxProvider returns disabled for managed-sandbox (not yet implemented)", () => {
    vi.stubEnv("TERMINAL_PROVIDER", "managed-sandbox");
    resetSandboxProvider();
    const provider = getSandboxProvider();
    // PR 2 will replace this with a real provider
    expect(provider.name).toBe("disabled");
  });

  it("getSandboxProvider returns disabled for unknown provider", () => {
    vi.stubEnv("TERMINAL_PROVIDER", "some-unknown-provider");
    resetSandboxProvider();
    const provider = getSandboxProvider();
    expect(provider.name).toBe("disabled");
  });

  // ─── No host-shell process is spawned ──────────────────────────

  it("FeatureDisabledError has correct code", () => {
    const err = new FeatureDisabledError("test");
    expect(err.code).toBe("FEATURE_DISABLED");
    expect(err.message).toContain("test");
  });

  it("FeatureDisabledError is an Error instance", () => {
    const err = new FeatureDisabledError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("FeatureDisabledError");
  });
});
