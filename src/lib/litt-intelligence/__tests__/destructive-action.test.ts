// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P0 R6 — destructive-action safety (Execution Integrity Contract §R6).
 *
 * Origin: Acceptance Run 1 restart, 2026-11-26. The agent requested
 * four consecutive files.delete approvals whose cards named NO
 * target; three approved deletes removed the two images index.html
 * referenced, and publishing broke. The founder's ruling: LiTT
 * protects customers from destructive agent mistakes instead of
 * asking them to approve those mistakes.
 *
 * Pinned here:
 *   (a) an unidentified target creates NO approval — the gate refuses
 *       and feeds the refusal back (blind-delete impossibility);
 *   (b) a gate for an identified target carries the card contract:
 *       target, operation, dependencies, blocked status, actions;
 *   (c) deleting an asset that live project files still reference is
 *       BLOCKED at execution; repairing the reference first lets the
 *       same delete land (the contract's repair-in-operation path);
 *   (d) a run that keeps requesting deletions with no other completed
 *       work is stopped at the streak limit instead of being asked
 *       again (the four-delete loop).
 */

vi.mock("../llm-tool-calling", async (original) => ({
  ...(await (original() as Promise<Record<string, unknown>>)),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/metering", () => ({
  emitUsageEvent: vi.fn(async () => ({})),
  getMeteringContext: vi.fn(() => null),
  runWithMeteringContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { callLLMWithTools } from "../llm-tool-calling";
import { runAgentLoopV2, resumeAgentLoopV2, type AgentLoopConfig, type ResumeInput } from "../agent-loop-v2";
import { handleFilesDelete } from "../tool-handlers-v2";
import {
  DESTRUCTIVE_GATE_STREAK_LIMIT,
  assessDestructiveAction,
  destructiveApprovalReason,
  destructiveTargetFor,
  findAssetReferences,
  trailingDestructiveStreak,
} from "../destructive-action";
import type { WorkspaceTransport } from "../workspace-transport";
import { buildAssistantToolCallMessage, type LLMMessage } from "../llm-tool-calling";

// ─── In-memory workspace ────────────────────────────────────────────

const BAKERY_HTML =
  '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head>' +
  '<body><h1>Bakery</h1><img src="assets/images/hero.jpeg" alt="Bakery interior">' +
  '<script src="app.js"></script></body></html>';
const BAKERY_CSS = "body { background: url(assets/images/bg.png); }";

function makeTransport(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const transport = {
    workspaceId: "ws-test",
    projectId: "p-test",
    userId: "u-test",
    workspaceRoot: "/workspace",
    fileOpsReachable: true,
    listFiles: vi.fn(async (dir: string) => {
      const prefix = dir ? `${dir}/` : "";
      const entries: { name: string; type: "file" | "directory" }[] = [];
      const seen = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        if (seen.has(head)) continue;
        seen.add(head);
        entries.push({ name: head, type: tail.length > 0 ? "directory" : "file" });
      }
      return { entries };
    }),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`not found: ${path}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return { saved: true };
    }),
    deleteFile: vi.fn(async (path: string) => {
      if (!files.delete(path)) throw new Error(`not found: ${path}`);
      return { deleted: true };
    }),
    createCheckpointBeforeMutation: vi.fn(async (label: string) => ({
      checkpointId: "cp-1",
      label,
      gitSha: "sha-1",
    })),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 })),
    gitStatus: vi.fn(async () => ({
      branch: "main", ahead: 0, behind: 0, staged: [], modified: [], untracked: [], clean: true,
    })),
    gitDiff: vi.fn(async () => ({ diff: "" })),
    stat: vi.fn(async () => ({ kind: "unknown" })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

function makeConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    maxSteps: 8,
    maxRuntimeMs: 600_000,
    maxOutputChars: 20_000,
    maxRetries: 0,
    executionMode: "act",
    systemPrompt: "test system prompt",
    enableBuildFix: false,
    userId: "u-test",
    ...overrides,
  };
}

function llmToolCall(toolId: string, toolCallId: string, inputs: Record<string, unknown>) {
  return {
    text: "",
    model: "test-model",
    finishReason: "tool_calls",
    toolCalls: [{ toolId, toolCallId, inputs }],
  } as never;
}

function llmText(text: string) {
  return { text, model: "test-model", finishReason: "stop", toolCalls: [] } as never;
}

// ─── Unit: target identification ────────────────────────────────────

describe("destructiveTargetFor", () => {
  it("returns the normalized path for an identified delete", () => {
    expect(destructiveTargetFor("files.delete", { path: "assets/a.png" })).toBe("assets/a.png");
    expect(destructiveTargetFor("files.delete", { path: "/assets/a.png" })).toBe("assets/a.png");
    expect(destructiveTargetFor("files.delete", { path: "./assets//a.png" })).toBe("assets/a.png");
  });

  it("returns null for a missing, blank, or non-string path — the blind delete", () => {
    expect(destructiveTargetFor("files.delete", {})).toBeNull();
    expect(destructiveTargetFor("files.delete", { path: "" })).toBeNull();
    expect(destructiveTargetFor("files.delete", { path: "   " })).toBeNull();
    expect(destructiveTargetFor("files.delete", { path: 42 })).toBeNull();
    expect(destructiveTargetFor("files.delete", undefined)).toBeNull();
  });

  it("returns null for non-destructive tools", () => {
    expect(destructiveTargetFor("files.write", { path: "a.txt" })).toBeNull();
  });
});

// ─── Unit: the streak counter ───────────────────────────────────────

describe("trailingDestructiveStreak", () => {
  const del = (success: boolean) => ({ toolId: "files.delete", success, mutating: true });
  const write = (success: boolean) => ({ toolId: "files.write", success, mutating: true });
  const read = { toolId: "files.read", success: true, mutating: false };

  it("counts consecutive destructive events at the tail", () => {
    expect(trailingDestructiveStreak([del(true), del(false), del(true)])).toBe(3);
    expect(trailingDestructiveStreak([])).toBe(0);
  });

  it("a successful non-destructive mutation resets the streak", () => {
    expect(trailingDestructiveStreak([del(true), write(true), del(true)])).toBe(1);
  });

  it("failed writes and reads neither add to nor reset the streak", () => {
    expect(trailingDestructiveStreak([del(true), write(false), read, del(true)])).toBe(2);
  });
});

// ─── Unit: dependency inspection ────────────────────────────────────

describe("findAssetReferences", () => {
  it("finds HTML and CSS references to the target", async () => {
    const { transport } = makeTransport({
      "index.html": BAKERY_HTML,
      "styles.css": BAKERY_CSS,
      "assets/images/hero.jpeg": "jpeg-bytes",
      "assets/images/bg.png": "png-bytes",
    });
    expect(await findAssetReferences(transport, "assets/images/hero.jpeg")).toEqual([
      { path: "index.html", reference: "assets/images/hero.jpeg" },
    ]);
    expect(await findAssetReferences(transport, "assets/images/bg.png")).toEqual([
      { path: "styles.css", reference: "assets/images/bg.png" },
    ]);
    expect(await findAssetReferences(transport, "assets/images/unused.png")).toEqual([]);
  });

  it("honors the public/ serving prefix and directory targets", async () => {
    const { transport } = makeTransport({
      "index.html": BAKERY_HTML,
      "public/assets/images/hero.jpeg": "jpeg-bytes",
    });
    // The file lives under public/ but is referenced without the prefix.
    expect(await findAssetReferences(transport, "public/assets/images/hero.jpeg")).toHaveLength(1);
    // A directory target matches every reference beneath it.
    expect(await findAssetReferences(transport, "assets/images")).toHaveLength(1);
  });
});

// ─── Unit: the card contract ────────────────────────────────────────

describe("assessDestructiveAction + destructiveApprovalReason", () => {
  it("a referenced asset assesses BLOCKED with replace/cancel/review actions", async () => {
    const { transport } = makeTransport({
      "index.html": BAKERY_HTML,
      "assets/images/hero.jpeg": "jpeg-bytes",
    });
    const assessment = await assessDestructiveAction({
      toolId: "files.delete",
      inputs: { path: "assets/images/hero.jpeg" },
      reason: "Approval required",
      transport,
      recoveryAvailable: true,
      gateStreak: 1,
    });
    expect(assessment).not.toBeNull();
    expect(assessment!.target).toBe("assets/images/hero.jpeg");
    expect(assessment!.operation).toBe("Delete file");
    expect(assessment!.blocked).toBe(true);
    expect(assessment!.dependencies).toEqual([
      { path: "index.html", reference: "assets/images/hero.jpeg" },
    ]);
    expect(assessment!.availableActions).toEqual(["replace", "cancel", "review"]);
    expect(assessment!.recovery).toBe("checkpoint");

    const reason = destructiveApprovalReason(assessment!, "Approval required");
    expect(reason).toContain("Target: assets/images/hero.jpeg");
    expect(reason).toContain("index.html references this asset");
    expect(reason).toContain("Status: BLOCKED");
  });

  it("an unreferenced asset assesses unblocked", async () => {
    const { transport } = makeTransport({
      "index.html": BAKERY_HTML,
      "assets/old.png": "png-bytes",
    });
    const assessment = await assessDestructiveAction({
      toolId: "files.delete",
      inputs: { path: "assets/old.png" },
      reason: "Approval required",
      transport,
      recoveryAvailable: false,
      gateStreak: 1,
    });
    expect(assessment!.blocked).toBe(false);
    expect(assessment!.dependencies).toEqual([]);
    expect(assessment!.availableActions).toEqual(["cancel", "review"]);
    expect(assessment!.recovery).toBe("none");
  });
});

// ─── Handler: the execution-time block ──────────────────────────────

describe("handleFilesDelete dependency block (R6)", () => {
  it("blocks deleting an asset that index.html still references", async () => {
    const { transport, files } = makeTransport({
      "index.html": BAKERY_HTML,
      "assets/images/hero.jpeg": "jpeg-bytes",
    });
    const result = await handleFilesDelete({ path: "assets/images/hero.jpeg" }, transport);
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.referencedBy).toEqual(["index.html"]);
    expect(result.error).toContain("Deletion blocked");
    expect(transport.deleteFile).not.toHaveBeenCalled();
    expect(files.has("assets/images/hero.jpeg")).toBe(true);
  });

  it("deletes an unreferenced asset", async () => {
    const { transport, files } = makeTransport({
      "index.html": BAKERY_HTML,
      "assets/old.png": "png-bytes",
    });
    const result = await handleFilesDelete({ path: "assets/old.png" }, transport);
    expect(result.success).toBe(true);
    expect(files.has("assets/old.png")).toBe(false);
  });

  it("the same delete lands once the reference has been repaired", async () => {
    const { transport, files } = makeTransport({
      "index.html": BAKERY_HTML,
      "assets/images/hero.jpeg": "jpeg-bytes",
    });
    // Repair: repoint the page at an image that stays.
    files.set("index.html", BAKERY_HTML.replace("assets/images/hero.jpeg", "assets/images/other.jpeg"));
    const result = await handleFilesDelete({ path: "assets/images/hero.jpeg" }, transport);
    expect(result.success).toBe(true);
    expect(files.has("assets/images/hero.jpeg")).toBe(false);
  });
});

// ─── Loop level: the gate ───────────────────────────────────────────

describe("agent loop destructive gates (R6)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("(a) a delete naming NO target creates no approval — the gate refuses it", async () => {
    const { transport } = makeTransport({ "index.html": BAKERY_HTML });
    // The incident shape: files.delete with a blank path passes the
    // registry's key-presence validation and reaches the gate.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      llmToolCall("files.delete", "tc-blind-1", { path: "" }),
    );
    vi.mocked(callLLMWithTools).mockResolvedValue(llmText("I could not identify the file to delete."));

    const result = await runAgentLoopV2("Clean up the old files", transport, makeConfig());

    expect(result.pendingApproval).toBeUndefined();
    const refusal = result.toolCalls.find((c) => c.toolId === "files.delete");
    expect(refusal).toBeDefined();
    expect(refusal!.success).toBe(false);
    expect(refusal!.summary).toContain("without an identified target");
    expect(transport.deleteFile).not.toHaveBeenCalled();
  });

  it("(b) an identified delete gates with the full card contract on the pause", async () => {
    const { transport } = makeTransport({
      "index.html": BAKERY_HTML,
      "assets/images/hero.jpeg": "jpeg-bytes",
    });
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      llmToolCall("files.delete", "tc-del-1", { path: "assets/images/hero.jpeg" }),
    );

    const result = await runAgentLoopV2("Remove the hero image", transport, makeConfig());

    const gate = result.pendingApproval;
    expect(gate).toBeDefined();
    expect(gate!.destructiveAction).toBeDefined();
    expect(gate!.destructiveAction!.target).toBe("assets/images/hero.jpeg");
    expect(gate!.destructiveAction!.blocked).toBe(true);
    expect(gate!.destructiveAction!.dependencies).toEqual([
      { path: "index.html", reference: "assets/images/hero.jpeg" },
    ]);
    expect(gate!.destructiveAction!.availableActions).toEqual(["replace", "cancel", "review"]);
    expect(gate!.reason).toContain("Target: assets/images/hero.jpeg");
    expect(gate!.reason).toContain("Status: BLOCKED");
    // Nothing executed — the run is paused at the gate.
    expect(transport.deleteFile).not.toHaveBeenCalled();
  });

  it("(d) the delete loop stops at the streak limit instead of a fourth approval", async () => {
    const { transport, files } = makeTransport({
      "index.html": BAKERY_HTML,
      "assets/a.png": "a",
      "assets/b.png": "b",
      "assets/c.png": "c",
      "assets/d.png": "d",
    });

    const pausedFor = (path: string, toolCallId: string): ResumeInput => {
      const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
        [{ toolId: "files.delete", toolCallId, inputs: { path } }],
        "",
        undefined,
      );
      return {
        pausedMessages: [{ role: "user", content: "Clean up the assets folder" }, assistantMsg],
        toolId: "files.delete",
        toolCallId,
        inputs: { path },
        decision: "approved",
        config: {
          systemPrompt: "test system prompt",
          executionMode: "act",
          enableBuildFix: false,
        },
        stepsUsedBeforePause: 1,
        hadInterveningMutation: false,
      };
    };

    const nextGate = (
      result: Awaited<ReturnType<typeof resumeAgentLoopV2>>,
      priorToolCalls: ResumeInput["priorToolCalls"],
    ): ResumeInput => {
      const gate = result.pendingApproval;
      if (!gate) throw new Error("expected a pending approval gate");
      return {
        pausedMessages: gate.pausedMessages,
        toolId: gate.toolId,
        toolCallId: gate.toolCallId,
        inputs: gate.inputs,
        decision: "approved",
        config: {
          systemPrompt: "test system prompt",
          executionMode: "act",
          enableBuildFix: false,
        },
        stepsUsedBeforePause: result.stepsUsed,
        hadInterveningMutation: gate.hadInterveningMutationAtPause ?? false,
        priorToolCalls,
      };
    };

    // Delete 1 approved and executed; the model asks for delete 2.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      llmToolCall("files.delete", "tc-del-b", { path: "assets/b.png" }),
    );
    const r1 = await resumeAgentLoopV2(pausedFor("assets/a.png", "tc-del-a"), transport);
    expect(r1.pendingApproval?.destructiveAction?.target).toBe("assets/b.png");
    expect(r1.pendingApproval?.destructiveAction?.gateStreak).toBe(2);
    expect(files.has("assets/a.png")).toBe(false);

    // Delete 2 approved and executed; the model asks for delete 3.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      llmToolCall("files.delete", "tc-del-c", { path: "assets/c.png" }),
    );
    const r2 = await resumeAgentLoopV2(
      nextGate(r1, r1.pendingApproval!.priorToolCalls),
      transport,
    );
    expect(r2.pendingApproval?.destructiveAction?.target).toBe("assets/c.png");
    expect(r2.pendingApproval?.destructiveAction?.gateStreak).toBe(3);
    expect(files.has("assets/b.png")).toBe(false);

    // Delete 3 approved and executed; the model asks for a FOURTH
    // consecutive delete — no fourth approval is created; the run
    // ends honestly and d.png survives.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      llmToolCall("files.delete", "tc-del-d", { path: "assets/d.png" }),
    );
    vi.mocked(callLLMWithTools).mockResolvedValue(llmText("Deleting more files."));
    const r3 = await resumeAgentLoopV2(
      nextGate(r2, r2.pendingApproval!.priorToolCalls),
      transport,
    );
    expect(r3.pendingApproval).toBeUndefined();
    expect(r3.failedHonestly).toBeDefined();
    expect(r3.failedHonestly).toContain("destructive actions");
    expect(r3.failedHonestly).toContain(String(DESTRUCTIVE_GATE_STREAK_LIMIT));
    expect(files.has("assets/c.png")).toBe(false);
    expect(files.has("assets/d.png")).toBe(true);
  });
});
