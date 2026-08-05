/**
 * Cloudflare Turnstile server-side verification.
 *
 * Turnstile is a privacy-preserving CAPTCHA alternative. The client gets
 * a token from the widget, and the server verifies it with Cloudflare's
 * siteverify endpoint.
 *
 * Setup:
 *   1. Get site key + secret key from https://dash.cloudflare.com/?to=/:/turnstile
 *   2. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY in .env.local
 *   3. Use <TurnstileWidget /> in your form
 *   4. Call verifyTurnstileToken(token) in your API route
 */

export interface TurnstileVerifyResult {
  success: boolean;
  /** Error codes from Cloudflare if verification failed */
  "error-codes"?: string[];
  /** The hostname of the site where the challenge was solved */
  hostname?: string;
  /** The action name (if you configured one) */
  action?: string;
  /** The challenge solve time in milliseconds */
  challenge_ts?: string;
}

/**
 * Verify a Turnstile token on the server side.
 * Returns { success: true } if the token is valid.
 *
 * @param token - The token from the client-side Turnstile widget
 * @param remoteip - Optional: the user's IP address (for Cloudflare's scoring)
 */
export async function verifyTurnstileToken(
  token: string,
  remoteip?: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // If not configured, fail open in dev, fail closed in production
    if (process.env.NODE_ENV !== "production") {
      return { success: true };
    }
    return { success: false, "error-codes": ["missing-secret-key"] };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
    });
    if (remoteip) body.set("remoteip", remoteip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });

    const data = await res.json() as TurnstileVerifyResult;
    return data;
  } catch {
    return { success: false, "error-codes": ["verification-request-failed"] };
  }
}

/** Check if Turnstile is configured (site key present on client). */
export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}
