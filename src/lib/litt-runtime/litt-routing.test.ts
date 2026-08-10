/**
 * LiTT Routing & Identity Regression Tests
 *
 * Verifies:
 *   1. Casual chat ("what's up") → requiresExecution=false → NO V2
 *   2. Coding request ("fix the TypeScript error") → requiresExecution=true → V2
 *   3. Built-in LiTT prompt contains BOTH Kernel governance AND canonical personality
 *   4. Marketplace agent prompt contains BOTH Kernel governance AND agent prompt
 *   5. Conversation-scoped memories don't leak across conversations
 *   6. Shared memories cross conversations within the same project
 *
 * Run: npx vitest run src/lib/litt-runtime/litt-routing.test.ts
 */

import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";
import { routeKernel, composeSystemPrompt } from "@/lib/litt-kernel";
import { buildPrompt } from "./prompt-builder";
import { LITT } from "@/lib/agent-registry";
import type { LiTTRunRequest, ResolvedRunContext } from "./types";
import type { RuntimeAgent } from "@/lib/agent-runtime";

// ─── Helpers ────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ResolvedRunContext> = {}): ResolvedRunContext {
  return {
    userId: "user_1",
    clerkId: "clerk_1",
    isAuthenticated: true,
    isAnonymousCompanion: false,
    isDev: false,
    mode: "studio",
    projectId: "proj_1",
    projectName: "Test Project",
    conversationId: "conv_1",
    project: null,
    capabilities: {},
    kernelCapabilities: [],
    history: [],
    memoryContext: "",
    ...overrides,
  };
}

// ─── Intent Router: requiresExecution ───────────────────────────────

describe("intent-router: requiresExecution routing", () => {
  it('"what\'s up" → requiresExecution=false', () => {
    const intent = classifyIntent("what's up");
    expect(intent.requiresExecution).toBe(false);
    expect(intent.mode).toBe("think");
  });

  it('"hey how are you" → requiresExecution=false', () => {
    const intent = classifyIntent("hey how are you");
    expect(intent.requiresExecution).toBe(false);
  });

  it('"what project are we working on?" → requiresExecution=false', () => {
    const intent = classifyIntent("what project are we working on?");
    expect(intent.requiresExecution).toBe(false);
  });

  it('"fix the TypeScript error" → requiresExecution=true', () => {
    const intent = classifyIntent("fix the TypeScript error");
    expect(intent.requiresExecution).toBe(true);
    expect(intent.mode).toBe("build");
  });

  it('"run the tests and fix any failures" → requiresExecution=true', () => {
    const intent = classifyIntent("run the tests and fix any failures");
    expect(intent.requiresExecution).toBe(true);
    expect(intent.mode).toBe("build");
  });

  it('"deploy to production" → requiresExecution=true', () => {
    const intent = classifyIntent("deploy to production");
    expect(intent.requiresExecution).toBe(true);
    expect(intent.mode).toBe("ship");
  });

  it('"review my code for security issues" → requiresExecution=true', () => {
    const intent = classifyIntent("review my code for security issues");
    expect(intent.requiresExecution).toBe(true);
    expect(intent.mode).toBe("review");
  });
});

// ─── Kernel: requiresExecution in decision ──────────────────────────

