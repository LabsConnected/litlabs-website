/**
 * Standalone canary runner — the Phase 0 harness entry point.
 *
 * Runs the sandbox verification canary against a provider and prints
 * the JSON report. Exit code 0 means every check passed; 1 means the
 * provider is NOT verified (or could not be run).
 *
 * Usage (from the repo root):
 *
 *   pnpm exec tsx terminal-server/sandbox/run-canary.ts [--provider <name>]
 *                                                       [--beacon <url>]
 *
 * Providers registered:
 *   disabled  (default) the DisabledSandboxProvider — always fails,
 *             proving the harness ships with production unverified
 *   fake      the compliant reference fake — always passes, proving
 *             the harness itself works end to end without a vendor
 *   e2b       (Phase 1) the real E2B provider, via the config
 *             factory; requires SANDBOX_PROVIDER=e2b + E2B_API_KEY
 *             in the environment
 * Against a real provider, pass --beacon with the terminal service's
 * own internal base URL so the network-egress check also proves the
 * sandbox cannot reach the terminal service itself.
 */

import { runSandboxCanary } from "./canary";
import { createSandboxProvider, resolveSandboxRuntimeConfig } from "./config";
import { DisabledSandboxProvider } from "./disabled-provider";
import type { CanaryProvider } from "./provider";
import { createCompliantFakeProvider } from "./testing/fake-providers";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function resolveProvider(name: string): CanaryProvider {
  switch (name) {
    case "disabled":
      return new DisabledSandboxProvider();
    case "fake":
      return createCompliantFakeProvider();
    case "e2b": {
      // Phase 1: the real provider, constructed by the same factory
      // the server uses. Requires SANDBOX_PROVIDER=e2b and
      // E2B_API_KEY in the environment — the key is read by the
      // factory and never printed here.
      const config = resolveSandboxRuntimeConfig(process.env);
      if (config.providerName !== "e2b") {
        throw new Error(
          "Provider \"e2b\" is not configured: set SANDBOX_PROVIDER=e2b and E2B_API_KEY in the environment.",
        );
      }
      return createSandboxProvider(process.env);
    }
    default:
      throw new Error(
        `Unknown provider "${name}". Registered providers: disabled, fake, e2b.`,
      );
  }
}

async function main(): Promise<void> {
  const providerName = argValue("--provider") ?? "disabled";
  const beacon = argValue("--beacon");
  const provider = resolveProvider(providerName);
  const report = await runSandboxCanary(provider, {
    terminalBeaconUrl: beacon,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`canary runner failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
