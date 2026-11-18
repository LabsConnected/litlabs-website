import { describe, it, expect } from "vitest";
import {
  assertNoPlatformSecrets,
  assertNoPlatformSecretValues,
  collectPlatformSecretValues,
  guardPerCommandProjectEnv,
  SandboxEnvSecretError,
  MIN_PLATFORM_SECRET_VALUE_LENGTH,
} from "./env-allowlist";

/**
 * Phase 2 §3.6 pins — the web mirror of the terminal's VALUE-based
 * per-command project-env rule (terminal-server/sandbox/env.ts):
 *
 * - The name-based base-env check is unchanged.
 * - A project's OWN secrets (even named CLERK_SECRET_KEY) pass the
 *   per-command guard as long as their VALUES are the project's.
 * - Any value equal to one of the platform's own secret values is
 *   refused, whatever name it travels under; the error names the
 *   carrying project key, never the value.
 * - Identity variables are dropped from per-command env.
 * - Values shorter than MIN_PLATFORM_SECRET_VALUE_LENGTH are never
 *   collected as platform secrets.
 */

const PLATFORM_CLERK = "sk_live_PLATFORM_clerk_value";
const PROJECT_CLERK = "sk_live_PROJECT_clerk_value";

describe("collectPlatformSecretValues", () => {
  it("collects values of platform-secret names at or above the minimum length", () => {
    const values = collectPlatformSecretValues({
      CLERK_SECRET_KEY: PLATFORM_CLERK,
      STRIPE_SECRET_KEY: "sk_live_PLATFORM_stripe",
      PATH: "/usr/bin",
    });
    expect(values.has(PLATFORM_CLERK)).toBe(true);
    expect(values.has("sk_live_PLATFORM_stripe")).toBe(true);
    expect(values.has("/usr/bin")).toBe(false);
  });

  it("includes E2B_API_KEY values for terminal parity", () => {
    const values = collectPlatformSecretValues({ E2B_API_KEY: "e2b_PLATFORM_key_value" });
    expect(values.has("e2b_PLATFORM_key_value")).toBe(true);
  });

  it("ignores values shorter than the minimum length", () => {
    const short = "x".repeat(MIN_PLATFORM_SECRET_VALUE_LENGTH - 1);
    const values = collectPlatformSecretValues({ CLERK_SECRET_KEY: short });
    expect(values.has(short)).toBe(false);
    expect(values.size).toBe(0);
  });

  it("ignores unset and empty values", () => {
    const values = collectPlatformSecretValues({ CLERK_SECRET_KEY: "", STRIPE_SECRET_KEY: undefined });
    expect(values.size).toBe(0);
  });
});

describe("guardPerCommandProjectEnv", () => {
  const platformValues = collectPlatformSecretValues({ CLERK_SECRET_KEY: PLATFORM_CLERK });

  it("passes a project's own secret under a platform-secret NAME", () => {
    const cleaned = guardPerCommandProjectEnv(
      { CLERK_SECRET_KEY: PROJECT_CLERK, NODE_ENV: "development" },
      platformValues,
    );
    expect(cleaned).toEqual({ CLERK_SECRET_KEY: PROJECT_CLERK, NODE_ENV: "development" });
  });

  it("refuses a platform secret VALUE under any name, naming the carrying key only", () => {
    let caught: unknown;
    try {
      guardPerCommandProjectEnv({ SOME_INNOCENT_NAME: PLATFORM_CLERK }, platformValues);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SandboxEnvSecretError);
    const message = (caught as Error).message;
    expect(message).toContain("SOME_INNOCENT_NAME");
    expect(message).not.toContain(PLATFORM_CLERK);
  });

  it("drops identity variables so identity always wins", () => {
    const cleaned = guardPerCommandProjectEnv(
      { LITTREE_USER_ID: "spoofed", LITTREE_PROJECT_ID: "spoofed", FOO: "bar" },
      platformValues,
    );
    expect(cleaned).toEqual({ FOO: "bar" });
  });

  it("passes everything when no platform values are configured", () => {
    const cleaned = guardPerCommandProjectEnv({ ANYTHING: "goes" }, new Set());
    expect(cleaned).toEqual({ ANYTHING: "goes" });
  });
});

describe("assertNoPlatformSecretValues", () => {
  it("throws SandboxEnvSecretError with the SANDBOX_PLATFORM_SECRET code", () => {
    let caught: unknown;
    try {
      assertNoPlatformSecretValues({ KEY: PLATFORM_CLERK }, new Set([PLATFORM_CLERK]));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SandboxEnvSecretError);
    expect((caught as SandboxEnvSecretError).code).toBe("SANDBOX_PLATFORM_SECRET");
  });

  it("is a no-op for an empty platform value set", () => {
    expect(() =>
      assertNoPlatformSecretValues({ KEY: PLATFORM_CLERK }, new Set()),
    ).not.toThrow();
  });
});

describe("assertNoPlatformSecrets (name-based base-env check, unchanged)", () => {
  it("still throws on a platform-secret name with a non-empty value", () => {
    expect(() => assertNoPlatformSecrets({ CLERK_SECRET_KEY: PROJECT_CLERK })).toThrow(
      /Forbidden secret "CLERK_SECRET_KEY"/,
    );
  });

  it("passes a clean env", () => {
    expect(() => assertNoPlatformSecrets({ NODE_ENV: "production" })).not.toThrow();
  });
});
