/**
 * Semantic Mission Planning — proves the contract:
 *
 *   USER GOAL
 *     → AgentLoop/model generates a semantic execution plan
 *     → plan is persisted as MissionStep[] on the canonical Mission
 *     → execution begins; tools execute UNDER an existing semantic step
 *
 * Tools do NOT define steps. Tools attach to existing steps via
 * toolHistory / actionHistory / evidence. One step may cover many
 * tool calls; one tool may serve many steps.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RuntimeStore } from "../state.js";
import {
  planMission,
  parseSemanticPlan,
  fallbackPlan,
  resolveStepForTool,
  attachToolToStep,
} from "../mission-planner.js";
import type { ModelProvider, ChatMessage, ModelStreamEvent } from "../types.js";

// ─── Helpers ───────────────────────────────────────────────────────

function createTempDir(): string {
  const tmp = path.join(os.tmpdir(), `litt-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
}

/** Mock model that returns a fixed JSON plan. */
function createMockPlannerModel(planJson: string): ModelProvider {
  return {
    stream: async (
      _messages: ChatMessage[],
      onEvent: (event: ModelStreamEvent) => void,
    ) => {
      onEvent({ type: "delta", text: planJson });
      onEvent({
        type: "done",
        model: "mock",
        usage: { total_tokens: 50 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
      });
      return { content: planJson, model: "mock", provider: "mock", usage: { total_tokens: 50 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 }, profile: "fast" };
    },
    health: async () => 1,
  };
}

/** Mock model that throws — simulates no API key / network failure. */
function createFailingModel(): ModelProvider {
  return {
    stream: async () => { throw new Error("No API key"); },
    health: async () => 0,
  };
}

/** Mock model that returns garbage — simulates bad model output. */
function createGarbageModel(): ModelProvider {
  return {
    stream: async (
      _messages: ChatMessage[],
      onEvent: (event: ModelStreamEvent) => void,
    ) => {
      onEvent({ type: "delta", text: "I cannot help with that." });
      onEvent({
        type: "done",
        model: "mock",
        usage: { total_tokens: 10 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
      });
      return { content: "I cannot help with that.", model: "mock", provider: "mock", usage: { total_tokens: 10 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 }, profile: "fast" };
    },
    health: async () => 1,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Semantic Mission Planning", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  // ─── parseSemanticPlan ───────────────────────────────────────────

  describe("parseSemanticPlan", () => {
    it("parses a clean JSON array of steps", () => {
      const text = `[
        { "title": "Inspect baseline", "description": "Check git status" },
        { "title": "Typecheck", "description": "Run tsc" }
      ]`;
      const steps = parseSemanticPlan(text);
      assert.ok(steps);
      assert.equal(steps!.length, 2);
      assert.equal(steps![0].title, "Inspect baseline");
      assert.equal(steps![1].title, "Typecheck");
    });

    it("parses a JSON array wrapped in code fences", () => {
      const text = "```json\n[{ \"title\": \"Step 1\" }]\n```";
      const steps = parseSemanticPlan(text);
      assert.ok(steps);
      assert.equal(steps!.length, 1);
      assert.equal(steps![0].title, "Step 1");
    });

    it("parses a JSON array embedded in prose", () => {
      const text = "Here is the plan:\n[{ \"title\": \"Step A\" }]\nThat's it.";
      const steps = parseSemanticPlan(text);
      assert.ok(steps);
      assert.equal(steps![0].title, "Step A");
    });

    it("returns null for empty text", () => {
      assert.equal(parseSemanticPlan(""), null);
      assert.equal(parseSemanticPlan("   "), null);
    });

    it("returns null for text with no JSON array", () => {
      assert.equal(parseSemanticPlan("No plan here"), null);
      assert.equal(parseSemanticPlan("{ \"title\": \"not an array\" }"), null);
    });

    it("returns null for an array with no valid steps", () => {
      assert.equal(parseSemanticPlan("[]"), null);
      assert.equal(parseSemanticPlan("[{ \"description\": \"no title\" }]"), null);
    });

    it("preserves requiredEvidence and scope when present", () => {
      const text = `[{ "title": "Typecheck", "requiredEvidence": ["typecheck_result"], "scope": "check" }]`;
      const steps = parseSemanticPlan(text);
      assert.ok(steps);
      assert.deepEqual(steps![0].requiredEvidence, ["typecheck_result"]);
      assert.equal(steps![0].scope, "check");
    });
  });

  // ─── fallbackPlan ────────────────────────────────────────────────

  describe("fallbackPlan", () => {
    it("produces a stabilize-and-verify plan for production-readiness goals", () => {
      const steps = fallbackPlan("Get my website stable and ready for production.");
      const titles = steps.map((s) => s.title);
      assert.ok(titles.includes("Inspect repository baseline"));
      assert.ok(titles.includes("Typecheck"));
      assert.ok(titles.includes("Run tests"));
      assert.ok(titles.includes("Production build"));
      assert.ok(titles.includes("Diagnose failures"));
      assert.ok(titles.includes("Apply approved repairs"));
      assert.ok(titles.includes("Revalidate"));
      assert.ok(titles.includes("Verify production readiness"));
      assert.equal(steps.length, 8);
    });

    it("does NOT produce a single universal 'Execute mission' step", () => {
      const steps = fallbackPlan("Get my website stable and ready for production.");
      assert.ok(steps.length > 1);
      assert.ok(steps.every((s) => s.title !== "Execute mission"));
    });

    it("produces an implement plan for 'add/create' goals", () => {
      const steps = fallbackPlan("Add a login page");
      const titles = steps.map((s) => s.title);
      assert.ok(titles.includes("Implement changes"));
      assert.ok(titles.includes("Verify"));
    });

    it("produces a generic inspect→verify plan for unknown goals", () => {
      const steps = fallbackPlan("Analyze performance");
      assert.ok(steps.length >= 3);
      assert.equal(steps[0].title, "Inspect repository baseline");
      assert.equal(steps[steps.length - 1].title, "Verify");
    });
  });

  // ─── planMission — steps exist BEFORE tool execution ─────────────

  describe("planMission — semantic steps persisted before execution", () => {
    it("creates MissionSteps on the canonical RuntimeStore BEFORE any tool call", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({
        goal: "Get my website stable and ready for production.",
        mode: "act",
        projectRoot: tmpDir,
      });

      // Before planning: no steps
      assert.equal(store.getMission()?.steps.length, 0);

      const model = createMockPlannerModel(`[
        { "title": "Inspect baseline", "description": "Check state" },
        { "title": "Typecheck", "description": "Run tsc" },
        { "title": "Tests", "description": "Run tests" },
        { "title": "Build", "description": "Run build" },
        { "title": "Verify", "description": "Final gate" }
      ]`);

      const { plan, steps } = await planMission({
        model,
        store,
        goal: "Get my website stable and ready for production.",
        projectContext: { name: "test", root: tmpDir, branch: "main" },
      });

      // After planning: steps exist on the canonical mission
      assert.equal(plan.source, "model");
      assert.equal(steps.length, 5);
      assert.equal(store.getMission()?.steps.length, 5);
      assert.equal(store.getMission()?.steps[0].title, "Inspect baseline");
      assert.equal(store.getMission()?.steps[4].title, "Verify");

      // All steps are pending — no tool has run yet
      for (const step of store.getMission()!.steps) {
        assert.equal(step.status, "pending");
        assert.equal(step.toolHistory.length, 0);
      }

      // currentStepId is still null — execution has not started
      assert.equal(store.getMission()?.currentStepId, null);
    });

    it("falls back to a goal-derived plan when the model is unavailable", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({
        goal: "Get my website stable and ready for production.",
        mode: "act",
        projectRoot: tmpDir,
      });

      const { plan, steps } = await planMission({
        model: createFailingModel(),
        store,
        goal: "Get my website stable and ready for production.",
      });

      assert.equal(plan.source, "fallback");
      assert.equal(steps.length, 8); // stabilize plan
      assert.equal(store.getMission()?.steps.length, 8);
      assert.equal(steps[0].title, "Inspect repository baseline");
      assert.equal(steps[7].title, "Verify production readiness");
    });

    it("falls back to a goal-derived plan when the model returns garbage", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({
        goal: "Fix the broken build",
        mode: "act",
        projectRoot: tmpDir,
      });

      const { plan, steps } = await planMission({
        model: createGarbageModel(),
        store,
        goal: "Fix the broken build",
      });

      assert.equal(plan.source, "fallback");
      assert.ok(steps.length > 1);
      assert.ok(steps.every((s) => s.title !== "Execute mission"));
    });

    it("throws if no active mission exists on the store", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await assert.rejects(
        () => planMission({
          model: createMockPlannerModel("[]"),
          store,
          goal: "test",
        }),
        /no active mission/,
      );
    });
  });

  // ─── resolveStepForTool — tools attach to existing steps ─────────

  describe("resolveStepForTool — tools attach to existing semantic steps", () => {
    it("attaches to the current working step by default", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Inspect", allowedActionScope: ["inspect"] });
      await store.addMissionStep({ title: "Typecheck", allowedActionScope: ["check"] });
      await store.setCurrentStep(s1!.id); // s1 is now working

      const stepId = resolveStepForTool(store.getMission()!.steps, "project.read_file", s1!.id);
      assert.equal(stepId, s1!.id);
    });

    it("attaches to the first pending step with matching scope when no step is working", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      await store.addMissionStep({ title: "Inspect", allowedActionScope: ["inspect"] });
      await store.addMissionStep({ title: "Typecheck", allowedActionScope: ["check"] });

      // project.typecheck maps to scope "check" → should pick the typecheck step
      const stepId = resolveStepForTool(store.getMission()!.steps, "project.typecheck", null);
      assert.equal(stepId, store.getMission()!.steps[1].id);
    });

    it("falls back to the first pending step when no scope matches", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      await store.addMissionStep({ title: "Step A" });
      await store.addMissionStep({ title: "Step B" });

      const stepId = resolveStepForTool(store.getMission()!.steps, "unknown.tool", null);
      assert.equal(stepId, store.getMission()!.steps[0].id);
    });

    it("returns null when there are no steps", () => {
      assert.equal(resolveStepForTool([], "project.status", null), null);
    });

    it("allows the same tool to attach to different steps across a mission", async () => {
      // project.typecheck may serve both "Typecheck" and "Revalidate"
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Typecheck", allowedActionScope: ["check"] });
      const s2 = await store.addMissionStep({ title: "Revalidate", allowedActionScope: ["check"] });

      // First call: no working step → picks first pending "check" step (s1)
      const first = resolveStepForTool(store.getMission()!.steps, "project.typecheck", null);
      assert.equal(first, s1!.id);

      // Simulate s1 done, s2 is current working step
      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");
      await store.setCurrentStep(s2!.id);

      // Second call: s2 is working → attaches to s2 (same tool, different step)
      const second = resolveStepForTool(store.getMission()!.steps, "project.typecheck", s2!.id);
      assert.equal(second, s2!.id);
    });
  });

  // ─── attachToolToStep — toolHistory / actionHistory ──────────────

  describe("attachToolToStep — records tools on existing steps", () => {
    it("appends to toolHistory and actionHistory", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const step = await store.addMissionStep({ title: "Diagnose" });

      await attachToolToStep(store, step!.id, {
        toolId: "project.search",
        toolName: "search",
        toolCallId: "tc_1",
        success: true,
        message: "Found 3 matches",
      });

      const updated = store.getMission()?.steps[0];
      assert.ok(updated?.toolHistory.includes("tc_1"));
      assert.equal(updated?.actionHistory.length, 1);
      assert.equal(updated?.actionHistory[0].tool, "project.search");
      assert.equal(updated?.actionHistory[0].status, "success");
    });

    it("does not duplicate toolHistory entries for the same toolCallId", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const step = await store.addMissionStep({ title: "Diagnose" });

      await attachToolToStep(store, step!.id, {
        toolId: "project.read_file", toolName: "read_file",
        toolCallId: "tc_2", success: true, message: "ok",
      });
      await attachToolToStep(store, step!.id, {
        toolId: "project.read_file", toolName: "read_file",
        toolCallId: "tc_2", success: true, message: "ok",
      });

      const updated = store.getMission()?.steps[0];
      assert.equal(updated?.toolHistory.filter((id) => id === "tc_2").length, 1);
    });

    it("records filesRead and filesChanged with dedup", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const step = await store.addMissionStep({ title: "Repair" });

      await attachToolToStep(store, step!.id, {
        toolId: "project.edit_file", toolName: "edit_file",
        toolCallId: "tc_3", success: true, message: "edited",
        filesRead: ["src/a.ts"], filesChanged: ["src/a.ts"],
      });
      await attachToolToStep(store, step!.id, {
        toolId: "project.edit_file", toolName: "edit_file",
        toolCallId: "tc_4", success: true, message: "edited",
        filesRead: ["src/a.ts", "src/b.ts"], filesChanged: ["src/b.ts"],
      });

      const updated = store.getMission()?.steps[0];
      assert.deepEqual(updated?.filesRead, ["src/a.ts", "src/b.ts"]);
      assert.deepEqual(updated?.filesChanged, ["src/a.ts", "src/b.ts"]);
    });

    it("is a no-op when the step does not exist", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });

      // Should not throw
      await attachToolToStep(store, "nonexistent_step", {
        toolId: "project.run", toolName: "run",
        toolCallId: "tc_5", success: true, message: "ok",
      });
    });
  });

  // ─── Integration: plan → attach tools → steps exist before tools ─

  describe("Integration: steps exist before first tool call", () => {
    it("proves Mission.steps is non-empty BEFORE any tool execution", async () => {
      const store = new RuntimeStore({ projectRoot: tmpDir });
      await store.createMission({
        goal: "Get my website stable and ready for production.",
        mode: "act",
        projectRoot: tmpDir,
      });

      // Plan
      const { steps } = await planMission({
        model: createFailingModel(), // force fallback to prove it works without a model
        store,
        goal: "Get my website stable and ready for production.",
      });

      // Steps exist NOW — before any tool call
      const missionBeforeTools = store.getMission();
      assert.ok(missionBeforeTools);
      assert.equal(missionBeforeTools!.steps.length, steps.length);
      assert.ok(missionBeforeTools!.steps.length > 1);

      // Simulate the first tool call arriving
      const firstToolStep = resolveStepForTool(
        missionBeforeTools!.steps,
        "project.status",
        null,
      );
      assert.ok(firstToolStep);
      await store.setCurrentStep(firstToolStep!);

      // The tool attaches to the existing step — it does NOT create a new one
      await attachToolToStep(store, firstToolStep!, {
        toolId: "project.status",
        toolName: "status",
        toolCallId: "tc_first",
        success: true,
        message: "clean tree",
      });

      // Step count is unchanged — the tool attached, it didn't define a step
      const missionAfterFirstTool = store.getMission();
      assert.equal(missionAfterFirstTool?.steps.length, steps.length);
      assert.ok(missionAfterFirstTool?.steps[0].toolHistory.includes("tc_first"));
      assert.equal(missionAfterFirstTool?.steps[0].status, "working");
    });
  });
});
