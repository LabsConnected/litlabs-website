/**
 * Sandbox provider factory.
 *
 * Returns the appropriate provider based on TERMINAL_PROVIDER env var.
 * Currently supports:
 *   - "disabled" (default) — refuses all operations
 *   - "managed-sandbox" — Docker-based isolated sandbox provider
 */

import type { SandboxProvider } from "../sandbox-provider";
import { DisabledProvider } from "./disabled-provider";
import { DockerSandboxProvider } from "./docker-provider";

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
