import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/terminal-v1/secret-broker";

const SECRET_KEY = "a".repeat(32);

describe("Terminal V1 — Secret Broker (encryption)", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_SECRET_KEY", SECRET_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypt and decrypt round-trip preserves value", () => {
    const plaintext = "sk-test-12345-secret-key";
    const encrypted = encryptSecret(plaintext);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypted value differs from plaintext", () => {
    const plaintext = "my-secret-api-key";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.encryptedValue).not.toContain(plaintext);
    expect(encrypted.encryptedValue).not.toBe(plaintext);
  });

  it("each encryption produces unique IV", () => {
    const plaintext = "same-value";
    const enc1 = encryptSecret(plaintext);
    const enc2 = encryptSecret(plaintext);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.encryptedValue).not.toBe(enc2.encryptedValue);
  });

  it("decryption with wrong key fails", () => {
    const plaintext = "secret-value";
    const encrypted = encryptSecret(plaintext);

    vi.stubEnv("TERMINAL_SECRET_KEY", "b".repeat(32));
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it("decryption with tampered value fails", () => {
    const plaintext = "secret-value";
    const encrypted = encryptSecret(plaintext);
    const tampered = {
      ...encrypted,
      encryptedValue: Buffer.from("tampered").toString("base64"),
    };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("decryption with tampered tag fails", () => {
    const plaintext = "secret-value";
    const encrypted = encryptSecret(plaintext);
    const tampered = {
      ...encrypted,
      tag: randomBase64(16),
    };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("encryption key must be at least 32 chars", () => {
    vi.stubEnv("TERMINAL_SECRET_KEY", "short");
    expect(() => encryptSecret("test")).toThrow("at least 32 characters");
  });

  it("encryption key must exist", () => {
    vi.stubEnv("TERMINAL_SECRET_KEY", "");
    expect(() => encryptSecret("test")).toThrow("at least 32 characters");
  });

  it("handles empty string encryption", () => {
    const encrypted = encryptSecret("");
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode values", () => {
    const plaintext = "秘密のキー-🔑";
    const encrypted = encryptSecret(plaintext);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });
});

function randomBase64(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result + "==";
}
