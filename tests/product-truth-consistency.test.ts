import { describe, it, expect } from "vitest";
import {
  PRODUCT_IDENTITY,
  CORE_PERSONALITIES,
  CORE_PERSONALITY_COUNT,
  PLAN_CONTRACTS,
  LITTBITS_TERMINOLOGY,
  BANNED_PHRASES,
  DAILY_LITTBITS_ENABLED,
  CREDIT_PACKS_ENABLED,
  STRIPE_AUTOMATIC_TAX_ENABLED,
  VERIFIED_STRIPE_PLANS,
  VERIFIED_PREMIUM_AGENTS,
  LEGACY_STRIPE_PRODUCTS,
} from "@/config/product-truth";
import { PLANS } from "@/config/plans";
import { AGENT_DEFINITIONS, CORE_PERSONALITIES as REGISTRY_CORE } from "@/lib/agent-registry";

describe("Product-truth consistency", () => {
  describe("Product identity", () => {
    it("brand is LiTTree LabStudios", () => {
      expect(PRODUCT_IDENTITY.brand).toBe("LiTTree LabStudios");
    });

    it("domain is litlabs.net", () => {
      expect(PRODUCT_IDENTITY.domain).toBe("litlabs.net");
    });

    it("definition includes 'creative operating system' and 'social creator platform'", () => {
      expect(PRODUCT_IDENTITY.definition).toContain("creative operating system");
      expect(PRODUCT_IDENTITY.definition).toContain("social creator platform");
    });

    it("core promise is 'Bring the idea. LiTT helps you build the rest.'", () => {
      expect(PRODUCT_IDENTITY.corePromise).toBe("Bring the idea. LiTT helps you build the rest.");
    });
  });

  describe("Agent model", () => {
    it("has exactly 2 core personalities (LiTT and Spark)", () => {
      expect(CORE_PERSONALITY_COUNT).toBe(2);
      expect(Object.keys(CORE_PERSONALITIES).sort()).toEqual(["litt", "spark"]);
    });

    it("registry CORE_PERSONALITIES matches contract", () => {
      expect(REGISTRY_CORE).toHaveLength(2);
      expect(REGISTRY_CORE.map((a) => a.id).sort()).toEqual(["litt", "spark"]);
    });

    it("AGENT_DEFINITIONS includes core + internal specialists", () => {
      // 2 core + 5 internal = 7
      expect(AGENT_DEFINITIONS).toHaveLength(7);
    });

    it("LiTT can control terminal, files, git, deployment", () => {
      expect(CORE_PERSONALITIES.litt.canControlTerminal).toBe(true);
      expect(CORE_PERSONALITIES.litt.canControlFiles).toBe(true);
      expect(CORE_PERSONALITIES.litt.canControlGit).toBe(true);
      expect(CORE_PERSONALITIES.litt.canControlDeployment).toBe(true);
    });

    it("Spark cannot control terminal, files, git, deployment", () => {
      expect(CORE_PERSONALITIES.spark.canControlTerminal).toBe(false);
      expect(CORE_PERSONALITIES.spark.canControlFiles).toBe(false);
      expect(CORE_PERSONALITIES.spark.canControlGit).toBe(false);
      expect(CORE_PERSONALITIES.spark.canControlDeployment).toBe(false);
    });
  });

  describe("Pricing — Founder", () => {
    it("Founder price is $149 (14900 cents)", () => {
      expect(PLANS.founder.monthlyPriceCents).toBe(14900);
      expect(PLAN_CONTRACTS.founder.priceCents).toBe(14900);
    });

    it("Founder is NOT $49", () => {
      expect(PLANS.founder.monthlyPriceCents).not.toBe(4900);
    });

    it("Founder name is 'Founding Member' (not 'Founding Supporter')", () => {
      expect(PLANS.founder.name).toBe("Founding Member");
      expect(PLAN_CONTRACTS.founder.name).toBe("Founding Member");
    });

    it("Founder has no monthly credits", () => {
      expect(PLANS.founder.monthlyCredits).toBe(0);
      expect(PLAN_CONTRACTS.founder.credits).toBe(0);
    });

    it("Founder checkout is disabled", () => {
      expect(PLANS.founder.enabled).toBe(false);
      expect(PLAN_CONTRACTS.founder.checkoutEnabled).toBe(false);
    });

    it("Founder features do not mention six months, $49, or credit-pack discounts", () => {
      const features = PLANS.founder.features.join(" ").toLowerCase();
      expect(features).not.toContain("six months");
      expect(features).not.toContain("6 months");
      expect(features).not.toContain("$49");
      expect(features).not.toContain("credit pack");
      expect(features).not.toContain("15%");
      expect(features).not.toContain("20%");
    });

    it("Founder features mention permanent access", () => {
      const features = PLANS.founder.features.join(" ");
      expect(features).toContain("Permanent");
    });
  });

  describe("Pricing — Starter", () => {
    it("Starter is free", () => {
      expect(PLANS.starter.monthlyPriceCents).toBe(0);
      expect(PLAN_CONTRACTS.starter.priceCents).toBe(0);
    });

    it("Starter has 500 LiTTBits", () => {
      expect(PLANS.starter.monthlyCredits).toBe(500);
      expect(PLAN_CONTRACTS.starter.credits).toBe(500);
    });

    it("Starter features do not say 'monthly LiTTBits'", () => {
      const features = PLANS.starter.features.join(" ").toLowerCase();
      expect(features).not.toContain("monthly littbits");
      expect(features).not.toContain("monthly ai credits");
    });
  });

  describe("LiTTBits terminology", () => {
    it("banned terms include 'coins' and 'coin pack'", () => {
      expect(LITTBITS_TERMINOLOGY.bannedTerms).toContain("coins");
      expect(LITTBITS_TERMINOLOGY.bannedTerms).toContain("coin pack");
    });

    it("plural is 'AI credits'", () => {
      expect(LITTBITS_TERMINOLOGY.plural).toBe("AI credits");
    });
  });

  describe("Feature flags", () => {
    it("daily LiTTBits bonus is disabled by default", () => {
      // DAILY_LITTBITS_ENABLED reads process.env.ENABLE_DAILY_LITTBITS
      // In test env, it should be false (not set).
      expect(DAILY_LITTBITS_ENABLED).toBe(false);
    });

    it("credit packs are disabled", () => {
      expect(CREDIT_PACKS_ENABLED).toBe(false);
    });
  });

  describe("Banned phrases list", () => {
    it("includes $49", () => {
      expect(BANNED_PHRASES).toContain("$49");
    });

    it("includes 'six months'", () => {
      expect(BANNED_PHRASES).toContain("six months");
    });

    it("includes 'Founding Supporter'", () => {
      expect(BANNED_PHRASES).toContain("Founding Supporter");
    });

    it("includes 'seven AI agents'", () => {
      expect(BANNED_PHRASES).toContain("seven AI agents");
    });

    it("includes 'coin pack'", () => {
      expect(BANNED_PHRASES).toContain("coin pack");
    });
  });

  describe("Plan contract alignment with plans.ts", () => {
    it("Starter prices match", () => {
      expect(PLAN_CONTRACTS.starter.priceCents).toBe(PLANS.starter.monthlyPriceCents);
    });

    it("Creator Beta prices match", () => {
      expect(PLAN_CONTRACTS.creator_beta.priceCents).toBe(PLANS.creator_beta.monthlyPriceCents);
    });

    it("Pro Builder Beta prices match", () => {
      expect(PLAN_CONTRACTS.pro_builder_beta.priceCents).toBe(PLANS.pro_builder_beta.monthlyPriceCents);
    });

    it("Founder prices match", () => {
      expect(PLAN_CONTRACTS.founder.priceCents).toBe(PLANS.founder.monthlyPriceCents);
    });
  });

  describe("Stripe catalog alignment", () => {
    it("verified Stripe plan prices match plans.ts", () => {
      expect(VERIFIED_STRIPE_PLANS.creator_beta.priceCents).toBe(PLANS.creator_beta.monthlyPriceCents);
      expect(VERIFIED_STRIPE_PLANS.pro_builder_beta.priceCents).toBe(PLANS.pro_builder_beta.monthlyPriceCents);
      expect(VERIFIED_STRIPE_PLANS.founder.priceCents).toBe(PLANS.founder.monthlyPriceCents);
    });

    it("verified Stripe plan env vars match plans.ts", () => {
      expect(VERIFIED_STRIPE_PLANS.creator_beta.envVar).toBe(PLANS.creator_beta.stripePriceIdEnv);
      expect(VERIFIED_STRIPE_PLANS.pro_builder_beta.envVar).toBe(PLANS.pro_builder_beta.stripePriceIdEnv);
      expect(VERIFIED_STRIPE_PLANS.founder.envVar).toBe(PLANS.founder.stripePriceIdEnv);
    });

    it("LiTT Growth mismatch is documented", () => {
      expect(VERIFIED_PREMIUM_AGENTS["litt-growth"].status).toBe("mismatch");
    });

    it("automatic tax is disabled by default", () => {
      expect(STRIPE_AUTOMATIC_TAX_ENABLED).toBe(false);
    });

    it("legacy products do not include current plan prices", () => {
      const legacyPrices = LEGACY_STRIPE_PRODUCTS.map((p) => p.price);
      expect(legacyPrices).not.toContain("$7/month");
      expect(legacyPrices).not.toContain("$19/month");
      expect(legacyPrices).not.toContain("$149 one-time");
    });
  });
});
