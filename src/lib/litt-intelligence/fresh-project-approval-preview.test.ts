// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { callLLMWithTools } from "./llm-tool-calling";
import { ensureProjectPreviewReady } from "./launch-flow";
import { resumeAgentLoopV2, runAgentLoopV2 } from "./agent-loop-v2";

const INDEX_HTML = `<!doctype html>
<html><body><main>Fresh stranger site</main></body></html>`;

function makeEmptyWorkspace() {
  const files = new Map<string, string>();
  let previewStarted = false;
  const transport = {
    workspaceId: "ws-fresh-project",
    userId: "user-stranger",
    workspaceRoot: "/workspace/user-stranger/project-fresh",
    projectId: "project-fresh",
    listFiles: vi.fn(async (path: string) => {
      if (path !== ".") return { entries: [] };
      return {
        entries: [...files.keys()].map((name) => ({ name, type: "file" })),
      };
    }),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing file: ${path}`);
      return { content, size: Buffer.byteLength(content, "utf8") };
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return { saved: true };
    }),
    createCheckpointBeforeMutation: vi.fn(async () => null),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [...files.keys()],
      clean: files.size === 0,
    })),
    startPreview: vi.fn(async () => {
      previewStarted = true;
      return {
        workspaceId: "ws-fresh-project",
        status: "starting" as const,
        port: 4101,
        framework: "static",
        command: "serve",
        startedAt: Date.now(),
      };
    }),
    getPreviewStatus: vi.fn(async () => ({
      status: previewStarted ? "ready" as const : "stopped" as const,
      port: previewStarted ? 4101 : null,
      framework: "static",
      command: "serve",
      startedAt: previewStarted ? Date.now() : null,
      lastHealthCheck: previewStarted ? Date.now() : null,
      error: null,
      errorCode: null,
      logs: [],
    })),
  } as unknown as WorkspaceTransport;

  return { transport, files };
}

describe("fresh project → approval → mutation → preview", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("writes the exact requested file in an empty workspace, then starts preview", async () => {
    const { transport, files } = makeEmptyWorkspace();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "I will create the website entry file.",
        toolCalls: [{
          toolCallId: "fresh-write-1",
          toolId: "files.write",
          inputs: {
            projectId: transport.projectId,
            path: "index.html",
            content: INDEX_HTML,
          },
        }],
        finishReason: "tool_calls",
        model: "acceptance-model",
      })
      .mockResolvedValueOnce({
        text: "The website file is on disk and ready for preview.",
        toolCalls: [],
        finishReason: "stop",
        model: "acceptance-model",
      });

    // A brand-new project starts with no project files at all.
    expect(files.size).toBe(0);

    const paused = await runAgentLoopV2(
      "Create a simple website for a fresh project",
      transport,
      {
        systemPrompt: "You are LiTT. Preserve the requested project and write the website files.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(paused.pendingApproval?.toolId).toBe("files.write");
    expect(files.size).toBe(0);
    expect(paused.pendingApproval?.pausedMessages.at(-1)?.role).toBe("assistant");

    const resumed = await resumeAgentLoopV2(
      {
        pausedMessages: paused.pendingApproval!.pausedMessages,
        toolId: paused.pendingApproval!.toolId,
        toolCallId: paused.pendingApproval!.toolCallId,
        inputs: paused.pendingApproval!.inputs,
        decision: "approved",
        config: {
          systemPrompt: "You are LiTT. Preserve the requested project and write the website files.",
          executionMode: "act",
          enableBuildFix: false,
        },
        stepsUsedBeforePause: paused.stepsUsed,
        hadInterveningMutation: false,
      },
      transport,
    );

    expect(resumed.pendingApproval).toBeUndefined();
    expect(resumed.toolCalls).toContainEqual(expect.objectContaining({
      toolId: "files.write",
      success: true,
      mutating: true,
    }));
    expect(files.get("index.html")).toBe(INDEX_HTML);

    const preview = await ensureProjectPreviewReady(
      transport,
      { maxWaitMs: 100, pollIntervalMs: 1 },
    );

    expect(preview.ok).toBe(true);
    expect(preview.files).toEqual(["index.html"]);
    expect(transport.startPreview).toHaveBeenCalledTimes(1);
    expect(transport.getPreviewStatus).toHaveBeenCalled();
  });

  it("refuses to start preview when approval resume produced no runnable artifact", async () => {
    const { transport } = makeEmptyWorkspace();

    const result = await ensureProjectPreviewReady(
      transport,
      { maxWaitMs: 20, pollIntervalMs: 1 },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No runnable website entry file");
    expect(transport.startPreview).not.toHaveBeenCalled();
  });
});
