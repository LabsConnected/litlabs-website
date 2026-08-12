// @vitest-environment node
/**
 * Behavioral tests for the Vapi recipient policy.
 *
 * These tests call the actual policy function — not source-text checks —
 * to prove that owner destinations are allowed, allowlisted destinations
 * are allowed, arbitrary destinations are rejected, and that a missing
 * owner destination fails closed.
 */

import { describe, it, expect } from "vitest";
import { resolveRecipient, parseAllowedRecipients } from "@/lib/vapi-recipient-policy";

describe("parseAllowedRecipients", () => {
  it("returns empty set for undefined/empty input", () => {
    expect(parseAllowedRecipients(undefined).size).toBe(0);
    expect(parseAllowedRecipients("").size).toBe(0);
    expect(parseAllowedRecipients("   ").size).toBe(0);
  });

  it("parses comma-separated values with whitespace trimming", () => {
    const set = parseAllowedRecipients(" +12314285411 , owner@example.com , +15555555555 ");
    expect(set.has("+12314285411")).toBe(true);
    expect(set.has("owner@example.com")).toBe(true);
    expect(set.has("+15555555555")).toBe(true);
    expect(set.size).toBe(3);
  });

  it("filters empty entries", () => {
    const set = parseAllowedRecipients("+12314285411,, ,owner@example.com,");
    expect(set.size).toBe(2);
    expect(set.has("+12314285411")).toBe(true);
    expect(set.has("owner@example.com")).toBe(true);
  });
});

describe("resolveRecipient — owner destination", () => {
  const OWNER_PHONE = "+12314285411";
  const OWNER_EMAIL = "laidbacknostress4life@gmail.com";

  it("accepts the configured owner phone", () => {
    const result = resolveRecipient(OWNER_PHONE, {
      ownerDestination: OWNER_PHONE,
      allowedRecipientsRaw: undefined,
    });
    expect(result.allowed).toBe(true);
  });

  it("accepts the configured owner email", () => {
    const result = resolveRecipient(OWNER_EMAIL, {
      ownerDestination: OWNER_EMAIL,
      allowedRecipientsRaw: undefined,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("resolveRecipient — allowlisted destinations", () => {
  const OWNER_PHONE = "+12314285411";
  const ALLOWLIST = "+15555555555,+19999999999";

  it("accepts an allowlisted phone number", () => {
    const result = resolveRecipient("+15555555555", {
      ownerDestination: OWNER_PHONE,
      allowedRecipientsRaw: ALLOWLIST,
    });
    expect(result.allowed).toBe(true);
  });

  it("accepts another allowlisted phone number", () => {
    const result = resolveRecipient("+19999999999", {
      ownerDestination: OWNER_PHONE,
      allowedRecipientsRaw: ALLOWLIST,
    });
    expect(result.allowed).toBe(true);
  });

  it("accepts an allowlisted email address", () => {
    const result = resolveRecipient("team@example.com", {
      ownerDestination: "owner@example.com",
      allowedRecipientsRaw: "team@example.com,billing@example.com",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("resolveRecipient — arbitrary destinations rejected", () => {
  const OWNER_PHONE = "+12314285411";
  const OWNER_EMAIL = "laidbacknostress4life@gmail.com";

  it("rejects an arbitrary phone number not in the allowlist", () => {
    const result = resolveRecipient("+15550000000", {
      ownerDestination: OWNER_PHONE,
      allowedRecipientsRaw: undefined,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("Rejected");
      expect(result.reason).toContain("+15550000000");
    }
  });

  it("rejects an arbitrary email not in the allowlist", () => {
    const result = resolveRecipient("attacker@evil.com", {
      ownerDestination: OWNER_EMAIL,
      allowedRecipientsRaw: undefined,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("Rejected");
      expect(result.reason).toContain("attacker@evil.com");
    }
  });

  it("rejects an arbitrary phone even when an allowlist exists", () => {
    const result = resolveRecipient("+15550000000", {
      ownerDestination: OWNER_PHONE,
      allowedRecipientsRaw: "+15555555555,+19999999999",
    });
    expect(result.allowed).toBe(false);
  });

  it("reject reason mentions the allowlist env var for operator visibility", () => {
    const result = resolveRecipient("random@example.com", {
      ownerDestination: "owner@example.com",
      allowedRecipientsRaw: undefined,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("LITTLABS_ALLOWED_RECIPIENTS");
    }
  });
});

describe("resolveRecipient — missing owner destination fails closed", () => {
  it("fails closed when owner destination is undefined", () => {
    const result = resolveRecipient("+12314285411", {
      ownerDestination: undefined,
      allowedRecipientsRaw: undefined,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("No owner destination is configured");
    }
  });

  it("fails closed when owner destination is empty string", () => {
    const result = resolveRecipient("owner@example.com", {
      ownerDestination: "",
      allowedRecipientsRaw: "owner@example.com",
    });
    // Even if the destination is in the allowlist, without a configured
    // owner the policy should fail closed — the allowlist is a supplement
    // to the owner, not a replacement.
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("No owner destination is configured");
    }
  });

  it("fails closed when owner destination is whitespace-only", () => {
    const result = resolveRecipient("+12314285411", {
      ownerDestination: "   ",
      allowedRecipientsRaw: undefined,
    });
    expect(result.allowed).toBe(false);
  });
});
