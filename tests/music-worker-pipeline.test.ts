/**
 * Music worker pipeline regression tests.
 *
 * Verifies the fixes for the "stuck at 5%" bug:
 *   1. Worker auth uses Authorization: Bearer CRON_SECRET (not x-vercel-cron-auth-token)
 *   2. Client hook no longer calls /api/music/worker directly
 *   3. Client hook uses authenticated /api/music/generations/:id/kick
 *   4. Generation route kicks the worker immediately after creation
 *   5. Provider health check rejects billing when no credentials
 *   6. Claim RPC migration exists with FOR UPDATE SKIP LOCKED
 *   7. Kick endpoint is Clerk-authenticated and ownership-scoped
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Music worker pipeline — stuck-at-5% fix", () => {
  describe("P0: Worker auth (Authorization: Bearer CRON_SECRET)", () => {
    const workerPath = path.resolve(__dirname, "../src/app/api/music/worker/route.ts");
    const source = fs.readFileSync(workerPath, "utf-8");

    it("checks Authorization: Bearer header for CRON_SECRET", () => {
      expect(source).toContain("authorization");
      expect(source).toContain("bearer");
      expect(source).toContain("Bearer");
    });

    it("uses timing-safe comparison (not ===)", () => {
      expect(source).toContain("timingSafeEqual");
      expect(source).toContain("safeEqual");
    });

    it("still supports x-worker-secret for internal calls", () => {
      expect(source).toContain("x-worker-secret");
      expect(source).toContain("MUSIC_WORKER_SECRET");
    });

    it("keeps x-vercel-cron-auth-token as backward-compat fallback only", () => {
      // The old header should still be accepted as a fallback so
      // the transition doesn't break production, but it's not the
      // primary auth mechanism.
      expect(source).toContain("x-vercel-cron-auth-token");
      expect(source).toContain("legacy");
    });
  });

  describe("P0: Client hook no longer calls /api/music/worker", () => {
    const hookPath = path.resolve(__dirname, "../src/hooks/use-music-generation.ts");
    const source = fs.readFileSync(hookPath, "utf-8");

    it("does NOT fetch /api/music/worker from the browser", () => {
      // The old code did: fetch("/api/music/worker", { method: "POST" })
      // This always got 401 because the browser can't send MUSIC_WORKER_SECRET.
      expect(source).not.toMatch(/fetch\s*\(\s*["'`]\/api\/music\/worker["'`]/);
    });

    it("uses the authenticated kick endpoint instead", () => {
      expect(source).toContain("/kick");
      expect(source).toContain("credentials: \"include\"");
    });

    it("preserves the 30-second stale detection logic", () => {
      expect(source).toContain("30_000");
      expect(source).toContain("queuedSinceRef");
      expect(source).contains("workerTriggeredRef");
    });
  });

  describe("P0: Generation route kicks worker immediately", () => {
    const routePath = path.resolve(__dirname, "../src/app/api/music/generations/route.ts");
    const source = fs.readFileSync(routePath, "utf-8");

    it("imports processPendingGenerations", () => {
      expect(source).toContain("processPendingGenerations");
    });

    it("kicks the worker after creation (not replayed)", () => {
      expect(source).toContain("void processPendingGenerations");
      expect(source).toContain("!result.replayed");
    });

    it("imports getProviderHealth for credential validation", () => {
      expect(source).toContain("getProviderHealth");
      expect(source).toContain("health.healthy");
    });
  });

  describe("P0: Provider health check", () => {
    const factoryPath = path.resolve(__dirname, "../src/lib/music/providers/factory.ts");
    const source = fs.readFileSync(factoryPath, "utf-8");

    it("has getProviderHealth function", () => {
      expect(source).toContain("getProviderHealth");
    });

    it("has ProviderHealthReport interface", () => {
      expect(source).toContain("ProviderHealthReport");
      expect(source).toContain("providerKeyPresent");
      expect(source).toContain("healthy");
    });

    it("checks API key presence per provider", () => {
      expect(source).toContain("ELEVENLABS_API_KEY");
      expect(source).toContain("MUREKA_API_KEY");
      expect(source).toContain("GEMINI_API_KEY");
    });

    it("does NOT expose secret values in the report", () => {
      // The report should only contain boolean/string metadata, not keys
      const healthMatch = source.match(/getProviderHealth[\s\S]*?^}/m);
      expect(healthMatch).toBeTruthy();
      const healthFn = healthMatch![0];
      expect(healthFn).not.toMatch(/return.*process\.env\.\w+_KEY/);
    });
  });

  describe("P0: Durable claim RPC (FOR UPDATE SKIP LOCKED)", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../supabase/migrations/20260812000001_music_claim_rpc.sql",
    );
    const source = fs.readFileSync(migrationPath, "utf-8");

    it("has claim_music_generations RPC", () => {
      expect(source).toContain("claim_music_generations");
    });

    it("uses FOR UPDATE SKIP LOCKED", () => {
      expect(source).toContain("FOR UPDATE SKIP LOCKED");
    });

    it("sets worker_id and increments attempt_count", () => {
      expect(source).toContain("worker_id");
      expect(source).toContain("attempt_count");
    });

    it("has reclaim_stale_music_generations RPC", () => {
      expect(source).toContain("reclaim_stale_music_generations");
    });

    it("has heartbeat_music_generation RPC", () => {
      expect(source).toContain("heartbeat_music_generation");
    });

    it("adds observability columns", () => {
      expect(source).toContain("worker_id TEXT");
      expect(source).toContain("attempt_count INTEGER");
      expect(source).toContain("last_heartbeat_at TIMESTAMPTZ");
      expect(source).toContain("failure_code TEXT");
    });
  });

  describe("P0: Generation service uses RPC for claiming", () => {
    const servicePath = path.resolve(__dirname, "../src/lib/music/generation-service.ts");
    const source = fs.readFileSync(servicePath, "utf-8");

    it("calls claim_music_generations RPC", () => {
      expect(source).toContain("claim_music_generations");
    });

    it("calls reclaim_stale_music_generations RPC", () => {
      expect(source).toContain("reclaim_stale_music_generations");
    });

    it("has fallback for when RPC isn't deployed", () => {
      expect(source).toContain("Fallback");
      expect(source).toContain("claimStaleGenerationsFallback");
    });

    it("generates a worker_id for each processing run", () => {
      expect(source).toContain("workerId");
      expect(source).toMatch(/worker-\$\{/);
    });
  });

  describe("P0: Authenticated kick endpoint", () => {
    const kickPath = path.resolve(
      __dirname,
      "../src/app/api/music/generations/[generationId]/kick/route.ts",
    );
    const source = fs.readFileSync(kickPath, "utf-8");

    it("exists and exports POST", () => {
      expect(source).toContain("export const POST");
    });

    it("requires Clerk authentication", () => {
      expect(source).toContain("auth(req)");
      expect(source).toContain("Unauthorized");
    });

    it("checks generation ownership (user_id match)", () => {
      expect(source).toContain("user_id");
      expect(source).toContain("user.id");
      expect(source).toContain("Generation not found");
    });

    it("does NOT accept worker secrets from the browser", () => {
      // The kick endpoint must NOT check MUSIC_WORKER_SECRET or CRON_SECRET
      // — it uses Clerk auth + ownership instead.
      // Check code only (strip comments) so documentation mentions don't fail.
      const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(codeOnly).not.toContain("MUSIC_WORKER_SECRET");
      expect(codeOnly).not.toContain("CRON_SECRET");
    });

    it("is rate limited", () => {
      expect(source).toContain("withRateLimit");
    });

    it("is idempotent (returns kicked=false for terminal states)", () => {
      expect(source).toContain("terminalStatuses");
      expect(source).toContain("kicked: false");
    });

    it("calls processPendingGenerations server-side", () => {
      expect(source).toContain("processPendingGenerations");
    });
  });

  describe("P1: Immediate processing architecture", () => {
    const routePath = path.resolve(__dirname, "../src/app/api/music/generations/route.ts");
    const source = fs.readFileSync(routePath, "utf-8");

    it("generation route triggers processing immediately (void, non-blocking)", () => {
      // The immediate kick is fire-and-forget (void) so the HTTP response
      // returns quickly while processing continues server-side.
      expect(source).toMatch(/void\s+processPendingGenerations/);
    });

    it("only kicks for new generations (not replays)", () => {
      expect(source).toContain("!result.replayed");
    });
  });
});
