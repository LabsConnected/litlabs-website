// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * P0 build reliability (2026-11-27) — regression tests shaped like the
 * two production runs that failed on the d8246e6d release:
 *
 *   - c2963c68: the fallback model emitted preview.inspect with an
 *     OBJECT "selector"; the registry's validation refused it, the
 *     bounce carried no correction guidance and was invisible to the
 *     repeat machinery, and the run settled failed (build-verification
 *     stamp) even though index.html was written.
 *   - 8efba402: covered by the F2 describe block below (resume-segment
 *     write validation parity).
 *
 * F1 contract pinned here:
 *   - a validation bounce feeds the model the error PLUS the tool's
 *     own correction hint, and is recorded (log entry flagged bounced,
 *     entry in the repeated-call ledger);
 *   - identical bounces are bounded by the nudge-then-honest-stop
 *     ladder — a stuck model ends in a real closing message;
 *   - the build-verification stamp does not fail a run whose only
 *     failure evidence is a bounced read-only call when a workspace
 *     write verifiably landed.
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, callLLMWithTools } from "./llm-tool-calling";

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Harbor Lights Coffee</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Harbor Lights Coffee</h1><p>Your daily dose of coastal calm.</p></body></html>",
].join("\n");

function diskTransport(initial: Record<string, string> = {}, opts: { cleanGit?: boolean } = {}) {
  const disk = new Map<string, string>(Object.entries(initial));
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    readFile: vi.fn(async (path: string) => {
      const content = disk.get(path);
      if (content === undefined) throw new Error(`readFile failed (404): ${path}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      disk.set(path, content);
    }),
    mkdir: vi.fn(async () => ({ created: true })),
    createCheckpointBeforeMutation: vi.fn(async (label: string) => ({ checkpointId: "cp-1", label, gitSha: "a".repeat(40) })),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [] as string[],
      untracked: [] as string[],
      // cleanGit simulates the production evidence gap: the write
      // landed on the volume but the git diff channel reports nothing.
      modified: opts.cleanGit || disk.get("index.html") === initial["index.html"] ? [] : ["index.html"],
      clean: opts.cleanGit ? true : disk.get("index.html") === initial["index.html"],
    })),
  } as unknown as WorkspaceTransport;
  return { transport, disk };
}

function toolReply(toolId: string, inputs: Record<string, unknown>, id: string) {
  return {
    text: "",
    toolCalls: [{ toolCallId: id, toolId, inputs }],
    finishReason: "tool_calls",
    model: "test-model",
  };
}

function textReply(text: string) {
  return { text, toolCalls: [], finishReason: "stop", model: "test-model" };
}

function toolResultFor(result: { finalMessages?: Array<{ role: string; tool_call_id?: string; content?: unknown }> }, toolCallId: string) {
  return (result.finalMessages ?? []).find((m) => m.role === "tool" && m.tool_call_id === toolCallId);
}

const BASE_CFG = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  executionMode: "auto",
  enableBuildFix: false,
} as const;

describe("P0 F1 — validation-bounce recovery (production run c2963c68 shape)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("bounces the malformed preview.inspect with the tool's own hint, records the repeat, and the corrected call executes", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    vi.mocked(callLLMWithTools)
      // The production failure: fallback model passes an OBJECT selector.
      .mockResolvedValueOnce(toolReply("preview.inspect", { selector: { css: "h1" } }, "tc-bad-1"))
      // The identical repeat — must be recorded, not invisible.
      .mockResolvedValueOnce(toolReply("preview.inspect", { selector: { css: "h1" } }, "tc-bad-2"))
      // Corrected: selector is now a string, so registry validation
      // passes and the call EXECUTES (the station handler then answers
      // with its own invalid-args guidance — proof it ran).
      .mockResolvedValueOnce(toolReply("preview.inspect", { selector: "h1" }, "tc-fixed"))
      .mockResolvedValueOnce(textReply("Inspected the page."));

    const result = await runAgentLoopV2("build a coffee shop page and inspect it", transport, { ...BASE_CFG });

    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(4);
    expect(result.cancelled).toBe(false);
    expect(result.failedHonestly).toBeUndefined();

    // The bounce carried the registry error AND the station's own
    // correction ("Call without a selector") — pre-fix the model got
    // the bare type error and had to guess.
    const bounce1 = toolResultFor(result, "tc-bad-1");
    expect(String(bounce1?.content)).toContain('Field "selector" expected type "string", got "object"');
    expect(String(bounce1?.content)).toContain("Call without a selector");

    // Both bounces are recorded in the run's tool log, flagged as
    // pre-execution refusals (the ledger entry is what the repeat
    // detector consumes; the log flag is its visible evidence).
    const bounces = result.toolCalls.filter((c) => c.toolId === "preview.inspect" && c.bounced);
    expect(bounces).toHaveLength(2);
    expect(bounces.every((c) => c.success === false && c.bouncedReadOnly === true)).toBe(true);

    // The corrected call executed: its result is the station handler's
    // own answer, not the registry's validation error.
    const executed = toolResultFor(result, "tc-fixed");
    expect(String(executed?.content)).not.toContain('Field "selector" expected type');
    expect(String(executed?.content)).toContain("does not support selector-scoped inspection");
  });

  it("bounds identical bounces with the nudge ladder and stops honestly with a closing message", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const bad = (id: string) => toolReply("preview.inspect", { selector: { css: "h1" } }, id);
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(bad("tc-1"))
      .mockResolvedValueOnce(bad("tc-2"))
      .mockResolvedValueOnce(bad("tc-3"))
      .mockResolvedValueOnce(bad("tc-4"))
      .mockResolvedValueOnce(bad("tc-5"))
      .mockResolvedValueOnce(bad("tc-6"))
      // A 7th reply exists only to prove it is never reached.
      .mockResolvedValueOnce(textReply("I give up."));

    const result = await runAgentLoopV2("inspect the page", transport, { ...BASE_CFG });

    // 3 plain bounces + 2 escalated nudges + the stop on the 6th
    // identical call — the same bound as repeated executed calls.
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(6);
    const nudged = toolResultFor(result, "tc-4");
    expect(String(nudged?.content)).toContain("refused repeatedly with identical inputs");
    expect(result.cancelled).toBe(true);
    expect(result.finalText).toContain("kept trying to call preview.inspect");
    expect(result.finalText).toContain('Field "selector" expected type "string", got "object"');
  });

  it("the build-verification stamp does not fail a run whose only failure is a bounced read-only call when a write landed", async () => {
    // Production shape: index.html is written and read-back verifies
    // it, but the workspace diff channel reports the tree unchanged
    // (cleanGit) — the stamp's "no files were changed" verdict is the
    // diff channel's failure, not the build's.
    const { transport, disk } = diskTransport({}, { cleanGit: true });
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: PAGE }, "tc-write"))
      .mockResolvedValueOnce(toolReply("preview.inspect", { selector: { css: "h1" } }, "tc-bad"))
      .mockResolvedValueOnce(textReply("Page built."));

    const result = await runAgentLoopV2("build a one-page coffee shop site", transport, {
      ...BASE_CFG,
      buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
    });

    // The write really landed and its log entry carries the evidence.
    expect(disk.get("index.html")).toBe(PAGE);
    const write = result.toolCalls.find((c) => c.toolId === "files.write");
    expect(write?.success).toBe(true);
    expect(write?.persisted).toBe(true);

    // The diff evidence really did come back "unchanged" — the stamp
    // would have fired on it pre-fix.
    expect(result.events.some((e) => e.type === "workspace_change" && e.status === "unchanged")).toBe(true);

    // The only failure entry is the bounced read-only call.
    const failures = result.toolCalls.filter((c) => !c.success);
    expect(failures).toHaveLength(1);
    expect(failures[0].toolId).toBe("preview.inspect");
    expect(failures[0].bounced).toBe(true);

    expect(result.failedHonestly).toBeUndefined();
    expect(result.cancelled).toBe(false);
  });
});

describe("P0 F2 — write-validation parity on resume (production run 8efba402 shape)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  // The existing page: real HTML whose substantive lines the model's
  // replacement shares almost nothing with (retention 0.25 < 0.5), no
  // declared overwrite — the full-overwrite gate must refuse it. Its
  // styling signature is minimal (< 3 markers), so the gate's
  // destructive-rewrite deferral does not apply.
  const REBUILD = [
    "<!DOCTYPE html>",
    "<html><head><title>Harbor Lights — Rebuilt</title>",
    "<style>body { background: #0c0a09; color: #fafaf9; }</style>",
    "</head><body><h1>Harbor Lights, Reimagined</h1><p>A brand new page, top to bottom.</p></body></html>",
  ].join("\n");

  function approvedMkdirResume(): ResumeInput {
    return {
      pausedMessages: [
        { role: "user", content: "Build a one-page site for Harbor Lights Coffee and rebuild the home page" },
        buildAssistantToolCallMessage(
          [{ toolId: "files.mkdir", toolCallId: "tc-0", inputs: { path: "assets" } }],
          "Setting up the project.",
          undefined,
        ),
      ],
      toolId: "files.mkdir",
      toolCallId: "tc-0",
      inputs: { path: "assets" },
      decision: "approved",
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
      config: {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        userId: "u-test",
        executionMode: "auto",
        enableBuildFix: false,
        isStaticWorkspace: true,
        maxSteps: 40,
        buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
      },
    };
  }

  it("a resumed run's gate-tripping files.write bounces pre-execution with recovery feedback instead of dying at the handler", async () => {
    const { transport, disk } = diskTransport({ "index.html": PAGE });
    vi.mocked(callLLMWithTools)
      // Post-approval, the model tries to replace the existing page
      // wholesale without declaring the overwrite. Pre-F2 the resume
      // segment had no pre-approval validation, so this went straight
      // to the handler, whose execution-time gate killed the run.
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: REBUILD }, "tc-bad-write"))
      // The recovery the bounce steers to: the same rebuild, now with
      // the overwrite explicitly declared.
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: REBUILD, allowOverwrite: true }, "tc-fixed-write"))
      .mockResolvedValueOnce(textReply("Rebuilt the home page."));

    const result = await resumeAgentLoopV2(approvedMkdirResume(), transport);

    // The bounce happened BEFORE execution: the transport's writeFile
    // saw exactly one call — the declared recovery write.
    expect(vi.mocked(transport.writeFile)).toHaveBeenCalledTimes(1);
    expect(disk.get("index.html")).toBe(REBUILD);

    // The bounced call's feedback is the recovery message: the gate's
    // refusal PLUS the current file re-read from disk — the material
    // the model needs to correct itself (pre-F2 it got neither here).
    const bounce = toolResultFor(result, "tc-bad-write");
    expect(String(bounce?.content)).toContain("already exists — a full-file overwrite is not the edit path");
    expect(String(bounce?.content)).toContain("SAFE WRITE RECOVERY ATTEMPT 1");
    expect(String(bounce?.content)).toContain("Harbor Lights Coffee");

    // The bounce is logged as a pre-approval rejection, and the run
    // completed on the recovery — not failed, not cancelled.
    const rejection = result.toolCalls.find((c) => c.toolId === "files.write" && !c.success);
    expect(rejection?.summary).toBe("files.write rejected pre-approval — model retries with corrected inputs");
    expect(result.failedHonestly).toBeUndefined();
    expect(result.cancelled).toBe(false);
    expect(result.finalText).toBe("Rebuilt the home page.");
  });
});
