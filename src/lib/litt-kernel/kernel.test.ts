/**
 * LiTT Kernel routing tests — blueprint cases 1-8.
 *
 * These verify the Kernel's request routing, project gating, and
 * capability verification — the core of Phase 1.
 *
 * Run: npx vitest run src/lib/litt-kernel/kernel.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { routeKernel, classifyIntent, isCapabilityReady, verifyRequiredCapabilities } from "./index";
import { serverCapabilityRegistry, CAP } from "./capability-registry";
import type { CapabilityRecord } from "./types";

// ─── Helpers ────────────────────────────────────────────────────

function makeCap(id: string, state: CapabilityRecord["state"]): CapabilityRecord {
  return {
    id,
    category: id,
    state,
    verifiedAt: new Date().toISOString(),
    permissions: [],
    dependencies: [],
  };
}

const NO_CAPS: CapabilityRecord[] = [];
const NO_PROJECT = null;
const NO_USER = null;
const NO_CONV = null;

// ─── Tests ──────────────────────────────────────────────────────

describe("Kernel routing — blueprint cases 1-8", () => {
  beforeEach(() => {
    serverCapabilityRegistry.clear();
  });

  // Case 1: General question does not require a Project.
  it("Case 1: 'explain black holes' does not require a project", () => {
    const result = routeKernel({
      message: "explain black holes",
      userId: NO_USER,
      conversationId: NO_CONV,
      projectId: NO_PROJECT,
      missionId: null,
      canvasId: null,
      capabilities: NO_CAPS,
    });
    expect(result.ok).toBe(true);
    expect(result.decision.routing.requiresProject).toBe(false);
    expect(result.decision.routing.mode).toBe("learn");
  });

  // Case 2: Creative request does not inject repository setup.
  it("Case 2: 'design a landing page' does not require a project", () => {
    const result = routeKernel({
      message: "design a landing page",
      userId: NO_USER,
      conversationId: NO_CONV,
      projectId: NO_PROJECT,
      missionId: null,
      canvasId: null,
      capabilities: NO_CAPS,
    });
    expect(result.ok).toBe(true);
    expect(result.decision.routing.requiresProject).toBe(false);
    expect(result.decision.routing.mode).toBe("create");
  });

  // Case 3: Existing-file action requires Project context.
  it("Case 3: 'edit my README' requires a project", () => {
    const result = routeKernel({
      message: "edit my README file",
      userId: NO_USER,
      conversationId: NO_CONV,
      projectId: NO_PROJECT,
      missionId: null,
      canvasId: null,
      capabilities: NO_CAPS,
    });
    expect(result.decision.routing.requiresProject).toBe(true);
    expect(result.decision.routing.mode).toBe("build");
  });

  // Case 3b: With a project active, the same request is satisfied.
  it("Case 3b: 'edit my README' with active project is satisfied", () => {
    const result = routeKernel({
      message: "edit my README file",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: NO_CAPS,
    });
    expect(result.decision.context.projectId).toBe("proj_1");
  });

  // Case 4: Blank Project works without GitHub.
  it("Case 4: build request with project but no github capability still routes", () => {
    const result = routeKernel({
      message: "add dark mode to the homepage",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_blank",
      missionId: null,
      canvasId: null,
      capabilities: NO_CAPS, // no github, no capabilities
    });
    // The request routes (ok=true) because project is active.
    // Capabilities are checked only for execution tools, and the Kernel
    // doesn't block on missing capabilities — it flags them.
    expect(result.decision.context.projectId).toBe("proj_blank");
  });

  // Case 5: Status question uses Capability Graph.
  it("Case 5: 'is voice working' routes to status mode", () => {
    const result = routeKernel({
      message: "is voice working",
      userId: NO_USER,
      conversationId: NO_CONV,
      projectId: NO_PROJECT,
      missionId: null,
      canvasId: null,
      capabilities: [makeCap(CAP.VOICE, "ready")],
    });
    expect(result.decision.routing.mode).toBe("status");
    expect(result.decision.context.connectorIds).toContain(CAP.VOICE);
  });

  // Case 6: Unverified capability never becomes ready.
  it("Case 6: unverified capability is not ready", () => {
    expect(isCapabilityReady(makeCap(CAP.VOICE, "unknown"))).toBe(false);
    expect(isCapabilityReady(makeCap(CAP.VOICE, "connecting"))).toBe(false);
    expect(isCapabilityReady(makeCap(CAP.VOICE, "limited"))).toBe(false);
    expect(isCapabilityReady(makeCap(CAP.VOICE, "degraded"))).toBe(false);
    expect(isCapabilityReady(makeCap(CAP.VOICE, "unavailable"))).toBe(false);
    expect(isCapabilityReady(undefined)).toBe(false);
    // Only "ready" is ready
    expect(isCapabilityReady(makeCap(CAP.VOICE, "ready"))).toBe(true);
  });

  // Case 6b: Expired capability is not ready.
  it("Case 6b: expired capability is not ready", () => {
    const expired: CapabilityRecord = {
      ...makeCap(CAP.VOICE, "ready"),
      expiresAt: "2020-01-01T00:00:00Z", // past
    };
    expect(isCapabilityReady(expired)).toBe(false);
  });

  // Case 7: Only relevant prompt modules are composed.
  it("Case 7: composeSystemPrompt includes mode guidance for the routed mode", async () => {
    const { composeSystemPrompt } = await import("./prompt-composer");
    const result = routeKernel({
      message: "deploy the app",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: NO_CAPS,
    });
    const prompt = composeSystemPrompt(result.decision, NO_CAPS);
    // Should include SHIP mode guidance
    expect(prompt).toContain("SHIP");
    // Should NOT include LEARN mode guidance
    expect(prompt).not.toContain("Mode: LEARN");
    // Should always include the Constitution
    expect(prompt).toContain("Truth over confidence");
  });

  // Case 8: Control decision records why tools were selected.
  it("Case 8: control decision records tool selection rationale", () => {
    const result = routeKernel({
      message: "compare current GPU prices",
      userId: NO_USER,
      conversationId: NO_CONV,
      projectId: NO_PROJECT,
      missionId: null,
      canvasId: null,
      capabilities: NO_CAPS,
    });
    expect(result.decision.routing.mode).toBe("research");
    expect(result.decision.execution.toolIds).toContain("web_search");
    expect(result.decision.execution.skillIds).toContain("research.current-events");
    // The decision has a requestId for audit trail
    expect(result.decision.requestId).toMatch(/^kern_\d+_/);
    expect(result.decision.createdAt).toBeTruthy();
  });
});

// ─── Capability verification tests ──────────────────────────────

describe("Capability verification", () => {
  it("verifyRequiredCapabilities passes when all are ready", () => {
    const caps = [makeCap("github", "ready"), makeCap("filesystem", "ready")];
    const result = verifyRequiredCapabilities(caps, ["github", "filesystem"]);
    expect(result.ok).toBe(true);
  });

  it("verifyRequiredCapabilities fails when one is missing", () => {
    const caps = [makeCap("github", "ready")];
    const result = verifyRequiredCapabilities(caps, ["github", "filesystem"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toBe("filesystem");
      expect(result.reason).toContain("not registered");
    }
  });

  it("verifyRequiredCapabilities fails when one is not ready", () => {
    const caps = [makeCap("github", "ready"), makeCap("filesystem", "connecting")];
    const result = verifyRequiredCapabilities(caps, ["github", "filesystem"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toBe("filesystem");
      expect(result.reason).toContain("connecting");
    }
  });

  it("verifyRequiredCapabilities checks dependencies", () => {
    const caps: CapabilityRecord[] = [
      { ...makeCap("deployment", "ready"), dependencies: ["vercel"] },
      makeCap("vercel", "unknown"), // dependency not ready
    ];
    const result = verifyRequiredCapabilities(caps, ["deployment"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toBe("vercel");
      expect(result.reason).toContain("depends on");
    }
  });
});

// ─── Intent classifier edge cases ───────────────────────────────

describe("Intent classifier edge cases", () => {
  it("empty message defaults to think mode with low confidence", () => {
    const intent = classifyIntent("");
    expect(intent.mode).toBe("think");
    expect(intent.confidence).toBeLessThan(0.5);
  });

  it("greeting does not require a project", () => {
    const intent = classifyIntent("hello");
    expect(intent.requiresProject).toBe(false);
  });

  it("make notes routes to create mode", () => {
    const intent = classifyIntent("make notes about the meeting");
    expect(intent.mode).toBe("create");
    expect(intent.requiresProject).toBe(false);
  });

  it("add dark mode routes to build mode and requires project", () => {
    const intent = classifyIntent("add dark mode to the homepage");
    expect(intent.mode).toBe("build");
    expect(intent.requiresProject).toBe(true);
  });

  it("deploy routes to ship mode and requires project", () => {
    const intent = classifyIntent("deploy the app to vercel");
    expect(intent.mode).toBe("ship");
    expect(intent.requiresProject).toBe(true);
  });

  it("is voice working routes to status mode", () => {
    const intent = classifyIntent("is voice working");
    expect(intent.mode).toBe("status");
    expect(intent.requiresProject).toBe(false);
  });
});
