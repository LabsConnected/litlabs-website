/**
 * PASS 2 secret-redaction tests.
 *
 * Contract: redaction happens BEFORE persistence. For every secret shape
 * below, redactDeep(x) must satisfy !containsSecretLike(redactDeep(x)), and
 * assertNoSecrets must refuse raw secrets fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  REDACTED,
  assertNoSecrets,
  containsSecretLike,
  redactDeep,
  redactString,
} from "./redaction";

const SECRET_CASES: Array<[string, string]> = [
  ["stripe key", "sk-live-abc123DEF456ghi789jkl0"],
  ["github token", "ghp_abcdefghijklmnopqrstuvwxyz123456"],
  ["slack token", "xoxb-abcdefghijklmnopqrstuvwxyz1234"],
  ["aws key", "AKIAIOSFODNN7EXAMPLE"],
  ["bearer header", "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"],
  ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----"],
  ["key=value", "api_key=sk-live-abc123DEF456ghi789jkl0"],
  ["openrouter key", "or-abc123DEF456ghi789jkl012345"],
];

describe("secret redaction", () => {
  it.each(SECRET_CASES)("redacts %s from strings", (_name, secret) => {
    const redacted = redactString(`deploying with ${secret} now`);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain(REDACTED);
    expect(containsSecretLike(redacted)).toBe(false);
  });

  it("redacts secret-named object keys entirely", () => {
    const input = {
      stdout: "ok",
      config: {
        api_key: "sk-live-abc123DEF456ghi789jkl0",
        password: "hunter2-hunter2",
        nested: { session_token: "sess_abc123DEF456" },
      },
    };
    const redacted = redactDeep(input);
    expect(containsSecretLike(redacted)).toBe(false);
    const flat = JSON.stringify(redacted);
    expect(flat).not.toContain("sk-live-abc123DEF456ghi789jkl0");
    expect(flat).not.toContain("hunter2-hunter2");
  });

  it("redacts secrets inside arrays and mixed structures", () => {
    const input = {
      logs: ["line1", "token=sk-live-abc123DEF456ghi789jkl0", "line3"],
    };
    const redacted = redactDeep(input);
    expect(containsSecretLike(redacted)).toBe(false);
    expect(JSON.stringify(redacted)).not.toContain("sk-live-abc123DEF456ghi789jkl0");
  });

  it("leaves innocent text untouched", () => {
    const input = { message: "build finished in 12s, all 2096 tests passed" };
    expect(redactDeep(input)).toEqual(input);
  });

  it("assertNoSecrets refuses raw secrets fail-closed", () => {
    expect(() =>
      assertNoSecrets({ k: "sk-live-abc123DEF456ghi789jkl0" }, "test"),
    ).toThrow(/secret-like content detected/);
    expect(() =>
      assertNoSecrets(redactDeep({ k: "sk-live-abc123DEF456ghi789jkl0" }), "test"),
    ).not.toThrow();
  });
});
