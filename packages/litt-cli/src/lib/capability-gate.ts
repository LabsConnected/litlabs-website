/**
 * Capability gate — local-only mode routing boundary.
 *
 * Pure function that decides whether the model/remote path must be
 * blocked because the cockpit is in local-only (emergency/offline) mode.
 *
 * The hard gate is based on `localOnly`, NOT merely `executionTarget === "local"`.
 * This is the critical distinction:
 *
 *   executionTarget=local + localOnly=false
 *     → LOCAL is the default/preferred, but /remote can switch
 *     → model path is NOT blocked (the user may have a BYOK key)
 *
 *   executionTarget=local + localOnly=true
 *     → emergency/offline mode, model/remote hard-blocked
 *
 *   signed out + executionTarget=local + localOnly=false
 *     → local tools work, but model path needs auth
 *     → blocked (no auth = no model access)
 *
 *   signed in + executionTarget=local + localOnly=false
 *     → local tools work, model path allowed (BYOK or local provider)
 *
 * This is a CAPABILITY gate based on session/auth/local-mode state,
 * NOT a keyword matcher. It does not inspect prompt wording.
 */

import type { ExecutionTarget } from "./execution-target.js";

/**
 * Returns true when the model/remote path must be blocked.
 *
 * Parameters:
 *   signedIn        — whether the user is authenticated (null = unknown,
 *                     treated as not-blocked to avoid false positives
 *                     during the brief auth-resolution window at startup)
 *   executionTarget — "local" or "remote"
 *   localOnly       — whether emergency/offline mode is active
 *
 * Returns true (block) when:
 *   - localOnly is true (emergency mode: hard block all model/remote), OR
 *   - signedIn is explicitly false AND executionTarget is "local"
 *     (signed-out local mode: no auth = no model access)
 *
 * Returns false (allow) when:
 *   - the user is authenticated AND localOnly is false, OR
 *   - executionTarget is "remote" AND localOnly is false, OR
 *   - signedIn is null/undefined (auth state not yet resolved)
 */
export function shouldBlockModelPath(
  signedIn: boolean | null | undefined,
  executionTarget: ExecutionTarget,
  localOnly: boolean,
): boolean {
  // Emergency/offline mode: hard block regardless of auth
  if (localOnly) return true;
  // Signed-out local mode: no auth = no model access
  if (signedIn === false && executionTarget === "local") return true;
  // All other cases: allow
  return false;
}

/**
 * The user-facing message shown when the capability gate blocks a
 * model/remote request.
 */
export const CAPABILITY_GATE_MESSAGE =
  "This request requires LiTT cloud/model access. " +
  "Sign in (`litt login`) or switch to remote mode (`/remote`) to continue.\n\n" +
  "Available without auth: /local, machine lane, slash commands, local tools.";

/**
 * Message for when local-only (emergency) mode blocks a request.
 */
export const LOCAL_ONLY_GATE_MESSAGE =
  "Local-only mode is active (LITT_LOCAL_ONLY=1). " +
  "Model/cloud/remote access is blocked. " +
  "Unset LITT_LOCAL_ONLY and restart to enable remote features.\n\n" +
  "Available: /local, machine lane, slash commands, local tools.";
