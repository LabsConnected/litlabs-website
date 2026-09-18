import { describe, it, expect } from "vitest";

import {
  getHostingBackend,
  CANONICAL_HOSTING_BACKEND,
  HOSTING_TARGET,
  HOSTING_DISPLAY_NAME,
} from "./litt-hosting";

/**
 * LiTT Hosting abstraction — the canonical publish contract.
 *
 * The publishing model targets "LiTT Hosting" and never names an
 * infrastructure provider. These tests lock that in: the target value,
 * the display name, and the backend registry must stay provider-free.
 */
describe("LiTT Hosting abstraction", () => {
  it("formalizes litt-static as the canonical deploy target", () => {
    expect(HOSTING_TARGET).toBe("litt-static");
  });

  it("names the product LiTT Hosting for UI/API copy", () => {
    expect(HOSTING_DISPLAY_NAME).toBe("LiTT Hosting");
  });

  it("resolves the canonical backend by default", () => {
    expect(CANONICAL_HOSTING_BACKEND).toBe("litt-hosting");
    const backend = getHostingBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.isConfigured).toBe("function");
    expect(typeof backend.resolveBaseUrl).toBe("function");
  });

  it("throws for unknown backend names instead of guessing", () => {
    expect(() => getHostingBackend("nope")).toThrow(/Unknown hosting backend/);
  });

  it("keeps infrastructure provider names out of the model's vocabulary", () => {
    for (const text of [HOSTING_TARGET, HOSTING_DISPLAY_NAME, CANONICAL_HOSTING_BACKEND]) {
      expect(text).not.toMatch(/railway|vercel/i);
    }
  });

  it("the unconfigured reason is user-safe (no env vars, no providers)", () => {
    const backend = getHostingBackend();
    // In the test env the backend is unconfigured; the reason must be
    // safe to show a non-technical user.
    const check = backend.isConfigured();
    if (!check.ok) {
      expect(check.reason).toContain("LiTT Hosting");
      expect(check.reason).not.toMatch(/RAILWAY_|VERCEL_|railway|vercel/i);
    }
  });
});
