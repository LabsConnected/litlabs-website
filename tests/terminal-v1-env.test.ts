import { describe, it, expect } from "vitest";
import { buildSandboxEnv, assertNoPlatformSecrets, SANDBOX_ENV_ALLOWLIST } from "@/lib/terminal-v1/env-allowlist";

describe("Terminal V1 — Environment allowlist", () => {
  it("only includes allowlisted variables", () => {
    const env = buildSandboxEnv({
      userId: "user-a",
      projectId: "proj-a",
      workspaceId: "ws-a",
      sandboxId: "sbx-a",
    });

    const keys = Object.keys(env);
    for (const key of keys) {
      expect(SANDBOX_ENV_ALLOWLIST).toContain(key);
    }
  });

  it("sets LITTREE identity variables", () => {
    const env = buildSandboxEnv({
      userId: "user-a",
      projectId: "proj-a",
      workspaceId: "ws-a",
      sandboxId: "sbx-a",
    });
    expect(env.LITTREE_USER_ID).toBe("user-a");
    expect(env.LITTREE_PROJECT_ID).toBe("proj-a");
    expect(env.LITTREE_WORKSPACE_ID).toBe("ws-a");
    expect(env.LITTREE_SANDBOX_ID).toBe("sbx-a");
  });

  it("does not include any platform secrets", () => {
    const env = buildSandboxEnv({
      userId: "user-a",
      projectId: "proj-a",
      workspaceId: "ws-a",
      sandboxId: "sbx-a",
    });
    expect(env).not.toHaveProperty("CLERK_SECRET_KEY");
    expect(env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("STRIPE_SECRET_KEY");
    expect(env).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(env).not.toHaveProperty("TERMINAL_AUTH_SECRET");
    expect(env).not.toHaveProperty("TERMINAL_INTERNAL_SERVICE_KEY");
  });

  it("assertNoPlatformSecrets throws on forbidden keys", () => {
    expect(() =>
      assertNoPlatformSecrets({ CLERK_SECRET_KEY: "sk_test_123" }),
    ).toThrow(/CLERK_SECRET_KEY/);
  });

  it("assertNoPlatformSecrets passes on clean env", () => {
    expect(() =>
      assertNoPlatformSecrets({ HOME: "/workspace", PATH: "/usr/bin" }),
    ).not.toThrow();
  });
});
