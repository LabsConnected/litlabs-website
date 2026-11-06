/**
 * Cookie consent utilities — GDPR compliance layer.
 *
 * The consent state is stored in localStorage under the "cookie-consent" key
 * by the CookieConsent banner component. This module provides typed access
 * so that analytics, marketing, and preference scripts can check consent
 * before loading.
 *
 * IMPORTANT: Any future analytics integration (Vercel Analytics, PostHog,
 * Google Analytics, etc.) MUST call hasConsent("analytics") before loading.
 * Loading analytics scripts before the user consents is a GDPR violation.
 */

export interface CookieConsentState {
  essential: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
  timestamp: number;
}

const CONSENT_KEY = "cookie-consent";

/**
 * CustomEvent name dispatched on window when the consent record changes
 * in this tab (the CookieConsent banner writes it). Analytics loaders
 * listen for it so consent granted mid-session takes effect without a
 * reload. Cross-tab changes arrive via the `storage` event instead.
 */
export const CONSENT_CHANGED_EVENT = "litt:consent-changed";

/** Returns the raw consent state from localStorage, or null if not set. */
export function getConsent(): CookieConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CookieConsentState;
  } catch {
    return null;
  }
}

/**
 * Check if the user has consented to a specific category.
 * "essential" is always true (cannot be withdrawn).
 * Returns false if no consent has been given yet.
 */
export function hasConsent(category: keyof CookieConsentState): boolean {
  if (category === "essential") return true;
  const consent = getConsent();
  if (!consent) return false;
  return Boolean(consent[category]);
}

/** Returns true if the user has interacted with the consent banner at all. */
export function hasConsentRecord(): boolean {
  return getConsent() !== null;
}

/**
 * Gate a callback behind consent. If the user hasn't consented to the
 * given category, the callback is not called. Use this to lazily load
 * analytics scripts only after consent.
 *
 * @example
 * gateOnConsent("analytics", () => {
 *   // Load analytics or other tracking here
 *   import("some-analytics-lib").then(({ init }) => init());
 * });
 */
export function gateOnConsent(
  category: keyof CookieConsentState,
  callback: () => void,
): void {
  if (hasConsent(category)) {
    callback();
  }
}
