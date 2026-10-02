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
      const routeSource = require("fs").readFileSync(
        require("path").join(__dirname, "../app/api/studio/conversations/[conversationId]/messages/route.ts"),
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

    it("12. controlled failover reaches OpenAI for entitled users", () => {
      // Simulate: free providers fail, entitled user should have OpenAI
      // as the final fallback in the plan
      process.env.GEMINI_DISABLED = "true";
      const plan = planBasicRoutes(basicRequirements, {
        allowLittPaidProviders: true,
      });
      // The plan should include OpenAI as the last resort
      const providers = plan.providers.map((p) => p.provider);
      expect(providers[providers.length - 1]).toBe("openai");
    });
  });
});
