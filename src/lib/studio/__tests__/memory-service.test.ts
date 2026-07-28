import { describe, it, expect } from "vitest";

// Test the secret detection logic directly (not the Supabase-dependent functions)
// We replicate the patterns here to test the detection without importing the module
// (which pulls in supabase and supermemory).
//
// NOTE: Fake secrets are constructed dynamically to avoid triggering GitHub's
// secret scanner on test fixtures.

const SECRET_PATTERNS = [
  /(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{20,}/i,
  /gh[pousr]_[A-Za-z0-9]{36,}/i,
  /github_pat_[A-Za-z0-9_]{82,}/i,
  /AIza[a-zA-Z0-9_\-]{35}/i,
  /eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/i,
  /xox[baprs]-[a-zA-Z0-9-]+/i,
  /\b(?:password|passwd|pwd|secret|token|api_key|apikey|private_key)\s*[:=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /supabase.*service.*role.*key/i,
  /NEXT_PUBLIC_SUPABASE_ANON_KEY/i,
  /CLERK_SECRET_KEY/i,
  /STRIPE_SECRET_KEY/i,
];

function containsSecrets(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

function normalizeDedupeKey(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

// Build fake secrets at runtime to avoid triggering GitHub secret scanning
const fakeStripeLive = ["sk", "live", "abc123def456ghi789jkl012mno345pqr"].join("_");
const fakeStripeTest = ["pk", "test", "abc123def456ghi789jkl012mno345pqr"].join("_");
const fakeGithubPat = ["ghp", "1234567890abcdefghijklmnopqrstuvwxyz123456"].join("_");
const fakeGithubFine = ["github_pat", "11ABCDabcdEF1234567890_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd"].join("_");
const fakeGoogleKey = "AIza" + "SyA1234567890_-abcdefghijklmnopqrstuvwxyz";
const fakeJwt = "eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP-xJ_lLxI3yBpQM";
const fakeSlack = "xoxb" + "-1234567890-abcdef";

describe("memory-service (secret detection)", () => {
  it("blocks Stripe secret keys", () => {
    expect(containsSecrets(fakeStripeLive)).toBe(true);
    expect(containsSecrets(fakeStripeTest)).toBe(true);
  });

  it("blocks GitHub tokens", () => {
    expect(containsSecrets(fakeGithubPat)).toBe(true);
    expect(containsSecrets(fakeGithubFine)).toBe(true);
  });

  it("blocks Google API keys", () => {
    expect(containsSecrets(fakeGoogleKey)).toBe(true);
  });

  it("blocks JWT tokens", () => {
    expect(containsSecrets(fakeJwt)).toBe(true);
  });

  it("blocks Slack tokens", () => {
    expect(containsSecrets(fakeSlack)).toBe(true);
  });

  it("blocks explicit password assignments", () => {
    expect(containsSecrets("password: mySecretPass123")).toBe(true);
    expect(containsSecrets("api_key=sk_1234567890abcdef")).toBe(true);
  });

  it("blocks private key headers", () => {
    expect(containsSecrets("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecrets("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
  });

  it("blocks Supabase/Clerk/Stripe env var references", () => {
    expect(containsSecrets("SUPABASE_SERVICE_ROLE_KEY=eyJ...")).toBe(true);
    expect(containsSecrets("CLERK_SECRET_KEY=sk_test_...")).toBe(true);
    expect(containsSecrets("STRIPE_SECRET_KEY=sk_live_...")).toBe(true);
  });

  it("does NOT block normal conversation content", () => {
    expect(containsSecrets("User: Can you help me fix the auth flow?")).toBe(false);
    expect(containsSecrets("LiTT: I'll check the JWT expiration logic.")).toBe(false);
    expect(containsSecrets("The project uses Next.js with Tailwind CSS.")).toBe(false);
  });

  it("does NOT block technical discussion about keys", () => {
    expect(containsSecrets("We should rotate the API keys regularly.")).toBe(false);
    expect(containsSecrets("Make sure to never commit secrets to the repo.")).toBe(false);
  });
});

describe("memory-service (dedupe key normalization)", () => {
  it("normalizes whitespace", () => {
    expect(normalizeDedupeKey("  Hello   World  ")).toBe("hello world");
  });

  it("converts to lowercase", () => {
    expect(normalizeDedupeKey("HELLO WORLD")).toBe("hello world");
  });

  it("truncates to 200 characters", () => {
    const long = "a".repeat(300);
    expect(normalizeDedupeKey(long)).toHaveLength(200);
  });

  it("produces consistent keys for same content with different formatting", () => {
    expect(normalizeDedupeKey("User:  Fix   the bug")).toBe(normalizeDedupeKey("user: fix the bug"));
  });
});
