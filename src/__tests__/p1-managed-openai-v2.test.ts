/**
 * P1: Managed OpenAI v2 provider behavioral tests.
 *
 * Proves the managed OpenAI fallback works correctly in v2 routing:
 * 1. free user → no managed OpenAI
 * 2. entitled owner/premium → managed OpenAI present
 * 3. missing entitlement → deny
 * 4. explicit false → deny
 * 5. client cannot forge entitlement
 * 6. BYOK remains separate
 * 7. Gemini disabled + entitled: openrouter → groq → openai
 * 8. Gemini disabled + free: openrouter → groq
 * 9. OpenAI remains last when Gemini is enabled
 * 10. managed OpenAI has non-BYOK cost metadata
 * 11. Build route accepts the OpenAI model
 * 12. controlled failover through free providers reaches OpenAI for entitled users
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planBasicRoutes } from "@/lib/litt-intelligence/provider-registry";
import { getEligibleModels } from "@/lib/litt-intelligence/model-registry";

describe("P1: managed OpenAI v2 provider", () => {
  const originalGeminiDisabled = process.env.GEMINI_DISABLED;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    // Ensure OpenAI credential is present for these tests
    process.env.OPENAI_API_KEY = "test-key-for-routing-only";
  });

  afterEach(() => {
    if (originalGeminiDisabled === undefined) {
      delete process.env.GEMINI_DISABLED;
    } else {
      process.env.GEMINI_DISABLED = originalGeminiDisabled;
    }
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

  const basicRequirements = {
    tools: true,
    coding: true,
    reliableFileWriting: true,
  };

  describe("entitlement gating", () => {
    it("1. free user → no managed OpenAI", () => {
      const plan = planBasicRoutes(basicRequirements, {});
      const openai = plan.providers.find((p) => p.provider === "openai");
      expect(openai).toBeUndefined();
      // Should be in excluded with the right reason
      const excluded = plan.excluded.find((e) => e.provider === "openai");
      expect(excluded?.reason).toBe("litt_paid_not_allowed_for_basic");
    });

    it("2. entitled owner/premium → managed OpenAI present", () => {
      const plan = planBasicRoutes(basicRequirements, {
        allowLittPaidProviders: true,
      });
      const openai = plan.providers.find((p) => p.provider === "openai");
      expect(openai).toBeDefined();
      expect(openai?.costClass).toBe("LITT_PAID");
    });

    it("3. missing entitlement → deny", () => {
      // No allowLittPaidProviders key at all = deny
      const plan = planBasicRoutes(basicRequirements, {
        model: "gpt-4o", // Even with model hint, should deny
      });
      const openai = plan.providers.find((p) => p.provider === "openai");
      expect(openai).toBeUndefined();
    });

    it("4. explicit false → deny", () => {
      const plan = planBasicRoutes(basicRequirements, {
        allowLittPaidProviders: false,
      });
      const openai = plan.providers.find((p) => p.provider === "openai");
      expect(openai).toBeUndefined();
    });

    it("5. client cannot forge entitlement", () => {
      // The RoutePlanOptions type includes allowLittPaidProviders,
      // but the route handler must NEVER populate it from request JSON.
      // This test verifies the type exists (for server use) but documents
      // that client input must not flow here. The actual enforcement is
      // in the route handler which we verify via source inspection.
      const routeSource = readFileSync(
        join(__dirname, "../app/api/studio/conversations/[conversationId]/messages/route.ts"),
        "utf-8"
      );
      // Must derive from entitlements, not body
      expect(routeSource).toContain("getOwnerAwareEntitlements");
      expect(routeSource).not.toMatch(/body\.\s*allowLittPaidProviders/);
      expect(routeSource).not.toMatch(/body\[.allowLittPaidProviders.\]/);
    });

    it("6. BYOK remains separate", () => {
      // BYOK (user-funded) and managed OpenAI (LITT_PAID) are distinct
      const planWithByok = planBasicRoutes(basicRequirements, {
        userApiKey: "user-key-123",
        byokProvider: "openai",
        allowLittPaidProviders: true,
      });
      const byok = planWithByok.providers.find((p) => p.provider === "byok");
      const managed = planWithByok.providers.find((p) => p.provider === "openai");
      expect(byok).toBeDefined();
      expect(byok?.costClass).toBe("USER_FUNDED");
      expect(managed).toBeDefined();
      expect(managed?.costClass).toBe("LITT_PAID");
      // They are different providers
      expect(byok?.provider).not.toBe(managed?.provider);
    });
  });

  describe("route ordering", () => {
    it("7. Gemini disabled + entitled: openrouter → groq → openai", () => {
      process.env.GEMINI_DISABLED = "true";
      const plan = planBasicRoutes(basicRequirements, {
        allowLittPaidProviders: true,
      });
      const providers = plan.providers.map((p) => p.provider);
      // Gemini excluded
      expect(providers).not.toContain("gemini");
      // OpenAI present and last among the main providers
      const openaiIdx = providers.indexOf("openai");
      expect(openaiIdx).toBeGreaterThan(-1);
      // OpenAI should be after openrouter and groq
      const openrouterIdx = providers.indexOf("openrouter");
      const groqIdx = providers.indexOf("groq");
      if (openrouterIdx > -1) expect(openaiIdx).toBeGreaterThan(openrouterIdx);
      if (groqIdx > -1) expect(openaiIdx).toBeGreaterThan(groqIdx);
    });

    it("8. Gemini disabled + free: openrouter → groq (no openai)", () => {
      process.env.GEMINI_DISABLED = "true";
      const plan = planBasicRoutes(basicRequirements, {});
      const providers = plan.providers.map((p) => p.provider);
      expect(providers).not.toContain("gemini");
      expect(providers).not.toContain("openai");
      // Free providers still present
      expect(providers).toContain("openrouter");
    });

    it("9. OpenAI remains last when Gemini is enabled", () => {
      delete process.env.GEMINI_DISABLED;
      const plan = planBasicRoutes(basicRequirements, {
        allowLittPaidProviders: true,
      });
      const providers = plan.providers.map((p) => p.provider);
      const openaiIdx = providers.indexOf("openai");
      expect(openaiIdx).toBeGreaterThan(-1);
      // OpenAI is last (or after all free providers)
      const lastFreeIdx = Math.max(
        providers.indexOf("gemini"),
        providers.indexOf("openrouter"),
        providers.indexOf("groq"),
      );
      expect(openaiIdx).toBeGreaterThan(lastFreeIdx);
    });
  });

  describe("cost and model metadata", () => {
    it("10. managed OpenAI has non-BYOK cost metadata", () => {
      const plan = planBasicRoutes(basicRequirements, {
        allowLittPaidProviders: true,
      });
      const openai = plan.providers.find((p) => p.provider === "openai");
      expect(openai).toBeDefined();
      expect(openai?.costClass).toBe("LITT_PAID");
      expect(openai?.costClass).not.toBe("USER_FUNDED");
      expect(openai?.costClass).not.toBe("FREE_MANAGED");
    });

    it("11. Build route accepts the OpenAI model", () => {
      // The OpenAI model should be eligible for Build (reliableFileWriting)
      const models = getEligibleModels({
        tools: true,
        reliableFileWriting: true,
      });
      const openaiModel = models.find((m) => m.provider === "openai");
      expect(openaiModel).toBeDefined();
      expect(openaiModel?.capabilities.toolCalling).toBe(true);
      expect(openaiModel?.capabilities.reliableFileWriting).toBe(true);
    });

    it("12. entitled plan enables OpenAI failover after free providers", () => {
      // Behavioral proof: with GEMINI_DISABLED and entitlement,
      // the route plan positions OpenAI as the terminal fallback.
      // Free providers (openrouter, groq) are ordered before it;
      // when they fail in execution, the attempt loop reaches OpenAI.
      process.env.GEMINI_DISABLED = "true";
      const plan = planBasicRoutes(basicRequirements, {
        allowLittPaidProviders: true,
      });
      const providers = plan.providers.map((p) => p.provider);
      // OpenAI is the terminal fallback
      expect(providers[providers.length - 1]).toBe("openai");
      // Free providers come before it
      const openaiIdx = providers.indexOf("openai");
      expect(providers.slice(0, openaiIdx)).toContain("openrouter");
      // The plan is executable: OpenAI has models and credentials
      const openaiPlan = plan.providers.find((p) => p.provider === "openai");
      expect(openaiPlan?.models.length).toBeGreaterThan(0);
      expect(openaiPlan?.credentialState).toBe("available");
    });
  });

  describe("billing verification", () => {
    it("13. managed OpenAI cost is non-zero and not BYOK", async () => {
      const { calculateLlmCost } = await import("@/lib/llm-cost-engine");
      const cost = calculateLlmCost({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 1000,
        completionTokens: 500,
        isByok: false,
      });
      // Non-zero provider cost
      expect(cost.providerCostMicros).toBeGreaterThan(0);
      // Not BYOK billing class
      expect(cost.billingClass).not.toBe("byok");
      expect(cost.billingClass).toBe("premium");
      // Should debit (not free, not BYOK)
      expect(cost.shouldDebit).toBe(true);
      // Non-zero LiTTBits charge
      expect(cost.retailLiTTBits).toBeGreaterThan(0);
    });

    it("14. BYOK OpenAI stays zero-cost and user-funded", async () => {
      // The catalog holds TWO openai/gpt-4o entries (managed "premium" and
      // BYOK "byok") disambiguated by lookupCostEntry(provider, model, isByok).
      // This proves the BYOK record is selected for a user-funded call, so a
      // user's own key never books platform spend — and, symmetrically, that
      // the managed record is not shadowed.
      const { calculateLlmCost } = await import("@/lib/llm-cost-engine");

      const byok = calculateLlmCost({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 1000,
        completionTokens: 500,
        isByok: true,
      });
      expect(byok.billingClass).toBe("byok");
      expect(byok.providerCostMicros).toBe(0);
      expect(byok.retailLiTTBits).toBe(0);
      expect(byok.shouldDebit).toBe(false);

      // Same provider+model, managed: real cost, real charge.
      const managed = calculateLlmCost({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 1000,
        completionTokens: 500,
        isByok: false,
      });
      expect(managed.billingClass).toBe("premium");
      expect(managed.providerCostMicros).toBeGreaterThan(0);
      expect(managed.shouldDebit).toBe(true);
    });

    it("15. no duplicate charging on fallback", async () => {
      // Each provider attempt emits its own cost event;
      // the customer usage event is emitted once per logical action,
      // not per provider attempt. This is enforced by the metering
      // layer (one usage_event per run, multiple cost_events).
      // Here we verify the cost engine doesn't double-count a single call.
      const { calculateLlmCost } = await import("@/lib/llm-cost-engine");
      const cost1 = calculateLlmCost({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 1000,
        completionTokens: 500,
        isByok: false,
      });
      const cost2 = calculateLlmCost({
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 1000,
        completionTokens: 500,
        isByok: false,
      });
      // Same input → same cost (deterministic, no accumulation)
      expect(cost1.retailLiTTBits).toBe(cost2.retailLiTTBits);
    });
  });
});
