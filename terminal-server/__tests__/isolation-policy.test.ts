/**
 * Terminal isolation policy tests.
 *
 * Properties proven here:
 *   1. Terminal execution fails closed without isolation.
 *   2. A host shell is impossible in production-like environments, and no
 *      environment variable can re-enable it.
 *   3. The verdict that /health reports is the same one that gates sessions.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateTerminalIsolation,
  assertHostShellPermitted,
  isProductionLike,
  isLocalExecutionOptedIn,
  isUntrustedLocalRequest,
  TerminalIsolationError,
} from "../isolation-policy";

const PROD = { NODE_ENV: "production" };
const DEV = {
  NODE_ENV: "development",
  LITT_LOCAL_EXECUTION_OPT_IN: "true",
  LITT_ISOLATION_VERIFIED: "true",
  LITT_RESOLVED_BIND_HOST: "127.0.0.1",
};

describe("isProductionLike", () => {
  it("treats NODE_ENV=production as production", () => {
    expect(isProductionLike(PROD)).toBe(true);
  });

  it("treats any Railway marker as production even when NODE_ENV is wrong or unset", () => {
    expect(isProductionLike({ NODE_ENV: "development", RAILWAY_SERVICE_ID: "svc" })).toBe(true);
    expect(isProductionLike({ RAILWAY_PROJECT_ID: "proj" })).toBe(true);
    expect(isProductionLike({ RAILWAY_ENVIRONMENT_ID: "env" })).toBe(true);
    expect(isProductionLike({ RAILWAY_GIT_COMMIT_SHA: "288b4c03" })).toBe(true);
  });

  it("treats only an opted-in, loopback-bound development/test environment as local", () => {
    expect(isProductionLike(DEV)).toBe(false);
    expect(isProductionLike({ ...DEV, NODE_ENV: "test" })).toBe(false);
  });

  it("is default-deny: missing markers or NODE_ENV never permit execution", () => {
    expect(isProductionLike({})).toBe(true);
    expect(isProductionLike({ NODE_ENV: "development" })).toBe(true);
    expect(isProductionLike({ NODE_ENV: "test" })).toBe(true);
    for (const NODE_ENV of [undefined, "", "prod", "staging", "Production"]) {
      expect(isProductionLike({ ...DEV, NODE_ENV }), String(NODE_ENV)).toBe(true);
    }
  });

  it("requires BOTH opt-in keys, each exactly \"true\"", () => {
    for (const v of [undefined, "", "0", "1", "TRUE", "yes", " true"]) {
      expect(isProductionLike({ ...DEV, LITT_LOCAL_EXECUTION_OPT_IN: v }), `opt-in=${v}`).toBe(true);
      expect(isProductionLike({ ...DEV, LITT_ISOLATION_VERIFIED: v }), `verified=${v}`).toBe(true);
    }
  });

  it("isLocalExecutionOptedIn needs both keys and never reads headers", () => {
    expect(isLocalExecutionOptedIn(DEV)).toBe(true);
    expect(isLocalExecutionOptedIn({})).toBe(false);
    expect(isLocalExecutionOptedIn({ LITT_LOCAL_EXECUTION_OPT_IN: "true" })).toBe(false);
    expect(isLocalExecutionOptedIn({ LITT_ISOLATION_VERIFIED: "true" })).toBe(false);
    expect(isLocalExecutionOptedIn({ ...DEV, Host: "localhost", "X-Forwarded-For": "127.0.0.1" })).toBe(true);
  });

  it("requires a verified loopback bind (a reachable dev server is untrusted)", () => {
    for (const host of [undefined, "", "0.0.0.0", "::", "192.168.1.20", "100.101.102.103", "127.0.0.1.evil.com"]) {
      expect(isProductionLike({ ...DEV, LITT_RESOLVED_BIND_HOST: host }), String(host)).toBe(true);
    }
    expect(isProductionLike({ ...DEV, LITT_RESOLVED_BIND_HOST: "::1" })).toBe(false);
    expect(isProductionLike({ ...DEV, LITT_RESOLVED_BIND_HOST: "localhost" })).toBe(false);
  });

  it("treats Vercel markers as hosted", () => {
    for (const k of ["VERCEL", "VERCEL_ENV", "VERCEL_URL"]) {
      expect(isProductionLike({ ...DEV, [k]: "1" }), k).toBe(true);
    }
  });
});

describe("evaluateTerminalIsolation", () => {
  it("disables terminal execution in production without Docker mode", () => {
    const v = evaluateTerminalIsolation({ env: PROD, useDocker: false, dockerAvailable: false });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.status).toBe("unsafe");
    expect(v.mode).toBe("none");
    expect(v.productionLike).toBe(true);
  });

  it("disables terminal execution in production when Docker mode is on but the runtime is missing", () => {
    const v = evaluateTerminalIsolation({
      env: PROD,
      useDocker: true,
      dockerAvailable: false,
      dockerReason: "Docker daemon not reachable",
    });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.status).toBe("unsafe");
    expect(v.reason).toContain("Failing closed unconditionally");
  });

  it("keeps production terminal execution DISABLED even when Docker is installed, configured and reachable", () => {
    const v = evaluateTerminalIsolation({ env: PROD, useDocker: true, dockerAvailable: true });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.mode).toBe("none");
    expect(v.status).toBe("unsafe");
    expect(v.reason).toMatch(/Failing closed unconditionally/);
  });

  it("cannot be re-enabled by TERMINAL_VERIFIED_ISOLATION in production", () => {
    const v = evaluateTerminalIsolation({
      env: { ...PROD, TERMINAL_VERIFIED_ISOLATION: "true" },
      useDocker: true,
      dockerAvailable: true,
    });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.mode).toBe("none");
  });

  it("cannot be re-enabled by any DOCKER_* or TERMINAL_* variable in production", () => {
    const v = evaluateTerminalIsolation({
      env: {
        ...PROD,
        TERMINAL_VERIFIED_ISOLATION: "true",
        TERMINAL_ALLOW_EXECUTION: "true",
        TERMINAL_ENABLE: "1",
        DOCKER_ENABLE: "true",
        ALLOW_DOCKER: "1",
        TERMINAL_USE_DOCKER: "true",
      },
      useDocker: true,
      dockerAvailable: true,
    });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.mode).toBe("none");
  });

  it("fails closed on Railway even with Docker available and override variables set", () => {
    const v = evaluateTerminalIsolation({
      env: {
        RAILWAY_PROJECT_ID: "proj",
        TERMINAL_VERIFIED_ISOLATION: "true",
        TERMINAL_USE_DOCKER: "true",
      },
      useDocker: true,
      dockerAvailable: true,
    });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.productionLike).toBe(true);
  });

  it("does the same on Railway regardless of NODE_ENV", () => {
    const v = evaluateTerminalIsolation({
      env: { NODE_ENV: "development", RAILWAY_ENVIRONMENT_ID: "env" },
      useDocker: true,
      dockerAvailable: true,
    });
    expect(v.terminalExecution).toBe("disabled");
  });

  it("enables Docker-backed execution in local development (behaviour preserved)", () => {
    const v = evaluateTerminalIsolation({ env: DEV, useDocker: true, dockerAvailable: true });
    expect(v.terminalExecution).toBe("enabled");
    expect(v.mode).toBe("docker");
    expect(v.status).toBe("docker_enforced");
  });

  it("fails closed in development too when Docker mode is requested but unavailable", () => {
    const v = evaluateTerminalIsolation({ env: DEV, useDocker: true, dockerAvailable: false });
    expect(v.terminalExecution).toBe("disabled");
  });

  it("allows a host shell only in local development, and labels it as unisolated", () => {
    const v = evaluateTerminalIsolation({ env: DEV, useDocker: false, dockerAvailable: false });
    expect(v.terminalExecution).toBe("enabled");
    expect(v.mode).toBe("host");
    expect(v.status).toBe("dev_host_shell");
    expect(v.productionLike).toBe(false);
  });

  it("does not allow a host shell on Railway even when NODE_ENV says development", () => {
    const v = evaluateTerminalIsolation({
      env: { ...DEV, RAILWAY_SERVICE_ID: "svc" },
      useDocker: false,
      dockerAvailable: false,
    });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.status).toBe("unsafe");
  });

  it("does not allow a host shell or Docker on NODE_ENV=development alone", () => {
    for (const useDocker of [false, true]) {
      const v = evaluateTerminalIsolation({
        env: { NODE_ENV: "development" },
        useDocker,
        dockerAvailable: true,
      });
      expect(v.terminalExecution, `useDocker=${useDocker}`).toBe("disabled");
    }
  });

  it("does not allow execution when the dev server is bound to a reachable address", () => {
    const v = evaluateTerminalIsolation({
      env: { ...DEV, LITT_RESOLVED_BIND_HOST: "0.0.0.0" },
      useDocker: false,
      dockerAvailable: false,
    });
    expect(v.terminalExecution).toBe("disabled");
  });

  it("cannot be re-enabled by any environment variable in production", () => {
    const v = evaluateTerminalIsolation({
      env: {
        ...PROD,
        TERMINAL_ALLOW_HOST_SHELL: "true",
        ALLOW_HOST_SHELL: "1",
        ALLOW_ANONYMOUS_DEV: "true",
        TERMINAL_USE_DOCKER: "false",
      },
      useDocker: false,
      dockerAvailable: false,
    });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.mode).toBe("none");
  });
});

describe("sandboxExecution dimension (Step 6, F1)", () => {
  const CHECKED = "2026-11-14T13:45:00.000Z";
  const FRESH = "2026-11-14T13:50:00.000Z";
  const VERIFIED = {
    provider: "e2b",
    state: "verified" as const,
    verified: true,
    checkedAt: CHECKED,
    freshUntil: FRESH,
  };

  it("reports sandbox execution enabled in production from a verified signal — host fields byte-identical", () => {
    const v = evaluateTerminalIsolation({
      env: PROD,
      useDocker: false,
      dockerAvailable: false,
      sandbox: VERIFIED,
    });
    expect(v.sandboxExecution.execution).toBe("enabled");
    expect(v.sandboxExecution.provider).toBe("e2b");
    expect(v.sandboxExecution.state).toBe("verified");
    expect(v.sandboxExecution.checkedAt).toBe(CHECKED);
    expect(v.sandboxExecution.freshUntil).toBe(FRESH);
    // Host verdict is exactly the pre-Step-6 production verdict.
    expect(v.terminalExecution).toBe("disabled");
    expect(v.mode).toBe("none");
    expect(v.status).toBe("unsafe");
    expect(v.productionLike).toBe(true);
    expect(v.reason).toMatch(/Failing closed unconditionally/);
  });

  it("T2 pin: a verified sandbox never permits a host shell in production", () => {
    const v = evaluateTerminalIsolation({
      env: PROD,
      useDocker: true,
      dockerAvailable: true,
      sandbox: VERIFIED,
    });
    expect(v.sandboxExecution.execution).toBe("enabled");
    expect(v.terminalExecution).toBe("disabled");
    // The spawn guard takes no sandbox input at all and still throws.
    expect(() => assertHostShellPermitted(PROD, false)).toThrow(TerminalIsolationError);
    expect(() => assertHostShellPermitted(PROD, true)).toThrow(TerminalIsolationError);
    expect(() => assertHostShellPermitted({ RAILWAY_SERVICE_ID: "svc" }, false)).toThrow(
      TerminalIsolationError,
    );
  });

  it("reports sandbox disabled for failed, stale and never-run canaries", () => {
    for (const state of ["failed", "stale", "never-run"] as const) {
      const v = evaluateTerminalIsolation({
        env: PROD,
        useDocker: false,
        dockerAvailable: false,
        sandbox: { provider: "e2b", state, verified: false, checkedAt: CHECKED, freshUntil: FRESH },
      });
      expect(v.sandboxExecution.execution, state).toBe("disabled");
      expect(v.sandboxExecution.state).toBe(state);
      expect(v.sandboxExecution.provider).toBe("e2b");
      expect(v.terminalExecution).toBe("disabled");
    }
  });

  it("requires BOTH signal affirmations: state verified but verified=false stays disabled", () => {
    const v = evaluateTerminalIsolation({
      env: PROD,
      useDocker: false,
      dockerAvailable: false,
      sandbox: { provider: "e2b", state: "verified", verified: false },
    });
    expect(v.sandboxExecution.execution).toBe("disabled");
    const w = evaluateTerminalIsolation({
      env: PROD,
      useDocker: false,
      dockerAvailable: false,
      sandbox: { provider: "e2b", verified: true },
    });
    expect(w.sandboxExecution.execution).toBe("disabled");
    expect(w.sandboxExecution.state).toBe("never-run");
  });

  it("reports not-configured when no sandbox input or a disabled provider is given", () => {
    const noInput = evaluateTerminalIsolation({ env: PROD, useDocker: false, dockerAvailable: false });
    expect(noInput.sandboxExecution.execution).toBe("disabled");
    expect(noInput.sandboxExecution.state).toBe("not-configured");
    expect(noInput.sandboxExecution.provider).toBe("disabled");
    const disabled = evaluateTerminalIsolation({
      env: PROD,
      useDocker: false,
      dockerAvailable: false,
      sandbox: { provider: "disabled", state: "verified", verified: true },
    });
    expect(disabled.sandboxExecution.execution).toBe("disabled");
    expect(disabled.sandboxExecution.state).toBe("not-configured");
  });

  it("T3 pin: no environment variable can light the sandbox dimension", () => {
    const v = evaluateTerminalIsolation({
      env: {
        ...PROD,
        LITT_ISOLATION_VERIFIED: "true",
        LITT_LOCAL_EXECUTION_OPT_IN: "true",
        SANDBOX_PRODUCTION_ENABLED: "true",
        SANDBOX_PROVIDER: "e2b",
        TERMINAL_VERIFIED_ISOLATION: "true",
      },
      useDocker: true,
      dockerAvailable: true,
    });
    expect(v.sandboxExecution.execution).toBe("disabled");
    expect(v.sandboxExecution.state).toBe("not-configured");
    expect(v.terminalExecution).toBe("disabled");
  });

  it("leaves local-development host behavior unchanged and reports the sandbox dimension alongside", () => {
    const v = evaluateTerminalIsolation({
      env: DEV,
      useDocker: false,
      dockerAvailable: false,
      sandbox: VERIFIED,
    });
    expect(v.terminalExecution).toBe("enabled");
    expect(v.mode).toBe("host");
    expect(v.status).toBe("dev_host_shell");
    expect(v.sandboxExecution.execution).toBe("enabled");
  });
});

describe("isUntrustedLocalRequest (loopback bind does not make a request trusted)", () => {
  it("accepts direct requests to a loopback Host", () => {
    for (const host of ["localhost:3001", "127.0.0.1:4000", "[::1]:4000"]) {
      expect(isUntrustedLocalRequest({ host }), host).toBe(false);
    }
  });

  it("rejects proxy/tunnel headers and non-loopback or missing Host", () => {
    for (const h of ["x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip", "via"]) {
      expect(isUntrustedLocalRequest({ host: "localhost:3001", [h]: "203.0.113.9" }), h).toBe(true);
    }
    for (const host of ["abc.ngrok.app", "localhost.evil.com", "192.168.1.5:3001"]) {
      expect(isUntrustedLocalRequest({ host }), host).toBe(true);
    }
    expect(isUntrustedLocalRequest({})).toBe(true);
  });

  it("treats a header array like its first value", () => {
    expect(isUntrustedLocalRequest({ host: ["localhost:3001"], "x-forwarded-for": ["1.2.3.4"] })).toBe(true);
  });
});

describe("assertHostShellPermitted", () => {
  it("throws a TerminalIsolationError for a host shell in production", () => {
    expect(() => assertHostShellPermitted(PROD, false)).toThrow(TerminalIsolationError);
  });

  it("throws for a host shell on Railway regardless of NODE_ENV", () => {
    expect(() => assertHostShellPermitted({ RAILWAY_PROJECT_ID: "p" }, false)).toThrow(
      TerminalIsolationError,
    );
  });

  it("throws for Docker mode in production unconditionally — no override possible", () => {
    expect(() => assertHostShellPermitted(PROD, true)).toThrow(TerminalIsolationError);
    expect(() => assertHostShellPermitted({ RAILWAY_SERVICE_ID: "s" }, true)).toThrow(
      /Failing closed unconditionally/,
    );
  });

  it("throws for Docker mode in production even with TERMINAL_VERIFIED_ISOLATION=true", () => {
    expect(() =>
      assertHostShellPermitted({ ...PROD, TERMINAL_VERIFIED_ISOLATION: "true" }, true),
    ).toThrow(TerminalIsolationError);
  });

  it("throws for Docker mode in production regardless of any env var overrides", () => {
    const overrideEnv = {
      ...PROD,
      TERMINAL_VERIFIED_ISOLATION: "true",
      TERMINAL_USE_DOCKER: "true",
      TERMINAL_ALLOW_EXECUTION: "true",
      DOCKER_ENABLE: "true",
      ALLOW_DOCKER: "1",
    };
    expect(() => assertHostShellPermitted(overrideEnv, true)).toThrow(TerminalIsolationError);
    expect(() => assertHostShellPermitted(overrideEnv, false)).toThrow(TerminalIsolationError);
  });

  it("throws on Railway even with Docker mode and all overrides set", () => {
    expect(() =>
      assertHostShellPermitted(
        { RAILWAY_SERVICE_ID: "svc", TERMINAL_VERIFIED_ISOLATION: "true" },
        true,
      ),
    ).toThrow(TerminalIsolationError);
  });

  it("does not throw for Docker mode in local development", () => {
    expect(() => assertHostShellPermitted(DEV, true)).not.toThrow();
  });

  it("does not throw for a host shell in local development", () => {
    expect(() => assertHostShellPermitted(DEV, false)).not.toThrow();
    expect(() => assertHostShellPermitted({}, false)).toThrow(TerminalIsolationError);
    expect(() => assertHostShellPermitted({ NODE_ENV: "development" }, false)).toThrow(
      TerminalIsolationError,
    );
    expect(() =>
      assertHostShellPermitted({ ...DEV, LITT_RESOLVED_BIND_HOST: "0.0.0.0" }, false),
    ).toThrow(TerminalIsolationError);
  });

  it("carries a stable error code for callers", () => {
    try {
      assertHostShellPermitted(PROD, false);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as TerminalIsolationError).code).toBe("TERMINAL_ISOLATION_UNAVAILABLE");
    }
  });
});


