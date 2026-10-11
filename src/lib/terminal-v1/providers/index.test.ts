/**
 * Provider factory tests — E2B staging carve-out ("Option A", owner-approved
 * 2026-10-10).
 *
 * Matrix:
 * - production (Railway or Vercel) → DisabledProvider ALWAYS, even with every
 *   flag set. No override exists.
 * - hosted staging + TERMINAL_PROVIDER=e2b + E2B_HOSTED_OPT_IN=true →
 *   E2BSandboxProvider.
 * - hosted staging + e2b WITHOUT the flag → DisabledProvider (fail-closed).
 * - hosted staging + managed-sandbox (docker) → DisabledProvider (Gate 1
 *   retained: host execution never leaves provably-local dev).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSandboxProvider,
  resetSandboxProvider,
  isProductionEnvironment,
  E2B_HOSTED_OPT_IN_VAR,
} from "./index";
import { DisabledProvider } from "./disabled-provider";
import { E2BSandboxProvider } from "./e2b-provider";

const RAILWAY_MARKERS = {
  RAILWAY_ENVIRONMENT_ID: "env-123",
  RAILWAY_PROJECT_ID: "proj-123",
  RAILWAY_SERVICE_ID: "svc-123",
};

const SAVED = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearTestEnv() {
  for (const k of [
    "TERMINAL_PROVIDER",
    E2B_HOSTED_OPT_IN_VAR,
    "E2B_API_KEY",
    "RAILWAY_ENVIRONMENT_NAME",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_PROJECT_ID",
    "RAILWAY_SERVICE_ID",
    "VERCEL_ENV",
  ]) {
    delete process.env[k];
  }
}

beforeEach(() => {
  clearTestEnv();
  resetSandboxProvider();
});

afterEach(() => {
  clearTestEnv();
  resetSandboxProvider();
  process.env = { ...SAVED };
});

describe("isProductionEnvironment", () => {
  it("detects Railway production", () => {
    expect(isProductionEnvironment({ RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(true);
    expect(isProductionEnvironment({ RAILWAY_ENVIRONMENT_NAME: "Production" })).toBe(true);
  });
  it("detects Vercel production", () => {
    expect(isProductionEnvironment({ VERCEL_ENV: "production" })).toBe(true);
  });
  it("does not flag staging / dev / empty", () => {
    expect(isProductionEnvironment({ RAILWAY_ENVIRONMENT_NAME: "staging" })).toBe(false);
    expect(isProductionEnvironment({ RAILWAY_ENVIRONMENT_NAME: "development" })).toBe(false);
    expect(isProductionEnvironment({})).toBe(false);
  });
});

describe("getSandboxProvider — E2B staging carve-out", () => {
  it("production stays disabled even with every flag set (no override)", () => {
    setEnv({
      ...RAILWAY_MARKERS,
      RAILWAY_ENVIRONMENT_NAME: "production",
      TERMINAL_PROVIDER: "e2b",
      [E2B_HOSTED_OPT_IN_VAR]: "true",
      E2B_API_KEY: "key-for-test",
    });
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });

  it("Vercel production stays disabled even with every flag set", () => {
    setEnv({
      VERCEL_ENV: "production",
      TERMINAL_PROVIDER: "e2b",
      [E2B_HOSTED_OPT_IN_VAR]: "true",
      E2B_API_KEY: "key-for-test",
    });
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });

  it("hosted staging + e2b + opt-in flag → E2BSandboxProvider", () => {
    setEnv({
      ...RAILWAY_MARKERS,
      RAILWAY_ENVIRONMENT_NAME: "staging",
      TERMINAL_PROVIDER: "e2b",
      [E2B_HOSTED_OPT_IN_VAR]: "true",
    });
    expect(getSandboxProvider()).toBeInstanceOf(E2BSandboxProvider);
  });

  it("hosted staging + e2b WITHOUT the flag → DisabledProvider (fail-closed)", () => {
    setEnv({
      ...RAILWAY_MARKERS,
      RAILWAY_ENVIRONMENT_NAME: "staging",
      TERMINAL_PROVIDER: "e2b",
    });
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });

  it("hosted staging + docker provider → DisabledProvider (Gate 1 retained)", () => {
    setEnv({
      ...RAILWAY_MARKERS,
      RAILWAY_ENVIRONMENT_NAME: "staging",
      TERMINAL_PROVIDER: "managed-sandbox",
      [E2B_HOSTED_OPT_IN_VAR]: "true",
    });
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });

  it("hosted staging + flag but no TERMINAL_PROVIDER → DisabledProvider", () => {
    setEnv({
      ...RAILWAY_MARKERS,
      RAILWAY_ENVIRONMENT_NAME: "staging",
      [E2B_HOSTED_OPT_IN_VAR]: "true",
    });
    expect(getSandboxProvider()).toBeInstanceOf(DisabledProvider);
  });

  it("E2B provider still throws fail-closed without an API key", async () => {
    setEnv({
      ...RAILWAY_MARKERS,
      RAILWAY_ENVIRONMENT_NAME: "staging",
      TERMINAL_PROVIDER: "e2b",
      [E2B_HOSTED_OPT_IN_VAR]: "true",
      // E2B_API_KEY deliberately unset
    });
    const provider = getSandboxProvider();
    expect(provider).toBeInstanceOf(E2BSandboxProvider);
    await expect(provider.create({} as never)).rejects.toThrow(/fail-closed|not set/i);
  });
});
