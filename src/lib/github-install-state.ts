/**
 * Secure GitHub App installation state tokens.
 *
 * The install route signs a short-lived HMAC token containing the Clerk user ID.
 * The callback route verifies the token to ensure the installation was initiated
 * by the authenticated user and not a cross-site attack.
 *
 * Required env: GITHUB_INSTALL_STATE_SECRET (server-only, 32+ chars)
 */

import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.GITHUB_INSTALL_STATE_SECRET;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface StatePayload {
  userId: string;
  expiresAt: number;
}

function getSecret(): string {
  if (!SECRET || SECRET.length < 32) {
    throw new Error(
      "GITHUB_INSTALL_STATE_SECRET must be set to a string of at least 32 characters.",
    );
  }
  return SECRET;
}

/**
 * Create a signed state token for a GitHub App installation redirect.
 * Returns a base64url-encoded string safe to use in a URL query parameter.
 */
export function createInstallState(userId: string): string {
  const payload: StatePayload = {
    userId,
    expiresAt: Date.now() + TTL_MS,
  };
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", getSecret())
    .update(body, "utf8")
    .digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify a signed state token returned by GitHub's installation callback.
 * Returns the Clerk user ID if valid and not expired, otherwise null.
 */
export function verifyInstallState(state: string): string | null {
  const dotIndex = state.indexOf(".");
  if (dotIndex === -1) return null;

  const body = state.slice(0, dotIndex);
  const sig = state.slice(dotIndex + 1);

  const expectedSig = createHmac("sha256", getSecret())
    .update(body, "utf8")
    .digest("base64url");

  try {
    if (
      !timingSafeEqual(
        Buffer.from(sig, "utf8"),
        Buffer.from(expectedSig, "utf8"),
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as StatePayload;
    if (typeof payload.userId !== "string" || typeof payload.expiresAt !== "number") {
      return null;
    }
    if (Date.now() > payload.expiresAt) return null;
    return payload.userId;
  } catch {
    return null;
  }
}
