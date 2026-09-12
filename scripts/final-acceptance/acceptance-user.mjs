/**
 * Resolves which Clerk user id the production golden acceptance run signs
 * in as. Extracted from prod-mobile-golden.mjs so this decision can be unit
 * tested without importing Playwright, which has no Termux/Android build
 * and can't even be loaded from an on-device CLI environment.
 */

export const LEGACY_QA_USER_ID = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF";

// Clerk user ids always take this shape. Enforcing it here means a
// misconfigured secret (e.g. an API/secret key pasted in by mistake) fails
// fast with an actionable message, instead of a bare 404 from Clerk *and*
// instead of that misconfigured value ever reaching resolveAcceptanceUserId's
// caller, which persists its return value into the run's verdict.json
// artifact.
const CLERK_USER_ID_SHAPE = /^user_[A-Za-z0-9]+$/;

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

  const userId = envUserId || LEGACY_QA_USER_ID;

  if (!CLERK_USER_ID_SHAPE.test(userId)) {
    throw new Error(
      "LITT_ACCEPTANCE_USER_ID does not look like a Clerk user id (expected the " +
        `"user_..." shape, got a value of length ${userId.length}). Refusing to send ` +
        "it to Clerk or record it — check that the secret holds a Clerk USER ID, not " +
        "an API/secret key or anything else."
    );
  }

  return userId;
}
