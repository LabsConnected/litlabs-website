/**
 * Vitest config for integration tests that need real env vars from .env.local.
 *
 * Usage: pnpm vitest run --config vitest.integration.config.ts
 *
 * This is separate from the default vitest.config.ts so that unit tests
 * continue to use test/stub API keys and never accidentally hit real
 * Supabase or OpenRouter.
 */
import { defineConfig } from "vitest/config";
import path from "path";
import { config as loadEnv } from "dotenv";

// Load .env.local BEFORE any test modules are imported.
// supabase.ts reads NEXT_PUBLIC_SUPABASE_URL at module load time,
// so this must run before the first import of @/lib/supabase.
loadEnv({ path: ".env.local" });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/growth-engine-smoke.test.ts"],
    // Long timeouts for real LLM + DB calls.
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
