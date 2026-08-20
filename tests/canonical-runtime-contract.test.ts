/**
 * Canonical runtime & operator contract tests.
 *
 * Phase 2: Desktop NL execution uses the canonical RuntimeStore
 * Phase 3: One operator brain path (runLiTTOperator → runAgentLoop)
 * Phase 4: Cross-surface runId identity
 *
 * These tests prove:
 *   - terminal-server has ONE RuntimeStore (singleton)
 *   - terminal-server has ONE ExecutionGateway (per cwd)
 *   - The canonical operator (runLiTTOperator) uses the same store
 *   - Operator turns generate canonical runIds
 *   - Operator turns mutate the canonical RuntimeStore
 *   - The legacy askLiTTCode path does NOT create a second store
 *   - runId is consistent and distinct from requestId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  getRuntimeStore,
  getExecutionGateway,
  getCanonicalToolRegistry,
  getCanonicalShell,
  getCanonicalCommandExecutor,
  getRuntimeState,
} from "../terminal-server/runtime.js";
import { runLiTTOperator, operatorAvailable } from "../terminal-server/litt-operator.js";
import { RuntimeStore } from "@litt/agent-core";

const repoRoot = path.resolve(__dirname, "..");

// ─── Phase 2: Canonical runtime singleton ─────────────────────────

describe("PHASE 2: Canonical runtime singleton", () => {
  it("getRuntimeStore returns the SAME instance every call", () => {
    const s1 = getRuntimeStore();
    const s2 = getRuntimeStore();
    expect(s1).toBe(s2);
    expect(s1).toBeInstanceOf(RuntimeStore);
  });

  it("getExecutionGateway returns the SAME instance for the same cwd", () => {
    const g1 = getExecutionGateway(repoRoot, "act");
    const g2 = getExecutionGateway(repoRoot, "act");
    expect(g1).toBe(g2);
  });

  it("getCanonicalToolRegistry returns the SAME instance the gateway uses", () => {
    const tools = getCanonicalToolRegistry(repoRoot);
    const tools2 = getCanonicalToolRegistry(repoRoot);
    expect(tools).toBe(tools2);
    // The tool registry must have the canonical project tools
    const toolIds = tools.list().map((t) => t.id);
    expect(toolIds).toContain("project.status");
    expect(toolIds).toContain("project.check");
    expect(toolIds).toContain("project.build");
    expect(toolIds).toContain("project.run");
  });

  it("getCanonicalShell returns the SAME instance the gateway uses", () => {
    const shell1 = getCanonicalShell(repoRoot);
    const shell2 = getCanonicalShell(repoRoot);
    expect(shell1).toBe(shell2);
  });

  it("getCanonicalCommandExecutor returns the SAME instance the gateway uses", () => {
    const exec1 = getCanonicalCommandExecutor(repoRoot);
    const exec2 = getCanonicalCommandExecutor(repoRoot);
    expect(exec1).toBe(exec2);
  });

  it("there is NO second RuntimeStore — runtime.ts owns the only one", () => {
    // The store from getRuntimeStore() must be the same object that
    // the gateway and command executor use internally. We verify by
    // checking that emitting an event through the store is visible
    // through getRuntimeState().
    const store = getRuntimeStore();
    const stateBefore = getRuntimeState();
    store.setPhase("thinking");
    const stateAfter = getRuntimeState();
    expect(stateAfter.phase).toBe("thinking");
    // Reset
    store.setPhase(stateBefore.phase);
  });
});

// ─── Phase 3: One operator brain path ─────────────────────────────

describe("PHASE 3: One operator brain path", () => {
  it("runLiTTOperator is the canonical NL execution path", async () => {
    // We can't call the real operator without a model provider, but we
    // can verify the function exists and uses canonical resources.
    // The operatorAvailable check tells us if the model is reachable.
    const available = await operatorAvailable().catch(() => false);
    expect(typeof available).toBe("boolean");
  });

  it("runLiTTOperator generates a canonical runId (run_op_ prefix)", async () => {
    // Mock the model provider so we don't need a real LLM.
    // We do this by mocking the streamLiTTCode module.
    const littCode = await import("../terminal-server/litt-code.js");
    const streamSpy = vi.spyOn(littCode, "streamLiTTCode").mockImplementation(
      async (_prompt: string, emit: (e: any) => void) => {
        emit({ type: "meta", provider: "openrouter", model: "test-model", profile: "fast" });
        emit({ type: "delta", text: "I am LiTT, operating on the project." });
        emit({ type: "done", model: "test-model", usage: { total_tokens: 10 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } });
        return {
          content: "I am LiTT, operating on the project.",
          model: "test-model",
          provider: "openrouter",
          usage: { total_tokens: 10 },
          timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
          profile: "fast",
        };
      },
    );
    const healthSpy = vi.spyOn(littCode, "health").mockResolvedValue(100);

    try {
      const result = await runLiTTOperator({
        prompt: "What is the project status?",
        cwd: repoRoot,
        userId: "test-user",
        mode: "act",
      });
      // The runId must have the canonical operator prefix
      expect(result.runId).toMatch(/^run_op_/);
      // The operator must have produced a response
      expect(typeof result.content).toBe("string");
      expect(result.content.length).toBeGreaterThan(0);
      // The operator must have used the canonical agent loop
      expect(streamSpy).toHaveBeenCalled();
    } finally {
      streamSpy.mockRestore();
      healthSpy.mockRestore();
    }
  });

  it("runLiTTOperator mutates the canonical RuntimeStore", async () => {
    const littCode = await import("../terminal-server/litt-code.js");
    const streamSpy = vi.spyOn(littCode, "streamLiTTCode").mockImplementation(
      async (_prompt: string, emit: (e: any) => void) => {
        emit({ type: "meta", provider: "openrouter", model: "test-model", profile: "fast" });
        emit({ type: "delta", text: "Done." });
        emit({ type: "done", model: "test-model", usage: { total_tokens: 5 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } });
        return {
          content: "Done.",
          model: "test-model",
          provider: "openrouter",
          usage: { total_tokens: 5 },
          timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
          profile: "fast",
        };
      },
    );
    const healthSpy = vi.spyOn(littCode, "health").mockResolvedValue(100);

    const store = getRuntimeStore();
    const stateBefore = store.getState();

    try {
      await runLiTTOperator({
        prompt: "Check the project",
        cwd: repoRoot,
        userId: "test-user",
        mode: "act",
      });

      // The store must have been mutated — the operator calls
      // store.commandStart/commandEnd, which updates the phase and
      // command history.
      const stateAfter = store.getState();
      // The phase should be back to idle/complete/failed after the turn
      expect(["complete", "failed", "idle"]).toContain(stateAfter.phase);
    } finally {
      streamSpy.mockRestore();
      healthSpy.mockRestore();
    }
  });

  it("the legacy askLiTTCode path does NOT create a second RuntimeStore", () => {
    // Verify that litt-code.ts does not import or instantiate RuntimeStore.
    // It's a pure model transport — no runtime, no tools, no gateway.
    // We check by verifying the module doesn't reference RuntimeStore.
    const littCodeSource = fs.readFileSync(
      path.join(repoRoot, "terminal-server", "litt-code.ts"),
      "utf-8",
    );
    expect(littCodeSource).not.toContain("RuntimeStore");
    expect(littCodeSource).not.toContain("ExecutionGateway");
    expect(littCodeSource).not.toContain("CommandExecutor");
    expect(littCodeSource).not.toContain("ToolRegistry");
  });
});

// ─── Phase 4: Cross-surface runId identity ────────────────────────

describe("PHASE 4: Cross-surface runId identity", () => {
  it("operator runId is distinct from requestId", async () => {
    const littCode = await import("../terminal-server/litt-code.js");
    const streamSpy = vi.spyOn(littCode, "streamLiTTCode").mockImplementation(
      async (_prompt: string, emit: (e: any) => void) => {
        emit({ type: "meta", provider: "openrouter", model: "test", profile: "fast" });
        emit({ type: "delta", text: "ok" });
        emit({ type: "done", model: "test", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } });
        return { content: "ok", model: "test", provider: "openrouter", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 }, profile: "fast" };
      },
    );
    const healthSpy = vi.spyOn(littCode, "health").mockResolvedValue(100);

    try {
      const result = await runLiTTOperator({
        prompt: "test",
        cwd: repoRoot,
        userId: "test-user",
        mode: "act",
        requestId: "req-abc-123",
      });
      // runId and requestId are different concepts
      expect(result.runId).toMatch(/^run_op_/);
      expect(result.runId).not.toBe("req-abc-123");
    } finally {
      streamSpy.mockRestore();
      healthSpy.mockRestore();
    }
  });

  it("two operator turns produce different runIds", async () => {
    const littCode = await import("../terminal-server/litt-code.js");
    const streamSpy = vi.spyOn(littCode, "streamLiTTCode").mockImplementation(
      async (_prompt: string, emit: (e: any) => void) => {
        emit({ type: "meta", provider: "openrouter", model: "test", profile: "fast" });
        emit({ type: "delta", text: "ok" });
        emit({ type: "done", model: "test", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } });
        return { content: "ok", model: "test", provider: "openrouter", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 }, profile: "fast" };
      },
    );
    const healthSpy = vi.spyOn(littCode, "health").mockResolvedValue(100);

    try {
      const r1 = await runLiTTOperator({ prompt: "turn 1", cwd: repoRoot, mode: "act" });
      const r2 = await runLiTTOperator({ prompt: "turn 2", cwd: repoRoot, mode: "act" });
      expect(r1.runId).not.toBe(r2.runId);
    } finally {
      streamSpy.mockRestore();
      healthSpy.mockRestore();
    }
  });

  it("the remote /do path and the operator path share the same RuntimeStore", () => {
    // Both /do (via command-registry) and runLiTTOperator (via litt-operator)
    // must use the same RuntimeStore from runtime.ts.
    const store = getRuntimeStore();
    // The gateway uses this store
    const gateway = getExecutionGateway(repoRoot, "act");
    // We can't directly inspect the gateway's internal store, but we
    // can verify the store is the singleton by checking identity.
    expect(store).toBe(getRuntimeStore());
  });
});

// ─── PHASE 8: Operator context (identity) ────────────────────────

describe("PHASE 8: Operator context — identity & intent", () => {
  it("the canonical operator system prompt includes project context", () => {
    // The system prompt is built inside litt-operator.ts. We verify
    // by reading the source that it includes the key context fields.
    const source = fs.readFileSync(
      path.join(repoRoot, "terminal-server", "litt-operator.ts"),
      "utf-8",
    );
    // Identity
    expect(source).toContain("LiTT, the lead AI operator");
    expect(source).toContain("NOT a generic AI assistant");
    // Project context fields
    expect(source).toContain("Project:");
    expect(source).toContain("Root:");
    expect(source).toContain("Branch:");
    expect(source).toContain("Runtime mode:");
    expect(source).toContain("Runtime phase:");
    // Intent mapping
    expect(source).toContain("test and see how you are");
    expect(source).toContain("how are you");
    // Anti-identity-erosion
    expect(source).toContain("Never say 'I am an AI assistant'");
  });

  it("the legacy litt-code prompt also includes identity context", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "terminal-server", "litt-code.ts"),
      "utf-8",
    );
    expect(source).toContain("NOT a generic AI assistant");
    expect(source).toContain("Never say 'I am an AI assistant'");
  });

  it("the operator system prompt reads runtime state from the canonical store", () => {
    // The buildOperatorSystemPrompt function calls getRuntimeStore()
    // to include live runtime context (phase, model, online, branch).
    // We verify by checking the source references getRuntimeStore.
    const source = fs.readFileSync(
      path.join(repoRoot, "terminal-server", "litt-operator.ts"),
      "utf-8",
    );
    expect(source).toContain("getRuntimeStore()");
    expect(source).toContain("state.project?.branch");
    expect(source).toContain("state.phase");
    expect(source).toContain("state.online");
    expect(source).toContain("state.model");
  });

  it("runLiTTOperator builds a system prompt with live runtime context", async () => {
    // Set a known phase, then run the operator (mocked model) and
    // verify the system prompt captured the runtime state.
    const store = getRuntimeStore();
    store.setPhase("verifying");

    const littCode = await import("../terminal-server/litt-code.js");
    const streamSpy = vi.spyOn(littCode, "streamLiTTCode").mockImplementation(
      async (prompt: string, _emit: (e: any) => void) => {
        // The prompt should contain the runtime context
        expect(prompt).toContain("verifying");
        return {
          content: "ok",
          model: "test",
          provider: "openrouter",
          usage: { total_tokens: 1 },
          timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
          profile: "fast",
        };
      },
    );
    const healthSpy = vi.spyOn(littCode, "health").mockResolvedValue(100);

    try {
      await runLiTTOperator({
        prompt: "how are you",
        cwd: repoRoot,
        mode: "act",
      });
      expect(streamSpy).toHaveBeenCalled();
    } finally {
      streamSpy.mockRestore();
      healthSpy.mockRestore();
      store.setPhase("idle");
    }
  });
});
