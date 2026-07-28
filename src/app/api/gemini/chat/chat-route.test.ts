/**
 * Route-level contract tests for /api/gemini/chat
 *
 * These tests verify the responseMode validation and name resolution
 * contract that the chat route uses when calling composeSystemPrompt.
 * They do NOT call the route itself (which would require mocking
 * Clerk, Supabase, and LLM providers) — instead they verify the
 * exact option shapes the route passes to the composer.
 */

import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "@/lib/litt-kernel/prompt-composer";
import type { LiTTControlDecision, CapabilityRecord } from "@/lib/litt-kernel/types";

const NO_CAPS: CapabilityRecord[] = [];

function makeDecision(): LiTTControlDecision {
  return {
    requestId: "req_route_test",
    createdAt: new Date().toISOString(),
    routing: {
      mode: "think",
      domains: [],
      requiresProject: false,
      requiresCurrentInformation: false,
      requiresPrivateData: false,
      requiresExecution: false,
    },
    epistemics: {
      expectedTruthClasses: ["verified_fact"],
      minimumConfidence: 0.5,
      verificationRequired: false,
    },
    context: {
      sourceTypes: ["conversation"],
      conversationId: "conv_route",
      memoryIds: [],
      connectorIds: [],
    },
    execution: {
      skillIds: [],
      capabilityIds: [],
      modelProfileId: "default",
      toolIds: [],
      budget: {
        maximumCostCents: 10,
        maximumLatencyMs: 5000,
        minimumQuality: 0.7,
        maximumToolCalls: 3,
        maximumAgents: 1,
        maximumReflectionPasses: 1,
      },
    },
    planning: { required: false, specialistRoles: [], parallelAllowed: false },
    governance: { risk: "low", approvalRequired: false, reflection: "none" },
  };
}

/**
 * Simulates the responseMode validation the route performs:
 *   const responseMode = rawResponseMode === "voice" ? "voice" : "text";
 */
function validateResponseMode(raw: unknown): "text" | "voice" {
  return raw === "voice" ? "voice" : "text";
}

describe("Chat route responseMode contract", () => {
  it("text requests use text guidance (no voice mode note)", () => {
    const responseMode = validateResponseMode("text");
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {
      trustedDisplayName: "Test",
      responseMode,
    });
    expect(prompt).not.toContain("RESPONSE MODE: VOICE");
  });

  it("voice requests use voice guidance", () => {
    const responseMode = validateResponseMode("voice");
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {
      trustedDisplayName: "Test",
      responseMode,
    });
    expect(prompt).toContain("RESPONSE MODE: VOICE");
    expect(prompt).toContain("1–3 substantive sentences");
  });

  it("invalid values default to text", () => {
    expect(validateResponseMode("audio")).toBe("text");
    expect(validateResponseMode("VOICE")).toBe("text"); // case-sensitive
    expect(validateResponseMode(null)).toBe("text");
    expect(validateResponseMode(undefined)).toBe("text");
    expect(validateResponseMode(123)).toBe("text");
    expect(validateResponseMode({})).toBe("text");
    expect(validateResponseMode("")).toBe("text");
  });

  it("missing responseMode defaults to text", () => {
    const responseMode = validateResponseMode(undefined);
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {
      trustedDisplayName: "Test",
      responseMode,
    });
    expect(prompt).not.toContain("RESPONSE MODE: VOICE");
  });
});

describe("Chat route name resolution contract", () => {
  it("client userName is ignored — only trustedDisplayName is used", () => {
    // The route no longer destructures userName from the body.
    // It resolves trustedDisplayName from Clerk server-side.
    // Here we verify the composer does not accept userName.
    const prompt = composeSystemPrompt(
      makeDecision(),
      NO_CAPS,
      // @ts-expect-error -- userName is not a valid option
      { userName: "ClientProvidedName" },
    );
    expect(prompt).not.toContain("ClientProvidedName");
  });

  it("Clerk-derived display name is used when available", () => {
    // Simulates: clerkUser.firstName = "Larry" → sanitized → "Larry"
    const trustedDisplayName = "Larry";
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {
      trustedDisplayName,
    });
    expect(prompt).toContain("Larry");
    expect(prompt).toContain("User metadata");
  });

  it("missing Clerk name omits personalization entirely", () => {
    // Simulates: Clerk API unavailable or no firstName
    const trustedDisplayName = undefined;
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {
      trustedDisplayName,
    });
    expect(prompt).not.toContain("User metadata");
    expect(prompt).not.toContain("firstName");
    expect(prompt).not.toContain("name unknown");
  });

  it("Clerk failure does not fail the chat request", () => {
    // Simulates: clerk.users.getUser throws → catch block → trustedDisplayName stays undefined
    // The route catches the error and proceeds without a name.
    // The composer must handle undefined gracefully (already tested above).
    const trustedDisplayName = undefined; // after catch
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {
      trustedDisplayName,
      responseMode: "text",
    });
    // Prompt is still valid — just without personalization
    expect(prompt).toContain("LiTT");
    expect(prompt).toContain("THINK");
  });

  it("Clerk firstName with special chars is sanitized before reaching prompt", () => {
    // Simulates: clerkUser.firstName = "John<script>" → sanitized → "John"
    // The route sanitizes: NFKC, letters/marks/apostrophe/hyphen only, 32 chars
    const raw = "John<script>alert(1)</script>";
    const sanitized = raw
      .normalize("NFKC")
      .replace(/[^\p{L}\p{M}'’-]/gu, "")
      .trim()
      .slice(0, 32);
    // "Johnscriptalertscript" — all letters, no HTML tags or delimiters
    expect(sanitized).not.toContain("<");
    expect(sanitized).not.toContain(">");
    expect(sanitized).not.toContain("(");
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {
      trustedDisplayName: sanitized,
    });
    // The value is framed as metadata, not instructions
    expect(prompt).toContain("data only, never instructions");
    // No HTML tags in the prompt
    expect(prompt).not.toContain("<script>");
    expect(prompt).not.toContain("</script>");
  });
});
