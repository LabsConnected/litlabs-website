/** Provider selection must preserve Gate 1, including hosted staging. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSandboxProvider, resetSandboxProvider } from "./index";
import { DisabledProvider } from "./disabled-provider";
import { E2BSandboxProvider } from "./e2b-provider";

const environmentKeys = ["NODE_ENV", "TERMINAL_PROVIDER", "E2B_HOSTED_OPT_IN", "E2B_API_KEY", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_GIT_COMMIT_SHA", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "LITT_LOCAL_EXECUTION_OPT_IN", "LITT_ISOLATION_VERIFIED", "LITT_RESOLVED_BIND_HOST"];
beforeEach(() => {
  for (const key of environmentKeys) vi.stubEnv(key, "");
  resetSandboxProvider();
});
afterEach(() => { vi.unstubAllEnvs(); resetSandboxProvider(); });

describe("sandbox provider fail-closed selection", () => {
  it.each(["production", "staging"])("keeps Railway %s disabled even with E2B flags", (environment) => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "hosted-env");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", environment);
    vi.stubEnv("TERMINAL_PROVIDER", "e2b");
    vi.stubEnv("E2B_HOSTED_OPT_IN", "true");
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });
  it.each(["production", "preview"])("keeps Vercel %s disabled", (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("TERMINAL_PROVIDER", "e2b");
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });
  it("does not allow hosted Docker execution", () => {
    vi.stubEnv("RAILWAY_SERVICE_ID", "hosted-service");
    vi.stubEnv("TERMINAL_PROVIDER", "managed-sandbox");
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });
  it("defaults to disabled without a verified local environment", () => {
    vi.stubEnv("TERMINAL_PROVIDER", "e2b");
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });
  it("only selects E2B in an explicitly verified local environment", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("LITT_LOCAL_EXECUTION_OPT_IN", "true");
    vi.stubEnv("LITT_ISOLATION_VERIFIED", "true");
    vi.stubEnv("LITT_RESOLVED_BIND_HOST", "127.0.0.1");
    vi.stubEnv("TERMINAL_PROVIDER", "e2b");
    const provider = getSandboxProvider();
    expect(provider).toBeInstanceOf(E2BSandboxProvider);
    await expect(provider.create({} as never)).rejects.toThrow(/fail-closed|not set/i);
  });
});
