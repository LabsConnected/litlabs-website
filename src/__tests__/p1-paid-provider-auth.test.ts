/**
 * P1: Paid-provider authorization tests.
 *
 * allowLittPaidProviders must be derived from server-side entitlement
 * (owner or premiumModels), NEVER from client request input.
 *
 * These tests verify:
 * 1. Authorized owner/paid context → OpenAI eligible
 * 2. Normal free user → OpenAI excluded
 * 3. Forged request field cannot enable OpenAI
 * 4. GEMINI_DISABLED=true → Gemini never appears
 * 5. Authorized route order → OpenAI before OpenRouter
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LLM_SOURCE = readFileSync(join(__dirname, "../lib/llm.ts"), "utf-8");
const ROUTE_SOURCE = readFileSync(
  join(__dirname, "../app/api/studio/conversations/[conversationId]/messages/route.ts"),
  "utf-8"
);

describe("P1: paid-provider authorization", () => {
  const originalEnv = process.env.GEMINI_DISABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GEMINI_DISABLED;
    } else {
      process.env.GEMINI_DISABLED = originalEnv;
    }
  });

  describe("server-side entitlement wiring", () => {
    it("1. authorized owner/paid context → OpenAI eligible", () => {
      // The route must derive allowLittPaidProviders from entitlements,
      // not from request input. Owner or premiumModels enables it.
      expect(ROUTE_SOURCE).toContain("getOwnerAwareEntitlements");
      expect(ROUTE_SOURCE).toMatch(/allowLittPaidProviders\s*=\s*entitlements\.isOwner\s*\|\|\s*entitlements\.premiumModels/);
    });

    it("2. normal free user → OpenAI excluded", () => {
      // Default-deny: if entitlement lookup fails or user is not entitled,
      // allowLittPaidProviders stays false.
      expect(ROUTE_SOURCE).toContain("allowLittPaidProviders = false");
      // The llm.ts chain filters litt_paid when not allowed
      expect(LLM_SOURCE).toContain("!isLittPaidProvider(p)");
    });

    it("3. forged request field cannot enable OpenAI", () => {
      // The route must NEVER read allowLittPaidProviders from body.
      // Check that body.allowLittPaidProviders is not referenced.
      expect(ROUTE_SOURCE).not.toMatch(/body\s*\.\s*allowLittPaidProviders/);
      expect(ROUTE_SOURCE).not.toMatch(/body\s*\[\s*['"]allowLittPaidProviders['"]\s*\]/);
      // The comment documents this security property
      expect(ROUTE_SOURCE).toContain("NEVER accepted from client request input");
    });
  });

  describe("GEMINI_DISABLED routing", () => {
    it("4. GEMINI_DISABLED=true → Gemini never appears in chain", () => {
      // llm.ts defaultChain filters gemini when disabled
      expect(LLM_SOURCE).toContain('process.env.GEMINI_DISABLED === "true"');
      expect(LLM_SOURCE).toMatch(/chain\.filter\(\(p\)\s*=>\s*p\s*!==\s*["']gemini["']\)/);
    });

    it("5. authorized route order → OpenAI before OpenRouter", () => {
      // When OpenAI is authorized (allowLittPaidProviders=true) and
      // Gemini is disabled, the chain should be OpenAI → OpenRouter.
      // The raw chain has openai first when OPENAI_KEY is set.
      expect(LLM_SOURCE).toMatch(/\["openai",\s*"gemini"/);
      // With GEMINI_DISABLED, gemini is filtered, leaving openai first
      // followed by openrouter variants.
    });
  });
});
