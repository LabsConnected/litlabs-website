/**
 * Capability gate — local-only mode routing boundary.
 *
 * Pure function. It does not inspect environment variables or prompt text.
 *
 * localModelAvailable must be supplied by the caller.
 *
 * Rules:
 *
 * localOnly=true + local target + local model
 *   -> allow local model
 *
 * localOnly=true + remote target
 *   -> always block
 *
 * localOnly=true + local target + no local model
 *   -> block
 *
 * signed out + local target + local model
 *   -> allow local model
 *
 * signed out + local target + no local model
 *   -> block
 *
 * remote target + localOnly=false
 *   -> capability gate does not block; downstream auth applies
 */

import type { ExecutionTarget } from "./execution-target.js";

/** Returns true when the requested model path must be blocked. */
export function shouldBlockModelPath(
  signedIn: boolean | null | undefined,
  executionTarget: ExecutionTarget,
  localOnly: boolean,
  localModelAvailable = false,
): boolean {
  // Emergency/offline mode must never permit cloud/remote execution.
  if (localOnly) {
    if (executionTarget !== "local") {
      return true;
    }

    return !localModelAvailable;
  }

  // Signed-out users may use a genuinely local model without cloud auth.
  if (signedIn === false && executionTarget === "local") {
    return !localModelAvailable;
  }

  // Auth-unresolved, authenticated, and remote/non-localOnly cases continue
  // through the existing downstream provider/auth handling.
  return false;
}

/** Message shown when ordinary signed-out capability gating blocks a request. */
export const CAPABILITY_GATE_MESSAGE =
  "This request requires LiTT cloud/model access. " +
  "Sign in (`litt login`) or switch to remote mode (`/remote`) to continue.\n\n" +
  "Available without auth: /local, machine lane, slash commands, local tools.";

/** Message shown when emergency/local-only mode blocks remote/cloud access. */
export const LOCAL_ONLY_GATE_MESSAGE =
  "Local-only mode is active (LITT_LOCAL_ONLY=1). " +
  "Cloud and remote model access is blocked. " +
  "If you have a local Ollama or LM Studio server running, it remains available. " +
  "Unset LITT_LOCAL_ONLY and restart to enable remote features.\n\n" +
  "Available: /local, machine lane, slash commands, local tools.";
