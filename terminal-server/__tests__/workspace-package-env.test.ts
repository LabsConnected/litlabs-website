/**
 * Package-script environment allowlist (Phase 2, design note §3.6).
 *
 * prepareWorkspace runs repo-controlled package scripts (install +
 * TypeScript pre-install). Those child processes must receive only
 * the benign variables a package manager needs — never the
 * terminal's platform secrets, which historically rode along via a
 * whole-process-env spread.
 */

import { describe, it, expect } from "vitest";
import {
  buildPackageScriptEnv,
  PACKAGE_SCRIPT_ENV_ALLOWLIST,
} from "../workspace/WorkspaceManager";

describe("buildPackageScriptEnv", () => {
  it("passes only allowlisted variables and forces NODE_ENV=development", () => {
    const env = buildPackageScriptEnv({
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/tester",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(env.HOME).toBe("/home/tester");
    expect(env.NODE_ENV).toBe("development");
  });

  it("never forwards platform secrets present in the terminal's env", () => {
    const env = buildPackageScriptEnv({
      PATH: "/usr/bin",
      CLERK_SECRET_KEY: "sk_test_platform",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      STRIPE_SECRET_KEY: "sk_live_platform",
      E2B_API_KEY: "e2b_platform_key",
      TERMINAL_AUTH_SECRET: "terminal-secret",
      TERMINAL_INTERNAL_SERVICE_KEY: "internal-key",
      DATABASE_URL: "postgres://platform",
    } as NodeJS.ProcessEnv);
    for (const key of Object.keys(env)) {
      if (key === "NODE_ENV") continue; // forced by the builder, by design
      expect(PACKAGE_SCRIPT_ENV_ALLOWLIST).toContain(key);
    }
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.E2B_API_KEY).toBeUndefined();
    expect(env.TERMINAL_AUTH_SECRET).toBeUndefined();
    expect(env.TERMINAL_INTERNAL_SERVICE_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(Object.values(env)).not.toContain("sk_test_platform");
  });

  it("omits allowlisted variables that are absent instead of inventing them", () => {
    const env = buildPackageScriptEnv({ PATH: "/usr/bin" } as NodeJS.ProcessEnv);
    expect(env).toEqual({ PATH: "/usr/bin", NODE_ENV: "development" });
  });
});
