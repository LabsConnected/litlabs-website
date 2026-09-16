import { describe, it, expect } from "vitest";
import { pricingGuestCheckoutUrl } from "./pricing-guest-checkout";
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
