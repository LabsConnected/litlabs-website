/**
 * Environment preflight — run at startup to fail fast on missing config.
 *
 * Usage:
 *   npx tsx scripts/env-preflight.ts
 *
 * Or import in a server context:
 *   import { runPreflight } from "@/scripts/env-preflight";
 *   runPreflight();
 *
 * This replaces the "discover at runtime" pattern where missing env vars
 * cause confusing 500s deep in API routes. Instead, the app refuses to
 * start with a clear, categorized report of what's missing.
 */
import { validateEnv, isDeployed, getMissingRequiredVars } from "../src/lib/env";

export interface PreflightResult {
  ok: boolean;
  deployed: boolean;
  results: ReturnType<typeof validateEnv>;
  missing: string[];
}

export function runPreflight(): PreflightResult {
  const deployed = isDeployed();
  const results = validateEnv();
  const missing = getMissingRequiredVars();

  const hasErrors = results.some((r) => !r.valid && r.errors.length > 0);

  if (hasErrors || missing.length > 0) {
    console.error("");
    console.error("╔════════════════════════════════════════════════════════════╗");
    console.error("║  ENVIRONMENT PREFLIGHT FAILED                              ║");
    console.error("╚════════════════════════════════════════════════════════════╝");
    console.error("");
    console.error(`  Environment: ${deployed ? "DEPLOYED (production)" : "local/development"}`);
    console.error("");

    for (const result of results) {
      if (result.errors.length > 0) {
        console.error(`  [${result.category}] ERRORS:`);
        for (const err of result.errors) {
          console.error(`    ✗ ${err}`);
        }
      }
      if (result.warnings.length > 0) {
        const prefix = result.valid ? "WARNINGS:" : "(also)";
        console.error(`  [${result.category}] ${prefix}`);
        for (const warn of result.warnings) {
          console.error(`    ⚠ ${warn}`);
        }
      }
    }

    if (missing.length > 0) {
      console.error("");
      console.error("  Missing required variables:");
      for (const v of missing) {
        console.error(`    ✗ ${v}`);
      }
    }

    console.error("");
    console.error("  Fix: set the missing env vars in your deployment config or .env.local");
    console.error("");

    return { ok: false, deployed, results, missing };
  }

  // Print warnings only (no errors)
  const hasWarnings = results.some((r) => r.warnings.length > 0);
  if (hasWarnings) {
    console.info("[env-preflight] Warnings (non-blocking):");
    for (const result of results) {
      for (const warn of result.warnings) {
        console.info(`  ⚠ ${warn}`);
      }
    }
  }

  console.info(`[env-preflight] OK — ${deployed ? "deployed" : "local"} environment validated`);
  return { ok: true, deployed, results, missing };
}

// CLI entry point
if (require.main === module) {
  const result = runPreflight();
  if (!result.ok) {
    process.exit(1);
  }
}
