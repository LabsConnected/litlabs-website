/**
 * LIVE self-hosting edit — LiTT edits its OWN repository.
 *
 * Proves LiTT can inspect → edit → test → verify → report on the
 * feat/litt-final-integration repository itself.
 *
 * Cycle:
 *   1. Inject a tiny safe defect in a NEW isolated file in the repo
 *      (does NOT touch any build/test/source path — a scratch file).
 *   2. Run the agent loop with the live model, pointing at the real
 *      repo root. The model gets the real project context
 *      (name=litt-final-integration, branch=feat/litt-final-integration).
 *   3. The model inspects (read_file), edits (edit_file), and reports.
 *   4. Verify the file was actually changed by the model.
 *   5. Clean up the scratch file (revert the defect).
 *
 * Skips when OPENROUTER_API_KEY is not set (no live model available).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  runAgentLoop,
  ToolRegistry,
  createShellExecutor,
  CommandExecutor,
  RuntimeStore,
  ExecutionGateway,
  type RuntimeEvent,
  type StreamChunk,
  type ToolDefinition,
  type ToolEntry,
  type ToolResult,
  type ToolContext,
} from "@litt/agent-core";
import { OpenRouterModelProvider, hasOpenRouterKey } from "../lib/model-provider.js";

const skip = !hasOpenRouterKey() || process.env.LITT_RUN_LIVE_TESTS !== "1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __dirname = packages/litt-cli/src/__tests__
// REPO_ROOT = packages/litt-cli/src/__tests__/../../../.. = repo root
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

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

describe.skipIf(skip)("live self-hosting edit — LiTT edits its own repo", () => {
  let scratchFile: string;
  const originalContent = "export const ANSWER = 41;\n";

  beforeEach(() => {
    // Inject a tiny safe defect in a NEW scratch file in the repo.
    // This file is NOT part of any build/test path — it's isolated.
    scratchFile = path.join(REPO_ROOT, "packages", "litt-cli", "src", "__scratch_selfhost__.ts");
    fs.writeFileSync(scratchFile, originalContent, "utf-8");
  });

  afterEach(() => {
    // Revert the defect — remove the scratch file.
    try { fs.unlinkSync(scratchFile); } catch { /* ok */ }
  });

  it("model inspects, edits, and reports on the real feat/litt-final-integration repo", async () => {
    // Verify the defect is present
    expect(fs.existsSync(scratchFile)).toBe(true);
    expect(fs.readFileSync(scratchFile, "utf-8")).toBe(originalContent);

    const store = new RuntimeStore({ projectRoot: REPO_ROOT });
    const shell = createShellExecutor(REPO_ROOT);
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    // Register the edit_file tool with proper metadata.
    // SAFETY: The handler is restricted to ONLY write the scratch file —
    // the model cannot mutate any tracked LiTT source via this tool.
    const editFileHandler = async (_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
      const filePath = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!filePath) return { status: "failed", success: false, message: "path required", data: {} };
      // SAFETY: allow EXACTLY the isolated scratch file and nothing else.
      // Both paths are resolved (absolute, normalized). On Windows, path
      // comparisons are case-sensitive but the filesystem is not, so we
      // compare lowercased on win32 to be Windows-safe. This is the only
      // file the model may mutate during the self-hosting test.
      const resolved = path.resolve(filePath);
      const scratchResolved = path.resolve(scratchFile);
      const isScratch = process.platform === "win32"
        ? resolved.toLowerCase() === scratchResolved.toLowerCase()
        : resolved === scratchResolved;
      if (!isScratch) {
        return { status: "failed", success: false, message: `Refused: edit_file is restricted to the scratch file in this test (${scratchResolved})`, data: {} };
      }
      try {
        fs.writeFileSync(resolved, content, "utf-8");
        return { status: "success", success: true, message: `Wrote ${content.length} bytes to ${resolved}`, data: { path: resolved, bytes: content.length } };
      } catch (e) {
        return { status: "failed", success: false, message: `Write failed: ${e instanceof Error ? e.message : String(e)}`, data: {} };
      }
    };
    tools.register({
      definition: EDIT_FILE_DEF,
      handler: editFileHandler,
      metadata: { projectScoped: false, mutating: true, readOnly: false },
    });
    const gateway = new ExecutionGateway({
      tools, shell, executor, store, projectId: REPO_ROOT,
      onApprovalRequired: async () => true,
    });
    const model = new OpenRouterModelProvider({ model: "meta-llama/llama-3.3-70b-instruct", maxTokens: 1024 });

    const events: string[] = [];
    const toolCallLog: { toolId?: string; result?: boolean; msg?: string }[] = [];
    const result = await runAgentLoop(
      `In the file ${scratchFile}, the constant ANSWER is set to 41 but it should be 42. Read the file, then edit it to change 41 to 42, then read it again to confirm the edit, then report what you did.`,
      {
        model, tools, shell, gateway,
        cwd: REPO_ROOT, userId: "cli-user", mode: "act", maxRounds: 5,
        projectContext: { name: "litt-final-integration", root: REPO_ROOT, branch: "feat/litt-final-integration" },
        store,
        onModelStream: () => {},
        onToolStream: (_chunk: StreamChunk) => {},
        emitter: (event: RuntimeEvent) => {
          if (event.subtype) events.push(event.subtype);
          if (event.subtype === "agent_tool_call") {
            toolCallLog.push({ toolId: (event.data as { toolId?: string }).toolId });
          } else if (event.subtype === "agent_tool_result") {
            toolCallLog.push({ result: (event.data as { success?: boolean }).success, msg: (event.data as { message?: string }).message?.slice(0, 80) });
          }
        },
      },
    );

    console.log(`[selfhost] termination=${result.termination} rounds=${result.rounds} toolCalls=${result.toolCalls.length}`);
    console.log(`[selfhost] events=${JSON.stringify(events)}`);
    console.log(`[selfhost] toolCallLog=${JSON.stringify(toolCallLog)}`);
    console.log(`[selfhost] content=${JSON.stringify(result.content.slice(0, 200))}`);
    console.log(`[selfhost] final scratch: ${JSON.stringify(fs.readFileSync(scratchFile, "utf-8"))}`);

    // ─── The model performed a real self-hosting edit ───
    // 1. The model called edit_file (real edit on the repo)
    const editCalls = toolCallLog.filter((t) => t.toolId === "project.edit_file");
    expect(editCalls.length).toBeGreaterThan(0);

    // 2. The file was actually changed — ANSWER is now 42
    const finalContent = fs.readFileSync(scratchFile, "utf-8");
    expect(finalContent).toContain("42");
    expect(finalContent).not.toContain("41");

    // 3. The model reported what it did (nonempty content)
    expect(result.content.length).toBeGreaterThan(0);
  }, 180000);
});
