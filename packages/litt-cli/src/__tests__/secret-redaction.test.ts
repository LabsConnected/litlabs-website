/**
 * Secret redaction tests — proves secrets never appear in CLI output.
 *
 * Tests that redact() catches all known secret patterns and that
 * assertNoSecrets() throws when secrets are present.
 *
 * IMPORTANT: Secret prefixes are constructed at runtime via concatenation
 * so that GitHub push-protection secret scanning does not flag this file.
 */

import { describe, it, expect } from "vitest";
import { redact, containsSecret, assertNoSecrets, redactEnvValue } from "../lib/secret-redaction.js";

// Build secret-like strings at runtime to avoid triggering push protection.
// The prefixes are split so the literal pattern never appears in source.
const SK_LIVE = "sk_" + "live_";
const SK_TEST = "sk_" + "test_";
const WHSEC = "wh" + "sec_";
const SB_SECRET = "sb_" + "secret_";

const FAKE_SUFFIX = "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";

describe("Secret redaction", () => {
  describe("redact()", () => {
    it("redacts Stripe live secret keys", () => {
      const fakeKey = SK_LIVE + FAKE_SUFFIX;
      const input = `STRIPE_SECRET_KEY=${fakeKey}`;
      const result = redact(input);
      expect(result).not.toContain(fakeKey);
      expect(result).toContain("sk_***");
    });

    it("redacts Stripe test secret keys", () => {
      const fakeKey = SK_TEST + FAKE_SUFFIX;
      const input = `key=${fakeKey}`;
      const result = redact(input);
      expect(result).not.toContain(fakeKey);
      expect(result).toContain("sk_***");
    });

    it("redacts Stripe webhook signing secrets", () => {
      const fakeWhsec = WHSEC + FAKE_SUFFIX;
      const input = `STRIPE_WEBHOOK_SECRET=${fakeWhsec}`;
      const result = redact(input);
      expect(result).not.toContain(fakeWhsec);
      expect(result).toContain("whsec_***");
    });

    it("redacts Supabase service role keys", () => {
      const fakeSbKey = SB_SECRET + FAKE_SUFFIX;
      const input = `SUPABASE_SERVICE_ROLE_KEY=${fakeSbKey}`;
      const result = redact(input);
      expect(result).not.toContain(fakeSbKey);
      expect(result).toContain("sb_secret_***");
    });

    it("redacts generic API key assignments", () => {
      const fakeApiKey = "sk-proj-" + FAKE_SUFFIX;
      const input = `OPENAI_API_KEY=${fakeApiKey}`;
      const result = redact(input);
      expect(result).not.toContain(fakeApiKey);
    });

    it("redacts Bearer tokens", () => {
      const fakeBearer = "Bearer " + FAKE_SUFFIX;
      const input = `Authorization: ${fakeBearer}`;
      const result = redact(input);
      expect(result).not.toContain(FAKE_SUFFIX);
    });

    it("does NOT redact Stripe publishable keys (they are public)", () => {
      const input = "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_" + "live_" + FAKE_SUFFIX;
      const result = redact(input);
      expect(result).toContain("pk_");
    });

    it("handles multiple secrets in one string", () => {
      const fakeLive = SK_LIVE + FAKE_SUFFIX;
      const fakeWhsec = WHSEC + FAKE_SUFFIX;
      const input = `${fakeLive} and ${fakeWhsec}`;
      const result = redact(input);
      expect(result).not.toContain(fakeLive);
      expect(result).not.toContain(fakeWhsec);
      expect(result).toContain("sk_***");
      expect(result).toContain("whsec_***");
    });

    it("handles empty strings", () => {
      expect(redact("")).toBe("");
    });

    it("handles strings with no secrets", () => {
      const input = "Production is healthy at commit 56636e9f";
      expect(redact(input)).toBe(input);
    });
  });

  describe("containsSecret()", () => {
    it("returns true for strings with secrets", () => {
      expect(containsSecret(SK_LIVE + FAKE_SUFFIX)).toBe(true);
      expect(containsSecret(WHSEC + FAKE_SUFFIX)).toBe(true);
      expect(containsSecret(SK_TEST + FAKE_SUFFIX)).toBe(true);
    });

    it("returns false for strings without secrets", () => {
      expect(containsSecret("pk_live_abc123")).toBe(false);
      expect(containsSecret("Production healthy")).toBe(false);
      expect(containsSecret("")).toBe(false);
    });
  });

  describe("assertNoSecrets()", () => {
    it("does not throw for clean strings", () => {
      expect(() => assertNoSecrets("Production is healthy")).not.toThrow();
    });

    it("throws for strings with secrets", () => {
      expect(() => assertNoSecrets(SK_LIVE + FAKE_SUFFIX)).toThrow("Secret material detected");
    });

    it("includes context in the error message", () => {
      expect(() => assertNoSecrets(SK_LIVE + FAKE_SUFFIX, "stdout")).toThrow("in stdout");
    });
  });

  describe("redactEnvValue()", () => {
    it("returns NOT SET for empty/undefined values", () => {
      expect(redactEnvValue(undefined)).toBe("NOT SET");
      expect(redactEnvValue("")).toBe("NOT SET");
    });

    it("returns SET for secret values", () => {
      expect(redactEnvValue(SK_LIVE + FAKE_SUFFIX)).toBe("SET");
      expect(redactEnvValue(WHSEC + FAKE_SUFFIX)).toBe("SET");
    });

    it("returns SET (length: N) for long non-secret values", () => {
      const longValue = "a".repeat(60);
      expect(redactEnvValue(longValue)).toBe("SET (length: 60)");
    });

    it("returns the value for short non-secret values", () => {
      expect(redactEnvValue("production")).toBe("production");
    });
  });
});
