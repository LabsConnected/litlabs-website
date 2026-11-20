/**
 * Approval decision wiring — regression for the D2 wedge.
 *
 * Observed live (sandbox-litt-final, mission_1794260409527): after several
 * approvals the cockpit sat on "? APPROVAL · waiting 0:00" with a `working`
 * mission for minutes — every keystroke was swallowed by a dead prompt.
 *
 * Two root causes fixed together:
 *
 * 1. Scope drop: ApprovalUX calls onDecision(approved, "once"|"session")
 *    but handleApproval only declared (approved) — the session scope was
 *    silently discarded, so approvalBridge.decide() ALWAYS ran with
 *    "once". "Approve similar" ([⇧a]) never recorded a command-class
 *    grant, meaning every same-class command (npm test, npm run build, ...)
 *    re-prompted forever — an approval loop that looks like a frozen UI
 *    (each fresh request resets the wait timer to 0:00).
 *
 * 2. Dead prompt on drain: the bridge subscriber only handled
 *    pending !== null. When the queue drained without handleApproval
 *    (bridge.cancel(), or any non-UI resolve), approvalPrompt stayed set
 *    and ApprovalUX kept owning the keyboard — 'a'/'d' resolved an empty
 *    queue and did nothing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ExecutionRequest, RiskAssessment } from "@litt/agent-core";
import { ApprovalBridge } from "../ink/approval-bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const controllerSrc = readFileSync(join(here, "..", "ink", "controller.ts"), "utf8");

function makeRequest(toolId: string, command?: string): ExecutionRequest {
  return {
    toolId,
    inputs: command ? { command, args: [] } : {},
    cwd: process.cwd(),
    mode: "act",
    identity: {
      tenantId: "cli-tenant",
      userId: "cli-user",
      actorId: "cli-user",
      trusted: false,
      interaction: "interactive",
    },
    runId: "run_test_001",
    toolCallId: "tc_test_001",
  };
}

function makeRisk(level: "safe" | "elevated" | "dangerous"): RiskAssessment {
  return { level, capability: "workspace_edit", reason: "test", mutating: true };
}

describe("ApprovalBridge session-scope grants", () => {
  it("decide(true, 'session') records a grant — next same-class request auto-approves", async () => {
    const bridge = new ApprovalBridge();
    const first = bridge.request(makeRequest("project.run", "npm test"), makeRisk("elevated"));
    expect(bridge.pending).not.toBeNull();

    bridge.decide(true, "session");
    expect(await first).toBe(true);
    expect(bridge.hasSessionGrant("project.run", "npm test")).toBe(true);

    // Same command class → resolves immediately, never shows a prompt.
    const second = bridge.request(makeRequest("project.run", "npm test -- --runInBand"), makeRisk("elevated"));
    expect(await second).toBe(true);
    expect(bridge.pending).toBeNull();
  });

  it("session grants never apply to dangerous-risk approvals", async () => {
    const bridge = new ApprovalBridge();
    const first = bridge.request(makeRequest("project.run", "git push origin main"), makeRisk("dangerous"));
    bridge.decide(true, "session");
    await first;

    // Dangerous class must re-prompt — grant was not recorded.
    const second = bridge.request(makeRequest("project.run", "git push origin main --force"), makeRisk("dangerous"));
    expect(bridge.pending).not.toBeNull();
    bridge.decide(false);
    expect(await second).toBe(false);
  });

  it("once-scope decisions do NOT create session grants", async () => {
    const bridge = new ApprovalBridge();
    const first = bridge.request(makeRequest("project.run", "npm run build"), makeRisk("elevated"));
    bridge.decide(true, "once");
    await first;

    const second = bridge.request(makeRequest("project.run", "npm run build"), makeRisk("elevated"));
    expect(bridge.pending).not.toBeNull();
    bridge.decide(true);
    await second;
  });

  it("draining the queue notifies subscribers with null", async () => {
    const bridge = new ApprovalBridge();
    const seen: (string | null)[] = [];
    bridge.subscribe((p) => seen.push(p ? p.toolId : null));

    const p1 = bridge.request(makeRequest("project.write_file"), makeRisk("elevated"));
    const p2 = bridge.request(makeRequest("project.run", "npm test"), makeRisk("elevated"));
    // Two queued — head is write_file, run is behind it.
    bridge.decide(true);
    await p1;
    expect(bridge.pending?.toolId).toBe("project.run");
    bridge.decide(true);
    await p2;
    expect(bridge.pending).toBeNull();
    expect(seen[seen.length - 1]).toBeNull();
  });
});

describe("controller approval wiring (source-level)", () => {
  it("handleApproval accepts the decision scope and forwards it to the bridge", () => {
    const fn = controllerSrc.match(/const handleApproval = useCallback\(async \(approved: boolean[^)]*\)/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain('"once" | "session"');
    expect(controllerSrc).toMatch(/approvalBridge\.decide\(approved, scope\)/);
  });

  it("bridge subscriber clears the prompt when the queue drains to null", () => {
    const sub = controllerSrc.match(/approvalBridge\.subscribe\(\(pending\) => \{([\s\S]*?)\n  \}, \[approvalBridge, store\]\)/);
    expect(sub).not.toBeNull();
    const body = sub![1];
    expect(body).toContain("clearApproval()");
    // The else-branch must restore holoState so APPROVAL cannot go stale.
    expect(body).toMatch(/\}\s*else\s*\{[\s\S]*?clearApproval\(\)[\s\S]*?setHoloState/);
  });
});
