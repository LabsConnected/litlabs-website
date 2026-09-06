/**
 * Regression test for docs/qa/production-login-recovery-20260902.md:
 * a present-but-invalid CLERK_SECRET_KEY passed every "is it set" style
 * check while sign-in was completely broken in production, because Clerk's
 * backend rejected the key at request time.
 *
 * /api/health must make a real Clerk backend call and distinguish
 * "not configured" from "configured but rejected" from "valid" — not just
 * report presence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Built at runtime, not as a contiguous literal — a secret-key-shaped
// string in test source (even an obviously fake one) trips GitHub's push
// protection secret scanner just like a real one would. This exercises
// the exact same runtime code path without ever committing a string that
// pattern-matches a live/test API key.
function fakeSecret(prefix: string, tail: string): string {
  return [prefix, tail].join("_");
}

const mockGetCount = vi.fn();

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: { getCount: mockGetCount },
  }),
}));

describe("/api/health — Clerk backend auth check", () => {
  const originalSecretKey = process.env.CLERK_SECRET_KEY;

  beforeEach(() => {
    vi.resetModules();
    mockGetCount.mockReset();
    delete process.env.CLERK_SECRET_KEY;
  });

  afterEach(() => {
    if (originalSecretKey === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = originalSecretKey;
  });

  it("reports degraded (not ok) when CLERK_SECRET_KEY is unset", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(body.checks.auth.status).toBe("degraded");
    expect(body.checks.auth.detail).toMatch(/not set/i);
    expect(mockGetCount).not.toHaveBeenCalled();
  });

  it("reports ok when the Clerk backend accepts the secret key", async () => {
    process.env.CLERK_SECRET_KEY = fakeSecret("sk_test", "valid_key_for_this_test_only");
    mockGetCount.mockResolvedValue(42);
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(body.checks.auth.status).toBe("ok");
    expect(mockGetCount).toHaveBeenCalledTimes(1);
  });

  it("reports degraded (not ok, not error/503) when the Clerk backend rejects the secret key — the exact Sept 2 failure mode", async () => {
    process.env.CLERK_SECRET_KEY = fakeSecret("sk_test", "the_reverted_invalid_key");
    mockGetCount.mockRejectedValue(new Error("Clerk: secret-key-invalid (401)"));
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(body.checks.auth.status).toBe("degraded");
    expect(body.checks.auth.detail).toMatch(/secret-key-invalid/i);
    // Overall status must reflect the failure so release-gate.yml and
    // `litt production doctor` (which treats any non-"ok" check as a
    // failure) both catch it — but must stay HTTP 200, not 503: restarting
    // the container cannot fix a bad env var, and 503 would trigger
    // Railway's restart policy and crash-loop an otherwise-healthy service.
    expect(body.status).not.toBe("ok");
    expect(res.status).toBe(200);
  });

  it("never echoes a secret-shaped value from a Clerk error message into the response", async () => {
    const configuredKey = fakeSecret("sk_test", "should_never_appear_in_output");
    const leakedInErrorMessage = fakeSecret("sk_live", "leakedvalueleakedvalueleakedvalue");
    process.env.CLERK_SECRET_KEY = configuredKey;
    mockGetCount.mockRejectedValue(
      new Error(`Unauthorized: key ${leakedInErrorMessage} was rejected`),
    );
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(configuredKey);
    expect(serialized).not.toContain(leakedInErrorMessage);
    expect(body.checks.auth.detail).toContain("REDACTED");
  });

  it("caches the Clerk backend result instead of calling it on every request", async () => {
    process.env.CLERK_SECRET_KEY = fakeSecret("sk_test", "valid_key_for_this_test_only");
    mockGetCount.mockResolvedValue(1);
    const { GET } = await import("@/app/api/health/route");
    await GET();
    await GET();
    await GET();
    expect(mockGetCount).toHaveBeenCalledTimes(1);
  });
});
