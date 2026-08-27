/**
 * Output-token policy (policy D — ONE canonical 3000 cap).
 *
 * Server half of the contract pinned client-side by
 * packages/litt-cli/src/__tests__/provider-policy.test.ts:
 *
 *   - DEFAULT_MAX_TOKENS is 3000 and matches the CLI's constant.
 *   - resolveServerMaxTokens preserves an explicit sane value.
 *   - Anything above MAX_OUTPUT_TOKENS (16384) is clamped, so the
 *     model's own output ceiling (65536 for GPT-5.6) can never be
 *     requested again.
 *   - Missing/invalid values resolve to 3000 — undefined can never
 *     reach a provider.
 *   - Both OpenRouter request paths (the remote relay and the operator
 *     tool transport) send the resolved value, never undefined.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("output-token policy (policy D)", () => {
  let mod: typeof import("../litt-code.js");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("../litt-code.js");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses 3000 as the canonical default, matching the CLI", () => {
    expect(mod.DEFAULT_MAX_TOKENS).toBe(3000);
  });

  it("clamps at 16384 — the model ceiling (65536) can never be requested", () => {
    expect(mod.MAX_OUTPUT_TOKENS).toBe(16_384);
    expect(mod.resolveServerMaxTokens(65_536)).toBe(16_384);
    expect(mod.resolveServerMaxTokens(1_000_000)).toBe(16_384);
  });

  it("preserves an explicit valid caller value", () => {
    expect(mod.resolveServerMaxTokens(1200)).toBe(1200);
    expect(mod.resolveServerMaxTokens(16_384)).toBe(16_384);
  });

  it("resolves missing/invalid values to 3000, never undefined", () => {
    expect(mod.resolveServerMaxTokens()).toBe(3000);
    expect(mod.resolveServerMaxTokens(undefined)).toBe(3000);
    expect(mod.resolveServerMaxTokens(0)).toBe(3000);
    expect(mod.resolveServerMaxTokens(-5)).toBe(3000);
  });

  describe("request paths never send undefined max_tokens", () => {
    const originalFetch = globalThis.fetch;
    const savedKey = process.env.OPENROUTER_API_KEY;

    beforeEach(() => {
      process.env.OPENROUTER_API_KEY = "sk-or-test";
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = savedKey;
    });

    function captureBodyFetch(status = 500): { bodies: Array<Record<string, unknown>> } {
      const bodies: Array<Record<string, unknown>> = [];
      const stub = (async (_url: unknown, init?: { body?: string }) => {
        bodies.push(init?.body ? JSON.parse(init.body) : {});
        return new Response("test stub", { status });
      }) as typeof fetch;
      globalThis.fetch = stub;
      return { bodies };
    }

    it("remote relay: missing maxTokens → canonical 3000", async () => {
      const { bodies } = captureBodyFetch();
      await expect(
        mod.streamModelForRemoteClient(
          [{ role: "user", content: "hi" }],
          [],
          () => {},
          { model: "openai/gpt-5.6-luna" },
        ),
      ).rejects.toThrow();
      expect(bodies[0].max_tokens).toBe(3000);
    });

    it("remote relay: explicit 65536 → clamped to 16384", async () => {
      const { bodies } = captureBodyFetch();
      await expect(
        mod.streamModelForRemoteClient(
          [{ role: "user", content: "hi" }],
          [],
          () => {},
          { model: "openai/gpt-5.6-luna", maxTokens: 65_536 },
        ),
      ).rejects.toThrow();
      expect(bodies[0].max_tokens).toBe(16_384);
    });

    it("remote relay: explicit 1200 → preserved", async () => {
      const { bodies } = captureBodyFetch();
      await expect(
        mod.streamModelForRemoteClient(
          [{ role: "user", content: "hi" }],
          [],
          () => {},
          { model: "openai/gpt-5.6-luna", maxTokens: 1200 },
        ),
      ).rejects.toThrow();
      expect(bodies[0].max_tokens).toBe(1200);
    });

    it("operator tool transport: canonical 3000", async () => {
      const { bodies } = captureBodyFetch(200);
      // Non-streaming JSON call; a malformed response body is fine — we
      // only assert what was REQUESTED.
      await mod
        .streamLiTTMessagesWithTools(
          [{ role: "user", content: "hi" }],
          [],
          () => {},
        )
        .catch(() => {});
      expect(bodies[0].max_tokens).toBe(3000);
    });
  });
});
