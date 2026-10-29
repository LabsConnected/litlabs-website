/**
 * Tool-inventory lane — regression coverage for the observed live bug:
 * "What tools do you have available right now?" entered INSPECTING/
 * RUNNING and started unrelated repository inspection, diagnostics, and
 * readiness checks for over a minute.
 *
 * Root cause: the question classified as "chat" and entered the agent
 * loop with the FULL tool registry, so a weak model answered a question
 * ABOUT the tools by CALLING them.
 *
 * The fix is a deterministic lane (like the local fast lane):
 *   - matchToolInventoryQuery() recognizes the question shape
 *   - formatToolInventory() answers from the live ToolRegistry,
 *     annotated by the session's real mode policy
 *   - the controller short-circuits BEFORE classifyIntent / the
 *     capability gate / any model call — zero tool executions
 */

import { describe, it, expect } from "vitest";
import { matchToolInventoryQuery, formatToolInventory } from "../lib/tool-inventory.js";
import { classifyIntent } from "../lib/intent.js";
import { matchLocalFastPath } from "../lib/local-fast-lane.js";
import { matchMachineLane } from "../lib/machine-lane.js";
import { matchReadTools } from "../lib/read-lane.js";
import { matchLocalToolMission } from "../lib/local-tool-mission.js";
import { ToolRegistry } from "@litt/agent-core";

describe("matchToolInventoryQuery — the reported question", () => {
  it("matches the exact reported phrasing", () => {
    expect(matchToolInventoryQuery("What tools do you have available right now?")).toBe(true);
  });

  it("matches common tool-inventory phrasings", () => {
    const cases = [
      "what tools do you have",
      "what tools do you have available",
      "what tools are available?",
      "which tools do you have?",
      "what tools can you use?",
      "what tools can you call",
      "what tools do you have access to",
      "what tools are registered",
      "list tools",
      "list your tools",
      "list available tools",
      "show tools",
      "show me your tools",
      "show available tools",
      "name your tools",
      "tell me about your tools",
      "what is your tool list",
      "what's your toolset",
      "tool inventory",
      "tools inventory",
      "can you list your tools",
      "please list available tools",
      "what tools do you have available, please",
    ];
    for (const q of cases) {
      expect(matchToolInventoryQuery(q), `expected match: ${q}`).toBe(true);
    }
  });

  it("does NOT match mission/read requests that merely mention tools", () => {
    const cases = [
      "use the tools to fix the build",
      "list tools then fix the build",
      "show tools that can deploy",
      "what tools does this project use",
      "list tools in package.json",
      "inspect the repo",
      "scan the project",
      "audit the repo",
      "run the tests",
      "check git status",
      "what framework is this",
      "what files changed",
      "build the project with your tools",
      "what tools are installed on this machine",
      "how do tools work",
      "explain what project.run does",
      "",
      "hello",
    ];
    for (const q of cases) {
      expect(matchToolInventoryQuery(q), `expected no match: ${q}`).toBe(false);
    }
  });
});

describe("tool-inventory layering — no other lane claims the question", () => {
  const q = "What tools do you have available right now?";

  it("stays 'chat' in classifyIntent — the lane intercepts before it", () => {
    // The deterministic lane runs BEFORE classifyIntent in submit().
    // The classifier itself must remain untouched: an informational
    // question is still chat (never mission/read) when it falls through.
    expect(classifyIntent(q)).toBe("chat");
  });

  it("is not claimed by the local fast lane, machine lane, read lane, or local-tool mission", () => {
    // These lanes must NOT produce competing/divergent behavior for a
    // tool-inventory question — the deterministic inventory lane owns it.
    expect(
      matchLocalFastPath(q, { cwd: process.cwd(), mode: "act" }),
    ).toBeNull();
    expect(matchMachineLane(q)).toBeNull();
    expect(matchReadTools(q)).toBeNull();
    expect(matchLocalToolMission(q)).toBeNull();
  });

  it("inspection requests still route to their lanes (no hijack)", () => {
    expect(classifyIntent("inspect the repo")).toBe("mission");
    expect(classifyIntent("what files changed")).toBe("read");
    expect(matchReadTools("what files changed")).not.toBeNull();
  });
});

describe("formatToolInventory — real registry, permission truth", () => {
  it("lists every registered tool id", () => {
    const registry = new ToolRegistry();
    const text = formatToolInventory(registry, "act");
    for (const def of registry.list()) {
      expect(text).toContain(def.id);
    }
  });

  it("annotates read-only tools as read-only", () => {
    const registry = new ToolRegistry();
    const text = formatToolInventory(registry, "act");
    const statusLine = text.split("\n").find((l) => l.startsWith("- project.status"));
    expect(statusLine).toBeDefined();
    expect(statusLine).toContain("[read-only]");
  });

  it("marks the mutating tool as approval-gated in ACT and blocked in PLAN", () => {
    const registry = new ToolRegistry();
    const act = formatToolInventory(registry, "act");
    const plan = formatToolInventory(registry, "plan");
    const actLine = act.split("\n").find((l) => l.startsWith("- project.write_file"));
    const planLine = plan.split("\n").find((l) => l.startsWith("- project.write_file"));
    expect(actLine).toContain("requires approval (ACT)");
    expect(planLine).toContain("blocked (PLAN mode)");
  });

  it("reports the current mode in the header", () => {
    const registry = new ToolRegistry();
    expect(formatToolInventory(registry, "act")).toContain("mode: ACT");
    expect(formatToolInventory(registry, "plan")).toContain("mode: PLAN");
    expect(formatToolInventory(registry, "auto")).toContain("mode: AUTO");
  });

  it("annotates project.run honestly — per-command risk policy, not blanket-safe", () => {
    const registry = new ToolRegistry();
    const text = formatToolInventory(registry, "act");
    const runLine = text.split("\n").find((l) => l.startsWith("- project.run"));
    expect(runLine).toBeDefined();
    // project.run executes arbitrary commands; the gateway risk-classifies
    // each one. The label must NOT claim blanket read-only safety.
    expect(runLine).toContain("elevated/dangerous need approval (ACT)");
    expect(runLine).not.toContain("[read-only]");
  });

  it("reflects the actual registry contents — an added tool appears, an absent one does not", () => {
    const registry = new ToolRegistry(undefined, { includeDefaults: false });
    const text = formatToolInventory(registry, "act");
    expect(text).toContain("(0)");
    expect(text).not.toContain("project.status");
    registry.register({
      definition: {
        id: "custom.probe",
        name: "probe",
        description: "Custom probe tool",
        inputSchema: { type: "object", properties: {} },
        readOnly: true,
      },
      handler: async () => ({ status: "success", success: true, message: "ok", data: {} }),
      metadata: { projectScoped: false, mutating: false, readOnly: true },
    });
    const updated = formatToolInventory(registry, "act");
    expect(updated).toContain("custom.probe");
    expect(updated).not.toContain("project.status");
  });
});
