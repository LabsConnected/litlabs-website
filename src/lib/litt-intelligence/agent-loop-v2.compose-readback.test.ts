import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

// site.compose / site.patch are registered enabled only on the local
// small lane (tool-registry reads the env at registration time), so the
// env must be set before any module in the import graph loads.
vi.hoisted(() => {
  process.env.LITT_LOCAL_SMALL = "1";
});

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2, resumeAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

const fakeTransport = {
  workspaceId: "ws-test",
  userId: "u-test",
  workspaceRoot: "/tmp/test",
  projectId: "p-test",
  createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
} as unknown as WorkspaceTransport;

/**
 * ACC-01 F1 (2026-11-22): site.compose and site.patch were missing from
 * mutation read-back coverage, so their mutations carried
 * persisted=undefined and depended entirely on the checkpoint diff —
 * which a gitless (static) workspace can never produce. A build that
 * verifiably wrote its page could therefore settle "partial" and be
 * reported FAILED ("could not verify whether files changed"). The
 * read-back now verifies the composed page's identity anchors (plan
 * title + hero heading) and the patched section's claimed text.
 */
describe("runAgentLoopV2 — site.compose / site.patch read-back (ACC-01 F1)", () => {
  function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [{ toolCallId, toolId, inputs }],
      finishReason: "tool_calls",
      model: "test-model",
    };
  }
  const doneReply = { text: "Done.", toolCalls: [], finishReason: "stop", model: "test-model" };

  // site.compose / site.patch are approval-gated in every mode — the
  // executed call (and its read-back) materialize on the approved
  // resume, exactly as in production ACT-mode runs.
  async function approveGate(
    paused: Awaited<ReturnType<typeof runAgentLoopV2>>,
    transport: WorkspaceTransport,
  ) {
    const gate = paused.pendingApproval;
    expect(gate).toBeDefined();
    return resumeAgentLoopV2({
      pausedMessages: gate!.pausedMessages,
      toolId: gate!.toolId,
      toolCallId: gate!.toolCallId,
      inputs: gate!.inputs,
      decision: "approved",
      config: {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
      },
      stepsUsedBeforePause: gate!.stepsUsedAtPause ?? 1,
      hadInterveningMutation: gate!.hadInterveningMutationAtPause ?? false,
      priorToolCalls: gate!.priorToolCalls,
    }, transport);
  }

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  function memoryTransport(seed: Record<string, string> = {}) {
    const files = new Map<string, string>(Object.entries(seed));
    return {
      transport: {
        ...fakeTransport,
        readFile: vi.fn(async (p: string) => {
          const content = files.get(p);
          if (content === undefined) throw new Error(`404 not found: ${p}`);
          return { content, size: content.length };
        }),
        writeFile: vi.fn(async (p: string, content: string) => {
          files.set(p, content);
          return { saved: true };
        }),
        listFiles: vi.fn(async (dir: string) => ({
          entries: [...files.keys()]
            .filter((k) => (dir === "." ? !k.includes("/") : k.startsWith(`${dir}/`)))
            .map((k) => ({ name: k.split("/").pop() as string, type: "file" })),
        })),
      } as unknown as WorkspaceTransport,
      files,
    };
  }

  const COMPOSE_PLAN = {
    title: "Harbor Lights Coffee",
    hero: { heading: "Harbor Lights Coffee", subheading: "Fresh coffee by the pier", cta: "See the menu", image: "coffee shop" },
    sections: [
      { kind: "features", heading: "Menu", items: [{ title: "Classic Latte", text: "$4.50", icon: "cup" }] },
      { kind: "footer", text: "Open 7 AM to 6 PM" },
    ],
  };

  it("site.compose records persisted:true when the composed page reads back with its anchors", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-compose", "site.compose", COMPOSE_PLAN))
      .mockResolvedValueOnce(doneReply);

    const paused = await runAgentLoopV2("build a coffee shop page", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    expect(paused.pendingApproval?.toolId).toBe("site.compose");
    const result = await approveGate(paused, transport);

    const call = result.toolCalls.find((t) => t.toolId === "site.compose");
    expect(call?.success).toBe(true);
    expect(call?.persisted).toBe(true);
    expect(files.get("index.html")).toContain("Harbor Lights Coffee");
  });

  it("site.compose records persisted:false when the write never lands", async () => {
    const { transport } = memoryTransport();
    // A transport whose writeFile reports success but persists nothing —
    // the canonical unverifiable-write shape.
    (transport as unknown as { writeFile: unknown }).writeFile = vi.fn(async () => ({ saved: true }));
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-compose2", "site.compose", COMPOSE_PLAN))
      .mockResolvedValueOnce(doneReply);

    const paused = await runAgentLoopV2("build a coffee shop page", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    const result = await approveGate(paused, transport);

    const call = result.toolCalls.find((t) => t.toolId === "site.compose");
    expect(call?.success).toBe(true);
    expect(call?.persisted).toBe(false);
  });

  it("site.patch records persisted:true when the patched text reads back", async () => {
    const { transport, files } = memoryTransport();
    // Build the page first through the real compose path so the patch
    // splices a genuine composed document.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-compose3", "site.compose", COMPOSE_PLAN))
      .mockResolvedValueOnce(doneReply);
    const pausedBuild = await runAgentLoopV2("build a coffee shop page", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    await approveGate(pausedBuild, transport);
    expect(files.get("index.html")).toContain("Harbor Lights Coffee");

    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-patch", "site.patch", { section: "footer", text: "Open 7 AM to 6 PM — fresh pastries daily" }))
      .mockResolvedValueOnce(doneReply);
    const pausedPatch = await runAgentLoopV2("mention fresh pastries in the footer", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    expect(pausedPatch.pendingApproval?.toolId).toBe("site.patch");
    const result = await approveGate(pausedPatch, transport);

    const call = result.toolCalls.find((t) => t.toolId === "site.patch");
    expect(call?.success).toBe(true);
    expect(call?.persisted).toBe(true);
    expect(files.get("index.html")).toContain("fresh pastries daily");
  });

  it("site.patch records persisted:true when the patched text is HTML-escaped in the page", async () => {
    // Greptile, PR #1103: the renderer escapes & as &amp; when splicing
    // section text, so a raw includes() read-back marked a landed edit
    // ("Coffee & pastries") as persisted:false and failed the run over a
    // correct file — the F1 defect class returning through escaping.
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-compose4", "site.compose", COMPOSE_PLAN))
      .mockResolvedValueOnce(doneReply);
    const pausedBuild = await runAgentLoopV2("build a coffee shop page", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    await approveGate(pausedBuild, transport);

    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-patch2", "site.patch", { section: "footer", text: "Coffee & pastries served daily" }))
      .mockResolvedValueOnce(doneReply);
    const pausedPatch = await runAgentLoopV2("say coffee and pastries in the footer", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    expect(pausedPatch.pendingApproval?.toolId).toBe("site.patch");
    const result = await approveGate(pausedPatch, transport);

    const call = result.toolCalls.find((t) => t.toolId === "site.patch");
    expect(call?.success).toBe(true);
    expect(call?.persisted).toBe(true);
    expect(files.get("index.html")).toContain("pastries served daily");
  });
});
