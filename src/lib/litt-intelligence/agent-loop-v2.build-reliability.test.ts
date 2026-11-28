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

import {
  deniedEffectKey,
  runAgentLoopV2,
  resumeAgentLoopV2,
  WRITE_RECOVERY_ATTEMPT_LIMIT,
  WRITE_RECOVERY_BOUNCE_BUDGET,
  type ResumeInput,
} from "./agent-loop-v2";
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

describe("P0 write-recovery hardening — bounded, denial-safe, cancellable (Larry's pre-merge requirements)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  // A files.write whose content carries an unresolved template
  // placeholder is provably invalid: validateFilesWriteInputs refuses
  // it pre-approval, so it can only ever bounce — the exact shape
  // Larry flagged ("genuinely invalid writes still bounce forever").
  const INVALID_PAGE = [
    "<!DOCTYPE html>",
    "<html><head><title>Harbor Lights Coffee</title></head>",
    "<body><h1>Welcome to {{business_name}}</h1></body></html>",
  ].join("\n");
  // The same gate-tripping replacement the F2 block uses: retention
  // 0.25 against PAGE, no declared overwrite, minimal styling
  // signature — the full-overwrite gate must refuse the first
  // emission and escalate the second.
  const REBUILD = [
    "<!DOCTYPE html>",
    "<html><head><title>Harbor Lights — Rebuilt</title>",
    "<style>body { background: #0c0a09; color: #fafaf9; }</style>",
    "</head><body><h1>Harbor Lights, Reimagined</h1><p>A brand new page, top to bottom.</p></body></html>",
  ].join("\n");

  const ACT_CFG = {
    model: "test-model",
    systemPrompt: "You are LiTT.",
    userId: "u-test",
    executionMode: "act",
    enableBuildFix: false,
    isStaticWorkspace: true,
    maxSteps: 40,
  } as const;

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
      config: { ...ACT_CFG },
    };
  }

  function approvedMkdirResumeAct(): ResumeInput {
    return approvedMkdirResume();
  }

  it("persistent invalid files.write in the INITIAL segment stops at the attempt bound with an actionable message", async () => {
    const { transport, disk } = diskTransport({ "index.html": PAGE });
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      return toolReply(
        "files.write",
        { projectId: "p-test", path: "index.html", content: INVALID_PAGE },
        `tc-inv-${calls}`,
      );
    });

    const result = await runAgentLoopV2("Write the home page", transport, { ...BASE_CFG, maxSteps: 40 });

    // One feedback bounce, then the bound stops the run — the model
    // is never called a third time for the same invalid write.
    expect(calls).toBe(WRITE_RECOVERY_ATTEMPT_LIMIT);
    expect(result.cancelled).toBe(true);
    // The closing message names the tool, the path, and the outcome
    // in plain language (no raw validator detail leaks, R7).
    expect(result.finalText).toContain("files.write");
    expect(result.finalText).toContain("index.html");
    expect(result.finalText).toContain("No change was made to index.html");
    expect(result.finalText).not.toContain("{{business_name}}");
    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(disk.get("index.html")).toBe(PAGE);
  });

  it("persistent invalid files.write in the RESUME segment stops at the attempt bound with an actionable message", async () => {
    const { transport, disk } = diskTransport({ "index.html": PAGE });
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      return toolReply(
        "files.write",
        { projectId: "p-test", path: "index.html", content: INVALID_PAGE },
        `tc-rinv-${calls}`,
      );
    });

    const result = await resumeAgentLoopV2(approvedMkdirResume(), transport);

    expect(calls).toBe(WRITE_RECOVERY_ATTEMPT_LIMIT);
    expect(result.cancelled).toBe(true);
    expect(result.finalText).toContain("files.write");
    expect(result.finalText).toContain("index.html");
    expect(result.finalText).toContain("No change was made to index.html");
    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(disk.get("index.html")).toBe(PAGE);
  });

  it("an escalated write that the user DENIES is never written and never re-asked", async () => {
    const { transport, disk } = diskTransport({ "index.html": PAGE });

    // Segment A (act mode): the gate-tripping write bounces once,
    // escalates on re-emission, and reaches the approval checkpoint.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: REBUILD }, "tc-deny-1"))
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: REBUILD }, "tc-deny-2"));
    const segmentA = await resumeAgentLoopV2(approvedMkdirResumeAct(), transport);
    expect(segmentA.pendingApproval?.toolId).toBe("files.write");
    expect(segmentA.pendingApproval?.inputs.allowOverwrite).toBe(true);
    expect(transport.writeFile).not.toHaveBeenCalled();

    // Segment B: the user DENIES that write. The model re-emits the
    // exact same write — it must be refused outright: no execution,
    // no new approval card, no re-escalation.
    const denied = segmentA.pendingApproval!;
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: REBUILD }, "tc-deny-3"))
      .mockResolvedValueOnce(textReply("Understood — I will not replace the page."));
    const segmentB = await resumeAgentLoopV2(
      {
        pausedMessages: denied.pausedMessages,
        toolId: denied.toolId,
        toolCallId: denied.toolCallId,
        inputs: denied.inputs,
        decision: "rejected",
        rejectionReason: "I don't want the page replaced",
        stepsUsedBeforePause: denied.stepsUsedAtPause ?? 1,
        hadInterveningMutation: denied.hadInterveningMutationAtPause ?? false,
        priorToolCalls: denied.priorToolCalls ?? [],
        config: { ...ACT_CFG },
      },
      transport,
    );

    expect(segmentB.pendingApproval).toBeUndefined();
    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(disk.get("index.html")).toBe(PAGE);
    // The refusal was fed back to the model, and the run then closed
    // honestly on the model's own words — not a failure, not silence.
    const refusal = toolResultFor(segmentB, "tc-deny-3");
    expect(String(refusal?.content ?? "")).toContain("already rejected by the user");
    expect(segmentB.failedHonestly).toBeUndefined();
    expect(segmentB.finalText).toBe("Understood — I will not replace the page.");
  });

  it("cancellation during a write-recovery cycle stops the run before the next model call", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const controller = new AbortController();
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      // Rotating paths keep every per-key attempt at 1, so only the
      // cancellation signal — not the attempt bound — can stop this.
      if (calls === 2) controller.abort();
      return toolReply(
        "files.write",
        { projectId: "p-test", path: `page-${calls}.html`, content: INVALID_PAGE },
        `tc-cancel-${calls}`,
      );
    });

    const result = await runAgentLoopV2("Write pages", transport, {
      ...BASE_CFG,
      maxSteps: 40,
      signal: controller.signal,
    });

    expect(calls).toBe(2);
    expect(result.cancelled).toBe(true);
    expect(result.cancelReason).toBe("Cancelled by user");
    expect(transport.writeFile).not.toHaveBeenCalled();
  });

  it("a model that always emits an invalid write terminates within the bounce budget", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      // A fresh path every time: the per-key attempt limit can never
      // trip, so the segment bounce budget is the only bound.
      return toolReply(
        "files.write",
        { projectId: "p-test", path: `page-${calls}.html`, content: INVALID_PAGE },
        `tc-inf-${calls}`,
      );
    });

    const result = await runAgentLoopV2("Write pages", transport, { ...BASE_CFG, maxSteps: 40 });

    expect(result.cancelled).toBe(true);
    // Exactly the budget's worth of bounced responses, plus the one
    // response that trips it — and never a call beyond that.
    expect(calls).toBe(WRITE_RECOVERY_BOUNCE_BUDGET + 1);
    expect(result.finalText).toContain("No change was made");
    expect(transport.writeFile).not.toHaveBeenCalled();
  });
});

