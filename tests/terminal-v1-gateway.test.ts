import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { gatewayErrorToStatus } from "@/lib/terminal-v1/gateway";

const SECRET = "a".repeat(64);

describe("Terminal V1 Gateway — error mapping", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("FEATURE_DISABLED maps to 503", () => {
    const { status, message } = gatewayErrorToStatus("FEATURE_DISABLED");
    expect(status).toBe(503);
    expect(message).toContain("disabled");
  });

  it("Missing token or sandboxId maps to 400", () => {
    const { status } = gatewayErrorToStatus("Missing token or sandboxId");
    expect(status).toBe(400);
  });

  it("TOKEN_EXPIRED maps to 401", () => {
    const { status } = gatewayErrorToStatus("TOKEN_EXPIRED");
    expect(status).toBe(401);
  });

  it("TOKEN_INVALID maps to 401", () => {
    const { status } = gatewayErrorToStatus("TOKEN_INVALID");
    expect(status).toBe(401);
  });

  it("TOKEN_WRONG_USER maps to 403", () => {
    const { status } = gatewayErrorToStatus("TOKEN_WRONG_USER");
    expect(status).toBe(403);
  });

  it("TOKEN_WRONG_PROJECT maps to 403", () => {
    const { status } = gatewayErrorToStatus("TOKEN_WRONG_PROJECT");
    expect(status).toBe(403);
  });

  it("TOKEN_WRONG_SANDBOX maps to 403", () => {
    const { status } = gatewayErrorToStatus("TOKEN_WRONG_SANDBOX");
    expect(status).toBe(403);
  });

  it("TOKEN_MISSING_SCOPE maps to 403", () => {
    const { status } = gatewayErrorToStatus("TOKEN_MISSING_SCOPE");
    expect(status).toBe(403);
  });

  it("generic error maps to 401", () => {
    const { status } = gatewayErrorToStatus("Unauthorized");
    expect(status).toBe(401);
  });
});
