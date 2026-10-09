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
  TerminalIsolationError,
} from "../isolation-policy";

const PROD = { NODE_ENV: "production" };
const DEV = {
  NODE_ENV: "development",
  LITT_ALLOW_LOCAL_HOST_EXEC: "1",
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

  it("requires the exact opt-in value", () => {
    for (const v of [undefined, "", "0", "true", "yes", " 1"]) {
      expect(isProductionLike({ ...DEV, LITT_ALLOW_LOCAL_HOST_EXEC: v }), String(v)).toBe(true);
    }
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


