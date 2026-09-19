import { describe, it, expect } from "vitest";
import { getStudioAgents, LITT } from "@/lib/agent-registry";
import {
  AGENT_PROFILES,
} from "@/lib/litt-intelligence/agent-profiles";
import type { AgentMode } from "@/lib/litt-intelligence/agent-identity";
import { composeSystemPrompt } from "@/lib/litt-kernel/prompt-composer";
import { routeKernel } from "@/lib/litt-kernel/kernel";

/**
 * Regression test for the 2026-09-19 live incident: asking Studio to
 * "generate a short video of ocean waves" returned an LLM-generated refusal
 * naming Spark ("Video generation is Spark's domain… ask Spark to generate
 * that ocean waves video for you!") because system prompts told the model to
 * redirect creative work to Spark.
 *
 * The name "Spark" is internal-only. These prompts may reference the word
 * ONLY inside the internal-only rule itself; they must never tell the model
 * to redirect the user to Spark.
 */

// Phrasings that (re)produce the Spark-redirect refusal. The internal-only
// rule ("never say Spark… never redirect the user to Spark") is allowed and
// asserted separately.
const SPARK_REDIRECT_PATTERNS: RegExp[] = [
  /spark's domain/i,
  /spark handles all/i,
  /ask spark to/i,
  /switch(?:ing)? to spark/i,
  /suggest(?:ing)? spark/i,
  /recommend(?:ing)? spark/i,
  /(?<!never )redirect .* to spark/i,
  /mention them when relevant/i,
];

function expectNoSparkRedirect(prompt: string, label: string) {
  for (const pattern of SPARK_REDIRECT_PATTERNS) {
    expect(
      prompt,
      `${label}: system prompt must not redirect the user to Spark (matched ${pattern})`,
    ).not.toMatch(pattern);
  }
}

function expectInternalOnlyRule(prompt: string, label: string) {
  expect(
    prompt,
    `${label}: system prompt must carry the Spark internal-only rule`,
  ).toMatch(/internal-only/i);
}

describe("spark scrub regression", () => {
  it("excludes Spark from the Studio agent selector", () => {
    const ids = getStudioAgents().map((a) => a.id);
    expect(ids).toContain("litt");
    expect(ids).not.toContain("spark");
  });

  it("LiTT core system prompt has no Spark redirect", () => {
    expectNoSparkRedirect(LITT.systemPrompt, "LITT.systemPrompt");
    expectInternalOnlyRule(LITT.systemPrompt, "LITT.systemPrompt");
  });

  it("all litt-intelligence agent profiles have no Spark redirect", () => {
    for (const mode of Object.keys(AGENT_PROFILES) as AgentMode[]) {
      const prompt = AGENT_PROFILES[mode].systemPrompt;
      expectNoSparkRedirect(prompt, `AGENT_PROFILES[${mode}]`);
      expectInternalOnlyRule(prompt, `AGENT_PROFILES[${mode}]`);
    }
  });

  it("composed kernel prompt for a video request has no Spark redirect", () => {
    // The exact message class that produced the live refusal.
    const result = routeKernel({
      message: "generate a short video of ocean waves",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const prompt = composeSystemPrompt(result.decision, []);
    expectNoSparkRedirect(prompt, "composeSystemPrompt(video request)");
    expectInternalOnlyRule(prompt, "composeSystemPrompt(video request)");
  });
});
