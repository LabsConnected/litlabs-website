import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createTerminalTokenV1, verifyTerminalTokenV1, TerminalTokenError } from "@/lib/terminal-v1/token";

const SECRET = "a".repeat(64);

describe("Terminal V1 Token — hardened project-bound tokens", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const validInput = {
    userId: "user-aaa",
    projectId: "proj-aaa",
    workspaceId: "ws-aaa",
    sandboxId: "sbx-aaa",
  };

  it("creates a token with all required claims", () => {
    const { token, claims, expiresAt } = createTerminalTokenV1(validInput);
    expect(token).toBeTruthy();
    expect(claims.sub).toBe("user-aaa");
    expect(claims.pid).toBe("proj-aaa");
    expect(claims.wid).toBe("ws-aaa");
    expect(claims.sid).toBe("sbx-aaa");
    expect(claims.aud).toBe("littree-terminal-v1");
    expect(claims.jti).toBeTruthy();
    expect(claims.scope).toContain("terminal:connect");
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it("requires userId", () => {
    expect(() => createTerminalTokenV1({ ...validInput, userId: "" })).toThrow(/userId/);
  });

  it("requires projectId", () => {
    expect(() => createTerminalTokenV1({ ...validInput, projectId: "" })).toThrow(/projectId/);
  });

  it("requires workspaceId", () => {
    expect(() => createTerminalTokenV1({ ...validInput, workspaceId: "" })).toThrow(/workspaceId/);
  });

  it("requires sandboxId", () => {
    expect(() => createTerminalTokenV1({ ...validInput, sandboxId: "" })).toThrow(/sandboxId/);
  });

  it("verifies a valid token", () => {
    const { token } = createTerminalTokenV1(validInput);
    const claims = verifyTerminalTokenV1(token);
    expect(claims.sub).toBe("user-aaa");
    expect(claims.pid).toBe("proj-aaa");
  });

  it("rejects expired token", () => {
    const { token } = createTerminalTokenV1({ ...validInput, ttlSeconds: -10 });
    expect(() => verifyTerminalTokenV1(token)).toThrow(TerminalTokenError);
    try {
      verifyTerminalTokenV1(token);
    } catch (e) {
      expect((e as TerminalTokenError).code).toBe("TOKEN_EXPIRED");
    }
  });

  it("rejects wrong audience (tampered payload invalidates signature)", () => {
    const { token } = createTerminalTokenV1(validInput);
    // Tampering with the payload changes the base64, so the signature
    // no longer matches. The verifier catches this at the signature check.
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    payload.aud = "wrong-audience";
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[1]}`;
    expect(() => verifyTerminalTokenV1(tampered)).toThrow(TerminalTokenError);
  });

  it("rejects wrong user", () => {
    const { token } = createTerminalTokenV1(validInput);
    expect(() => verifyTerminalTokenV1(token, { userId: "user-bbb" })).toThrow(/user/i);
  });

  it("rejects wrong project", () => {
    const { token } = createTerminalTokenV1(validInput);
    expect(() => verifyTerminalTokenV1(token, { projectId: "proj-bbb" })).toThrow(/project/i);
  });

  it("rejects wrong workspace", () => {
    const { token } = createTerminalTokenV1(validInput);
    expect(() => verifyTerminalTokenV1(token, { workspaceId: "ws-bbb" })).toThrow(/workspace/i);
  });

  it("rejects wrong sandbox", () => {
    const { token } = createTerminalTokenV1(validInput);
    expect(() => verifyTerminalTokenV1(token, { sandboxId: "sbx-bbb" })).toThrow(/sandbox/i);
  });

  it("rejects missing scope", () => {
    const { token } = createTerminalTokenV1({
      ...validInput,
      scopes: ["files:read"],
    });
    expect(() => verifyTerminalTokenV1(token, { scope: "terminal:connect" })).toThrow(/scope/i);
  });

  it("rejects invalid signature", () => {
    const { token } = createTerminalTokenV1(validInput);
    const parts = token.split(".");
    const tampered = `${parts[0]}.invalid-signature`;
    expect(() => verifyTerminalTokenV1(tampered)).toThrow(TerminalTokenError);
  });

  it("rejects malformed token", () => {
    expect(() => verifyTerminalTokenV1("not-a-token")).toThrow(TerminalTokenError);
    expect(() => verifyTerminalTokenV1("a.b.c")).toThrow(TerminalTokenError);
  });
});
