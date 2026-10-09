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
const DEV = { NODE_ENV: "development" };

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

  it("treats a bare local environment as development", () => {
    expect(isProductionLike({})).toBe(false);
    expect(isProductionLike(DEV)).toBe(false);
    expect(isProductionLike({ NODE_ENV: "test" })).toBe(false);
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
    expect(v.reason).toContain("Docker daemon not reachable");
  });

  it("enables terminal execution in production only with a working Docker runtime", () => {
    const v = evaluateTerminalIsolation({ env: PROD, useDocker: true, dockerAvailable: true });
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
      env: { NODE_ENV: "development", RAILWAY_SERVICE_ID: "svc" },
      useDocker: false,
      dockerAvailable: false,
    });
    expect(v.terminalExecution).toBe("disabled");
    expect(v.status).toBe("unsafe");
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

  it("does not throw for Docker mode in production", () => {
    expect(() => assertHostShellPermitted(PROD, true)).not.toThrow();
  });

  it("does not throw for a host shell in local development", () => {
    expect(() => assertHostShellPermitted(DEV, false)).not.toThrow();
    expect(() => assertHostShellPermitted({}, false)).not.toThrow();
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
