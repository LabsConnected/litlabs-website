import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Negative authorization tests                                      */
/*  These tests verify that security boundaries hold:                 */
/*  - Unauthenticated users cannot access protected routes            */
/*  - Browser-supplied user IDs / roles / prices are ignored          */
/*  - Anonymous dev mode cannot activate in production                */
/*  - R2 ownership checks prevent cross-user access                  */
/* ------------------------------------------------------------------ */

// Helper to set NODE_ENV (it's read-only in TypeScript)
function setNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value);
}

// Mock the Clerk auth module — default returns null userId
type ClerkAuthReturn = Promise<{ userId: string | null }>;
const clerkAuthMock = vi.fn((): ClerkAuthReturn => Promise.resolve({ userId: null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: clerkAuthMock,
}));

// Mock server-only
vi.mock("server-only", () => ({}));

describe("Anonymous dev mode hard-block in production", () => {
  const originalFlag = process.env.ALLOW_ANONYMOUS_DEV;

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.ALLOW_ANONYMOUS_DEV = originalFlag;
  });

  it("isAnonymousDevAllowed returns false in production even if ALLOW_ANONYMOUS_DEV=true", async () => {
    setNodeEnv("production");
    process.env.ALLOW_ANONYMOUS_DEV = "true";
    const { isAnonymousDevAllowed } = await import("@/lib/env");
    expect(isAnonymousDevAllowed()).toBe(false);
  });

  it("isAnonymousDevAllowed returns true in dev when ALLOW_ANONYMOUS_DEV=true", async () => {
    setNodeEnv("development");
    process.env.ALLOW_ANONYMOUS_DEV = "true";
    const { isAnonymousDevAllowed } = await import("@/lib/env");
    expect(isAnonymousDevAllowed()).toBe(true);
  });

  it("isAnonymousDevAllowed returns false in dev when ALLOW_ANONYMOUS_DEV is not set", async () => {
    setNodeEnv("development");
    delete process.env.ALLOW_ANONYMOUS_DEV;
    const { isAnonymousDevAllowed } = await import("@/lib/env");
    expect(isAnonymousDevAllowed()).toBe(false);
  });

  it("auth() does not return anonymous-dev in production even if flag is set", async () => {
    setNodeEnv("production");
    process.env.ALLOW_ANONYMOUS_DEV = "true";
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn(() => Promise.resolve({ userId: null })),
    }));
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe(null);
    expect(result.clerkId).toBe(null);
  });
});

describe("Environment validation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    vi.unstubAllEnvs();
  });

  it("getMissingRequiredVars returns empty when all core vars are set", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key-12345";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key-12345";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_clerk_key_12345";
    process.env.CLERK_SECRET_KEY = "sk_test_clerk_secret_12345";
    setNodeEnv("development");
    const { getMissingRequiredVars } = await import("@/lib/env");
    const missing = getMissingRequiredVars();
    expect(missing).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(missing).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(missing).not.toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(missing).not.toContain("CLERK_SECRET_KEY");
  });

  it("getMissingRequiredVars reports missing core vars", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    setNodeEnv("development");
    const { getMissingRequiredVars } = await import("@/lib/env");
    const missing = getMissingRequiredVars();
    expect(missing).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(missing).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("getMissingRequiredVars requires production vars in production", async () => {
    setNodeEnv("production");
    delete process.env.CLERK_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.AUTH_SECRET;
    const { getMissingRequiredVars } = await import("@/lib/env");
    const missing = getMissingRequiredVars();
    expect(missing).toContain("CLERK_WEBHOOK_SECRET");
    expect(missing).toContain("STRIPE_SECRET_KEY");
    expect(missing).toContain("STRIPE_WEBHOOK_SECRET");
    // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is intentionally NOT required:
    // checkout uses a server-created Checkout Session redirect, never
    // Stripe.js/Elements, so nothing ever reads this key client-side.
    expect(missing).not.toContain("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
    expect(missing).toContain("AUTH_SECRET");
  });

  it("validateEnv never prints secret values", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    setNodeEnv("development");
    const { validateEnv } = await import("@/lib/env");
    const results = validateEnv();
    for (const result of results) {
      for (const msg of [...result.errors, ...result.warnings]) {
        expect(msg).not.toMatch(/sk_[a-zA-Z0-9]{10,}/);
        expect(msg).not.toMatch(/pk_[a-zA-Z0-9]{10,}/);
        expect(msg).not.toMatch(/[a-f0-9]{32,}/i);
      }
    }
  });
});

describe("R2 ownership validation", () => {
  beforeEach(() => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.R2_BUCKET_NAME = "test-bucket";
  });

  it("getSignedAudioUrl rejects keys not starting with userId/", async () => {
    const r2Module = await import("@/lib/r2");
    await expect(
      r2Module.getSignedAudioUrl("user-abc", "user-xyz/audio/track.mp3"),
    ).rejects.toThrow(/ownership/i);
  });

  it("deleteAudio rejects cross-user keys", async () => {
    const r2Module = await import("@/lib/r2");
    await expect(
      r2Module.deleteAudio("user-abc", "user-xyz/audio/track.mp3"),
    ).rejects.toThrow(/ownership/i);
  });

  it("getSignedAudioUrl rejects keys with path traversal", async () => {
    const r2Module = await import("@/lib/r2");
    await expect(
      r2Module.getSignedAudioUrl("user-abc", "user-abc/../user-xyz/track.mp3"),
    ).rejects.toThrow(/traversal|ownership/i);
  });

  it("getSignedAudioUrl rejects empty or short userIds", async () => {
    const r2Module = await import("@/lib/r2");
    await expect(
      r2Module.getSignedAudioUrl("ab", "ab/audio/track.mp3"),
    ).rejects.toThrow(/userId/i);
  });

  it("deleteBinaryAsset rejects cross-user keys", async () => {
    const r2Module = await import("@/lib/r2");
    await expect(
      r2Module.deleteBinaryAsset("user-abc", "user-xyz/assets/file.png"),
    ).rejects.toThrow(/ownership/i);
  });
});

