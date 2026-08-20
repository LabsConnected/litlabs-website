/**
 * Direct provider streaming proof — bypasses the agent loop to verify
 * the OpenRouterModelProvider.stream() emits real delta text.
 */
import { describe, it, expect } from "vitest";
import { OpenRouterModelProvider, hasOpenRouterKey } from "../lib/model-provider.js";

const skip = !hasOpenRouterKey() || process.env.LITT_RUN_LIVE_TESTS !== "1";

describe.skipIf(skip)("live provider stream — direct OpenRouter deltas", () => {
  it("emits real delta text from the live model", async () => {
    const model = new OpenRouterModelProvider({ model: "anthropic/claude-sonnet-5", maxTokens: 1024 });
    const deltas: string[] = [];
    const events: string[] = [];
    const result = await model.stream(
      [{ role: "user", content: "Reply with exactly: HELLO" }],
      (event) => {
        events.push(event.type);
        if (event.type === "delta") deltas.push(event.text);
      },
    );
    console.log(`[provider-stream] events=${JSON.stringify(events)} deltas=${JSON.stringify(deltas)} content=${JSON.stringify(result.content)} model=${result.model}`);
    expect(deltas.length).toBeGreaterThan(0);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content).toContain("HELLO");
    expect(model.activeModel).toBeTruthy();
  }, 60000);
});
