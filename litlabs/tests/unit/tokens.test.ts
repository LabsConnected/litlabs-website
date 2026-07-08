import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  hashToken,
  generateInviteCode,
  generateApiKey,
  extractBearerToken,
} from "@/lib/tokens";

describe("hashToken", () => {
  it("produces a SHA-256 hex digest", () => {
    const hash = hashToken("hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update("hello").digest("hex"));
  });

  it("is deterministic", () => {
    expect(hashToken("same-input")).toBe(hashToken("same-input"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("generateInviteCode", () => {
  it("matches the LIT-XXXX-XXXX format with unambiguous segment characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^LIT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      // The random segments must avoid ambiguous chars (0/O/1/I).
      const segments = code.slice(4).replace("-", "");
      expect(segments).not.toMatch(/[0O1I]/);
    }
  });

  it("is highly likely to be unique across calls", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe("generateApiKey", () => {
  it("returns a raw key, a matching hash, and a visible prefix", () => {
    const { raw, hash, prefix } = generateApiKey();
    expect(raw).toMatch(/^lit_live_[0-9a-f]{40}$/);
    expect(prefix).toMatch(/^lit_live_[0-9a-f]{4}$/);
    expect(raw.startsWith(prefix)).toBe(true);
    expect(hash).toBe(hashToken(raw));
  });

  it("generates distinct keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("extractBearerToken", () => {
  it("extracts the token from a valid Authorization header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("trims surrounding whitespace", () => {
    expect(extractBearerToken("Bearer   spaced-token  ")).toBe("spaced-token");
  });

  it("returns null for a null header", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it("returns null when the scheme is missing or wrong", () => {
    expect(extractBearerToken("abc123")).toBeNull();
    expect(extractBearerToken("Basic abc123")).toBeNull();
    expect(extractBearerToken("bearer abc123")).toBeNull();
  });

  it("returns null when the token is empty or whitespace only", () => {
    expect(extractBearerToken("Bearer ")).toBeNull();
    expect(extractBearerToken("Bearer    ")).toBeNull();
  });
});
