/**
 * P0 mission-pipeline repair — deterministic regressions.
 * Scripted model, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  normalizeSemanticPlan,
  fallbackPlan,
  planMission,
  toolToEvidenceType,
  EVIDENCE_PRODUCER_TOOLS,
} from "../mission-planner.js";
import {
  runAgentLoop,
  normalizeToolCallArgs,
  validateToolCallArgs,
  detectMutationRequest,
  detectCreationRequest,
} from "../agent-loop.js";
import { RuntimeStore } from "../state.js";
import { ToolRegistry } from "../tools.js";
import type { ModelProvider, ModelStreamEvent, ToolDefinition } from "../types.js";

function scriptedModel(responses: string[]): ModelProvider {
  let i = 0;
  return {
    async stream(_messages: unknown, onEvent: (e: ModelStreamEvent) => void) {
      const text = responses[Math.min(i++, responses.length - 1)] ?? "";
      if (onEvent) onEvent({ type: "delta", text } as ModelStreamEvent);
      return { content: text, model: "scripted", usage: { total_tokens: 1 } } as never;
    },
  } as unknown as ModelProvider;
}

function emptyStore() {
  return new RuntimeStore({});
}

// ─── Evidence contract ─────────────────────────────────────────────
test("project.check maps to typecheck_result; producers table is canonical", () => {
  assert.equal(toolToEvidenceType("project.check"), "typecheck_result");
  assert.equal(toolToEvidenceType("project.typecheck"), "typecheck_result");
  assert.equal(toolToEvidenceType("project.log"), "repository_status");
  assert.equal(toolToEvidenceType("project.branch"), "repository_status");
  assert.equal(toolToEvidenceType("project.inspect_package"), "file_read");
  assert.equal(EVIDENCE_PRODUCER_TOOLS.typecheck_result, "project.check");
  assert.equal(EVIDENCE_PRODUCER_TOOLS.test_result, "project.test");
  assert.equal(EVIDENCE_PRODUCER_TOOLS.build_result, "project.build");
  assert.equal(EVIDENCE_PRODUCER_TOOLS.repository_status, "project.status");
});

// ─── Planner policy ────────────────────────────────────────────────
test("verification_result is always stripped from step requiredEvidence", () => {
  const steps = normalizeSemanticPlan([
    { title: "Verify", requiredEvidence: ["verification_result"] },
    { title: "Typecheck", requiredEvidence: ["typecheck_result"] },
  ]);
  assert.equal(steps[0].requiredEvidence, undefined);
  assert.deepEqual(steps[1].requiredEvidence, ["typecheck_result"]);
});

test("checksRequired=false strips check evidence and skips title inference", () => {
  const steps = normalizeSemanticPlan(
    [
      { title: "Typecheck", requiredEvidence: ["typecheck_result", "file_read"] },
      { title: "Run tests" },
      { title: "Inspect" },
    ],
    { checksRequired: false },
  );
  assert.deepEqual(steps[0].requiredEvidence, ["file_read"]);
  assert.equal(steps[1].requiredEvidence, undefined);
  assert.equal(steps[2].requiredEvidence, undefined);
});

test("checksRequired=true preserves current inference behavior", () => {
  const steps = normalizeSemanticPlan([{ title: "Typecheck" }, { title: "Run tests" }, { title: "Production build" }]);
  assert.deepEqual(steps[0].requiredEvidence, ["typecheck_result"]);
  assert.deepEqual(steps[1].requiredEvidence, ["test_result"]);
  assert.deepEqual(steps[2].requiredEvidence, ["build_result"]);
});

test("repo fallback with checksRequired=false yields the read-only audit plan", () => {
  const steps = fallbackPlan(
    "Inspect my current project, identify the five biggest problems preventing production readiness, and recommend fixes. Read-only investigation. Do not modify files.",
    "act",
    { checksRequired: false },
  );
  assert.equal(steps.length, 4);
  assert.ok(steps.every((s) => !s.requiredEvidence || s.requiredEvidence.length === 0));
  assert.equal(steps[0].scope, "inspect");
  assert.equal(steps[3].scope, "report");
  assert.ok(!steps.some((s) => s.scope === "check" || s.scope === "verify"));
});

test("repo fallback default keeps stabilize plan with check evidence", () => {
  const steps = fallbackPlan("make the build stable and ready for production", "act");
  assert.ok(steps.some((s) => s.requiredEvidence?.includes("typecheck_result")));
});

test("planner retries once on tool-call/no-JSON output and records attempts", async () => {
  const store = emptyStore();
  await store.createMission({ goal: "inspect the repo", mode: "act", projectRoot: "/tmp/x" });
  let calls = 0;
  const model: ModelProvider = {
    async stream(_m: unknown, onEvent: (e: ModelStreamEvent) => void) {
      calls++;
      const text = calls === 1
        ? "```tool_call\n{\"tool\":\"project.status\",\"inputs\":{}}\n```"
        : `[{"title":"Inspect baseline"},{"title":"Report findings"}]`;
      if (onEvent) onEvent({ type: "delta", text } as ModelStreamEvent);
      return { content: text, model: "s", usage: { total_tokens: 1 } } as never;
    },
  } as unknown as ModelProvider;
  const result = await planMission({ model, store, goal: "inspect the repo", checksRequired: false });
  assert.equal(result.plan.source, "model");
  assert.equal(calls, 2);
  assert.equal((result.mission.metadata as Record<string, { attempts?: number }>).plan.attempts, 2);
});

test("planner uses ModelResult.content when deltas are empty", async () => {
  const store = emptyStore();
  await store.createMission({ goal: "inspect the repo", mode: "act", projectRoot: "/tmp/x" });
  const model: ModelProvider = {
    async stream() {
      // No deltas — native tool_call blocks live only in the returned content.
      return { content: `[{"title":"Inspect baseline"}]`, model: "s", usage: { total_tokens: 1 } } as never;
    },
  } as unknown as ModelProvider;
  const result = await planMission({ model, store, goal: "inspect the repo" });
  assert.equal(result.plan.source, "model");
});

// ─── Mutation-intent detection ─────────────────────────────────────
test("detectMutationRequest honors negation guards", () => {
  assert.equal(detectMutationRequest("Do not modify the file"), false);
  assert.equal(detectMutationRequest("Read-only. Don't create a file"), false);
  assert.equal(detectMutationRequest("Never edit the code"), false);
  assert.equal(detectMutationRequest("edit src/a.ts"), true);
  // Negation is clause-scoped — a "don't" in a previous clause does
  // not negate the mutation verb in the next.
  assert.equal(detectMutationRequest("Fix the bug but don't touch tests; edit the file src/a.ts"), true);
  assert.equal(detectMutationRequest("make a small change to the function"), true);
  assert.equal(detectMutationRequest(
    "Inspect my current project and recommend fixes. Read-only investigation. Do not modify files.",
  ), false);
  assert.equal(detectCreationRequest("build me a website"), true);
  assert.equal(detectCreationRequest("don't build me a website"), false);
});

// ─── Path normalization ────────────────────────────────────────────
test("list_files path aliases and in-root absolutes normalize to relative", () => {
  const defs: ToolDefinition[] = [{
    id: "project.list_files",
    name: "list_files",
    description: "list",
    readOnly: true,
    inputSchema: { properties: { path: { type: "string" } }, required: ["path"] },
  }];
  for (const alias of ["project root", "<root>", "/", "./", "PROJECT_ROOT"]) {
    const r = normalizeToolCallArgs("project.list_files", { path: alias }, defs, "C:\\repo");
    assert.equal(r.inputs.path, ".", alias);
  }
  const inside = normalizeToolCallArgs(
    "project.list_files",
    { path: "C:\\repo\\src\\app" },
    defs,
    "C:\\repo",
  );
  assert.equal(inside.inputs.path, path.join("src", "app"));
  const outside = normalizeToolCallArgs(
    "project.list_files",
    { path: "C:\\other\\dir" },
    defs,
    "C:\\repo",
  );
  assert.equal(outside.inputs.path, "C:\\other\\dir");
  const quoted = normalizeToolCallArgs("project.read_file", { path: "\"src/a.ts\"" }, [
    { id: "project.read_file", name: "read_file", description: "r",
      readOnly: true,
    inputSchema: { properties: { path: { type: "string" } }, required: ["path"] } },
  ], "C:\\repo");
  assert.equal(quoted.inputs.path, "src/a.ts");
});

// ─── Malformed args ────────────────────────────────────────────────
test("malformed JSON args are rejected pre-dispatch", () => {
  const defs: ToolDefinition[] = [{
    id: "project.list_files",
    name: "list_files",
    description: "list",
    readOnly: true,
    inputSchema: { properties: { path: { type: "string" } }, required: [] },
  }];
  const err = validateToolCallArgs(
    "project.list_files",
    { __litt_invalid_arguments__: "{path: unquoted," },
    defs,
  );
  assert.match(err ?? "", /Malformed tool arguments/);
});

// ─── Loop: auto-acquisition + typed repair + cancellation ──────────
function registryWith(tools: Record<string, { ok: boolean; message: string }>): { registry: ToolRegistry; calls: string[] } {
  const registry = new ToolRegistry();
  const calls: string[] = [];
  for (const [id, stub] of Object.entries(tools)) {
    const def: ToolDefinition = {
      id, name: id.split(".")[1] ?? id, description: id,
      readOnly: true,
    inputSchema: { properties: {}, required: [] },
    };
    registry.register({
      definition: def,
      metadata: { mutating: false, readOnly: true, destructive: false } as never,
      handler: async () => {
        calls.push(id);
        return { status: stub.ok ? "success" : "failed", success: stub.ok, message: stub.message, data: {} };
      },
    });
  }
  return { registry, calls };
}

test("missing required evidence triggers exactly-once runtime acquisition", async () => {
  const { registry, calls } = registryWith({ "project.check": { ok: true, message: "0 errors" } });
  const store = emptyStore();
  await store.createMission({ goal: "verify the typecheck", mode: "act", projectRoot: "/tmp/x" });
  let verifies = 0;
  const gate = {
    verify: async () => {
      verifies++;
      const acquired = calls.includes("project.check");
      return {
        proven: acquired,
        status: acquired ? "proven" : "failed",
        checks: [],
        totalDurationMs: 1,
        message: acquired ? "ok" : "Missing required evidence: typecheck_result",
        runId: "r1", ranChecks: [], skippedChecks: [],
        ...(acquired ? {} : { missingEvidence: ["typecheck_result"] }),
      } as never;
    },
  };
  // Scripted model: two "done" answers; gate unproven until the runtime
  // runs project.check itself, then proven on the second verify.
  const result = await runAgentLoop("verify the typecheck", {
    model: scriptedModel(["All checks pass.", "Now it passes."]),
    tools: registry,
    shell: { execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }), cancel: () => {} } as never,
    cwd: process.cwd(),
    maxRounds: 5,
    verificationGate: gate,
    store,
  });
  assert.equal(calls.filter((c) => c === "project.check").length, 1);
  assert.ok(verifies >= 1);
  assert.equal(result.termination, "complete");
});

test("typed evidence gaps replace the generic repair message", async () => {
  const { registry } = registryWith({});
  const seen: string[] = [];
  const model: ModelProvider = {
    async stream(messages: { content: string }[], onEvent: (e: ModelStreamEvent) => void) {
      seen.push(messages[messages.length - 1].content);
      const text = "done";
      if (onEvent) onEvent({ type: "delta", text } as ModelStreamEvent);
      return { content: text, model: "s", usage: { total_tokens: 1 } } as never;
    },
  } as unknown as ModelProvider;
  const gate = {
    verify: async () => ({
      proven: false, status: "failed", checks: [], totalDurationMs: 1,
      message: "Missing required evidence: typecheck_result",
      runId: "r1", ranChecks: [], skippedChecks: [],
      uncoveredSteps: ["Inspect repository baseline"],
    }),
  };
  const result = await runAgentLoop("check the repo", {
    model,
    tools: registry,
    shell: { execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }), cancel: () => {} } as never,
    cwd: process.cwd(),
    maxRounds: 2,
    verificationGate: gate as never,
  });
  assert.equal(result.termination, "verification_failed");
  assert.ok(seen.some((m) => m.includes("Steps without evidence") && m.includes("Inspect repository baseline")));
  assert.ok(seen.some((m) => m.includes("call the tool in this reply")));
});

test("abortSignal terminates the loop as cancelled with no verification", async () => {
  const { registry } = registryWith({});
  const gate = { verify: async () => { throw new Error("verify must not run"); } };
  const ctrl = new AbortController();
  const model: ModelProvider = {
    async stream(_m: unknown, onEvent: (e: ModelStreamEvent) => void) {
      ctrl.abort();
      const text = "working on it";
      if (onEvent) onEvent({ type: "delta", text } as ModelStreamEvent);
      return { content: text, model: "s", usage: { total_tokens: 1 } } as never;
    },
  } as unknown as ModelProvider;
  const result = await runAgentLoop("do something", {
    model,
    tools: registry,
    shell: { execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }), cancel: () => {} } as never,
    cwd: process.cwd(),
    maxRounds: 5,
    verificationGate: gate as never,
    abortSignal: ctrl.signal,
  });
  assert.equal(result.termination, "cancelled");
});

test("missing required arg is rejected pre-dispatch and never executes", async () => {
  const { registry, calls } = registryWith({});
  let executed = false;
  registry.register({
    definition: {
      id: "project.read_file", name: "read_file", description: "read",
      readOnly: true,
    inputSchema: { properties: { path: { type: "string" } }, required: ["path"] },
    },
    metadata: { mutating: false, readOnly: true } as never,
    handler: async () => { executed = true; return { status: "success", success: true, message: "ok", data: {} }; },
  });
  const result = await runAgentLoop("read a file", {
    model: scriptedModel([
      "```tool_call\n{\"tool\":\"project.read_file\",\"inputs\":{}}\n```",
      "```tool_call\n{\"tool\":\"project.read_file\",\"inputs\":{\"path\":\"a.ts\"}}\n```",
      "read it",
    ]),
    tools: registry,
    shell: { execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }), cancel: () => {} } as never,
    cwd: process.cwd(),
    maxRounds: 5,
  });
  assert.equal(executed, true);
  assert.ok(result.toolCalls.some((tc) => !tc.result.success && /Missing required argument/.test(tc.result.message)));
});

test("mission A replay: read-only fallback plan has no check or verification_result evidence", () => {
  const steps = fallbackPlan(
    "Inspect my current project, identify the five biggest problems preventing production readiness, and recommend fixes. Read-only investigation. Do not modify files.",
    "act",
    { checksRequired: false },
  );
  for (const step of steps) {
    assert.ok(!step.requiredEvidence?.includes("typecheck_result"));
    assert.ok(!step.requiredEvidence?.includes("verification_result"));
  }
});
