/**
 * Device tool wiring — merges the android.* and dex.* tool families
 * into a single ToolEntry map for the session's ToolRegistry.
 *
 * Construction is side-effect free: the AndroidPolicy provider reads
 * android.json lazily (1s cache) inside each handler call, so creating
 * the entries never touches the filesystem and policy edits take
 * effect without a restart.
 */

import { setAdbTargetValidator, type ToolEntry } from "@litt/agent-core";
import { validateAdbTarget } from "./android/boundary.js";
import { buildAndroidToolEntries } from "./android/tools.js";
import { buildDexToolEntries } from "./dex/tools.js";
import { loadAndroidPolicy, type AndroidPolicy } from "./android/device-registry.js";
import { getLittHome } from "./config.js";

// Register the shared device-identity boundary at module load. Every
// device-targeting `adb` command that reaches runCommand() — project.run,
// /local machine lane, litt run — is checked against the allowlist.
setAdbTargetValidator((args, shell) => validateAdbTarget(args, shell));

let policyCache: { at: number; policy: AndroidPolicy } | null = null;

/** Shared lazy policy provider — 1s cache across all device tools. */
export function devicePolicyProvider(): AndroidPolicy {
  const now = Date.now();
  if (!policyCache || now - policyCache.at > 1_000) {
    policyCache = { at: now, policy: loadAndroidPolicy({ littHome: getLittHome() }) };
  }
  return policyCache.policy;
}

/** All device tool entries (android.* + dex.*). */
export function buildDeviceToolEntries(): Record<string, ToolEntry> {
  return {
    ...buildAndroidToolEntries({ policyProvider: devicePolicyProvider }),
    ...buildDexToolEntries({ policyProvider: devicePolicyProvider }),
  };
}
