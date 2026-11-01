// @vitest-environment node
/**
 * requireOwnerAccess — the server-side gate behind /admin/* and /owner.
 *
 * Regression coverage for removing client-side hardcoded admin checks
 * ("user_litbit", NEXT_PUBLIC_ADMIN_USER_ID): authorization now happens
 * in a server layout before any client component renders.
 *
 *   - unauthenticated callers get notFound() (404, same as a nonexistent route)
 *   - non-owner signed-in users get notFound()
 *   - the owner (LITTLABS_VAPI_OWNER_CLERK_ID) passes
 *   - additional admins (ADMIN_CLERK_IDS) pass
 *   - when neither env var is set, everyone is denied (fail closed)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));

const { requireOwnerAccess } = await import("@/lib/require-owner");

const OWNER_ID = "user_owner_clerk_id_0001";
const ADMIN_ID = "user_admin_clerk_id_0002";
const MEMBER_ID = "user_random_clerk_id_9999";

const savedEnv = {
  LITTLABS_VAPI_OWNER_CLERK_ID: process.env.LITTLABS_VAPI_OWNER_CLERK_ID,
  ADMIN_CLERK_IDS: process.env.ADMIN_CLERK_IDS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("requireOwnerAccess", () => {
  it("404s unauthenticated callers", async () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(requireOwnerAccess()).rejects.toThrow(/404/);
  });

  it("404s signed-in non-owners", async () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    delete process.env.ADMIN_CLERK_IDS;
    mocks.auth.mockResolvedValue({ userId: MEMBER_ID });
    await expect(requireOwnerAccess()).rejects.toThrow(/404/);
  });

  it("returns the userId for the owner", async () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    delete process.env.ADMIN_CLERK_IDS;
    mocks.auth.mockResolvedValue({ userId: OWNER_ID });
    await expect(requireOwnerAccess()).resolves.toBe(OWNER_ID);
  });

  it("returns the userId for additional admins", async () => {
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    process.env.ADMIN_CLERK_IDS = `${ADMIN_ID}, ${OWNER_ID}`;
    mocks.auth.mockResolvedValue({ userId: ADMIN_ID });
    await expect(requireOwnerAccess()).resolves.toBe(ADMIN_ID);
  });

  it("denies everyone when owner env vars are unset", async () => {
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    delete process.env.ADMIN_CLERK_IDS;
    mocks.auth.mockResolvedValue({ userId: OWNER_ID });
    await expect(requireOwnerAccess()).rejects.toThrow(/404/);
  });
});

// Fail-closed deployment guard (src/lib/env.ts): a deployed production
// environment with no owner identity var fails env validation so the
// release gate blocks the deploy; local dev only warns so `pnpm dev`
// still starts without the owner configured.
describe("owner-identity deploy guard", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
    VERCEL: process.env.VERCEL,
  };
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("local dev warns but stays valid when no owner var is set", async () => {
    const { validateEnv } = await import("@/lib/env");
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.VERCEL;
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    delete process.env.ADMIN_CLERK_IDS;
    const admin = validateEnv().find((r) => r.category === "admin")!;
    expect(admin.valid).toBe(true);
    expect(admin.warnings.length).toBeGreaterThan(0);
  });

  it("deployed production fails closed when no owner var is set", async () => {
    const { validateEnv } = await import("@/lib/env");
    vi.stubEnv("NODE_ENV", "production");
    process.env.RAILWAY_ENVIRONMENT = "production";
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    delete process.env.ADMIN_CLERK_IDS;
    const admin = validateEnv().find((r) => r.category === "admin")!;
    expect(admin.valid).toBe(false);
    expect(admin.errors.length).toBeGreaterThan(0);
  });

  it("deployed production passes with LITTLABS_VAPI_OWNER_CLERK_ID", async () => {
    const { validateEnv } = await import("@/lib/env");
    vi.stubEnv("NODE_ENV", "production");
    process.env.RAILWAY_ENVIRONMENT = "production";
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    const admin = validateEnv().find((r) => r.category === "admin")!;
    expect(admin.valid).toBe(true);
    expect(admin.errors).toHaveLength(0);
  });
});
