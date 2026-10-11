/**
 * Sandbox provider factory.
 *
 * Returns the appropriate provider based on TERMINAL_PROVIDER env var.
 * Currently supports:
 *   - "disabled" (default) — refuses all operations
 *   - "managed-sandbox" — Docker-based isolated sandbox provider
 *   - "e2b" — E2B cloud sandbox provider (requires E2B_API_KEY)
 *
 * Security model (owner-approved 2026-10-10, "Option A"):
 * - Host-executing providers ("managed-sandbox"/docker): Gate 1 applies.
 *   Anything not provably local resolves to DisabledProvider. There is
 *   deliberately no override variable.
 * - E2B executes EXCLUSIVELY in E2B's cloud — it never runs code on this
 *   host — so Gate 1's host-execution prohibition does not apply to it.
 *   E2B still requires explicit opt-in outside provably-local dev
 *   (E2B_HOSTED_OPT_IN=true), and production environments ALWAYS resolve
 *   to DisabledProvider. There is no flag that enables E2B in production.
 */

import type { SandboxProvider } from "../sandbox-provider";
import { DisabledProvider } from "./disabled-provider";
import { DockerSandboxProvider } from "./docker-provider";
import { E2BSandboxProvider } from "./e2b-provider";
import { isProductionLike } from "@/lib/host-execution-guard";

export type ProviderType = "disabled" | "managed-sandbox" | "e2b";

/**
 * Explicit staging flag (owner-approved). Permits the E2B cloud provider on
 * hosted non-production environments (e.g. Railway staging). Never read on
 * the production path: isProductionEnvironment() is checked first and wins.
 */
export const E2B_HOSTED_OPT_IN_VAR = "E2B_HOSTED_OPT_IN";

/**
 * True when this process runs in a production environment. Checked against
 * platform-injected markers (Railway injects RAILWAY_ENVIRONMENT_NAME;
 * Vercel injects VERCEL_ENV). No override: when true, E2B is disabled.
 */
export function isProductionEnvironment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if ((env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() === "production") return true;
  if (env.VERCEL_ENV === "production") return true;
  return false;
}

let cachedProvider: SandboxProvider | null = null;

export function getSandboxProvider(): SandboxProvider {
  if (cachedProvider) return cachedProvider;

  const providerType = (process.env.TERMINAL_PROVIDER ?? "disabled") as ProviderType;

  // E2B cloud path: no host execution happens here, so Gate 1's host ban
  // does not apply — but E2B still needs explicit opt-in on hosted
  // environments, and production is always disabled (checked first).
  if (providerType === "e2b") {
    if (isProductionEnvironment(process.env)) {
      cachedProvider = new DisabledProvider();
      return cachedProvider;
    }
    if (
      isProductionLike(process.env) &&
      process.env[E2B_HOSTED_OPT_IN_VAR] !== "true"
    ) {
      cachedProvider = new DisabledProvider();
      return cachedProvider;
    }
    // E2BSandboxProvider reads E2B_API_KEY lazily; every method throws
    // E2BNotConfiguredError (fail-closed) when it is missing or empty.
    cachedProvider = new E2BSandboxProvider();
    return cachedProvider;
  }

  // Gate 1: host-executing providers ("managed-sandbox"/docker) stay disabled
  // outside provably-local dev. No env var can override this.
  if (isProductionLike(process.env)) {
    cachedProvider = new DisabledProvider();
    return cachedProvider;
  }

  switch (providerType) {
    case "disabled":
      cachedProvider = new DisabledProvider();
      break;
    case "managed-sandbox":
      cachedProvider = new DockerSandboxProvider();
      break;
    default:
      cachedProvider = new DisabledProvider();
      break;
  }

  return cachedProvider;
}

/** Reset the cached provider (for testing). */
export function resetSandboxProvider(): void {
  cachedProvider = null;
}
