/**
 * Sandbox provider factory.
 *
 * Returns the appropriate provider based on TERMINAL_PROVIDER env var.
 * Currently supports:
 *   - "disabled" (default) — refuses all operations
 *   - "managed-sandbox" — reserved for PR 2 implementation
 */

import type { SandboxProvider } from "../sandbox-provider";
import { DisabledProvider } from "./disabled-provider";

export type ProviderType = "disabled" | "managed-sandbox";

let cachedProvider: SandboxProvider | null = null;

export function getSandboxProvider(): SandboxProvider {
  if (cachedProvider) return cachedProvider;

  const providerType = (process.env.TERMINAL_PROVIDER ?? "disabled") as ProviderType;

  switch (providerType) {
    case "disabled":
      cachedProvider = new DisabledProvider();
      break;
    case "managed-sandbox":
      // PR 2 will implement the managed sandbox provider.
      // Until then, fall back to disabled.
      cachedProvider = new DisabledProvider();
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
