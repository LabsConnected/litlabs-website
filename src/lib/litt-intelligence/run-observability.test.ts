/**
 * Tests for LiTT Run Observability (Part J) and the web-app terminal
 * owner helper.
 *
 * Spec mapping:
 * - Test 10: one task can chain web.search → image.generate → files.write
 *   → terminal.execute → browser inspection while preserving context.
 *   (Observability records the chain; the loop preserves the run.)
 */
import { describe, it, expect } from "vitest";
import {
  startRunObservability,
  recordToolsOffered,
  recordToolCall,
  recordFallback,
  recordApproval,
  recordVerificationEvidence,
  finishRunObservability,
  summarizeCapabilityCoverage,
  friendlyActivityLabel,
} from "./run-observability";
import { planCapabilities } from "./capability-planner";

describe("run observability", () => {
  it("records goal, plan, tools offered/called, approvals, evidence", () => {
    const plan = planCapabilities("Build a premium roofing website");
    const obs = startRunObservability({
      runId: "run-1",
      goal: "Build a premium roofing website",
      agentMode: "auto",
      capabilityPlan: plan,
    });

    recordToolsOffered(obs, ["web.search", "image.generate", "files.write"]);
    recordToolCall(obs, {
      toolId: "web.search",
      success: true,
      summary: "found references",
      mutating: false,
      latencyMs: 1200,
    });
    recordToolCall(obs, {
      toolId: "image.generate",
      success: true,
      summary: "hero image",
      mutating: false,
    });
    recordToolCall(obs, {
      toolId: "files.write",
      success: true,
      summary: "wrote index.html",
      mutating: true,
    });
    recordApproval(obs, "project.deploy", "granted");
    recordVerificationEvidence(obs, "preview", "https://preview.example/abc");
    const done = finishRunObservability(obs, "completed");

    expect(done.toolsOffered).toEqual(["web.search", "image.generate", "files.write"]);
    expect(done.toolsCalled).toHaveLength(3);
    expect(done.approvals[0]).toMatchObject({ toolId: "project.deploy", decision: "granted" });
    expect(done.verificationEvidence[0].kind).toBe("preview");
    expect(done.outcome).toBe("completed");
    expect(done.endedAt).toBeTruthy();
  });

  it("Test 10: chained tool context is preserved in one record", () => {
    const plan = planCapabilities("Build a premium roofing website");
    const obs = startRunObservability({
      runId: "run-chain",
      goal: "Build a premium roofing website",
      agentMode: "auto",
      capabilityPlan: plan,
    });
    // One task chaining: web.search → image.generate → files.write →
    // terminal.execute → browser inspection — all in the SAME run record.
    for (const toolId of [
      "web.search",
      "image.generate",
      "files.write",
      "terminal.execute",
      "browser.screenshot",
    ]) {
      recordToolCall(obs, { toolId, success: true, summary: "ok", mutating: toolId === "files.write" });
    }
    expect(obs.toolsCalled.map((c) => c.toolId)).toEqual([
      "web.search",
      "image.generate",
      "files.write",
      "terminal.execute",
      "browser.screenshot",
    ]);
    // No disconnected mini-agent runs: single runId throughout.
    expect(new Set(obs.toolsCalled.map(() => obs.runId)).size).toBe(1);
  });

  it("summarizeCapabilityCoverage shows exercised vs missing", () => {
    const plan = planCapabilities("Build a premium roofing website");
    const obs = startRunObservability({
      runId: "r",
      goal: "g",
      agentMode: "auto",
      capabilityPlan: plan,
    });
    recordToolCall(obs, { toolId: "files.write", success: true, summary: "ok", mutating: true });
    const summary = summarizeCapabilityCoverage(obs);
    expect(summary).toContain("filesystem: exercised");
    expect(summary).toContain("NOT exercised");
  });

  it("records fallbacks when a tool is degraded", () => {
    const obs = startRunObservability({ runId: "r", goal: "g", agentMode: "auto" });
    recordFallback(obs, {
      fromToolId: "terminal.execute",
      toAlternative: "skip build proof, note honestly",
      reason: "tool degraded at offer time",
    });
    expect(obs.fallbacks).toHaveLength(1);
  });
});

describe("friendlyActivityLabel", () => {
  it("maps tools to user-facing labels", () => {
    expect(friendlyActivityLabel("web.search")).toBe("Researching");
    expect(friendlyActivityLabel("image.generate")).toBe("Generating images");
    expect(friendlyActivityLabel("files.write")).toBe("Editing files");
    expect(friendlyActivityLabel("terminal.execute")).toBe("Running checks");
    expect(friendlyActivityLabel("browser.screenshot")).toBe("Checking preview");
    expect(friendlyActivityLabel("project.deploy")).toBe("Deploying");
  });
});
