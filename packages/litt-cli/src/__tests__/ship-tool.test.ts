/**
 * Regression tests for `project.ship` — the agent-callable safe shipping
 * capability (wraps shipWorkflow() from git-workflow.ts).
 *
 * Two layers are tested:
 *
 *   1. Handler-level: shipHandler() called directly with a ToolContext,
 *      proving it delegates to shipWorkflow() faithfully (no duplicated
 *      or diverging safety logic) and reports structured results.
 *
 *   2. Gateway-level: the REAL ExecutionGateway + ToolRegistry, proving
 *      project.ship cannot execute without going through the gateway's
 *      approval flow — PLAN denies, missing approval callback fails
 *      closed, denied approval performs no git mutation, and approved
 *      execution performs the real branch/stage/commit.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import {
  ExecutionGateway,
  ToolRegistry,
  CommandExecutor,
  RuntimeStore,
  createShellExecutor,
  type ExecutionRequest,
} from "@litt/agent-core";
import { SHIP_TOOL_ENTRY, SHIP_TOOL_DEFINITION, SHIP_TOOL_METADATA, shipHandler } from "../lib/ship-tool.js";

// ─── Test helpers ─────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-ship-tool-test-"));
  git(["init", "--initial-branch=main"], dir);
  git(["config", "user.email", "test@litt.ai"], dir);
  git(["config", "user.name", "LiTT Test"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n");
  git(["add", "README.md"], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeFile(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function fakeCtx(cwd: string) {
  return { cwd, projectId: null, userId: null, shell: createShellExecutor(cwd) };
}

// ─── Tool metadata ──────────────────────────────────────────────────

describe("project.ship — tool metadata", () => {
  it("is registered as mutating, non-read-only", () => {
    expect(SHIP_TOOL_DEFINITION.id).toBe("project.ship");
    expect(SHIP_TOOL_DEFINITION.readOnly).toBe(false);
    expect(SHIP_TOOL_METADATA.mutating).toBe(true);
    expect(SHIP_TOOL_METADATA.readOnly).toBe(false);
  });

  it("requires files and message in its input schema", () => {
    const schema = SHIP_TOOL_DEFINITION.inputSchema as { required?: string[] };
    expect(schema.required).toEqual(["files", "message"]);
  });

  it("exposes no force-push or protected-branch-override input", () => {
    const schema = SHIP_TOOL_DEFINITION.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties.force).toBeUndefined();
    expect(schema.properties.protectedBranches).toBeUndefined();
  });
});

// ─── Handler-level: delegates to shipWorkflow faithfully ────────────

describe("shipHandler — delegates to shipWorkflow", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails when no files are given", async () => {
    const result = await shipHandler(fakeCtx(dir), { message: "feat: x" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("No files specified");
  });

  it("fails when message is missing", async () => {
    makeFile(dir, "src/a.ts", "export const a = 1;\n");
    const result = await shipHandler(fakeCtx(dir), { files: ["src/a.ts"] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("commit message");
  });

  it("ships only the intended files, preserving unrelated dirty files, with push/PR disabled", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    makeFile(dir, "unrelated.ts", "export const u = 1;\n");

    const result = await shipHandler(fakeCtx(dir), {
      files: ["src/feature.ts"],
      message: "feat: add feature",
      push: false,
      createPR: false,
    });

    expect(result.success).toBe(true);
    expect(result.data.stagedFiles).toEqual(["src/feature.ts"]);
    expect(result.data.commitSha).toBeTruthy();

    const status = git(["status", "--porcelain=v1"], dir);
    expect(status).toContain("?? unrelated.ts");

    const committed = git(["show", "--name-only", "--oneline", "HEAD"], dir);
    expect(committed).toContain("src/feature.ts");
    expect(committed).not.toContain("unrelated.ts");
  });

  it("refuses to ship directly to main (delegated, not reimplemented)", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    const result = await shipHandler(fakeCtx(dir), {
      files: ["src/feature.ts"],
      message: "feat: add feature",
      branch: "main",
      push: false,
      createPR: false,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("protected");
  });

  it("reports push status truthfully when no remote is configured", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    const result = await shipHandler(fakeCtx(dir), {
      files: ["src/feature.ts"],
      message: "feat: add feature",
      push: true,
      createPR: false,
    });
    // Commit succeeds, push fails (no remote) — never force-pushed, never fabricated success.
    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).toContain("push");
    expect(result.data.commitSha).toBeTruthy();
  });
});

// ─── Gateway-level: cannot execute without going through ExecutionGateway ───

function makeGateway(cwd: string, opts?: { onApprovalRequired?: (req: ExecutionRequest, risk: unknown) => Promise<boolean> }) {
  const shell = createShellExecutor(cwd);
  const store = new RuntimeStore();
  const executor = new CommandExecutor(shell, store);
  const tools = new ToolRegistry({ "project.ship": SHIP_TOOL_ENTRY });
  const gateway = new ExecutionGateway({
    tools,
    shell,
    executor,
    store,
    projectId: cwd,
    onApprovalRequired: opts?.onApprovalRequired as never,
  });
  return gateway;
}

function shipRequest(cwd: string, mode: "plan" | "act" | "auto", overrides?: Partial<ExecutionRequest>): ExecutionRequest {
  return {
    toolId: "project.ship",
    inputs: { files: ["src/feature.ts"], message: "feat: add feature", push: false, createPR: false },
    cwd,
    mode,
    identity: {
      tenantId: "t1",
      userId: "u1",
      actorId: "u1",
      trusted: false,
      interaction: "interactive",
    },
    ...overrides,
  };
}

describe("project.ship — gateway approval enforcement", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("PLAN mode denies — no branch or commit is created", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    const gateway = makeGateway(dir);

    const result = await gateway.execute(shipRequest(dir, "plan"));

    expect(result.policyEffect).toBe("deny");
    expect(result.result.success).toBe(false);
    expect(git(["branch", "--show-current"], dir)).toBe("main");
    expect(git(["log", "--oneline"], dir).split("\n")).toHaveLength(1);
  });

  it("ACT mode without an approval callback fails closed — no mutation", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    const gateway = makeGateway(dir); // no onApprovalRequired

    const result = await gateway.execute(shipRequest(dir, "act"));

    expect(result.policyEffect).toBe("require_approval");
    expect(result.approved).toBe(false);
    expect(result.result.success).toBe(false);
    expect(git(["branch", "--show-current"], dir)).toBe("main");
    expect(git(["log", "--oneline"], dir).split("\n")).toHaveLength(1);
  });

  it("ACT mode with a human denial performs no git mutation", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    let asked = false;
    const gateway = makeGateway(dir, {
      onApprovalRequired: async () => {
        asked = true;
        return false; // human denies
      },
    });

    const result = await gateway.execute(shipRequest(dir, "act"));

    expect(asked).toBe(true);
    expect(result.approved).toBe(false);
    expect(result.result.success).toBe(false);
    expect(git(["branch", "--show-current"], dir)).toBe("main");
    expect(git(["log", "--oneline"], dir).split("\n")).toHaveLength(1);
  });

  it("ACT mode with human approval executes the real ship workflow", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    let asked = false;
    const gateway = makeGateway(dir, {
      onApprovalRequired: async () => {
        asked = true;
        return true; // human approves
      },
    });

    const result = await gateway.execute(shipRequest(dir, "act"));

    expect(asked).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.result.success).toBe(true);
    expect(result.capsule).toBeTruthy();
    expect(result.capsule?.approval).toBeTruthy();

    // Real git state actually changed, only after approval.
    expect(git(["branch", "--show-current"], dir)).not.toBe("main");
    const committed = git(["show", "--name-only", "--oneline", "HEAD"], dir);
    expect(committed).toContain("src/feature.ts");
  });

  it("even with human approval, refuses to ship directly to main", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    const gateway = makeGateway(dir, { onApprovalRequired: async () => true });

    const result = await gateway.execute(
      shipRequest(dir, "act", { inputs: { files: ["src/feature.ts"], message: "feat: x", branch: "main", push: false, createPR: false } }),
    );

    expect(result.result.success).toBe(false);
    expect(result.result.message).toContain("protected");
    expect(git(["log", "--oneline"], dir).split("\n")).toHaveLength(1);
  });

  it("AUTO mode without a verified grant is denied without ever prompting a human (AUTO never manufactures approval)", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    let asked = false;
    const gateway = makeGateway(dir, {
      onApprovalRequired: async () => {
        asked = true;
        return true;
      },
    });

    const result = await gateway.execute(shipRequest(dir, "auto"));

    expect(result.policyEffect).toBe("require_approval");
    expect(result.approved).toBe(false);
    expect(result.result.success).toBe(false);
    expect(asked).toBe(false);
    expect(git(["branch", "--show-current"], dir)).toBe("main");
    expect(git(["log", "--oneline"], dir).split("\n")).toHaveLength(1);
  });
});
