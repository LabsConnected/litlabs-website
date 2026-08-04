/**
 * Tests proving the Supabase runtime crash fix.
 *
 * Bug: src/hooks/useSupabaseAuth.ts checked the Supabase key but NOT the URL,
 * so `createClient("", key)` threw "supabaseUrl is required" and crashed the
 * homepage at runtime in environments where NEXT_PUBLIC_SUPABASE_URL was
 * missing or placeholder.
 *
 * These tests verify:
 *   - key present + URL missing → no throw, returns null
 *   - URL present + key missing → no throw, returns null
 *   - both present → client created
 *   - supabase-client.ts factory returns null instead of throwing
 *   - useSupabaseAuthHook does not crash when Supabase is unconfigured
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks */

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  // Reset all NEXT_PUBLIC_SUPABASE_* vars
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

  // ─── src/lib/supabase-client.ts ──────────────────────────────────────

  describe("supabase-client.ts createClient()", () => {
    it("returns null when URL is missing (key present)", async () => {
      setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1234567890" });
      const { createClient } = await import("../src/lib/supabase-client");
      expect(createClient()).toBeNull();
    });

    it("returns null when key is missing (URL present)", async () => {
      setEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
      const { createClient } = await import("../src/lib/supabase-client");
      expect(createClient()).toBeNull();
    });

    it("returns null when both are missing", async () => {
      setEnv({});
      const { createClient } = await import("../src/lib/supabase-client");
      expect(createClient()).toBeNull();
    });

    it("returns null when URL is too short (< 10 chars)", async () => {
      setEnv({
        NEXT_PUBLIC_SUPABASE_URL: "short",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1234567890",
      });
      const { createClient } = await import("../src/lib/supabase-client");
      expect(createClient()).toBeNull();
    });

    it("returns a client when both URL and key are present", async () => {
      setEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1234567890",
      });
      const { createClient } = await import("../src/lib/supabase-client");
      const client = createClient();
      expect(client).not.toBeNull();
      // Verify it's a Supabase-like object with .from and .auth
      expect(typeof (client as any).from).toBe("function");
      expect(typeof (client as any).auth).toBe("object");
    });
  });

  // ─── src/hooks/useSupabaseAuth.ts ────────────────────────────────────

  describe("useSupabaseAuth getSupabaseClient()", () => {
    // The hook reads env vars at module load time, so we need to set them
    // before importing the module.

    it("does NOT throw when URL is missing but key is present", async () => {
      // This is the exact bug: previously createClient("", key) threw
      setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1234567890" });

      // Should not throw
      const { useSupabaseAuthHook } = await import("../src/hooks/useSupabaseAuth");
      const { result } = renderHook(() => useSupabaseAuthHook());

      // Should settle to not-signed-in without crashing
      expect(result.current.isSignedIn).toBe(false);
    });

    it("does NOT throw when key is missing but URL is present", async () => {
      setEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });

      const { useSupabaseAuthHook } = await import("../src/hooks/useSupabaseAuth");
      const { result } = renderHook(() => useSupabaseAuthHook());

      expect(result.current.isSignedIn).toBe(false);
    });

    it("does NOT throw when both are missing", async () => {
      setEnv({});

      const { useSupabaseAuthHook } = await import("../src/hooks/useSupabaseAuth");
      const { result } = renderHook(() => useSupabaseAuthHook());

      expect(result.current.isSignedIn).toBe(false);
    });

    it("does NOT throw when URL is placeholder/short", async () => {
      setEnv({
        NEXT_PUBLIC_SUPABASE_URL: "placeholder",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-1234567890",
      });

      const { useSupabaseAuthHook } = await import("../src/hooks/useSupabaseAuth");
      const { result } = renderHook(() => useSupabaseAuthHook());

      expect(result.current.isSignedIn).toBe(false);
    });
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

  describe("useAgentSubscription Supabase guard", () => {
    it("module loads without crashing when Supabase env vars are missing", async () => {
      setEnv({});
      // Should not throw at module load time
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
