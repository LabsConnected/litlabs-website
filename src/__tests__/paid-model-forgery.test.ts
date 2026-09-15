import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROVIDER_COST_CLASS,
  isLittPaidProvider,
  type LLMProvider,
} from "@/lib/llm";
import { CHAT_MODELS, CODE_MODELS } from "@/lib/studio-models";

// ─── Regression: a Free user must not be able to make LiTT pay ────────
//
// Found 2026-09-13. Three things lined up on the v1 Studio chat path:
//
//   1. src/app/api/studio/conversations/[conversationId]/messages/route.ts
//      builds its provider/model from request input with no plan check:
//        const provider = typeof body.provider === "string" ? body.provider : undefined
//        const modelOverride = body.model && provider ? { [provider]: body.model } : undefined
//      and passes them to streamText().
//
//   2. src/lib/llm.ts defaultChain() honoured a forced provider by returning
//      [opts.provider] and skipping the chain entirely — so POSTing
//      { provider: "openai", model: "gpt-4o", category: "fast" } pinned the
//      run to LiTT's own OPENAI_API_KEY.
//
//   3. Separately, whenever OPENAI_API_KEY is set, "openai" was FIRST in the
//      default chain for auto / chat / code / creative / precise / json /
//      litt-alias, so ordinary Basic traffic led with a paid provider.
//
// The fix is default-deny: litt_paid providers are filtered out of the chain
// unless the caller passes allowLittPaidProviders, which must come from the
// user's plan and never from request input.
//
// defaultChain is module-private, so the chain assertions here read the
// source of llm.ts — the same approach csp-form-action.test.ts uses to assert
// on next.config.ts without importing Next build-time APIs.

const LLM_SOURCE = readFileSync(join(__dirname, "../lib/llm.ts"), "utf-8");

describe("paid-model forgery protection", () => {
  describe("cost classification", () => {
    it("openai is the only LiTT-funded provider", () => {
      const littPaid = (Object.keys(PROVIDER_COST_CLASS) as LLMProvider[]).filter(
        isLittPaidProvider,
      );
      expect(littPaid).toEqual(["openai"]);
    });

    it("every OpenRouter route is an included :free slug", () => {
      const openrouter = (Object.keys(PROVIDER_COST_CLASS) as LLMProvider[]).filter((p) =>
        p.startsWith("openrouter-"),
      );
      expect(openrouter.length).toBeGreaterThan(0);
      for (const p of openrouter) {
        expect(isLittPaidProvider(p)).toBe(false);
      }
    });

    it("classifies every provider in the LLMProvider union", () => {
      // A new provider must be classified deliberately, not defaulted.
      const declared = LLM_SOURCE.match(/export type LLMProvider =([\s\S]*?);/);
      expect(declared).not.toBeNull();
      const names = [...declared![1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(5);
      for (const n of names) {
        expect(
          PROVIDER_COST_CLASS[n as LLMProvider],
          `provider "${n}" is missing from PROVIDER_COST_CLASS`,
        ).toBeDefined();
      }
    });
  });

  describe("the chain is gated by cost policy", () => {
    it("defaultChain filters litt_paid providers unless explicitly allowed", () => {
      expect(LLM_SOURCE).toContain("if (opts.allowLittPaidProviders) return chain");
      expect(LLM_SOURCE).toContain("chain.filter((p) => !isLittPaidProvider(p))");
    });

    it("a forced provider cannot pin a litt_paid route on its own", () => {
      // The raw chain still honours opts.provider; the gate runs after it, so
      // a forged provider: "openai" is filtered and falls back to free routes.
      expect(LLM_SOURCE).toContain("function rawDefaultChain");
      expect(LLM_SOURCE).toContain("INCLUDED_FALLBACK_CHAIN");
    });

    it("the opt-in is documented as never coming from request input", () => {
      expect(LLM_SOURCE).toMatch(/NEVER from request\s*\n?\s*\*?\s*input/);
    });

    it("the fallback chain contains no litt_paid provider", () => {
      const m = LLM_SOURCE.match(/const INCLUDED_FALLBACK_CHAIN: LLMProvider\[\] = \[([^\]]*)\]/);
      expect(m).not.toBeNull();
      const names = [...m![1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]) as LLMProvider[];
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) {
        expect(isLittPaidProvider(n)).toBe(false);
      }
    });
  });

  describe("the model picker does not advertise LiTT-funded paid routes", () => {
    const openaiOrAnthropic = (m: { provider: string }) =>
      m.provider === "openai" || m.provider === "anthropic";

    it("every OpenAI/Anthropic chat model is BYOK", () => {
      const offered = CHAT_MODELS.filter(openaiOrAnthropic);
      expect(offered.length).toBeGreaterThan(0);
      for (const m of offered) {
        expect(m.category, `${m.id} must be byok`).toBe("byok");
      }
    });

    it("every OpenAI/Anthropic code model is BYOK", () => {
      // CODE_MODELS previously offered a plain { id: "gpt-4o", cost: "paid" }
      // with no category, which advertised a LiTT-funded route.
      const offered = CODE_MODELS.filter(openaiOrAnthropic);
      for (const m of offered) {
        expect(m.category, `${m.id} must be byok`).toBe("byok");
      }
    });

    it("no LiTT alias is backed by a LiTT-funded provider", () => {
      // LiTT aliases are branded routes billed in LiTTBits, so cost: "paid"
      // is legitimate for them — what must never happen is an alias resolving
      // to a provider that spends LiTT's own platform credential.
      const aliases = [...CHAT_MODELS, ...CODE_MODELS].filter(
        (m) => m.category === "litt-alias",
      );
      expect(aliases.length).toBeGreaterThan(0);
      for (const m of aliases) {
        if (!m.apiProvider) continue;
        expect(
          isLittPaidProvider(m.apiProvider as LLMProvider),
          `alias ${m.id} is backed by litt_paid provider ${m.apiProvider}`,
        ).toBe(false);
      }
    });
  });
});
