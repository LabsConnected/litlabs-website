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
  version?: number;
}

const CONSENT_KEY = "cookie-consent";
const CONSENT_VERSION = 2; // Explicit affiliate category was added in v2.

export const COOKIE_CONSENT_OPEN_EVENT = "litt:cookie-consent-open";
export const COOKIE_CONSENT_UPDATED_EVENT = "litt:cookie-consent-updated";

export type CookieCategory = "essential" | "preferences" | "analytics" | "marketing";
export type OptionalCookieChoices = Pick<
  CookieConsentState,
  "preferences" | "analytics" | "marketing"
>;

/** Persist an explicit choice and notify any consent-aware integration. */
export function saveConsent(choices: OptionalCookieChoices): CookieConsentState {
  const value: CookieConsentState = {
    essential: true,
    preferences: choices.preferences === true,
    analytics: choices.analytics === true,
    marketing: choices.marketing === true,
    timestamp: Date.now(),
    version: CONSENT_VERSION,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(COOKIE_CONSENT_UPDATED_EVENT));
  }
  return value;
}

/** Reopen the preferences panel from any page, including the cookie policy. */
export function openCookiePreferences(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_EVENT));
  }
}

/** Returns the raw consent state from localStorage, or null if not set. */
export function getConsent(): CookieConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.preferences !== "boolean" ||
      typeof candidate.analytics !== "boolean" ||
      typeof candidate.marketing !== "boolean" ||
      candidate.version !== CONSENT_VERSION ||
      typeof candidate.timestamp !== "number" ||
      !Number.isFinite(candidate.timestamp)
    ) return null;
    return {
      essential: true,
      preferences: candidate.preferences,
      analytics: candidate.analytics,
      marketing: candidate.marketing,
      timestamp: candidate.timestamp,
      version: CONSENT_VERSION,
    };
  } catch {
    return null;
  }
}

/**
 * Check if the user has consented to a specific category.
 * "essential" is always true (cannot be withdrawn).
 * Returns false if no consent has been given yet.
 */
export function hasConsent(category: CookieCategory): boolean {
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
