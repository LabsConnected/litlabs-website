import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Truth-in-labels regression tests for provider health in Settings.
// The 2026-11-11 production audit found three lies on this surface:
//   1. The "Provider fallback" card hard-coded the chain
//      ["Gemini 2.5 Flash", "Groq Llama 70B", "OpenRouter Free"] — wrong
//      order vs the route planner (openrouter is rung 2), a Groq model
//      retired from the live catalog, and the fallback Gemini model
//      presented as the chain head. The card must read /api/llm/health.
//   2. AI & Models painted every provider green via
//      `providerHealth[x] ?? "available"` — an unrecorded provider is
//      "unknown", never "available" (the doctrine model-health.ts and
//      useConnectionSummary already follow).
// These tests scan the settings source so the lies cannot creep back.

const pageSource = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

describe("settings provider surfaces tell the truth", () => {
  it("the fallback chain is not a hard-coded list", () => {
    expect(pageSource).not.toContain('"Groq Llama 70B", "OpenRouter Free"');
    expect(pageSource).not.toContain('"Gemini 2.5 Flash", "Groq Llama 70B"');
  });

  it("the fallback card reads the planner's live health endpoint", () => {
    expect(pageSource).toContain("ProviderFallbackCard");
    expect(pageSource).toContain('fetch("/api/llm/health"');
  });

  it("unrecorded provider health renders as unknown, never available", () => {
    expect(pageSource).not.toContain('?? "available"');
    expect(pageSource).toContain('?? "unknown"');
  });
});
