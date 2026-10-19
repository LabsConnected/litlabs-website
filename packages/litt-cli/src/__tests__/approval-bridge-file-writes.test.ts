/**
 * Approval prompts for file mutations must show WHAT is written, and a
 * write must never be pre-approved by an earlier "approve similar".
 *
 * Independent review 2026-10-18: for project.write_file / project.edit_file
 * the prompt read only "[ELEVATED] project.write_file" (no path, no content),
 * and Shift+A stored the grant key project.write_file::project.write_file,
 * silently approving every later write to any path for the session.
 */

import { describe, it, expect } from "vitest";
import type { ExecutionRequest } from "@litt/agent-core";
import { ApprovalBridge, allowsSessionGrant, describeApprovalAction } from "../ink/approval-bridge.js";

function req(toolId: string, inputs: Record<string, unknown>): ExecutionRequest {
  return {
    toolId,
    inputs,
    cwd: "C:\\proj",
    mode: "act",
    identity: { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" },
  } as ExecutionRequest;
}

describe("describeApprovalAction", () => {
  it("write_file shows the path, size and a content preview", () => {
    const text = describeApprovalAction(req("project.write_file", {
      path: "src/math.js",
      content: "export function multiply(a, b) {\n  return a * b;\n}\n",
    }), null);
    expect(text).toContain("src/math.js");
    expect(text).toMatch(/\d+ bytes/);
    expect(text).toContain("export function multiply");
  });

  it("edit_file shows the path and the replacement", () => {
    const text = describeApprovalAction(req("project.edit_file", {
      path: "test/math.test.js",
      old_string: 'import { add } from "../src/math.js";',
      new_string: 'import { add, multiply } from "../src/math.js";',
    }), null);
    expect(text).toContain("test/math.test.js");
    expect(text).toContain("import { add } from");
    expect(text).toContain("import { add, multiply } from");
  });

  it("bounds a huge write preview", () => {
    const text = describeApprovalAction(req("project.write_file", { path: "big.txt", content: "x".repeat(100_000) }), null);
    expect(text.length).toBeLessThan(2_000);
    expect(text).toContain("100000 bytes");
  });

  it("shell commands keep the command line", () => {
    const text = describeApprovalAction(req("project.run", { command: "npm", args: ["test"] }), {
      level: "elevated", mutating: true, reason: "", category: "package",
    } as never);
    expect(text).toBe("npm test");
  });
});

describe("session grants never cover file writes", () => {
  it("allowsSessionGrant is false for write/edit and true for safe-class commands", () => {
    expect(allowsSessionGrant("project.write_file", "elevated")).toBe(false);
    expect(allowsSessionGrant("project.edit_file", "elevated")).toBe(false);
    expect(allowsSessionGrant("project.run", "elevated")).toBe(true);
    expect(allowsSessionGrant("project.run", "dangerous")).toBe(false);
  });

  it("approving a write with session scope does not pre-approve the next write", async () => {
    const bridge = new ApprovalBridge();
    const first = bridge.request(req("project.write_file", { path: "a.txt", content: "1" }), null);
    bridge.decide(true, "session");
    await expect(first).resolves.toBe(true);

    let settled = false;
    const second = bridge.request(req("project.write_file", { path: ".github/workflows/x.yml", content: "2" }), null);
    void second.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(bridge.pending?.action).toContain(".github/workflows/x.yml");
    bridge.decide(false);
    await expect(second).resolves.toBe(false);
  });
});
