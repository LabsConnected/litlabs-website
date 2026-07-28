import { describe, it, expect } from "vitest";
import { AGENT_META, getAgentMeta, type AgentId } from "../stores/useStudioAgentStore";

// ── Phase 2.3: Server-owned agent identity ─────────────────────

describe("Agent identity registry — Phase 2.3", () => {
  it("AGENT_META contains litt and spark with system prompts", () => {
    expect(AGENT_META.litt).toBeTruthy();
    expect(AGENT_META.litt.systemPrompt).toBeTruthy();
    expect(AGENT_META.litt.displayName).toBe("LiTT");
    expect(AGENT_META.spark).toBeTruthy();
    expect(AGENT_META.spark.systemPrompt).toBeTruthy();
    expect(AGENT_META.spark.displayName).toBe("Spark");
  });

  it("getAgentMeta returns the correct agent for known IDs", () => {
    expect(getAgentMeta("litt").id).toBe("litt");
    expect(getAgentMeta("spark").id).toBe("spark");
  });

  it("getAgentMeta falls back to LiTT for unknown agents", () => {
    expect(getAgentMeta("unknown-premium-agent").id).toBe("litt");
  });

  it("AgentId is a string type (supports premium agents)", () => {
    const id: AgentId = "premium-agent-123";
    expect(typeof id).toBe("string");
  });
});
