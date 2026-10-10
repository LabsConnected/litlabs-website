import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_CONSENT_OPEN_EVENT,
  COOKIE_CONSENT_UPDATED_EVENT,
  getConsent,
  hasConsent,
  hasConsentRecord,
  openCookiePreferences,
  saveConsent,
} from "./cookie-consent";

describe("cookie consent preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts without optional consent", () => {
    expect(getConsent()).toBeNull();
    expect(hasConsentRecord()).toBe(false);
    expect(hasConsent("essential")).toBe(true);
    expect(hasConsent("analytics")).toBe(false);
  });

  it("persists granular selections and notifies integrations", () => {
    const onChange = vi.fn();
    window.addEventListener(COOKIE_CONSENT_UPDATED_EVENT, onChange);
    try {
      const saved = saveConsent({ preferences: true, analytics: false, marketing: false });
      expect(saved.essential).toBe(true);
      expect(saved.timestamp).toBeGreaterThan(0);
      expect(getConsent()).toEqual(saved);
      expect(hasConsent("preferences")).toBe(true);
      expect(hasConsent("analytics")).toBe(false);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(COOKIE_CONSENT_UPDATED_EVENT, onChange);
    }
  });

  it("allows visitors to withdraw previously given optional consent", () => {
    saveConsent({ preferences: true, analytics: true, marketing: false });
    expect(hasConsent("analytics")).toBe(true);

    saveConsent({ preferences: false, analytics: false, marketing: false });
    expect(hasConsent("analytics")).toBe(false);
    expect(hasConsent("essential")).toBe(true);
  });

  it("fails closed for malformed or tampered browser storage", () => {
    window.localStorage.setItem("cookie-consent", "{invalid json");
    expect(getConsent()).toBeNull();

    window.localStorage.setItem("cookie-consent", JSON.stringify({
      essential: true, preferences: "true", analytics: true, marketing: true, timestamp: Date.now(),
    }));
    expect(getConsent()).toBeNull();
    expect(hasConsent("analytics")).toBe(false);
  });

  it("requires renewed consent from records created before affiliate disclosure", () => {
    window.localStorage.setItem("cookie-consent", JSON.stringify({
      essential: true, preferences: true, analytics: true, marketing: true,
      timestamp: Date.now(),
    }));
    expect(getConsent()).toBeNull();
    expect(hasConsent("marketing")).toBe(false);
  });

  it("reopens the preference interface on demand", () => {
    const listener = vi.fn();
    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, listener);
    try {
      openCookiePreferences();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, listener);
    }
  });
});
