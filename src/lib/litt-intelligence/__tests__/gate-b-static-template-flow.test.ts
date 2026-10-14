// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../llm-tool-calling", async (original) => ({ ...(await original() as Record<string, unknown>), callLLMWithTools: vi.fn() }));
vi.mock("@/lib/metering", () => ({ emitUsageEvent: vi.fn(async () => ({})), getMeteringContext: vi.fn() }));
import { callLLMWithTools } from "../llm-tool-calling";
import { runLaunchFlow, ensureProjectPreviewReady } from "../launch-flow";
import { resumeAgentLoopV2 } from "../agent-loop-v2";
import type { WorkspaceTransport } from "../workspace-transport";
import { buildWelcomeHtml } from "../../../../terminal-server/workspace/welcome-screen";

describe("static template approval flow regression (not live acceptance)", () => {
  beforeEach(() => vi.mocked(callLLMWithTools).mockReset());
  it.each(["blank-static", "empty-static"])("writes, approves, and verifies %s without host execution", async (template) => {
    const files = new Map<string, string>();
    if (template === "blank-static") files.set("index.html", buildWelcomeHtml());
    const generated = {
      "index.html": '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Gate B test</h1><script src="app.js"></script></body></html>',
      "style.css": "body { background: rgb(12, 24, 36); color: white; }",
      "app.js": 'document.querySelector("h1").dataset.loaded = "true";',
    };
    const transport = {
      workspaceId: "ws-template", projectId: "project-template", userId: "owner", workspaceRoot: "/workspace",
      listFiles: vi.fn(async () => ({ entries: [...files.keys()].map((name) => ({ name, type: "file" })) })),
      readFile: vi.fn(async (path: string) => { if (!files.has(path)) throw new Error("not found"); return { content: files.get(path)!, size: files.get(path)!.length }; }),
      writeFile: vi.fn(async (path: string, content: string) => { files.set(path, content); return { saved: true }; }),
      createCheckpointBeforeMutation: vi.fn(async () => null),
      exec: vi.fn(async () => { throw new Error("HOST_EXECUTION_DISABLED"); }),
      startPreview: vi.fn(async () => { throw new Error("HOST_EXECUTION_DISABLED"); }),
      getPreviewStatus: vi.fn(), discoverPackageInfo: vi.fn(),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Writing HTML, CSS and JS.", model: "test", finishReason: "tool_calls",
      toolCalls: Object.entries(generated).map(([path, content], i) => ({ toolId: "files.write", toolCallId: `write-${i}`, inputs: { projectId: "project-template", path, content } })),
    });
    vi.mocked(callLLMWithTools).mockResolvedValue({ text: "Done.", model: "test", finishReason: "stop", toolCalls: [] });
    const initial = await runLaunchFlow({ userMessage: "Build an HTML/CSS/JS site", userId: "owner", projectId: "project-template", transport, executionMode: "act", isStaticWorkspace: true, requiresExecution: true, enableDeploy: false });
    expect(transport.writeFile).not.toHaveBeenCalled();
    let pending = initial.pendingApproval;
    let approvals = 0;
    let final;
    while (pending) {
      expect(pending.toolId).toBe("files.write");
      expect(++approvals).toBeLessThanOrEqual(3);
      final = await resumeAgentLoopV2({
        pausedMessages: pending.pausedMessages, toolId: pending.toolId, toolCallId: pending.toolCallId, inputs: pending.inputs,
        decision: "approved", stepsUsedBeforePause: pending.stepsUsedAtPause ?? 1, hadInterveningMutation: pending.hadInterveningMutationAtPause ?? false,
        deferredToolCalls: pending.deferredToolCalls,
        config: { systemPrompt: "Build the site", userId: "owner", executionMode: "act", isStaticWorkspace: true, enableBuildFix: true, buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 } },
      }, transport);
      pending = final.pendingApproval;
    }
    expect(approvals).toBe(3);
    expect(final?.cancelled).toBe(false);
    expect(final?.failedHonestly).toBeUndefined();
    expect(Object.fromEntries(files)).toEqual(generated);
    expect(transport.writeFile).toHaveBeenCalledTimes(3);
    expect((await ensureProjectPreviewReady(transport, { isStaticWorkspace: true })).ok).toBe(true);
    expect(transport.exec).not.toHaveBeenCalled();
    expect(transport.startPreview).not.toHaveBeenCalled();
    expect(transport.discoverPackageInfo).not.toHaveBeenCalled();
  });
});
