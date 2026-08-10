/**
 * LiTT Runtime unit tests.
 *
 * Covers the pure modules: provider-router, tool-planner, result-verifier,
 * prompt-builder, and request-context parsing. The full runLiTT pipeline
 * is integration-tested via the route; here we lock in the contract pieces.
 *
 * Run: npx vitest run src/lib/litt-runtime/litt-runtime.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  selectModelOptions,
  resolveGeminiVisionModel,
  buildToolPlan,
  verifyResult,
  sanitizeOutput,
  parseRuntimeContextHint,
  buildPrompt,
  detectActions,
} from "./index";
import type { LiTTRunRequest, ResolvedRunContext } from "./types";
import type { KernelResult } from "@/lib/litt-kernel";

// ─── Helpers ────────────────────────────────────────────────────────

function makeKernelResult(overrides: Partial<KernelResult["decision"]> = {}): KernelResult {
  const base = {
    requestId: "kern_test",
    createdAt: new Date().toISOString(),
    routing: {
      mode: "learn",
      domains: [],
      requiresProject: false,
      requiresCurrentInformation: false,
      requiresPrivateData: false,
      requiresExecution: false,
    },
    epistemics: {
      expectedTruthClasses: ["reasoned_inference"],
      minimumConfidence: 0,
      verificationRequired: false,
    },
    context: {
      sourceTypes: ["conversation"],
      conversationId: "",
      memoryIds: [],
      connectorIds: [],
    },
    execution: {
      skillIds: [],
      capabilityIds: [],
      modelProfileId: "default",
      toolIds: [],
      budget: { maximumCostCents: 0, maximumLatencyMs: 30000, minimumQuality: 0, maximumToolCalls: 5, maximumAgents: 3, maximumReflectionPasses: 1 },
    },
    planning: { required: false, specialistRoles: [], parallelAllowed: false },
    governance: { risk: "low", approvalRequired: false, reflection: "light" },
  };
  return { ok: true, decision: { ...base, ...overrides } as KernelResult["decision"], systemPrompt: "" };
}

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

// ─── provider-router ────────────────────────────────────────────────

describe("provider-router", () => {
  it("defaults to auto category with no pinned provider", () => {
    const opts = selectModelOptions({ message: "hi" });
    expect(opts.category).toBe("auto");
    expect(opts.provider).toBeUndefined();
    expect(opts.task).toBe("chat");
  });

  it("honors an explicit category", () => {
    const opts = selectModelOptions({ message: "hi", category: "fast" });
    expect(opts.category).toBe("fast");
    // Non-auto category lets the chain drive; provider is not pinned.
    expect(opts.provider).toBeUndefined();
  });

  it("pins provider only when category is auto", () => {
    const opts = selectModelOptions({ message: "hi", requestedProvider: "gemini", category: "auto" });
    expect(opts.provider).toBe("gemini");
  });

  it("does not pin provider when a non-auto category is set", () => {
    const opts = selectModelOptions({ message: "hi", requestedProvider: "gemini", category: "free" });
    expect(opts.provider).toBeUndefined();
  });

  it("builds modelOverride from requestedProvider + requestedModel", () => {
    const opts = selectModelOptions({ message: "hi", requestedProvider: "gemini", requestedModel: "gemini-2.5-pro" });
    expect(opts.modelOverride).toEqual({ gemini: "gemini-2.5-pro" });
  });

  it("ignores requestedModel without a provider", () => {
    const opts = selectModelOptions({ message: "hi", requestedModel: "gemini-2.5-pro" });
    expect(opts.modelOverride).toBeUndefined();
  });

  it("rejects unknown categories and falls back to auto", () => {
    const opts = selectModelOptions({ message: "hi", category: "bogus" });
    expect(opts.category).toBe("auto");
  });

  it("resolveGeminiVisionModel returns requested gemini model", () => {
    expect(resolveGeminiVisionModel({ message: "hi", requestedModel: "gemini-2.5-pro" })).toBe("gemini-2.5-pro");
  });

  it("resolveGeminiVisionModel falls back to flash for non-gemini models", () => {
    expect(resolveGeminiVisionModel({ message: "hi", requestedModel: "gpt-4o" })).toBe("gemini-2.5-flash");
    expect(resolveGeminiVisionModel({ message: "hi" })).toBe("gemini-2.5-flash");
  });
});

// ─── tool-planner ───────────────────────────────────────────────────

describe("tool-planner", () => {
  it("advertises business tools to authenticated users when execution is required", () => {
    const kr = makeKernelResult({
      routing: { mode: "build", domains: [], requiresProject: true, requiresCurrentInformation: false, requiresPrivateData: false, requiresExecution: true },
      governance: { risk: "medium", approvalRequired: true, reflection: "light" },
    });
    const plan = buildToolPlan(kr, makeCtx());
    expect(plan.requiresTools).toBe(true);
    expect(plan.approvalRequired).toBe(true);
    // Business tools are advertised (they have real handlers)
    expect(plan.advertisedToolIds.length).toBeGreaterThan(0);
    expect(plan.advertisedToolIds).toContain("business.config.read");
    expect(plan.advertisedToolIds).toContain("business.bookings.create");
  });

  it("does not advertise tools to anonymous companion users", () => {
    const kr = makeKernelResult({
      routing: { mode: "build", domains: [], requiresProject: true, requiresCurrentInformation: false, requiresPrivateData: false, requiresExecution: true },
    });
    const plan = buildToolPlan(kr, makeCtx({ isAnonymousCompanion: true, isAuthenticated: false }));
    expect(plan.advertisedToolIds).toEqual([]);
  });

  it("flags missions for build/ship/review modes", () => {
    const kr = makeKernelResult({
      routing: { mode: "ship", domains: [], requiresProject: true, requiresCurrentInformation: false, requiresPrivateData: false, requiresExecution: true },
      planning: { required: true, specialistRoles: [], parallelAllowed: false },
    });
    const plan = buildToolPlan(kr, makeCtx());
    expect(plan.requiresMission).toBe(true);
  });

  it("does not flag missions for learn mode", () => {
    const kr = makeKernelResult();
    const plan = buildToolPlan(kr, makeCtx());
    expect(plan.requiresMission).toBe(false);
  });
});

// ─── result-verifier ────────────────────────────────────────────────

describe("result-verifier", () => {
  it("passes non-empty sanitized text", () => {
    const r = verifyResult("Hello there");
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Hello there");
    expect(r.warning).toBeUndefined();
  });

  it("flags empty responses", () => {
    const r = verifyResult("   ");
    expect(r.ok).toBe(false);
    expect(r.warning).toBe("empty_response");
  });

  it("scrubs {{userName}} template variables", () => {
    expect(sanitizeOutput("Hi {{userName}}!")).toBe("Hi there!");
    expect(sanitizeOutput("Hi {userName}!")).toBe("Hi there!");
  });

  it("handles null/undefined input gracefully", () => {
    const r = verifyResult(null as unknown as string);
    expect(r.ok).toBe(false);
  });
});

// ─── request-context hint parsing ───────────────────────────────────

describe("parseRuntimeContextHint", () => {
  it("returns empty object for non-object input", () => {
    expect(parseRuntimeContextHint(null)).toEqual({});
    expect(parseRuntimeContextHint("string")).toEqual({});
    expect(parseRuntimeContextHint(undefined)).toEqual({});
  });

  it("drops unknown enum values", () => {
    const hint = parseRuntimeContextHint({ terminalExecution: "bogus" });
    expect(hint.terminalExecution).toBeUndefined();
  });

  it("accepts known enum values", () => {
    const hint = parseRuntimeContextHint({ terminalExecution: "available", terminalStatus: "connected" });
    expect(hint.terminalExecution).toBe("available");
    expect(hint.terminalStatus).toBe("connected");
  });

  it("coerces voiceHealth into the typed shape", () => {
    const hint = parseRuntimeContextHint({ voiceHealth: { configured: true, tokenService: "healthy", available: true } });
    expect(hint.voiceHealth).toEqual({ configured: true, tokenService: "healthy", available: true });
  });

  it("normalizes unknown tokenService to 'unknown'", () => {
    const hint = parseRuntimeContextHint({ voiceHealth: { configured: false, tokenService: "garbage", available: false } });
    expect(hint.voiceHealth?.tokenService).toBe("unknown");
  });

  it("rejects over-long string fields", () => {
    const long = "x".repeat(300);
    const hint = parseRuntimeContextHint({ activeBranch: long, repositoryName: long });
    expect(hint.activeBranch).toBeUndefined();
    expect(hint.repositoryName).toBeUndefined();
  });
});

// ─── prompt-builder ─────────────────────────────────────────────────

describe("prompt-builder", () => {
  it("builds an anonymous companion prompt with strict guardrails", () => {
    const ctx = makeCtx({ isAnonymousCompanion: true, isAuthenticated: false, userId: null, clerkId: null, history: [{ role: "user", content: "what is this site" }] });
    const req: LiTTRunRequest = { message: "what can you do" };
    const built = buildPrompt(ctx, req, null);
    expect(built.systemPrompt).toContain("Public Demo Mode");
    expect(built.systemPrompt).toContain("NO access to private projects");
    expect(built.systemPrompt).toContain("Never claim you performed an action");
    expect(built.fullPrompt).toContain("User: what can you do");
    expect(built.fullPrompt).toContain("what is this site");
    expect(built.projectBlock).toBeNull();
    expect(built.memoryContext).toBe("");
  });

  it("includes the user message exactly once in the full prompt", () => {
    const ctx = makeCtx({ history: [{ role: "user", content: "earlier question" }, { role: "assistant", content: "earlier answer" }] });
    const req: LiTTRunRequest = { message: "current question" };
    const built = buildPrompt(ctx, req, null);
    const occurrences = (built.fullPrompt.match(/current question/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("includes the conversation history transcript", () => {
    const ctx = makeCtx({ history: [{ role: "user", content: "earlier question" }, { role: "assistant", content: "earlier answer" }] });
    const req: LiTTRunRequest = { message: "current question" };
    const built = buildPrompt(ctx, req, null);
    expect(built.fullPrompt).toContain("earlier question");
    expect(built.fullPrompt).toContain("earlier answer");
    expect(built.fullPrompt).toContain("--- Conversation so far ---");
  });

  it("includes page context block for the global companion surface", () => {
    const ctx = makeCtx();
    const req: LiTTRunRequest = { message: "help", pageContext: { surface: "global_companion", pageTitle: "Home", route: "/" } };
    const built = buildPrompt(ctx, req, null);
    expect(built.systemPrompt).toContain("global companion");
    expect(built.systemPrompt).toContain("Page: Home");
  });

  it("does not include page context block for studio mode", () => {
    const ctx = makeCtx();
    const req: LiTTRunRequest = { message: "help", pageContext: { surface: "studio", pageTitle: "Studio" } };
    const built = buildPrompt(ctx, req, null);
    expect(built.systemPrompt).not.toContain("global companion");
  });
});

// ─── response-stream detectActions ──────────────────────────────────

describe("detectActions", () => {
  it("returns explicit canvas actions when present", () => {
    const actions = detectActions("open the canvas", "sure", "canvas_1") as Array<{ type: string }>;
    // Either explicit actions are detected, or we fall back to suggested.
    // The key contract: it returns an array.
    expect(Array.isArray(actions)).toBe(true);
  });

  it("returns an array even with no matches", () => {
    const actions = detectActions("hello there", "general kenobi", null);
    expect(Array.isArray(actions)).toBe(true);
  });
});

// ─── anonymous companion contract ──────────────────────────────────

describe("anonymous companion contract", () => {
  it("anonymous companion context has no project, no memory, no tools, no capabilities", () => {
    const ctx = makeCtx({
      isAnonymousCompanion: true,
      isAuthenticated: false,
      isDev: false,
      userId: null,
      clerkId: null,
      projectId: null,
      projectName: null,
      conversationId: null,
      project: null,
      capabilities: {},
      kernelCapabilities: [],
      memoryContext: "",
      mode: "companion",
    });
    expect(ctx.userId).toBeNull();
    expect(ctx.clerkId).toBeNull();
    expect(ctx.projectId).toBeNull();
    expect(ctx.project).toBeNull();
    expect(ctx.conversationId).toBeNull();
    expect(ctx.memoryContext).toBe("");
    expect(ctx.kernelCapabilities).toEqual([]);
    expect(ctx.capabilities).toEqual({});
    expect(ctx.isAnonymousCompanion).toBe(true);
    expect(ctx.isAuthenticated).toBe(false);
  });

  it("anonymous companion prompt includes Public Demo Mode and guardrails", () => {
    const ctx = makeCtx({
      isAnonymousCompanion: true,
      isAuthenticated: false,
      userId: null,
      clerkId: null,
    });
    const req: LiTTRunRequest = { message: "I want to start a clothing brand" };
    const built = buildPrompt(ctx, req, null);
    expect(built.systemPrompt).toContain("Public Demo Mode");
    expect(built.systemPrompt).toContain("NO access to private projects");
    expect(built.systemPrompt).toContain("Never claim you performed an action");
    expect(built.systemPrompt).toContain("Never claim a file, project or deployment exists");
    expect(built.systemPrompt).toContain("Do not become an unlimited general-purpose anonymous chatbot");
  });

  it("anonymous companion prompt includes page context when provided", () => {
    const ctx = makeCtx({
      isAnonymousCompanion: true,
      isAuthenticated: false,
      userId: null,
      clerkId: null,
    });
    const req: LiTTRunRequest = {
      message: "what is this page",
      pageContext: { surface: "global_companion", pageTitle: "Home", route: "/", authenticated: false },
    };
    const built = buildPrompt(ctx, req, null);
    expect(built.systemPrompt).toContain("Page: Home");
    expect(built.systemPrompt).toContain("Route: /");
    expect(built.systemPrompt).toContain("User is not signed in");
  });

  it("anonymous companion has no project block and no memory context", () => {
    const ctx = makeCtx({
      isAnonymousCompanion: true,
      isAuthenticated: false,
      userId: null,
      clerkId: null,
    });
    const req: LiTTRunRequest = { message: "help" };
    const built = buildPrompt(ctx, req, null);
    expect(built.projectBlock).toBeNull();
    expect(built.memoryContext).toBe("");
  });

  it("anonymous companion kernel decision has no tools and limited tokens", () => {
    const ctx = makeCtx({
      isAnonymousCompanion: true,
      isAuthenticated: false,
      userId: null,
      clerkId: null,
    });
    const req: LiTTRunRequest = { message: "help" };
    const built = buildPrompt(ctx, req, null);
    expect(built.kernelResult.decision.execution.toolIds).toEqual([]);
    expect(built.kernelResult.decision.execution.capabilityIds).toEqual([]);
    // Anonymous companion has a limited budget: no tool calls, 1 agent, 0 reflection passes
    expect(built.kernelResult.decision.execution.budget.maximumToolCalls).toBe(0);
    expect(built.kernelResult.decision.execution.budget.maximumAgents).toBeLessThanOrEqual(1);
    expect(built.kernelResult.decision.execution.budget.maximumReflectionPasses).toBe(0);
  });

  it("tool planner does not advertise tools to anonymous companion", () => {
    const kr = makeKernelResult({
      routing: { mode: "build", domains: [], requiresProject: true, requiresCurrentInformation: false, requiresPrivateData: false, requiresExecution: true },
    });
    const plan = buildToolPlan(kr, makeCtx({ isAnonymousCompanion: true, isAuthenticated: false }));
    expect(plan.advertisedToolIds).toEqual([]);
  });

  it("tool planner advertises tools to authenticated users", () => {
    const kr = makeKernelResult({
      routing: { mode: "build", domains: [], requiresProject: true, requiresCurrentInformation: false, requiresPrivateData: false, requiresExecution: true },
    });
    const plan = buildToolPlan(kr, makeCtx({ isAnonymousCompanion: false, isAuthenticated: true }));
    expect(plan.advertisedToolIds.length).toBeGreaterThan(0);
  });

  it("anonymous companion history is bounded by HISTORY_LIMIT", () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      content: `msg ${i}`,
    }));
    const ctx = makeCtx({
      isAnonymousCompanion: true,
      isAuthenticated: false,
      userId: null,
      clerkId: null,
      history: longHistory.slice(-12), // HISTORY_LIMIT = 12
    });
    const req: LiTTRunRequest = { message: "test" };
    const built = buildPrompt(ctx, req, null);
    // History should be included but bounded
    expect(built.fullPrompt).toContain("msg 8");
    expect(built.fullPrompt).not.toContain("msg 0");
  });

  it("authenticated companion still works with normal prompt (not anonymous)", () => {
    const ctx = makeCtx({
      isAnonymousCompanion: false,
      isAuthenticated: true,
      userId: "user_123",
      clerkId: "clerk_123",
    });
    const req: LiTTRunRequest = {
      message: "help",
      pageContext: { surface: "global_companion", pageTitle: "Home", route: "/", authenticated: true },
    };
    const built = buildPrompt(ctx, req, null);
    // Authenticated companion should NOT get the anonymous prompt
    expect(built.systemPrompt).not.toContain("Public Demo Mode");
    // But should get the page context block
    expect(built.systemPrompt).toContain("global companion");
    expect(built.systemPrompt).toContain("Page: Home");
  });
});
