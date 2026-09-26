import { describe, it, expect, beforeEach } from "vitest";
import {
  pricingGuestCheckoutUrl,
  savePendingPlanCheckout,
  takePendingPlanCheckout,
} from "./pricing-guest-checkout";
import { getSafeRedirectUrl } from "./safe-redirect-url";

describe("pricingGuestCheckoutUrl", () => {
  it("sends guests to sign-in with the redirect_url param (not the dropped `redirect` param)", () => {
    const url = pricingGuestCheckoutUrl();
    expect(url.startsWith("/sign-in?")).toBe(true);
    const params = new URL(url, "https://www.litlabs.net").searchParams;
    expect(params.get("redirect_url")).toBe("/pricing");
    expect(params.get("redirect")).toBeNull();
  });

  it("the return path survives the same-origin redirect validator", () => {
    const url = pricingGuestCheckoutUrl();
    const params = new URL(url, "https://www.litlabs.net").searchParams;
    // This is exactly what /sign-in does with the param after the fix.
    expect(getSafeRedirectUrl(params.get("redirect_url"))).toBe("/pricing");
  });
});

describe("pending plan checkout (resume after sign-in)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("remembers the picked plan across the sign-in redirect", () => {
    savePendingPlanCheckout("creator_beta");
    expect(takePendingPlanCheckout()).toBe("creator_beta");
  });

  it("take is read-once: a second take returns null", () => {
    savePendingPlanCheckout("pro_builder_beta");
    expect(takePendingPlanCheckout()).toBe("pro_builder_beta");
    expect(takePendingPlanCheckout()).toBeNull();
  });

  it("returns null when the visitor never picked a plan", () => {
    expect(takePendingPlanCheckout()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(() => savePendingPlanCheckout("creator_beta")).not.toThrow();
      expect(takePendingPlanCheckout()).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });
});
