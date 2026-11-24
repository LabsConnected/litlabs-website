import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

/**
 * ACC-03 item 5 regression pin — the FIRST build in a fresh project.
 *
 * A fresh static project has no git (checkpointing is skipped, git
 * status cannot answer) and the run's acceptance failure wore the
 * label "could not verify whether files changed". This pins the
 * evidence composition that must save such a build: the write's
 * read-back plus the direct-read fallback (PR #1103) settle the run as
 * "changed" even when BOTH the checkpoint diff and the volume-listing
 * channels are unavailable — so a healthy first build never settles as
 * a verification failure. (The dishonest part of the live failure was
 * the transcript label, fixed in StudioTranscript.deriveWorkLog: a run
 * that attempted no file work no longer wears the verification label.)
 */
describe("runAgentLoopV2 — first build in a fresh gitless static workspace (ACC-03 item 5)", () => {
  beforeEach(async () => {
    vi.mocked(callLLMWithTools).mockReset();
    const { _resetModelRegistryForTests } = await import("./model-registry");
    const { _resetProviderHealthForTests } = await import("./provider-registry");
    _resetModelRegistryForTests();
    _resetProviderHealthForTests();
  });

  it("settles changed via direct-read when git + listing are unavailable but the file reads back", async () => {
    let saved: string | null = null;
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      // Gitless static workspace: checkpointing is skipped (null), git is absent.
      createCheckpointBeforeMutation: vi.fn(async () => null),
      gitStatus: vi.fn(async () => { throw new Error("not a git repository"); }),
      // The volume-listing channel cannot answer either.
      listFiles: vi.fn(async () => { throw new Error("listing unavailable"); }),
      writeFile: vi.fn(async (_path: string, content: string) => { saved = content; }),
      readFile: vi.fn(async () => {
        if (saved === null) throw new Error("404 not found");
        return { content: saved, size: saved.length };
      }),
    } as unknown as WorkspaceTransport;

    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-write", toolId: "files.write",
          inputs: { projectId: "p-test", path: "index.html", content: "<h1>Sunny Crust Bakery</h1>" },
        }],
        finishReason: "tool_calls", model: "gemini-2.5-flash", provider: "gemini",
      })
      .mockResolvedValueOnce({
        text: "Done.", toolCalls: [], finishReason: "stop",
        model: "gemini-2.5-flash", provider: "gemini",
      });

    const result = await runAgentLoopV2("Build a bakery site and save index.html", transport, {
      systemPrompt: "You are LiTT.", executionMode: "auto", enableBuildFix: false,
      isStaticWorkspace: true, maxSteps: 8, buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
    });

    expect(result.failedHonestly).toBeUndefined();
    expect(result.workspaceChange?.status).toBe("changed");
    expect(result.workspaceChange?.evidenceSource).toBe("direct-read");
  });
});
