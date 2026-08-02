import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { QuotaService, QuotaExceededError, getQuotaTier, QUOTA_TIERS } from "@/lib/terminal-v1/quota-service";

const SECRET = "a".repeat(64);

// Mock Supabase client
function createMockSupabase() {
  const mockTable = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };

  const client = {
    from: vi.fn(() => mockTable),
  };

  return { client, mockTable };
}

function mockUsageRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    usage_id: "usage-1",
    user_id: "user-a",
    billing_period: "2026-08",
    sandbox_hours: 0,
    storage_gb_hours: 0,
    preview_port_hours: 0,
    max_concurrent_sandboxes: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Terminal V1 — Quota Service", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
    vi.stubEnv("TERMINAL_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // ─── Quota tier tests ──────────────────────────────────────────

  it("free tier has correct limits", () => {
    const tier = getQuotaTier("free");
    expect(tier.maxConcurrentSandboxes).toBe(1);
    expect(tier.maxMonthlyHours).toBe(10);
    expect(tier.maxStorageGB).toBe(1);
  });

  it("pro tier has correct limits", () => {
    const tier = getQuotaTier("pro");
    expect(tier.maxConcurrentSandboxes).toBe(3);
    expect(tier.maxMonthlyHours).toBe(100);
  });

  it("owner tier has high limits", () => {
    const tier = getQuotaTier("owner");
    expect(tier.maxConcurrentSandboxes).toBe(20);
    expect(tier.maxMonthlyHours).toBe(9999);
  });

  it("unknown tier falls back to free", () => {
    const tier = getQuotaTier("nonexistent");
    expect(tier.name).toBe("free");
  });

  it("QUOTA_TIERS has all expected tiers", () => {
    expect(Object.keys(QUOTA_TIERS)).toContain("free");
    expect(Object.keys(QUOTA_TIERS)).toContain("pro");
    expect(Object.keys(QUOTA_TIERS)).toContain("team");
    expect(Object.keys(QUOTA_TIERS)).toContain("owner");
  });

  // ─── Quota enforcement tests ───────────────────────────────────

  it("checkCanCreateSandbox passes when under limits", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: mockUsageRow({ sandbox_hours: 5 }),
      error: null,
    });

    const service = new QuotaService(client as never);
    await expect(
      service.checkCanCreateSandbox("user-a", "free", 0),
    ).resolves.toBeUndefined();
  });

  it("checkCanCreateSandbox throws on concurrent limit", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: mockUsageRow(),
      error: null,
    });

    const service = new QuotaService(client as never);
    await expect(
      service.checkCanCreateSandbox("user-a", "free", 1),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("checkCanCreateSandbox throws on monthly hours limit", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: mockUsageRow({ sandbox_hours: 10 }),
      error: null,
    });

    const service = new QuotaService(client as never);
    await expect(
      service.checkCanCreateSandbox("user-a", "free", 0),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("pro tier allows 3 concurrent sandboxes", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: mockUsageRow({ sandbox_hours: 50 }),
      error: null,
    });

    const service = new QuotaService(client as never);
    await expect(
      service.checkCanCreateSandbox("user-a", "pro", 2),
    ).resolves.toBeUndefined();
  });

  it("pro tier throws at 3 concurrent", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: mockUsageRow(),
      error: null,
    });

    const service = new QuotaService(client as never);
    await expect(
      service.checkCanCreateSandbox("user-a", "pro", 3),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("owner tier allows 20 concurrent", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: mockUsageRow({ sandbox_hours: 100 }),
      error: null,
    });

    const service = new QuotaService(client as never);
    await expect(
      service.checkCanCreateSandbox("user-a", "owner", 19),
    ).resolves.toBeUndefined();
  });

  // ─── QuotaExceededError ────────────────────────────────────────

  it("QuotaExceededError has correct code", () => {
    const err = new QuotaExceededError("test", "CONCURRENT_LIMIT");
    expect(err.code).toBe("CONCURRENT_LIMIT");
    expect(err.name).toBe("QuotaExceededError");
    expect(err).toBeInstanceOf(Error);
  });
});
