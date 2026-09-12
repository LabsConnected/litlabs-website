/**
 * Resolves which Clerk user id the production golden acceptance run signs
 * in as. Extracted from prod-mobile-golden.mjs so this decision can be unit
 * tested without importing Playwright, which has no Termux/Android build
 * and can't even be loaded from an on-device CLI environment.
 */

export const LEGACY_QA_USER_ID = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF";

/**
 * @param {{ isCI: boolean, envUserId: string | undefined }} opts
 * @returns {string}
 */
export function resolveAcceptanceUserId({ isCI, envUserId }) {
  if (isCI && !envUserId) {
    throw new Error(
      "LITT_ACCEPTANCE_USER_ID is not set. Production CI acceptance runs must " +
        "receive their configured QA user explicitly via the LITT_ACCEPTANCE_USER_ID " +
        "repository secret — refusing to silently fall back to the hard-coded legacy " +
        "QA user, which no longer resolves in Clerk (sign_in_tokens 404)."
    );
  }
  return envUserId || LEGACY_QA_USER_ID;
}
