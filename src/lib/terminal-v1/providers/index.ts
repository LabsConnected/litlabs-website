/**
 * Sandbox provider factory.
 *
 * Returns the appropriate provider based on TERMINAL_PROVIDER env var.
 * Currently supports:
 *   - "disabled" (default) — refuses all operations
 *   - "managed-sandbox" — Docker-based isolated sandbox provider
 *   - "e2b" — E2B cloud sandbox provider (requires E2B_API_KEY; production-like
 *     environments still resolve to "disabled" until the acceptance gate passes)
 */

import type { SandboxProvider } from "../sandbox-provider";
import { DisabledProvider } from "./disabled-provider";
import { DockerSandboxProvider } from "./docker-provider";
import { E2BSandboxProvider } from "./e2b-provider";
import { isProductionLike } from "@/lib/host-execution-guard";

export type ProviderType = "disabled" | "managed-sandbox" | "e2b";

let cachedProvider: SandboxProvider | null = null;

export function getSandboxProvider(): SandboxProvider {
  if (cachedProvider) return cachedProvider;

  // Gate 1: Docker availability is a configuration claim, not proof of
  // isolation. In a production-like environment no env var can select the
  // Docker provider; it stays disabled until verified sandbox isolation exists.
  if (isProductionLike()) {
    cachedProvider = new DisabledProvider();
    return cachedProvider;
  }

  const providerType = (process.env.TERMINAL_PROVIDER ?? "disabled") as ProviderType;

  switch (providerType) {
    case "disabled":
      cachedProvider = new DisabledProvider();
      break;
    case "managed-sandbox":
      cachedProvider = new DockerSandboxProvider();
      break;
    case "e2b":
      // E2B runs in E2B's cloud (no host execution), but production-like
      // environments are still gated to DisabledProvider above — activating
      // E2B for production execution requires explicit owner approval
      // (acceptance gate).
      cachedProvider = new E2BSandboxProvider();
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