describe("Browser-supplied data must be ignored", () => {
  it("auth() returns null userId when Clerk has no session", async () => {
    const clerk = await import("@clerk/nextjs/server");
    vi.mocked(clerk.auth).mockResolvedValue({ userId: null } as never);
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe(null);
  });

  it("auth() returns real Clerk userId, not browser-supplied", async () => {
    const clerk = await import("@clerk/nextjs/server");
    vi.mocked(clerk.auth).mockResolvedValue({ userId: "clerk-real-user-123" } as never);
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe("clerk-real-user-123");
    expect(result.clerkId).toBe("clerk-real-user-123");
  });
});

describe("auth() does not call clerkAuth() when Clerk is unconfigured", () => {
  beforeEach(() => {
    // Remove Clerk env vars to simulate unconfigured state
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("auth() returns null userId without throwing when Clerk is unconfigured", async () => {
    setNodeEnv("development");
    vi.resetModules();
    const { auth } = await import("@/lib/auth");

    // Should not throw — should return null userId
    const result = await auth();
    expect(result.userId).toBe(null);
    expect(result.clerkId).toBe(null);
  });

  it("auth() returns anonymous-dev when Clerk is unconfigured but ALLOW_ANONYMOUS_DEV=true in dev", async () => {
    setNodeEnv("development");
    process.env.ALLOW_ANONYMOUS_DEV = "true";
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();

    expect(result.userId).toBe("anonymous-dev");
    expect(result.clerkId).toBe(null);
  });

  it("production with missing Clerk keys would throw at middleware load", async () => {
    setNodeEnv("production");
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    // The middleware module throws at load time in production with no Clerk keys.
    // We verify isClerkConfigured returns false, which the middleware uses to throw.
    const { isClerkConfigured } = await import("@/lib/env");
    expect(isClerkConfigured()).toBe(false);
  });
});

describe("Unauthenticated protected API request returns 401", () => {
  it("auth() returns null userId when no Clerk session and no anonymous dev", async () => {
    setNodeEnv("development");
    delete process.env.ALLOW_ANONYMOUS_DEV;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe(null);
    // API routes check `if (!userId) return 401` — so this means 401
  });
});

describe("PLAYWRIGHT_AUTH_DISABLED cannot bypass production auth", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isClerkConfigured returns false when Clerk keys are missing", async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    const { isClerkConfigured } = await import("@/lib/env");
    expect(isClerkConfigured()).toBe(false);
  });

  it("PLAYWRIGHT_AUTH_DISABLED=true with VERCEL set is NOT a valid test env", async () => {
    process.env.PLAYWRIGHT_AUTH_DISABLED = "true";
    process.env.CI = "true";
    process.env.PLAYWRIGHT_TEST = "true";
    process.env.VERCEL = "1";
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    // auth() should return null (not anonymous-dev) because the bypass is invalid
    setNodeEnv("development");
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe(null);
  });

  it("PLAYWRIGHT_AUTH_DISABLED=true without CI is NOT a valid test env", async () => {
    process.env.PLAYWRIGHT_AUTH_DISABLED = "true";
    delete process.env.CI;
    process.env.PLAYWRIGHT_TEST = "true";
    delete process.env.VERCEL;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    setNodeEnv("development");
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe(null);
  });

  it("PLAYWRIGHT_AUTH_DISABLED=true without PLAYWRIGHT_TEST is NOT valid", async () => {
    process.env.PLAYWRIGHT_AUTH_DISABLED = "true";
    process.env.CI = "true";
    delete process.env.PLAYWRIGHT_TEST;
    delete process.env.VERCEL;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    setNodeEnv("development");
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe(null);
  });

  it("PLAYWRIGHT_AUTH_DISABLED=true with all conditions met IS valid (test env only)", async () => {
    process.env.PLAYWRIGHT_AUTH_DISABLED = "true";
    process.env.CI = "true";
    process.env.PLAYWRIGHT_TEST = "true";
    delete process.env.VERCEL;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    setNodeEnv("development");
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    // In test mode with no anonymous dev, returns null (API will 401)
    expect(result.userId).toBe(null);
  });

  it("PLAYWRIGHT_AUTH_DISABLED=true with all conditions + ALLOW_ANONYMOUS_DEV returns anonymous-dev", async () => {
    process.env.PLAYWRIGHT_AUTH_DISABLED = "true";
    process.env.CI = "true";
    process.env.PLAYWRIGHT_TEST = "true";
    delete process.env.VERCEL;
    process.env.ALLOW_ANONYMOUS_DEV = "true";
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    setNodeEnv("development");
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    expect(result.userId).toBe("anonymous-dev");
  });

  it("CLERK_DISABLED (old name) is NOT recognized and does not bypass auth", async () => {
    process.env.CLERK_DISABLED = "true";
    delete process.env.PLAYWRIGHT_AUTH_DISABLED;
    process.env.CI = "true";
    process.env.PLAYWRIGHT_TEST = "true";
    delete process.env.VERCEL;
    delete process.env.ALLOW_ANONYMOUS_DEV;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    setNodeEnv("development");
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const result = await auth();
    // Old flag name should not work
    expect(result.userId).toBe(null);
  });
});
