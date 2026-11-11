import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLANS, PLAN_LIST, formatPrice, type PlanId } from "@/config/plans";

/**
 * Pricing truth guard (ART-20261111-084).
 *
 * Canonical prices live ONLY in src/config/plans.ts (verified against live
 * Stripe): Creator Lite $9.99/mo, Creator $19.99/mo, Pro Builder $39/mo,
 * Starter free with a 1,500 one-time grant. /pricing renders them via
 * formatPrice(PLANS[id].default_price); the home page's JSON-LD offers must
 * derive from the same field so the two surfaces can never drift again.
 */

const PUBLISHED: PlanId[] = ["starter", "creator_lite", "creator_beta", "pro_builder_beta"];
const CANONICAL_OFFER_STRINGS = ["0", "9.99", "19.99", "39"];

/** The exact derivation used by the home page's planOfferPrice(). */
function homeOfferPrice(id: PlanId): string {
  return String((PLANS[id].default_price ?? 0) / 100);
}

const repoRoot = join(__dirname, "..");
function readSrc(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf-8");
}

describe("home ↔ pricing price unification", () => {
  it("publishes exactly the four canonical plans", () => {
    expect(PLAN_LIST.map((p) => p.id).sort()).toEqual([...PUBLISHED].sort());
  });

  it("PLANS carries the canonical Stripe-verified values", () => {
    expect(PLANS.starter.default_price).toBe(0);
    expect(PLANS.starter.monthlyCredits).toBe(1500);
    expect(PLANS.creator_lite.default_price).toBe(999);
    expect(PLANS.creator_lite.monthlyCredits).toBe(2500);
    expect(PLANS.creator_beta.default_price).toBe(1999);
    expect(PLANS.creator_beta.monthlyCredits).toBe(7500);
    expect(PLANS.pro_builder_beta.default_price).toBe(3900);
    expect(PLANS.pro_builder_beta.monthlyCredits).toBe(18000);
  });

  it("home JSON-LD offer strings equal /pricing's rendered prices for every plan", () => {
    for (const id of PUBLISHED) {
      const pricingRendered = formatPrice(PLANS[id].default_price); // what PricingClient renders
      const homeOffer = homeOfferPrice(id); // what the home schema emits
      const pricingNumeric = pricingRendered === "Free" ? 0 : Number(pricingRendered.replace("$", ""));
      expect(Number(homeOffer)).toBe(pricingNumeric);
    }
    expect(PUBLISHED.map(homeOfferPrice)).toEqual(CANONICAL_OFFER_STRINGS);
  });

  it("home page derives offer prices from PLANS — no hardcoded price literals", () => {
    const home = readSrc("src/app/(marketing)/page.tsx");
    for (const id of PUBLISHED) {
      expect(home).toContain(`planOfferPrice("${id}")`);
    }
    expect(home).not.toMatch(/price:\s*"(0|9\.99|19\.99|39)"/);
  });

  it("/pricing still derives every card price from PLANS", () => {
    const pricing = readSrc("src/app/(marketing)/pricing/PricingClient.tsx");
    for (const id of PUBLISHED) {
      expect(pricing).toContain(`formatPrice(PLANS.${id}.default_price)`);
    }
  });

  it("no user-facing surface carries a stale tier price ($79 tier or bare $19)", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const roots = ["src/app", "src/components"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    for (const root of roots) walk(join(repoRoot, root));
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      expect(source, file).not.toMatch(/\$79(?![\d])/);
      expect(source, file).not.toMatch(/\$19(?![.\d])/);
    }
  });
});
