/**
 * Env preflight wrapper for Next.js instrumentation hook.
 *
 * Re-exports the preflight logic from scripts/env-preflight.ts but
 * adapted for the Next.js server runtime (no require.main, no process.exit).
 */
import { validateEnv, isDeployed, getMissingRequiredVars } from "./env";

export interface PreflightResult {
  ok: boolean;
  deployed: boolean;
  missing: string[];
}

export function runPreflight(): PreflightResult {
  const deployed = isDeployed();
  const results = validateEnv();
  const missing = getMissingRequiredVars();

  const hasErrors = results.some((r) => !r.valid && r.errors.length > 0);

  if (hasErrors || missing.length > 0) {
    console.error("[env-preflight] FAILED — missing required environment variables:");
    for (const v of missing) {
      console.error(`  ✗ ${v}`);
    }
    for (const result of results) {
      for (const err of result.errors) {
        console.error(`  ✗ [${result.category}] ${err}`);
      }
    }
    return { ok: false, deployed, missing };
  }

  // Warnings only
  for (const result of results) {
    for (const warn of result.warnings) {
      console.info(`[env-preflight] ⚠ ${warn}`);
    }
  }

  console.info(`[env-preflight] OK — ${deployed ? "deployed" : "local"} environment validated`);
  return { ok: true, deployed, missing };
}
