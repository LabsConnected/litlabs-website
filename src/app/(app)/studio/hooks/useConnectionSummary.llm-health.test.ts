import { describe, it, expect } from "vitest";

import { parseLlmProviderHealth } from "./useConnectionSummary";

/**
 * Regression tests: the new-project setup showed a stale
 * "AI provider — UNAVAILABLE" prerequisite badge while AI routes worked.
 * Root cause: the /api/llm/health check treated a failed check — or the
 * minimal {status} payload served to unauthenticated callers — as
 * "all providers down". The parser must return null ("unknown") for any
 * payload without explicit provider fields so the UI never asserts
 * "unavailable" from an unverified check.
 */
describe("parseLlmProviderHealth", () => {
  it("parses explicit provider fields", () => {
    expect(
      parseLlmProviderHealth({
        gemini: { available: true, model: "gemini-3.6-flash" },
        groq: { available: false, model: "openai/gpt-oss-120b" },
        openrouter: { available: true, model: "openrouter/free" },
      }),
    ).toEqual({ gemini: true, groq: false, openrouter: true });
  });

  it("treats missing providers as not available when other fields exist", () => {
    expect(parseLlmProviderHealth({ gemini: { available: true } })).toEqual({
      gemini: true,
      groq: false,
      openrouter: false,
    });
  });

  it("returns null for the minimal unauthenticated {status} payload", () => {
    expect(parseLlmProviderHealth({ status: "ok" })).toBeNull();
    expect(parseLlmProviderHealth({ status: "degraded" })).toBeNull();
  });

  it("returns null for error payloads and non-objects", () => {
    expect(parseLlmProviderHealth({ error: "Health check failed" })).toBeNull();
    expect(parseLlmProviderHealth(null)).toBeNull();
    expect(parseLlmProviderHealth(undefined)).toBeNull();
    expect(parseLlmProviderHealth("ok")).toBeNull();
  });
});
