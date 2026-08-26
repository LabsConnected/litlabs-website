/**
 * Tests proving the Supabase runtime crash fix and safe module loading.
 *
 * Originally tested src/lib/supabase-client.ts and src/hooks/useSupabaseAuth.ts
 * which were deleted when Supabase Auth was removed from the app auth path
 * (Clerk is now the sole identity provider). The remaining tests verify:
 *   - supabase.ts getSupabase() returns null instead of throwing when unconfigured
 *   - useAgentSubscription loads without crashing when Supabase env vars are missing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks */

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
}

describe("Supabase runtime crash fix", () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv({});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  // ─── src/lib/supabase.ts (existing safe wrapper — regression test) ───

  describe("supabase.ts getSupabase() (regression)", () => {
    it("returns null when URL is missing", async () => {
      setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1234567890" });
      const { getSupabase } = await import("../src/lib/supabase");
      expect(getSupabase()).toBeNull();
    });

    it("returns null when key is missing", async () => {
      setEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
      const { getSupabase } = await import("../src/lib/supabase");
      expect(getSupabase()).toBeNull();
    });

    it("returns null when key contains placeholder 'your-anon'", async () => {
      setEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "your-anon-key",
      });
      const { getSupabase } = await import("../src/lib/supabase");
      expect(getSupabase()).toBeNull();
    });

    it("returns a client when both are valid", async () => {
      setEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1234567890",
      });
      const { getSupabase } = await import("../src/lib/supabase");
      const client = getSupabase();
      expect(client).not.toBeNull();
    });
  });

  // ─── src/hooks/useAgentSubscription.ts ───────────────────────────────

  describe("useAgentSubscription safe loading", () => {
    it("module loads without crashing when Supabase env vars are missing", async () => {
      setEnv({});
      const mod = await import("../src/hooks/useAgentSubscription");
      expect(mod.useAgentSubscription).toBeDefined();
    });

    it("module loads without crashing when only URL is present", async () => {
      setEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
      const mod = await import("../src/hooks/useAgentSubscription");
      expect(mod.useAgentSubscription).toBeDefined();
    });
  });
});
