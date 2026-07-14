// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { verifyTerminalToken, bearerToken } from "../terminal-server/auth";

const SECRET = "a-very-long-secret-that-is-at-least-32-characters";

function signToken(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

describe("terminal-server auth", () => {
  beforeEach(() => {
    process.env.TERMINAL_AUTH_SECRET = SECRET;
  });

  it("rejects an unsigned token", () => {
    expect(() => verifyTerminalToken("not.a.token")).toThrow("Invalid terminal token");
  });

  it("rejects a missing token", () => {
    expect(() => verifyTerminalToken(undefined)).toThrow("Missing terminal token");
  });

  it("rejects a token with the wrong audience", () => {
    const token = signToken({
      sub: "u1",
      aud: "other",
      iat: Math.floor(Date.now() / 1000) - 1,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() => verifyTerminalToken(token)).toThrow("Expired or invalid terminal token");
  });

  it("verifies a valid token", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({
      sub: "user_123",
      aud: "littree-terminal",
      iat: now - 1,
      exp: now + 60,
    });
    const result = verifyTerminalToken(token);
    expect(result.sub).toBe("user_123");
  });

  it("rejects an expired token", () => {
    const token = signToken({
      sub: "user_123",
      aud: "littree-terminal",
      iat: 1000,
      exp: 1001,
    });
    expect(() => verifyTerminalToken(token)).toThrow("Expired or invalid terminal token");
  });

  it("extracts the bearer token", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("Basic abc123")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
