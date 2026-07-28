/**
 * Prompt Composer Tests — LiTT Informative Response Correction
 *
 * Verifies the persona voice and THINK mode guidance produce
 * context-aware, proactive responses instead of generic readiness.
 */

import { describe, it, expect } from "vitest";
import { composeSystemPrompt, getConstitutionBlock } from "./prompt-composer";
import type { LiTTControlDecision, CapabilityRecord } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────

const NO_CAPS: CapabilityRecord[] = [];

function makeDecision(overrides: Partial<LiTTControlDecision> = {}): LiTTControlDecision {
  return {
    requestId: "req_test",
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
      conversationId: "conv_1",
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
    ...overrides,
  };
}

const READY_CAPS: CapabilityRecord[] = [
  {
    id: "github",
    category: "repository",
    state: "ready",
    verifiedAt: new Date().toISOString(),
    permissions: ["read"],
    dependencies: [],
  },
  {
    id: "voice",
    category: "voice",
    state: "ready",
    verifiedAt: new Date().toISOString(),
    permissions: ["speak"],
    dependencies: [],
  },
];

const UNAVAILABLE_CAPS: CapabilityRecord[] = [
  {
    id: "terminal",
    category: "terminal",
    state: "offline",
    verifiedAt: new Date().toISOString(),
    permissions: [],
    dependencies: [],
  },
];

// ── Tests ─────────────────────────────────────────────────────────

describe("PERSONA_VOICE", () => {
  it("rejects generic readiness-only replies", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    // The voice must explicitly forbid generic readiness replies
    expect(prompt).toContain("Never answer with only");
    expect(prompt).toContain("ready when you are");
  });

  it("specifies normal response depth (3-6 sentences)", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("3–6 sentences");
  });

  it("instructs proactive context-aware responses", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("proactive");
    expect(prompt).toContain("operating partner");
    expect(prompt).toContain("not a passive chatbot");
  });

  it("requires mentioning 1-3 relevant facts", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("1–3 relevant facts");
  });

  it("requires suggesting up to three next moves", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("three relevant next moves");
  });

  it("enforces context discipline (no status dump)", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("Do not recite every system status");
    expect(prompt).toContain("Mention only context that helps");
  });

  it("forbids inventing capability or progress", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("Never invent status, progress, access, or completed work");
  });

  it("does not hardcode any specific user name", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).not.toContain("Larry");
    expect(prompt).not.toContain("larry");
  });

  it("does not hardcode any specific repository name", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).not.toContain("litlabs-website");
    expect(prompt).not.toContain("LabsConnected");
  });

  it("does not hardcode provider counts or terminal status", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).not.toContain("three AI providers");
    expect(prompt).not.toContain("3 providers");
    expect(prompt).not.toContain("PTY is disconnected");
  });

  it("instructs acknowledging user by name when available", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, { userName: "Alex" });
    expect(prompt).toContain("Acknowledge the user naturally by name");
    expect(prompt).toContain("User: Alex");
  });

  it("handles missing userName gracefully", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("name unknown");
  });
});

describe("THINK mode guidance", () => {
  it("includes casual check-in behavior", () => {
    const decision = makeDecision({
      routing: { ...makeDecision().routing, mode: "think" },
    });
    const prompt = composeSystemPrompt(decision, NO_CAPS);
    expect(prompt).toContain("casual greetings");
    expect(prompt).toContain("broad check-ins");
    expect(prompt).toContain("what's up");
  });

  it("instructs surfacing verified context", () => {
    const decision = makeDecision();
    const prompt = composeSystemPrompt(decision, NO_CAPS);
    expect(prompt).toContain("Surface useful verified context");
  });

  it("instructs explaining opportunity or blocker", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("opportunity or blocker");
  });

  it("instructs offering concrete directions", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("two or three concrete directions");
  });

  it("does not create artifacts for casual responses", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("Do not create artifacts");
  });
});

describe("Capability context in prompt", () => {
  it("includes verified ready capabilities", () => {
    const prompt = composeSystemPrompt(makeDecision(), READY_CAPS);
    expect(prompt).toContain("github");
    expect(prompt).toContain("voice");
    expect(prompt).toContain("Available (verified)");
  });

  it("includes unavailable capabilities with their state", () => {
    const prompt = composeSystemPrompt(makeDecision(), UNAVAILABLE_CAPS);
    expect(prompt).toContain("terminal");
    expect(prompt).toContain("offline");
    expect(prompt).toContain("Unavailable");
  });

  it("does not present unavailable capabilities as ready", () => {
    const prompt = composeSystemPrompt(makeDecision(), UNAVAILABLE_CAPS);
    // The capability block should list terminal as unavailable, not available
    const capLine = prompt.split("\n").find((l) => l.startsWith("Capabilities:"));
    expect(capLine).toBeDefined();
    expect(capLine!).toContain("Unavailable: terminal (offline)");
    // The "Available (verified)" section should NOT list terminal
    const availableMatch = capLine!.match(/Available \(verified\): ([^|]*)/);
    expect(availableMatch).toBeDefined();
    expect(availableMatch![1]).not.toContain("terminal");
  });

  it("persona instructs not presenting unavailable as ready", () => {
    const prompt = composeSystemPrompt(makeDecision(), UNAVAILABLE_CAPS);
    expect(prompt).toContain("If a capability is unavailable, say so plainly");
  });
});

describe("Constitution block", () => {
  it("returns identity and principles", () => {
    const block = getConstitutionBlock();
    expect(block).toContain("LiTT is a conversation-driven AI operating system");
    expect(block).toContain("Truth over confidence");
  });

  it("is always included in the full prompt", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS);
    expect(prompt).toContain("conversation-driven AI operating system");
    expect(prompt).toContain("Truth over confidence");
  });
});

describe("Dynamic user context", () => {
  it("includes the provided userName in the context block", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, { userName: "Sam" });
    expect(prompt).toContain("User: Sam");
  });

  it("trims whitespace from userName", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, { userName: "  Jordan  " });
    expect(prompt).toContain("User: Jordan");
    expect(prompt).not.toContain("User:   Jordan  ");
  });

  it("treats empty userName as unknown", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, { userName: "   " });
    expect(prompt).toContain("name unknown");
  });

  it("treats undefined userName as unknown", () => {
    const prompt = composeSystemPrompt(makeDecision(), NO_CAPS, {});
    expect(prompt).toContain("name unknown");
  });
});
