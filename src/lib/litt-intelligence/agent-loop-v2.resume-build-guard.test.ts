// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * P0 R2 (execution integrity) — resume/recovery parity for the build
 * capability guard (audit D5).
 *
 * The defect: the initial loop, when a model emits tool calls but no
 * file writes for a bounded window, rules that model out and switches
 * to the next build-capable model. The resumed loop failed the run
 * outright at the same threshold — a resumed build served by a weak
 * fallback model had no escape (Acceptance Run 1 restart, 2026-11-26:
 * "The resumed build made no successful file writes in 3 steps").
 *
 * The contract these tests pin:
 *   - a write-less window in a resumed build fires the same
 *     build_model_incompatible evidence, excludes the serving model,
 *     and continues the SAME run on the next eligible build model;
 *   - the escape is bounded by the registry's build-model chain: when
 *     every build-capable model has been ruled out, the run ends with
 *     NO_BUILD_CAPABLE_MODEL — it never switches forever;
 *   - context and completed work survive the switch (the conversation
 *     is one loop state; only the requested model changes).
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));
// Enrichment determinism: no stock image ever resolves, so the
// enrichment pass degrades to its placeholder path without network.
vi.mock("@/lib/site-enrich/resolver", () => ({
  resolveSlotImage: vi.fn(async () => null),
}));

import { resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, callLLMWithTools } from "./llm-tool-calling";

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Sunny Crust Bakery</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Sunny Crust Bakery</h1><p>Fresh from the oven.</p></body></html>",
].join("\n");

function makeTransport() {
  const files = new Map<string, string>();
  for (let i = 1; i <= 40; i++) files.set(`page-${i}.html`, PAGE);
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    lastCheckpointError: null as string | null,
    // Static (gitless) workspace: checkpoint creation is "not
    // applicable" — null with no recorded error.
    createCheckpointBeforeMutation: vi.fn(async () => null),
    readFile: vi.fn(async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`404 not found: ${p}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      files.set(p, content);
      return { saved: true };
    }),
    mkdir: vi.fn(async () => ({ created: true })),
    listFiles: vi.fn(async (dir: string) => ({
      entries: [...files.keys()]
        .filter((k) => (dir === "." || dir === "" ? !k.includes("/") : k.startsWith(`${dir}/`)))
        .map((k) => ({ name: k.split("/").pop() as string, type: "file" })),
    })),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      clean: true,
    })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

function resumeInput(): ResumeInput {
  const assistantMsg = buildAssistantToolCallMessage(
    [{ toolId: "files.mkdir", toolCallId: "tc-0", inputs: { path: "assets" } }],
    "Building the bakery site.",
    undefined,
  );
  return {
    pausedMessages: [
      { role: "user", content: "Build a one-page website for a bakery called Sunny Crust Bakery" },
      assistantMsg,
    ],
    toolId: "files.mkdir",
    toolCallId: "tc-0",
    inputs: { path: "assets" },
    decision: "approved",
    config: {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      userId: "u-test",
      executionMode: "auto" as const,
      enableBuildFix: false,
      isStaticWorkspace: true,
      maxSteps: 40,
      buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
    },
    stepsUsedBeforePause: 1,
    hadInterveningMutation: false,
  };
}

function readStep(model: string, provider: string, n: number) {
  return {
    text: "",
    toolCalls: [{ toolCallId: `tc-read-${n}`, toolId: "files.read", inputs: { projectId: "p-test", path: `page-${n}.html` } }],
    finishReason: "tool_calls",
    model,
    provider,
  };
}

describe("P0 R2 — resumed build guard switches models instead of failing", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("rules out the write-less model and completes on the switched model", async () => {
    const { transport, files } = makeTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(readStep("cohere/north-mini-code:free", "openrouter", 1))
      .mockResolvedValueOnce(readStep("cohere/north-mini-code:free", "openrouter", 2))
      .mockResolvedValueOnce(readStep("cohere/north-mini-code:free", "openrouter", 3))
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolCallId: "tc-write-1", toolId: "files.write", inputs: { projectId: "p-test", path: "index.html", content: PAGE } }],
        finishReason: "tool_calls",
        model: "gemini-2.5-flash",
        provider: "gemini",
      })
      .mockResolvedValueOnce({
        text: "Your bakery site is ready.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-2.5-flash",
        provider: "gemini",
      });

    const result = await resumeAgentLoopV2(resumeInput(), transport);

    // The guard fired once, naming the ruled-out model — the same
    // structured evidence the initial loop produces.
    const incompatible = result.events.filter((e) => e.type === "build_model_incompatible");
    expect(incompatible).toHaveLength(1);
    expect(incompatible[0]).toMatchObject({
      canonicalId: "openrouter-north-mini-code",
      provider: "openrouter",
      stepsObserved: 3,
      reason: "no_file_write_calls_in_window",
    });
    // The next step was routed to the next eligible build model.
    const fourthCall = vi.mocked(callLLMWithTools).mock.calls[3];
    expect(fourthCall[3]).toMatchObject({ model: "gemini-2.5-flash" });
    // The run did NOT die with the old zero-write honest failure: the
    // switched model wrote the page and the run completed.
    expect(result.failedHonestly).toBeUndefined();
    expect(result.modelFailed).toBeUndefined();
    expect(files.get("index.html")).toBe(PAGE);
    expect(result.finalText).toBe("Your bakery site is ready.");
    // The switch was announced in the run's own event stream.
    expect(
      result.events.some(
        (e) => e.type === "status" && e.summary.includes("Switching build model to"),
      ),
    ).toBe(true);
  });

  it("is bounded: a permanently write-less chain ends in NO_BUILD_CAPABLE_MODEL, never an endless switch loop", async () => {
    const { transport } = makeTransport();
    // The mock honors the guard's hint: whatever model the guard
    // switches to serves the next window — still read-only. The guard
    // must walk the finite registry chain and stop.
    let stepNo = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async (_systemPrompt, _messages, _tools, opts) => {
      const hinted = (opts as { model?: string } | undefined)?.model;
      const model = hinted && hinted !== "test-model" ? hinted : "cohere/north-mini-code:free";
      const provider = model.startsWith("gemini") ? "gemini" : "openrouter";
      stepNo += 1;
      return readStep(model, provider, stepNo);
    });

    const result = await resumeAgentLoopV2(resumeInput(), transport);

    expect(result.modelFailed).toBe("NO_BUILD_CAPABLE_MODEL");
    expect(result.modelFailureText).toContain("No build-capable model is available");
    // The old behavior stopped after ONE window (3 calls) with an
    // honest failure; the escape must try more than one model — and
    // the total must stay bounded well under maxSteps (40): the same
    // 10-model chain the initial loop walks, 3 steps per window.
    const calls = vi.mocked(callLLMWithTools).mock.calls.length;
    expect(calls).toBeGreaterThan(3);
    expect(calls).toBeLessThanOrEqual(30);
    // Every ruled-out window left its evidence event.
    const incompatible = result.events.filter((e) => e.type === "build_model_incompatible");
    expect(incompatible.length).toBeGreaterThanOrEqual(4);
  });
});
