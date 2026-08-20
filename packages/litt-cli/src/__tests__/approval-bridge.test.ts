/**
 * ApprovalBridge tests — proves the human approval prompt shows a real,
 * readable description of what project.ship is about to do (files,
 * commit message, branch, push/PR), not just the bare tool id. This is
 * the "proposed staged files → approval" visibility requirement for the
 * gateway-gated ship workflow.
 */

import { describe, it, expect } from "vitest";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import type { ExecutionRequest } from "@litt/agent-core";

function baseRequest(overrides?: Partial<ExecutionRequest>): ExecutionRequest {
  return {
    toolId: "project.ship",
    inputs: {},
    cwd: "C:\\test",
    mode: "act",
    identity: { tenantId: "t1", userId: "u1", actorId: "u1", trusted: false, interaction: "interactive" },
    ...overrides,
  };
}

describe("ApprovalBridge — project.ship description", () => {
  it("shows the files, message, branch, and step list for a ship request", async () => {
    const bridge = new ApprovalBridge();
    const promise = bridge.request(
      baseRequest({
        inputs: {
          files: ["src/a.ts", "src/b.ts"],
          message: "feat: add feature",
          push: true,
          createPR: true,
        },
      }),
      null,
    );
    const pending = bridge.pending;
    expect(pending?.toolId).toBe("project.ship");
    expect(pending?.action).toContain("src/a.ts");
    expect(pending?.action).toContain("src/b.ts");
    expect(pending?.action).toContain("feat: add feature");
    expect(pending?.action).toContain("push");
    expect(pending?.action).toContain("draft PR");
    bridge.decide(false);
    await promise;
  });

  it("shows an auto-generated branch label when no branch is given", async () => {
    const bridge = new ApprovalBridge();
    const promise = bridge.request(
      baseRequest({ inputs: { files: ["a.ts"], message: "m", push: false, createPR: false } }),
      null,
    );
    expect(bridge.pending?.action).toContain("auto-generated branch");
    expect(bridge.pending?.action).not.toContain("push");
    expect(bridge.pending?.action).not.toContain("draft PR");
    bridge.decide(false);
    await promise;
  });

  it("truncates long file lists", async () => {
    const bridge = new ApprovalBridge();
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"];
    const promise = bridge.request(
      baseRequest({ inputs: { files, message: "m" } }),
      null,
    );
    expect(bridge.pending?.action).toContain("+2 more");
    bridge.decide(false);
    await promise;
  });

  it("falls back to the bare tool id for tools without a custom description", async () => {
    const bridge = new ApprovalBridge();
    const promise = bridge.request(baseRequest({ toolId: "project.write_file", inputs: {} }), null);
    expect(bridge.pending?.action).toBe("project.write_file");
    bridge.decide(false);
    await promise;
  });
});
