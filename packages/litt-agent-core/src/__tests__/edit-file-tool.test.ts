/**
 * project.edit_file — the real, registered mutation tool.
 *
 * Root cause this closes (acceptance run "bqga7kzj8"): "project.edit_file"
 * was referenced everywhere (mutation-tracking sets in ask.ts/controller.ts,
 * scope mapping in mission-planner.ts, UI labels in tool-labels.ts) as if
 * it were a real tool, but it was never actually registered in the default
 * ToolRegistry. A model that correctly decided it needed to edit a file
 * had no real tool to call and fabricated "project.edit" instead — which
 * was correctly rejected as unknown, but the acceptance run could never
 * make a real edit because there was nothing real to invoke.
 *
 * These tests prove the tool exists for real and is wired through the
 * SAME canonical paths as every other tool:
 *   - editFile() (project.ts): deterministic find/replace, path safety
 *   - createDefaultRegistry(): "project.edit_file" is discoverable
 *   - ExecutionGateway: mutation is gated by the SAME generic
 *     metadata.mutating policy every other non-shell mutating tool uses
 *     (PLAN denies, ACT requires approval, no gateway-bypass path)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { editFile } from "../project.js";
import { createDefaultRegistry, ToolRegistry } from "../tools.js";
import { ExecutionGateway, type ExecutionIdentity } from "../execution-gateway.js";
import { CommandExecutor } from "../command-executor.js";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore } from "../state.js";

// ─── Real filesystem fixture ────────────────────────────────────────

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-edit-file-test-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function writeFixture(relPath: string, content: string): void {
  const abs = path.join(workDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function readFixture(relPath: string): string {
  return fs.readFileSync(path.join(workDir, relPath), "utf8");
}

// ─── editFile() — the deterministic find/replace primitive ─────────

describe("editFile — deterministic find/replace with path safety", () => {
  it("successfully edits a file when search matches exactly once", async () => {
    writeFixture("a.ts", "const x = 1;\nconst y = 2;\n");
    const shell = new NodeShellExecutor(workDir);

    const result = await editFile(shell, "a.ts", "const x = 1;", "const x = 42;");

    assert.equal(result.success, true);
    assert.equal(result.status, "success");
    assert.equal(readFixture("a.ts"), "const x = 42;\nconst y = 2;\n");
    // Evidence for VerificationGate / evidence tracking.
    assert.equal(result.data.path, "a.ts");
    assert.equal(result.data.occurrences, 1);
    assert.match(result.message, /Edited a\.ts/);
  });

  it("rejects path traversal outside the workspace — file is never touched", async () => {
    // A sibling file OUTSIDE workDir that must never be reachable.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-edit-file-outside-"));
    const outsideFile = path.join(outsideDir, "secret.ts");
    fs.writeFileSync(outsideFile, "const secret = 1;\n", "utf8");
    try {
      const shell = new NodeShellExecutor(workDir);
      const relativeEscape = path.relative(workDir, outsideFile); // "../litt-edit-file-outside-XXXX/secret.ts"

      const result = await editFile(shell, relativeEscape, "const secret = 1;", "const secret = 999;");

      assert.equal(result.success, false);
      assert.match(result.message, /outside the (project )?workspace|Blocked/i);
      assert.equal(fs.readFileSync(outsideFile, "utf8"), "const secret = 1;\n", "the outside file must be unmodified");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects an absolute path", async () => {
    writeFixture("a.ts", "const x = 1;\n");
    const shell = new NodeShellExecutor(workDir);
    const absPath = path.join(workDir, "a.ts");

    const result = await editFile(shell, absPath, "const x = 1;", "const x = 2;");

    assert.equal(result.success, false);
    assert.equal(readFixture("a.ts"), "const x = 1;\n");
  });

  it("refuses the edit — not a silent no-op or wrong-content write — when search is not found", async () => {
    writeFixture("a.ts", "const x = 1;\n");
    const shell = new NodeShellExecutor(workDir);

    const result = await editFile(shell, "a.ts", "const x = 999;", "const x = 2;");

    assert.equal(result.success, false);
    assert.match(result.message, /not found/i);
    assert.equal(result.data.occurrences, 0);
    assert.equal(readFixture("a.ts"), "const x = 1;\n", "file must be unchanged on a failed match");
  });

  it("refuses the edit when search is ambiguous (matches more than once)", async () => {
    writeFixture("a.ts", "const x = 1;\nconst x = 1;\n");
    const shell = new NodeShellExecutor(workDir);

    const result = await editFile(shell, "a.ts", "const x = 1;", "const x = 2;");

    assert.equal(result.success, false);
    assert.match(result.message, /ambiguous/i);
    assert.equal(result.data.occurrences, 2);
    assert.equal(readFixture("a.ts"), "const x = 1;\nconst x = 1;\n", "file must be unchanged on an ambiguous match");
  });

  it("fails clearly on a nonexistent file rather than creating one", async () => {
    const shell = new NodeShellExecutor(workDir);
    const result = await editFile(shell, "nope.ts", "x", "y");
    assert.equal(result.success, false);
    assert.match(result.message, /not found/i);
    assert.equal(fs.existsSync(path.join(workDir, "nope.ts")), false);
  });

  it("blocks sensitive paths (reuses the same isSafePath boundary as read_file)", async () => {
    writeFixture(".env", "SECRET=1\n");
    const shell = new NodeShellExecutor(workDir);
    const result = await editFile(shell, ".env", "SECRET=1", "SECRET=2");
    assert.equal(result.success, false);
    assert.equal(readFixture(".env"), "SECRET=1\n");
  });
});

// ─── Registered tool discovery ──────────────────────────────────────

describe("project.edit_file — registered tool discovery", () => {
  it("createDefaultRegistry() exposes exactly the id \"project.edit_file\"", () => {
    const registry = createDefaultRegistry();
    const ids = registry.list().map((d) => d.id);
    assert.ok(ids.includes("project.edit_file"), `expected "project.edit_file" among: ${ids.join(", ")}`);
    // Guards against the exact naming ambiguity this fix closes.
    assert.ok(!ids.includes("project.edit"), "the short, unregistered form must not exist");
  });

  it("the exposed schema requires path, search, and replace", () => {
    const entry = createDefaultRegistry().get("project.edit_file");
    assert.notEqual(entry, null);
    assert.deepEqual(
      [...(entry!.definition.inputSchema.required as string[])].sort(),
      ["path", "replace", "search"],
    );
    assert.equal(entry!.definition.readOnly, false);
  });

  it("is classified as mutating (drives ExecutionGateway policy + evidence tracking)", () => {
    const entry = createDefaultRegistry().get("project.edit_file");
    assert.equal(entry!.metadata.mutating, true);
    assert.equal(entry!.metadata.readOnly, false);
  });

  it("existing tool ids and schemas are unchanged", () => {
    const registry = createDefaultRegistry();
    const readFile = registry.get("project.read_file")!;
    assert.equal(readFile.definition.id, "project.read_file");
    assert.equal(readFile.metadata.mutating, false);
    const run = registry.get("project.run")!;
    assert.equal(run.definition.id, "project.run");
  });
});

// ─── ExecutionGateway — the real mutation path, not a bypass ───────

function makeIdentity(trusted = true): ExecutionIdentity {
  return {
    tenantId: "t1",
    userId: "u1",
    actorId: "u1",
    trusted,
    interaction: "interactive",
  };
}

describe("project.edit_file through the real ExecutionGateway", () => {
  it("PLAN mode denies the mutation outright — zero filesystem writes", async () => {
    writeFixture("a.ts", "const x = 1;\n");
    const shell = new NodeShellExecutor(workDir);
    const store = new RuntimeStore(() => {});
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    const gateway = new ExecutionGateway({ tools, shell, executor, store });

    const result = await gateway.execute({
      toolId: "project.edit_file",
      inputs: { path: "a.ts", search: "const x = 1;", replace: "const x = 2;" },
      cwd: workDir,
      mode: "plan",
      identity: makeIdentity(),
    });

    assert.equal(result.result.success, false);
    assert.equal(result.policyEffect, "deny");
    assert.equal(readFixture("a.ts"), "const x = 1;\n");
  });

  it("ACT mode + approval DENIED -> zero mutation, file unchanged", async () => {
    writeFixture("a.ts", "const x = 1;\n");
    const shell = new NodeShellExecutor(workDir);
    const store = new RuntimeStore(() => {});
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    const gateway = new ExecutionGateway({
      tools, shell, executor, store,
      onApprovalRequired: async () => false, // human denies
    });

    const result = await gateway.execute({
      toolId: "project.edit_file",
      inputs: { path: "a.ts", search: "const x = 1;", replace: "const x = 2;" },
      cwd: workDir,
      mode: "act",
      identity: makeIdentity(),
    });

    assert.equal(result.result.success, false);
    assert.equal(result.policyEffect, "require_approval");
    assert.equal(result.approved, false);
    assert.equal(readFixture("a.ts"), "const x = 1;\n", "a denied approval must leave the file untouched");
  });

  it("ACT mode + approval GRANTED -> real mutation occurs, gateway reports success", async () => {
    writeFixture("a.ts", "const x = 1;\n");
    const shell = new NodeShellExecutor(workDir);
    const store = new RuntimeStore(() => {});
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    const gateway = new ExecutionGateway({
      tools, shell, executor, store,
      onApprovalRequired: async () => true, // human approves
    });

    const result = await gateway.execute({
      toolId: "project.edit_file",
      inputs: { path: "a.ts", search: "const x = 1;", replace: "const x = 2;" },
      cwd: workDir,
      mode: "act",
      identity: makeIdentity(),
    });

    assert.equal(result.result.success, true);
    assert.equal(result.approved, true);
    assert.equal(readFixture("a.ts"), "const x = 2;\n");
    // Real mutation evidence, suitable for a VerificationGate/evidence
    // tracker to prove an actual edit occurred.
    assert.equal(result.result.data.path, "a.ts");
    assert.equal(result.result.data.occurrences, 1);
  });

  it("with no onApprovalRequired callback configured, ACT mode fails closed (no silent auto-approve)", async () => {
    writeFixture("a.ts", "const x = 1;\n");
    const shell = new NodeShellExecutor(workDir);
    const store = new RuntimeStore(() => {});
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    const gateway = new ExecutionGateway({ tools, shell, executor, store }); // no callback

    const result = await gateway.execute({
      toolId: "project.edit_file",
      inputs: { path: "a.ts", search: "const x = 1;", replace: "const x = 2;" },
      cwd: workDir,
      mode: "act",
      identity: makeIdentity(),
    });

    assert.equal(result.result.success, false);
    assert.equal(readFixture("a.ts"), "const x = 1;\n");
  });

  it("existing project.run behavior through the SAME gateway instance is unchanged", async () => {
    const shell = new NodeShellExecutor(workDir);
    const store = new RuntimeStore(() => {});
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    const gateway = new ExecutionGateway({ tools, shell, executor, store });

    // A safe command should still just be allowed, exactly as before
    // this tool was added — proves adding a new mutating tool did not
    // change project.run's own (unrelated) risk classification/policy.
    const result = await gateway.execute({
      toolId: "project.run",
      inputs: { command: "echo", args: ["hi"] },
      cwd: workDir,
      mode: "act",
      identity: makeIdentity(),
    });

    assert.equal(result.policyEffect, "allow");
    assert.equal(result.result.success, true);
  });
});