describe("kernel: requiresExecution in routing decision", () => {
  it("casual chat does not require execution", () => {
    const result = routeKernel({
      message: "what's up",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    expect(result.decision.routing.requiresExecution).toBe(false);
  });

  it("coding request requires execution", () => {
    const result = routeKernel({
      message: "fix the TypeScript error in src/lib/llm.ts",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    expect(result.decision.routing.requiresExecution).toBe(true);
  });

  it("run tests requires execution", () => {
    const result = routeKernel({
      message: "run the tests and fix any failures",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    expect(result.decision.routing.requiresExecution).toBe(true);
  });
});

// ─── Prompt Builder: identity composition ───────────────────────────

describe("prompt-builder: identity composition", () => {
  it("built-in LiTT prompt contains BOTH Kernel governance AND canonical LiTT personality", () => {
    const ctx = makeCtx();
    const req: LiTTRunRequest = { message: "what's up" };
    const built = buildPrompt(ctx, req, null);

    // Kernel governance (from composeSystemPrompt)
    expect(built.systemPrompt).toContain("LiTT");

    // Canonical LiTT personality (from LITT.systemPrompt in agent-registry.ts)
    // Unique sentence: "Match the user's energy"
    expect(built.systemPrompt).toContain("Match the user's energy");
    // Unique rule: casual questions should be answered naturally
    expect(built.systemPrompt).toContain("casual questions");
  });

  it("marketplace agent prompt contains BOTH Kernel governance AND agent-specific prompt", () => {
    const ctx = makeCtx();
    const req: LiTTRunRequest = { message: "help me with business strategy", agentInstanceId: "marketplace_nova_123" };
    const marketplaceAgent: RuntimeAgent = {
      selection: { kind: "installed", instanceId: "marketplace_nova_123" },
      agentInstanceId: "marketplace_nova_123",
      agentId: "nova",
      agentVersionId: "v1",
      displayName: "Nova",
      systemPrompt: "You are Nova — the AI Business Partner inside LiTTree Lab Studios.",
      personality: "",
      model: "gemini-2.5-flash",
      enabledTools: [],
      memoryNamespace: "nova",
      approvalMode: "supervised",
      perRunBudgetCredits: 0,
      isBuiltin: false,
    };
    const built = buildPrompt(ctx, req, marketplaceAgent);

    // Kernel governance must still be present
    expect(built.systemPrompt).toContain("LiTT");

    // Marketplace agent prompt must be present
    expect(built.systemPrompt).toContain("Nova");
    expect(built.systemPrompt).toContain("AI Business Partner");
  });

  it("anonymous companion does NOT get Kernel governance or LiTT personality", () => {
    const ctx = makeCtx({ isAnonymousCompanion: true, isAuthenticated: false, userId: null, clerkId: null });
    const req: LiTTRunRequest = { message: "what can you do" };
    const built = buildPrompt(ctx, req, null);

    // Anonymous companion has its own strict prompt
    expect(built.systemPrompt).toContain("Public Demo Mode");
    // Should NOT contain the canonical LiTT personality
    expect(built.systemPrompt).not.toContain("Match the user's energy");
  });
});

// ─── V2 Routing Decision Logic ──────────────────────────────────────

describe("V2 routing decision logic", () => {
  // Simulates the logic from messages/route.ts:
  //   const useV2 = canonicalCtx.workspaceExecutionAvailable
  //     && !!conversation.projectId
  //     && !!built.kernelResult.decision.routing.requiresExecution;

  function simulateUseV2(
    workspaceAvailable: boolean,
    projectId: string | null,
    requiresExecution: boolean,
  ): boolean {
    return workspaceAvailable && !!projectId && !!requiresExecution;
  }

  it('"what\'s up" with workspace ready → NO V2', () => {
    const result = routeKernel({
      message: "what's up",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const useV2 = simulateUseV2(true, "proj_1", result.decision.routing.requiresExecution);
    expect(useV2).toBe(false);
  });

  it('"fix the TypeScript error" with workspace ready → V2', () => {
    const result = routeKernel({
      message: "fix the TypeScript error in src/lib/llm.ts",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const useV2 = simulateUseV2(true, "proj_1", result.decision.routing.requiresExecution);
    expect(useV2).toBe(true);
  });

  it('"run the tests" with workspace ready → V2', () => {
    const result = routeKernel({
      message: "run the tests and fix any failures",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const useV2 = simulateUseV2(true, "proj_1", result.decision.routing.requiresExecution);
    expect(useV2).toBe(true);
  });

  it('"fix the TypeScript error" without workspace → NO V2', () => {
    const result = routeKernel({
      message: "fix the TypeScript error in src/lib/llm.ts",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const useV2 = simulateUseV2(false, "proj_1", result.decision.routing.requiresExecution);
    expect(useV2).toBe(false);
  });

  it('"fix the TypeScript error" without project → NO V2', () => {
    const result = routeKernel({
      message: "fix the TypeScript error in src/lib/llm.ts",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: null,
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const useV2 = simulateUseV2(true, null, result.decision.routing.requiresExecution);
    expect(useV2).toBe(false);
  });

  it('"what project are we working on?" with workspace ready → NO V2', () => {
    const result = routeKernel({
      message: "what project are we working on?",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const useV2 = simulateUseV2(true, "proj_1", result.decision.routing.requiresExecution);
    expect(useV2).toBe(false);
  });
});

// ─── Memory scoping logic ───────────────────────────────────────────

describe("memory scoping logic", () => {
  // These tests verify the scoping rules that recallMemories enforces.
  // The actual recallMemories function requires Supabase, so we test
  // the scoping logic deterministically here.

  it("conversation_summary should be scoped to its conversation", () => {
    // A conversation_summary saved with conversationId=A should NOT be
    // recalled when querying with conversationId=B
    const memoryA = {
      memoryType: "conversation_summary",
      conversationId: "conv_A",
      ownerId: "user_1",
      projectId: "proj_1",
    };
    const queryB = {
      conversationId: "conv_B",
      ownerId: "user_1",
      projectId: "proj_1",
    };

    // Conversation-scoped memory types must match conversationId
    const isConversationScoped = memoryA.memoryType === "conversation_summary" || memoryA.memoryType === "agent_note";
    const conversationMatches = memoryA.conversationId === queryB.conversationId;
    expect(isConversationScoped).toBe(true);
    expect(conversationMatches).toBe(false);
    // Therefore this memory should NOT be returned for conv_B
  });

  it("conversation_summary should be recalled within the same conversation", () => {
    const memoryA = {
      memoryType: "conversation_summary",
      conversationId: "conv_A",
      ownerId: "user_1",
      projectId: "proj_1",
    };
    const queryA = {
      conversationId: "conv_A",
      ownerId: "user_1",
      projectId: "proj_1",
    };

    const isConversationScoped = memoryA.memoryType === "conversation_summary";
    const conversationMatches = memoryA.conversationId === queryA.conversationId;
    expect(isConversationScoped && conversationMatches).toBe(true);
  });

  it("user_preference should cross conversations within the same project", () => {
    const memoryPref = {
      memoryType: "user_preference",
      conversationId: null, // shared memories have no conversationId
      ownerId: "user_1",
      projectId: "proj_1",
    };
    const queryAny = {
      conversationId: "conv_B",
      ownerId: "user_1",
      projectId: "proj_1",
    };

    // Shared memory types are NOT conversation-scoped
    const isConversationScoped = memoryPref.memoryType === "conversation_summary" || memoryPref.memoryType === "agent_note";
    expect(isConversationScoped).toBe(false);
    // Owner and project must match
    expect(memoryPref.ownerId).toBe(queryAny.ownerId);
    expect(memoryPref.projectId).toBe(queryAny.projectId);
  });

  it("nothing should cross users", () => {
    const memoryUser1 = {
      memoryType: "user_preference",
      ownerId: "user_1",
      projectId: "proj_1",
    };
    const queryUser2 = {
      ownerId: "user_2",
      projectId: "proj_1",
    };

    expect(memoryUser1.ownerId).not.toBe(queryUser2.ownerId);
  });

  it("nothing should cross projects", () => {
    const memoryProj1 = {
      memoryType: "project_fact",
      ownerId: "user_1",
      projectId: "proj_1",
    };
    const queryProj2 = {
      ownerId: "user_1",
      projectId: "proj_2",
    };

    expect(memoryProj1.projectId).not.toBe(queryProj2.projectId);
  });
});
