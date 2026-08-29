/**
 * Capability gate — signed-out local-mode routing boundary.
 *
 * Pure function that decides whether the model/remote path must be
 * blocked because the cockpit is in signed-out local-only mode.
 *
 * The rule: signed out + local-only mode = no model/network path, period.
 *
 * This is a CAPABILITY gate based on session/auth/local-mode state,
 * NOT a keyword matcher. It does not inspect prompt wording.
 */

import type { ExecutionTarget } from "./execution-target.js";

/**
 * Returns true when the model/remote path must be blocked because the
 * cockpit is in signed-out local-only mode.
 *
 * Parameters:
 *   signedIn        — whether the user is authenticated (null = unknown,
 *                     treated as not-blocked to avoid false positives
 *                     during the brief auth-resolution window at startup)
 *   executionTarget — "local" or "remote"
 *
 * Returns true (block) when:
 *   - signedIn is explicitly false (NOT null/undefined), AND
 *   - executionTarget is "local" (LITT_LOCAL_MODE=1)
 *
 * Returns false (allow) when:
 *   - the user is authenticated (signedIn === true), OR
 *   - executionTarget is "remote" (normal cloud mode), OR
 *   - signedIn is null/undefined (auth state not yet resolved — don't
 *     block during the startup window before auth resolves)
 */
export function shouldBlockModelPath(
  signedIn: boolean | null | undefined,
  executionTarget: ExecutionTarget,
): boolean {
  return signedIn === false && executionTarget === "local";
}

/**
 * The user-facing message shown when the capability gate blocks a
 * model/remote request in signed-out local-only mode.
 */
export const CAPABILITY_GATE_MESSAGE =
  "This request requires LiTT cloud/model access. " +
  "Sign in (`litt login`) or leave local-only mode (unset LITT_LOCAL_MODE) to continue.\n\n" +
  "Available without auth: /local, machine lane, slash commands, local tools.";
