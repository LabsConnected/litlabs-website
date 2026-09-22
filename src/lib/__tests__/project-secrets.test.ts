/**
 * project-secrets validation + fingerprint tests.
 *
 * Run: npx vitest run src/lib/__tests__/project-secrets.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  isValidSecretName,
  validateSecretInput,
  fingerprintSecretValue,
  maskFingerprint,
  MAX_SECRET_VALUE_LENGTH,
  CLERK_SECRET_FIELDS,
} from "../project-secrets";

describe("isValidSecretName", () => {
  it("accepts UPPER_SNAKE names", () => {
    expect(isValidSecretName("CLERK_SECRET_KEY")).toBe(true);
    expect(isValidSecretName("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")).toBe(true);
    expect(isValidSecretName("A1_B2")).toBe(true);
  });

  it("rejects lowercase, spaces, dashes, empty, and overlong names", () => {
    expect(isValidSecretName("clerk_secret_key")).toBe(false);
    expect(isValidSecretName("CLERK SECRET")).toBe(false);
    expect(isValidSecretName("CLERK-SECRET")).toBe(false);
    expect(isValidSecretName("")).toBe(false);
    expect(isValidSecretName("A".repeat(65))).toBe(false);
    expect(isValidSecretName("1ABC")).toBe(false);
  });
});

describe("validateSecretInput", () => {
  it("accepts a valid name/value pair and trims the name", () => {
    const r = validateSecretInput("  CLERK_SECRET_KEY  ", "sk_live_abc");
    expect(r).toEqual({ ok: true, name: "CLERK_SECRET_KEY", value: "sk_live_abc" });
  });

  it("rejects bad names, empty values, and oversized values", () => {
    expect(validateSecretInput("bad-name", "v").ok).toBe(false);
    expect(validateSecretInput("OK_NAME", "").ok).toBe(false);
    expect(validateSecretInput("OK_NAME", "   ").ok).toBe(false);
    expect(validateSecretInput("OK_NAME", "x".repeat(MAX_SECRET_VALUE_LENGTH + 1)).ok).toBe(false);
    expect(validateSecretInput("OK_NAME", 123).ok).toBe(false);
  });
});

describe("fingerprintSecretValue", () => {
  it("is deterministic and never contains the value", () => {
    const value = "sk_live_super_secret_value_123";
    const fp = fingerprintSecretValue(value);
    expect(fp).toBe(fingerprintSecretValue(value));
    expect(fp).toHaveLength(8);
    expect(fp).not.toContain(value);
    expect(value).not.toContain(fp);
  });

  it("changes when the value changes", () => {
    expect(fingerprintSecretValue("a")).not.toBe(fingerprintSecretValue("b"));
  });
});

describe("maskFingerprint", () => {
  it("renders the masked display form", () => {
    expect(maskFingerprint("a1b2c3d4")).toBe("••••a1b2c3d4");
  });
});

describe("CLERK_SECRET_FIELDS", () => {
  it("covers exactly the two keys the preview runtime needs", () => {
    expect(CLERK_SECRET_FIELDS.map((f) => f.name)).toEqual([
      "CLERK_SECRET_KEY",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ]);
  });
});