describe("Final merge gate — budgets, denial effects, cancellation, settlement, complex workflows", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  const INVALID_PAGE = [
    "<!DOCTYPE html>",
    "<html><head><title>Harbor Lights Coffee</title></head>",
    "<body><h1>Welcome to {{business_name}}</h1></body></html>",
  ].join("\n");
  // PAGE → REBUILD via three line patches (title, style, body line).
  const REBUILD = [
    "<!DOCTYPE html>",
    "<html><head><title>Harbor Lights — Rebuilt</title>",
    "<style>body { background: #0c0a09; color: #fafaf9; }</style>",
    "</head><body><h1>Harbor Lights, Reimagined</h1><p>A brand new page, top to bottom.</p></body></html>",
  ].join("\n");
  const REBUILD_PATCHES = [
    { search: "<title>Harbor Lights Coffee</title>", replace: "<title>Harbor Lights — Rebuilt</title>" },
    { search: "<style>body { background: #ffffff; color: #1c1917; }</style>", replace: "<style>body { background: #0c0a09; color: #fafaf9; }</style>" },
    { search: "<h1>Harbor Lights Coffee</h1><p>Your daily dose of coastal calm.</p>", replace: "<h1>Harbor Lights, Reimagined</h1><p>A brand new page, top to bottom.</p>" },
  ];

  const ACT_CFG = {
    model: "test-model",
    systemPrompt: "You are LiTT.",
    userId: "u-test",
    executionMode: "act",
    enableBuildFix: false,
    isStaticWorkspace: true,
    maxSteps: 40,
  } as const;

  function actMkdirResume(): ResumeInput {
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
      config: { ...ACT_CFG },
    };
  }

  // The real transport implements applyPatch; the disk mock needs
  // the same surface for patch executions to land on the fake disk.
  function withApplyPatch(transport: WorkspaceTransport, disk: Map<string, string>) {
    Object.assign(transport, {
      applyPatch: vi.fn(async (path: string, patches: Array<{ search: string; replace: string }>) => {
        const current = disk.get(path);
        if (current === undefined) throw new Error(`applyPatch failed (404): ${path}`);
        let next = current;
        for (const p of patches) {
          if (!next.includes(p.search)) throw new Error(`applyPatch search not found in ${path}`);
          next = next.replace(p.search, p.replace);
        }
        disk.set(path, next);
        return { applied: true, patchCount: patches.length };
      }),
    });
  }

  function resumeFromPending(pending: NonNullable<Awaited<ReturnType<typeof resumeAgentLoopV2>>["pendingApproval"]>, decision: "approved" | "rejected"): ResumeInput {
    return {
      pausedMessages: pending.pausedMessages,
      toolId: pending.toolId,
      toolCallId: pending.toolCallId,
      inputs: pending.inputs,
      decision,
      stepsUsedBeforePause: pending.stepsUsedAtPause ?? 1,
      hadInterveningMutation: pending.hadInterveningMutationAtPause ?? false,
      priorToolCalls: pending.priorToolCalls ?? [],
      config: { ...ACT_CFG },
    };
  }

  it("point 1 — rotating TOOLS as well as paths cannot dodge the bounce budget (initial segment)", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      // Alternate write tools, fresh path every time: every per-key
      // attempt count stays at 1, so only the segment budget can stop
      // this — exactly the reset vector Larry named.
      return calls % 2 === 1
        ? toolReply("files.write", { projectId: "p-test", path: `page-${calls}.html`, content: INVALID_PAGE }, `tc-ts-${calls}`)
        : toolReply("apply_patch", { path: `patch-${calls}.html`, patches: [{ search: "text that is not in the file", replace: "x" }] }, `tc-ts-${calls}`);
    });

    const result = await runAgentLoopV2("Write pages", transport, { ...BASE_CFG, maxSteps: 40 });

    expect(calls).toBe(WRITE_RECOVERY_BOUNCE_BUDGET + 1);
    expect(result.cancelled).toBe(true);
    expect(transport.writeFile).not.toHaveBeenCalled();
  });

  it("point 1 — a resumed segment is bounded by the same budget (reset only ever follows a user approval decision)", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      return toolReply(
        "files.write",
        { projectId: "p-test", path: `page-${calls}.html`, content: INVALID_PAGE },
        `tc-rb-${calls}`,
      );
    });

    const result = await resumeAgentLoopV2(
      { ...actMkdirResume(), config: { ...ACT_CFG, executionMode: "auto" } },
      transport,
    );

    expect(calls).toBe(WRITE_RECOVERY_BOUNCE_BUDGET + 1);
    expect(result.cancelled).toBe(true);
    expect(transport.writeFile).not.toHaveBeenCalled();
  });

  it("point 2 — effect identity is shared across write tools, and only for the same resulting content", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });

    const viaWrite = await deniedEffectKey("files.write", { path: "index.html", content: REBUILD }, transport);
    const viaDelegate = await deniedEffectKey("code.writeFile", { path: "index.html", content: REBUILD }, transport);
    const viaPatch = await deniedEffectKey("apply_patch", { path: "index.html", patches: REBUILD_PATCHES }, transport);
    expect(viaWrite).not.toBeNull();
    expect(viaDelegate).toBe(viaWrite);
    expect(viaPatch).toBe(viaWrite);

    // A genuinely different edit to the same path is a different effect.
    const different = await deniedEffectKey(
      "apply_patch",
      { path: "index.html", patches: [{ search: "<h1>Harbor Lights Coffee</h1>", replace: "<h1>Harbor Lights Coffee — Evening Hours</h1>" }] },
      transport,
    );
    expect(different).not.toBeNull();
    expect(different).not.toBe(viaWrite);
  });

  it("point 2 — a denied files.write cannot be re-landed via apply_patch, but a different edit still goes through approval", async () => {
    const { transport, disk } = diskTransport({ "index.html": PAGE });
    withApplyPatch(transport, disk);

    // Segment A: gate-tripping write bounces once, escalates, pauses.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: REBUILD }, "tc-x-1"))
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: REBUILD }, "tc-x-2"));
    const segmentA = await resumeAgentLoopV2(actMkdirResume(), transport);
    expect(segmentA.pendingApproval?.toolId).toBe("files.write");

    // Segment B: user DENIES the rebuild. The model re-proposes the
    // SAME resulting page through apply_patch — refused by effect,
    // never executed, never re-carded. It then proposes a genuinely
    // different small edit, which pauses for approval as normal.
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("apply_patch", { path: "index.html", patches: REBUILD_PATCHES }, "tc-x-3"))
      .mockResolvedValueOnce(toolReply("apply_patch", { path: "index.html", patches: [{ search: "<h1>Harbor Lights Coffee</h1>", replace: "<h1>Harbor Lights Coffee — Evening Hours</h1>" }] }, "tc-x-4"));
    const segmentB = await resumeAgentLoopV2(resumeFromPending(segmentA.pendingApproval!, "rejected"), transport);

    // The bypass attempt was refused by effect (the pause result
    // carries the tool log, not final messages): no execution, no
    // approval card for the denied change.
    const refusal = segmentB.toolCalls.find((c) => c.toolId === "apply_patch" && !c.success);
    expect(refusal?.summary).toContain("already rejected by the user in this run");
    expect(segmentB.pendingApproval?.toolId).toBe("apply_patch");
    expect(segmentB.pendingApproval?.toolCallId).toBe("tc-x-4");
    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(disk.get("index.html")).toBe(PAGE);

    // Segment C: the user approves the DIFFERENT edit — it lands.
    // The denied rebuild never does.
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(textReply("Added the evening-hours line."));
    const segmentC = await resumeAgentLoopV2(resumeFromPending(segmentB.pendingApproval!, "approved"), transport);

    expect(segmentC.finalText).toBe("Added the evening-hours line.");
    expect(disk.get("index.html")).toContain("Evening Hours");
    expect(disk.get("index.html")).not.toBe(REBUILD);
  });

  it("point 3 — an abort during the in-flight model call settles CANCELLED, not as a model failure", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const controller = new AbortController();
    vi.mocked(callLLMWithTools).mockImplementation(
      (_systemPrompt, _messages, _toolDefs, options) =>
        new Promise((_resolve, reject) => {
          // Mirror the real caller: the provider fetch is raced
          // against the run's signal and an abort rejects the call
          // (llm-tool-calling.ts → UpstreamAbortError).
          const sig = options?.signal;
          const abortError = () => Object.assign(new Error("The operation was aborted"), { name: "UpstreamAbortError" });
          if (!sig) return; // never settles — the loop must pass its signal
          if (sig.aborted) {
            reject(abortError());
            return;
          }
          sig.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
    );

    const run = runAgentLoopV2("build a page", transport, {
      ...BASE_CFG,
      maxSteps: 40,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    const result = await run;

    expect(result.cancelled).toBe(true);
    expect(result.cancelReason).toBe("Cancelled by user");
    expect(result.runObservability?.outcome).toBe("cancelled");
    expect(result.finalText).not.toContain("error while reasoning");
  });

  it("point 3 — an abort during a hanging tool call stops the run before the next model call", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const controller = new AbortController();
    let releaseRead!: (value: { content: string; size: number }) => void;
    const hangingRead = new Promise<{ content: string; size: number }>((resolve) => {
      releaseRead = resolve;
    });
    vi.mocked(transport.readFile).mockImplementation(() => hangingRead);
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      return toolReply("files.read", { projectId: "p-test", path: "index.html" }, "tc-hang-1");
    });

    const run = runAgentLoopV2("read the page", transport, {
      ...BASE_CFG,
      maxSteps: 40,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    releaseRead({ content: PAGE, size: PAGE.length });
    const result = await run;

    // The registry races the execution against the run's signal
    // (tool-registry.ts), so the loop's await is interrupted the
    // moment the abort fires and no further model call is spent.
    // The handler's own underlying transport work is not killed —
    // handlers receive no signal parameter (the named residual).
    expect(calls).toBe(1);
    expect(result.cancelled).toBe(true);
    expect(result.cancelReason).toBe("Cancelled by user");
  });

  it("point 4 — a bounce-budget stop settles exactly once as cancelled, charged only for steps actually run", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    let calls = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      calls += 1;
      return toolReply(
        "files.write",
        { projectId: "p-test", path: `page-${calls}.html`, content: INVALID_PAGE },
        `tc-settle-${calls}`,
      );
    });

    const result = await runAgentLoopV2("Write pages", transport, { ...BASE_CFG, maxSteps: 40 });

    expect(result.cancelled).toBe(true);
    // Settlement (run-settlement.ts, computed once at the loop exit):
    // a cancelled run settles "cancelled" — the cancelled/failed
    // semantics under which reservations release and no completion
    // charge can post.
    expect(result.runObservability?.outcome).toBe("cancelled");
    // Steps used == model calls actually made: metering fires per
    // completed step with this step index, so nothing beyond the
    // budget is ever metered or settled.
    expect(result.stepsUsed).toBe(WRITE_RECOVERY_BOUNCE_BUDGET + 1);
    expect(calls).toBe(WRITE_RECOVERY_BOUNCE_BUDGET + 1);
    // Exactly one terminal event — no double settlement signal.
    const terminal = result.events.filter((e) => e.type === "cancelled" || e.type === "finished");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].type).toBe("cancelled");
  });

  it("point 5 — a complex multi-file workflow with bounces and an escalation completes within the limits", async () => {
    const ABOUT = [
      "<!DOCTYPE html>",
      "<html><head><title>About — Harbor Lights</title></head>",
      "<body><h1>About Harbor Lights</h1><p>Our story.</p></body></html>",
    ].join("\n");
    const CSS = "body { margin: 0; font-family: sans-serif; }\n";
    const NEW_HOME = [
      "<!DOCTYPE html>",
      "<html><head><title>Harbor Lights — New Home</title>",
      "<style>body { background: #111111; color: #eeeeee; }</style>",
      "</head><body><h1>Welcome to the New Harbor Lights</h1><p>Fresh look, same coffee.</p></body></html>",
    ].join("\n");
    const MENU_V1 = [
      "<!DOCTYPE html>",
      "<html><head><title>Harbor Lights — Menu</title>",
      "<style>body { background: #ffffff; color: #1c1917; }</style>",
      "</head><body><h1>Menu</h1><p>Coffee $4, pastries $5.</p></body></html>",
    ].join("\n");
    const MENU_V2 = [
      "<!DOCTYPE html>",
      "<html><head><title>Harbor Lights — Menu, Redesigned</title>",
      "<style>body { background: #0c0a09; color: #fafaf9; }</style>",
      "</head><body><h1>The New Menu</h1><p>Espresso $3, croissants $4.</p></body></html>",
    ].join("\n");

    const { transport, disk } = diskTransport({ "index.html": PAGE });
    withApplyPatch(transport, disk);
    vi.mocked(callLLMWithTools)
      // 1–2. Two clean writes (new files).
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "about.html", content: ABOUT }, "tc-w-1"))
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "styles.css", content: CSS }, "tc-w-2"))
      // 3. A correctable write: placeholder content bounces…
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: INVALID_PAGE }, "tc-w-3"))
      // 4. …and the corrected, declared overwrite lands.
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "index.html", content: NEW_HOME, allowOverwrite: true }, "tc-w-4"))
      // 5. A patch whose search text is absent bounces…
      .mockResolvedValueOnce(toolReply("apply_patch", { path: "about.html", patches: [{ search: "text that is not on the page", replace: "x" }] }, "tc-w-5"))
      // 6. …and the corrected patch lands.
      .mockResolvedValueOnce(toolReply("apply_patch", { path: "about.html", patches: [{ search: "<h1>About Harbor Lights</h1>", replace: "<h1>About Harbor Lights Coffee</h1>" }] }, "tc-w-6"))
      // 7. A clean write of a second page.
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "menu.html", content: MENU_V1 }, "tc-w-7"))
      // 8. An undeclared overwrite of that page bounces at the
      //    overwrite gate (fresh recovery key for this path)…
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "menu.html", content: MENU_V2 }, "tc-w-8"))
      // 9. …and its re-emission escalates (marked as the declared
      //    recovery overwrite) and lands — in ACT mode this same
      //    escalation is what reaches the approval checkpoint
      //    (route.resume-wiring.test.ts pins that gate entry).
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "menu.html", content: MENU_V2 }, "tc-w-9"))
      .mockResolvedValueOnce(textReply("Site built."));

    const result = await runAgentLoopV2("Build the Harbor Lights site", transport, { ...BASE_CFG, maxSteps: 40 });

    expect(result.cancelled).toBe(false);
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toBe("Site built.");
    expect(disk.get("about.html")).toContain("About Harbor Lights Coffee");
    expect(disk.get("styles.css")).toBe(CSS);
    expect(disk.get("index.html")).toBe(NEW_HOME);
    expect(disk.get("menu.html")).toBe(MENU_V2);
    // Exactly the three scripted bounces — well inside the budget.
    const bounces = result.toolCalls.filter((c) => !c.success);
    expect(bounces).toHaveLength(3);
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(10);
  });
});
